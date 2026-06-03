# wa-dashboard

WhatsApp supply-chain dashboard. Read-only ingestion of messages across many
groups/numbers into Postgres, with a tracking layer and dashboard added later.

## Phase 0 (this scaffold)
One number links via QR. The Baileys session is stored in Postgres (survives
redeploys). Messages log to the console. The connection reconnects with backoff.

## Run locally
1. `docker compose up -d`            # Redis only; Postgres is remote Neon
2. `cp .env.example .env`            # set DATABASE_URL to the Neon direct URL
3. `pnpm install`
4. `pnpm migration:run`             # creates wa_session + wa_auth_key
5. `pnpm worker:dev`                # scan the QR shown in the terminal

Link from the phone: WhatsApp > Settings > Linked devices > Link a device.
