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
  if (gameName === 'Defuser') {
    // The canonical co-op invite (spec 19): it says co-op, the team size, the length and voice.
    return `${hostName} needs a team to defuse a Charge. Co-op for 2–4 players, about 5 minutes, best on a voice call.`;
  }
  return `${hostName} challenged you to ${gameName} on RivalRush ⚔️`;
}
