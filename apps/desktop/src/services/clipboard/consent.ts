/**
 * ClipOrbit — Clipboard Persistence Consent Policy & Manager
 * Phase 6.3.2: Explicit Consent for Encrypted Clipboard Persistence
 *
 * Implements explicit user consent management for local encrypted clipboard persistence.
 * Backed by the existing AppSetting repository with fail-closed semantics.
 *
 * PRIVACY GUARANTEES:
 * 1. Defaults strictly to DISABLED (false) when missing, unset, malformed, or unreadable.
 * 2. Never silently enables persistence during startup, migrations, or initialization.
 * 3. Never stores secrets, clipboard text, or keys in the AppSetting repository.
 * 4. Strictly validates values: only the exact string 'true' represents consent.
 * 5. Fails closed (disabled) on database errors or unhandled read failures.
 */

import { type AppSettingRepository, createAppSettingRepository } from '@cliporbit/database';
import { SETTING_KEYS } from '@cliporbit/contracts';
import { getDatabaseClient } from '../database';
import { type IPersistencePolicy } from './persistence';

/**
 * Parses a stored preference string into a boolean consent state.
 * Strictly requires the string 'true'; any other value (null, undefined, 'false',
 * '1', 'yes', 'on', malformed json) evaluates to false.
 */
export function parseClipboardPersistenceConsent(value: string | null | undefined): boolean {
  return value === 'true';
}

/**
 * Dynamic consent policy connected to the AppSetting repository.
 * Reads the latest preference from the database on every check without requiring
 * an application restart.
 */
export class ClipboardPersistencePolicy implements IPersistencePolicy {
  private readonly repoSource: AppSettingRepository | (() => AppSettingRepository | null);

  constructor(repoSource: AppSettingRepository | (() => AppSettingRepository | null)) {
    this.repoSource = repoSource;
  }

  private getRepository(): AppSettingRepository | null {
    if (typeof this.repoSource === 'function') {
      return this.repoSource();
    }
    return this.repoSource;
  }

  /**
   * Checks whether persistence is actively enabled by the user.
   * Fails closed (returns false) if the database is not ready, the setting is missing,
   * or a database read error occurs.
   */
  public async isPersistenceEnabled(): Promise<boolean> {
    try {
      const repo = this.getRepository();
      if (!repo) {
        return false;
      }
      const rawValue = await repo.get(SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED);
      return parseClipboardPersistenceConsent(rawValue);
    } catch {
      // Fail closed on any database read error
      return false;
    }
  }

  /**
   * Updates the persistence consent preference in the AppSetting repository.
   * Validates that the input is strictly a boolean.
   */
  public async setPersistenceEnabled(enabled: boolean): Promise<boolean> {
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid persistence preference: expected boolean true or false.');
    }

    const repo = this.getRepository();
    if (!repo) {
      throw new Error('Cannot update persistence preference: database repository is unavailable.');
    }

    const stringValue = enabled ? 'true' : 'false';
    await repo.set(SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED, stringValue);

    return enabled;
  }
}

// ---------------------------------------------------------------------------
// Singleton & Factory
// ---------------------------------------------------------------------------

let defaultPolicy: ClipboardPersistencePolicy | null = null;

/**
 * Creates an isolated ClipboardPersistencePolicy with an explicit repository.
 */
export function createClipboardPersistencePolicy(
  repoSource: AppSettingRepository | (() => AppSettingRepository | null),
): ClipboardPersistencePolicy {
  return new ClipboardPersistencePolicy(repoSource);
}

/**
 * Returns the default singleton ClipboardPersistencePolicy backed by the active runtime database.
 */
export function getClipboardPersistencePolicy(): ClipboardPersistencePolicy {
  if (!defaultPolicy) {
    defaultPolicy = new ClipboardPersistencePolicy(() => {
      const client = getDatabaseClient();
      return client ? createAppSettingRepository(client) : null;
    });
  }
  return defaultPolicy;
}

/**
 * Resets the default singleton policy (useful in tests).
 */
export function resetClipboardPersistencePolicy(): void {
  defaultPolicy = null;
}
