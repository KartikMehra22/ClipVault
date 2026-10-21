# ClipOrbit Security Principles & Threat Model

> **Status**: Planned Security Architecture. Guidelines apply to all upcoming implementation phases.

---

## 1. Core Security Principles

ClipOrbit operates on sensitive user data (clipboard contents, code snippets, credentials). Security is a core architectural pillar rather than a post-implementation consideration.

### 1.1 Privacy-First & Local-First

- All clipboard history, metadata, and settings are stored locally on the user's workstation.
- Network access is disabled by default; remote synchronization is strictly opt-in and utilizes client-side zero-knowledge encryption.

### 1.2 Electron Process Isolation

- **Node Integration Disabled**: `nodeIntegration: false` is enforced on all `BrowserWindow` configurations.
- **Context Isolation Enabled**: `contextIsolation: true` ensures the renderer cannot access or mutate preload or Electron internals.
- **Sandboxing**: `sandbox: true` restricts OS access in renderer execution contexts.
- **Navigation Lockdown**: Webviews and unexpected navigations are blocked; external URLs must open only via explicit system handlers (`shell.openExternal`) after strict protocol validation (`https:` only).

### 1.3 Minimal & Typed IPC Surface

- No generic `ipcRenderer.send()` or `ipcRenderer.invoke()` channels exposed to the DOM.
- The preload bridge exposes only explicit, strongly-typed methods declared in `@cliporbit/contracts`.
- All incoming payloads to Electron main handlers must undergo runtime schema validation.

---

## 2. Threat Model & Known Risks

| Risk Area                     | Threat Description                                                           | Planned Mitigation                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Sensitive Clipboard Data**  | Accidental capture of passwords, TOTP tokens, API keys, or recovery phrases. | Source application ignore lists (e.g., 1Password, Bitwarden, Keychain), regex-based credential pattern detection, and automatic expiry. |
| **Renderer Compromise (XSS)** | Injection of malicious content through copied rich text or HTML clips.       | Plaintext normalization, HTML sanitization before rendering, strict Content Security Policy (CSP), and no DOM access to Node.js.        |
| **Data at Rest Exposure**     | Unauthorized local file inspection of the SQLite database.                   | Optional master-password / OS keychain-backed encryption at rest for sensitive history entries.                                         |
| **Sync Server Data Leakage**  | Compromise of the future remote synchronization service.                     | Client-side end-to-end encryption (E2EE); the sync server stores only ciphertext and metadata necessary for ordering.                   |
| **Memory Dump Exposure**      | Retention of sensitive clipboard data in volatile RAM indefinitely.          | Secure memory clearing where possible, configurable history retention limits, and manual purge triggers.                                |

---

## 3. Security Guidelines for Developers

1. **Never bypass IPC validation**: Every IPC message payload must be validated before execution in the main process.
2. **Never expose secrets**: Secrets, tokens, and encryption keys must never be logged or transmitted in unencrypted IPC messages.
3. **Keep dependencies minimal**: Avoid external dependencies in the desktop main process and preload bridge to minimize supply-chain surface area.
4. **Never store plaintext clipboard payloads**: The database schema strictly prohibits plaintext content columns. All clipboard contents and snippets must be encrypted prior to database insertion.

---

## 4. Database Schema Privacy Architecture

Phase 4.2 establishes the local database schema with defensive security constraints:

### 4.1 Plaintext Column Prohibition

The `Clip` and `Snippet` tables explicitly define `encrypted_payload` and `encrypted_content` BLOB columns alongside `encryption_nonce`, `encryption_auth_tag`, and `encryption_version`. No raw text, unencrypted previews, or plaintext payload fields are defined in the schema.

### 4.2 Cryptographic Boundaries

- **Payload Encryption**: Actual authenticated encryption (AES-256-GCM / XChaCha20-Poly1305) will be implemented in a subsequent phase. In Phase 4.2, no cryptographic engine is active; persistent data is not yet protected.
- **Database Metadata**: In SQLite, metadata columns (`content_type`, `source_app`, `payload_byte_length`, `created_at`, `pinned_at`, `expires_at`, `is_sensitive`) are unencrypted and visible to anyone inspecting the SQLite file.
- **Full-Database Encryption vs. Envelope Encryption**: Column-level encryption protects payload contents but does not encrypt SQLite database file headers, table catalogs, or index trees. Full-database encryption is distinct from column-level envelope encryption.
- **AppSetting Separation**: The `app_settings` table is reserved strictly for non-secret user preferences. Encryption master keys, derived tokens, and passwords must never be stored in this table.
