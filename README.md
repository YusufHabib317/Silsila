# wa-dashboard

WhatsApp supply-chain dashboard. Read-only ingestion of messages across many
groups/numbers into Postgres, with a tracking layer and dashboard added later.

## Current phase
One number links via QR. The Baileys session is stored in Postgres (survives
redeploys). Live messages are archived into the Phase 1 raw tables with
dedupe. Media files are not downloaded yet; attachment metadata is stored with
`storage_status = skipped` until the Phase 2 media pipeline.

## Run locally
1. `docker compose up -d`            # Redis only; Postgres is remote Neon
2. `cp .env.example .env`            # set DATABASE_URL to the Neon direct URL
3. `pnpm install`
4. `pnpm migration:run`             # creates auth + raw archive tables
5. `pnpm worker:dev`                # scan the QR shown in the terminal

Link from the phone: WhatsApp > Settings > Linked devices > Link a device.
