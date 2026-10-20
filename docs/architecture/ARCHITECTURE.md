# ClipOrbit Architecture Specification

> **Status**: Architectural Specification (Planned). Implementation begins in subsequent phases.

This document outlines the planned responsibilities, architectural boundaries, and data flow across the workspace packages for ClipOrbit.

---

## 1. Architectural Overview

ClipOrbit is architected as a **local-first desktop application** with an optional cross-device synchronization backend:

```
┌────────────────────────────────────────────────────────┐
│                      Desktop Shell                     │
│  ┌──────────────────────┐    ┌──────────────────────┐  │
│  │   Renderer Process   │    │     Main Process     │  │
│  │   (Next.js / React)  │◄──►│      (Electron)      │  │
│  └──────────────────────┘IPC └──────────┬───────────┘  │
└─────────────────────────────────────────┼──────────────┘
                                          │ Direct Access
                               ┌──────────▼───────────┐
                               │    Local Database    │
                               │  (Prisma + SQLite)   │
                               └──────────┬───────────┘
                                          │ Optional Sync
                               ┌──────────▼───────────┐
                               │   Remote Sync API    │
                               │(Express + PostgreSQL)│
                               └──────────────────────┘
```

---

## 2. Component Responsibilities

### 2.1 Electron Main Process (`apps/desktop`)

The Electron main process serves as the privileged native desktop host.

- **Native OS Operations**: Interacting with system clipboard events, global keyboard shortcut registration, system tray integration, and native notification dispatch.
- **Window Lifecycle**: Management of overlay windows, search modals, and settings views.
- **Local Persistence Coordinator**: Performing database operations via the local Prisma client on behalf of the application.
- **IPC Handler & Security Boundary**: Exposing strictly typed, validated IPC channels to the preload bridge while keeping Node.js integration disabled in the renderer.

### 2.2 Preload API Bridge (`apps/desktop/src/preload`)

- **Restricted Surface**: Exposes only an explicit, immutable allowlist of methods to `window.cliporbit` using Electron's `contextBridge`.
- **Validation & Sanitization**: Validates parameters and isolates DOM/Renderer execution from privileged Electron APIs.

### 2.3 Next.js Renderer (`apps/renderer`)

The renderer represents the user-facing desktop UI.

- **UI & Presentation**: Built with Next.js (React) to render clipboard history lists, snippet managers, category filters, and user settings.
- **Strict Isolation**: Runs entirely in a sandboxed browser environment with `nodeIntegration: false` and `contextIsolation: true`.
- **Communication**: Communicates with native capabilities solely through the typed `window.cliporbit` preload API.

### 2.4 Local Database (`packages/database`)

- **Local Persistence**: Powered by Prisma ORM backed by SQLite.
- **Data Domains**: Stores clipboard history items, metadata, pinned entries, custom snippets, tags, and local settings.
- **Encryption at Rest**: Coordinates encryption for sensitive clipboard records before disk commit.

### 2.5 Shared Contracts (`packages/contracts`)

- **Type Safety**: Contains shared TypeScript interfaces, schemas, and enums for:
  - IPC channel names and message payload structures (`src/ipc/`).
  - Cross-device sync payload formats, mutation logs, and authentication tokens (`src/sync/`).

### 2.6 Remote Synchronization API (`apps/api`) _(Future)_

- **Decoupled Sync Server**: Express-based REST/WebSocket service backed by PostgreSQL.
- **End-to-End Encryption**: Stores zero-knowledge encrypted payloads where only user client devices hold decryption keys.
- **Conflict Resolution & Sync Log**: Tracks chronological client revisions for deterministic cross-device synchronization.

---

## 3. Communication Constraints

1. **No Direct Node Access in Renderer**: The renderer shall never import or execute Node.js APIs (`fs`, `child_process`, `net`, etc.).
2. **Contract Enforced IPC**: All IPC channels must be declared in `@cliporbit/contracts` with strict request/response types.
3. **Local Independence**: The desktop application must operate fully without network connectivity; remote sync is strictly optional.
