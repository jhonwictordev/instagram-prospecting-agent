import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(scriptDirectory, '../../../.env') });

const executionId = process.argv[2];
const delaySeconds = Number(process.argv[3] || 90);
if (!/^[0-9a-f-]{36}$/i.test(executionId || '')) throw new Error('Invalid execution ID');
if (delaySeconds < 90) throw new Error('Delay must be at least 90 seconds');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const workerUrl = `http://127.0.0.1:${process.env.PORT || 3001}`;
const apiKey = process.env.BROWSER_WORKER_API_KEY;

const workerRequest = async (route, body) => {
  const response = await fetch(`${workerUrl}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      `Worker ${response.status}: ${result.status || result.error || 'request failed'}`,
    );
    error.status = response.status;
    throw error;
  }
  return result;
};

const waitSafely = async () => {
  for (let remaining = delaySeconds; remaining > 0; remaining -= 10) {
    if (remaining % 30 === 0 || remaining === delaySeconds) console.log(`WAIT|${remaining}s`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(10, remaining) * 1000));
  }
};

try {
  const session = await workerRequest('/session/status');
  if (!session.loggedIn || session.challengeDetected) {
    throw new Error(
      session.challengeDetected ? 'PLATFORM_INTERVENTION_REQUIRED' : 'LOGIN_REQUIRED',
    );
  }

  await pool.query(
    `UPDATE outreach_messages
        SET status='prepared',error_message=NULL,sent_at=NULL,approved_at=NULL
      WHERE execution_id=$1 AND status NOT IN ('sent','recipient_not_accepting_messages','profile_unavailable','message_unavailable')`,
    [executionId],
  );
  await pool.query(
    `UPDATE executions
        SET status='awaiting_approval',finished_at=NULL,error_message=NULL,
            messages_skipped=(SELECT count(*)::int FROM outreach_messages WHERE execution_id=$1 AND status IN ('recipient_not_accepting_messages','profile_unavailable','message_unavailable'))
      WHERE id=$1`,
    [executionId],
  );
  const pending = await pool.query(
    `SELECT o.id,p.username,p.profile_url
       FROM outreach_messages o
       JOIN prospects p ON p.id=o.prospect_id
      WHERE o.execution_id=$1 AND o.status='prepared'
      ORDER BY o.prepared_at,o.id`,
    [executionId],
  );
  console.log(`RESUME|execution=${executionId}|pending=${pending.rowCount}`);

  let consecutiveErrors = 0;
  for (let index = 0; index < pending.rows.length; index += 1) {
    const item = pending.rows[index];
    if (index > 0) await waitSafely();
    console.log(`ATTEMPT|${index + 1}/${pending.rowCount}|@${item.username}`);
    try {
      const result = await workerRequest('/message/approve', {
        outreachMessageId: item.id,
        approvalToken: item.id,
        approved: true,
      });
      if (result.status === 'platform_intervention_required') {
        throw new Error(`PLATFORM_INTERVENTION_REQUIRED: ${result.reason || ''}`);
      }
      if (result.success && result.status === 'sent') {
        consecutiveErrors = 0;
        console.log(`SENT|${index + 1}/${pending.rowCount}|@${item.username}|${result.sentAt}`);
        continue;
      }
      if (result.status === 'duplicate_message') {
        consecutiveErrors = 0;
        await pool.query(
          "UPDATE outreach_messages SET status='duplicate_message',error_message='Identical message already exists in conversation' WHERE id=$1",
          [item.id],
        );
        await pool.query('UPDATE executions SET messages_skipped=messages_skipped+1 WHERE id=$1', [
          executionId,
        ]);
        console.log(`SKIP|${index + 1}/${pending.rowCount}|@${item.username}|duplicate_message`);
        continue;
      }
      if (result.status === 'recipient_not_accepting_messages') {
        consecutiveErrors = 0;
        await pool.query(
          "UPDATE outreach_messages SET status='recipient_not_accepting_messages',sent_at=NULL,error_message='Recipient does not accept new message requests' WHERE id=$1",
          [item.id],
        );
        await pool.query('UPDATE executions SET messages_skipped=messages_skipped+1 WHERE id=$1', [
          executionId,
        ]);
        console.log(
          `SKIP|${index + 1}/${pending.rowCount}|@${item.username}|recipient_not_accepting_messages`,
        );
        continue;
      }
      if (result.status === 'profile_unavailable') {
        consecutiveErrors = 0;
        await pool.query(
          "UPDATE outreach_messages SET status='profile_unavailable',sent_at=NULL,error_message='Instagram profile is unavailable' WHERE id=$1",
          [item.id],
        );
        await pool.query('UPDATE executions SET messages_skipped=messages_skipped+1 WHERE id=$1', [
          executionId,
        ]);
        console.log(`SKIP|${index + 1}/${pending.rowCount}|@${item.username}|profile_unavailable`);
        continue;
      }
      if (result.status === 'message_unavailable') {
        consecutiveErrors = 0;
        await pool.query(
          "UPDATE outreach_messages SET status='message_unavailable',sent_at=NULL,error_message='Instagram profile does not expose a message button' WHERE id=$1",
          [item.id],
        );
        await pool.query('UPDATE executions SET messages_skipped=messages_skipped+1 WHERE id=$1', [
          executionId,
        ]);
        console.log(`SKIP|${index + 1}/${pending.rowCount}|@${item.username}|message_unavailable`);
        continue;
      }
      throw new Error(`Unexpected worker response: ${JSON.stringify(result)}`);
    } catch (error) {
      consecutiveErrors += 1;
      const message = String(error.message || error).slice(0, 500);
      await pool.query("UPDATE outreach_messages SET status='error',error_message=$2 WHERE id=$1", [
        item.id,
        message,
      ]);
      await pool.query('UPDATE executions SET messages_skipped=messages_skipped+1 WHERE id=$1', [
        executionId,
      ]);
      console.log(`ERROR|${index + 1}/${pending.rowCount}|@${item.username}|${message}`);
      if (
        message.includes('PLATFORM_INTERVENTION_REQUIRED') ||
        error.status === 403 ||
        consecutiveErrors >= 3
      ) {
        throw error;
      }
    }
  }

  const remaining = await pool.query(
    "SELECT count(*)::int AS count FROM outreach_messages WHERE execution_id=$1 AND status='prepared'",
    [executionId],
  );
  await pool.query(
    `UPDATE executions
        SET status=CASE WHEN $2>0 THEN 'awaiting_approval' ELSE 'completed' END,
            finished_at=CASE WHEN $2>0 THEN NULL ELSE now() END
      WHERE id=$1`,
    [executionId, remaining.rows[0].count],
  );
  const summary = await pool.query(
    'SELECT status,messages_prepared,messages_sent,messages_skipped FROM executions WHERE id=$1',
    [executionId],
  );
  console.log(`DONE|${JSON.stringify(summary.rows[0])}`);
} catch (error) {
  const message = String(error.message || error).slice(0, 1000);
  await pool.query(
    "UPDATE executions SET status='error',finished_at=now(),error_message=$2 WHERE id=$1",
    [executionId, message],
  );
  console.log(`STOPPED|${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
