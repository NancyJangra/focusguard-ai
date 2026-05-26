# ⚡ FocusGuard AI v2
### AI-Powered Behavioral Productivity & Focus Analytics Platform for Students

> Chrome Extension · Manifest V3 · Gemini AI · Supabase · Chart.js · Local-First

---

## What's New in v2

| Feature | v1 | v2 |
|---|---|---|
| Distraction detection | ✅ Time + scroll | ✅ + YouTube educational classification |
| AI suggestions | ✅ Single nudge | ✅ + Study planner + Behavioral insights + Weekly report |
| Analytics | Basic daily count | 7-day trends, peak hours, productivity score |
| Gamification | ❌ | ✅ XP, levels, badges, streaks, weekly goals |
| Cloud sync | ❌ | ✅ Supabase (optional, local-first) |
| UI | Single tab popup | 4-tab dark glassmorphism popup |
| Code structure | 1 monolithic file | Modular: ai.js, analytics.js, sync.js |

---

## Architecture Overview

```
focusguard-ai-v2/
├── manifest.json         ← Extension config (permissions, content scripts)
├── background.js         ← Service worker: thin orchestrator, message router
├── content.js            ← Injected into tracked sites: tracking + modals
├── content-styles.css    ← In-page modal and focus overlay styles
├── popup.html            ← 4-tab popup UI markup
├── popup.js              ← Popup controller: dashboard, analytics, planner, settings
├── styles.css            ← Popup UI styles (dark glassmorphism)
├── analytics.js          ← Analytics engine: all data read/write, XP, levels
├── ai.js                 ← AI pipeline: all Gemini API calls in one place
├── sync.js               ← Supabase cloud sync: auth + data push/pull
├── README.md             ← This file
├── README_SUPABASE.md    ← Supabase setup guide with SQL
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Why This Structure?

**v1 problem:** `background.js` was ~300 lines handling AI calls, stats, alarms, notifications, and messages all mixed together. Hard to debug, extend, or test.

**v2 solution:** Each file has exactly one responsibility:
- `ai.js` — You want to add a new AI feature? Only touch this file.
- `analytics.js` — You want to change the XP formula? Only touch this file.
- `sync.js` — You want to add a new cloud backend? Only touch this file.
- `background.js` — Stays thin: just routes messages to the right module.

---

## Feature Deep Dives

### 1. Context-Aware YouTube Detection
**File:** `ai.js` → `classifyYouTubeContent()`

**Problem:** In v1, a student watching a CS lecture on YouTube would get a distraction alert — counterproductive.

**Solution:**
1. `content.js` extracts the YouTube video title from the DOM
2. Sends it to `background.js` along with the page URL
3. `background.js` calls `classifyYouTubeContent(title, url)` in `ai.js`
4. Fast path: regex-based heuristic for obvious educational keywords (no API call needed)
5. Slow path: Gemini classifies ambiguous titles, returns `{isEducational, confidence, reason}`
6. If educational + confidence is not low → skip the distraction alert entirely

### 2. Analytics Engine
**File:** `analytics.js`

**Data stored per day (`stats_YYYY-MM-DD`):**
```json
{
  "YouTube": 3,
  "Instagram": 1,
  "_hours": { "14": 2, "21": 2 },
  "_sessions": 2,
  "_subjectContext": { "DSA": 2, "DBMS": 1 }
}
```

The `_hours` field is how "peak distraction hours" is computed — it accumulates across 7 days.

**Productivity Score formula:**
```
score = (sessionsToday × 20) - (distractionsToday × 8) + min(streak × 3, 15)
clamped to [0, 100]
```

**XP system:**
- +50 XP per completed focus session
- +20 bonus if streak ≥ 3 days
- +30 bonus if streak ≥ 7 days

### 3. AI Study Planner
**File:** `ai.js` → `generateStudyPlan()`

Sends a structured prompt to Gemini with:
- Subject list
- Days until exam
- Peak distraction hours (to AVOID scheduling during these)
- Weak subjects (subjects that get avoided before distractions)
- Sessions completed

Returns a JSON schedule with specific tasks per time slot.

**Fallback:** Mock plan using subject list, no API call needed.

### 4. Behavioral Insights
**File:** `ai.js` → `generateBehavioralInsights()`

Compresses 7 days of data into a short Gemini prompt. Returns 4 data-driven, second-person insights like:
- "You tend to get distracted most around 21:00. Schedule a break before this hour."
- "Reddit is your biggest time sink this week."

### 5. Gamification
**File:** `analytics.js`

**Levels (1–10):** XP thresholds from 0 to 5400. Each level has a title (e.g., "Deep Worker", "Flow State Master").

**Badges:**
| Badge | Trigger |
|---|---|
| 🎯 First Focus | Complete first session |
| 🔥 On Fire | 3-day streak |
| ⚡ Lightning Week | 7-day streak |
| 💎 Diamond Focuser | 10 sessions total |
| 🏆 Champion | 25 sessions total |
| 🌅 Early Bird | Focus session before 9 AM |
| 🦉 Night Owl | Focus session after 10 PM |
| ⭐ Star Student | Earn 1000 XP |

### 6. Cloud Sync (Supabase)
**File:** `sync.js`

**Architecture decisions:**
- Uses Supabase REST API directly (no npm SDK — works in MV3 service worker)
- Auth via Supabase email/password flow
- Row-Level Security: each user can only read/write their own rows
- Local-first: every write goes to `chrome.storage.local` first, then syncs in background
- Sync is fire-and-forget — never blocks UI or distraction detection

**Sync trigger:** After every completed focus session, the full dashboard state is pushed.

---

## Message Passing Reference

```
content.js → background.js:
  DISTRACTION_DETECTED  { siteName, trigger, activeTimeMs, scrollPx, videoTitle? }

popup.js → background.js:
  GET_DASHBOARD_STATE   → full analytics state object
  GET_AI_STUDY_PLAN     → { plan, motivation, weekFocus }
  GET_BEHAVIORAL_INSIGHTS → { insights: string[] }
  GET_WEEKLY_REPORT     → { report: string }
  SYNC_SIGN_IN/UP/OUT   → { success, error? }
  SYNC_GET_STATUS       → { isConfigured, isAuthenticated, email }

background.js → content.js:
  SHOW_FOCUS_MODAL      { suggestion, siteName }
  START_FOCUS_MODE      { endTime, duration }
  END_FOCUS_MODE        { rewards: { xpEarned, newBadges, streak } }
```

---

## Installation

1. Download and extract `focusguard-ai-v2.zip`
2. Open `chrome://extensions`
3. Enable **Developer Mode** (top right)
4. Click **Load unpacked** → select the `focusguard-ai-v2` folder
5. Click ⚡ in toolbar → **Settings** → add your Gemini API key
6. (Optional) Set up Supabase following `README_SUPABASE.md`

### Getting a Gemini API Key (Free)
1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Click **Create API Key**
3. Copy it (starts with `AIzaSy...`)
4. Paste into FocusGuard Settings

Free tier: 1,500 requests/day — far more than any student needs.

---

## Customization

| What | File | Variable |
|---|---|---|
| Distraction time threshold | `content.js` | `THRESHOLD_MS` |
| Scroll threshold | `content.js` | `SCROLL_THRESHOLD` |
| Focus session duration | `background.js` | `FOCUS_DURATION_MINUTES` |
| XP per session | `analytics.js` | `recordFocusSessionComplete()` |
| Level titles | `analytics.js` | `LEVELS` array |
| Badge definitions | `analytics.js` | `ALL_BADGES` |
| Productivity score formula | `analytics.js` | `getTodayProductivityScore()` |
| Add new distracting site | `manifest.json` (host_permissions + matches) + `content.js` (SITE_MAP) |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Study plan shows mock data | Add Gemini API key in Settings |
| Insights say "not enough data" | Use the extension for 2+ days |
| Cloud sync not working | Follow README_SUPABASE.md setup steps |
| Modal doesn't appear | Scroll the page or interact with it — passive watching doesn't count |
| Changes not applying | Go to `chrome://extensions` → refresh the FocusGuard card |

---

## Tech Stack

| Component | Technology | Why |
|---|---|---|
| Extension Platform | Chrome MV3 | Required for modern Chrome extensions |
| AI | Gemini 2.0 Flash | Fast, free tier generous, multimodal capable |
| Analytics Charts | Chart.js 4 | Lightweight, no build step needed |
| Cloud | Supabase (Postgres) | Open source, free tier, REST API, RLS |
| Storage | chrome.storage.local | Browser-native, no server needed |
| Fonts | DM Sans + Space Mono | Clean sans + monospace for data |
| Styling | Vanilla CSS + glassmorphism | No framework overhead in extension |
