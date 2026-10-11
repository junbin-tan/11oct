import type { IncomingHttpHeaders } from 'node:http';

function singleIp(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  if (!ip || ip.includes(',') || ip.length > 64) return null;
  const parts = ip.split('.');
  if (parts.length === 4) {
    const ok = parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
    return ok ? ip : null;
  }
  return /^[0-9a-f:]+$/i.test(ip) ? ip : null;
}

/**
 * Railway's public edge overwrites X-Real-IP, so a caller cannot choose it.
 * When that header is absent, Fastify's trusted-proxy resolution supplies the
 * address and ignores earlier, caller-supplied X-Forwarded-For entries.
 */
export function clientAddress(headers: IncomingHttpHeaders, fallback: string): string {
  return singleIp(headers['x-real-ip']) ?? fallback;
}

/**
 * Trust only the nearest private or loopback peer. Public clients cannot
 * supply an earlier X-Forwarded-For entry that replaces the address appended
 * by the platform proxy. The app must stay reachable only through that proxy.
 */
export function trustNearestProxy(address: string, hop: number): boolean {
  if (hop !== 0) return false;
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const a = parts[0]!;
  const b = parts[1]!;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
