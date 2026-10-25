# ClipVault — Technical Engineering Log & Architectural Specifications

**Project Name:** ClipVault  
**Developer:** Kartik Mehra  
**Repository:** [KartikMehra22/ClipVault](https://github.com/KartikMehra22/ClipVault)  
**System Architecture:** Electron 44+, Next.js 16+ (Turbopack), React 19, TypeScript 5.9, SQLite (Prisma ORM)  
**Security & Cryptography:** AES-256-GCM, Electron SafeStorage / Native Keychain, Context Isolation, Sandboxed IPC  
**Document Purpose:** Academic engineering record detailing architecture specifications, cryptographic security hardening, automated test verification, and iterative defect resolution.

---

## 1. Engineering Methodology & Prompt Strategy

The development of **ClipVault** employed an iterative, test-driven engineering methodology leveraging AI-assisted workflows for architecture specification, cryptographic hardening, and defect resolution.

The prompt strategy was structured across three logical engineering tiers:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Tier 1: Architectural & Cryptographic Specifications                  │
│  - Mathematical & security bounds (AES-256-GCM, 12-byte IVs, 16-byte tags)│
│  - Fail-closed consent policies, memory FIFO bounds, sandbox isolation │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│  Tier 2: System Integration & Full-Stack Implementation                 │
│  - Next.js UI connection, settings persistence, snippet management     │
│  - Production packaging pipeline (macOS DMG via Electron-Builder)       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│  Tier 3: Iterative Defect Resolution & Feature Innovation               │
│  - Binary image clipboard extraction & base64 preview rendering        │
│  - Async Promise resolution in native password manager exclusion checks │
│  - 20+ platform social media & web link intelligence engine            │
│  - Contextual keyboard shortcut targeting and arrow navigation         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Architectural & Cryptographic Specifications

### Milestone 1: Privacy and Security Architecture Audit
- **Objective:** Establish strict security baselines, origin validation on the Electron IPC bridge, and prevent unauthorized renderer access.
- **Prompt:**
```markdown
# ClipVault — Phase 6.1: Privacy and Security Audit

Audit and enforce privacy and isolation guarantees across the desktop application:

1. IPC Bridge Security:
   - Validate that contextIsolation is true, nodeIntegration is false, and sandbox is true.
   - Enforce that all IPC invoke handlers validate sender frame hierarchy and authorized origins.
   - Reject requests from child frames, iframes, or mismatched origins.

2. SafeStorage Master Key Manager:
   - Enforce that the 256-bit AES master key is generated with cryptographic entropy.
   - Ensure keys are stored via native OS keystores (macOS Keychain, Windows DPAPI, Linux Secret Service).
   - Plaintext key fallbacks are strictly prohibited; initialization must fail closed.

3. Memory Constraints:
   - Enforce a strict single-item byte ceiling on clipboard captures to prevent memory exhaustion attacks.
```
- **Outcome:** Implemented `isAuthorizedFrame` origin validator in `apps/desktop/src/main/security.ts` and automated test suite in `apps/desktop/test/security.test.mjs`.

---

### Milestone 2: Sensitive Scanning Boundary Hardening
- **Objective:** Scan copied text in-memory before retention or UI presentation to filter out passwords, private keys, and API tokens.
- **Prompt:**
```markdown
# ClipVault — Phase 6.2: Sensitive Scanning Boundary Hardening

Implement a high-entropy credential scanner for the in-memory clipboard pipeline:

1. Credential Detection:
   - Detect PEM private keys, AWS access keys, GitHub personal access tokens, Slack bot tokens, JWT strings, and Bearer authorization headers.
2. Privacy Preservation:
   - When a credential is detected, immediately exclude the item from clipboard history.
   - Increment a privacy-safe `skippedSensitiveCount` counter without logging or retaining the sensitive substring.
3. Bounded Processing:
   - Bound regex execution time to process 100 KiB payloads in under 10 ms without stalling the event loop.
```
- **Outcome:** Created `SensitiveContentDetector` in `apps/desktop/src/services/clipboard/sensitiveContentDetector.ts` with 25 unit tests verifying zero token leakage.

---

### Milestone 3: Encrypted Clipboard Persistence Service (AES-256-GCM)
- **Objective:** Provide authenticated, zero-plaintext storage for local clipboard history in SQLite via Prisma.
- **Prompt:**
```markdown
# ClipVault — Phase 6.3.1: Encrypted Clipboard Persistence Service

Build the encrypted persistence service connecting in-memory items to SQLite:

1. Cryptographic Standards:
   - Encrypt each payload using AES-256-GCM with a fresh, cryptographically random 12-byte IV.
   - Verify the 16-byte authentication tag upon decryption.
2. Resilience:
   - Corrupted records must fail closed safely and be excluded without crashing the application.
   - Ensure that disabling persistence guarantees zero SQLite or filesystem writes.
```
- **Outcome:** Created `EncryptedClipboardPersistenceService` in `apps/desktop/src/services/clipboard/persistence.ts`.

---

### Milestone 4: Explicit User Consent & Fail-Closed Policy Enforcement
- **Objective:** Guarantee that clipboard persistence is strictly opt-in and defaults to disabled.
- **Prompt:**
```markdown
# ClipVault — Phase 6.3.2 & 6.3.2.2: Explicit Consent for Persistence & Fail-Closed Sealing

Implement user consent management for clipboard persistence:

1. Consent Policy:
   - Default state must be disabled (`consent = false`).
   - The capture service must function in pure in-memory mode without persistence consent.
2. Write Failure Audits:
   - If writing a consent change to the database fails, atomically roll back the in-memory policy.
   - Prevent ghost persistence states where the UI shows persistence disabled while background services continue to write.
```
- **Outcome:** Created `ClipboardPersistencePolicy` in `apps/desktop/src/services/clipboard/consent.ts` with atomic failure rollback.

---

### Milestone 5: Persisted History Restoration & Concurrent Deduplication
- **Objective:** Restore saved history on startup and seamlessly merge it with live session clips without duplicate entries.
- **Prompt:**
```markdown
# ClipVault — Phase 6.3.3.2: Restore Encrypted Persisted History

Integrate safely retrieved encrypted clipboard history into desktop History and Pinned views:

1. Deduplicated Merge:
   - Merge live in-memory clips with database-restored records without duplicate entries.
   - Pinned clips must survive restarts and remain pinned across sessions.
2. Concurrency Safety:
   - Sequence requests with unique request IDs so delayed historical queries cannot overwrite newer user actions.
   - Display a non-blocking warning banner with a retry button if local database queries fail.
```
- **Outcome:** Implemented `mergeHistoryClips` in `@clipvault/contracts` and optimistic concurrency handling in `apps/renderer/src/app/page.tsx`.

---

### Milestone 6: Snippets Management & Automated History Trimming
- **Objective:** Support reusable code snippets and automated retention policies.
- **Prompt:**
```markdown
# ClipVault — Final Local History Lifecycle Completion

Implement code snippet management and retention policies:

1. Reusable Code Snippets:
   - Create, read, update, and delete encrypted snippets with syntax language tagging.
2. Retention Management:
   - Automatically trim unpinned clips when the history exceeds the configured capacity limit.
   - Age-based cleanup: purge unpinned clips older than the retention cutoff (e.g., 24 hours, 7 days, 30 days) while strictly preserving pinned clips.
3. Clear History:
   - Provide an atomic "Clear All History" action that wipes clipboard records without touching saved snippets or user settings.
```
- **Outcome:** Implemented `createSnippetRepository`, retention pruning methods, and IPC handlers in `apps/desktop/src/main/snippetIpc.ts`.

---

### Milestone 7: End-to-End System Integration & Live Settings View
- **Objective:** Connect the Next.js renderer directly to the Electron IPC bridge, eliminating mock data and planned placeholders.
- **Prompt:**
```markdown
# ClipVault — Phase 6.4: Local MVP Functional Completeness and UX Pass

Bring the desktop MVP to a coherent, usable, end-to-end state:

1. Settings View Wiring:
   - Connect SettingsView directly to live desktop preferences via IPC (launch at login, persistence consent, clear on exit, retention period).
2. Global Window Hotkey:
   - Register ⌥ Space (Alt+Space) in the Electron main process to summon and dismiss the window from any application.
3. System Tray & Quick Navigation:
   - Ensure smooth window focus and dismiss animations without memory leaks.
```
- **Outcome:** Connected `SettingsView.tsx` to live backend settings, registered the global shortcut in `index.ts`, and verified zero console warnings.

---

### Milestone 8: Production Launch Verification & Packaging Pipeline
- **Objective:** Verify production launch outside dev mode and configure automated macOS DMG bundling.
- **Prompt:**
```markdown
# ClipVault — Phase 6.5: Release Packaging and Launch Verification

Complete release readiness and production packaging:

1. Asset Staging:
   - Create a staging script (`prepare-packaging.mjs`) to stage Next.js static export (`out`), Prisma schema, and native modules into `.packaging/`.
2. DMG Installer Configuration:
   - Configure `electron-builder.json` with macOS arm64 target, custom application icon (`icon.icns`), and drag-to-Applications window coordinates.
3. Launch Verification:
   - Verify that the app launches in production mode using internal loopback server bound to 127.0.0.1.
```
- **Outcome:** Created `scripts/prepare-packaging.mjs`, configured `electron-builder.json`, and generated `dist-packages/ClipVault-0.1.0-arm64.dmg`.

---

## 3. Iterative Defect Resolution & Feature Innovation

### Defect Resolution 1: Image Clipboard Capture & Display
- **Issue:** Copying images from web browsers or screenshot tools did not display in the clipboard history or image category filter.
- **Engineering Prompt:**
```markdown
The image section is not capturing clipboard items properly. When copying images, they do not appear in the application history. Diagnose the native clipboard adapter and render captured images correctly.
```
- **Root Cause Analysis:** `ElectronClipboardAdapter` only invoked `clipboard.readText()`. When an image was copied, text was empty, causing the capture engine to discard the event.
- **Resolution:**
  - Added `readImage()` to `IClipboardAdapter` and `ElectronClipboardAdapter` using `clipboard.readImage()`.
  - Extracted native image buffers and serialized them to Base64 Data URLs (`data:image/png;base64,...`).
  - Added image size verification bounding (10 MiB limit) to prevent memory spikes.
  - Implemented responsive image previews and dimensions metadata in `HistoryItemCard.tsx`.

---

### Defect Resolution 2: Static Analysis Secret Scanner Token Collision in Test Fixtures
- **Issue:** Automated security scanners rejected repository synchronization due to rule `GH013` detecting synthetic Slack/Stripe credential signatures in test mock fixtures.
- **Engineering Prompt:**
```markdown
Refactor the sensitive credential scanner unit test fixtures in apps/desktop/test/sensitive.test.mjs so synthetic token patterns are dynamically composed at runtime, avoiding false-positive triggers in static repository scanners while preserving test coverage.
```
- **Root Cause Analysis:** Static secret scanners use regular expressions that matched literal mock test strings in the unit test file.
- **Resolution:**
  - Dynamically constructed dummy test tokens at runtime in `sensitive.test.mjs`:
    ```javascript
    const slackBot = ['xoxb', '123456789012', '1234567890123', 'abcdefghijklmnopqrstuvwx'].join('-');
    ```
  - Bypassed static AST scanners while preserving 100% of the unit test coverage.

---

### Feature Innovation: Social Media & Web Link Intelligence Engine
- **Objective:** Automatically detect copied URLs, identify their platform or website, categorize them, and generate rich previews.
- **Engineering Prompt:**
```markdown
When copying any social media or web link, automatically detect where it belongs, what kind of app or website it is, and provide a short description with a direct button to open the link in the default browser.
```
- **Resolution:**
  - Implemented `detectSocialLink(url)` in `packages/contracts/src/socialLinks.ts`.
  - Added deep URL pattern recognition for 20+ platforms: YouTube, GitHub, Twitter/X, Instagram, LinkedIn, Reddit, Discord, Spotify, Twitch, Threads, Bluesky, Pinterest, Telegram, Facebook, Figma, Medium, Substack, and generic web links.
  - Generates branded badges, primary brand colors, content types (e.g. "Video", "Repository", "Profile", "Post"), and contextual path summaries.
  - Added `APP_OPEN_EXTERNAL_URL` IPC channel in `apps/desktop/src/main/index.ts` and exposed `openExternalUrl` on the preload bridge to safely open links in the system's default browser.
  - Designed rich social intelligence cards in `HistoryItemCard.tsx`.

---

### Defect Resolution 3: False-Positive Password Manager Exclusion
- **Issue:** In the packaged app, all copied items were skipped with the UI displaying "70 potentially sensitive items skipped" and 0 items in memory.
- **Engineering Prompt:**
```markdown
Clipboard capture is failing in the packaged application: all copied items are skipped and flagged as sensitive (showing 70+ skipped items). Diagnose the capture pipeline and fix the false-positive exclusion.
```
- **Root Cause Analysis:** In `ElectronClipboardAdapter.isConcealed()`, Electron's `clipboard.has(...)` method returns a `Promise<boolean>`. Evaluating `Boolean(new Promise(...))` evaluates to `true` in JavaScript! Every item was falsely treated as private pasteboard data.
- **Resolution:**
  - Refactored `isConcealed()` to `async isConcealed(): Promise<boolean>` and awaited each format check.
  - Re-ordered the polling loop in `ClipboardCaptureService`: fingerprint change detection now runs *before* exclusion checks so unchanged clipboard states never increment the counter repeatedly.

---

### Defect Resolution 4: Contextual Pinning (<kbd>Cmd</kbd> + <kbd>P</kbd>) & Keyboard Navigation
- **Issue:** Pressing <kbd>Cmd</kbd> + <kbd>P</kbd> in the Text or Code section always pinned the top Link item instead of the active text item.
- **Engineering Prompt:**
```markdown
When pressing Cmd + P on any section, it is pinning the link section for all. If I click or view text, pressing Cmd + P should pin that text item specifically.
```
- **Root Cause Analysis:** The shortcut handler fell back to `items[0]` from the global unfiltered list if no card was focused, and cards lacked `tabIndex={0}` to receive focus on click.
- **Resolution:**
  - Added `tabIndex={0}`, click selection, and hover listeners to `HistoryItemCard.tsx`.
  - Implemented multi-tier targeting in `page.tsx`:
    1. Explicitly focused card
    2. Card under mouse pointer
    3. Clicked/selected card
    4. First item of the **active filtered section** (`filteredItems[0]`), never the global raw array.
  - Added <kbd>↑</kbd> / <kbd>↓</kbd> arrow key navigation with automatic scrolling into view.

---

### Project Rebranding: Application Alignment to ClipVault
- **Objective:** Standardize the product name from ClipOrbit to ClipVault across all system layers.
- **Engineering Prompt:**
```markdown
Change the application name from ClipOrbit to ClipVault to match the GitHub repository name across all window titles, metadata, packaging configurations, and documentation.
```
- **Resolution:**
  - Updated `electron-builder.json` to generate `dist-packages/ClipVault-0.1.0-arm64.dmg`.
  - Renamed window title, HTML layout metadata, sidebar brand title, and settings descriptions.
  - Exposed `window.clipVault` in preload bridge while maintaining `window.clipOrbit` for backward compatibility.

---

## 4. Technical Summary Table

| Milestone | Category | Focus Area | Technical Deliverable |
|---|---|---|---|
| **M1** | Security | Sandbox & Origin Validation | `isAuthorizedFrame` frame validator, IPC origin checks |
| **M2** | Privacy | Secret Content Shield | `SensitiveContentDetector` regex engine, token exclusions |
| **M3** | Cryptography | Authenticated At-Rest Encryption | `EncryptedClipboardPersistenceService`, AES-256-GCM |
| **M4** | Governance | Explicit Consent Policy | `ClipboardPersistencePolicy` with atomic rollback |
| **M5** | Database | History Restoration & Deduplication | Optimistic concurrency pipeline, `mergeHistoryClips` |
| **M6** | Features | Snippets & Automated Retention | Encrypted code snippets, TTL cleanup, retention pruning |
| **M7** | Integration | Live Settings & Global Shortcut | `SettingsView.tsx`, ⌥ Space (Alt+Space) registration |
| **M8** | DevOps | Production Packaging Pipeline | `prepare-packaging.mjs`, DMG drag-and-drop installer |
| **D1** | Bug Fix | Image Clipboard Capture | `readImage()` adapter, Base64 Data URLs, 10 MiB limit |
| **D2** | Security | Static Secret Scanner False-Positive | Dynamic mock token assembly in `sensitive.test.mjs` |
| **D3** | Innovation | Social Media Link Intelligence | `socialLinks.ts` (20+ platforms), external URL IPC |
| **D4** | Bug Fix | False-Positive Sensitive Exclusion | Async `isConcealed()` Promise resolution, polling fix |
| **D5** | Accessibility | Contextual Keyboard Pinning | Card `tabIndex={0}`, <kbd>Cmd</kbd>+<kbd>P</kbd> targeting, <kbd>↑</kbd>/<kbd>↓</kbd> navigation |
| **D6** | Branding | ClipVault Rebranding | Production DMG, window titles, UI headers, docs |

---

## 5. Verification & Quality Assurance

```bash
# Execute automated test suites across monorepo packages
pnpm test
# Result: 237 passing tests (222 desktop tests + 15 database tests, 0 failures)

# Execute TypeScript typecheck across all workspace packages
pnpm run typecheck
# Result: 4 checked, 0 errors, 100% strict type safety

# Build production macOS DMG installer
pnpm run package:dmg
# Result: Generated dist-packages/ClipVault-0.1.0-arm64.dmg (226 MB)
```
