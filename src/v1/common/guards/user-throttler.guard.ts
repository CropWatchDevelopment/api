import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Rate-limit tracker keyed per authenticated user instead of per IP.
 *
 * Why: the web app renders server-side on Vercel, so *every* user's SSR
 * requests egress from a small shared pool of Vercel IPs. A per-IP limit tight
 * enough to catch abuse would throttle the whole app's SSR for everyone. Keying
 * on the bearer token gives each user their own bucket, isolated from other
 * users' traffic and from the shared egress IP.
 *
 * We key on a hash of the raw token (not the decoded `sub`) so that:
 *  - an attacker cannot burn a victim's bucket by forging a token carrying the
 *    victim's `sub` — they would need the victim's actual signed token, which
 *    the guard never sees; and
 *  - the token is never stored as a plaintext key in the throttler store.
 *
 * Requests without a bearer token (the landing page; webhooks, which are
 * `@SkipThrottle`-d; login, which has its own tighter `@Throttle`) fall back to
 * the client IP — now authentic because `trust proxy` is pinned to a single hop
 * in main.ts, so `req.ip` is the address Vercel appended rather than a spoofable
 * left-most X-Forwarded-For entry.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Request): Promise<string> {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string') {
      const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
      if (match) {
        const digest = createHash('sha256').update(match[1]).digest('hex');
        return Promise.resolve(`user:${digest}`);
      }
    }
    const ip = req.ip;
    return Promise.resolve(
      typeof ip === 'string' && ip.length > 0 ? `ip:${ip}` : 'ip:unknown',
    );
  }
}
