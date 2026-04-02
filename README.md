# StatusSphere

Real-time infrastructure status monitoring dashboard. StatusSphere tracks database-driven entities across cloud providers, CDNs, and banks by polling status pages/APIs, classifying issues with an LLM, and surfacing results in a live dashboard.

## What It Does

- Status monitoring with normalized states: `Healthy`, `Warning`, `Partial`, `Down`, `Maintenance`, `Unknown`
- Live screenshot capture to Supabase Storage (`entity-image-snapshot`)
- News aggregation from Google News RSS
- LLM-generated headlines and guarded infrastructure chat
- DB-first cold-start behavior for config/status/headline endpoints
- Detail-page fallback to last 5 snapshots/screenshots when memory cache is empty
- AWS uses its public health data feeds for more accurate current status instead of relying on the page shell alone
- Entity source strategy is DB-driven, so non-AWS entities remain on the normal generic status-page path by default

See:
- `StatusSphere/flowchart.md` for trigger/data flow
- `StatusSphere/database/database.md` for schema details
- `StatusSphere/instruction.md` for technical behavior and maintenance policy

## Prerequisites

- Node.js v18+
- Supabase project (database + storage)

## Setup

### 1) Install

```bash
cd StatusSphere
npm install
```

### 2) Run Migrations (in order)

| Order | File |
|---|---|
| 1 | `database/001-initial.sql` |
| 2 | `database/002-add-banks.sql` |
| 3 | `database/003-entities.sql` |
| 4 | `database/004-fix-provider-constraint.sql` |
| 5 | `database/005-allow-maintenance-partial-status.sql` |
| 6 | `database/006-add-snapshot-analysis-columns.sql` |
| 7 | `database/007-news-dedupe-per-entity.sql` |
| 8 | `database/008-retention-12h-and-storage-cleanup.sql` |
| 9 | `database/009-entity-status-source-config.sql` |

### 3) Configure Environment

```bash
cp .env.example .env
```

Core values from `.env.example`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
PORT=3000

CACHE_DURATION=120000
NEWS_FETCH_INTERVAL=1800000
HEADLINE_CACHE_DURATION=120000
SCREENSHOT_INTERVAL=60000
ENTITY_REFRESH_INTERVAL=1800000

FRONTEND_STATUS_POLL_INTERVAL=120000
FRONTEND_HEADLINE_POLL_INTERVAL=120000
FRONTEND_SCREENSHOT_POLL_INTERVAL=15000

LLM_API_KEY=your-llm-api-key-here
LLM_MODEL=google/gemini-2.0-flash-001
LLM_BASE_URL=https://api.groq.com/openai/v1
```

Notes:
- `SUPABASE_SECRET_KEY` is also supported as a backward-compatible alias.
- `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` are supported legacy aliases.
- `STATUS_POLL_INTERVAL` is optional; if unset, server scheduler uses `CACHE_DURATION`.
- After migration `009`, only `aws` changes behavior automatically; other entities continue to work as before.

### 4) Start

```bash
npm start
```

Open `http://localhost:3000`.

## Key API Endpoints

- `GET /api/config`
- `GET /api/config/intervals`
- `GET /status`
- `POST /api/entities/reload`
- `GET /api/entity/:entity`
- `GET /history?entity=<slug>&limit=<n>`
- `GET /news/:entity`
- `GET /api/screenshot/:entity/history`
- `GET /api/headline`
- `POST /api/chat`

## Documentation Rule

When backend behavior, env vars, database schema, or API flow changes, update these files together:

- `StatusSphere/instruction.md`
- `StatusSphere/flowchart.md`
- `StatusSphere/database/database.md`
- `README.md`
