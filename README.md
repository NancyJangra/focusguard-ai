<div align="center">

<img src="https://raw.githubusercontent.com/NancyJangra/focusguard-ai/main/icon128.png" alt="FocusGuard AI" width="100"/>

# ⚡ FocusGuard AI

**Stop scrolling. Start studying.**

AI-powered distraction detection and focus analytics for students — built as a Chrome Extension with Google Gemini, Chart.js, and Supabase.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/focusguard-ai/mmlfeichepnnjnofbcbbpodgkmbiieem)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success?style=for-the-badge)](https://developer.chrome.com/docs/extensions/mv3/)
[![Gemini AI](https://img.shields.io/badge/Gemini-2.0%20Flash-blue?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)

[🚀 Install from Chrome Web Store](https://chromewebstore.google.com/detail/focusguard-ai/mmlfeichepnnjnofbcbbpodgkmbiieem)

</div>

---

## 📸 Screenshots

<div align="center">

| Focus Mode | Dashboard |
|:---:|:---:|
| ![Focus](screenshots/focus.png) | ![Dashboard](screenshots/dashboard.png) |

| Analytics | AI Modal |
|:---:|:---:|
| ![Analytics](screenshots/analytics.png) | ![Modal](screenshots/modal.png) |

</div>

---

## ✨ What It Does

- 🚨 **Detects distractions** on YouTube, Instagram, Reddit, Twitter, TikTok, Facebook
- 🧠 **AI study nudges** via Google Gemini — personalised to your subjects and exam date
- 🎓 **Skips educational YouTube** — CS lectures and NPTEL won't trigger alerts
- 🎯 **25-min Focus Mode** — full-screen countdown timer blocks the distracting site
- 📊 **Analytics dashboard** — 7-day trends, peak distraction hours, AI behavioural insights
- 🔥 **Gamification** — XP points, 10 levels, 9 badges, streaks, weekly goals
- ☁️ **Optional cloud sync** via Supabase — all data stays local by default

---

## 🚀 Setup

**1. Install the extension**
```
chrome://extensions → Developer Mode ON → Load unpacked → select this folder
```

**2. Get a free Gemini API key**
```
aistudio.google.com/app/apikey → Create API Key → copy it
```

**3. Configure**
```
Click ⚡ in toolbar → Settings → paste API key → add subjects → set exam date → Save
```

---

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| Chrome MV3 | Extension platform |
| Google Gemini 2.0 Flash | AI suggestions, YouTube classification, study planner |
| Chart.js 4 | 7-day analytics charts |
| Supabase (Postgres) | Optional cloud sync with Row-Level Security |
| chrome.storage.local | Local-first data storage |
| Vanilla JS + CSS | No framework — lightweight and fast |

---

## 🏗️ Architecture

```
focusguard-ai/
├── manifest.json     ← Permissions & config
├── background.js     ← Service worker orchestrator
├── ai.js             ← All Gemini AI calls
├── analytics.js      ← XP, streaks, scores, trends
├── sync.js           ← Supabase cloud sync
├── content.js        ← Injected into tracked websites
├── popup.html/js     ← 4-tab dashboard UI
└── styles.css        ← Dark glassmorphism design
```

---

## 👩‍💻 Built By

**Nancy** · B.Tech CSE · IGDTUW

⭐ Star this repo if FocusGuard helped you stay focused!

