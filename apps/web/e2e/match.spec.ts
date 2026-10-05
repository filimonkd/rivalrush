import { expect, test, type Page } from '@playwright/test';

/**
 * The MVP acceptance loop with two real browsers:
 * create → invite → join → ready → start → secrets → turns → equalizer draw → result →
 * rematch (starting player swaps) → offline/reconnect → reopen → give up → stats.
 * Also asserts that no opponent secret ever reaches a client before the game is over.
 */

type Frame = { at: number; payload: string };

function recordFrames(page: Page): Frame[] {
  const frames: Frame[] = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => frames.push({ at: Date.now(), payload: String(f.payload) }));
  });
  return frames;
}

/** Every object in Socket.IO frames that reveals an opponent secret while unresolved = a leak. */
function leakedSecrets(frames: Frame[]): string[] {
  const leaks: string[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if ('opponentSecret' in o && o.opponentSecret !== null && o.result === null)
      leaks.push(JSON.stringify(o).slice(0, 120));
    for (const child of Object.values(o)) walk(child);
  };
  for (const f of frames) {
    const json = f.payload.replace(/^\d+/, '');
    if (!json.startsWith('[') && !json.startsWith('{')) continue;
    try {
      walk(JSON.parse(json));
    } catch {
      /* not JSON */
    }
  }
  return leaks;
}

async function signIn(page: Page, name: string) {
  await page.goto(`/?dev=${name}`);
  await expect(page.getByTestId('greeting')).toHaveText(`Hey, ${name}`);
}

async function typeCode(page: Page, code: string) {
  for (const d of code) await page.locator(`[data-testid="keypad"] [data-digit="${d}"]`).click();
}

async function lockSecret(page: Page, code: string) {
  await typeCode(page, code);
  await page.getByTestId('lock-secret').click();
  // The second secret starts play immediately, so either screen proves it was accepted.
  await expect(page.getByTestId('secret-locked').or(page.getByTestId('turn-banner'))).toBeVisible();
}

async function guess(page: Page, code: string) {
  await expect(page.getByTestId('guess-panel')).toBeVisible();
  await typeCode(page, code);
  await page.getByTestId('submit-guess').click();
}

/** Resolves which page has the first turn. */
async function whoIsFirst(a: Page, b: Page): Promise<[Page, Page]> {
  await expect(a.getByTestId('turn-banner')).toBeVisible();
  await expect(b.getByTestId('turn-banner')).toBeVisible();
  await expect
    .poll(
      async () =>
        (await a.getByTestId('guess-panel').isVisible()) !==
        (await b.getByTestId('guess-panel').isVisible()),
    )
    .toBe(true);
  return (await a.getByTestId('guess-panel').isVisible()) ? [a, b] : [b, a];
}

test('two friends play a full Crack the Code match, rematch, reconnect and finish', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();
  const framesA = recordFrames(alice);
  const framesB = recordFrames(bob);
  const codes = new Map<Page, string>([
    [alice, '123'],
    [bob, '456'],
  ]);

  // Alice: Home → Start a duel → 3-digit room → lobby with an invite link.
  await signIn(alice, 'Alice');
  await alice.getByTestId('start-duel').click();
  await alice.getByTestId('opt-length').getByRole('button', { name: '3' }).click();
  await alice.getByTestId('create-room').click();
  await expect(alice.getByTestId('waiting-opponent')).toBeVisible();
  const invite = (await alice.getByTestId('invite-link').textContent())!.trim();
  expect(invite).toMatch(/\/join\/[A-Za-z0-9_-]{16,}$/);

  // Bob opens the invite, sees the challenge and joins.
  await signIn(bob, 'Bob');
  await bob.goto(new URL(invite).pathname);
  await expect(bob.getByTestId('challenge-title')).toHaveText('Alice challenged you');
  await bob.getByTestId('join-game').click();
  await expect(alice.getByText('Bob joined')).toBeVisible();

  // Ready → Start.
  await expect(alice.getByTestId('start-game')).toBeDisabled();
  await bob.getByTestId('ready-toggle').click();
  await expect(alice.getByTestId('start-game')).toBeEnabled();
  await alice.getByTestId('start-game').click();

  // Secrets (invalid input is impossible on the keypad: used digits are disabled).
  await expect(alice.locator('[data-testid="keypad"] [data-digit="1"]')).toBeEnabled();
  await alice.locator('[data-testid="keypad"] [data-digit="1"]').click();
  await expect(alice.locator('[data-testid="keypad"] [data-digit="1"]')).toBeDisabled();
  await alice.getByRole('button', { name: 'Clear' }).click();
  await lockSecret(alice, '123');
  await lockSecret(bob, '456');

  // Turns: wrong, wrong, first player cracks → last chance → second cracks → draw.
  const [first, second] = await whoIsFirst(alice, bob);
  await guess(first, '789');
  await expect(first.getByTestId('waiting-turn')).toBeVisible();
  await guess(second, '789');
  await expect(first.getByTestId('my-move').first()).toContainText('789');

  // Duplicate guess is refused client-side and server-side.
  await expect(first.getByTestId('guess-panel')).toBeVisible();
  await typeCode(first, '789');
  await first.getByTestId('submit-guess').click();
  await expect(first.getByText('You already tried that one')).toBeVisible();
  await first.getByRole('button', { name: 'Clear' }).click();

  await guess(first, codes.get(second)!);
  await expect(second.getByTestId('turn-banner')).toContainText('Last chance');
  await guess(second, codes.get(first)!);

  for (const p of [alice, bob]) {
    await expect(p.getByTestId('result-title')).toHaveText("It's a draw 🤝");
    await expect(p.getByTestId('result-reason')).toHaveText('Both cracked it — draw');
  }
  await expect(alice.getByTestId('opponent-secret')).toHaveText('456');
  await expect(bob.getByTestId('opponent-secret')).toHaveText('123');

  // Rematch: both vote, a new game starts with the other player first.
  await alice.getByTestId('rematch').click();
  await expect(alice.getByTestId('rematch-waiting')).toBeVisible();
  await expect(bob.getByTestId('rematch')).toContainText('wants a rematch');
  await bob.getByTestId('rematch').click();
  await lockSecret(alice, '135');
  await lockSecret(bob, '246');
  const [first2] = await whoIsFirst(alice, bob);
  expect(first2).toBe(second);

  // Network drop: Bob goes offline, Alice sees it, Bob reconnects and catches up.
  await ctxB.setOffline(true);
  await expect(alice.getByTestId('opponent-away')).toBeVisible({ timeout: 45_000 });
  await expect(bob.getByTestId('reconnecting')).toBeVisible({ timeout: 45_000 });
  await ctxB.setOffline(false);
  await expect(bob.getByTestId('reconnecting')).toBeHidden({ timeout: 30_000 });
  await expect(alice.getByTestId('opponent-away')).toBeHidden({ timeout: 30_000 });

  // App reopen: Bob relaunches on Home and is dropped straight back into the game.
  await bob.goto('/');
  await expect(bob).toHaveURL(/\/room\//);
  await expect(bob.getByTestId('turn-banner')).toBeVisible();
  await expect(bob.getByTestId('my-secret')).toHaveText('246');

  // Alice gives up → Bob wins by forfeit.
  alice.once('dialog', (d) => void d.accept());
  await alice.getByTestId('give-up').click();
  await expect(bob.getByTestId('result-title')).toHaveText('You won! 🏆');
  await expect(bob.getByTestId('result-reason')).toHaveText('Gave up');
  await expect(alice.getByTestId('result-title')).toHaveText('You lost');

  // Stats: Bob 2 played, 1 win, 1 draw.
  await bob.goto('/profile');
  await expect(bob.getByTestId('profile-name')).toHaveText('Bob');
  await expect(bob.getByTestId('stat-played')).toHaveText('2');
  await expect(bob.getByTestId('stat-wins')).toHaveText('1');
  await expect(bob.getByTestId('stat-draws')).toHaveText('1');
  await expect(bob.getByTestId('match-list').locator('li')).toHaveCount(2);

  // No opponent secret ever reached either browser before a game was over.
  expect(framesA.length).toBeGreaterThan(10);
  expect(leakedSecrets(framesA)).toEqual([]);
  expect(leakedSecrets(framesB)).toEqual([]);

  await ctxA.close();
  await ctxB.close();
});

test('a declined rematch frees the room for someone new, with nothing of the old game', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();
  const carol = await ctxC.newPage();

  await signIn(alice, 'Alina');
  await alice.getByTestId('start-duel').click();
  await alice.getByTestId('create-room').click();
  const invite = (await alice.getByTestId('invite-link').textContent())!.trim();
  await signIn(bob, 'Boris');
  await bob.goto(new URL(invite).pathname);
  await bob.getByTestId('join-game').click();
  await bob.getByTestId('ready-toggle').click();
  await alice.getByTestId('start-game').click();
  await expect(alice.getByTestId('lock-secret')).toBeVisible();

  // Alice gives up during setup.
  alice.once('dialog', (d) => void d.accept());
  await alice.getByTestId('give-up').click();
  await expect(bob.getByTestId('result-title')).toHaveText('You won! 🏆');

  // Bob steps out to Home: the room waits for him there.
  await bob.goto('/');
  await expect(bob.getByText('Game over — rematch?')).toBeVisible();

  // Alice asks for a rematch; Bob comes back, sees it, and leaves instead.
  await alice.getByTestId('rematch').click();
  await expect(alice.getByTestId('rematch-waiting')).toBeVisible();
  await bob.getByRole('button', { name: 'Back to the game' }).click();
  await expect(bob.getByTestId('rematch')).toContainText('Alina wants a rematch');
  await bob.getByRole('button', { name: 'Leave' }).click();
  await expect(bob).toHaveURL(/\/$/);

  // Alice is back in an open lobby with the same invite.
  await expect(alice.getByTestId('waiting-opponent')).toBeVisible();
  await expect(alice.getByTestId('invite-link')).toHaveText(invite);

  // Carol joins through the old link and starts a clean game (no old moves, no result).
  await signIn(carol, 'Carla');
  await carol.goto(new URL(invite).pathname);
  await expect(carol.getByTestId('challenge-title')).toHaveText('Alina challenged you');
  await carol.getByTestId('join-game').click();
  await carol.getByTestId('ready-toggle').click();
  await alice.getByTestId('start-game').click();
  await expect(carol.getByTestId('lock-secret')).toBeVisible();
  await expect(carol.getByTestId('result-sheet')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test('old and bogus invite links explain themselves', async ({ page }) => {
  await signIn(page, 'Carol');
  await page.goto('/join/NoSuchInviteToken000');
  await expect(page.getByTestId('error-title')).toHaveText("Can't join this room");
});
