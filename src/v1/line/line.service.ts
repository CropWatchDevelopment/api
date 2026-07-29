import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { SupabaseService } from '../../supabase/supabase.service';
import { LineApiClient, type LineMessage } from './line-api.client';

const APP_BASE_URL = 'https://app.cropwatch.io';
const NONCE_TTL_MS = 10 * 60 * 1000;
const UNIQUE_VIOLATION = '23505';
const LINK_CODE_PATTERN = /^\d{6}$/;
const LINK_CODE_INSERT_ATTEMPTS = 5;

export interface LineWebhookEvent {
  type: string;
  source?: { type?: string; userId?: string };
  link?: { result?: string; nonce?: string };
  message?: { type?: string; text?: unknown };
  [key: string]: unknown;
}

// Bilingual DM texts (ja first, matching the alert-email convention).
const DM = {
  linkButtonAlt: 'CropWatchアカウント連携 / Link your CropWatch account',
  // Buttons-template text is capped at 160 chars — keep this tight.
  linkButtonText:
    'アプリの6桁コードをこのトークに送るか、下のボタンで連携できます。\nSend the 6-digit code from the app here, or tap the button.',
  linkButtonLabel: '連携する / Link',
  alreadyLinked:
    'このLINEアカウントは連携済みです。\nThis LINE account is already linked.',
  linked:
    '連携が完了しました。アラートをLINEでお送りします。\nYour account is linked. Alerts will be sent here.',
  linkFailed:
    '連携に失敗しました。このトークにメッセージを送ると、新しい連携ボタンをお送りします。\nLink failed — send this chat any message to get a new link button.',
  linkedElsewhere:
    'このLINEアカウントは別のCropWatchアカウントに連携されています。\nThis LINE account is already linked to a different CropWatch user.',
  codeInvalid:
    'この連携コードは無効か期限切れです。アプリのプロフィールページで新しいコードを取得して、もう一度お送りください。\nThat linking code is invalid or expired. Get a new code from your profile page in the app and send it again.',
} as const;

@Injectable()
export class LineService {
  private readonly logger = new Logger(LineService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly lineApiClient: LineApiClient,
  ) {}

  // -------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): void {
    const channelSecret = this.configService.get<string>('LINE_CHANNEL_SECRET');
    if (!channelSecret) {
      // Fail closed: a missing secret must never mean "accept everything".
      this.logger.error(
        'LINE_CHANNEL_SECRET is not configured — rejecting LINE webhook',
      );
      throw new UnauthorizedException('LINE webhook is not configured');
    }

    const expected = createHmac('sha256', channelSecret)
      .update(rawBody)
      .digest();
    const provided = Buffer.from(signature ?? '', 'base64');

    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new ForbiddenException('Invalid LINE webhook signature');
    }
  }

  async handleEvents(events: LineWebhookEvent[]): Promise<void> {
    for (const event of events) {
      try {
        this.logger.log(
          `LINE webhook event: ${event?.type ?? 'unknown'} from ${maskId(event?.source?.userId ?? 'unknown')}`,
        );
        await this.handleEvent(event);
      } catch (error) {
        // One bad event must not fail the batch — LINE would redeliver all.
        this.logger.error(
          `Failed to handle LINE ${event?.type ?? 'unknown'} event: ${String(error)}`,
        );
      }
    }
  }

  private async handleEvent(event: LineWebhookEvent): Promise<void> {
    const lineUserId = event.source?.userId;
    switch (event.type) {
      case 'follow':
        if (lineUserId) await this.handleFollow(lineUserId);
        return;
      case 'unfollow':
        if (lineUserId) await this.clearLinkByLineUserId(lineUserId);
        return;
      case 'accountLink':
        if (lineUserId) await this.handleAccountLink(lineUserId, event);
        return;
      case 'message':
        if (lineUserId && !(await this.isLinked(lineUserId))) {
          await this.handleUnboundMessage(lineUserId, event);
        }
        return;
      default:
        return;
    }
  }

  private async handleFollow(lineUserId: string): Promise<void> {
    if (await this.isLinked(lineUserId)) {
      await this.pushText(lineUserId, DM.alreadyLinked);
      return;
    }
    await this.sendLinkButton(lineUserId);
  }

  // Primary linking path: the profile page shows a 6-digit code, the user
  // sends it in chat. Works on every device/browser combination because the
  // browser and LINE never have to share a session (the official
  // account-link dialog breaks whenever the link escapes LINE's in-app
  // browser). Non-code messages fall back to the account-link button.
  private async handleUnboundMessage(
    lineUserId: string,
    event: LineWebhookEvent,
  ): Promise<void> {
    const raw =
      typeof event.message?.text === 'string' ? event.message.text : '';
    const text = normalizeLinkCode(raw);

    if (!LINK_CODE_PATTERN.test(text)) {
      this.logger.log(
        `LINE message from unbound ${maskId(lineUserId)} is not code-shaped (len=${raw.length}) — sending link button`,
      );
      await this.sendLinkButton(lineUserId);
      return;
    }

    const client = this.supabaseService.getAdminClient();
    const nowIso = new Date().toISOString();

    const { data: codeRow, error: codeError } = await client
      .from('cw_line_link_nonces')
      .select('nonce, user_id, expires_at')
      .eq('nonce', text)
      .gt('expires_at', nowIso)
      .maybeSingle();

    if (codeError) {
      throw new Error(`Failed to look up link code: ${codeError.message}`);
    }
    if (!codeRow) {
      this.logger.warn(
        `LINE link code from ${maskId(lineUserId)} not found or expired`,
      );
      await this.pushText(lineUserId, DM.codeInvalid);
      return;
    }

    const row = codeRow as { nonce: string; user_id: string };
    this.logger.log(
      `LINE link code accepted for user ${row.user_id} from ${maskId(lineUserId)}`,
    );
    await this.bindProfile(lineUserId, row.user_id, row.nonce);
  }

  private async bindProfile(
    lineUserId: string,
    userId: string,
    nonce: string,
  ): Promise<void> {
    const client = this.supabaseService.getAdminClient();

    // .select() makes PostgREST return the updated rows, so a silently
    // missing profiles row (0 rows updated) is detected instead of sending a
    // false "linked" confirmation.
    const { data: updated, error: updateError } = await client
      .from('profiles')
      .update({ line_id: lineUserId })
      .eq('id', userId)
      .select('id');

    if (updateError) {
      if (updateError.code === UNIQUE_VIOLATION) {
        this.logger.warn(
          `LINE bind rejected for user ${userId}: LINE account ${maskId(lineUserId)} already linked elsewhere`,
        );
        await this.pushText(lineUserId, DM.linkedElsewhere);
        return;
      }
      throw new Error(`Failed to bind LINE account: ${updateError.message}`);
    }

    if (!updated || (updated as unknown[]).length === 0) {
      this.logger.error(
        `LINE bind failed for user ${userId}: no profiles row was updated`,
      );
      await this.pushText(lineUserId, DM.linkFailed);
      return;
    }

    await client.from('cw_line_link_nonces').delete().eq('nonce', nonce);
    await this.pushText(lineUserId, DM.linked);
    this.logger.log(`Linked LINE account for user ${userId}`);
  }

  private async handleAccountLink(
    lineUserId: string,
    event: LineWebhookEvent,
  ): Promise<void> {
    if (event.link?.result !== 'ok' || !event.link.nonce) {
      this.logger.warn(`LINE account link did not complete for ${lineUserId}`);
      return;
    }

    const client = this.supabaseService.getAdminClient();
    const nowIso = new Date().toISOString();

    const { data: nonceRow, error: nonceError } = await client
      .from('cw_line_link_nonces')
      .select('nonce, user_id, expires_at')
      .eq('nonce', event.link.nonce)
      .gt('expires_at', nowIso)
      .maybeSingle();

    if (nonceError) {
      throw new Error(`Failed to look up link nonce: ${nonceError.message}`);
    }
    if (!nonceRow) {
      this.logger.warn('LINE accountLink nonce missing or expired');
      await this.pushText(lineUserId, DM.linkFailed);
      return;
    }

    const row = nonceRow as { nonce: string; user_id: string };
    await this.bindProfile(lineUserId, row.user_id, row.nonce);
  }

  private async sendLinkButton(lineUserId: string): Promise<void> {
    const linkToken = await this.lineApiClient.issueLinkToken(lineUserId);
    const message: LineMessage = {
      type: 'template',
      altText: DM.linkButtonAlt,
      template: {
        type: 'buttons',
        text: DM.linkButtonText,
        actions: [
          {
            type: 'uri',
            label: DM.linkButtonLabel,
            uri: `${APP_BASE_URL}/account/line-link?linkToken=${encodeURIComponent(linkToken)}`,
          },
        ],
      },
    };
    await this.lineApiClient.pushMessage(lineUserId, [message]);
  }

  // -------------------------------------------------------------------------
  // Link lifecycle (called by authenticated endpoints)
  // -------------------------------------------------------------------------

  async createLinkNonce(userId: string): Promise<{ nonce: string }> {
    const client = this.supabaseService.getAdminClient();
    const nowIso = new Date().toISOString();

    // Opportunistic cleanup keeps the table at ~0 rows without a cron.
    await client.from('cw_line_link_nonces').delete().lt('expires_at', nowIso);

    const nonce = randomBytes(24).toString('base64');
    const { error } = await client.from('cw_line_link_nonces').insert({
      nonce,
      user_id: userId,
      expires_at: new Date(Date.now() + NONCE_TTL_MS).toISOString(),
    });

    if (error) {
      throw new Error(`Failed to store link nonce: ${error.message}`);
    }

    return { nonce };
  }

  // 6-digit code for the chat-based linking path. Shares the nonce table:
  // codes and account-link nonces never collide (different shapes), and both
  // are single-use rows with a 10-minute expiry.
  async createLinkCode(
    userId: string,
  ): Promise<{ code: string; expiresAt: string }> {
    const client = this.supabaseService.getAdminClient();
    const nowIso = new Date().toISOString();

    await client.from('cw_line_link_nonces').delete().lt('expires_at', nowIso);
    // A user re-requesting a code invalidates their previous one.
    await client.from('cw_line_link_nonces').delete().eq('user_id', userId);

    const expiresAt = new Date(Date.now() + NONCE_TTL_MS).toISOString();
    for (let attempt = 1; attempt <= LINK_CODE_INSERT_ATTEMPTS; attempt += 1) {
      const code = randomInt(100000, 1000000).toString();
      const { error } = await client.from('cw_line_link_nonces').insert({
        nonce: code,
        user_id: userId,
        expires_at: expiresAt,
      });

      if (!error) {
        return { code, expiresAt };
      }
      if (error.code !== UNIQUE_VIOLATION) {
        throw new Error(`Failed to store link code: ${error.message}`);
      }
      // Collision with another user's live code — regenerate.
    }

    throw new Error('Failed to allocate a unique link code');
  }

  async unlink(userId: string): Promise<void> {
    // line_id is deliberately excluded from the PATCH-profile whitelist;
    // this service method is the only authenticated write path for it.
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .update({ line_id: null })
      .eq('id', userId);

    if (error) {
      throw new Error(`Failed to unlink LINE account: ${error.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async isLinked(lineUserId: string): Promise<boolean> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .select('id')
      .eq('line_id', lineUserId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to check LINE link: ${error.message}`);
    }
    return Boolean(data);
  }

  private async clearLinkByLineUserId(lineUserId: string): Promise<void> {
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .update({ line_id: null })
      .eq('line_id', lineUserId);

    if (error) {
      throw new Error(`Failed to clear LINE link: ${error.message}`);
    }
  }

  private async pushText(lineUserId: string, text: string): Promise<void> {
    await this.lineApiClient.pushMessage(lineUserId, [{ type: 'text', text }]);
  }
}

/**
 * Japanese keyboards commonly produce full-width digits (１２３４５６), and
 * users paste codes with stray whitespace. Normalize to ASCII digits before
 * matching — this is why the code flow "worked for some users only".
 */
function normalizeLinkCode(text: string): string {
  return text
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '');
}

// LINE user ids in logs: enough to correlate, not enough to push to.
function maskId(lineUserId: string): string {
  return `${lineUserId.slice(0, 6)}…`;
}
