import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  getNotificationSettings,
  setNotificationSettings,
  previewNotificationSound,
  selectCustomNotificationSound,
  getNotificationPermissionState,
  requestNotificationPermission,
  BUILT_IN_NOTIFICATION_SOUNDS,
  type NotificationSettings,
} from './notifications';

vi.mock('@tauri-apps/api/core');

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe('notifications command wrappers', () => {
  it('getNotificationSettings sends get_notification_settings with no payload and returns the parsed result', async () => {
    const settings: NotificationSettings = { global_mute: false, sound: { type: 'Default' } };
    mockedInvoke.mockResolvedValueOnce(settings as unknown as NotificationSettings);

    const result = await getNotificationSettings();

    expect(mockedInvoke).toHaveBeenCalledWith('get_notification_settings');
    expect(result).toEqual(settings);
  });

  it('setNotificationSettings sends set_notification_settings with the full settings payload', async () => {
    const settings: NotificationSettings = { global_mute: false, sound: { type: 'Techno' } };
    mockedInvoke.mockResolvedValueOnce(undefined);

    await setNotificationSettings(settings);

    expect(mockedInvoke).toHaveBeenCalledWith('set_notification_settings', { settings });
  });

  it('setNotificationSettings with global mute on leaves the selected sound untouched', async () => {
    const settings: NotificationSettings = {
      global_mute: true,
      sound: { type: 'Custom', path: '/data/sounds/custom-abc.raw' },
    };
    mockedInvoke.mockResolvedValueOnce(undefined);

    await setNotificationSettings(settings);

    expect(mockedInvoke).toHaveBeenCalledWith('set_notification_settings', {
      settings: { global_mute: true, sound: { type: 'Custom', path: '/data/sounds/custom-abc.raw' } },
    });
  });

  it('previewNotificationSound sends preview_notification_sound and never touches set_notification_settings', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);

    await previewNotificationSound({ type: 'Techno' });

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith('preview_notification_sound', { sound: { type: 'Techno' } });
    expect(mockedInvoke).not.toHaveBeenCalledWith('set_notification_settings', expect.anything());
  });

  it('selectCustomNotificationSound sends select_custom_notification_sound with no payload and returns the stored path', async () => {
    mockedInvoke.mockResolvedValueOnce('/data/sounds/custom-abc.raw');

    const result = await selectCustomNotificationSound();

    expect(mockedInvoke).toHaveBeenCalledWith('select_custom_notification_sound');
    expect(result).toBe('/data/sounds/custom-abc.raw');
  });

  it('selectCustomNotificationSound rejects when the dialog is cancelled', async () => {
    mockedInvoke.mockRejectedValueOnce('No file selected');

    await expect(selectCustomNotificationSound()).rejects.toBe('No file selected');
  });

  it('exposes exactly the three built-in sound choices', () => {
    expect(BUILT_IN_NOTIFICATION_SOUNDS).toEqual([{ type: 'Default' }, { type: 'Techno' }, { type: 'None' }]);
  });
});

describe('OS notification permission state', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Notification');

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'Notification', originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'Notification');
    }
  });

  it('reports "unsupported" when the platform has no Notification global', () => {
    Reflect.deleteProperty(globalThis, 'Notification');

    expect(getNotificationPermissionState()).toBe('unsupported');
  });

  it('reads the current permission straight off the (plugin-backed) Notification global', () => {
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { permission: 'granted' },
    });

    expect(getNotificationPermissionState()).toBe('granted');
  });

  it('requestNotificationPermission delegates to Notification.requestPermission and returns its answer', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { permission: 'default', requestPermission },
    });

    const result = await requestNotificationPermission();

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(result).toBe('granted');
  });

  it('requestNotificationPermission reports "unsupported" when the platform has no Notification global', async () => {
    Reflect.deleteProperty(globalThis, 'Notification');

    await expect(requestNotificationPermission()).resolves.toBe('unsupported');
  });
});
