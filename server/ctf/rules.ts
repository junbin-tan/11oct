import type { Position } from './types.js';

export const CTF = Object.freeze({ boundary: 100, captureRadius: 15, checkpointLimit: 85,
  spacing: 30, flagCount: 3, captureMs: 60_000, freshMs: 10_000,
  accuracy: 15, uploadMs: 5_000, durationMs: 30 * 60_000, retentionMs: 24 * 60 * 60_000 });

export function distance(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad)
    * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class CtfError extends Error {
  constructor(public code: string, message: string, public statusCode = 400) { super(message); }
}
export function requireCondition(value: unknown, code: string, message: string, status = 400): asserts value {
  if (!value) throw new CtfError(code, message, status);
}
export function position(value: unknown): Position {
  const v = value as Partial<Position> | null;
  requireCondition(v && typeof v.lat === 'number' && Number.isFinite(v.lat) && Math.abs(v.lat) <= 90
    && typeof v.lng === 'number' && Number.isFinite(v.lng) && Math.abs(v.lng) <= 180, 'INVALID_INPUT', 'Invalid coordinates.');
  return { lat: v.lat, lng: v.lng };
}
export function displayName(value: unknown, max = 24): string {
  requireCondition(typeof value === 'string', 'INVALID_INPUT', 'Enter a name.');
  const name = value.trim().replace(/\s+/g, ' ');
  requireCondition(name.length > 0 && name.length <= max, 'INVALID_INPUT', `Use 1–${max} characters for the name.`);
  return name;
}
