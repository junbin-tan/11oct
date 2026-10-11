import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

export function randomToken(): string {
  return randomBytes(18).toString('base64url');
}

export const newId = randomUUID;
