# StatusSphere - Data Flow & Trigger Flowchart

## Overview

StatusSphere uses multiple trigger mechanisms to fetch and update data from various sources. This document outlines the high-level flow of how different triggers initiate data collection, processing, and storage.

---

## High-Level Architecture Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        StatusSphere Server                      │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│   Triggers    │      │  Data Sources │      │   Storage     │
└───────────────┘      └───────────────┘      └───────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│ API Endpoints │      │ Cloud APIs    │      │   Supabase    │
│ Schedulers    │      │ Bank Websites │      │   (Database)  │
│ pg_cron       │      │ Google News   │      │   In-Memory   │
└───────────────┘      └───────────────┘      └───────────────┘
```

---

## Trigger Flowchart

```
                          ┌─────────────────┐
                          │  Server Startup │
                          └────────┬────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
           ┌────────────┐  ┌────────────┐  ┌────────────┐
           │ Load       │  │ Initialize │  │ Start      │
           │ Entities   │  │ Cache      │  │ Scheduler  │
           │ from DB    │  │            │  │ (Screenshots)│
           └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
                 │              │              │
                 └──────────────┼──────────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │   Listening on Port │
                    └─────────────────────┘
```

---

## Trigger Details

### 1. Server Startup Trigger

**When:** Server starts (`node server.js`)

**Flow:**
```
Server Start
    │
    ├─► Load Entities from Supabase (entities table)
    │       │
    │       ├─► Load active entities (slug, name, type, url, status_page_url)
    │       └─► Categorize: banks, cloud, CDN
    │
    ├─► Initialize In-Memory Cache
    │       │
    │       └─► Create default entries for all slugs
    │
    ├─► Verify Supabase Connection
    │
    └─► Start Screenshot Scheduler
            │
            ├─► Initial capture cycle for all entities
            └─► Set interval (every 60 seconds)
```

**Data Sources:**
- Supabase `entities` table (entity configuration)

**Output:**
- In-memory `ENTITY_CONFIG` populated
- Screenshot scheduler running

---

### 2. Status Fetch Trigger

**When:** API call to `GET /status` endpoint

**Flow:**
```
GET /status Request
    │
    ├─► Reload Entities from DB
    │       │
    │       └─► Update ENTITY_CONFIG if changed
    │
    ├─► Check Cache Duration (2 minutes)
    │       │
    │       ├─► If cache valid → Return cached data
    │       │
    │       └─► If cache expired → Continue below
    │
    ├─► fetchAllStatus()
    │       │
    │       ├─► For each entity (banks, cloud, CDN):
    │       │       │
    │       │       ├─► fetchEntityStatus(entity)
    │       │       │       │
    │       │       │       ├─► Build status URL candidates
    │       │       │       │       │
    │       │       │       │       ├─► /api/v2/summary.json
    │       │       │       │       └─► Original status page URL
    │       │       │       │
    │       │       │       ├─► fetchStatusCandidate(name, url)
    │       │       │       │       │
    │       │       │       │       ├─► HTTP GET with headers
    │       │       │       │       ├─► Decode response (UTF-8/UTF-16)
    │       │       │       │       ├─► Parse JSON/XML/HTML
    │       │       │       │       └─► Extract structured data or signal text
    │       │       │       │
    │       │       │       ├─► If structured data found:
    │       │       │       │       │
    │       │       │       │       ├─► Parse incidents
    │       │       │       │       ├─► Compute region impact
    │       │       │       │       └─► Map indicator to status
    │       │       │       │
    │       │       │       ├─► If no structured data:
    │       │       │       │       │
    │       │       │       │       ├─► Try rendered text from screenshots
    │       │       │       │       └─► Bank HTML fallback (if bank)
    │       │       │       │
    │       │       │       ├─► detectIssueWithLLM()
    │       │       │       │       │
    │       │       │       │       ├─► Extract keyword hints
    │       │       │       │       ├─► Build structured hints
    │       │       │       │       └─► Call LLM API for classification
    │       │       │       │               │
    │       │       │       │               ├─► Input: signal text + hints
    │       │       │       │               └─► Output: status, healthScore, hasIssue, summary
    │       │       │       │
    │       │       │       ├─► sanitizeBankLlmOutcome() (for banks only)
    │       │       │       │       │
    │       │       │       │       └─► Cross-check with keyword extraction
    │       │       │       │
    │       │       │       └─► Return status object
    │       │       │
    │       │       └─► [slug, result]
    │       │
    │       └─► Promise.all(results) → statusData object
    │
    ├─► Update In-Memory Cache
    │       │
    │       └─► Merge status data with existing news
    │
    ├─► persistToDatabase(statusData)
    │       │
    │       ├─► storeSnapshot(provider, healthScore, status)
    │       │       │
    │       │       └─► Insert into snapshots table
    │       │
    │       └─► storeIncident(snapshotId, provider, name, link, region)
    │               │
    │               └─► Insert into incidents table
    │
    └─► Return status data as JSON
```

**Data Sources:**
- Cloud provider status APIs (AWS, Azure, GCP)
- CDN status pages (Cloudflare, Akamai)
- Bank websites (scraped HTML)
- Screenshot rendered text (fallback)
- LLM API (issue classification)

**Output:**
- Status data for all entities (cached in memory)
- Snapshots stored in Supabase
- Incidents stored in Supabase

---

### 3. News Fetch Trigger

**When:** Background task after `GET /status` (30-minute interval)

**Flow:**
```
updateNews() (Background)
    │
    ├─► Check News Fetch Interval (30 minutes)
    │       │
    │       ├─► If interval not elapsed → Return cached data
    │       │
    │       └─► If interval elapsed → Continue below
    │
    ├─► fetchAllNews()
    │       │
    │       ├─► For each cloud/CDN entity:
    │       │       │
    │       │       └─► fetchNews(entityName)
    │       │               │
    │       │               ├─► Google News RSS: "<name> outage OR downtime"
    │       │               ├─► Parse XML response
    │       │               └─► Return top 3 articles
    │       │
    │       └─► For each bank entity:
    │               │
    │               └─► fetchNews(entityName + ' bank')
    │                       │
    │                       ├─► Google News RSS: "<name> bank outage OR downtime"
    │                       ├─► Parse XML response
    │                       └─► Return top 3 articles
    │
    ├─► Normalize news for each provider
    │       │
    │       └─► Filter articles by entity keywords
    │
    ├─► Update In-Memory Cache
    │       │
    │       └─► Replace news array for each entity
    │
    └─► persistNewsToDatabase(newsData)
            │
            └─► For each provider:
                    │
                    ├─► getLatestSnapshotId(provider)
                    │       │
                    │       └─► Query snapshots table or create new
                    │
                    └─► storeNews(snapshotId, provider, title, link, source, pubDate)
                            │
                            ├─► Check for duplicates (24-hour window)
                            └─► Insert into news_articles table
```

**Data Sources:**
- Google News RSS feed

**Output:**
- News articles cached in memory
- News articles stored in Supabase

---

### 4. Screenshot Capture Trigger

**When:** Screenshot scheduler (every 60 seconds)

**Flow:**
```
Screenshot Scheduler (startScheduler)
    │
    ├─► Initial capture cycle (on startup)
    │
    └─► setInterval (60 seconds)
            │
            └─► captureAll(entityConfig)
                    │
                    └─► For each entity:
                            │
                            ├─► Get URL (statusUrl or url)
                            │
                            ├─► captureScreenshot(slug, url)
                            │       │
                            │       ├─► ensureBrowser()
                            │       │       │
                            │       │       ├─► Try Puppeteer bundled Chrome
                            │       │       └─► Fallback to system Chrome
                            │       │
                            │       ├─► Create new page
                            │       │       │
                            │       │       ├─► Set mobile viewport (375x812)
                            │       │       ├─► Set iPhone user agent
                            │       │       └─► Set language headers
                            │       │
                            │       ├─► navigateForScreenshot(page, slug, url)
                            │       │       │
                            │       │       ├─► Check for slug-specific overrides
                            │       │       ├─► Navigate with waitUntil strategy
                            │       │       ├─► Wait for settle time
                            │       │       └─► Try fallback URL if needed
                            │       │
                            │       ├─► Take PNG screenshot
                            │       │
                            │       ├─► Extract page text
                            │       │       │
                            │       │       ├─► Get title
                            │       │       ├─► Get headings (h1-h4)
                            │       │       ├─► Get alert/banner elements
                            │       │       └─► Get body text (truncated)
                            │       │
                            │       ├─► Store rendered text (in memory)
                            │       │
                            │       ├─► getSlotIndex(slug)
                            │       │       │
                            │       │       └─► Rotate through 5 slots
                            │       │
                            │       ├─► uploadToSupabase(slug, buffer, slotIndex)
                            │       │       │
                            │       │       └─► Upload to 'entity-image-snapshot' bucket
                            │       │
                            │       ├─► Update screenshotMeta
                            │       ├─► Update screenshotHistory
                            │       │
                            │       └─► Close page
                            │
                            └─► Log completion
```

**Data Sources:**
- Entity status pages (live websites)

**Output:**
- Screenshots uploaded to Supabase Storage
- Screenshot metadata cached in memory
- Rendered page text cached in memory (used as fallback for status fetching)

---

### 5. Headline Generation Trigger

**When:** API call to `GET /api/headline`

**Flow:**
```
GET /api/headline Request
    │
    ├─► Check Headline Cache Duration (2 minutes)
    │       │
    │       ├─► If cache valid → Return cached headline
    │       │
    │       └─► If cache expired → Continue below
    │
    ├─► buildStatusContext()
    │       │
    │       └─► Format current status data for LLM
    │
    ├─► callLLM() (if API key configured)
    │       │
    │       ├─► System prompt: "Write breaking-news style headline"
    │       ├─► User prompt: Current service statuses
    │       └─► Output: Single-line headline (max 200 chars)
    │
    ├─► If LLM fails:
    │       │
    │       └─► buildFallbackHeadline()
    │               │
    │               ├─► Count healthy vs issues
    │               └─► Generate template headline
    │
    ├─► Update headlineCache
    │
    └─► Return { headline: "..." }
```

**Data Sources:**
- In-memory status cache
- LLM API (OpenRouter/Groq)

**Output:**
- Headline string (cached in memory)

---

### 6. Chat Trigger

**When:** API call to `POST /api/chat`

**Flow:**
```
POST /api/chat Request
    │
    ├─► Validate messages array
    │
    ├─► inputGuardrail(userMessage)
    │       │
    │       ├─► Quick topic check (keyword matching)
    │       │       │
    │       │       ├─► If matches allowed topics → Allow
    │       │       │
    │       │       └─► If no match → Continue to LLM check
    │       │
    │       └─► LLM topic classification
    │               │
    │               ├─► System prompt: "Is this about infrastructure status?"
    │               └─► Output: "yes" or "no"
    │
    ├─► If blocked by guardrail:
    │       │
    │       └─► Return rejection message
    │
    ├─► buildStatusContext()
    │       │
    │       └─► Format current status data
    │
    ├─► getDbContext()
    │       │
    │       ├─► Query recent incidents from DB
    │       └─► Query recent news from DB
    │
    ├─► callLLM()
    │       │
    │       ├─► System prompt: StatusSphere AI instructions + guardrails
    │       ├─► Context: Current status + DB data
    │       └─► User messages (last 10)
    │
    └─► Return { reply: "...", guardrail: null }
```

**Data Sources:**
- In-memory status cache
- Supabase database (incidents, news)
- LLM API

**Output:**
- AI-generated response

---

### 7. Database Cleanup Trigger

**When:** pg_cron (daily at 3:00 AM)

**Flow:**
```
pg_cron Schedule (3:00 AM)
    │
    └─► DELETE FROM snapshots WHERE polled_at < NOW() - INTERVAL '1 day'
            │
            └─► Cascading deletes:
                    │
                    ├─► incidents (via snapshot_id FK)
                    └─► news_articles (via snapshot_id FK)
```

**Data Sources:**
- Supabase pg_cron extension

**Output:**
- Old data removed from database

---

## Trigger Summary Table

| Trigger | Frequency | Data Source | Output | Storage |
|---------|-----------|-------------|--------|---------|
| Server Startup | Once | Supabase entities table | Entity config, cache init | In-memory |
| Status Fetch | Every 2 min (cache) | Cloud APIs, Bank sites, LLM | Status data | Memory + Supabase |
| News Fetch | Every 30 min | Google News RSS | News articles | Memory + Supabase |
| Screenshots | Every 60 sec | Entity websites | Screenshots, rendered text | Supabase Storage + Memory |
| Headline | Every 2 min (cache) | In-memory cache, LLM | Headline string | In-memory |
| Chat | On-demand | In-memory cache, DB, LLM | AI response | None |
| DB Cleanup | Daily (3:00 AM) | Supabase | Cleaned database | Supabase |

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           StatusSphere Data Flow                        │
└─────────────────────────────────────────────────────────────────────────┘

External Sources              Server Processing              Storage
─────────────────            ──────────────────            ─────────
                                    
┌──────────────┐            ┌──────────────────┐          ┌──────────────┐
│ AWS Health   │───────────►│                  │          │              │
│ API          │            │                  │          │   Supabase   │
└──────────────┘            │   fetchStatus()  │──────────►│              │
                            │                  │          │  snapshots   │
┌──────────────┐            │   ├─► HTTP GET   │          │  incidents   │
│ Azure RSS    │───────────►│   ├─► Parse      │          │  news_articles│
│ Feed         │            │   ├─► LLM Class  │          │              │
└──────────────┘            │   └─► Normalize  │          │  Storage:    │
                            │                  │          │  - Screenshots│
┌──────────────┐            └──────────────────┘          │  - Images    │
│ GCP Status   │───────────►                              │              │
│ JSON         │            ┌──────────────────┐          └──────────────┘
└──────────────┘            │                  │                 ▲
                            │   fetchNews()    │                 │
┌──────────────┐            │                  │─────────────────┘
│ Bank Websites│───────────►│   ├─► Google RSS │
│ (HTML Scrape)│            │   ├─► Parse XML  │
└──────────────┘            │   └─► Filter     │
                            │                  │
┌──────────────┐            └──────────────────┘
│ Google News  │───────────►
│ RSS          │            ┌──────────────────┐          ┌──────────────┐
└──────────────┘            │                  │          │              │
                            │ captureScreenshot│──────────►│   In-Memory  │
┌──────────────┐            │                  │          │   Cache      │
│ LLM API      │───────────►│   ├─► Puppeteer  │          │              │
│ (OpenRouter) │            │   ├─► Screenshot  │          │  - Status    │
└──────────────┘            │   ├─► Extract    │          │  - News      │
                            │   └─► Upload     │          │  - Headlines │
                            │                  │          │  - Screenshot│
                            └──────────────────┘          │    Meta      │
                                                          │    Text      │
                                                          │              │
                                                          └──────────────┘
```

---

## Cache Strategy

```
┌─────────────────────────────────────────────────────────┐
│                    Cache Durations                       │
├──────────────────────┬──────────────────────────────────┤
│ Status Data          │ 2 minutes (CACHE_DURATION)       │
│ News Data            │ 30 minutes (NEWS_FETCH_INTERVAL) │
│ Headline             │ 2 minutes (HEADLINE_CACHE_DURATION)│
│ Screenshots          │ 60 seconds (SCREENSHOT_INTERVAL) │
└──────────────────────┴──────────────────────────────────┘
```

**Cache Invalidation:**
- Status: Time-based (2 min) or entity config change
- News: Time-based (30 min)
- Headline: Time-based (2 min)
- Screenshots: Rotating slots (5 per entity)

---

## Error Handling Flow

```
Data Fetch Attempt
    │
    ├─► Success → Update cache + store in DB
    │
    └─► Failure
            │
            ├─► HTTP Error
            │       │
            │       ├─► 403 → Try fallback API (Statuspage)
            │       ├─► Timeout → Log warning, skip
            │       └─► Other → Log error, skip
            │
            ├─► Parse Error
            │       │
            │       └─► Try alternative encoding (UTF-16)
            │
            ├─► LLM Error
            │       │
            │       ├─► Use keyword extraction fallback
            │       └─► Use structured data baseline
            │
            └─► Screenshot Error
                    │
                    ├─► Try fallback URL
                    ├─► Try system Chrome
                    └─► Log error, skip entity
```

---

## Last Updated

Document version: 1.0
Last updated: 2026-04-01
