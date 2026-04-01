# StatusSphere

Real-time infrastructure status monitoring dashboard. StatusSphere tracks the health of **cloud providers** (AWS, Azure, GCP), **CDNs** (Cloudflare, Akamai, Fastly), and **banks** (DBS, OCBC, UOB, Citi, SCB, HSBC, Maybank, SXP) by polling their status pages, classifying issues with an LLM, and surfacing everything in a live dashboard with AI-powered headlines and chat.

## What It Does

- **Status Monitoring** — Polls provider status pages every 2 minutes, classifies health as Healthy / Warning / Down / Partial / Maintenance
- **Live Screenshots** — Captures mobile screenshots of every provider's status page every 60 seconds (stored in Supabase Storage)
- **News Aggregation** — Pulls relevant outage news from Google News RSS every 30 minutes
- **AI Headlines** — Generates a breaking-news-style headline summarising the current global state
- **AI Chat** — Ask questions about current or recent outages via a chat interface (guarded to infrastructure topics)
- **Auto Cleanup** — pg_cron deletes data older than 1 day daily at 3 AM

For a detailed data flow and trigger breakdown see [StatusSphere/flowchart.md](StatusSphere/flowchart.md).
For the full database schema see [StatusSphere/database/database.md](StatusSphere/database/database.md).

---

## Prerequisites

- [Node.js](https://nodejs.org/) **v18+**
- A [Supabase](https://supabase.com/) account (free tier works)

## Setup

### 1. Clone & Install

```bash
cd StatusSphere
npm install
```

### 2. Create the Supabase Database

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) and create a new project.
2. Open **SQL Editor** in your project.
3. Run the following SQL files **in order** — copy each file's contents into the editor and click **Run**:

| Order | File | What it does |
|-------|------|--------------|
| 1 | `database/001-initial.sql` | Creates `snapshots`, `incidents`, `news_articles` tables and pg_cron cleanup jobs |
| 2 | `database/002-add-banks.sql` | Extends provider list to include banks |
| 3 | `database/003-entities.sql` | Creates the `entities` master table and seeds 14 providers |
| 4 | `database/004-fix-provider-constraint.sql` | Fixes FK constraint (idempotent) |
| 5 | `database/005-allow-maintenance-partial-status.sql` | Adds `Maintenance` and `Partial` statuses |

> **Tip:** You can run them one after another in a single SQL Editor session.

### 3. Create the Environment File

```bash
cp .env.example .env
```

Copy the example file and fill in your values:

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Server
PORT=3000

# LLM (Groq shown by default — works with any OpenAI-compatible API)
LLM_API_KEY=your-llm-api-key-here
LLM_MODEL=google/gemini-2.0-flash-001
LLM_BASE_URL=https://api.groq.com/openai/v1
```

- **SUPABASE_URL** and **SUPABASE_SERVICE_ROLE_KEY** — found in Supabase under **Settings → API → Project API keys** (use the `service_role` key, not the anon key).
- **LLM_API_KEY** — used for status classification, headline generation, and chat. Works with [Groq](https://groq.com/), [OpenRouter](https://openrouter.ai/), Ollama, or any OpenAI-compatible endpoint.

### 4. Start the App

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Project Structure

```
StatusSphere/
├── server.js              # Express server, routes, triggers
├── database/              # SQL migrations (run in order)
│   ├── 001-initial.sql
│   ├── 002-add-banks.sql
│   ├── 003-entities.sql
│   ├── 004-fix-provider-constraint.sql
│   ├── 005-allow-maintenance-partial-status.sql
│   └── database.md        # Full schema documentation
├── flowchart.md           # Data flow & trigger architecture
├── .env.example           # Template for environment variables
└── package.json
```
