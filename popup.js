/**
 * FocusGuard AI v2 — popup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Controls the extension popup. 4 tabs: Dashboard, Analytics, AI Planner, Settings.
 *
 * Architecture note:
 *   All data fetching goes through a single GET_DASHBOARD_STATE message to background.js,
 *   which returns one big object. This avoids multiple round trips every time the popup opens.
 *
 *   Tab-specific heavy operations (AI plan, insights, report) are fetched lazily —
 *   only when the user opens that tab. This keeps the popup startup fast.
 */

import { ALL_BADGES, LEVELS, getLevelFromXp } from "./analytics.js";

// ─── State ────────────────────────────────────────────────────────────────────
let dashState = null;
let weeklyChartInstance = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  await loadAll();
  setupFocusBannerControls();
  setupQuickFocusButton();
  setupSettingsForm();
  setupSyncControls();
});

// ─── Tab Navigation ───────────────────────────────────────────────────────────
function setupTabs() {
  const tabBtns   = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");

  tabBtns.forEach(btn => {
    btn.addEventListener("click", async () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      tabPanels.forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const panel = document.getElementById(`tab-${btn.dataset.tab}`);
      panel.classList.add("active");

      // Lazy-load tab content
      if (btn.dataset.tab === "analytics") await loadAnalyticsTab();
      if (btn.dataset.tab === "planner")   setupPlannerTab();
      if (btn.dataset.tab === "settings")  await loadSettingsTab();
    });
  });
}

// ─── Main Data Load ───────────────────────────────────────────────────────────
async function loadAll() {
  dashState = await sendMessage({ type: "GET_DASHBOARD_STATE" });
  if (!dashState) return;

  renderDashboard(dashState);
  await checkFocusBanner();
  await loadSettingsValues(); // pre-fill settings silently
}

function renderDashboard(state) {
  // Stats
  document.getElementById("stat-distractions").textContent = state.distractionsToday;
  document.getElementById("stat-sessions").textContent     = state.sessionsToday;
  document.getElementById("stat-streak").textContent       = state.focusStreak?.count || 0;
  document.getElementById("stat-score").textContent        = state.productivityScore;

  // XP Bar
  const lvl = getLevelFromXp(state.xp);
  document.getElementById("xp-level-badge").textContent = `Lv.${lvl.level}`;
  document.getElementById("xp-level-title").textContent  = lvl.title;
  document.getElementById("xp-value").textContent         = `${state.xp} XP`;
  document.getElementById("xp-bar-fill").style.width      = `${lvl.progress}%`;

  // Productivity ring
  const score = state.productivityScore;
  const circumference = 214;
  const offset = circumference - (score / 100) * circumference;
  document.getElementById("score-ring-fill").style.strokeDashoffset = offset;
  document.getElementById("score-ring-value").textContent = score;

  const scoreDesc = score >= 70
    ? "Excellent focus today! Keep it up."
    : score >= 40
    ? "Good progress. A few more sessions will boost your score."
    : "Start a focus session to build momentum today.";
  document.getElementById("score-desc").textContent = scoreDesc;

  // Badges
  renderBadges(state.badges || []);

  // Exam countdown
  if (state.daysUntilExam !== null) {
    document.getElementById("exam-card").style.display = "flex";
    const dEl = document.getElementById("exam-days");
    dEl.textContent = state.daysUntilExam <= 0 ? "Today!" : `${state.daysUntilExam}d`;
    dEl.style.color = state.daysUntilExam <= 3 ? "#ef4444"
      : state.daysUntilExam <= 7 ? "#f97316" : "#a78bfa";
    if (state.subjects) {
      document.getElementById("exam-subjects-preview").textContent =
        state.subjects.split(",").slice(0, 3).map(s => s.trim()).join(" · ");
    }
  }

  // Site bars
  renderSiteBars(state.siteBreakdown || []);

  // Weekly goal
  const goal = state.weeklyGoal;
  if (goal) {
    const pct = Math.min(100, Math.round((goal.earnedMinutes / goal.targetMinutes) * 100));
    document.getElementById("weekly-goal-value").textContent = `${goal.earnedMinutes} / ${goal.targetMinutes} min`;
    document.getElementById("weekly-goal-fill").style.width  = `${pct}%`;
  }
}

function renderBadges(earnedBadgeIds) {
  const container = document.getElementById("badges-row");
  if (!earnedBadgeIds.length) {
    container.innerHTML = `<span class="badge-empty">Complete focus sessions to earn badges ✦</span>`;
    return;
  }
  container.innerHTML = earnedBadgeIds
    .map(id => ALL_BADGES[id])
    .filter(Boolean)
    .slice(0, 5)
    .map(b => `<span class="badge-chip" title="${b.label}: ${b.desc}">${b.icon}</span>`)
    .join("");
}

function renderSiteBars(breakdown) {
  const el = document.getElementById("site-bars");
  if (!breakdown.length) {
    el.innerHTML = `<div class="no-data">No distractions detected today</div>`;
    return;
  }
  const max = Math.max(...breakdown.map(b => b.count));
  el.innerHTML = breakdown.slice(0, 4).map(({ site, count }) => {
    const pct = Math.round((count / max) * 100);
    return `
      <div class="site-bar-row">
        <span class="site-bar-name">${site}</span>
        <div class="site-bar-track">
          <div class="site-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="site-bar-count">${count}x</span>
      </div>`;
  }).join("");
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────
async function loadAnalyticsTab() {
  if (!dashState) return;

  renderWeeklyChart(dashState.weeklyTrends);
  renderPeakHours(dashState.peakHours);
  await loadBehavioralInsights();

  document.getElementById("generate-report-btn")
    .addEventListener("click", generateReport, { once: true });

  document.getElementById("refresh-insights-btn")
    .addEventListener("click", () => loadBehavioralInsights(true));
}

function renderWeeklyChart(trends) {
  const ctx = document.getElementById("weekly-chart").getContext("2d");
  if (weeklyChartInstance) weeklyChartInstance.destroy();

  weeklyChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: trends.map(t => t.label),
      datasets: [
        {
          label: "Distractions",
          data: trends.map(t => t.distractions),
          backgroundColor: "rgba(239, 68, 68, 0.6)",
          borderColor: "rgba(239, 68, 68, 1)",
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: "Focus Sessions",
          data: trends.map(t => t.sessions),
          backgroundColor: "rgba(139, 92, 246, 0.7)",
          borderColor: "rgba(139, 92, 246, 1)",
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "rgba(255,255,255,0.6)", font: { size: 10 }, boxWidth: 10 },
        },
      },
      scales: {
        x: { ticks: { color: "rgba(255,255,255,0.5)", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "rgba(255,255,255,0.5)", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true },
      },
    },
  });
}

function renderPeakHours(peakHours) {
  const el = document.getElementById("peak-hours-list");
  if (!peakHours.length) {
    el.innerHTML = `<div class="no-data">Need more data to identify patterns</div>`;
    return;
  }

  const max = peakHours[0].count;
  el.innerHTML = peakHours.map(({ hour, count }) => {
    const label = `${hour}:00 – ${hour + 1}:00`;
    const pct   = Math.round((count / max) * 100);
    return `
      <div class="peak-hour-row">
        <span class="peak-hour-label">${label}</span>
        <div class="peak-hour-bar-track">
          <div class="peak-hour-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="peak-hour-count">${count}x</span>
      </div>`;
  }).join("");
}

async function loadBehavioralInsights(forceRefresh = false) {
  const el = document.getElementById("insights-list");
  el.innerHTML = `<div class="insight-loading"><div class="spinner-sm"></div> Analyzing patterns...</div>`;

  const result = await sendMessage({ type: "GET_BEHAVIORAL_INSIGHTS" });
  const insights = result?.insights || [];

  if (!insights.length) {
    el.innerHTML = `<div class="no-data">Track more sessions to unlock insights</div>`;
    return;
  }

  el.innerHTML = insights.map(text => `
    <div class="insight-card">
      <span class="insight-dot">✦</span>
      <p class="insight-text">${text}</p>
    </div>`).join("");
}

async function generateReport() {
  const btn = document.getElementById("generate-report-btn");
  btn.textContent = "Generating...";
  btn.disabled = true;

  const result = await sendMessage({ type: "GET_WEEKLY_REPORT" });
  const report = result?.report || "Failed to generate report.";

  document.getElementById("report-section").style.display = "block";
  document.getElementById("report-text").textContent = report;

  btn.textContent = "⬇ Report";
  btn.disabled = false;

  document.getElementById("copy-report-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(report).then(() => {
      document.getElementById("copy-report-btn").textContent = "Copied!";
      setTimeout(() => document.getElementById("copy-report-btn").textContent = "Copy", 2000);
    });
  });
}

// ─── AI Planner Tab ───────────────────────────────────────────────────────────
function setupPlannerTab() {
  document.getElementById("generate-plan-btn")
    .addEventListener("click", generatePlan, { once: true });
}

async function generatePlan() {
  const loadingEl = document.getElementById("plan-loading");
  const outputEl  = document.getElementById("plan-output");
  const btn       = document.getElementById("generate-plan-btn");

  btn.style.display = "none";
  loadingEl.style.display = "flex";

  const plan = await sendMessage({ type: "GET_AI_STUDY_PLAN" });

  loadingEl.style.display = "none";
  outputEl.style.display  = "block";

  if (!plan?.plan) {
    outputEl.innerHTML = `<div class="no-data">Failed to generate plan. Check your API key in Settings.</div>`;
    return;
  }

  document.getElementById("plan-motivation").textContent = plan.motivation || "";
  document.getElementById("week-focus-value").textContent = plan.weekFocus || "—";

  const scheduleEl = document.getElementById("plan-schedule");
  scheduleEl.innerHTML = plan.plan.map(item => `
    <div class="plan-item">
      <div class="plan-item-time">${item.time}</div>
      <div class="plan-item-body">
        <div class="plan-item-subject">${item.subject}</div>
        <div class="plan-item-task">${item.task}</div>
      </div>
      <div class="plan-item-dur">${item.durationMin}m</div>
    </div>`).join("");
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
async function loadSettingsTab() {
  await loadSettingsValues();
  await checkSyncStatus();
}

async function loadSettingsValues() {
  const data = await chrome.storage.local.get([
    "subjects", "examDate", "geminiApiKey",
    "supabaseUrl", "supabaseAnonKey",
  ]);
  if (data.subjects)    document.getElementById("subjects-input").value = data.subjects;
  if (data.examDate)    document.getElementById("exam-date-input").value = data.examDate;
  if (data.geminiApiKey) {
    document.getElementById("api-key-input").value = data.geminiApiKey;
    updateApiKeyStatus(data.geminiApiKey);
  }
  if (data.supabaseUrl)     document.getElementById("supabase-url-input").value = data.supabaseUrl;
  if (data.supabaseAnonKey) document.getElementById("supabase-key-input").value = data.supabaseAnonKey;
}

function setupSettingsForm() {
  document.getElementById("api-key-toggle").addEventListener("click", () => {
    const input = document.getElementById("api-key-input");
    const btn   = document.getElementById("api-key-toggle");
    input.type = input.type === "password" ? "text" : "password";
    btn.textContent = input.type === "password" ? "👁" : "🙈";
  });

  document.getElementById("api-key-input").addEventListener("input", e => {
    updateApiKeyStatus(e.target.value.trim());
  });

  document.getElementById("save-btn").addEventListener("click", saveSettings);
}

function updateApiKeyStatus(key) {
  const el = document.getElementById("api-key-status");
  if (!key) { el.textContent = ""; el.className = "api-key-status"; return; }
  if (key.startsWith("AIza") && key.length > 30) {
    el.textContent = "✓ Key looks valid";
    el.className = "api-key-status status-ok";
  } else {
    el.textContent = "⚠ Should start with AIza and be ~39 chars";
    el.className = "api-key-status status-warn";
  }
}

async function saveSettings() {
  const subjects     = document.getElementById("subjects-input").value.trim();
  const examDate     = document.getElementById("exam-date-input").value;
  const geminiApiKey = document.getElementById("api-key-input").value.trim();
  const supabaseUrl  = document.getElementById("supabase-url-input").value.trim();
  const supabaseKey  = document.getElementById("supabase-key-input").value.trim();

  await chrome.storage.local.set({ subjects, examDate, geminiApiKey, supabaseAnonKey: supabaseKey, supabaseUrl });
  chrome.runtime.sendMessage({ type: "API_KEY_UPDATED", geminiApiKey });

  const btn = document.getElementById("save-btn");
  const fb  = document.getElementById("save-feedback");
  document.getElementById("save-btn-text").textContent = "✓ Saved!";
  fb.textContent = "Settings saved successfully.";
  fb.classList.add("visible");

  setTimeout(() => {
    document.getElementById("save-btn-text").textContent = "Save Settings";
    fb.classList.remove("visible");
  }, 2500);
}

// ─── Cloud Sync Controls ─────────────────────────────────────────────────────
function setupSyncControls() {
  document.getElementById("sync-signin-btn")?.addEventListener("click", async () => {
    await saveSyncConfig();
    const email    = document.getElementById("sync-email-input").value.trim();
    const password = document.getElementById("sync-password-input").value;
    const result   = await sendMessage({ type: "SYNC_SIGN_IN", email, password });
    showSyncFeedback(result);
    if (result?.success) await checkSyncStatus();
  });

  document.getElementById("sync-signup-btn")?.addEventListener("click", async () => {
    await saveSyncConfig();
    const email    = document.getElementById("sync-email-input").value.trim();
    const password = document.getElementById("sync-password-input").value;
    const result   = await sendMessage({ type: "SYNC_SIGN_UP", email, password });
    showSyncFeedback(result);
    if (result?.success) await checkSyncStatus();
  });

  document.getElementById("sync-signout-btn")?.addEventListener("click", async () => {
    await sendMessage({ type: "SYNC_SIGN_OUT" });
    await checkSyncStatus();
  });
}

async function saveSyncConfig() {
  const url = document.getElementById("supabase-url-input").value.trim();
  const key = document.getElementById("supabase-key-input").value.trim();
  await chrome.storage.local.set({ supabaseUrl: url, supabaseAnonKey: key });
}

async function checkSyncStatus() {
  const status = await sendMessage({ type: "SYNC_GET_STATUS" });

  const dot        = document.getElementById("sync-dot");
  const statusText = document.getElementById("sync-status-text");
  const authSec    = document.getElementById("sync-auth-section");
  const connSec    = document.getElementById("sync-connected-section");

  if (status?.isAuthenticated) {
    dot.classList.add("sync-dot-active");
    statusText.textContent = "Synced to cloud";
    authSec.style.display  = "none";
    connSec.style.display  = "block";
    document.getElementById("sync-user-info").textContent = `Signed in as ${status.email || "—"}`;
  } else {
    dot.classList.remove("sync-dot-active");
    statusText.textContent = status?.isConfigured ? "Not signed in" : "Not configured";
    authSec.style.display  = "block";
    connSec.style.display  = "none";
  }
}

function showSyncFeedback(result) {
  const el = document.getElementById("sync-feedback");
  el.textContent = result?.success
    ? "✓ Connected successfully!"
    : `✗ ${result?.error || "Something went wrong"}`;
  el.className = `sync-feedback ${result?.success ? "sync-ok" : "sync-err"}`;
}

// ─── Focus Banner ─────────────────────────────────────────────────────────────
async function checkFocusBanner() {
  chrome.runtime.sendMessage({ type: "GET_FOCUS_STATUS" }, (res) => {
    if (chrome.runtime.lastError) return;
    const banner = document.getElementById("focus-banner");
    const dot    = document.getElementById("status-dot");
    const label  = document.getElementById("status-label");

    if (res?.focusMode && res?.focusEndTime > Date.now()) {
      banner.style.display = "flex";
      dot.classList.add("focus-active");
      label.textContent = "Focus Mode";
      startBannerTimer(res.focusEndTime);
    } else {
      banner.style.display = "none";
      label.textContent = "Tracking";
    }
  });
}

function setupFocusBannerControls() {
  document.getElementById("banner-end-btn").addEventListener("click", async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "END_FOCUS_MODE" }).catch(() => {});
    document.getElementById("focus-banner").style.display = "none";
  });
}

function startBannerTimer(endTime) {
  const el = document.getElementById("banner-timer");
  function tick() {
    const rem = Math.max(0, endTime - Date.now());
    const m   = Math.floor(rem / 60000);
    const s   = Math.floor((rem % 60000) / 1000);
    el.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} remaining`;
    if (rem > 0) setTimeout(tick, 1000);
    else document.getElementById("focus-banner").style.display = "none";
  }
  tick();
}

function setupQuickFocusButton() {
  document.getElementById("quick-focus-btn").addEventListener("click", async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) chrome.runtime.sendMessage({ type: "START_FOCUS_MODE", siteName: "manual", tabId: tabs[0].id });
    window.close();
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res);
    });
  });
}
