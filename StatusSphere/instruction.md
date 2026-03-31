# StatusSphere - Technical Documentation

> **Important:** Update this file whenever project changes are made.

---

## Overview

StatusSphere is a real-time infrastructure status monitoring dashboard that tracks the health of banks, cloud providers, and CDN services. The main dashboard shows green/red status tiles; clicking a tile opens a detail page with history chart, screenshot area, AI summary, and media news.

### Monitored Entities

| Entity | Slug | Category | Status Source |
|--------|------|----------|---------------|
| DBS | dbs | Bank | Live URL scrape (`url` + `status_page_url`) |
| OCBC | ocbc | Bank | Live URL scrape (`url` + `status_page_url`) |
| UOB | uob | Bank | Live URL scrape (`url` + `status_page_url`) |
| Citi | citi | Bank | Live URL scrape (`url` + `status_page_url`) |
| SCB | scb | Bank | Live URL scrape (`url` + `status_page_url`) |
| HSBC | hsbc | Bank | Live URL scrape (`url` + `status_page_url`) |
| Maybank | maybank | Bank | Live URL scrape (`url` + `status_page_url`) |
| AWS | aws | Cloud | AWS Health API |
| Azure | azure | Cloud | Azure Status Feed (RSS) |
| Google Cloud | gcp | Cloud | Google Cloud Status JSON |
| Cloudflare | cloudflare | CDN | Statuspage API |
| Akamai | akamai | CDN | Statuspage API |

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Browser   │────▶│  Express Server  │────▶│   Supabase   │
│  (Frontend) │◀────│   (server.js)    │────▶│  (Database)  │
└─────────────┘     └────────┬─────────┘     └──────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Cloud Provider   │
                    │      APIs          │
                    └───────────────────┘
```

### Pages

| Page | Purpose |
|------|---------|
| `public/index.html` | Dashboard with green/red status tiles (banks, cloud, CDN) |
| `public/detail.html` | Detail page per entity: history chart, screenshot, AI summary, news |

### Files

| File | Purpose |
|------|---------|
| `server.js` | Express server, fetches data, handles API routes, entity config |
| `supabase.js` | Supabase client, database operations |
| `public/index.html` | Dashboard HTML (tile grid) |
| `public/app.js` | Dashboard JS: reloads entities on load, polls `/api/config` + `/status`, updates tiles |
| `public/detail.html` | Detail page HTML |
| `public/detail.js` | Detail page JS: loads entity URLs from DB (`entities`), last fetch from `snapshots`, and renders live status-page preview |
| `public/style.css` | Shared stylesheet (dashboard + detail) |
| `database/001-initial.sql` | Initial schema |
| `database/002-add-banks.sql` | Migration to allow bank slugs |
| `database/003-entities.sql` | Creates `entities` table and seed entities |
| `database/004-fix-provider-constraint.sql` | Drops legacy provider CHECK and enforces FK to `entities.slug` |

---

## Data Fetching

### Intervals

| Data Type | Frequency | Storage |
|-----------|-----------|---------|
| Status data | Every 2 minutes | `snapshots` table |
| News data | Every 30 minutes | `news_articles` table |

### Status Fetchers

| Function | Source | Notes |
|----------|--------|-------|
| `fetchAWS()` | AWS Health API | UTF-16 encoded response |
| `fetchAzure()` | Azure RSS Feed | XML format |
| `fetchGCP()` | GCP Status JSON | Open incidents only |
| `fetchStatusPage()` | Atlassian Statuspage API | Generic CDN/Cloud status pages + 403 fallback |
| `fetchBankStatus(entity)` | Bank website/status URLs | Uses LLM classification to determine issue + health score from scraped page content |

### News Source

- Google News RSS feed
- Searches for: `<entity> outage OR downtime`
- Banks use `<name> bank outage OR downtime`
- Returns top 3 articles per entity

---

## Database Schema

### Tables

```sql
snapshots        -- One row per entity per poll
incidents        -- Outages linked to snapshots
news_articles    -- Related news linked to snapshots
```

### Migrations

- `001-initial.sql` — Creates tables, indexes, pg_cron cleanup
- `002-add-banks.sql` — Extends provider CHECK to include bank slugs + 'Down' status
- `003-entities.sql` — Creates `entities` table for dynamic scraping (replaces hardcoded config)
- `004-fix-provider-constraint.sql` — Drops legacy provider CHECK and enforces `snapshots.provider -> entities.slug` foreign key

### Running Migrations

Run migrations via Supabase Dashboard SQL Editor or CLI:

```bash
# Option 1: Supabase Dashboard
# 1. Go to https://supabase.com/dashboard
# 2. Select your project → SQL Editor
# 3. Run SQL in order: 003-entities.sql, then 004-fix-provider-constraint.sql

# Option 2: Supabase CLI
supabase db push
```

### SQL Migration Policy

- Never edit old migration files once committed/applied.
- For any schema/data change, create a new incremental file in `database/` (e.g. `005-...sql`).
- Document the new migration in this file under **Migrations** and **Changelog**.

### Cleanup

- Automatic deletion via pg_cron
- Runs daily at 3:00 AM
- Removes data older than 1 day

---

## API Endpoints

### GET `/api/config`

Returns the entity configuration map (slug → name, category).
This endpoint reloads entities from Supabase before returning data.

### GET `/status`

Returns current status for all entities from live scraping.

Includes `fetchedAt` timestamp for each entity.

**Response:**
```json
{
  "dbs": {
    "status": "Healthy",
    "healthScore": 1.0,
    "incidents": [],
    "news": [],
    "regionImpact": {}
  },
  "aws": {
    "status": "Healthy",
    "healthScore": 1.0,
    "incidents": [...],
    "news": [...],
    "regionImpact": {"NA": 0, "EU": 1}
  }
}
```

### GET `/history`

Returns latest 20 snapshots per entity from database.

### GET `/news/:entity`

Returns fresh news articles for a specific entity (used by detail page).

### POST `/api/entities/reload`

Forces server-side entity reload from Supabase without restarting the server.

**Response:** `{ "success": true, "entities": <count>, "slugs": [...] }`

### GET `/api/entity/:entity`

Returns DB-backed metadata for one entity.

- URLs from `entities` table (`url`, `status_page_url`)
- Last fetch timestamp from latest row in `snapshots` table (`polled_at`)

---

## Data Flow

```
Page Load (Dashboard):
  Browser → POST /api/entities/reload → refresh DB entities immediately
  Browser → GET /api/config → Build tiles
  Browser → GET /status → Color tiles green/red

Page Load (Detail):
  Browser → POST /api/entities/reload → refresh DB entities immediately
  Browser → GET /api/config → Set entity name + URLs + preview source
  Browser → GET /history → Populate chart
  Browser → GET /status → Update badge + chart + last fetch time
  Browser → GET /news/:entity → Populate news list

Live Polling (every 2 min):
  Dashboard: GET /api/config + GET /status → Reload latest entities + update tile states
  Detail: GET /api/config + GET /status → Reload entity metadata, URLs, preview target, and fetch timestamp
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | - | Supabase project URL |
| `SUPABASE_SECRET_KEY` | - | Supabase secret key (server-side only) |
| `PORT` | 3000 | Server port |
| `CACHE_DURATION` | 120000 | Status cache (2 min in ms) |

---

## Development

### Adding a New Bank / Provider

1. Add entry to `entities` table in Supabase (via SQL or dashboard)
2. Set `slug`, `name`, `type` (bank/cdn/cloud), `url`, `status_page_url`
3. Server automatically fetches from DB on startup and scrapes dynamically
4. Frontend tiles auto-generate from `/api/config`
5. Update this document

**Note:** No code changes needed - entities are now database-driven!

### Refreshing Entities Without Restart

1. Update records in Supabase `entities` table
2. Call `POST /api/entities/reload`
3. Next dashboard/detail poll will pick up latest entities and labels

### Modifying Fetch Intervals

- Status: Set `CACHE_DURATION` in `.env` (default 120s)
- News: Set `NEWS_FETCH_INTERVAL` in `.env` (default 30min)
- Headline: Set `HEADLINE_CACHE_DURATION` in `.env` (default 120s)

### Bank Status Detection

Bank status detection works by:
1. Scraping the bank's website (URL from `status_page_url` or `url` in `entities` table)
2. Extracting text from title, headings, alerts, banners
3. Sending to LLM to classify if there's an active issue

**Important**: Most banks don't have dedicated status pages like cloud providers. The scraper pulls from their main website which may not show alerts prominently. For best results, ensure `status_page_url` points to a page with alerts/banners.

---

## Last Updated

Document version: 3.4
Last updated: 2026-03-31

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 3.4 | 2026-03-31 | Bank `health_score` now LLM-driven from scraped status-page content, added `GET /api/entity/:entity` (URLs from `entities`, last fetch from `snapshots`), detail preview now uses `entities.status_page_url` |
| 3.3 | 2026-03-31 | Dashboard/detail now force DB entity reload on page load, detail page shows main/status URLs + live website preview + last fetch timestamp, AI summary moved above chart |
| 3.2 | 2026-03-31 | Removed all simulation flows, added live bank scraping from Supabase URLs, added `POST /api/entities/reload`, frontend now refreshes entity config on each fetch, documented SQL migration policy |
| 3.1 | 2026-03-31 | Fixed dynamic scraping: removed duplicate hardcoded status fetcher, improved bank incident extraction, added Fastly 403 fallback, added provider constraint fix migration |
| 3.0 | 2026-03-31 | Entities now database-driven: added `entities` table, dynamic scraping from DB, removed hardcoded config |
| 2.0 | 2026-03-27 | Redesign: mobile-first tile dashboard, detail page (chart, screenshot, AI summary, news), added 7 banks (simulated), removed world map, removed Fastly from UI |
| 1.2 | 2026-03-25 | Fixed news persistence timing, retained last news when fetch is empty, moved incidents to count + merged feed items |
| 1.1 | 2026-03-25 | Added `/history` endpoint, browser caching, database-first data loading |
| 1.0 | 2026-03-25 | Initial version |
