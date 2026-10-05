import { AppError } from '../../src/errors.js';
import { aid, alice, bob, makeManager } from './manager.js';

/** Resolves to the AppError code a call failed with, or 'OK'. */
export async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  return 'OK';
}

/** Alice hosts, Bob joins and readies. */
export async function lobby(seed = 1, settings: Record<string, unknown> = {}) {
  const ctx = makeManager(seed);
  const created = await ctx.manager.createRoom(alice, 'crack-the-code', settings);
  await ctx.manager.joinByInvite(bob, created.inviteToken);
  await ctx.manager.setReady(bob.userId, created.roomId, true, aid());
  return { ...ctx, roomId: created.roomId, inviteToken: created.inviteToken };
}

export type Ctx = Awaited<ReturnType<typeof lobby>>;

/** Sets both secrets (Alice=1234, Bob=5678) in a started game; returns who moves first. */
export async function lockSecrets<C extends Ctx>(ctx: C) {
  const { manager, roomId } = ctx;
  for (const [who, secret] of [
    [alice, '1234'],
    [bob, '5678'],
  ] as const) {
    await manager.gameAction(who.userId, {
      roomId,
      actionId: aid(),
      clientVersion: (await ctx.state(roomId)).version,
      action: { type: 'SET_SECRET', code: secret },
    });
  }
  const s = await ctx.state(roomId);
  const first = s.currentTurn === alice.userId ? alice : bob;
  const second = first === alice ? bob : alice;
  return { ...ctx, first, second };
}

/** Both connected, game started, secrets set (Alice=1234, Bob=5678). Returns who moves first. */
export async function playing(seed = 1, settings: Record<string, unknown> = {}) {
  const ctx = await lobby(seed, settings);
  await ctx.manager.connect(alice.userId, ctx.roomId);
  await ctx.manager.connect(bob.userId, ctx.roomId);
  await ctx.manager.start(alice.userId, ctx.roomId, aid());
  return lockSecrets(ctx);
}

export type Playing = Awaited<ReturnType<typeof playing>>;

export const secretOf = (who: { userId: string }) =>
  who.userId === alice.userId ? '1234' : '5678';
export const opponentSecretOf = (who: { userId: string }) =>
  who.userId === alice.userId ? '5678' : '1234';

export async function guess(ctx: Ctx, who: { userId: string }, g: string, actionId = aid()) {
  const v = (await ctx.state(ctx.roomId)).version;
  return ctx.manager.gameAction(who.userId, {
    roomId: ctx.roomId,
    actionId,
    clientVersion: v,
    action: { type: 'GUESS', guess: g },
  });
}
