import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const sendMailMock = jest.fn((_mail: unknown) => Promise.resolve());

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
}));

function buildService(
  overrides: Record<string, string | undefined> = {},
): MailService {
  const values: Record<string, string | undefined> = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_USER: 'noreply@example.com',
    SMTP_PASS: 'hunter2',
    SMTP_FROM: 'CropWatch <noreply@example.com>',
    ...overrides,
  };
  const configService = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return new MailService(configService);
}

describe('MailService', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue(undefined);
  });

  it('sends with SMTP_FROM and the given recipients', async () => {
    const service = buildService();
    await service.send({
      to: ['a@example.com', 'b@example.com'],
      subject: 'Hello',
      text: 'Body',
    });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'CropWatch <noreply@example.com>',
      to: ['a@example.com', 'b@example.com'],
      subject: 'Hello',
      text: 'Body',
    });
  });

  it('falls back to SMTP_USER when SMTP_FROM is unset', async () => {
    const service = buildService({ SMTP_FROM: undefined });
    await service.send({ to: 'a@example.com', subject: 's', text: 't' });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'noreply@example.com' }),
    );
  });

  it('fails closed when SMTP is not configured, without touching the transport', async () => {
    const service = buildService({ SMTP_HOST: undefined });
    await expect(
      service.send({ to: 'a@example.com', subject: 's', text: 't' }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('maps transport failures to a 503 without leaking details', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('SMTP down'));
    const service = buildService();
    await expect(
      service.send({ to: 'a@example.com', subject: 's', text: 't' }),
    ).rejects.toThrow('Could not deliver the email — please try again later');
  });
});
