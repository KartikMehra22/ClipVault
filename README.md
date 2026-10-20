# ClipOrbit

ClipOrbit is a privacy-first, local-first desktop clipboard manager designed to give users fast, secure, and structured control over their clipboard history, snippets, and shortcuts.

> **Current Phase**: **Phase 1 — Repository Scaffold Only**. No application features, UI components, native clipboard listeners, or database models are implemented yet.

---

## Planned Technology Stack

- **Desktop Shell**: Electron (native OS integration, global shortcuts, system tray, and restricted IPC)
- **Renderer UI**: Next.js with React & TypeScript (context-isolated desktop interface)
- **Local Persistence**: SQLite with Prisma ORM (local-first persistence)
- **Contracts**: Shared TypeScript definitions for IPC and synchronization
- **Remote Synchronization (Future)**: Express with PostgreSQL (optional cross-device sync)
- **Monorepo Management**: pnpm workspaces & TypeScript

---

## Workspace Structure

```
cliporbit/
├── apps/
│   ├── desktop/      # Electron main and preload process scaffolding
│   ├── renderer/     # Next.js UI scaffolding
│   └── api/          # Express sync API scaffolding
├── packages/
│   ├── contracts/    # Shared IPC and sync contract definitions
│   └── database/     # Prisma and SQLite persistence scaffolding
├── docs/
│   ├── architecture/ # System architecture and responsibility design
│   ├── product/      # Product roadmap and phase planning
│   └── security/     # Security principles, isolation, and threat modeling
├── scripts/          # Workspace maintenance and build scripts
└── .github/          # CI/CD and automation workflows
```

---

## High-Level Roadmap

- **Phase 1: Repository Scaffold & Configuration** _(Current)_
- **Phase 2: Shared Contracts & Type Specifications**
- **Phase 3: Local Persistence Layer (Prisma & SQLite)**
- **Phase 4: Electron Native Desktop Integration & IPC Bridge**
- **Phase 5: Renderer UI & Next.js Desktop Experience**
- **Phase 6: Privacy Controls, Content Filtering & Local Encryption**
- **Phase 7: Optional Remote Sync Service (Express & PostgreSQL)**

For detailed phase breakdowns, see [docs/product/ROADMAP.md](docs/product/ROADMAP.md).
For architectural responsibilities, see [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md).
For security guidelines, see [docs/security/SECURITY.md](docs/security/SECURITY.md).

---

## License

This project is licensed under the [MIT License](LICENSE).
