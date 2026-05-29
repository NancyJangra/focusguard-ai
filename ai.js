
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// In-memory key cache — invalidated on API_KEY_UPDATED message
let _cachedApiKey = null;

export function invalidateApiKeyCache() {
  _cachedApiKey = null;
}

export async function getApiKey() {
  if (_cachedApiKey) return _cachedApiKey;
  const data = await chrome.storage.local.get(["geminiApiKey"]);
  _cachedApiKey = data.geminiApiKey || null;
  return _cachedApiKey;
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function callGemini(prompt, maxTokens = 150, temperature = 0.7) {
  const apiKey = await getApiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      }),
    });

    if (!response.ok) {
      console.warn(`FocusGuard AI: Gemini returned ${response.status}`);
      return null;
    }

    const json = await response.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (err) {
    console.warn("FocusGuard AI: Gemini call failed:", err.message);
    return null;
  }
}

// ─── 1. Distraction Suggestion ────────────────────────────────────────────────

/**
 * Returns a short, motivating, personalized study nudge.
 * Called every time a distraction is detected.
 */
export async function getAISuggestion(siteName) {
  const data = await chrome.storage.local.get(["subjects", "examDate"]);
  const subjects = data.subjects || "General Studies";

  let daysLeft = null;
  if (data.examDate) {
    daysLeft = Math.ceil((new Date(data.examDate) - new Date()) / 86400000);
  }

  const examContext = daysLeft !== null
    ? `Exam in ${daysLeft} day(s).`
    : "Upcoming exams soon.";

  const prompt = `You are a strict but supportive study coach.
${examContext} Subjects: ${subjects}.
Student distracted on ${siteName} for 5+ minutes.

Give ONE short motivating study suggestion (max 2 sentences). 
Mention a specific topic from their subjects if possible.
Be direct, actionable. No emojis. No markdown.`;

  const result = await callGemini(prompt, 120, 0.8);
  return result || getMockSuggestion(siteName, subjects, daysLeft);
}

function getMockSuggestion(siteName, subjects, daysLeft) {
  const list = subjects.split(",").map(s => s.trim());
  const subject = list[Math.floor(Math.random() * list.length)];
  const urgency = daysLeft ? `Only ${daysLeft} days left.` : "Time is limited.";
  const templates = [
    `You have been on ${siteName} long enough. ${urgency} Open ${subject} and cover one complete topic now.`,
    `${subject} needs your attention. Close ${siteName} and run a 25-minute focused session on key concepts.`,
    `Distraction detected. ${urgency} Your next target: revise ${subject} for 25 minutes straight.`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

// ─── 2. YouTube Content Classification ───────────────────────────────────────

/**
 * Determines if a YouTube video is educational or purely entertainment.
 * Returns: { isEducational: bool, confidence: "high"|"medium"|"low", reason: string }
 *
 * WHY this matters:
 *   Blocking a student watching a CS lecture on YouTube is counterproductive.
 *   This classification prevents false positives on educational content.
 */
export async function classifyYouTubeContent(videoTitle, pageUrl) {
  // Fast heuristic first — avoid API call for obvious cases
  const educationalKeywords = [
    "tutorial", "lecture", "course", "explained", "how to", "learn",
    "study", "exam", "university", "professor", "algorithm", "programming",
    "mathematics", "physics", "chemistry", "biology", "history", "science",
    "mit", "stanford", "nptel", "coursera", "khan academy", "crash course"
  ];

  const title = (videoTitle || "").toLowerCase();
  const url = (pageUrl || "").toLowerCase();

  const heuristicMatch = educationalKeywords.some(kw => title.includes(kw) || url.includes(kw));
  if (heuristicMatch) {
    return { isEducational: true, confidence: "high", reason: "title contains educational keywords" };
  }

  // Fall back to AI only if no API key — return uncertain
  const apiKey = await getApiKey();
  if (!apiKey) {
    return { isEducational: false, confidence: "low", reason: "no API key for classification" };
  }

  const prompt = `Classify this YouTube video as EDUCATIONAL or ENTERTAINMENT.

Title: "${videoTitle}"
URL context: "${pageUrl}"

Reply with ONLY a JSON object: {"isEducational": true/false, "confidence": "high"/"medium"/"low", "reason": "one sentence"}
No markdown, no backticks.`;

  const result = await callGemini(prompt, 100, 0.3);

  try {
    const parsed = JSON.parse(result);
    return parsed;
  } catch {
    // If parse fails, fall back to heuristic negative
    return { isEducational: false, confidence: "low", reason: "classification parse failed" };
  }
}

// ─── 3. AI Study Planner ─────────────────────────────────────────────────────

/**
 * Generates a daily study plan based on:
 *   - subjects, examDate
 *   - recent distraction patterns (which topics get avoided)
 *   - focus session history
 *
 * Returns structured JSON: { plan: [{time, subject, task, duration}], motivation: string }
 */
export async function generateStudyPlan(context) {
  const { subjects, daysUntilExam, peakDistractionHours, weakSubjects, sessionsCompleted } = context;

  const avoidHours = peakDistractionHours.slice(0, 2).map(h => `${h.hour}:00`).join(", ");

  const prompt = `You are an expert academic study planner for a B.Tech CSE student.

Subjects: ${subjects}
Days until exam: ${daysUntilExam ?? "unknown"}
Completed focus sessions so far: ${sessionsCompleted}
Most distracted at: ${avoidHours || "unknown times"}
Subjects that need extra attention: ${weakSubjects || "all equal"}

Create a practical daily study plan as JSON only (no markdown, no backticks):
{
  "plan": [
    { "time": "9:00 AM", "subject": "DSA", "task": "Revise Dijkstra's algorithm and practice 2 problems", "durationMin": 50 },
    ...
  ],
  "motivation": "One encouraging sentence for the student",
  "weekFocus": "The most important topic to master this week"
}

Rules:
- Include 4-6 sessions between 8 AM and 10 PM
- Schedule harder subjects during peak focus windows (NOT the distraction hours)
- Each task should be concrete and specific, not vague
- Total study time should not exceed 5 hours`;

  const result = await callGemini(prompt, 600, 0.6);

  try {
    const clean = (result || "").replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return getMockStudyPlan(subjects);
  }
}

function getMockStudyPlan(subjects) {
  const list = subjects ? subjects.split(",").map(s => s.trim()) : ["DSA", "DBMS", "OS"];
  return {
    plan: list.slice(0, 4).map((subject, i) => ({
      time: `${9 + i * 2}:00`,
      subject,
      task: `Review core concepts and solve 3 practice problems`,
      durationMin: 50,
    })),
    motivation: "Every focused session brings you closer to your goal. Start now.",
    weekFocus: list[0],
  };
}

// ─── 4. Behavioral Insights ───────────────────────────────────────────────────

/**
 * Generates human-readable behavioral insights from the last 7 days.
 * Examples: "You're most distracted at 9 PM–11 PM on weekdays."
 *
 * Returns: string[] of insight sentences (3-5 insights)
 */
export async function generateBehavioralInsights(analyticsData) {
  const { weeklyTrends, peakHours, siteBreakdown, focusStreak, productivityScore } = analyticsData;

  // Build a compact data summary for the prompt
  const totalDistractions = weeklyTrends.reduce((s, d) => s + d.distractions, 0);
  const totalSessions = weeklyTrends.reduce((s, d) => s + d.sessions, 0);
  const topHours = peakHours.slice(0, 3).map(h => `${h.hour}:00 (${h.count}x)`).join(", ");
  const topSites = siteBreakdown.slice(0, 2).map(s => s.site).join(", ");

  const prompt = `You are a behavioral analytics AI analyzing a student's productivity data.

Last 7 days:
- Total distractions: ${totalDistractions}
- Total focus sessions: ${totalSessions}
- Peak distraction hours: ${topHours || "not enough data"}
- Most visited distracting sites: ${topSites || "not enough data"}
- Current focus streak: ${focusStreak?.count || 0} days
- Today's productivity score: ${productivityScore}/100

Generate exactly 4 behavioral insights as a JSON array of strings.
Insights should be:
- Specific and data-driven (reference the actual hours/sites/numbers)
- Actionable — suggest what to do about it
- Written in second person ("You tend to...")
- Varied: mix patterns, strengths, and improvement areas

Format: ["insight 1", "insight 2", "insight 3", "insight 4"]
No markdown, no backticks.`;

  const result = await callGemini(prompt, 400, 0.7);

  try {
    const clean = (result || "").replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return getMockInsights(analyticsData);
  }
}

function getMockInsights({ peakHours, siteBreakdown, focusStreak }) {
  const topHour = peakHours[0]?.hour;
  const topSite = siteBreakdown[0]?.site || "social media";
  const streak = focusStreak?.count || 0;

  return [
    topHour ? `You tend to get distracted most around ${topHour}:00. Try scheduling a break before this hour to stay ahead of the urge.` : "Track more sessions to reveal your distraction patterns.",
    `${topSite} is your biggest time sink. Consider using a site blocker for it during study hours.`,
    streak >= 3 ? `Your ${streak}-day streak is impressive. Keep the momentum going by starting each day with your hardest subject.` : "Building a 3-day focus streak can dramatically improve your study consistency.",
    "Morning focus sessions tend to be more productive. If possible, start your first study block before 10 AM.",
  ];
}

// ─── 5. Weekly Report ────────────────────────────────────────────────────────

/**
 * Generates a formatted Markdown weekly report.
 * This is what gets downloaded as a .txt or printed.
 */
export async function generateWeeklyReport(analyticsData) {
  const {
    weeklyTrends, peakHours, siteBreakdown,
    focusStreak, xp, levelInfo, productivityScore,
    subjects, daysUntilExam
  } = analyticsData;

  const totalDistractions = weeklyTrends.reduce((s, d) => s + d.distractions, 0);
  const totalSessions = weeklyTrends.reduce((s, d) => s + d.sessions, 0);
  const focusMinutes = totalSessions * 25;
  const bestDay = weeklyTrends.reduce((best, d) => d.sessions > best.sessions ? d : best, weeklyTrends[0]);

  const prompt = `Generate a professional weekly productivity report for a student.

DATA:
- Week: ${new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
- Total focus sessions: ${totalSessions} (${focusMinutes} minutes)
- Total distractions detected: ${totalDistractions}
- Best focus day: ${bestDay?.label || "Unknown"}
- Subjects: ${subjects}
- Days until exam: ${daysUntilExam ?? "unknown"}
- Current streak: ${focusStreak?.count || 0} days
- XP earned: ${xp}
- Level: ${levelInfo?.title}
- Productivity score: ${productivityScore}/100

Write a concise professional report with these sections:
1. Weekly Summary (3-4 sentences)
2. Key Wins (2-3 bullet points)
3. Areas for Improvement (2-3 bullet points)
4. Recommendation for Next Week (2-3 actionable sentences)

Keep it motivating but honest. Under 300 words. Plain text only, use --- as section dividers.`;

  const result = await callGemini(prompt, 500, 0.6);

  if (result) return result;

  // Mock fallback
  return `FocusGuard AI Weekly Report
Week of ${new Date().toLocaleDateString()}
---
WEEKLY SUMMARY
You completed ${totalSessions} focus sessions totaling ${focusMinutes} minutes of deep work. You had ${totalDistractions} distraction events this week. ${focusStreak?.count ? `Your current streak is ${focusStreak.count} days.` : ""}
---
KEY WINS
• Completed ${totalSessions} Pomodoro-style sessions
• Earned ${xp} XP and reached ${levelInfo?.title || "a new level"}
• ${focusStreak?.count >= 3 ? `Maintained a ${focusStreak.count}-day focus streak` : "Started building focus habits"}
---
AREAS FOR IMPROVEMENT
• Reduce distractions during peak distraction hours
• Increase daily focus sessions to 3+ for better exam prep
• Focus more consistently on weak subjects
---
NEXT WEEK RECOMMENDATION
Aim for at least 3 focus sessions per day. Schedule your first session before 10 AM when concentration is highest. Use the AI study planner to prioritize weak topics in ${subjects?.split(",")[0] || "your core subjects"}.`;
}
