/**
 * Thin, version-guarded wrapper over the official Telegram Mini Apps API
 * (window.Telegram.WebApp from telegram-web-app.js). Everything degrades to a no-op
 * outside Telegram so the app also runs in a normal browser for development.
 *
 * initDataUnsafe is used only for UI hints (routing); identity always comes from the
 * server validating the raw initData.
 */

type WebApp = typeof window.Telegram.WebApp;

export function webApp(): WebApp | null {
  if (typeof window === 'undefined') return null;
  return (window as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp ?? null;
}

/** True only when launched by Telegram (the script also exists in plain browsers). */
export function isInTelegram(): boolean {
  return Boolean(webApp()?.initData);
}

function atLeast(version: string): boolean {
  const app = webApp();
  return Boolean(app && isInTelegram() && app.isVersionAtLeast(version));
}

export function rawInitData(): string | null {
  const data = webApp()?.initData;
  return data ? data : null;
}

/** Launch parameter from a t.me/<bot>?startapp=… link (routing hint only). */
export function launchStartParam(): string | null {
  const fromInit = webApp()?.initDataUnsafe?.start_param;
  if (fromInit) return fromInit;
  const fromUrl = new URLSearchParams(window.location.search).get('tgWebAppStartParam');
  return fromUrl || null;
}

export function initTelegram(): void {
  const app = webApp();
  if (!app || !isInTelegram()) return;
  document.documentElement.classList.add('tg');
  document.documentElement.style.colorScheme = app.colorScheme;
  app.ready();
  app.expand();
  if (atLeast('7.7')) app.disableVerticalSwipes();
  if (atLeast('6.1')) {
    app.setHeaderColor('bg_color');
    app.setBackgroundColor('bg_color');
  }
  app.onEvent('themeChanged', () => {
    document.documentElement.style.colorScheme = app.colorScheme;
  });
}

export const haptic = {
  tap: () => atLeast('6.1') && webApp()!.HapticFeedback.impactOccurred('light'),
  press: () => atLeast('6.1') && webApp()!.HapticFeedback.impactOccurred('medium'),
  select: () => atLeast('6.1') && webApp()!.HapticFeedback.selectionChanged(),
  success: () => atLeast('6.1') && webApp()!.HapticFeedback.notificationOccurred('success'),
  warning: () => atLeast('6.1') && webApp()!.HapticFeedback.notificationOccurred('warning'),
  error: () => atLeast('6.1') && webApp()!.HapticFeedback.notificationOccurred('error'),
};

/** Shows Telegram's BackButton while `handler` is set. Returns a cleanup function. */
export function showBackButton(handler: () => void): () => void {
  if (!atLeast('6.1')) return () => undefined;
  const btn = webApp()!.BackButton;
  btn.onClick(handler);
  btn.show();
  return () => {
    btn.offClick(handler);
    btn.hide();
  };
}

/** Called when the Mini App comes back to the foreground (Bot API 8.0+), plus page visibility. */
export function onForeground(handler: () => void): () => void {
  const app = webApp();
  const onVisible = () => {
    if (document.visibilityState === 'visible') handler();
  };
  document.addEventListener('visibilitychange', onVisible);
  const tgHandler = () => handler();
  if (app && atLeast('8.0')) app.onEvent('activated', tgHandler);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    if (app && atLeast('8.0')) app.offEvent('activated', tgHandler);
  };
}

/**
 * Opens Telegram's native "share to chat" picker with the invite link.
 * Returns false when not in Telegram so the caller can fall back.
 */
export function shareToTelegram(url: string, text: string): boolean {
  const app = webApp();
  if (!app || !isInTelegram()) return false;
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  app.openTelegramLink(share);
  return true;
}

export function confirmDialog(message: string): Promise<boolean> {
  const app = webApp();
  if (app && atLeast('6.2')) {
    return new Promise((resolve) => app.showConfirm(message, (ok) => resolve(ok)));
  }
  return Promise.resolve(window.confirm(message));
}
