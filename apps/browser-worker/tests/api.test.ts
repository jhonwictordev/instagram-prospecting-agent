import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app.js';
import type { Config } from '../src/config/env.js';

const config = {
  PORT: 3001,
  BROWSER_WORKER_API_KEY: '1234567890123456',
  DATABASE_URL: 'x',
  ALLOWED_ORIGIN: 'http://localhost:5678',
  BRAVE_USER_DATA_DIR: 'x',
  HEADLESS: true,
  DEFAULT_MAX_CONTACTS_PER_RUN: 10,
  ABSOLUTE_MAX_CONTACTS_PER_RUN: 20,
  MIN_ACTION_DELAY_SECONDS: 90,
  MAX_ACTION_DELAY_SECONDS: 240,
  MAX_CONSECUTIVE_ERRORS: 3,
  OPERATION_TIMEOUT_MS: 100,
  AUTOMATIC_MODE_ENABLED: false,
  EMERGENCY_STOP: false,
  MESSAGE_MAX_LENGTH: 900,
  LOG_LEVEL: 'silent',
} satisfies Config;

const service = {
  status: async () => ({ loggedIn: true }),
  open: async () => ({ success: true }),
  search: async () => ({ profiles: [] }),
  analyze: async () => ({ qualified: false }),
  message: vi.fn(async () => ({ success: true, status: 'sent', sentAt: 'now' })),
} as any;

const message = {
  profileUrl: 'https://www.instagram.com/example/',
  message: 'Olá',
  executionId: '550e8400-e29b-41d4-a716-446655440000',
};

describe('api', () => {
  it('keeps health public', async () => {
    expect((await request(createApp(config, service)).get('/health')).status).toBe(200);
  });

  it('serves a synthetic review demo without credentials or Instagram', async () => {
    const response = await request(createApp(config, service)).get('/review?demo=1');
    expect(response.status).toBe(200);
    expect(response.text).toContain('SYNTHETIC DEMO');
    expect(response.text).toContain('cafe_demo');
    expect(response.text).toContain('sending disabled');
  });

  it('requires bearer authentication', async () => {
    expect((await request(createApp(config, service)).get('/session/status')).status).toBe(401);
    expect(
      (
        await request(createApp(config, service))
          .get('/session/status')
          .set('Authorization', `Bearer ${config.BROWSER_WORKER_API_KEY}`)
      ).status,
    ).toBe(200);
  });

  it('never sends during dry-run', async () => {
    const response = await request(createApp(config, service))
      .post('/message/send')
      .set('Authorization', `Bearer ${config.BROWSER_WORKER_API_KEY}`)
      .send({ ...message, dryRun: true });
    expect(response.status).toBe(403);
  });

  it('blocks approval and automatic sends when not authorized', async () => {
    const app = createApp(config, service);
    const approval = await request(app)
      .post('/message/send')
      .set('Authorization', `Bearer ${config.BROWSER_WORKER_API_KEY}`)
      .send({ ...message, dryRun: false, mode: 'approval', approved: false });
    const automatic = await request(app)
      .post('/message/send')
      .set('Authorization', `Bearer ${config.BROWSER_WORKER_API_KEY}`)
      .send({ ...message, dryRun: false, mode: 'automatic' });
    expect(approval.status).toBe(403);
    expect(automatic.status).toBe(403);
  });

  it('reports duplicate messages without invoking the browser', async () => {
    const repository = { duplicateMessage: vi.fn(async () => true) } as any;
    const app = createApp(config, service, repository);
    const response = await request(app)
      .post('/message/prepare')
      .set('Authorization', `Bearer ${config.BROWSER_WORKER_API_KEY}`)
      .send({ ...message, dryRun: false, mode: 'approval' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('duplicate_message');
  });

  it('requires a matching token for explicit human approval', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const repository = {
      preparedMessage: vi.fn(async () => ({
        id,
        executionId: id,
        profileUrl: message.profileUrl,
        message: message.message,
      })),
      markSent: vi.fn(async () => undefined),
    } as any;
    const app = createApp(config, service, repository);
    const rejected = await request(app)
      .post('/message/approve')
      .set('Authorization', `Bearer ${config.BROWSER_WORKER_API_KEY}`)
      .send({
        outreachMessageId: id,
        approvalToken: 'b6e1d42d-97cb-463f-8970-e232347ecbf5',
        approved: true,
      });
    const approved = await request(app)
      .post('/message/approve')
      .set('Authorization', `Bearer ${config.BROWSER_WORKER_API_KEY}`)
      .send({ outreachMessageId: id, approvalToken: id, approved: true });
    expect(rejected.status).toBe(403);
    expect(approved.status).toBe(200);
    expect(repository.markSent).toHaveBeenCalledWith(id);
  });

  it('lists prepared messages and toggles the emergency stop at runtime', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const repository = {
      listPrepared: vi.fn(async () => [{ id, executionId: id, profileUrl: message.profileUrl, message: message.message }]),
      preparedMessage: vi.fn(async () => ({ id, executionId: id, profileUrl: message.profileUrl, message: message.message })),
      markSent: vi.fn(async () => undefined),
    } as any;
    const app = createApp(config, service, repository);
    const auth = { Authorization: `Bearer ${config.BROWSER_WORKER_API_KEY}` };

    const listed = await request(app).get('/messages/prepared').set(auth);
    expect(listed.status).toBe(200);
    expect(listed.body.messages).toHaveLength(1);

    const stopped = await request(app).post('/controls/emergency-stop').set(auth).send({ active: true });
    expect(stopped.body.emergencyStop).toBe(true);
    const blocked = await request(app)
      .post('/message/approve')
      .set(auth)
      .send({ outreachMessageId: id, approvalToken: id, approved: true });
    expect(blocked.status).toBe(403);
    expect(blocked.body.status).toBe('emergency_stop');

    const resumed = await request(app).post('/controls/emergency-stop').set(auth).send({ active: false });
    expect(resumed.body.emergencyStop).toBe(false);
  });
});
