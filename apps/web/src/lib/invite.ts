import { buildInviteLink } from '@rivalrush/shared';

/**
 * Invite link for a room. With a bot username configured this is the Telegram Main Mini App
 * deep link (t.me/<bot>?startapp=room_<token>); otherwise a plain web link (development).
 * Either way it carries only the opaque invite token.
 */
export function inviteLinkFor(
  token: string,
  botUsername = import.meta.env.VITE_BOT_USERNAME,
  origin = window.location.origin,
): string {
  const bot = botUsername?.replace(/^@/, '');
  return bot ? buildInviteLink(bot, token) : `${origin}/join/${token}`;
}

export function inviteText(hostName: string, gameName = 'Crack the Code'): string {
  return `${hostName} challenged you to ${gameName} on RivalRush ⚔️`;
}
