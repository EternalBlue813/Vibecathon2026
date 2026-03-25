# StatusSphere

Real-time cloud infrastructure status monitoring dashboard.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Supabase](https://supabase.com/) account

## Project Directory 
```bash
cd StatusSphere
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Supabase Database

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Create a new project
3. Open **SQL Editor** in your Supabase project
4. Copy and paste the contents of `database/001-initial.sql`
5. Click **Run**

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your Supabase credentials:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-secret-key-here
```

Find these values in Supabase: **Settings → API → Project API keys**

### 4. Start the Server

```bash
npm start
```

### 5. Open in Browser

```
http://localhost:3000
```

## Managing Data

### Stop the Server

Press `Ctrl + C`

### Clear Database

Run this in Supabase SQL Editor:

```sql
DELETE FROM news_articles;
DELETE FROM incidents;
DELETE FROM snapshots;
```

### Reset Cron Jobs

If cleanup stops working, run in Supabase SQL Editor:

```sql
SELECT cron.unschedule('cleanup-news-30days');
SELECT cron.unschedule('cleanup-snapshot-30days');
-- Then re-run from database/001-initial.sql
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Supabase credentials not found` | Make sure `.env` file exists with valid credentials |
| Tables not found | Make sure you ran `database/001-initial.sql` |
| No data showing | Check browser console for errors |
