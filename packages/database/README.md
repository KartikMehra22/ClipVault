# @cliporbit/database

Local-first persistence layer for ClipOrbit, backed by Prisma ORM and SQLite.

## Privacy & Security Architecture

### 1. Payload Encryption vs. Database Columns

- The `Clip` and `Snippet` tables explicitly name sensitive data columns `encrypted_payload` and `encrypted_content` (with accompanying `encryption_nonce`, `encryption_auth_tag`, and `encryption_version` fields).
- There are **no plaintext content fields** (e.g., no `content`, `text`, or `preview` columns). This prevents accidental persistence of raw clipboard data by application code.
- **Important**: Payload-level authenticated encryption (e.g., AES-256-GCM or XChaCha20-Poly1305) will be implemented in a dedicated future phase. In Phase 4.2, the cryptographic service is **not yet implemented**, and no persistent data is considered protected yet.

### 2. Database Metadata Exposure

- Metadata columns (such as `content_type`, `source_app`, `payload_byte_length`, `created_at`, `pinned_at`, `expires_at`, and `is_sensitive`) are stored unencrypted in SQLite.
- Anyone with direct filesystem access to the SQLite `.db` file can inspect metadata entries and timeline timestamps even if payload bytes are encrypted.

### 3. Full-Database Encryption vs. Column-Level Envelope Encryption

- Naming a column `encrypted_payload` does **not** provide full-database encryption.
- SQLite database headers, page structures, unencrypted indexes, and WAL journal files remain plain SQLite unless full-disk or full-database encryption (e.g., SQLCipher) is applied.
- Merely storing ciphertext in BLOB columns protects the payload bodies against naive inspection, but does not obscure database schemas, item frequencies, or operational metadata.

### 4. Non-Secret Application Settings

- The `app_settings` table is strictly designated for **non-secret user preferences** (such as UI theme, retention days, window density).
- It **must never** be used to store encryption master keys, derived key material, user credentials, authentication tokens, or raw clipboard data.

---

## Development Scripts

Run from workspace root:

```bash
# Validate Prisma schema
pnpm --filter @cliporbit/database run db:validate

# Format Prisma schema
pnpm --filter @cliporbit/database run db:format

# Generate Prisma Client
pnpm --filter @cliporbit/database run db:generate

# Create and apply migrations in development
pnpm --filter @cliporbit/database run db:migrate:dev

# Check migration status
pnpm --filter @cliporbit/database run db:migrate:status

# Deploy migrations in production / packaging
pnpm --filter @cliporbit/database run db:migrate:deploy
```
