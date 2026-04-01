# StatusSphere Database Schema

PostgreSQL database for tracking the health status of cloud providers, CDNs, and banks.

## Extensions

| Extension | Purpose |
|-----------|---------|
| `pg_cron` | Scheduled cleanup jobs (daily at 3am) |

## Tables

### 1. `snapshots`

One row per provider per poll. Core table recording periodic health checks.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, `gen_random_uuid()` | Unique identifier |
| `provider` | `TEXT` | NOT NULL, FK → `entities(slug)` ON DELETE CASCADE | Entity slug (e.g. `aws`, `dbs`) |
| `polled_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | When the snapshot was taken |
| `health_score` | `FLOAT` | NOT NULL, `0 <= x <= 1` | Numeric health score (0–1) |
| `status` | `TEXT` | NOT NULL | One of: `Healthy`, `Warning`, `Unknown`, `Down`, `Partial`, `Maintenance` |

**Indexes:**
- `idx_snapshots_provider_time` — `(provider, polled_at DESC)`

---

### 2. `incidents`

Outages or incidents linked to a specific snapshot.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, `gen_random_uuid()` | Unique identifier |
| `snapshot_id` | `UUID` | NOT NULL, FK → `snapshots(id)` ON DELETE CASCADE | Parent snapshot |
| `provider` | `TEXT` | NOT NULL | Entity slug |
| `name` | `TEXT` | NOT NULL | Incident name/title |
| `link` | `TEXT` | nullable | URL to incident details |
| `region` | `TEXT` | nullable, one of: `NA`, `SA`, `EU`, `AF`, `AS`, `OC` | Affected region |
| `detected_at` | `TIMESTAMPTZ` | default `NOW()` | When the incident was detected |

**Indexes:**
- `idx_incidents_provider_time` — `(provider, detected_at DESC)`
- `idx_incidents_region` — `(region)`
- `idx_incidents_snapshot` — `(snapshot_id)`

---

### 3. `news_articles`

Related news articles linked to a specific snapshot.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, `gen_random_uuid()` | Unique identifier |
| `snapshot_id` | `UUID` | NOT NULL, FK → `snapshots(id)` ON DELETE CASCADE | Parent snapshot |
| `provider` | `TEXT` | NOT NULL | Entity slug |
| `title` | `TEXT` | NOT NULL | Article title |
| `link` | `TEXT` | nullable | URL to article |
| `source` | `TEXT` | nullable | News source name |
| `published_at` | `TIMESTAMPTZ` | nullable | Original publish date |
| `fetched_at` | `TIMESTAMPTZ` | default `NOW()` | When the article was fetched |

**Indexes:**
- `idx_news_provider_time` — `(provider, fetched_at DESC)`
- `idx_news_snapshot` — `(snapshot_id)`

---

### 4. `entities`

Master/reference table for all tracked entities (cloud providers, CDNs, banks).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, `gen_random_uuid()` | Unique identifier |
| `slug` | `TEXT` | NOT NULL, UNIQUE | Short identifier used as FK target (e.g. `aws`, `cloudflare`, `dbs`) |
| `name` | `TEXT` | NOT NULL | Display name (e.g. "Amazon Web Services") |
| `type` | `TEXT` | NOT NULL, one of: `bank`, `cdn`, `cloud` | Entity category |
| `url` | `TEXT` | NOT NULL | Main website URL |
| `status_page_url` | `TEXT` | nullable | URL to provider's status page |
| `is_active` | `BOOLEAN` | NOT NULL, default `true` | Whether polling is enabled |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | Row creation time |

**Indexes:**
- `idx_entities_slug` — `(slug)`
- `idx_entities_type` — `(type)`
- `idx_entities_active` — `(is_active)`

**Seed data (14 entities):**

| slug | name | type |
|------|------|------|
| `aws` | Amazon Web Services | cloud |
| `azure` | Microsoft Azure | cloud |
| `gcp` | Google Cloud Platform | cloud |
| `cloudflare` | Cloudflare | cdn |
| `akamai` | Akamai | cdn |
| `fastly` | Fastly | cdn |
| `dbs` | DBS Bank | bank |
| `ocbc` | OCBC Bank | bank |
| `uob` | UOB | bank |
| `citi` | Citibank | bank |
| `scb` | Standard Chartered Bank | bank |
| `hsbc` | HSBC | bank |
| `maybank` | Maybank | bank |
| `sxp` | SXP Bank | bank |

---

## Relationships

```
entities (1) ──< (N) snapshots
snapshots (1) ──< (N) incidents
snapshots (1) ──< (N) news_articles
```

## Automated Cleanup (pg_cron)

| Job | Schedule | Action |
|-----|----------|--------|
| `cleanup-news-1days` | Daily 03:00 | Delete `news_articles` older than 1 day |
| `cleanup-snapshots-1days` | Daily 03:05 | Delete `snapshots` older than 1 day (cascades to incidents & news) |

## Migration History

| File | Description |
|------|-------------|
| `001-initial.sql` | Created `snapshots`, `incidents`, `news_articles`; set up pg_cron cleanup |
| `002-add-banks.sql` | Extended provider CHECK to include bank slugs; added `Down` status |
| `003-entities.sql` | Created `entities` table with seed data; replaced hardcoded CHECK with FK |
| `004-fix-provider-constraint.sql` | Ensured provider CHECK removed; re-applied FK to entities |
| `005-allow-maintenance-partial-status.sql` | Added `Partial` and `Maintenance` to status CHECK |
