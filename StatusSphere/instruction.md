# StatusSphere - Technical Documentation

> **Important:** Update this file whenever project changes are made.

---

## Overview

StatusSphere is a real-time infrastructure status monitoring dashboard that tracks the health of banks, cloud providers, and CDN services. The main dashboard shows green/red status tiles; clicking a tile opens a detail page with history chart, screenshot area, AI summary, and media news.

### Monitored Entities

| Entity | Slug | Category | Status Source |
|--------|------|----------|---------------|
| DBS | dbs | Bank | Simulated (v1) |
| OCBC | ocbc | Bank | Simulated (v1) |
| UOB | uob | Bank | Simulated (v1) |
| Citi | citi | Bank | Simulated (v1) |
| SCB | scb | Bank | Simulated (v1) |
| HSBC | hsbc | Bank | Simulated (v1) |
| Maybank | maybank | Bank | Simulated (v1) |
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
| `public/app.js` | Dashboard JS: polls `/status`, updates tile colors |
| `public/detail.html` | Detail page HTML |
| `public/detail.js` | Detail page JS: Chart.js history, news, summary |
| `public/style.css` | Shared stylesheet (dashboard + detail) |
| `database/001-initial.sql` | Initial schema |
| `database/002-add-banks.sql` | Migration to allow bank slugs |

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
| `fetchStatusPage()` | Atlassian Statuspage API | Cloudflare, Akamai |
| Banks | Simulated | Default Healthy; toggle via `/simulate` |

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

### Cleanup

- Automatic deletion via pg_cron
- Runs daily at 3:00 AM
- Removes data older than 1 day

---

## API Endpoints

### GET `/api/config`

Returns the entity configuration map (slug → name, category, simulated flag).

### GET `/status`

Returns current status for all entities including bank simulations.

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

### POST `/simulate`

Injects fake outage for testing any entity.

**Body:** `{ "provider": "dbs", "region": "AS" }`

### POST `/reset`

Clears all simulations.

---

## Data Flow

```
Page Load (Dashboard):
  Browser → GET /api/config → Build tiles
  Browser → GET /status → Color tiles green/red

Page Load (Detail):
  Browser → GET /api/config → Set entity name
  Browser → GET /history → Populate chart
  Browser → GET /status → Update badge + chart
  Browser → GET /news/:entity → Populate news list

Live Polling (every 2 min):
  Dashboard: GET /status → Update tile states
  Detail: GET /status → Update badge + push to chart
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

1. Add entry to `ENTITY_CONFIG` in `server.js`
2. If real fetcher needed, create fetch function and add to `fetchAllStatus()`
3. Run `002-add-banks.sql` migration if new slug not in CHECK constraint
4. Frontend tiles auto-generate from `/api/config`
5. Update this document

### Swapping Bank Simulation for Real Checks

1. Remove `simulated: true` from the bank entry in `ENTITY_CONFIG`
2. Create a fetch function (e.g. `fetchDBS()`) that does HTTP HEAD/GET to the bank URL
3. Add it to the `fetchAllStatus()` promise
4. The dashboard and detail pages require no changes

### Modifying Fetch Intervals

- Status: Change `CACHE_DURATION` in `.env` or `server.js`
- News: Change `NEWS_FETCH_INTERVAL` in `server.js`

---

## Last Updated

Document version: 2.0
Last updated: 2026-03-27

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-03-27 | Redesign: mobile-first tile dashboard, detail page (chart, screenshot, AI summary, news), added 7 banks (simulated), removed world map, removed Fastly from UI |
| 1.2 | 2026-03-25 | Fixed news persistence timing, retained last news when fetch is empty, moved incidents to count + merged feed items |
| 1.1 | 2026-03-25 | Added `/history` endpoint, browser caching, database-first data loading |
| 1.0 | 2026-03-25 | Initial version |
