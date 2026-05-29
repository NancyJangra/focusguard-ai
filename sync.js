
// ─── Supabase Config ──────────────────────────────────────────────────────────

async function getSupabaseConfig() {
  const data = await chrome.storage.local.get(["supabaseUrl", "supabaseAnonKey", "supabaseUserId"]);
  return {
    url: data.supabaseUrl || null,
    anonKey: data.supabaseAnonKey || null,
    userId: data.supabaseUserId || null,
  };
}

function supabaseHeaders(anonKey) {
  return {
    "Content-Type": "application/json",
    "apikey": anonKey,
    "Authorization": `Bearer ${anonKey}`,
    "Prefer": "return=minimal",
  };
}

// ─── Authentication ───────────────────────────────────────────────────────────

/**
 * Sign up a new user with email/password.
 * Stores the returned user ID locally for future syncs.
 * Returns { success: bool, error?: string }
 */
export async function signUp(email, password) {
  const { url, anonKey } = await getSupabaseConfig();
  if (!url || !anonKey) return { success: false, error: "Supabase not configured" };

  try {
    const res = await fetch(`${url}/auth/v1/signup`, {
      method: "POST",
      headers: { ...supabaseHeaders(anonKey), "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (data.error) return { success: false, error: data.error.message };

    const userId = data.user?.id;
    if (userId) {
      await chrome.storage.local.set({ supabaseUserId: userId, supabaseEmail: email });
    }
    return { success: true, userId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Sign in existing user.
 */
export async function signIn(email, password) {
  const { url, anonKey } = await getSupabaseConfig();
  if (!url || !anonKey) return { success: false, error: "Supabase not configured" };

  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { ...supabaseHeaders(anonKey) },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (data.error) return { success: false, error: data.error.message };

    const userId = data.user?.id;
    const accessToken = data.access_token;

    if (userId) {
      await chrome.storage.local.set({
        supabaseUserId: userId,
        supabaseEmail: email,
        supabaseAccessToken: accessToken,
      });
    }
    return { success: true, userId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Sign out — clears Supabase credentials from local storage.
 */
export async function signOut() {
  await chrome.storage.local.remove([
    "supabaseUserId", "supabaseEmail", "supabaseAccessToken"
  ]);
  return { success: true };
}

// ─── Data Sync ────────────────────────────────────────────────────────────────

/**
 * Push this week's analytics to Supabase.
 * Fire-and-forget: call without await for background sync.
 *
 * TABLE: weekly_logs
 *   user_id    uuid  references users(id)
 *   week_start date
 *   stats_json jsonb  (the full analytics blob)
 *   updated_at timestamp
 */
export async function pushWeeklyStats(analyticsData) {
  const { url, anonKey, userId } = await getSupabaseConfig();
  if (!url || !anonKey || !userId) return;

  const weekStart = getWeekStart();

  try {
    const res = await fetch(`${url}/rest/v1/weekly_logs`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(anonKey),
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        week_start: weekStart,
        stats_json: analyticsData,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      console.warn("FocusGuard Sync: push failed", res.status);
    }
  } catch (err) {
    console.warn("FocusGuard Sync: network error", err.message);
  }
}


export async function pullHistoricalStats() {
  const { url, anonKey, userId } = await getSupabaseConfig();
  if (!url || !anonKey || !userId) return null;

  try {
    const res = await fetch(
      `${url}/rest/v1/weekly_logs?user_id=eq.${userId}&order=week_start.desc&limit=4`,
      { headers: supabaseHeaders(anonKey) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay()); // Sunday
  return d.toISOString().split("T")[0];
}

/**
 * Check if Supabase is configured and user is authenticated.
 */
export async function getSyncStatus() {
  const data = await chrome.storage.local.get([
    "supabaseUrl", "supabaseAnonKey", "supabaseUserId", "supabaseEmail"
  ]);
  return {
    isConfigured: !!(data.supabaseUrl && data.supabaseAnonKey),
    isAuthenticated: !!data.supabaseUserId,
    email: data.supabaseEmail || null,
    userId: data.supabaseUserId || null,
  };
}
