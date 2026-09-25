import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AccountRemovalService } from './account-removal.service';
import type { MailService } from '../common/mail/mail.service';

// The shared MailService owns the transport now; the service under test only
// composes the message and delegates.
const sendMailMock = jest.fn((_mail: unknown) => Promise.resolve());

function buildService(
  overrides: Record<string, string | undefined> = {},
): AccountRemovalService {
  const values: Record<string, string | undefined> = {
    PRIVATE_SUPABASE_JWT_SECRET: 'test-secret',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_USER: 'noreply@example.com',
    SMTP_PASS: 'hunter2',
    ...overrides,
  };
  const configService = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return new AccountRemovalService(configService, {
    send: sendMailMock,
  } as unknown as MailService);
}

describe('AccountRemovalService', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue(undefined);
  });

  describe('challenge', () => {
    it('issues a solvable challenge that verifies with the correct answer', () => {
      const service = buildService();
      const challenge = service.createChallenge();

      const [a, b] = challenge.question.split(' + ').map(Number);
      expect(Number.isInteger(a)).toBe(true);
      expect(Number.isInteger(b)).toBe(true);

      expect(() =>
        service.verifyChallenge(a + b, challenge.token),
      ).not.toThrow();
    });

    it('rejects a wrong answer', () => {
      const service = buildService();
      const challenge = service.createChallenge();
      const [a, b] = challenge.question.split(' + ').map(Number);

      expect(() => service.verifyChallenge(a + b + 1, challenge.token)).toThrow(
        BadRequestException,
      );
    });

    it('rejects an expired token', () => {
      const service = buildService();
      const challenge = service.createChallenge();
      const [a, b] = challenge.question.split(' + ').map(Number);
      const [, signature] = challenge.token.split('.');
      const expiredToken = `${Date.now() - 1000}.${signature}`;

      expect(() => service.verifyChallenge(a + b, expiredToken)).toThrow(
        /expired/i,
      );
    });

    it('rejects a malformed token', () => {
      const service = buildService();
      expect(() => service.verifyChallenge(4, 'not-a-token')).toThrow(
        BadRequestException,
      );
    });

    it('fails closed when the signing secret is missing', () => {
      const service = buildService({ PRIVATE_SUPABASE_JWT_SECRET: undefined });
      expect(() => service.createChallenge()).toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('sendRemovalRequest', () => {
    it('emails both operators with the requester email and message', async () => {
      const service = buildService();
      await service.sendRemovalRequest('leaving@example.com', ' bye now ');

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const args = sendMailMock.mock.calls[0][0] as {
        to: string[];
        subject: string;
        text: string;
      };
      expect(args.to).toEqual(['kevin@cropwatch.io', 'sayaka@cropwatch.io']);
      expect(args.subject).toContain('leaving@example.com');
      expect(args.text).toContain('leaving@example.com');
      expect(args.text).toContain('bye now');
    });

    it('propagates the mail service failing closed when SMTP is not configured', async () => {
      // MailService owns the fail-closed behavior (see mail.service.spec.ts);
      // this service must let its 503 bubble untouched.
      sendMailMock.mockRejectedValueOnce(
        new ServiceUnavailableException('Email delivery is not configured'),
      );
      const service = buildService({ SMTP_HOST: undefined });
      await expect(
        service.sendRemovalRequest('leaving@example.com'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('maps transport failures to a 503 without leaking details', async () => {
      sendMailMock.mockRejectedValueOnce(
        new ServiceUnavailableException(
          'Could not deliver the email — please try again later',
        ),
      );
      const service = buildService();
      await expect(
        service.sendRemovalRequest('leaving@example.com'),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
