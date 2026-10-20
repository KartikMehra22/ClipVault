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

| Risk Area | Threat Description | Planned Mitigation |
|---|---|---|
| **Sensitive Clipboard Data** | Accidental capture of passwords, TOTP tokens, API keys, or recovery phrases. | Source application ignore lists (e.g., 1Password, Bitwarden, Keychain), regex-based credential pattern detection, and automatic expiry. |
| **Renderer Compromise (XSS)** | Injection of malicious content through copied rich text or HTML clips. | Plaintext normalization, HTML sanitization before rendering, strict Content Security Policy (CSP), and no DOM access to Node.js. |
| **Data at Rest Exposure** | Unauthorized local file inspection of the SQLite database. | Optional master-password / OS keychain-backed encryption at rest for sensitive history entries. |
| **Sync Server Data Leakage** | Compromise of the future remote synchronization service. | Client-side end-to-end encryption (E2EE); the sync server stores only ciphertext and metadata necessary for ordering. |
| **Memory Dump Exposure** | Retention of sensitive clipboard data in volatile RAM indefinitely. | Secure memory clearing where possible, configurable history retention limits, and manual purge triggers. |

---

## 3. Security Guidelines for Developers

1. **Never bypass IPC validation**: Every IPC message payload must be validated before execution in the main process.
2. **Never expose secrets**: Secrets, tokens, and encryption keys must never be logged or transmitted in unencrypted IPC messages.
3. **Keep dependencies minimal**: Avoid external dependencies in the desktop main process and preload bridge to minimize supply-chain surface area.
