import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string | string[];
  subject: string;
  text: string;
}

/**
 * The one SMTP sender (extracted from account-removal.service.ts, plan
 * section 6.2). Lazily builds a single nodemailer transporter from the
 * SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS env vars; `from` comes from
 * SMTP_FROM (falling back to SMTP_USER). Fails closed with a 503 when mail
 * is not configured, and never leaks transport errors to the client.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const transporter = this.getTransporter();
    const from =
      this.configService.get<string>('SMTP_FROM') ??
      this.configService.get<string>('SMTP_USER');

    try {
      await transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch (error) {
      this.logger.error(`Failed to send email: ${message.subject}`, error);
      throw new ServiceUnavailableException(
        'Could not deliver the email — please try again later',
      );
    }
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
