/**
 * Settings IPC contract definitions for ClipOrbit
 * Phase 6.3.2: Explicit Consent for Encrypted Clipboard Persistence
 */

export const SETTING_KEYS = {
  /**
   * Non-secret preference key for local encrypted clipboard persistence consent.
   * Stored in the AppSetting repository as 'true' or 'false'.
   * Defaults strictly to disabled (false) when missing, unreadable, or invalid.
   */
  CLIPBOARD_PERSISTENCE_ENABLED: 'clipboard.persistence.enabled',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
