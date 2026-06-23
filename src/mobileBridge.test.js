import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
  registerPlugin: () => ({}),
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(),
  },
}));

describe('mobile bridge fallbacks', () => {
  beforeEach(() => {
    globalThis.window = {};
    vi.resetModules();
  });

  it('installs safe desktop/browser fallbacks when native plugins are unavailable', async () => {
    const { installMobileBridge } = await import('./mobileBridge');

    installMobileBridge();

    await expect(window.moonbounce.cast.list()).resolves.toEqual({
      supported: false,
      devices: [],
    });
    await expect(window.moonbounce.cast.rescan()).resolves.toEqual({
      supported: false,
      devices: [],
    });
    await expect(window.moonbounce.nativePlayer.status()).resolves.toEqual({ supported: false });
    await expect(window.moonbounce.nativePlayer.matchVolume(true)).resolves.toEqual({ ok: false });
    await expect(window.moonbounce.auto.update({ title: 'Song' })).resolves.toEqual({ ok: true });
  });

  it('reports unsupported Chromecast actions clearly outside the Android bridge', async () => {
    const { installMobileBridge } = await import('./mobileBridge');

    installMobileBridge();

    await expect(window.moonbounce.cast.connect({ id: 'speaker' }))
      .rejects.toThrow('Chromecast support needs the Android Cast bridge.');
    await expect(window.moonbounce.cast.status())
      .rejects.toThrow('No active cast device.');
  });

  it('keeps install idempotent so an existing app bridge is not replaced', async () => {
    const existing = { cast: { list: vi.fn() } };
    globalThis.window = { moonbounce: existing };
    const { installMobileBridge } = await import('./mobileBridge');

    installMobileBridge();

    expect(window.moonbounce).toBe(existing);
  });
});
