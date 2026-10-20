# ClipOrbit Product Roadmap

> **Status**: Planned Development Phases. Work progresses sequentially through reviewed phases.

---

## Development Phases

### Phase 1: Repository Scaffold & Configuration *(Current)*
- Initialize pnpm monorepo workspace and package structure.
- Define workspace packages (`apps/desktop`, `apps/renderer`, `apps/api`, `packages/contracts`, `packages/database`).
- Establish TypeScript base configuration, linting foundations, and repository guidelines.
- Author foundational planning documentation.
- **Deliverable**: Verified clean repository scaffold with zero application implementation code.

---

### Phase 2: Shared Contracts & Type Specifications
- Define IPC contract specifications and type definitions in `packages/contracts/src/ipc/`.
- Define remote synchronization data exchange types in `packages/contracts/src/sync/`.
- Establish runtime validation schemas for inter-process messages.
- **Deliverable**: Type-safe shared contracts ready for main, renderer, and API consumption.

---

### Phase 3: Local Database & Persistence Layer
- Configure Prisma schema with SQLite provider in `packages/database`.
- Define data models for clipboard history, snippets, pins, categories, and application settings.
- Implement database client initialization, migrations, and access repositories.
- **Deliverable**: Local persistence package capable of CRUD operations against local SQLite storage.

---

### Phase 4: Electron Native Desktop Integration & IPC Bridge
- Implement Electron main process lifecycle, window manager, and system tray.
- Implement native clipboard monitoring service and global hotkey bindings.
- Implement secure, restricted preload script using `contextBridge`.
- Register IPC handlers validating against `@cliporbit/contracts`.
- **Deliverable**: Native desktop wrapper running and emitting clipboard events securely.

---

### Phase 5: Renderer UI & Desktop Experience
- Configure Next.js application shell with React and Tailwind/vanilla CSS.
- Build clipboard history feed with real-time updates and search indexing.
- Build snippet management, categorization, pinning, and keyboard navigation.
- Build application settings and shortcut customization views.
- **Deliverable**: Interactive desktop user interface running in context isolation.

---

### Phase 6: Privacy Controls, Content Filtering & Local Encryption
- Implement sensitive-content detection (passwords, tokens, API keys, credit cards).
- Add application exclusion rules (e.g., ignore 1Password, Bitwarden, KeePass).
- Implement local encryption at rest for sensitive clipboard items.
- Implement automated retention and cleanup policies.
- **Deliverable**: Hardened privacy and encryption layer safeguarding local clipboard data.

---

### Phase 7: Optional Remote Synchronization Service
- Implement Express REST / WebSocket server in `apps/api` with PostgreSQL persistence.
- Implement client authentication, device registration, and end-to-end encrypted payload synchronization.
- Implement conflict-free synchronization log and revision handling.
- **Deliverable**: Optional self-hostable or cloud synchronization backend.
