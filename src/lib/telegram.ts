/**
 * Thin wrapper over the Telegram WebApp bridge injected by telegram-web-app.js.
 * Every call is a no-op in a normal browser, so the app stays testable outside
 * Telegram.
 */

interface TelegramWebApp {
  ready(): void;
  expand(): void;
  colorScheme: 'light' | 'dark';
  platform: string;
  themeParams: Record<string, string>;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
  setHeaderColor?(color: string): void;
  openLink?(url: string, options?: { try_instant_view?: boolean }): void;
  disableVerticalSwipes?(): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const webApp = (): TelegramWebApp | undefined => window.Telegram?.WebApp;

export const isTelegram = (): boolean => Boolean(webApp()?.platform && webApp()?.platform !== 'unknown');

/**
 * Telegram's bridge throws `WebAppMethodUnsupported` when a client is older
 * than the method being called, so every call goes through this guard.
 */
function safely(action: () => void): void {
  try {
    action();
  } catch {
    /* older Telegram client, or no bridge at all */
  }
}

export function initTelegram(): void {
  const app = webApp();
  if (!app) return;
  safely(() => app.ready());
  safely(() => app.expand());
  safely(() => app.disableVerticalSwipes?.());
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  safely(() => webApp()?.HapticFeedback?.impactOccurred(style));
}

export function notify(type: 'error' | 'success' | 'warning'): void {
  safely(() => webApp()?.HapticFeedback?.notificationOccurred(type));
}

/** Telegram's own theme, falling back to the OS preference in a plain browser. */
export function colorScheme(): 'light' | 'dark' {
  const app = webApp();
  if (app?.colorScheme) return app.colorScheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** telegram-ui only distinguishes iOS from everything else. */
export function uiPlatform(): 'ios' | 'base' {
  const platform = webApp()?.platform;
  if (platform === 'ios' || platform === 'macos') return 'ios';
  if (platform) return 'base';
  return /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent) ? 'ios' : 'base';
}

export function openExternal(url: string): void {
  const app = webApp();
  if (app?.openLink) {
    try {
      app.openLink(url);
      return;
    } catch {
      /* fall through to a plain window.open */
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Wires Telegram's native back button to a callback; returns an unbind function. */
export function bindBackButton(handler: (() => void) | null): () => void {
  const app = webApp();
  if (!app) return () => {};
  if (!handler) {
    safely(() => app.BackButton.hide());
    return () => {};
  }
  safely(() => {
    app.BackButton.onClick(handler);
    app.BackButton.show();
  });
  return () =>
    safely(() => {
      app.BackButton.offClick(handler);
      app.BackButton.hide();
    });
}
