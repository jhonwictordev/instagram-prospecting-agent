import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../../..');
loadDotenv({ path: path.join(projectRoot, '.env') });

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Provide the campaign JSON path');
const campaign = JSON.parse(await readFile(path.resolve(inputPath), 'utf8'));
const apiKey = process.env.BROWSER_WORKER_API_KEY;
if (!apiKey) throw new Error('BROWSER_WORKER_API_KEY is missing');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const workerUrl = `http://127.0.0.1:${process.env.PORT || 3001}`;
let executionId;

const nowInMinutes = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.TZ || 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  return (
    Number(parts.find((part) => part.type === 'hour').value) * 60 +
    Number(parts.find((part) => part.type === 'minute').value)
  );
};

const parseClock = (value) => {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};

const insideWindow = () => {
  const now = nowInMinutes();
  const start = parseClock(campaign.allowedStart);
  const end = parseClock(campaign.allowedEnd);
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
};

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
    error.result = result;
    throw error;
  }
  return result;
};

const waitSafely = async (seconds) => {
  for (let remaining = seconds; remaining > 0; remaining -= 10) {
    if (remaining % 30 === 0 || remaining === seconds) {
      console.log(`WAIT|${remaining}s até a próxima tentativa`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(10, remaining) * 1000));
  }
};

try {
  if (!insideWindow()) throw new Error('OUTSIDE_ALLOWED_HOURS');
  const session = await workerRequest('/session/status');
  if (!session.loggedIn || session.challengeDetected) {
    throw new Error(
      session.challengeDetected ? 'PLATFORM_INTERVENTION_REQUIRED' : 'LOGIN_REQUIRED',
    );
  }

  const running = await pool.query("SELECT id FROM executions WHERE status='running' LIMIT 1");
  if (running.rowCount) throw new Error(`Another execution is running: ${running.rows[0].id}`);

  const createdCampaign = await pool.query(
    `INSERT INTO campaigns
      (name,niche,location,outreach_message,execution_mode,maximum_contacts,minimum_delay_seconds,maximum_delay_seconds)
     VALUES ($1,$2,$3,$4,'approval',$5,$6,$6)
     RETURNING id`,
    [
      campaign.name,
      campaign.niche,
      campaign.location,
      campaign.message,
      campaign.prospects.length,
      campaign.delaySeconds,
    ],
  );
  const campaignId = createdCampaign.rows[0].id;
  const createdExecution = await pool.query(
    "INSERT INTO executions(campaign_id,status) VALUES ($1,'running') RETURNING id",
    [campaignId],
  );
  executionId = createdExecution.rows[0].id;

  const queue = [];
  let skipped = 0;
  for (const candidate of campaign.prospects) {
    let prospect = await pool.query(
      'SELECT id FROM prospects WHERE lower(username)=lower($1) OR profile_url=$2 LIMIT 1',
      [candidate.username, candidate.profileUrl],
    );
    if (!prospect.rowCount) {
      prospect = await pool.query(
        `INSERT INTO prospects
          (username,display_name,profile_url,detected_category,detected_location,qualification_score,qualification_status,notes)
         VALUES ($1,$2,$3,$4,$5,100,'qualified',$6)
         RETURNING id`,
        [
          candidate.username,
          candidate.displayName,
          candidate.profileUrl,
          'imobiliária',
          candidate.region,
          'Qualificação manual por fontes públicas e aprovação explícita do usuário.',
        ],
      );
    } else {
      await pool.query(
        `UPDATE prospects
            SET display_name=$2,detected_category='imobiliária',detected_location=$3,
                qualification_score=100,qualification_status='qualified',last_seen_at=now(),
                notes='Qualificação manual por fontes públicas e aprovação explícita do usuário.'
          WHERE id=$1`,
        [prospect.rows[0].id, candidate.displayName, candidate.region],
      );
    }
    const prospectId = prospect.rows[0].id;
    const duplicate = await pool.query(
      `SELECT id,status FROM outreach_messages
        WHERE prospect_id=$1 AND message=$2 AND status IN ('prepared','approved','sent') LIMIT 1`,
      [prospectId, campaign.message],
    );
    if (duplicate.rowCount) {
      skipped += 1;
      console.log(`SKIP|@${candidate.username}|duplicidade no banco`);
      continue;
    }
    const outreach = await pool.query(
      `INSERT INTO outreach_messages
        (campaign_id,prospect_id,execution_id,message,status,prepared_at)
       VALUES ($1,$2,$3,$4,'prepared',now())
       RETURNING id`,
      [campaignId, prospectId, executionId, campaign.message],
    );
    queue.push({ ...candidate, outreachMessageId: outreach.rows[0].id });
  }

  await pool.query(
    `UPDATE executions SET status='awaiting_approval',profiles_found=$2,profiles_analyzed=$2,
      profiles_qualified=$2,messages_prepared=$3,messages_skipped=$4 WHERE id=$1`,
    [executionId, campaign.prospects.length, queue.length, skipped],
  );
  console.log(`QUEUE|execution=${executionId}|ready=${queue.length}|skipped=${skipped}`);

  let consecutiveErrors = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index];
    if (!insideWindow()) throw new Error('OUTSIDE_ALLOWED_HOURS');
    if (index > 0) await waitSafely(campaign.delaySeconds);
    console.log(
      `ATTEMPT|${index + 1}/${queue.length}|@${candidate.username}|${candidate.profileUrl}`,
    );
    try {
      const result = await workerRequest('/message/approve', {
        outreachMessageId: candidate.outreachMessageId,
        approvalToken: candidate.outreachMessageId,
        approved: true,
      });
      if (result.status === 'platform_intervention_required') {
        throw new Error(`PLATFORM_INTERVENTION_REQUIRED: ${result.reason || ''}`);
      }
      if (result.success && result.status === 'sent') {
        consecutiveErrors = 0;
        console.log(`SENT|${index + 1}/${queue.length}|@${candidate.username}|${result.sentAt}`);
        continue;
      }
      if (result.status === 'duplicate_message') {
        consecutiveErrors = 0;
        skipped += 1;
        await pool.query(
          "UPDATE outreach_messages SET status='duplicate_message',error_message='Identical message already exists in conversation' WHERE id=$1",
          [candidate.outreachMessageId],
        );
        await pool.query('UPDATE executions SET messages_skipped=messages_skipped+1 WHERE id=$1', [
          executionId,
        ]);
        console.log(
          `SKIP|${index + 1}/${queue.length}|@${candidate.username}|duplicidade na conversa`,
        );
        continue;
      }
      throw new Error(`Unexpected worker response: ${JSON.stringify(result)}`);
    } catch (error) {
      consecutiveErrors += 1;
      const message = String(error.message || error).slice(0, 500);
      await pool.query("UPDATE outreach_messages SET status='error',error_message=$2 WHERE id=$1", [
        candidate.outreachMessageId,
        message,
      ]);
      await pool.query('UPDATE executions SET messages_skipped=messages_skipped+1 WHERE id=$1', [
        executionId,
      ]);
      console.log(`ERROR|${index + 1}/${queue.length}|@${candidate.username}|${message}`);
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
    `UPDATE executions SET status=CASE WHEN $2>0 THEN 'awaiting_approval' ELSE 'completed' END,
      finished_at=CASE WHEN $2>0 THEN NULL ELSE now() END WHERE id=$1`,
    [executionId, remaining.rows[0].count],
  );
  const summary = await pool.query(
    'SELECT status,profiles_found,profiles_qualified,messages_prepared,messages_sent,messages_skipped FROM executions WHERE id=$1',
    [executionId],
  );
  console.log(`DONE|${JSON.stringify(summary.rows[0])}`);
} catch (error) {
  const message = String(error.message || error).slice(0, 1000);
  if (executionId) {
    await pool.query(
      "UPDATE executions SET status='error',finished_at=now(),error_message=$2 WHERE id=$1",
      [executionId, message],
    );
  }
  console.log(`STOPPED|${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
