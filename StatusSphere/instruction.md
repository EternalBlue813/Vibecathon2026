# StatusSphere - Technical Documentation

> **Important:** Update this file whenever project changes are made.

---

## Overview

StatusSphere is a real-time cloud infrastructure status monitoring dashboard that tracks the health of major cloud providers and CDN services.

### Monitored Providers

| Provider | Status Source | CDN/Cloud |
|----------|---------------|-----------|
| AWS | AWS Health API | Cloud |
| Azure | Azure Status Feed (RSS) | Cloud |
| GCP | Google Cloud Status | Cloud |
| Cloudflare | Statuspage API | CDN |
| Akamai | Statuspage API | CDN |
| Fastly | Statuspage API | CDN |

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

### Components

| File | Purpose |
|------|---------|
| `server.js` | Express server, fetches data, handles API routes |
| `supabase.js` | Supabase client, database operations |
| `public/index.html` | Dashboard HTML |
| `public/app.js` | Frontend logic, polling, UI updates |
| `public/style.css` | Dashboard styling |

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
| `fetchStatusPage()` | Atlassian Statuspage API | Cloudflare, Akamai, Fastly |

### News Source

- Google News RSS feed
- Searches for: `<provider> outage OR downtime`
- Returns top 3 articles
- If a fetch returns no new articles, dashboard keeps the last successful news payload

---

## Database Schema

### Tables

```sql
snapshots        -- One row per provider per poll
incidents        -- Outages linked to snapshots
news_articles    -- Related news linked to snapshots
```

### Cleanup

- Automatic deletion via pg_cron
- Runs daily at 3:00 AM
- Removes data older than 30 days

---

## API Endpoints

### GET `/status`

Returns current status for all providers.

**Response:**
```json
{
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

Returns latest 20 snapshots per provider from database (for populating charts on page load).

**Response:**
```json
{
  "aws": [
    { "id": "...", "provider": "aws", "polled_at": "...", "health_score": 1.0, "status": "Healthy" }
  ]
}
```

### POST `/simulate`

Injects fake outage for testing.

**Body:** `{ "provider": "aws", "region": "NA" }`

### POST `/reset`

Clears all simulations.

---

## Data Flow

```
Page Load:
  Browser → GET /history → Supabase (latest 20 per provider) → Populate charts

Live Polling (every 2 min):
  Browser → GET /status → Web APIs → Response → Store to Supabase

Background History Refresh (every 5 min):
  Browser → GET /history → Supabase → Update cached state
```

### Browser Caching

- Historical data is cached in browser `state` object
- Charts are pre-populated from cache on page load
- `/status` provides live updates on top of cached history
- History refreshes from DB every 5 minutes to sync new data
- Provider cards always show fixed stats: active incident count, status, and last fetch
- Incident links are merged into the news feed and tagged as `Incident`

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | - | Supabase project URL |
| `SUPABASE_SECRET_KEY` | - | Supabase secret key (server-side only, bypasses RLS) |
| `PORT` | 3000 | Server port |
| `CACHE_DURATION` | 120000 | Status cache (2 min in ms) |

> **Note:** We use `SUPABASE_SECRET_KEY` (not publishable key) because this is server-side code. The secret key bypasses Row Level Security (RLS) policies, allowing inserts from the backend.

---

## Region Codes

| Code | Regions |
|------|---------|
| NA | US, Canada, Mexico |
| SA | Brazil, Argentina, Chile |
| EU | UK, Germany, France, etc. |
| AF | South Africa, Egypt |
| AS | Japan, Singapore, India |
| OC | Australia, New Zealand |

---

## Development

### Adding a New Provider

1. Add provider to `cache` object in `server.js`
2. Create fetch function (similar to `fetchAWS()`)
3. Add to `fetchAllStatus()` promise
4. Update frontend `state` in `app.js`
5. Update this document

### Modifying Fetch Intervals

- Status: Change `CACHE_DURATION` in `.env` or `server.js`
- News: Change `NEWS_FETCH_INTERVAL` in `server.js`

---

## Last Updated

Document version: 1.2
Last updated: 2026-03-25

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.2 | 2026-03-25 | Fixed news persistence timing, retained last news when fetch is empty, moved incidents to count + merged feed items |
| 1.1 | 2026-03-25 | Added `/history` endpoint, browser caching, database-first data loading |
| 1.0 | 2026-03-25 | Initial version |
