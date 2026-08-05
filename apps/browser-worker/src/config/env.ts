import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: process.env.ENV_FILE ?? path.resolve(moduleDir, '../../../../.env') });
const bool = z
  .string()
  .default('false')
  .transform((v) => v.toLowerCase() === 'true');
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  BROWSER_WORKER_API_KEY: z.string().min(16),
  DATABASE_URL: z
    .string()
    .default('postgresql://prospecting:change-me@localhost:5432/instagram_prospecting'),
  ALLOWED_ORIGIN: z.string().default('http://localhost:5678'),
  BRAVE_EXECUTABLE_PATH: z.string().optional(),
  BRAVE_USER_DATA_DIR: z.string().default('./storage/browser-profile'),
  HEADLESS: bool,
  DEFAULT_MAX_CONTACTS_PER_RUN: z.coerce.number().int().min(1).default(10),
  ABSOLUTE_MAX_CONTACTS_PER_RUN: z.coerce.number().int().min(1).max(100).default(20),
  MIN_ACTION_DELAY_SECONDS: z.coerce.number().int().min(1).default(90),
  MAX_ACTION_DELAY_SECONDS: z.coerce.number().int().min(1).default(240),
  MAX_CONSECUTIVE_ERRORS: z.coerce.number().int().min(1).default(3),
  OPERATION_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  AUTOMATIC_MODE_ENABLED: bool,
  EMERGENCY_STOP: bool,
  MESSAGE_MAX_LENGTH: z.coerce.number().int().min(1).max(1000).default(900),
  LOG_LEVEL: z.string().default('info'),
});
export type Config = z.infer<typeof schema>;
export const loadConfig = (input: NodeJS.ProcessEnv = process.env): Config => {
  const c = schema.parse(input);
  if (c.MIN_ACTION_DELAY_SECONDS > c.MAX_ACTION_DELAY_SECONDS)
    throw new Error('MIN_ACTION_DELAY_SECONDS must be <= MAX_ACTION_DELAY_SECONDS');
  return c;
};
