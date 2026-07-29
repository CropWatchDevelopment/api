import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { SupabaseService } from '../../supabase/supabase.service';
import { LineApiClient, type LineMessage } from './line-api.client';

const APP_BASE_URL = 'https://app.cropwatch.io';
const NONCE_TTL_MS = 10 * 60 * 1000;
const UNIQUE_VIOLATION = '23505';

export interface LineWebhookEvent {
  type: string;
  source?: { type?: string; userId?: string };
  link?: { result?: string; nonce?: string };
  [key: string]: unknown;
}

// Bilingual DM texts (ja first, matching the alert-email convention).
const DM = {
  linkButtonAlt: 'CropWatchアカウント連携 / Link your CropWatch account',
  linkButtonText:
    'CropWatchアカウントと連携すると、アラートをLINEで受け取れます。\nLink your CropWatch account to receive alerts on LINE.',
  linkButtonLabel: '連携する / Link',
  alreadyLinked:
    'このLINEアカウントは連携済みです。\nThis LINE account is already linked.',
  linked:
    '連携が完了しました。アラートをLINEでお送りします。\nYour account is linked. Alerts will be sent here.',
  linkFailed:
    '連携に失敗しました。このトークにメッセージを送ると、新しい連携ボタンをお送りします。\nLink failed — send this chat any message to get a new link button.',
  linkedElsewhere:
    'このLINEアカウントは別のCropWatchアカウントに連携されています。\nThis LINE account is already linked to a different CropWatch user.',
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
        // Recovery path: an unbound user's message re-issues the link button
        // (the link token in the original DM expires after 10 minutes).
        if (lineUserId && !(await this.isLinked(lineUserId))) {
          await this.sendLinkButton(lineUserId);
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

    const { error: updateError } = await client
      .from('profiles')
      .update({ line_id: lineUserId })
      .eq('id', nonceRow.user_id);

    if (updateError) {
      if (updateError.code === UNIQUE_VIOLATION) {
        await this.pushText(lineUserId, DM.linkedElsewhere);
        return;
      }
      throw new Error(`Failed to bind LINE account: ${updateError.message}`);
    }

    await client
      .from('cw_line_link_nonces')
      .delete()
      .eq('nonce', nonceRow.nonce);
    await this.pushText(lineUserId, DM.linked);
    this.logger.log(`Linked LINE account for user ${nonceRow.user_id}`);
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
