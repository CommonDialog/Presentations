import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt from the stdlib: no native-dependency build issues, OWASP-acceptable
// parameters (N=2^15, r=8, p=1). Format: scrypt:N:r:p:salt:key (base64url).
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 32;

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { N: n, r, p, maxmem: 128 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, N, R, P);
  return `scrypt:${N}:${R}:${P}:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64!, 'base64url');
  const expected = Buffer.from(keyB64!, 'base64url');
  const key = await scryptAsync(password, salt, Number(nStr), Number(rStr), Number(pStr));
  return key.length === expected.length && timingSafeEqual(key, expected);
}
