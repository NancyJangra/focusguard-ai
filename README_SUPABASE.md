# Supabase Setup for FocusGuard AI v2

## Why Supabase?
Supabase is an open-source Firebase alternative built on PostgreSQL. It has a generous free tier
(500MB database, 50K monthly active users) and provides a REST API that works directly from a
Chrome Extension without needing Node.js or any server.

---

## Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in with GitHub
2. Click **New Project**
3. Choose a name (e.g. `focusguard`), set a database password, pick a region close to you
4. Wait ~2 minutes for the project to provision

---

## Step 2: Create the Database Tables

Go to **SQL Editor** in your Supabase dashboard and run this SQL:

```sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Weekly analytics logs
-- Each row = one week of a user's productivity data
create table if not exists weekly_logs (
  id           uuid default uuid_generate_v4() primary key,
  user_id      uuid references auth.users(id) on delete cascade not null,
  week_start   date not null,
  stats_json   jsonb not null default '{}',
  updated_at   timestamp with time zone default now(),

  -- Ensure one row per user per week (upsert-friendly)
  unique (user_id, week_start)
);

-- Row Level Security: users can only see their own data
alter table weekly_logs enable row level security;

create policy "Users can manage own logs"
  on weekly_logs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Optional: AI-generated reports archive
create table if not exists weekly_reports (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  week_start  date not null,
  report_text text not null,
  created_at  timestamp with time zone default now(),
  unique (user_id, week_start)
);

alter table weekly_reports enable row level security;

create policy "Users can manage own reports"
  on weekly_reports
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

---

## Step 3: Get Your Credentials

In your Supabase project dashboard:
1. Go to **Settings → API**
2. Copy the **Project URL** (looks like `https://abcdef.supabase.co`)
3. Copy the **anon public** key (starts with `eyJhbGci...`)

---

## Step 4: Enter Credentials in FocusGuard

In the extension popup:
1. Click **Settings** tab
2. Paste your Project URL and Anon Key
3. Enter an email and password (will create your account)
4. Click **Sign Up** (or Sign In if you've done this before)
5. Click **Save Settings**

Your analytics will now sync to the cloud automatically after every focus session.

---

## Data Privacy Notes

- All sync is user-authenticated (email + password via Supabase Auth)
- Row-Level Security ensures you can ONLY see your own data
- The anon key is public by design — it cannot bypass RLS
- Your Gemini API key is NEVER synced to Supabase — it stays on your device only

---

## Local-First Guarantee

Even if Supabase is not configured or the network fails:
- All extension functionality works offline via `chrome.storage.local`
- Cloud sync is fire-and-forget — it never blocks the UI
- Data is always written locally first, then synced in the background
