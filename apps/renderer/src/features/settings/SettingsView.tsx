import type { FC } from 'react';
import { InfoIcon } from '../../components/common/Icons';

export const SettingsView: FC = () => {
  return (
    <div className="settings-view-wrapper">
      {/* Notice Banner */}
      <div className="placeholder-banner">
        <InfoIcon size={16} />
        <div className="placeholder-banner-text">
          <strong>Settings Preview (Non-Functional)</strong> — The controls below illustrate planned
          configuration options for ClipOrbit. Preferences persistence, native shortcut bindings,
          and SQLite storage will be wired in future phases.
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
                  Automatically start ClipOrbit in the background on system startup.
                </span>
              </div>
              <input
                type="checkbox"
                disabled
                className="settings-toggle-disabled"
                aria-label="Launch at system login (Disabled preview)"
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
                disabled
                className="settings-select-disabled"
                defaultValue="history"
                aria-label="Default view (Disabled preview)"
              >
                <option value="history">History</option>
                <option value="pinned">Pinned</option>
                <option value="snippets">Snippets</option>
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
                  Shortcut to summon and dismiss ClipOrbit from any application.
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

        {/* Section 3: Privacy */}
        <section className="settings-section" aria-labelledby="settings-privacy-heading">
          <div className="settings-section-header">
            <h3 id="settings-privacy-heading" className="settings-section-title">
              Privacy & Security
            </h3>
            <p className="settings-section-desc">
              Local-first data protection and secret filtering.
            </p>
          </div>

          <div className="settings-group">
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
                checked
                readOnly
                disabled
                className="settings-toggle-disabled"
                aria-label="Exclude password managers (Disabled preview)"
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
                checked
                readOnly
                disabled
                className="settings-toggle-disabled"
                aria-label="Mask detected secrets (Disabled preview)"
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
                disabled
                className="settings-toggle-disabled"
                aria-label="Clear on exit (Disabled preview)"
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
                disabled
                className="settings-select-disabled"
                defaultValue="1000"
                aria-label="Maximum history size (Disabled preview)"
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
                disabled
                className="settings-select-disabled"
                defaultValue="30"
                aria-label="Retention period (Disabled preview)"
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
                <span className="settings-label-sub">ClipOrbit desktop color scheme.</span>
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
