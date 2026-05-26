/**
 * FocusGuard AI v2 — analytics.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The Analytics Engine. Handles ALL data writes and reads for:
 *   - Daily distraction events (with hour-of-day tagging)
 *   - Focus session tracking (start, end, duration)
 *   - XP and gamification state
 *   - Weekly trend aggregation
 *   - Productivity score calculation
 *
 * WHY a separate module:
 *   background.js was becoming a god-file mixing AI, alarms, and stats.
 *   Isolating analytics here keeps each file under ~200 lines and makes
 *   the data layer independently testable and extendable.
 *
 * DATA SCHEMA (chrome.storage.local keys):
 *   stats_YYYY-MM-DD  → { siteName: count, ... , _hours: { "14": 3, ... } }
 *   focusSessions     → total completed sessions (number)
 *   focusStreak       → { count, lastDate } — consecutive days with ≥1 session
 *   xp                → total XP points earned
 *   badges            → string[] of earned badge IDs
 *   weeklyGoal        → { targetMinutes, earnedMinutes, weekStart }
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function todayKey() {
  return `stats_${new Date().toISOString().split("T")[0]}`;
}

export function dateKey(date) {
  return `stats_${date.toISOString().split("T")[0]}`;
}

export function currentHour() {
  return String(new Date().getHours());
}

// ─── Distraction Tracking ─────────────────────────────────────────────────────

/**
 * Record a distraction event for a site.
 * Also tags the current hour so we can build "peak distraction time" insights.
 */
export async function recordDistraction(siteName) {
  const key = todayKey();
  const stored = await chrome.storage.local.get([key]);
  const stats = stored[key] || {};

  // Site count
  stats[siteName] = (stats[siteName] || 0) + 1;

  // Hour-of-day tagging
  if (!stats._hours) stats._hours = {};
  const hour = currentHour();
  stats._hours[hour] = (stats._hours[hour] || 0) + 1;

  // Subject context — which subject was likely being studied? (alphabetical guess based on time)
  // This is stored so AI can reference "what subject you avoid"
  const subjectsData = await chrome.storage.local.get(["subjects"]);
  if (subjectsData.subjects) {
    if (!stats._subjectContext) stats._subjectContext = {};
    // We'll refine this later via AI planner — for now tag the "due up next" subject
    const subjectList = subjectsData.subjects.split(",").map(s => s.trim());
    const hourNum = parseInt(hour);
    const idx = hourNum % subjectList.length;
    const subject = subjectList[idx];
    stats._subjectContext[subject] = (stats._subjectContext[subject] || 0) + 1;
  }

  await chrome.storage.local.set({ [key]: stats });
}

// ─── Focus Session Tracking ───────────────────────────────────────────────────

/**
 * Called when a focus session completes successfully.
 * Increments session count, updates streak, awards XP.
 */
export async function recordFocusSessionComplete() {
  const data = await chrome.storage.local.get([
    "focusSessions", "focusStreak", "xp", "badges", "weeklyGoal"
  ]);

  // Session count
  const sessions = (data.focusSessions || 0) + 1;

  // Streak logic
  const today = new Date().toISOString().split("T")[0];
  const streak = data.focusStreak || { count: 0, lastDate: null };
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  if (streak.lastDate === yesterday) {
    streak.count += 1;
  } else if (streak.lastDate === today) {
    // already counted today, no change
  } else {
    streak.count = 1; // reset streak
  }
  streak.lastDate = today;

  // XP: +50 per session, +20 streak bonus if streak >= 3
  let xpEarned = 50;
  if (streak.count >= 3) xpEarned += 20;
  if (streak.count >= 7) xpEarned += 30; // extra for weekly streak
  const xp = (data.xp || 0) + xpEarned;

  // Weekly goal tracking
  const weeklyGoal = data.weeklyGoal || buildDefaultWeeklyGoal();
  weeklyGoal.earnedMinutes = (weeklyGoal.earnedMinutes || 0) + 25;

  // Badge checks
  const badges = data.badges || [];
  const newBadges = checkBadges({ sessions, streak: streak.count, xp, badges });
  const allBadges = [...new Set([...badges, ...newBadges])];

  await chrome.storage.local.set({
    focusSessions: sessions,
    focusStreak: streak,
    xp,
    badges: allBadges,
    weeklyGoal,
  });

  return { xpEarned, newBadges, streak: streak.count, totalXp: xp };
}

function buildDefaultWeeklyGoal() {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  return {
    targetMinutes: 150, // 6 sessions × 25 min
    earnedMinutes: 0,
    weekStart: weekStart.toISOString().split("T")[0],
  };
}

// ─── XP & Levels ─────────────────────────────────────────────────────────────

/**
 * XP thresholds for levels 1–10.
 * Level formula: each level needs 200 more XP than the last.
 */
export const LEVELS = [
  { level: 1, minXp: 0,    title: "Novice Scholar" },
  { level: 2, minXp: 200,  title: "Focused Learner" },
  { level: 3, minXp: 500,  title: "Study Warrior" },
  { level: 4, minXp: 900,  title: "Focus Adept" },
  { level: 5, minXp: 1400, title: "Deep Worker" },
  { level: 6, minXp: 2000, title: "Flow State Master" },
  { level: 7, minXp: 2700, title: "Exam Slayer" },
  { level: 8, minXp: 3500, title: "Peak Performer" },
  { level: 9, minXp: 4400, title: "Elite Focuser" },
  { level: 10, minXp: 5400, title: "FocusGuard Legend" },
];

export function getLevelFromXp(xp) {
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (xp >= lvl.minXp) current = lvl;
    else break;
  }
  const nextLevel = LEVELS[current.level] || null;
  const progress = nextLevel
    ? Math.min(100, Math.round(((xp - current.minXp) / (nextLevel.minXp - current.minXp)) * 100))
    : 100;
  return { ...current, nextLevel, progress };
}

// ─── Badges ───────────────────────────────────────────────────────────────────

export const ALL_BADGES = {
  first_session:    { id: "first_session",    icon: "🎯", label: "First Focus",     desc: "Completed your first focus session" },
  streak_3:         { id: "streak_3",         icon: "🔥", label: "On Fire",         desc: "3-day focus streak" },
  streak_7:         { id: "streak_7",         icon: "⚡", label: "Lightning Week",  desc: "7-day focus streak" },
  sessions_10:      { id: "sessions_10",      icon: "💎", label: "Diamond Focuser", desc: "10 total focus sessions" },
  sessions_25:      { id: "sessions_25",      icon: "🏆", label: "Champion",        desc: "25 total focus sessions" },
  early_bird:       { id: "early_bird",       icon: "🌅", label: "Early Bird",      desc: "Focused before 9 AM" },
  night_owl:        { id: "night_owl",        icon: "🦉", label: "Night Owl",       desc: "Focused after 10 PM" },
  xp_1000:          { id: "xp_1000",          icon: "⭐", label: "Star Student",    desc: "Earned 1000 XP" },
  weekly_goal:      { id: "weekly_goal",      icon: "📅", label: "Week Warrior",    desc: "Hit your weekly goal" },
};

function checkBadges({ sessions, streak, xp, badges }) {
  const earned = [];
  const has = (id) => badges.includes(id);

  if (!has("first_session") && sessions >= 1) earned.push("first_session");
  if (!has("streak_3") && streak >= 3) earned.push("streak_3");
  if (!has("streak_7") && streak >= 7) earned.push("streak_7");
  if (!has("sessions_10") && sessions >= 10) earned.push("sessions_10");
  if (!has("sessions_25") && sessions >= 25) earned.push("sessions_25");
  if (!has("xp_1000") && xp >= 1000) earned.push("xp_1000");

  // Time-based badges
  const hour = new Date().getHours();
  if (!has("early_bird") && hour < 9) earned.push("early_bird");
  if (!has("night_owl") && hour >= 22) earned.push("night_owl");

  return earned;
}

// ─── Productivity Score ───────────────────────────────────────────────────────

/**
 * Computes a 0–100 productivity score for today.
 * Formula:
 *   score = (focusSessionsToday × 20) - (distractionsToday × 8) + streakBonus
 * Clamped to [0, 100].
 */
export async function getTodayProductivityScore() {
  const key = todayKey();
  const data = await chrome.storage.local.get([key, "focusStreak"]);
  const stats = data[key] || {};

  const distractions = Object.entries(stats)
    .filter(([k]) => !k.startsWith("_"))
    .reduce((sum, [, v]) => sum + v, 0);

  // We track focus sessions inside the daily stats via _sessions
  const sessionsToday = stats._sessions || 0;
  const streak = data.focusStreak?.count || 0;
  const streakBonus = Math.min(streak * 3, 15); // max 15 bonus points

  const raw = (sessionsToday * 20) - (distractions * 8) + streakBonus;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Record a focus session start in today's stats (for score calculation).
 */
export async function recordFocusSessionStart() {
  const key = todayKey();
  const stored = await chrome.storage.local.get([key]);
  const stats = stored[key] || {};
  stats._sessions = (stats._sessions || 0) + 1;
  await chrome.storage.local.set({ [key]: stats });
}

// ─── Weekly Trends ────────────────────────────────────────────────────────────

/**
 * Returns the last 7 days of distraction + focus data.
 * Used by the analytics dashboard to render the weekly chart.
 */
export async function getWeeklyTrends() {
  const keys = [];
  const labels = [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    keys.push(dateKey(d));
    labels.push(dayNames[d.getDay()]);
  }

  const stored = await chrome.storage.local.get(keys);

  return keys.map((key, idx) => {
    const stats = stored[key] || {};
    const distractions = Object.entries(stats)
      .filter(([k]) => !k.startsWith("_"))
      .reduce((sum, [, v]) => sum + v, 0);
    const sessions = stats._sessions || 0;
    return { label: labels[idx], distractions, sessions };
  });
}

// ─── Peak Hours ───────────────────────────────────────────────────────────────

/**
 * Aggregates the last 7 days of hourly distraction data.
 * Returns array of { hour: "14", count: 7 } sorted by count desc.
 */
export async function getPeakDistractionHours() {
  const keys = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - i * 86400000);
    return dateKey(d);
  });

  const stored = await chrome.storage.local.get(keys);
  const hourMap = {};

  for (const key of keys) {
    const stats = stored[key] || {};
    const hours = stats._hours || {};
    for (const [hour, count] of Object.entries(hours)) {
      hourMap[hour] = (hourMap[hour] || 0) + count;
    }
  }

  return Object.entries(hourMap)
    .map(([hour, count]) => ({ hour: parseInt(hour), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

// ─── Full Dashboard State ─────────────────────────────────────────────────────

/**
 * Single call to get everything the popup dashboard needs.
 * Reduces multiple async calls from popup.js into one round trip.
 */
export async function getDashboardState() {
  const today = todayKey();
  const data = await chrome.storage.local.get([
    today,
    "focusSessions", "focusStreak", "xp", "badges",
    "focusMode", "focusEndTime",
    "subjects", "examDate",
    "weeklyGoal", "supabaseUserId",
  ]);

  const stats = data[today] || {};
  const distractionsToday = Object.entries(stats)
    .filter(([k]) => !k.startsWith("_"))
    .reduce((sum, [, v]) => sum + v, 0);

  const levelInfo = getLevelFromXp(data.xp || 0);
  const productivityScore = await getTodayProductivityScore();
  const weeklyTrends = await getWeeklyTrends();
  const peakHours = await getPeakDistractionHours();

  // Exam countdown
  let daysUntilExam = null;
  if (data.examDate) {
    const exam = new Date(data.examDate);
    exam.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    daysUntilExam = Math.ceil((exam - today) / 86400000);
  }

  // Site breakdown for today
  const siteBreakdown = Object.entries(stats)
    .filter(([k]) => !k.startsWith("_"))
    .map(([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count);

  return {
    distractionsToday,
    focusSessions: data.focusSessions || 0,
    sessionsToday: stats._sessions || 0,
    focusStreak: data.focusStreak || { count: 0, lastDate: null },
    xp: data.xp || 0,
    levelInfo,
    badges: data.badges || [],
    productivityScore,
    weeklyTrends,
    peakHours,
    siteBreakdown,
    daysUntilExam,
    subjects: data.subjects || "",
    examDate: data.examDate || null,
    focusMode: data.focusMode || false,
    focusEndTime: data.focusEndTime || null,
    weeklyGoal: data.weeklyGoal || buildDefaultWeeklyGoal(),
    isCloudSynced: !!data.supabaseUserId,
  };
}
