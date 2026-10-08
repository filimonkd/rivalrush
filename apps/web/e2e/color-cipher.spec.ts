import { expect, test, type Page } from '@playwright/test';

/**
 * Color Cipher end to end with two browsers, on the same rooms, invites, sockets and
 * rematch as Crack the Code. Set SHOTS=<dir> to save screenshots of the main screens.
 */

const shots = process.env.SHOTS;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

async function signIn(page: Page, name: string) {
  await page.goto(`/?dev=${name}`);
  await expect(page.getByTestId('greeting')).toHaveText(`Hey, ${name}`);
}

async function tap(page: Page, pattern: string) {
  for (const c of pattern)
    await page.locator(`[data-testid="palette"] [data-color="${c}"]`).click();
}

async function lockPattern(page: Page, pattern: string) {
  await tap(page, pattern);
  await page.getByTestId('lock-secret').click();
  await expect(page.getByTestId('secret-locked').or(page.getByTestId('turn-banner'))).toBeVisible();
}

async function guess(page: Page, pattern: string) {
  await expect(page.getByTestId('guess-panel')).toBeVisible();
  await tap(page, pattern);
  await page.getByTestId('submit-guess').click();
}

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

test('two friends play Color Cipher: invite, patterns, feedback, last chance, rematch, history', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ada = await ctxA.newPage();
  const ben = await ctxB.newPage();
  const patterns = new Map<Page, string>([
    [ada, '0034'], // Ruby Ruby Leaf Sky
    [ben, '2241'], // Sun Sun Sky Amber
  ]);

  // Home shows both live games; Ada picks Color Cipher.
  await signIn(ada, 'Ada');
  await expect(ada.getByTestId('start-duel')).toContainText('Crack the Code');
  await expect(ada.getByTestId('start-color-cipher')).toContainText('Color Cipher');
  await shot(ada, 'cc-1-home');
  await ada.getByTestId('start-color-cipher').click();
  await expect(ada.getByText('4 tiles · 6 colors · repeats allowed')).toBeVisible();
  await shot(ada, 'cc-2-create');
  await ada.getByTestId('create-room').click();
  await expect(ada.getByTestId('lobby-game')).toHaveText('Color Cipher');
  // First Color Cipher lobby on this device: its own How to play opens by itself.
  await expect(ada.getByTestId('how-to-play')).toHaveAttribute(
    'aria-label',
    'How to play Color Cipher',
  );
  await expect(ada.getByTestId('howto-step')).toContainText('colors can repeat');
  await ada.getByTestId('howto-skip').click();
  const invite = (await ada.getByTestId('invite-link').textContent())!.trim();

  // Ben opens the invite: the preview names the game.
  await signIn(ben, 'Ben');
  await ben.goto(new URL(invite).pathname);
  await expect(ben.getByTestId('challenge-title')).toHaveText('Ada challenged you to Color Cipher');
  await shot(ben, 'cc-3-invite');
  await ben.getByTestId('join-game').click();
  await ben.getByTestId('howto-skip').click();
  await ben.getByTestId('ready-toggle').click();
  await ada.getByTestId('start-game').click();

  // Patterns: repeats allowed; Undo works.
  await expect(ada.getByTestId('palette')).toBeVisible();
  await tap(ada, '5');
  await ada.getByRole('button', { name: 'Undo' }).click();
  await shot(ada, 'cc-4-setup');
  await lockPattern(ada, patterns.get(ada)!);
  await lockPattern(ben, patterns.get(ben)!);

  // Turns with feedback; a repeated guess is refused.
  const [first, second] = await whoIsFirst(ada, ben);
  await guess(first, '5555');
  await expect(first.getByTestId('my-move').first().getByTestId('feedback')).toHaveAttribute(
    'aria-label',
    '0 exact, 0 close',
  );
  await guess(second, '3400'); // vs "0034" or "2241": scored by the server
  await expect(first.getByTestId('guess-panel')).toBeVisible();
  await tap(first, '5555');
  await first.getByTestId('submit-guess').click();
  await expect(first.getByText('You already tried that pattern')).toBeVisible();
  await first.getByRole('button', { name: 'Clear' }).click();
  await shot(first, 'cc-5-board');

  // First player cracks → last chance → second misses → first wins.
  await guess(first, patterns.get(second)!);
  await expect(second.getByTestId('turn-banner')).toContainText('Last chance');
  await guess(second, '1111');
  await expect(first.getByTestId('result-title')).toHaveText('You won! 🏆');
  await expect(first.getByTestId('result-reason')).toHaveText('Pattern cracked');
  await expect(second.getByTestId('result-title')).toHaveText('You lost');
  await shot(first, 'cc-6-result');

  // Rematch: a new Color Cipher game, the other player first.
  await first.getByTestId('rematch').click();
  await second.getByTestId('rematch').click();
  await lockPattern(ada, '1111');
  await lockPattern(ben, '0123');
  const [first2] = await whoIsFirst(ada, ben);
  expect(first2).toBe(second);

  // History names the game; stats include it.
  await ben.goto('/profile');
  await expect(ben.getByTestId('match-list')).toContainText('Color Cipher');
  await expect(ben.getByTestId('stat-played')).toHaveText('1');

  await ctxA.close();
  await ctxB.close();
});
