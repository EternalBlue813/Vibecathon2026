# StatusSphere - Technical Documentation

> **Documentation policy (mandatory):** whenever `server.js`, `.env.example`, database schema/migrations, API contracts, or frontend data flow changes, update **all** of these docs in the same change set:
> - `StatusSphere/instruction.md`
> - `StatusSphere/flowchart.md`
> - `StatusSphere/database/database.md`
> - `README.md`

---

## Overview

StatusSphere is a real-time infrastructure monitoring dashboard. Entities are database-driven (`entities` table), status is scraped/classified and cached in memory, snapshots are persisted in Supabase, and screenshots are captured to Supabase Storage.

Entity status fetching is source-driven:
- `generic_status_page` for the standard summary/status-page pipeline
- `aws_public_health` for AWS public health feeds

## Current Architecture

- Backend: `server.js` (Express)
- Persistence: Supabase Postgres (`snapshots`, `incidents`, `news_articles`, `entities`)
- Storage: Supabase bucket `entity-image-snapshot`
- Frontend:
  - `public/index.html` + `public/app.js` (homepage)
  - `public/detail.html` + `public/detail.js` (entity detail)

## Runtime Data Model

- Entities come from DB (`entities.is_active=true`) and are cached in:
  - `ENTITY_CONFIG`, `ALL_SLUGS`, `BANK_SLUGS`, `CLOUD_SLUGS`, `CDN_SLUGS`
- Entity source metadata comes from DB:
  - `status_source_kind`
  - `status_source_config`
- Status cache is in-memory:
  - `cache = { timestamp, data }`
  - each entry: `status`, `healthScore`, `incidents`, `news`, `regionImpact`, `fetchedAt`
- On-demand hydration from DB if cache is empty/default:
  - `ensureStatusDataReady()` hydrates from latest snapshots before serving `/status` and `/api/headline`

## Key Behaviors (Latest)

- Homepage entity/config load is API-first (server/DB first), browser cache second.
- `/api/config` ensures entities are loaded from DB before response.
- `/status` ensures DB-backed status hydration when memory is empty/default.
- `/api/headline` now also ensures status data is ready before composing fallback/LLM headline.
- Detail page loads last 5 snapshots by default (`/history?entity=<slug>&limit=5`).
- Screenshot history endpoint returns last 5 in-memory captures, or last 5 DB snapshot screenshot URLs when memory is empty.
- Incident severity for cloud/CDN uses scoped-impact classification (`classifyScopedIncidentStatus`) to avoid reporting provider-wide `Down` for limited regional impact.
- AWS public health pages use AWS's own public service/event feeds (`services.json`, `historyevents.json`) as structured evidence, then flow through the normal LLM decision path with scoped-impact safeguards.
- Screenshot capture is now scheduler-owned for steady-state operation; status polling only bootstraps a capture when no screenshot exists yet, which avoids overlapping startup captures.
- If the strict JSON LLM classifier fails, the server falls back to a simpler one-word LLM status decision before using non-LLM fallback logic.

## API Endpoints

- `GET /api/config`
  - Returns entity config map.
  - Ensures entity load from DB first.
  - Cached entity data includes source metadata.
- `GET /api/config/intervals`
  - Returns frontend/server polling values.
- `GET /status`
  - Returns current status map.
  - Ensures entities + DB hydration when memory is empty/default.
- `POST /api/entities/reload`
  - Forces entity refresh and cache hydration from DB.
- `GET /api/entity/:entity`
  - Returns metadata from `entities` plus latest `snapshots.polled_at`.
- `GET /history`
  - Returns snapshot history from DB.
  - Supports query params: `entity` (single slug), `limit` (default 20, max 50).
- `GET /news/:entity`
  - Returns DB-recent news first, otherwise fetches + persists.
- `GET /api/screenshot/:entity`
  - Latest screenshot meta in memory.
- `GET /api/screenshot/:entity/history`
  - Returns up to last 5 screenshots (memory-first, DB fallback via `snapshots.analysis_screenshot_url`).
- `GET /api/screenshot/:entity/rendered-text`
  - Rendered text extracted from screenshot session (memory).
- `GET /api/screenshots`
  - All in-memory screenshot metas.
- `GET /api/headline`
  - LLM headline with fallback template.
- `POST /api/chat`
  - Guardrailed infra-status chat.

## Environment Variables

Based on `.env.example` and `server.js`:

| Variable | Default | Notes |
|---|---|---|
| `SUPABASE_URL` | - | Required for DB/storage features |
| `SUPABASE_SERVICE_ROLE_KEY` | - | Primary server secret |
| `SUPABASE_SECRET_KEY` | - | Backward-compatible alias |
| `PORT` | `3000` | Express port |
| `CACHE_DURATION` | `120000` | Status cache ms |
| `NEWS_FETCH_INTERVAL` | `1800000` | News refresh ms |
| `HEADLINE_CACHE_DURATION` | `120000` | Headline cache ms |
| `SCREENSHOT_INTERVAL` | `60000` | Screenshot scheduler interval ms |
| `ENTITY_REFRESH_INTERVAL` | `1800000` | Entity refresh staleness window ms |
| `STATUS_POLL_INTERVAL` | `CACHE_DURATION` | Optional server-side scheduled status interval |
| `FRONTEND_STATUS_POLL_INTERVAL` | `120000` | Dashboard/detail polling |
| `FRONTEND_HEADLINE_POLL_INTERVAL` | `120000` | Headline polling |
| `FRONTEND_SCREENSHOT_POLL_INTERVAL` | `15000` | Detail screenshot polling |
| `LLM_API_KEY` | - | Primary LLM key |
| `OPENROUTER_API_KEY` | - | Backward-compatible LLM key alias |
| `LLM_MODEL` | `google/gemini-2.0-flash-001` | Chat/completion model |
| `OPENROUTER_MODEL` | `google/gemini-2.0-flash-001` | Backward-compatible model alias |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible base URL |

## Database Change Required

Run:

- `StatusSphere/database/009-entity-status-source-config.sql`

This adds to `entities`:
- `status_source_kind TEXT NOT NULL DEFAULT 'generic_status_page'`
- `status_source_config JSONB NOT NULL DEFAULT '{}'::jsonb`

Behavior after migration:
- all existing entities remain on `generic_status_page`
- only `aws` is switched to `aws_public_health`
- `status_page_url` remains unchanged and is still used for screenshots/detail links

## Operations Notes

- Add/update entities directly in `entities`; frontend tiles are generated from `/api/config`.
- Use `POST /api/entities/reload` to force immediate refresh without restart.
- Never edit old migration files; add new numbered migration files.

---

## Last Updated

Document version: 3.6
Last updated: 2026-04-01

## Changelog

| Version | Date | Changes |
|---|---|---|
| 3.6 | 2026-04-01 | Added mandatory cross-doc update policy; documented DB-first hydration for `/api/config`, `/status`, `/api/headline`; documented `/history` query params (`entity`, `limit`); documented screenshot history last-5 memory-first with DB fallback; documented scoped incident classification for regional cloud/CDN incidents; documented AWS public feed adapter (`services.json`, `historyevents.json`) and DB-driven entity source config via `status_source_kind`/`status_source_config`; synced env vars with `.env.example` + `server.js` |
