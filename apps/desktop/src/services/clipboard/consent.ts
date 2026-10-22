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
import { type IPersistencePolicy, PersistenceDisabledError } from './persistence';

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
 * an application restart. Coordinates concurrent preference changes with in-flight saves.
 */
export class ClipboardPersistencePolicy implements IPersistencePolicy {
  private readonly repoSource: AppSettingRepository | (() => AppSettingRepository | null);
  private writeFailureOverride = false;
  private inFlightSaves = new Set<Promise<unknown>>();
  private activeMutation: Promise<void> | null = null;

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
   *
   * Privacy / Fail-Closed Guarantees:
   * 1. Fails closed (returns false) immediately if any preference write has failed in the current process.
   * 2. Fails closed (returns false) if the database repository is unavailable.
   * 3. Fails closed (returns false) if the setting is missing, unset, or anything other than 'true'.
   * 4. Fails closed (returns false) on any database read error.
   */
  public async isPersistenceEnabled(): Promise<boolean> {
    if (this.writeFailureOverride) {
      return false;
    }

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
   *
   * Concurrency & Fail-Closed Guarantees:
   * 1. Awaits any in-flight saves before committing a disable operation, ensuring the disable
   *    request does not report completion while an older save remains capable of committing afterward.
   * 2. Once a disable request completes (successfully or unsuccessfully), no pending or future save
   *    can commit.
   * 3. A failed preference mutation activates the in-memory fail-closed override, strictly denying
   *    persistence permission in the current process.
   * 4. A successful explicit update to 'true' restores permission only after confirmation by the repository.
   */
  public async setPersistenceEnabled(enabled: boolean): Promise<boolean> {
    while (this.activeMutation) {
      await this.activeMutation;
    }

    if (typeof enabled !== 'boolean') {
      this.writeFailureOverride = true;
      throw new Error('Invalid persistence preference: expected boolean true or false.');
    }

    let releaseMutationLock!: () => void;
    this.activeMutation = new Promise<void>((resolve) => {
      releaseMutationLock = resolve;
    });

    try {
      if (this.inFlightSaves.size > 0) {
        await Promise.allSettled(Array.from(this.inFlightSaves));
      }

      const repo = this.getRepository();
      if (!repo) {
        this.writeFailureOverride = true;
        throw new Error(
          'Cannot update persistence preference: database repository is unavailable.',
        );
      }

      const stringValue = enabled ? 'true' : 'false';
      await repo.set(SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED, stringValue);
      // Confirmed stored value: clear any previous write failure override
      this.writeFailureOverride = false;
      return enabled;
    } catch (error) {
      // Any failed preference mutation must fail closed for persistence permission
      this.writeFailureOverride = true;
      throw error;
    } finally {
      this.activeMutation = null;
      releaseMutationLock();
    }
  }

  /**
   * Coordinates an in-flight persistence save with concurrent preference mutations.
   *
   * Guarantees:
   * 1. If a preference mutation is in progress, waits until it completes before proceeding.
   * 2. Checks permission inside the gate before authorizing the save.
   * 3. Registers the save so in-flight saves complete before any concurrent disable operation completes.
   * 4. Once a disable request completes, no pending or future save can commit.
   */
  public async coordinateSave<T>(saveFn: () => Promise<T>): Promise<T> {
    while (this.activeMutation) {
      await this.activeMutation;
    }

    const isAllowed = await this.isPersistenceEnabled();
    if (!isAllowed) {
      throw new PersistenceDisabledError();
    }

    const execute = async (): Promise<T> => {
      return await saveFn();
    };

    const savePromise = execute();
    this.inFlightSaves.add(savePromise);

    try {
      return await savePromise;
    } finally {
      this.inFlightSaves.delete(savePromise);
    }
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
