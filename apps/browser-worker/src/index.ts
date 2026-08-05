import { loadConfig } from './config/env.js';
import { BrowserManager } from './browser/manager.js';
import { InstagramService } from './instagram/service.js';
import { Repository } from './database/repository.js';
import { createApp } from './api/app.js';
const c = loadConfig(),
  browser = new BrowserManager(c),
  repo = new Repository(c.DATABASE_URL),
  app = createApp(c, new InstagramService(browser), repo),
  server = app.listen(c.PORT, '0.0.0.0', () =>
    console.log(`browser-worker listening on ${c.PORT}`),
  );
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  await Promise.allSettled([browser.close(), repo.close()]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
