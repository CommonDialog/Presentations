import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password.js';

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashPassword('hunter2-but-longer');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(await verifyPassword('hunter2-but-longer', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('hunter2-but-longer');
    expect(await verifyPassword('hunter2-but-wrong', hash)).toBe(false);
  });

  it('produces unique salts', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt:whatever')).toBe(false);
  });
});
