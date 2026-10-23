# ClipOrbit

ClipOrbit is a privacy-first, local-first desktop clipboard manager built with Electron, Next.js, React, TypeScript, and SQLite (via Prisma ORM). It gives users secure, structured control over clipboard history, pinned items, custom snippets, and privacy settings.

---

## Architecture & Privacy Guarantees

- **Local-First & Offline**: All operations run locally on the user's machine. No cloud accounts, external telemetry, or remote services are required.
- **Default-Off Clipboard Capture**: Clipboard capture is inactive upon launch. Monitoring only begins when the user explicitly clicks "Start Capture" in the interface.
- **Default-Off Encrypted Persistence**: By default, clips exist solely in process memory. Long-term SQLite persistence is opt-in via Settings. If saving consent preferences fails, persistence fails closed.
- **AES-256-GCM Encryption at Rest**: All persisted clipboard records and custom snippets are encrypted with AES-256-GCM using unique 12-byte initialization vectors and 16-byte authentication tags.
- **OS Secure Storage (`safeStorage`)**: The 256-bit encryption master key is protected using the operating system's native credential store (macOS Keychain, Windows DPAPI, or Linux Secret Service/KWallet). Plaintext key fallback is strictly rejected.
- **Sensitive Content Shield**: In-memory regex heuristics automatically scan copied text for credentials (private keys, AWS/GitHub/Stripe/Slack tokens, JWTs, Bearer headers) and excludes them before storage or UI presentation.
- **Sandbox & Isolation**: The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Main-process IPC handlers strictly validate sender origins and frame hierarchy.

---

## Workspace Structure

```
cliporbit/
├── apps/
│   ├── desktop/      # Electron main and preload process, lifecycle & crypto services
│   ├── renderer/     # Next.js React UI (History, Pinned, Snippets, Settings)
│   └── api/          # Express sync API scaffolding (future phase)
├── packages/
│   ├── contracts/    # Shared TypeScript DTOs and IPC channel definitions
│   └── database/     # Prisma client and SQLite repositories
├── scripts/          # Port management, workspace typecheck, and packaging scripts
└── .packaging/       # Staged production assets directory
```

---

## Prerequisites

- **Node.js**: `>= 22.0.0`
- **pnpm**: `>= 10.0.0`
- **Supported OS**: macOS (Apple Silicon / Intel), Windows 10/11, Linux with Secret Service / libsecret

---

## Installation & Setup

Clone the repository and install workspace dependencies:

```bash
pnpm install
```

---

## Running Locally

### Development Mode

Run the Next.js renderer and Electron main process concurrently:

```bash
pnpm run dev
```

- Automatically checks and ensures port `3000` is available.
- Next.js development server starts on `http://127.0.0.1:3000`.
- Electron starts and automatically polls/waits for the renderer to become available before displaying the window.

### Production Mode (Local Static Build)

Compile all packages and launch Electron using the static renderer export:

```bash
# 1. Build all packages (contracts, database, renderer export, desktop)
pnpm run build

# 2. Launch desktop shell
pnpm --filter @cliporbit/desktop start
```

In production mode, Electron serves the pre-rendered static export (`apps/renderer/out`) through an internal loopback server bound strictly to `127.0.0.1`.

---

## Packaging & Distribution

### Staging Production Assets

To compile all workspace projects and stage runtime assets into `.packaging/`:

```bash
pnpm run package:prepare
```

This compiles contracts, database clients, static renderer export (`apps/renderer/out`), and Electron main/preload scripts.

### Building macOS DMG Installer

To package the standalone Apple Silicon `.dmg` installer:

```bash
pnpm run package:dmg
```

This runs the packaging preparation pipeline and builds the macOS drag-and-drop DMG installer via `electron-builder`:

- **Installer Output**: `dist-packages/ClipOrbit-0.1.0-arm64.dmg`
- **Application Bundle**: `dist-packages/mac-arm64/ClipOrbit.app`
- **Custom Branding**: Bundled high-resolution multi-size app icon (`apps/desktop/build-resources/icon.icns`)
- **Features**: Drag-to-Applications installer window, isolated local SQLite persistence, AES-256-GCM encryption at rest.

---

## Testing & Quality Assurance

Run all workspace checks:

```bash
# Run unit, integration, and launch verification tests (225 passing tests)
pnpm test

# Run TypeScript typecheck across all workspace packages
pnpm run typecheck

# Run ESLint across all projects
pnpm run lint

# Check code formatting with Prettier
pnpm run format:check

# Auto-format code with Prettier
pnpm run format
```

---

## Data Storage Locations

Runtime data is stored exclusively in Electron's platform-specific `userData` directory:

| Operating System | Path                                       |
| ---------------- | ------------------------------------------ |
| **macOS**        | `~/Library/Application Support/ClipOrbit/` |
| **Windows**      | `%APPDATA%\ClipOrbit\`                     |
| **Linux**        | `~/.config/ClipOrbit/`                     |

Within `userData`:

- `data/cliporbit.sqlite`: SQLite database containing encrypted clips, snippets, and settings.
- `crypto/master-key.enc`: 256-bit AES master key encrypted with OS `safeStorage` (permissions: `0600`).

---

## Known Limitations

1. **Headless Linux Environments**: Requires an active Secret Service daemon (e.g. `gnome-keyring`, `ksecretsservice`) for Electron `safeStorage`. Without an OS-backed secure store, key initialization fails closed as designed.
2. **Code Signing**: Local DMG builds are unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`), requiring right-click -> "Open" on macOS Gatekeeper on machines without an Apple Developer ID certificate.
3. **Remote Synchronization**: Multi-device sync (`apps/api`) is planned for future phases; this release is 100% local-first.

---

## License

This project is licensed under the [MIT License](LICENSE).
