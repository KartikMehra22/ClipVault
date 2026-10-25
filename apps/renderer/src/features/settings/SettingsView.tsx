import { useState, useEffect, type FC, type ChangeEvent } from 'react';
import type { AppSettingsDto } from '@cliporbit/contracts';
import { InfoIcon } from '../../components/common/Icons';

export const SettingsView: FC = () => {
  const [settings, setSettings] = useState<AppSettingsDto>({
    clipboardPersistenceEnabled: false,
    launchAtLogin: false,
    defaultView: 'history',
    excludePasswordManagers: true,
    maskDetectedSecrets: true,
    clearOnExit: false,
    maxHistorySize: 1000,
    retentionPeriod: '30',
  });
  const [persistenceEnabled, setPersistenceEnabled] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      try {
        if (typeof window !== 'undefined' && window.clipOrbit?.getAllSettings) {
          const loaded = await window.clipOrbit.getAllSettings();
          if (isMounted) {
            setSettings(loaded);
            setPersistenceEnabled(loaded.clipboardPersistenceEnabled);
            setIsLoading(false);
          }
        } else if (
          typeof window !== 'undefined' &&
          window.clipOrbit?.getClipboardPersistenceEnabled
        ) {
          const enabled = await window.clipOrbit.getClipboardPersistenceEnabled();
          if (isMounted) {
            setPersistenceEnabled(Boolean(enabled));
            setSettings((prev) => ({ ...prev, clipboardPersistenceEnabled: Boolean(enabled) }));
            setIsLoading(false);
          }
        } else {
          if (isMounted) {
            setIsLoading(false);
          }
        }
      } catch {
        if (isMounted) {
          setError('Failed to load settings. Defaults are in effect.');
          setIsLoading(false);
        }
      }
    }

    loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleTogglePersistence = async (e: ChangeEvent<HTMLInputElement>) => {
    const targetValue = e.target.checked;
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (typeof window !== 'undefined' && window.clipOrbit?.setClipboardPersistenceEnabled) {
        const updated = await window.clipOrbit.setClipboardPersistenceEnabled(targetValue);
        setPersistenceEnabled(Boolean(updated));
        setSettings((prev) => ({ ...prev, clipboardPersistenceEnabled: Boolean(updated) }));
        setSuccessMessage(
          updated
            ? 'Encrypted local history saving is enabled.'
            : 'Encrypted local history saving is disabled.',
        );
      } else {
        throw new Error('Desktop bridge is not available.');
      }
    } catch {
      setError('Failed to update persistence preference. Local history saving remains disabled.');
      setPersistenceEnabled(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleLaunchAtLogin = async (e: ChangeEvent<HTMLInputElement>) => {
    const targetValue = e.target.checked;
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (typeof window !== 'undefined' && window.clipOrbit?.setLaunchAtLogin) {
        const updated = await window.clipOrbit.setLaunchAtLogin(targetValue);
        setSettings((prev) => ({ ...prev, launchAtLogin: updated }));
        setSuccessMessage(
          updated
            ? 'Launch at system login enabled.'
            : 'Launch at system login disabled.',
        );
      } else if (typeof window !== 'undefined' && window.clipOrbit?.setSetting) {
        await window.clipOrbit.setSetting('general.launch_at_login', String(targetValue));
        setSettings((prev) => ({ ...prev, launchAtLogin: targetValue }));
        setSuccessMessage(
          targetValue
            ? 'Launch at system login enabled.'
            : 'Launch at system login disabled.',
        );
      }
    } catch {
      setError('Failed to update launch at login setting.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangeDefaultView = async (e: ChangeEvent<HTMLSelectElement>) => {
    const targetValue = e.target.value as 'history' | 'pinned' | 'snippets' | 'settings';
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (typeof window !== 'undefined' && window.clipOrbit?.setSetting) {
        await window.clipOrbit.setSetting('general.default_view', targetValue);
        setSettings((prev) => ({ ...prev, defaultView: targetValue }));
        setSuccessMessage(
          `Default view set to ${targetValue.charAt(0).toUpperCase() + targetValue.slice(1)}.`,
        );
      }
    } catch {
      setError('Failed to update default view.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleExcludePasswordManagers = async (e: ChangeEvent<HTMLInputElement>) => {
    const targetValue = e.target.checked;
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (typeof window !== 'undefined' && window.clipOrbit?.setSetting) {
        await window.clipOrbit.setSetting('privacy.exclude_vault_apps', String(targetValue));
        setSettings((prev) => ({ ...prev, excludePasswordManagers: targetValue }));
        setSuccessMessage(
          targetValue
            ? 'Password manager exclusion enabled.'
            : 'Password manager exclusion disabled.',
        );
      }
    } catch {
      setError('Failed to update password manager exclusion.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleMaskSecrets = async (e: ChangeEvent<HTMLInputElement>) => {
    const targetValue = e.target.checked;
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (typeof window !== 'undefined' && window.clipOrbit?.setSetting) {
        await window.clipOrbit.setSetting('privacy.mask_sensitive_data', String(targetValue));
        setSettings((prev) => ({ ...prev, maskDetectedSecrets: targetValue }));
        setSuccessMessage(
          targetValue
            ? 'Sensitive secrets masking enabled.'
            : 'Sensitive secrets masking disabled.',
        );
      }
    } catch {
      setError('Failed to update secret masking setting.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleClearOnExit = async (e: ChangeEvent<HTMLInputElement>) => {
    const targetValue = e.target.checked;
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (typeof window !== 'undefined' && window.clipOrbit?.setSetting) {
        await window.clipOrbit.setSetting('privacy.clear_on_exit', String(targetValue));
        setSettings((prev) => ({ ...prev, clearOnExit: targetValue }));
        setSuccessMessage(
          targetValue
            ? 'Clear unpinned clips on exit enabled.'
            : 'Clear on exit disabled.',
        );
      }
    } catch {
      setError('Failed to update clear on exit preference.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangeMaxHistorySize = async (e: ChangeEvent<HTMLSelectElement>) => {
    const targetValue = parseInt(e.target.value, 10);
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (typeof window !== 'undefined' && window.clipOrbit?.setSetting) {
        await window.clipOrbit.setSetting('retention.max_history_size', String(targetValue));
        setSettings((prev) => ({ ...prev, maxHistorySize: targetValue }));
        setSuccessMessage(`Maximum history size set to ${targetValue.toLocaleString()} clips.`);
      }
    } catch {
      setError('Failed to update maximum history size.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangeRetentionPeriod = async (e: ChangeEvent<HTMLSelectElement>) => {
    const targetValue = e.target.value;
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (typeof window !== 'undefined' && window.clipOrbit?.setSetting) {
        await window.clipOrbit.setSetting('retention.period', targetValue);
        setSettings((prev) => ({ ...prev, retentionPeriod: targetValue }));
        setSuccessMessage(
          targetValue === 'never'
            ? 'Retention period set to Never (manual purge only).'
            : `Retention period set to ${targetValue} days.`,
        );
      }
    } catch {
      setError('Failed to update retention period.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="settings-view-wrapper">
      {/* Notice Banner */}
      <div className="placeholder-banner">
        <InfoIcon size={16} />
        <div className="placeholder-banner-text">
          <strong>Settings & Preferences</strong> — Configure application startup, background behavior,
          privacy protections, and local data retention. All preferences are securely stored on this device.
        </div>
      </div>

      <div className="settings-sections-list">
        {/* Section 1: General */}
        <section className="settings-section" aria-labelledby="settings-general-heading">
          <div className="settings-section-header">
            <h3 id="settings-general-heading" className="settings-section-title">
              General
            </h3>
            <p className="settings-section-desc">Application startup and background behavior.</p>
          </div>

          <div className="settings-group">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Launch at system login</span>
                <span className="settings-label-sub">
                  Automatically start ClipVault in the background on system startup.
                </span>
              </div>
              <input
                type="checkbox"
                id="launch-at-login-toggle"
                checked={settings.launchAtLogin}
                disabled={isLoading || isSaving}
                onChange={handleToggleLaunchAtLogin}
                className="settings-toggle-checkbox"
                aria-label="Launch at system login"
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Default view</span>
                <span className="settings-label-sub">
                  Select which tab opens when launching or activating the window.
                </span>
              </div>
              <select
                id="default-view-select"
                value={settings.defaultView}
                disabled={isLoading || isSaving}
                onChange={handleChangeDefaultView}
                className="settings-select"
                aria-label="Default view"
              >
                <option value="history">History</option>
                <option value="pinned">Pinned</option>
                <option value="snippets">Snippets</option>
                <option value="settings">Settings</option>
              </select>
            </div>
          </div>
        </section>

        {/* Section 2: Keyboard Shortcuts */}
        <section className="settings-section" aria-labelledby="settings-shortcuts-heading">
          <div className="settings-section-header">
            <h3 id="settings-shortcuts-heading" className="settings-section-title">
              Keyboard Shortcuts
            </h3>
            <p className="settings-section-desc">Global hotkeys and in-app navigation bindings.</p>
          </div>

          <div className="settings-group">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Global window toggle</span>
                <span className="settings-label-sub">
                  Shortcut to summon and dismiss ClipVault from any application.
                </span>
              </div>
              <kbd className="settings-kbd">⌥ Space</kbd>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Focus search bar</span>
                <span className="settings-label-sub">Instantly activate the search field.</span>
              </div>
              <kbd className="settings-kbd">⌘ K</kbd>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Pin / Unpin focused clip</span>
                <span className="settings-label-sub">Toggle pin status for selected clip.</span>
              </div>
              <kbd className="settings-kbd">⌘ P</kbd>
            </div>
          </div>
        </section>

        {/* Section 3: Privacy & Security */}
        <section className="settings-section" aria-labelledby="settings-privacy-heading">
          <div className="settings-section-header">
            <h3 id="settings-privacy-heading" className="settings-section-title">
              Privacy & Security
            </h3>
            <p className="settings-section-desc">
              Local-first data protection, encryption, and secret filtering.
            </p>
          </div>

          <div className="settings-group">
            {/* Functional Local Persistence Consent Toggle */}
            <div className="settings-row settings-consent-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Save clipboard history on this device</span>
                <span className="settings-label-sub">
                  When enabled, eligible clipboard text can be retained in encrypted local history.
                </span>
              </div>
              <div className="settings-toggle-container">
                {isLoading ? (
                  <span className="settings-loading-indicator" aria-live="polite">
                    Checking...
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    id="save-clipboard-history-toggle"
                    checked={persistenceEnabled}
                    disabled={isSaving}
                    onChange={handleTogglePersistence}
                    className="settings-toggle-checkbox"
                    aria-label="Save clipboard history on this device"
                  />
                )}
              </div>
            </div>

            {/* Persistence Disclosures and Guarantees */}
            <div
              className="settings-disclosure-box"
              role="region"
              aria-label="Encrypted persistence details"
            >
              <ul className="settings-disclosure-list">
                <li>
                  • <strong>Encrypted storage:</strong> When enabled, eligible clipboard text can be
                  retained in encrypted local history.
                </li>
                <li>
                  • <strong>Sensitive detection:</strong> Sensitive-content detection reduces risk
                  but cannot guarantee detection of every secret.
                </li>
                <li>
                  • <strong>Local-only boundary:</strong> This setting controls local persistence
                  only; it does not enable remote synchronization.
                </li>
                <li>
                  • <strong>Retention control:</strong> Turning this setting off prevents future
                  persistence, but does not itself delete previously saved history.
                </li>
              </ul>
            </div>

            {error && (
              <div className="settings-error-banner" role="alert">
                {error}
              </div>
            )}
            {successMessage && (
              <div className="settings-success-banner" role="status">
                {successMessage}
              </div>
            )}

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Exclude password managers</span>
                <span className="settings-label-sub">
                  Ignore clipboard events originating from 1Password, Bitwarden, KeePass, and
                  Keychain.
                </span>
              </div>
              <input
                type="checkbox"
                id="exclude-password-managers-toggle"
                checked={settings.excludePasswordManagers}
                disabled={isLoading || isSaving}
                onChange={handleToggleExcludePasswordManagers}
                className="settings-toggle-checkbox"
                aria-label="Exclude password managers"
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Mask detected secrets</span>
                <span className="settings-label-sub">
                  Hide potential API keys, passwords, and private tokens until revealed.
                </span>
              </div>
              <input
                type="checkbox"
                id="mask-detected-secrets-toggle"
                checked={settings.maskDetectedSecrets}
                disabled={isLoading || isSaving}
                onChange={handleToggleMaskSecrets}
                className="settings-toggle-checkbox"
                aria-label="Mask detected secrets"
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Clear on exit</span>
                <span className="settings-label-sub">
                  Automatically purge unpinned clipboard history when closing the application.
                </span>
              </div>
              <input
                type="checkbox"
                id="clear-on-exit-toggle"
                checked={settings.clearOnExit}
                disabled={isLoading || isSaving}
                onChange={handleToggleClearOnExit}
                className="settings-toggle-checkbox"
                aria-label="Clear on exit"
              />
            </div>
          </div>
        </section>

        {/* Section 4: Data Retention */}
        <section className="settings-section" aria-labelledby="settings-retention-heading">
          <div className="settings-section-header">
            <h3 id="settings-retention-heading" className="settings-section-title">
              Data Retention
            </h3>
            <p className="settings-section-desc">Manage local storage capacity and expiration.</p>
          </div>

          <div className="settings-group">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Maximum history size</span>
                <span className="settings-label-sub">
                  Oldest unpinned clips will be trimmed when this limit is reached.
                </span>
              </div>
              <select
                id="max-history-size-select"
                value={String(settings.maxHistorySize)}
                disabled={isLoading || isSaving}
                onChange={handleChangeMaxHistorySize}
                className="settings-select"
                aria-label="Maximum history size"
              >
                <option value="500">500 clips</option>
                <option value="1000">1,000 clips</option>
                <option value="5000">5,000 clips</option>
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Retention period</span>
                <span className="settings-label-sub">
                  Unpinned clips older than this duration will be automatically expired.
                </span>
              </div>
              <select
                id="retention-period-select"
                value={settings.retentionPeriod}
                disabled={isLoading || isSaving}
                onChange={handleChangeRetentionPeriod}
                className="settings-select"
                aria-label="Retention period"
              >
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="never">Never (Manual only)</option>
              </select>
            </div>
          </div>
        </section>

        {/* Section 5: Appearance */}
        <section className="settings-section" aria-labelledby="settings-appearance-heading">
          <div className="settings-section-header">
            <h3 id="settings-appearance-heading" className="settings-section-title">
              Appearance
            </h3>
            <p className="settings-section-desc">Visual styling and interface density.</p>
          </div>

          <div className="settings-group">
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Interface theme</span>
                <span className="settings-label-sub">ClipVault desktop color scheme.</span>
              </div>
              <span className="settings-pill-active">Dark Slate (Default)</span>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-label-title">Display density</span>
                <span className="settings-label-sub">Row spacing in clipboard history list.</span>
              </div>
              <span className="settings-pill-active">Compact Desktop</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
