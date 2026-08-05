import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { Config } from '../config/env.js';
import { selectors } from '../instagram/selectors.js';
const windowsPaths = [
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
];
export class BrowserManager {
  private context?: BrowserContext;
  constructor(private c: Config) {}
  private executable() {
    const p = this.c.BRAVE_EXECUTABLE_PATH || windowsPaths.find(existsSync);
    if (!p) throw new Error('Brave not found; configure BRAVE_EXECUTABLE_PATH');
    return p;
  }
  private async launch() {
    this.context = await chromium.launchPersistentContext(
      path.resolve(this.c.BRAVE_USER_DATA_DIR),
      { executablePath: this.executable(), headless: this.c.HEADLESS },
    );
    this.context.setDefaultTimeout(this.c.OPERATION_TIMEOUT_MS);
    return this.context;
  }
  async page() {
    const context = this.context ?? (await this.launch());
    return (
      context
        .pages()
        .filter((p) => !p.isClosed())
        .at(-1) || (await context.newPage())
    );
  }
  async goto(url: string) {
    let lastError: unknown;
    const attemptTimeout = Math.max(5000, Math.floor(this.c.OPERATION_TIMEOUT_MS / 2));
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const p = await this.page();
        await p.goto(url, { waitUntil: 'commit', timeout: attemptTimeout });
        await p.waitForLoadState('domcontentloaded', { timeout: attemptTimeout }).catch(() => {});
        return p;
      } catch (error) {
        lastError = error;
        await this.close().catch(() => {});
      }
    }
    throw lastError;
  }
  async intervention(p: Page) {
    for (const s of selectors.challenge)
      if (
        await p
          .locator(s)
          .first()
          .isVisible()
          .catch(() => false)
      )
        return true;
    return /challenge|checkpoint/.test(p.url());
  }
  async close() {
    const context = this.context;
    this.context = undefined;
    await context?.close();
  }
}
