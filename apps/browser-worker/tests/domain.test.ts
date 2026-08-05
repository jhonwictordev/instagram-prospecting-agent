import { describe, expect, it } from 'vitest';
import {
  dedupeProfiles,
  ErrorGuard,
  executionConfigSchema,
  isBlocked,
  renderMessage,
  sendingAllowed,
} from '../src/domain.js';

const profile = (username: string) => ({
  username,
  profileUrl: `https://www.instagram.com/${username}/`,
  displayName: '',
  biography: '',
  followersText: '',
  isPrivate: false,
});

describe('domain', () => {
  it('validates the contact ceiling, delays, and clock values', () => {
    const base = {
      niche: 'imóveis',
      location: 'Maceió',
      message: 'oi',
      maximumContacts: 10,
      minimumDelaySeconds: 90,
      maximumDelaySeconds: 240,
      allowedStart: '09:00',
      allowedEnd: '18:00',
    };
    expect(() => executionConfigSchema.parse({ ...base, maximumContacts: 21 })).toThrow();
    expect(() => executionConfigSchema.parse({ ...base, minimumDelaySeconds: 89 })).toThrow();
    expect(() => executionConfigSchema.parse({ ...base, allowedStart: '29:90' })).toThrow();
  });

  it('deduplicates usernames without case sensitivity', () => {
    expect(dedupeProfiles([profile('a'), profile('A')])).toHaveLength(1);
  });

  it('personalizes and naturally removes an unavailable greeting', () => {
    expect(
      renderMessage('Olá {{displayName}}, atuamos em {{niche}}.', {
        username: 'x',
        niche: 'varejo',
        location: 'SP',
      }),
    ).toBe('atuamos em varejo.');
  });

  it('checks the permanent blocklist', () => {
    expect(isBlocked(profile('x'), [{ username: 'X' }])).toBe(true);
  });

  it('stops at the configured consecutive-error ceiling', () => {
    const guard = new ErrorGuard(3);
    expect(guard.failure()).toBe(false);
    expect(guard.failure()).toBe(false);
    expect(guard.failure()).toBe(true);
    guard.success();
    expect(guard.count).toBe(0);
  });

  it('enforces dry-run, approval, automatic, and emergency-stop policies', () => {
    expect(
      sendingAllowed({
        dryRun: true,
        mode: 'automatic',
        automaticEnabled: true,
        emergencyStop: false,
      }),
    ).toBe(false);
    expect(
      sendingAllowed({
        dryRun: false,
        mode: 'approval',
        approved: false,
        automaticEnabled: false,
        emergencyStop: false,
      }),
    ).toBe(false);
    expect(
      sendingAllowed({
        dryRun: false,
        mode: 'approval',
        approved: true,
        automaticEnabled: false,
        emergencyStop: false,
      }),
    ).toBe(true);
    expect(
      sendingAllowed({
        dryRun: false,
        mode: 'automatic',
        automaticEnabled: true,
        emergencyStop: true,
      }),
    ).toBe(false);
  });
});
