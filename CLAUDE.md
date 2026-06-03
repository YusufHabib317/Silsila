# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A read-only WhatsApp ingestion system for a clothing supply chain (factory → agent → marketer → customer). It links to the client's WhatsApp number(s) as a companion device via **Baileys** and archives every message into Postgres, with a human-curated tracking layer and dashboard added in later phases.

**This is Phase 0** — connectivity only. One number links via QR, the auth session persists in Postgres, and incoming messages log to the console. The full multi-phase plan and the complete target schema live in `docs/ARCHITECTURE.md`, which is the canonical project reference — read it before building anything beyond the current scaffold.

## Commands

Run from the repo root (pnpm workspace, `pnpm@9`):

```bash
docker compose up -d          # Redis only; Postgres is remote Neon
cp .env.example .env          # set DATABASE_URL to the Neon direct URL
pnpm install
pnpm migration:run            # creates wa_session + wa_auth_key
pnpm worker:dev               # starts the worker; scan the QR shown in the terminal
```

- `pnpm migration:run` / `pnpm migration:revert` — apply / roll back migrations (delegates to `@wa/entities`).
- `pnpm --filter @wa/entities migration:generate -d src/data-source.ts <path>` — generate a migration from entity changes.
- `pnpm worker:dev` — Node watch mode with `ts-node`; `pnpm --filter @wa/worker start` runs once without watch.
- No test or lint setup exists yet. TypeScript runs via `tsx`/`ts-node` directly (no build step in dev).

To re-pair a number: WhatsApp → Settings → Linked devices → Link a device, then scan the terminal QR.

## Architecture

Monorepo with two workspaces (`apps/*`, `packages/*`):

- **`packages/entities`** (`@wa/entities`) — the single source of truth for the TypeORM `DataSource`, entities, and migrations. Both the worker and (later) the API import from here. `AppDataSource` (`data-source.ts`) reads `DATABASE_URL` / `DATABASE_SSL`; Phase 0 uses a remote Neon direct URL with SSL on.
- **`apps/worker`** (`@wa/worker`) — the long-running ingestion process. `index.ts` initializes the DataSource and starts one `WaConnection`.

### Worker internals

- **`WaConnection`** (`wa-connection.ts`) owns the lifecycle of **exactly one** WhatsApp number: connect, show QR, log messages, reconnect with exponential backoff (2s → 60s cap). One instance == one number; running two instances on the same number causes duplicate sessions and risks a ban.
- **`useDbAuthState`** (`db-auth-state.ts`) is a Postgres-backed replacement for Baileys' `useMultiFileAuthState`. All auth state (creds + signal keys) is stored in the `wa_auth_key` key-value table, serialized with Baileys' `BufferJSON`. This is what makes the worker stateless on disk so a redeploy never drops the QR pairing. `app-state-sync-key` values must be rehydrated into their proto type on read.
- Messages are read from `messages.upsert` with `type === 'notify'` only (live messages, not history backfill).

### Non-negotiable invariants

These come from `docs/ARCHITECTURE.md` and the ban-avoidance strategy — preserve them:

- **Read-only.** The system never sends. `markOnlineOnConnect: false`, `syncFullHistory: false`. Never add sending behavior — it is the single biggest ban-risk lever.
- **Never `synchronize: true`.** It silently alters tables. Always use explicit migrations (`synchronize: false` is set and must stay).
- **One worker instance per number.** In production the worker runs as a single Render Background Worker with autoscaling off.
- **Backoff, not a tight reconnect loop.** Hammering reconnections looks bot-like. `DisconnectReason.loggedOut` must NOT reconnect — it needs a fresh human QR scan.
- Store Baileys auth in Postgres, never on disk (Render's filesystem is ephemeral).

### Environment

- `DATABASE_URL` — Neon direct Postgres connection URL for the Phase 0 worker.
- `DATABASE_SSL` — `true` for Neon/managed PG.
- `ACCOUNT_ID` — a stable human label for the WhatsApp number (e.g. `client-main`). One worker process = one `ACCOUNT_ID`, which becomes the `wa_session.id` / `wa_auth_key.session_id`.

### Current schema (Phase 0)

- `wa_session` — one row per linked number; tracks connection `status` and `last_seen_at`. Grows into the richer `accounts` table in Phase 2.
- `wa_auth_key` — `(session_id, key)` key-value store for Baileys auth. `key` is `creds` or `<type>-<id>` for signal keys.

The full target schema (raw archive layer + human tracking layer: `contacts`, `chats`, `messages`, `media`, `transactions`, `payments`, etc.) is specified in `docs/ARCHITECTURE.md` §6. When adding entities, follow its naming and the two-layer split (auto-written append-only archive vs. human-curated tracking).
