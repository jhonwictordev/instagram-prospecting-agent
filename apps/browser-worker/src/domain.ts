import { z } from 'zod';

const clockTime = /^([01]\d|2[0-3]):[0-5]\d$/;

export const executionConfigSchema = z
  .object({
    niche: z.string().trim().min(2).max(100),
    location: z.string().trim().min(2).max(100),
    state: z.string().trim().max(100).optional(),
    additionalTerms: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
    message: z.string().trim().min(1).max(900),
    maximumContacts: z.number().int().min(1).max(20),
    minimumDelaySeconds: z.number().int().min(90),
    maximumDelaySeconds: z.number().int().min(90).max(3600),
    executionMode: z.enum(['approval', 'automatic']).default('approval'),
    dryRun: z.boolean().default(true),
    allowedStart: z.string().regex(clockTime),
    allowedEnd: z.string().regex(clockTime),
    excludedKeywords: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
    ignoredProfiles: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  })
  .refine((value) => value.minimumDelaySeconds <= value.maximumDelaySeconds, {
    message: 'minimum delay exceeds maximum',
  });

export type Profile = {
  username: string;
  profileUrl: string;
  displayName: string;
  biography: string;
  followersText: string;
  isPrivate: boolean;
};

export type QualificationStatus =
  | 'qualified'
  | 'not_qualified'
  | 'already_contacted'
  | 'private'
  | 'inactive'
  | 'personal_profile'
  | 'error';

export const dedupeProfiles = (items: Profile[]) => [
  ...new Map(items.map((profile) => [profile.username.toLowerCase(), profile])).values(),
];

export function renderMessage(
  template: string,
  data: { displayName?: string; username: string; niche: string; location: string },
  max = 900,
) {
  let output = template
    .replace(/{{displayName}}/g, data.displayName?.trim() || '')
    .replace(/{{username}}/g, data.username)
    .replace(/{{niche}}/g, data.niche)
    .replace(/{{location}}/g, data.location)
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (!data.displayName) output = output.replace(/^(olá|oi)[, ]*[.!-]?\s*/i, '');
  if (!output) throw new Error('Message cannot be empty');
  return output.slice(0, max).trim();
}

export const isBlocked = (
  profile: Pick<Profile, 'username' | 'profileUrl'>,
  list: Array<{ username?: string; profileUrl?: string }>,
) =>
  list.some(
    (item) =>
      item.username?.toLowerCase() === profile.username.toLowerCase() ||
      item.profileUrl === profile.profileUrl,
  );

export class ErrorGuard {
  count = 0;

  constructor(private readonly max = 3) {}

  success() {
    this.count = 0;
  }

  failure() {
    this.count += 1;
    return this.count >= this.max;
  }
}

export function sendingAllowed(input: {
  dryRun: boolean;
  mode: 'approval' | 'automatic';
  approved?: boolean;
  automaticEnabled: boolean;
  emergencyStop: boolean;
}) {
  if (input.emergencyStop || input.dryRun) return false;
  if (input.mode === 'approval') return input.approved === true;
  return input.automaticEnabled;
}
