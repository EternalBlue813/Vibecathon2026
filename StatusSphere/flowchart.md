# StatusSphere - Data Flow and Trigger Flowchart

## High-Level Flow

```
Browser (Homepage/Detail)
        │
        ▼
Express API (`server.js`)
        │
        ├── In-memory caches (entities, status, headline, screenshots)
        ├── External sources (status pages/APIs, Google News, LLM)
        ├── Supabase Postgres (entities, snapshots, incidents, news_articles)
        └── Supabase Storage (`entity-image-snapshot`)
```

---

## Startup Trigger

```
Server start
  ├─ setEntities([]) + initializeCache()
  ├─ refreshEntitiesIfStale(true)
  ├─ hydrateCacheFromDatabase()
  ├─ startBackgroundSchedulers()
  ├─ runStatusUpdateSafely()   (async, immediate)
  └─ runNewsUpdateSafely()     (async, immediate)
```

---

## Request-Time Hydration (Important)

```
GET /api/config
  └─ ensureEntitiesLoaded() -> DB entities first
       └─ source metadata comes from `status_source_kind` + `status_source_config`

GET /status
  └─ ensureStatusDataReady()
       ├─ ensureEntitiesLoaded()
       ├─ synchronizeCacheEntries()
       └─ hydrateCacheFromDatabase() when cache empty/default

GET /api/headline
  └─ ensureStatusDataReady() before LLM/fallback headline
```

This ensures first page load is database-first when memory cache is cold.

---

## Status Update Cycle

```
updateStatus()
  ├─ if cache valid (< CACHE_DURATION) return cache
  ├─ refreshEntitiesIfStale()
  ├─ for each active entity
  │    ├─ captureScreenshot()
  │    ├─ fetchEntityStatus()
  │    │    ├─ route by `status_source_kind`
  │    │    │    ├─ `generic_status_page` -> summary/page parsing
  │    │    │    └─ `aws_public_health` -> `services.json` + `historyevents.json` -> structured evidence -> LLM decision
  │    │    ├─ summary.json/status URL candidates
  │    │    ├─ structured parse (JSON/XML/HTML)
  │    │    ├─ rendered-text and bank HTML fallback
  │    │    └─ LLM + keyword guardrails
  │    └─ buildSnapshotAnalysis()
  ├─ update memory cache (`fetchedAt`, keep existing news)
  └─ persistToDatabase() -> snapshots + incidents
```

### Scoped Incident Classification

`classifyScopedIncidentStatus()` is used for cloud/CDN incident severity:
- uses observed impact (`regionImpact`, scoped locations, component ratios)
- avoids provider-wide `Down` for limited regional incidents
- returns `Partial` for scoped impact, `Down` for broad/severe impact

---

## News Update Cycle

```
updateNews()
  ├─ if interval valid (< NEWS_FETCH_INTERVAL) return
  ├─ fetchAllNews() from Google News RSS
  ├─ normalize/filter by provider keywords
  ├─ update cache.news per provider
  └─ persistNewsToDatabase() (dedupe window + upsert)
```

---

## Screenshot Cycle

```
screenshot scheduler (SCREENSHOT_INTERVAL)
  └─ captureAll(entityConfig)
      └─ captureScreenshot(slug, statusUrl, fallbackUrl)
          ├─ mobile viewport + iPhone UA
          ├─ upload PNG to Supabase Storage
          ├─ keep in-memory meta/history
          └─ keep rendered page text (status fallback signal)
```

Startup note:
- scheduler no longer performs an immediate duplicate startup capture pass
- status polling performs a one-time bootstrap capture only when an entity has no screenshot yet

Endpoint behavior for detail page:

```
GET /api/screenshot/:entity/history
  ├─ if in-memory history exists -> return last 5
  └─ else query snapshots.analysis_screenshot_url -> return last 5
```

---

## Detail Page Load Flow

```
detail.js load
  ├─ GET /api/config
  ├─ GET /history?entity=<slug>&limit=5
  │    ├─ seed chart from last 5 snapshots
  │    └─ seed screenshot fallback from analysis_screenshot_url
  ├─ GET /status
  │    └─ if missing in memory, use latest snapshot fallback
  ├─ GET /news/:entity
  └─ GET /api/screenshot/:entity/history (polling)
```

---

## Scheduled and Frontend Intervals

| Trigger | Default | Env |
|---|---:|---|
| Status cache window | 120000 ms | `CACHE_DURATION` |
| Server status scheduler | `CACHE_DURATION` | `STATUS_POLL_INTERVAL` (optional) |
| News scheduler | 1800000 ms | `NEWS_FETCH_INTERVAL` |
| Headline cache | 120000 ms | `HEADLINE_CACHE_DURATION` |
| Entity refresh staleness | 1800000 ms | `ENTITY_REFRESH_INTERVAL` |
| Screenshot scheduler | 60000 ms | `SCREENSHOT_INTERVAL` |
| Frontend status poll | 120000 ms | `FRONTEND_STATUS_POLL_INTERVAL` |
| Frontend headline poll | 120000 ms | `FRONTEND_HEADLINE_POLL_INTERVAL` |
| Frontend screenshot poll | 15000 ms | `FRONTEND_SCREENSHOT_POLL_INTERVAL` |

---

## Last Updated

Document version: 1.1
Last updated: 2026-04-01
