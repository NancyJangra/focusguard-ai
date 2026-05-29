
(function () {
  "use strict";

  if (window.__focusGuardInitialized) return;
  window.__focusGuardInitialized = true;

  // ─── Site Detection ──────────────────────────────────────────────────────────
  const hostname = window.location.hostname;
  const SITE_MAP = {
    "youtube.com": "YouTube",         "www.youtube.com": "YouTube",
    "instagram.com": "Instagram",     "www.instagram.com": "Instagram",
    "twitter.com": "Twitter / X",     "www.twitter.com": "Twitter / X",
    "x.com": "Twitter / X",           "www.x.com": "Twitter / X",
    "reddit.com": "Reddit",           "www.reddit.com": "Reddit",
    "tiktok.com": "TikTok",           "www.tiktok.com": "TikTok",
    "facebook.com": "Facebook",       "www.facebook.com": "Facebook",
  };
  const siteName = SITE_MAP[hostname] || hostname;

  // ─── Constants ────────────────────────────────────────────────────────────────
  const THRESHOLD_MS    = 5 * 60 * 1000;  // 5 minutes
  const SCROLL_THRESHOLD = 3000;           // 3000px
  const TICK_INTERVAL   = 5000;           // 5s tick
  const IDLE_TIMEOUT    = 30 * 1000;      // 30s idle

  // ─── State ────────────────────────────────────────────────────────────────────
  let activeTime      = 0;
  let totalScroll     = 0;
  let lastActivity    = Date.now();
  let alerted         = false;
  let focusModeActive = false;
  let focusEndTime    = null;
  let tickInterval    = null;
  let countdownInterval = null;
  let lastScrollY     = window.scrollY;

  // ─── YouTube Title Extraction ─────────────────────────────────────────────────
  // We need the video title to send to background for educational classification.
  function getYouTubeTitle() {
    // YouTube sets the title in multiple places — use the most reliable
    const titleEl = document.querySelector("h1.ytd-video-primary-info-renderer yt-formatted-string")
      || document.querySelector("h1.title")
      || document.querySelector("title");
    return titleEl?.textContent?.trim() || document.title || "";
  }

  // ─── Activity Listeners ───────────────────────────────────────────────────────
  function recordActivity() { lastActivity = Date.now(); }

  document.addEventListener("mousemove", recordActivity, { passive: true });
  document.addEventListener("keydown",   recordActivity, { passive: true });
  document.addEventListener("click",     recordActivity, { passive: true });

  document.addEventListener("scroll", () => {
    const scrolled = Math.abs(window.scrollY - lastScrollY);
    totalScroll += scrolled;
    lastScrollY  = window.scrollY;
    recordActivity();

    if (!alerted && !focusModeActive && totalScroll > SCROLL_THRESHOLD) {
      triggerAlert("scroll");
    }
  }, { passive: true });

  document.addEventListener("visibilitychange", () => {
    lastActivity = document.hidden ? 0 : Date.now();
  });

  // ─── Ticker ───────────────────────────────────────────────────────────────────
  tickInterval = setInterval(() => {
    if (focusModeActive) return;
    const isActive = Date.now() - lastActivity < IDLE_TIMEOUT;
    if (isActive) activeTime += TICK_INTERVAL;
    if (!alerted && activeTime >= THRESHOLD_MS) triggerAlert("time");
  }, TICK_INTERVAL);

  // ─── Alert Logic ──────────────────────────────────────────────────────────────
  function triggerAlert(trigger) {
    if (alerted || focusModeActive) return;
    alerted = true;

    // For YouTube, also send video title for educational classification
    const videoTitle = siteName === "YouTube" ? getYouTubeTitle() : null;

    chrome.runtime.sendMessage({
      type: "DISTRACTION_DETECTED",
      siteName,
      trigger,
      activeTimeMs: activeTime,
      scrollPx: totalScroll,
      videoTitle,
    });

    // Reset after 10-minute cooldown
    setTimeout(() => {
      alerted = false;
      activeTime = 0;
      totalScroll = 0;
    }, 10 * 60 * 1000);
  }

  // ─── Modal Rendering ──────────────────────────────────────────────────────────
  function createModal(suggestion, siteName) {
    removeModal();

    const overlay = document.createElement("div");
    overlay.id = "fg-overlay";
    overlay.innerHTML = `
      <div id="fg-modal">
        <div id="fg-header">
          <div id="fg-logo">
            <span id="fg-logo-icon">⚡</span>
            <span id="fg-logo-text">FocusGuard AI</span>
          </div>
          <button id="fg-close" aria-label="Close">✕</button>
        </div>

        <div id="fg-body">
          <div id="fg-alert-badge">DISTRACTION DETECTED</div>
          <div id="fg-site-pill">📍 ${siteName}</div>

          <div id="fg-time-display">
            <span id="fg-time-icon">⏱</span>
            <span id="fg-time-label">Active for <strong>5+ min</strong></span>
          </div>

          <div id="fg-suggestion-box">
            <div id="fg-suggestion-label">✦ AI SUGGESTION</div>
            <p id="fg-suggestion-text">${suggestion}</p>
          </div>
        </div>

        <div id="fg-actions">
          <button id="fg-focus-btn">
            <span class="fg-btn-icon">🎯</span>
            <span>Start Focus Mode</span>
            <span class="fg-btn-dur">25 min</span>
          </button>
          <button id="fg-dismiss-btn">Dismiss</button>
        </div>

        <div id="fg-footer">Powered by FocusGuard AI · Gemini</div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("fg-visible"));

    document.getElementById("fg-close").addEventListener("click", removeModal);
    document.getElementById("fg-dismiss-btn").addEventListener("click", removeModal);
    document.getElementById("fg-focus-btn").addEventListener("click", () => {
      removeModal();
      initiateFocusMode();
    });
  }

  function removeModal() {
    const el = document.getElementById("fg-overlay");
    if (el) {
      el.classList.remove("fg-visible");
      setTimeout(() => el.remove(), 300);
    }
  }

  // ─── Focus Mode ───────────────────────────────────────────────────────────────
  function initiateFocusMode() {
    focusModeActive = true;
    chrome.runtime.sendMessage({ type: "START_FOCUS_MODE", siteName });
    showFocusOverlay(Date.now() + 25 * 60 * 1000);
  }

  function showFocusOverlay(endTime) {
    removeFocusOverlay();
    focusEndTime = endTime;

    const overlay = document.createElement("div");
    overlay.id = "fg-focus-overlay";
    overlay.innerHTML = `
      <div id="fg-focus-content">
        <div id="fg-focus-header">
          <span class="fg-focus-icon-lg">🎯</span>
          <h2 id="fg-focus-title">FOCUS MODE</h2>
          <p id="fg-focus-subtitle">This site is blocked during your session</p>
        </div>

        <div id="fg-focus-ring-container">
          <svg id="fg-focus-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
            <circle id="fg-ring-bg" cx="100" cy="100" r="85" />
            <circle id="fg-ring-progress" cx="100" cy="100" r="85"
              stroke-dasharray="534"
              stroke-dashoffset="0"
              transform="rotate(-90 100 100)" />
          </svg>
          <div id="fg-focus-timer-wrap">
            <div id="fg-focus-timer">25:00</div>
            <div id="fg-focus-timer-label">remaining</div>
          </div>
        </div>

        <div id="fg-focus-tip">Switch to your study material and start a focused session ✦</div>
        <button id="fg-end-focus-btn">End Early</button>
      </div>
      <div id="fg-focus-particles"></div>
    `;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.appendChild(overlay);

    addParticles(overlay.querySelector("#fg-focus-particles"));
    requestAnimationFrame(() => overlay.classList.add("fg-focus-visible"));

    document.getElementById("fg-end-focus-btn").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "START_FOCUS_MODE" }); // will trigger endFocusMode via alarm cancel
      endFocusOverlay();
    });

    startCountdown(endTime);
  }

  function startCountdown(endTime) {
    const timerEl  = document.getElementById("fg-focus-timer");
    const ringEl   = document.getElementById("fg-ring-progress");
    const TOTAL    = 25 * 60 * 1000;
    const CIRCUM   = 534;

    countdownInterval = setInterval(() => {
      const remaining = Math.max(0, endTime - Date.now());
      const min = Math.floor(remaining / 60000);
      const sec = Math.floor((remaining % 60000) / 1000);

      if (timerEl) timerEl.textContent = `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
      if (ringEl) {
        const progress = 1 - remaining / TOTAL;
        ringEl.style.strokeDashoffset = CIRCUM * (1 - progress);
      }

      if (remaining <= 0) {
        clearInterval(countdownInterval);
        endFocusOverlay();
      }
    }, 1000);
  }

  function endFocusOverlay(rewards = null) {
    clearInterval(countdownInterval);
    focusModeActive = false;
    focusEndTime    = null;

    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";

    const overlay = document.getElementById("fg-focus-overlay");
    if (overlay) {
      overlay.classList.remove("fg-focus-visible");
      setTimeout(() => overlay.remove(), 400);
    }

    showCompletionToast(rewards);
  }

  function showCompletionToast(rewards = null) {
    const toast = document.createElement("div");
    toast.id = "fg-toast";

    let msg = "✅ Focus session complete! Great work.";
    if (rewards?.xpEarned) msg += ` +${rewards.xpEarned} XP`;
    if (rewards?.newBadges?.length) msg += ` 🏆 New badge!`;

    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("fg-toast-visible"));

    setTimeout(() => {
      toast.classList.remove("fg-toast-visible");
      setTimeout(() => toast.remove(), 400);
    }, 5000);
  }

  function removeFocusOverlay() {
    document.getElementById("fg-focus-overlay")?.remove();
    clearInterval(countdownInterval);
  }

  function addParticles(container) {
    if (!container) return;
    for (let i = 0; i < 18; i++) {
      const p = document.createElement("div");
      p.className = "fg-particle";
      p.style.cssText = `
        left:${Math.random()*100}%;top:${Math.random()*100}%;
        animation-delay:${Math.random()*4}s;
        animation-duration:${3+Math.random()*4}s;
        width:${2+Math.random()*4}px;height:${2+Math.random()*4}px;
        opacity:${0.2+Math.random()*0.4};
      `;
      container.appendChild(p);
    }
  }

  // ─── Message Listener ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "SHOW_FOCUS_MODAL")  createModal(message.suggestion, message.siteName);
    if (message.type === "START_FOCUS_MODE")  { focusModeActive = true; showFocusOverlay(message.endTime); }
    if (message.type === "END_FOCUS_MODE")    endFocusOverlay(message.rewards);
  });

  // Restore focus overlay on page reload
  chrome.runtime.sendMessage({ type: "GET_FOCUS_STATUS" }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res?.focusMode && res?.focusEndTime > Date.now()) {
      focusModeActive = true;
      showFocusOverlay(res.focusEndTime);
    }
  });

  console.log(`FocusGuard AI v2: tracking ${siteName} ✅`);
})();
