import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseInviteStartParam } from '@rivalrush/shared';
import type { Logger } from 'pino';

/**
 * Minimal Telegram bot: /start, /help and the chat menu button. Two delivery modes:
 * - webhook (default for hosted deploys): Telegram POSTs updates to the server, which also
 *   wakes a sleeping free-tier instance;
 * - polling (local development without a public URL).
 * Bot API methods used: setWebhook, deleteWebhook, getUpdates, sendMessage, setMyCommands,
 * setChatMenuButton. The bot token is only ever used server-side.
 */

export const WEBHOOK_PATH = '/telegram/webhook';

/**
 * Secret for the X-Telegram-Bot-Api-Secret-Token header, derived from the bot token so no
 * extra configuration is needed. Hex only (Telegram allows A-Z a-z 0-9 _ -, 1–256 chars).
 */
export function webhookSecret(botToken: string): string {
  return createHmac('sha256', 'rivalrush-telegram-webhook').update(botToken).digest('hex');
}

export function isValidWebhookSecret(header: unknown, botToken: string): boolean {
  if (typeof header !== 'string') return false;
  const expected = Buffer.from(webhookSecret(botToken));
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export interface BotOptions {
  token: string;
  webAppUrl: string;
  logger: Logger;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

interface TgMessage {
  chat: { id: number };
  text?: string;
  from?: { first_name?: string };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export class TelegramBot {
  private offset = 0;
  private abort = new AbortController();
  private running = false;
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly opts: BotOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.base = `${opts.apiBase ?? 'https://api.telegram.org'}/bot${opts.token}`;
  }

  async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abort.signal,
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    // Never include the URL (it contains the token) in errors.
    if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
    return json.result as T;
  }

  async configure(): Promise<void> {
    await this.call('setMyCommands', {
      commands: [
        { command: 'start', description: 'Play RivalRush' },
        { command: 'help', description: 'How to play' },
      ],
    });
    await this.call('setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'Play', web_app: { url: this.opts.webAppUrl } },
    });
  }

  /** Builds the reply for an incoming message (pure; unit-tested). */
  replyFor(message: TgMessage): Record<string, unknown> | null {
    const text = message.text?.trim() ?? '';
    const [command, payload] = text.split(/\s+/, 2);
    const cmd = command?.split('@')[0];
    if (cmd === '/start') {
      const token = parseInviteStartParam(payload);
      const url = token
        ? `${this.opts.webAppUrl.replace(/\/$/, '')}/join/${token}`
        : this.opts.webAppUrl;
      const name = message.from?.first_name ? `, ${message.from.first_name}` : '';
      return {
        chat_id: message.chat.id,
        text: token
          ? `You've been challenged${name}! Tap below to join the duel.`
          : `Hey${name}! RivalRush — quick games, real rivals.\n\nPick Crack the Code or Color Cipher, start a duel and send the invite to a friend.`,
        reply_markup: {
          inline_keyboard: [[{ text: token ? 'Join game' : 'Play', web_app: { url } }]],
        },
      };
    }
    if (cmd === '/help') {
      return {
        chat_id: message.chat.id,
        text:
          'Crack the Code: both players hide a secret code of unique digits. Take turns guessing.\n' +
          '• Bull = right digit, right place\n• Cow = right digit, wrong place\n\n' +
          'Color Cipher: both players hide a pattern of 4 colors (colors can repeat).\n' +
          '• Exact = right color, right spot\n• Close = right color, wrong spot\n\n' +
          'First to crack the other’s secret wins. If the first player cracks it, the second gets one last guess to tie.',
        reply_markup: {
          inline_keyboard: [[{ text: 'Play', web_app: { url: this.opts.webAppUrl } }]],
        },
      };
    }
    return null;
  }

  /** Handles one update (webhook or polling). Never throws. */
  async handleUpdate(update: TgUpdate): Promise<void> {
    const reply = update?.message ? this.replyFor(update.message) : null;
    if (!reply) return;
    await this.call('sendMessage', reply).catch((err: unknown) =>
      this.opts.logger.warn({ err: String(err) }, 'sendMessage failed'),
    );
  }

  /** Registers `<publicUrl>/telegram/webhook` with Telegram (idempotent; run on every boot). */
  async startWebhook(publicUrl: string): Promise<void> {
    try {
      await this.call('setWebhook', {
        url: `${publicUrl.replace(/\/$/, '')}${WEBHOOK_PATH}`,
        secret_token: webhookSecret(this.opts.token),
        allowed_updates: ['message'],
        drop_pending_updates: false,
      });
      await this.configure();
      this.opts.logger.info({ event: 'bot.started', mode: 'webhook' }, 'telegram webhook set');
    } catch (err) {
      this.opts.logger.error({ err: String(err) }, 'telegram webhook setup failed');
    }
  }

  async startPolling(): Promise<void> {
    this.running = true;
    try {
      await this.call('deleteWebhook', { drop_pending_updates: false });
      await this.configure();
      this.opts.logger.info({ event: 'bot.started', mode: 'polling' }, 'telegram bot polling');
    } catch (err) {
      this.opts.logger.error({ err: String(err) }, 'telegram bot setup failed');
    }
    void this.loop();
  }

  private async loop(): Promise<void> {
    let backoff = 1000;
    while (this.running) {
      try {
        const updates = await this.call<TgUpdate[]>('getUpdates', {
          offset: this.offset,
          timeout: 30,
          allowed_updates: ['message'],
        });
        backoff = 1000;
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handleUpdate(u);
        }
      } catch (err) {
        if (!this.running) return;
        this.opts.logger.warn({ err: String(err) }, 'telegram polling error');
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  stop(): void {
    this.running = false;
    this.abort.abort();
  }
}
