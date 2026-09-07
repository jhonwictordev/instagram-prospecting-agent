import pg from 'pg';

export type PreparedMessage = {
  id: string;
  executionId: string;
  profileUrl: string;
  message: string;
};

export class Repository {
  private readonly pool: pg.Pool;

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 5 });
  }

  async isBlocked(username: string, url: string) {
    const result = await this.pool.query(
      `SELECT 1
         FROM blocklist
        WHERE lower(username) = lower($1) OR profile_url = $2
        UNION
       SELECT 1
         FROM prospects
        WHERE (lower(username) = lower($1) OR profile_url = $2)
          AND do_not_contact = true
        LIMIT 1`,
      [username, url],
    );
    return Boolean(result.rowCount);
  }

  async duplicateMessage(url: string, message: string, includePrepared = true) {
    const statuses = includePrepared ? ['prepared', 'approved', 'sent'] : ['approved', 'sent'];
    const result = await this.pool.query(
      `SELECT 1
         FROM outreach_messages o
         JOIN prospects p ON p.id = o.prospect_id
        WHERE p.profile_url = $1
          AND o.message = $2
          AND o.status = ANY($3::text[])
        LIMIT 1`,
      [url, message, statuses],
    );
    return Boolean(result.rowCount);
  }

  async preparedMessage(outreachMessageId: string): Promise<PreparedMessage | undefined> {
    const result = await this.pool.query<{
      id: string;
      execution_id: string;
      profile_url: string;
      message: string;
    }>(
      `SELECT o.id, o.execution_id, p.profile_url, o.message
         FROM outreach_messages o
         JOIN prospects p ON p.id = o.prospect_id
        WHERE o.id = $1 AND o.status = 'prepared'`,
      [outreachMessageId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      executionId: row.execution_id,
      profileUrl: row.profile_url,
      message: row.message,
    };
  }

  async listPrepared(limit = 50): Promise<PreparedMessage[]> {
    const result = await this.pool.query<{
      id: string;
      execution_id: string;
      profile_url: string;
      message: string;
    }>(
      `SELECT o.id, o.execution_id, p.profile_url, o.message
         FROM outreach_messages o
         JOIN prospects p ON p.id = o.prospect_id
        WHERE o.status = 'prepared'
        ORDER BY o.created_at ASC
        LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows.map((row) => ({
      id: row.id,
      executionId: row.execution_id,
      profileUrl: row.profile_url,
      message: row.message,
    }));
  }

  async markSent(outreachMessageId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<{ execution_id: string }>(
        `UPDATE outreach_messages
            SET status = 'sent', approved_at = now(), sent_at = now()
          WHERE id = $1 AND status = 'prepared'
          RETURNING execution_id`,
        [outreachMessageId],
      );
      const executionId = updated.rows[0]?.execution_id;
      if (!executionId) throw new Error('PREPARED_MESSAGE_NOT_FOUND');
      await client.query(
        `UPDATE executions
            SET messages_sent = messages_sent + 1,
                status = CASE
                  WHEN EXISTS (
                    SELECT 1 FROM outreach_messages
                     WHERE execution_id = $1 AND status = 'prepared'
                  ) THEN 'awaiting_approval'
                  ELSE 'completed'
                END,
                finished_at = CASE
                  WHEN EXISTS (
                    SELECT 1 FROM outreach_messages
                     WHERE execution_id = $1 AND status = 'prepared'
                  ) THEN NULL
                  ELSE now()
                END
          WHERE id = $1`,
        [executionId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}
