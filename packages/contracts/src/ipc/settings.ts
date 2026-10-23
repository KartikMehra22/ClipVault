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

  /**
   * Launch at system login preference ('true' | 'false').
   */
  LAUNCH_AT_LOGIN: 'general.launch_at_login',

  /**
   * Default active tab when the application launches or is summoned ('history' | 'pinned' | 'snippets' | 'settings').
   */
  DEFAULT_VIEW: 'general.default_view',

  /**
   * Exclude password managers ('true' | 'false').
   * Ignores pasteboard events originating from 1Password, Bitwarden, KeePass, etc.
   */
  EXCLUDE_PASSWORD_MANAGERS: 'privacy.exclude_vault_apps',

  /**
   * Mask detected secrets ('true' | 'false').
   * Hides potential API keys and passwords in the UI until revealed by user.
   */
  MASK_DETECTED_SECRETS: 'privacy.mask_sensitive_data',

  /**
   * Clear on exit ('true' | 'false').
   * Automatically purges unpinned clipboard history when closing the application.
   */
  CLEAR_ON_EXIT: 'privacy.clear_on_exit',

  /**
   * Maximum history size limit ('500' | '1000' | '5000').
   */
  MAX_HISTORY_SIZE: 'retention.max_history_size',

  /**
   * Retention period in days ('7' | '30' | '90' | 'never').
   */
  RETENTION_PERIOD: 'retention.period',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export interface AppSettingsDto {
  clipboardPersistenceEnabled: boolean;
  launchAtLogin: boolean;
  defaultView: 'history' | 'pinned' | 'snippets' | 'settings';
  excludePasswordManagers: boolean;
  maskDetectedSecrets: boolean;
  clearOnExit: boolean;
  maxHistorySize: number;
  retentionPeriod: string;
}

