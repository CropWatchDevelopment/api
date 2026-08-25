import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

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
  private readonly logger = new Logger(AccountRemovalService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

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
    const transporter = this.getTransporter();
    const from =
      this.configService.get<string>('SMTP_FROM') ??
      this.configService.get<string>('SMTP_USER');
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

    try {
      await transporter.sendMail({
        from,
        to: REQUEST_RECIPIENTS,
        subject: `Account removal request: ${email}`,
        text: lines.join('\n'),
      });
    } catch (error) {
      this.logger.error(`Failed to send account removal request email`, error);
      throw new ServiceUnavailableException(
        'Could not deliver the request — please try again later',
      );
    }
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

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const host = this.configService.get<string>('SMTP_HOST');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    if (!host || !user || !pass) {
      throw new ServiceUnavailableException('Email delivery is not configured');
    }
    const port = Number(this.configService.get<string>('SMTP_PORT') ?? '465');

    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    return this.transporter;
  }
}
