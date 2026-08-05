import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright-core';
import type { BrowserManager } from '../browser/manager.js';
import type { Profile, QualificationStatus } from '../domain.js';
import { dedupeProfiles } from '../domain.js';
import { instagramUrl, sanitizeText } from '../security/sanitize.js';
import { selectors } from './selectors.js';

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

async function firstText(page: Page, alternatives: readonly string[]) {
  for (const selector of alternatives) {
    const value = await page
      .locator(selector)
      .first()
      .textContent()
      .catch(() => null);
    if (value?.trim()) return sanitizeText(value);
  }
  return '';
}

async function anyVisible(page: Page, alternatives: readonly string[]) {
  for (const selector of alternatives) {
    if (
      await page
        .locator(selector)
        .first()
        .isVisible()
        .catch(() => false)
    )
      return true;
  }
  return false;
}

async function clickMessageButton(page: Page) {
  const candidate = page.getByText(/^(Enviar mensagem|Mensagem|Message)$/).first();
  const visible = await candidate
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return false;
  await candidate.click();
  return true;
}

async function waitForProfileReady(page: Page, profileUrl: string) {
  const username = new URL(profileUrl).pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  if (!username) throw new Error('PROFILE_USERNAME_NOT_FOUND');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ready = await page
      .waitForFunction(
        (expectedUsername) => {
          const body = (document.body?.innerText ?? '').toLowerCase();
          return (
            body.includes(expectedUsername) ||
            /esta p.gina n.o est. dispon.vel|this page isn.t available|sorry, this page isn.t available/i.test(
              body,
            )
          );
        },
        username,
        { timeout: 12_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (ready) return;
    if (attempt === 0) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
    }
  }

  throw new Error('PROFILE_PAGE_NOT_READY');
}

export class InstagramService {
  private messageInFlight = false;

  constructor(private readonly browser: BrowserManager) {}

  private async guard(page: Page) {
    if (await this.browser.intervention(page)) {
      return {
        success: false as const,
        status: 'platform_intervention_required' as const,
        reason: 'Instagram requested manual intervention',
      };
    }
    return null;
  }

  async status() {
    const page = await this.browser.goto('https://www.instagram.com/');
    const intervention = await this.guard(page);
    if (intervention) {
      return {
        ...intervention,
        loggedIn: false,
        challengeDetected: true,
        currentUrl: page.url(),
      };
    }

    let loggedIn = false;
    for (const selector of selectors.loggedIn) {
      loggedIn ||= await page
        .locator(selector)
        .first()
        .isVisible()
        .catch(() => false);
    }
    return { loggedIn, challengeDetected: false, currentUrl: page.url() };
  }

  async open() {
    const page = await this.browser.goto('https://www.instagram.com/');
    const intervention = await this.guard(page);
    return intervention ?? { success: true, status: 'opened', currentUrl: page.url() };
  }

  async search(query: string, maximum: number) {
    const page = await this.browser.goto(
      `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}`,
    );
    const intervention = await this.guard(page);
    if (intervention) return intervention;

    await page.waitForTimeout(1500);
    const links = await page
      .locator(selectors.searchResults[0])
      .evaluateAll((elements: Element[]) =>
        elements.map((element) => {
          const anchor = element as HTMLAnchorElement;
          return { href: anchor.href, text: anchor.textContent ?? '' };
        }),
      );
    const profiles: Profile[] = links
      .filter((item) => /^https:\/\/www\.instagram\.com\/[\w.]+\/?$/.test(item.href))
      .map((item) => ({
        username: new URL(item.href).pathname.split('/')[1] ?? '',
        profileUrl: item.href,
        displayName: sanitizeText(item.text),
        biography: '',
        followersText: '',
        isPrivate: false,
      }));
    return { profiles: dedupeProfiles(profiles).slice(0, maximum) };
  }

  async analyze(input: {
    profileUrl: string;
    niche: string;
    location: string;
    requiredKeywords: string[];
    excludedKeywords: string[];
  }) {
    const page = await this.browser.goto(instagramUrl(input.profileUrl));
    const intervention = await this.guard(page);
    if (intervention) return intervention;

    const displayName = await firstText(page, selectors.profile.name);
    const biography = await firstText(page, selectors.profile.bio);
    const followersText = await firstText(page, selectors.profile.followers);
    const body = normalize(`${displayName} ${biography}`);
    const niche = normalize(input.niche);
    const location = normalize(input.location);
    const excluded = input.excludedKeywords.some((keyword) => body.includes(normalize(keyword)));
    const keywordMatch = input.requiredKeywords.some((keyword) =>
      body.includes(normalize(keyword)),
    );
    const commercialSignal = /contato|whatsapp|email|loja|empresa|servico|orcamento|agenda/.test(
      body,
    );
    const personalSignal = /blog pessoal|personal blog|minha vida|perfil pessoal/.test(body);
    const isPrivate = await page
      .locator(selectors.profile.private.join(','))
      .first()
      .isVisible()
      .catch(() => false);
    const hasRecentPosts = await page
      .locator(selectors.profile.posts.join(','))
      .first()
      .isVisible()
      .catch(() => false);

    let score = 0;
    const reasons: string[] = [];
    if (body.includes(niche)) {
      score += 35;
      reasons.push('niche');
    }
    if (location && body.includes(location)) {
      score += 20;
      reasons.push('location');
    }
    if (keywordMatch) {
      score += 15;
      reasons.push('keyword');
    }
    if (hasRecentPosts) {
      score += 15;
      reasons.push('recent_posts');
    }
    if (commercialSignal) {
      score += 15;
      reasons.push('commercial_information');
    }
    if (excluded) score = 0;

    let qualificationStatus: QualificationStatus = 'not_qualified';
    if (isPrivate) qualificationStatus = 'private';
    else if (!hasRecentPosts) qualificationStatus = 'inactive';
    else if (personalSignal && !commercialSignal) qualificationStatus = 'personal_profile';
    else if (!excluded && score >= 50) qualificationStatus = 'qualified';

    const username = new URL(page.url()).pathname.split('/')[1] ?? '';
    return {
      qualified: qualificationStatus === 'qualified',
      qualificationStatus,
      score,
      reason: excluded ? 'excluded keyword' : reasons.join(', ') || 'insufficient signals',
      profile: {
        username,
        displayName,
        biography,
        profileUrl: page.url(),
        followersText,
        isPrivate,
        hasRecentPosts,
        detectedLocation: location && body.includes(location) ? input.location : '',
        detectedCategory: body.includes(niche) ? input.niche : '',
      },
    };
  }

  async message(input: { profileUrl: string; message: string; send: boolean }) {
    if (this.messageInFlight) throw new Error('MESSAGE_OPERATION_IN_PROGRESS');
    this.messageInFlight = true;
    try {
      return await this.messageUnlocked(input);
    } finally {
      this.messageInFlight = false;
    }
  }

  private async messageUnlocked(input: { profileUrl: string; message: string; send: boolean }) {
    const page = await this.browser.goto(instagramUrl(input.profileUrl));
    await waitForProfileReady(page, input.profileUrl);
    const intervention = await this.guard(page);
    if (intervention) return intervention;

    if (await anyVisible(page, selectors.profileUnavailable)) {
      return {
        success: false as const,
        status: 'profile_unavailable' as const,
        sentAt: null,
        profileUrl: input.profileUrl,
      };
    }

    try {
      if (!(await clickMessageButton(page))) {
        return {
          success: false as const,
          status: 'message_unavailable' as const,
          sentAt: null,
          profileUrl: input.profileUrl,
        };
      }
      const message = sanitizeText(input.message, 900);
      const composer = page.locator(selectors.composer.join(',')).first();
      await composer.waitFor({ state: 'visible' });

      if (await anyVisible(page, selectors.recipientNotAcceptingMessages)) {
        return {
          success: false as const,
          status: 'recipient_not_accepting_messages' as const,
          sentAt: null,
          profileUrl: input.profileUrl,
        };
      }

      const normalizedMessage = message.replace(/\s+/g, ' ').trim();

      const existingMessages = await page
        .locator(selectors.existingMessage.join(','))
        .evaluateAll((elements: Element[]) =>
          elements.map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim()),
        )
        .catch(() => [] as string[]);
      if (existingMessages.some((existing) => existing === normalizedMessage)) {
        return {
          success: false as const,
          status: 'duplicate_message' as const,
          sentAt: null,
          profileUrl: input.profileUrl,
        };
      }

      await composer.fill(message);
      if (input.send) {
        await composer.press('Enter');
        await page.waitForFunction(
          (expectedMessage) =>
            [...document.querySelectorAll('div[dir="auto"]')].some(
              (element) =>
                (element.textContent ?? '').replace(/\s+/g, ' ').trim() === expectedMessage,
            ),
          normalizedMessage,
        );
        await page.waitForTimeout(6000);
        if (await anyVisible(page, selectors.recipientNotAcceptingMessages)) {
          return {
            success: false as const,
            status: 'recipient_not_accepting_messages' as const,
            sentAt: null,
            profileUrl: input.profileUrl,
          };
        }

        await mkdir('storage/diagnostics', { recursive: true });
        await page
          .screenshot({
            path: path.join('storage/diagnostics', `sent-confirmed-${Date.now()}.png`),
          })
          .catch(() => undefined);
      }
      return {
        success: true as const,
        status: input.send ? ('sent' as const) : ('prepared' as const),
        sentAt: input.send ? new Date().toISOString() : null,
        profileUrl: input.profileUrl,
      };
    } catch (error) {
      await mkdir('storage/diagnostics', { recursive: true });
      await page
        .screenshot({
          path: path.join('storage/diagnostics', `selector-${Date.now()}.png`),
          mask: [page.locator(selectors.composer.join(','))],
        })
        .catch(() => undefined);
      throw error;
    }
  }

  async inspectMessageUi(profileUrl: string) {
    const page = await this.browser.goto(instagramUrl(profileUrl));
    await waitForProfileReady(page, profileUrl);
    const intervention = await this.guard(page);
    if (intervention) return intervention;

    if (!(await clickMessageButton(page))) {
      return { success: false as const, status: 'message_unavailable' as const, url: page.url() };
    }
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.waitForTimeout(3000);

    const fields = await page
      .locator('input, textarea, [contenteditable="true"], [role="textbox"]')
      .evaluateAll((elements: Element[]) =>
        elements.map((element) => {
          const htmlElement = element as HTMLElement;
          const rect = htmlElement.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute('role'),
            ariaLabel: element.getAttribute('aria-label'),
            placeholder: element.getAttribute('placeholder'),
            contenteditable: element.getAttribute('contenteditable'),
            visible: rect.width > 0 && rect.height > 0,
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }),
      );
    const buttons = await page
      .locator('button, [role="button"]')
      .evaluateAll((elements: Element[]) =>
        elements
          .map((element) => {
            const htmlElement = element as HTMLElement;
            const rect = htmlElement.getBoundingClientRect();
            return {
              text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
              ariaLabel: element.getAttribute('aria-label'),
              visible: rect.width > 0 && rect.height > 0,
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          })
          .filter((button) => button.visible),
      );

    await mkdir('storage/diagnostics', { recursive: true });
    const screenshotPath = path.join('storage/diagnostics', `message-ui-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath }).catch(() => undefined);
    return { success: true as const, url: page.url(), fields, buttons, screenshotPath };
  }
}
