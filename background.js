/**
 * FocusGuard AI v2 — background.js (Service Worker)
 * ─────────────────────────────────────────────────────────────────────────────
 * The orchestrator. This file is intentionally THIN.
 * 
 * v2 Architecture shift:
 *   v1: background.js was ~300 lines doing everything (AI, stats, alarms, messages)
 *   v2: background.js delegates to dedicated modules:
 *       - ai.js       → all Gemini API calls
 *       - analytics.js → all data read/write
 *       - sync.js      → Supabase cloud sync
 *
 * This file only:
 *   1. Listens for messages and routes them to the right module
 *   2. Manages alarms (focus mode timer)
 *   3. Sends notifications
 *   4. Coordinates cross-module workflows (e.g., distraction → AI → stats → notify)
 */

import {
  getAISuggestion,
  classifyYouTubeContent,
  generateStudyPlan,
  generateBehavioralInsights,
  generateWeeklyReport,
  invalidateApiKeyCache,
} from "./ai.js";

import {
  recordDistraction,
  recordFocusSessionComplete,
  recordFocusSessionStart,
  getDashboardState,
  getTodayProductivityScore,
} from "./analytics.js";

import {
  pushWeeklyStats,
  signIn, signUp, signOut, getSyncStatus,
} from "./sync.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const FOCUS_DURATION_MINUTES = 25;

// ─── Distraction Handler ──────────────────────────────────────────────────────

/**
 * Full workflow when a distraction threshold is crossed:
 *   1. Check cooldown (no duplicate alerts within 10 min)
 *   2. Check if YouTube content is educational — skip if so
 *   3. Get AI suggestion
 *   4. Record the distraction in analytics
 *   5. Send modal to content script (or OS notification fallback)
 */
async function handleDistractionDetected(tabId, siteName, videoTitle = null) {
  // Cooldown check
  const cooldownKey = `lastAlert_${siteName}`;
  const stored = await chrome.storage.local.get([cooldownKey]);
  const now = Date.now();

  if (now - (stored[cooldownKey] || 0) < 10 * 60 * 1000) return; // 10-min cooldown

  // YouTube educational content check
  if (siteName === "YouTube" && videoTitle) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentUrl = tabs[0]?.url || "";
      const classification = await classifyYouTubeContent(videoTitle, currentUrl);

      if (classification.isEducational && classification.confidence !== "low") {
        console.log(`FocusGuard: ${videoTitle} classified as educational — skipping alert`);
        return;
      }
    } catch (e) {
      // Classification failed, proceed with normal alert
    }
  }

  await chrome.storage.local.set({ [cooldownKey]: now });

  // Get AI suggestion and record stats in parallel
  const [suggestion] = await Promise.all([
    getAISuggestion(siteName),
    recordDistraction(siteName),
  ]);

  // Try in-page modal first
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "SHOW_FOCUS_MODAL",
      suggestion,
      siteName,
    });
  } catch (e) {
    // Tab navigated away — fall back to OS notification
    chrome.notifications.create(`fg_${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "⚡ FocusGuard AI",
      message: suggestion,
      buttons: [{ title: "Start Focus Mode" }],
      priority: 2,
    });
  }
}

// ─── Focus Mode ───────────────────────────────────────────────────────────────

async function startFocusMode(tabId, siteName) {
  const endTime = Date.now() + FOCUS_DURATION_MINUTES * 60 * 1000;

  await chrome.storage.local.set({
    focusMode: true,
    focusEndTime: endTime,
    focusSite: siteName,
    focusTabId: tabId,
  });

  await recordFocusSessionStart();

  chrome.alarms.create("focusModeEnd", { delayInMinutes: FOCUS_DURATION_MINUTES });

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "START_FOCUS_MODE",
      endTime,
      duration: FOCUS_DURATION_MINUTES,
    });
  } catch (e) {
    console.warn("FocusGuard: Could not start focus overlay", e.message);
  }
}

async function endFocusMode() {
  const data = await chrome.storage.local.get(["focusTabId"]);
  await chrome.storage.local.remove(["focusMode", "focusEndTime", "focusSite", "focusTabId"]);

  // Record completion and get rewards
  const rewards = await recordFocusSessionComplete();

  // Notify the content script
  if (data.focusTabId) {
    chrome.tabs.sendMessage(data.focusTabId, {
      type: "END_FOCUS_MODE",
      rewards, // pass XP + badges back for celebration UI
    }).catch(() => {});
  }

  // Background sync after session (fire and forget)
  getDashboardState().then(state => pushWeeklyStats(state)).catch(() => {});

  const streakMsg = rewards.streak >= 3 ? ` 🔥 ${rewards.streak}-day streak!` : "";
  chrome.notifications.create(`fg_done_${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "✅ Focus Session Complete!",
    message: `+${rewards.xpEarned} XP earned.${streakMsg} Great work! Take a short break.`,
    priority: 2,
  });
}

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // Always return true for async handlers
  (async () => {
    switch (message.type) {

      case "DISTRACTION_DETECTED":
        await handleDistractionDetected(tabId, message.siteName, message.videoTitle);
        sendResponse({ ok: true });
        break;

      case "START_FOCUS_MODE":
        await startFocusMode(tabId || message.tabId, message.siteName);
        sendResponse({ ok: true });
        break;

      case "API_KEY_UPDATED":
        invalidateApiKeyCache();
        sendResponse({ ok: true });
        break;

      case "GET_FOCUS_STATUS":
        chrome.storage.local.get(["focusMode", "focusEndTime"], sendResponse);
        break;

      case "GET_DASHBOARD_STATE":
        // Single call returns everything the popup needs
        sendResponse(await getDashboardState());
        break;

      case "GET_AI_STUDY_PLAN": {
        const state = await getDashboardState();
        const plan = await generateStudyPlan({
          subjects: state.subjects,
          daysUntilExam: state.daysUntilExam,
          peakDistractionHours: state.peakHours,
          weakSubjects: state.siteBreakdown
            .filter(s => s.count > 2)
            .map(s => s.site)
            .join(", "),
          sessionsCompleted: state.focusSessions,
        });
        sendResponse(plan);
        break;
      }

      case "GET_BEHAVIORAL_INSIGHTS": {
        const state = await getDashboardState();
        const insights = await generateBehavioralInsights(state);
        sendResponse({ insights });
        break;
      }

      case "GET_WEEKLY_REPORT": {
        const state = await getDashboardState();
        const report = await generateWeeklyReport(state);
        sendResponse({ report });
        break;
      }

      // Cloud sync messages
      case "SYNC_SIGN_IN":
        sendResponse(await signIn(message.email, message.password));
        break;

      case "SYNC_SIGN_UP":
        sendResponse(await signUp(message.email, message.password));
        break;

      case "SYNC_SIGN_OUT":
        sendResponse(await signOut());
        break;

      case "SYNC_GET_STATUS":
        sendResponse(await getSyncStatus());
        break;

      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
  })();

  return true; // Keep channel open for async
});

// ─── Alarm Handler ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "focusModeEnd") {
    endFocusMode();
  }
});

// ─── Notification Click Handler ───────────────────────────────────────────────

chrome.notifications.onButtonClicked.addListener(async (notifId, btnIndex) => {
  if (btnIndex === 0) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) startFocusMode(tabs[0].id, "manual");
  }
});

console.log("FocusGuard AI v2 background service worker started ✅");
