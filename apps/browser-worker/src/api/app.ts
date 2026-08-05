import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import type { Config } from '../config/env.js';
import type { Repository } from '../database/repository.js';
import { sendingAllowed } from '../domain.js';
import type { InstagramService } from '../instagram/service.js';
import { analyzeSchema, approvalSchema, messageSchema, searchSchema } from './schemas.js';

const asyncRoute =
  (handler: (request: Request, response: Response) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) =>
    void handler(request, response).catch(next);

export function createApp(config: Config, instagram: InstagramService, repository?: Repository) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet(),
    cors({ origin: config.ALLOWED_ORIGIN, methods: ['GET', 'POST'] }),
    express.json({ limit: '32kb' }),
    rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }),
    pinoHttp({
      logger: pino({ level: config.LOG_LEVEL }),
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
    }),
  );

  app.get('/health', (_request, response) =>
    response.json({ status: 'ok', service: 'browser-worker', timestamp: new Date().toISOString() }),
  );

  app.use((request, response, next) => {
    const authorization = request.header('authorization');
    if (!authorization || authorization !== `Bearer ${config.BROWSER_WORKER_API_KEY}`) {
      return response.status(401).json({ error: 'UNAUTHORIZED' });
    }
    next();
  });

  app.get(
    '/session/status',
    asyncRoute(async (_request, response) => response.json(await instagram.status())),
  );
  app.post(
    '/diagnostics/message-ui',
    asyncRoute(async (request, response) => {
      const input = messageSchema.pick({ profileUrl: true }).parse(request.body);
      response.json(await instagram.inspectMessageUi(input.profileUrl));
    }),
  );
  app.post(
    '/session/open',
    asyncRoute(async (_request, response) => response.json(await instagram.open())),
  );
  app.post(
    '/search',
    asyncRoute(async (request, response) => {
      const input = searchSchema.parse(request.body);
      response.json(
        await instagram.search(
          input.query,
          Math.min(input.maximumProfiles, config.ABSOLUTE_MAX_CONTACTS_PER_RUN),
        ),
      );
    }),
  );
  app.post(
    '/profile/analyze',
    asyncRoute(async (request, response) =>
      response.json(await instagram.analyze(analyzeSchema.parse(request.body))),
    ),
  );
  app.post(
    '/message/prepare',
    asyncRoute(async (request, response) => {
      const input = messageSchema.parse(request.body);
      if (await repository?.duplicateMessage(input.profileUrl, input.message)) {
        return response.json({ success: false, status: 'duplicate_message' });
      }
      response.json(await instagram.message({ ...input, send: false }));
    }),
  );
  app.post(
    '/message/send',
    asyncRoute(async (request, response) => {
      const input = messageSchema.parse(request.body);
      if (
        !sendingAllowed({
          dryRun: input.dryRun,
          mode: input.mode,
          approved: input.approved,
          automaticEnabled: config.AUTOMATIC_MODE_ENABLED,
          emergencyStop: config.EMERGENCY_STOP,
        })
      ) {
        return response
          .status(403)
          .json({ success: false, status: input.dryRun ? 'dry_run' : 'sending_not_authorized' });
      }
      if (await repository?.duplicateMessage(input.profileUrl, input.message)) {
        return response.json({ success: false, status: 'duplicate_message' });
      }
      response.json(await instagram.message({ ...input, send: true }));
    }),
  );
  app.post(
    '/message/approve',
    asyncRoute(async (request, response) => {
      const input = approvalSchema.parse(request.body);
      if (config.EMERGENCY_STOP) {
        return response.status(403).json({ success: false, status: 'emergency_stop' });
      }
      if (!repository) {
        return response.status(503).json({ success: false, status: 'database_unavailable' });
      }
      if (input.approvalToken !== input.outreachMessageId) {
        return response.status(403).json({ success: false, status: 'invalid_approval_token' });
      }

      const prepared = await repository.preparedMessage(input.outreachMessageId);
      if (!prepared) {
        return response.status(404).json({ success: false, status: 'prepared_message_not_found' });
      }
      const result = await instagram.message({
        profileUrl: prepared.profileUrl,
        message: prepared.message,
        send: true,
      });
      if (result.success && result.status === 'sent') await repository.markSent(prepared.id);
      response.json({ ...result, outreachMessageId: prepared.id });
    }),
  );

  app.use((error: any, request: Request, response: Response, _next: NextFunction) => {
    const validation = error?.name === 'ZodError';
    request.log.error({ err: error }, 'request failed');
    response.status(validation ? 400 : 500).json({
      error: validation ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
      details: validation ? error.issues : undefined,
    });
  });
  return app;
}
