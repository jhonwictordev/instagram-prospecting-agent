export function sanitizeText(value: string, max = 1000) {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
export function instagramUrl(value: string) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(u.hostname))
    throw new Error('Invalid Instagram URL');
  u.search = '';
  u.hash = '';
  return u.toString();
}
export function redact(value: unknown) {
  const s = JSON.stringify(value);
  return s.replace(/("?(authorization|cookie|token|password)"?\s*:\s*")[^"]+/gi, '$1[REDACTED]');
}
