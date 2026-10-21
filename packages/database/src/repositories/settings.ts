import { PrismaClient, type AppSetting } from '@prisma/client';
import { DatabaseValidationError, isRecordNotFoundError } from '../errors';

const SETTING_KEY_REGEX = /^[a-zA-Z0-9_.:-]+$/;
const MAX_KEY_LENGTH = 128;
const MAX_VALUE_LENGTH = 32768; // 32 KB character limit for non-secret preferences

/**
 * Patterns matching sensitive credentials, keys, and tokens.
 *
 * AppSetting is strictly restricted to non-secret preferences (such as UI themes,
 * retention durations, window size). Secrets, keys, and credentials must never
 * be stored in this table.
 */
const FORBIDDEN_KEY_PATTERNS = [
  /(?:^|[._-])(?:secret|password|passphrase|credential|auth[-_]?token|bearer[-_]?token|api[-_]?token|private[-_]?key|master[-_]?key|encryption[-_]?key)(?:$|[._-])/i,
  /^(secret|password|token|credential)$/i,
];

function validateSettingKey(key: unknown): string {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new DatabaseValidationError('Setting key must be a non-empty string.');
  }

  const trimmed = key.trim();
  if (trimmed.length > MAX_KEY_LENGTH) {
    throw new DatabaseValidationError(
      `Setting key exceeds maximum length of ${MAX_KEY_LENGTH} characters.`,
    );
  }

  if (!SETTING_KEY_REGEX.test(trimmed)) {
    throw new DatabaseValidationError(
      `Setting key contains invalid characters: "${trimmed}". Allowed: alphanumeric, underscores, dots, hyphens, and colons.`,
    );
  }

  for (const pattern of FORBIDDEN_KEY_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new DatabaseValidationError(
        `Setting key "${trimmed}" is prohibited. The AppSetting repository is strictly reserved for non-secret preferences and must never store encryption keys, credentials, passwords, or tokens.`,
      );
    }
  }

  return trimmed;
}

function validateSettingValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DatabaseValidationError(
      `Setting value must be a string. Received: ${typeof value}. Plaintext clipboard content or raw secret blobs are strictly prohibited.`,
    );
  }

  if (value.length > MAX_VALUE_LENGTH) {
    throw new DatabaseValidationError(
      `Setting value length (${value.length}) exceeds maximum permitted size of ${MAX_VALUE_LENGTH} characters.`,
    );
  }

  return value;
}

export class AppSettingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Reads a setting's string value by key.
   *
   * Returns null if the setting does not exist.
   */
  async get(key: string): Promise<string | null> {
    const validKey = validateSettingKey(key);
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: validKey },
    });
    return setting ? setting.value : null;
  }

  /**
   * Reads an individual setting model by key.
   *
   * Returns null if the setting does not exist.
   */
  async find(key: string): Promise<AppSetting | null> {
    const validKey = validateSettingKey(key);
    return this.prisma.appSetting.findUnique({
      where: { key: validKey },
    });
  }

  /**
   * Sets or updates a non-secret configuration setting.
   *
   * Rejects keys that represent secrets or credentials.
   * Rejects values exceeding reasonable input size limits (32KB).
   */
  async set(key: string, value: string): Promise<AppSetting> {
    const validKey = validateSettingKey(key);
    const validValue = validateSettingValue(value);

    return this.prisma.appSetting.upsert({
      where: { key: validKey },
      create: { key: validKey, value: validValue },
      update: { value: validValue },
    });
  }

  /**
   * Deletes a setting by key.
   *
   * Returns true if the setting was found and deleted.
   * Returns false if the setting did not exist (does not silently report success).
   */
  async delete(key: string): Promise<boolean> {
    const validKey = validateSettingKey(key);

    try {
      await this.prisma.appSetting.delete({
        where: { key: validKey },
      });
      return true;
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Lists all non-secret settings, stably sorted by key ASC.
   */
  async list(): Promise<AppSetting[]> {
    return this.prisma.appSetting.findMany({
      orderBy: { key: 'asc' },
    });
  }
}

export function createAppSettingRepository(prisma: PrismaClient): AppSettingRepository {
  return new AppSettingRepository(prisma);
}
