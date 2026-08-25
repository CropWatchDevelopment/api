import { createHash } from 'crypto';
import type { Request } from 'express';
import { UserThrottlerGuard } from './user-throttler.guard';

type Trackable = { getTracker(req: Request): Promise<string> };

// getTracker reads only the request (no `this`/DI), so bypass the
// ThrottlerGuard constructor and call the method directly.
const guard = Object.create(UserThrottlerGuard.prototype) as UserThrottlerGuard;
const track = (req: Partial<Request>): Promise<string> =>
  (guard as unknown as Trackable).getTracker(req as Request);

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('UserThrottlerGuard.getTracker', () => {
  it('keys a bearer request on the sha256 of the token', async () => {
    const req = {
      headers: { authorization: 'Bearer abc.def.ghi' },
      ip: '9.9.9.9',
    };
    await expect(track(req)).resolves.toBe(`user:${sha256('abc.def.ghi')}`);
  });

  it('gives identical tokens the same key and different tokens different keys', async () => {
    const a1 = await track({ headers: { authorization: 'Bearer tok-a' } });
    const a2 = await track({ headers: { authorization: 'Bearer tok-a' } });
    const b = await track({ headers: { authorization: 'Bearer tok-b' } });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it('is case-insensitive on the Bearer scheme and trims whitespace', async () => {
    await expect(
      track({ headers: { authorization: '  bearer   tok-a' } }),
    ).resolves.toBe(`user:${sha256('tok-a')}`);
  });

  it('falls back to the client IP when there is no bearer token', async () => {
    await expect(track({ headers: {}, ip: '203.0.113.7' })).resolves.toBe(
      'ip:203.0.113.7',
    );
  });

  it('falls back to the client IP for a non-Bearer Authorization header', async () => {
    await expect(
      track({ headers: { authorization: 'Basic Zm9v' }, ip: '203.0.113.7' }),
    ).resolves.toBe('ip:203.0.113.7');
  });

  it('returns a stable placeholder when neither token nor IP is present', async () => {
    await expect(track({ headers: {} })).resolves.toBe('ip:unknown');
  });
});
