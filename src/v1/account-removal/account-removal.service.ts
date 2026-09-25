import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../common/mail/mail.service';

export interface AccountRemovalChallenge {
  question: string;
  token: string;
}

// Deliberately hardcoded: removal requests are read and actioned by these two
// humans, not by configuration. Change requires a code change on purpose.
const REQUEST_RECIPIENTS = ['kevin@cropwatch.io', 'sayaka@cropwatch.io'];

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
// Context string keeps the derived HMAC key distinct from every other use of
// the shared secret.
const CHALLENGE_KEY_CONTEXT = 'account-removal-challenge-v1';

/**
 * Public "request account removal" flow: a stateless server-issued math
 * challenge (HMAC over the expected answer + expiry — nothing stored), and an
 * email to the operators once the challenge verifies. There is no account
 * mutation here by design: removal itself stays a human action.
 */
@Injectable()
export class AccountRemovalService {
  constructor(
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  createChallenge(): AccountRemovalChallenge {
    const a = randomInt(2, 21);
    const b = randomInt(2, 21);
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    const signature = this.signAnswer(a + b, expiresAt);
    return {
      question: `${a} + ${b}`,
      token: `${expiresAt}.${signature}`,
    };
  }

  /** Throws BadRequestException unless the answer matches an unexpired token. */
  verifyChallenge(answer: number, token: string): void {
    const [expiresAtRaw, signature] = token.split('.');
    const expiresAt = Number(expiresAtRaw);
    if (
      !Number.isFinite(expiresAt) ||
      typeof signature !== 'string' ||
      signature.length === 0
    ) {
      throw new BadRequestException('Invalid challenge token');
    }
    if (Date.now() > expiresAt) {
      throw new BadRequestException('Challenge expired — request a new one');
    }
    if (!Number.isInteger(answer)) {
      throw new BadRequestException('Incorrect answer');
    }

    const expected = Buffer.from(this.signAnswer(answer, expiresAt), 'hex');
    const provided = Buffer.from(signature, 'hex');
    if (
      expected.length === 0 ||
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      throw new BadRequestException('Incorrect answer');
    }
  }

  async sendRemovalRequest(email: string, message?: string): Promise<void> {
    const now = new Date();

    const lines = [
      'An account removal request was submitted from the public form.',
      '',
      `Account email: ${email}`,
      `Submitted at:  ${now.toISOString()} (UTC)`,
    ];
    if (message && message.trim().length > 0) {
      lines.push('', 'Message from the requester:', message.trim());
    }
    lines.push(
      '',
      'This request only notifies you — no account data has been changed.',
    );

    await this.mailService.send({
      to: REQUEST_RECIPIENTS,
      subject: `Account removal request: ${email}`,
      text: lines.join('\n'),
    });
  }

  private signAnswer(answer: number, expiresAt: number): string {
    const secret = this.configService.get<string>(
      'PRIVATE_SUPABASE_JWT_SECRET',
    );
    // Fail closed like LineService does on a missing webhook secret.
    if (!secret) {
      throw new ServiceUnavailableException(
        'Account removal challenges are not configured',
      );
    }
    return createHmac('sha256', `${CHALLENGE_KEY_CONTEXT}:${secret}`)
      .update(`${answer}:${expiresAt}`)
      .digest('hex');
  }
}
