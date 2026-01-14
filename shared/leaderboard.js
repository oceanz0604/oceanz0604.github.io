/**
 * OceanZ Gaming Cafe - Shared Leaderboard Module
 * Used by both member and admin dashboards
 */

import { FDB_DATASET_CONFIG, FDB_APP_NAME, FB_PATHS } from './config.js';
import { minutesToReadable, getAvatarUrl, calculateStreak } from './utils.js';

// ==================== FIREBASE INIT ====================

let fdbApp = firebase.apps.find(a => a.name === FDB_APP_NAME);
if (!fdbApp) fdbApp = firebase.initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);

const fdbDb = fdbApp.database();

// ==================== HALL OF FAME (ALL TIME) ====================

export async function loadHallOfFame(containerId, highlightUsername = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `<p class="text-gray-500 text-center animate-pulse">Loading leaderboard...</p>`;

  try {
    // Use pre-computed all-time leaderboard from sync script
    const leaderboardSnap = await fdbDb.ref(`${FB_PATHS.LEADERBOARDS}/all-time`).once("value");
    const leaderboardData = leaderboardSnap.val();
    
    if (!leaderboardData || leaderboardData.length === 0) {
      container.innerHTML = `<p class="text-gray-400 text-center">No leaderboard data available.</p>`;
      return;
    }

    const historyRef = fdbDb.ref(FB_PATHS.HISTORY);
    const now = new Date();
    
    // Get top 10 from pre-computed leaderboard
    const leaderboard = leaderboardData.slice(0, 10);

    // OPTIMIZATION: Only fetch RECENT history entries (last 30 days) for badges
    // This reduces data transfer from ~1000s of records to ~30 per user
    // Full history would be needed only for precise badge calculation, but
    // approximate is fine for display purposes (streak, last activity)
    const historyData = await Promise.all(
      leaderboard.map(async m => {
        // Fetch only last 50 entries instead of entire history
        // This saves ~95% of bandwidth for active users with long history
        const snapshot = await historyRef.child(m.username)
          .orderByChild('ID')
          .limitToLast(50)
          .once("value");
        const entries = Object.values(snapshot.val() || {});
        const spent = entries.reduce((sum, h) => sum + (h.CHARGE < 0 ? -h.CHARGE : 0), 0);
        const lastDate = entries
          .map(h => new Date(`${h.DATE}T${h.TIME?.split('.')[0] || '00:00:00'}`))
          .sort((a, b) => b - a)[0];
        return { username: m.username, spent, lastDate, streak: calculateStreak(entries) };
      })
    );

    const maxSpent = Math.max(...historyData.map(h => h.spent));
    const maxMinutes = leaderboard[0]?.total_minutes ?? 0;

    container.innerHTML = "";

    leaderboard.forEach((m, i) => {
      const avatar = getAvatarUrl(m.username);
      const timeInHours = Math.round(m.total_minutes / 60);
      const since = m.member_since ? new Date(m.member_since).toLocaleDateString("en-IN", { year: 'numeric', month: 'short' }) : "N/A";
      const { spent, lastDate, streak } = historyData.find(h => h.username === m.username) || {};
      const isHighlighted = highlightUsername && m.username?.toLowerCase() === highlightUsername.toLowerCase().trim();

      const badges = [];
      if (i === 0) badges.push("🥇 Champion");
      else if (i === 1) badges.push("🥈 Runner Up");
      else if (i === 2) badges.push("🥉 Third Place");
      if (m.total_minutes === maxMinutes && i > 0) badges.push("👑 Grinder");
      if (spent === maxSpent) badges.push("🏅 Big Spender");
      if (lastDate) {
        const inactiveDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
        if (inactiveDays > 7) badges.push("🐢 Ghost");
      }

      let ringStyle = "border-color: #666;";
      if (lastDate) {
        const diffDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
        ringStyle = diffDays <= 2 ? "border-color: #00ff88; box-shadow: 0 0 10px rgba(0,255,136,0.5);" : 
                    diffDays <= 7 ? "border-color: #ffff00; box-shadow: 0 0 10px rgba(255,255,0,0.5);" : 
                    "border-color: #666;";
      }

      const streakBadge = streak > 0 ? `<span class="streak-badge"><span class="animate-pulse">🔥</span>${streak}d</span>` : "";

      const rankBadge = i < 3 ? `<div class="rank-badge rank-${i+1}">${i+1}</div>` : 
                                `<div class="rank-badge rank-other">${i+1}</div>`;

      const row = document.createElement("div");
      row.className = `leaderboard-item ${isHighlighted ? 'highlight' : ''}`;
      row.innerHTML = `
        <div class="lb-left">
          ${rankBadge}
          <img src="${avatar}" class="lb-avatar" style="${ringStyle}" alt="${m.username}" />
        </div>
        <div class="lb-content">
          <div class="lb-name" style="color: ${isHighlighted ? '#00ff88' : '#00f0ff'};">
            ${m.username} ${isHighlighted ? '<span class="lb-you">(YOU)</span>' : ''} ${streakBadge}
          </div>
          <div class="lb-stats">⏱️ <span class="lb-hours">${timeInHours} hrs</span> • Since: ${since}</div>
          <div class="lb-last">Last: ${lastDate?.toLocaleDateString("en-IN") || "N/A"}</div>
        </div>
        ${badges.length ? `<div class="lb-badges">
          ${badges.map(b => `<span class="lb-badge">${b}</span>`).join("")}
        </div>` : ""}
      `;
      container.appendChild(row);
    });
  } catch (error) {
    console.error("Error loading hall of fame:", error);
    container.innerHTML = `<p class="text-red-400 text-center">Error loading leaderboard</p>`;
  }
}

// ==================== MONTHLY LEADERBOARD ====================

export async function loadMonthlyLeaderboard(containerId, highlightUsername = null, monthKey = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `<p class="text-gray-500 text-center animate-pulse">Loading monthly leaderboard...</p>`;

  try {
    const targetMonth = monthKey || new Date().toISOString().slice(0, 7);
    const snap = await fdbDb.ref(`${FB_PATHS.LEADERBOARDS}/monthly/${targetMonth}`).once("value");

    if (!snap.exists()) {
      container.innerHTML = `<p class="text-gray-400 text-center">No data for ${targetMonth}</p>`;
      return;
    }

    const data = snap.val();
    // Handle both array format (new) and object format (legacy)
    let list = Array.isArray(data) 
      ? data.filter(x => x).map(info => ({
          username: info.username,
          minutes: info.total_minutes || 0,
          hoursLabel: minutesToReadable(info.total_minutes || 0),
          count: info.sessions_count || 0
        }))
      : Object.entries(data).map(([memberId, info]) => ({
          memberId,
          username: info.username,
          minutes: info.total_minutes || 0,
          hoursLabel: minutesToReadable(info.total_minutes || 0),
          count: info.sessions_count || 0
        })).sort((a, b) => b.minutes - a.minutes);

    const userEntry = highlightUsername 
      ? list.find(x => x.username?.toLowerCase() === highlightUsername.toLowerCase().trim())
      : null;
    const top10 = list.slice(0, 10);
    let html = "";

    // Show user's rank if not in top 10
    if (userEntry && !top10.includes(userEntry)) {
      html += `
        <div class="leaderboard-item highlight">
          <div class="lb-left">
            <div class="rank-badge rank-other">#${list.indexOf(userEntry) + 1}</div>
          </div>
          <div class="lb-content">
            <div class="lb-name" style="color: #00ff88;">${userEntry.username} <span class="lb-you">(YOU)</span></div>
            <div class="lb-stats">Sessions: <span class="lb-hours">${userEntry.count}</span></div>
          </div>
          <div class="lb-time">${userEntry.hoursLabel}</div>
        </div>`;
    }

    top10.forEach((row, i) => {
      const isUser = highlightUsername && row.username?.toLowerCase() === highlightUsername.toLowerCase().trim();
      const rankBadge = i < 3 ? `<div class="rank-badge rank-${i+1}">${i+1}</div>` : 
                                `<div class="rank-badge rank-other">${i+1}</div>`;
      html += `
        <div class="leaderboard-item ${isUser ? 'highlight' : ''}">
          <div class="lb-left">
            ${rankBadge}
          </div>
          <div class="lb-content">
            <div class="lb-name" style="color: ${isUser ? '#00ff88' : '#00f0ff'};">${row.username} ${isUser ? '<span class="lb-you">(YOU)</span>' : ''}</div>
            <div class="lb-stats">Sessions: <span class="lb-hours">${row.count}</span></div>
          </div>
          <div class="lb-time">${row.hoursLabel}</div>
        </div>`;
    });

    container.innerHTML = html || `<p class="text-gray-400 text-center">No entries found</p>`;
  } catch (error) {
    console.error("Error loading monthly leaderboard:", error);
    container.innerHTML = `<p class="text-red-400 text-center">Error loading leaderboard</p>`;
  }
}

// ==================== WEEKLY LEADERBOARD ====================

export async function loadWeeklyLeaderboard(containerId, highlightUsername = null, weekKey = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `<p class="text-gray-500 text-center animate-pulse">Loading weekly leaderboard...</p>`;

  try {
    // Calculate current week key if not provided
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((now - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
    const targetWeek = weekKey || `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    
    const snap = await fdbDb.ref(`${FB_PATHS.LEADERBOARDS}/weekly/${targetWeek}`).once("value");

    if (!snap.exists()) {
      container.innerHTML = `<p class="text-gray-400 text-center">No data for week ${targetWeek}</p>`;
      return;
    }

    const data = snap.val();
    // Handle both array format (new) and object format (legacy)
    let list = Array.isArray(data) 
      ? data.filter(x => x).map(info => ({
          username: info.username,
          minutes: info.total_minutes || 0,
          hoursLabel: minutesToReadable(info.total_minutes || 0),
          count: info.sessions_count || 0
        }))
      : Object.entries(data).map(([memberId, info]) => ({
          memberId,
          username: info.username,
          minutes: info.total_minutes || 0,
          hoursLabel: minutesToReadable(info.total_minutes || 0),
          count: info.sessions_count || 0
        })).sort((a, b) => b.minutes - a.minutes);

    const userEntry = highlightUsername 
      ? list.find(x => x.username?.toLowerCase() === highlightUsername.toLowerCase().trim())
      : null;
    const top10 = list.slice(0, 10);
    let html = "";

    // Show user's rank if not in top 10
    if (userEntry && !top10.includes(userEntry)) {
      html += `
        <div class="leaderboard-item highlight">
          <div class="lb-left">
            <div class="rank-badge rank-other">#${list.indexOf(userEntry) + 1}</div>
          </div>
          <div class="lb-content">
            <div class="lb-name" style="color: #00ff88;">${userEntry.username} <span class="lb-you">(YOU)</span></div>
            <div class="lb-stats">Sessions: <span class="lb-hours">${userEntry.count}</span></div>
          </div>
          <div class="lb-time">${userEntry.hoursLabel}</div>
        </div>`;
    }

    top10.forEach((row, i) => {
      const isUser = highlightUsername && row.username?.toLowerCase() === highlightUsername.toLowerCase().trim();
      const rankBadge = i < 3 ? `<div class="rank-badge rank-${i+1}">${i+1}</div>` : 
                                `<div class="rank-badge rank-other">${i+1}</div>`;
      html += `
        <div class="leaderboard-item ${isUser ? 'highlight' : ''}">
          <div class="lb-left">
            ${rankBadge}
          </div>
          <div class="lb-content">
            <div class="lb-name" style="color: ${isUser ? '#00ff88' : '#00f0ff'};">${row.username} ${isUser ? '<span class="lb-you">(YOU)</span>' : ''}</div>
            <div class="lb-stats">Sessions: <span class="lb-hours">${row.count}</span></div>
          </div>
          <div class="lb-time">${row.hoursLabel}</div>
        </div>`;
    });

    container.innerHTML = html || `<p class="text-gray-400 text-center">No entries found</p>`;
  } catch (error) {
    console.error("Error loading weekly leaderboard:", error);
    container.innerHTML = `<p class="text-red-400 text-center">Error loading leaderboard</p>`;
  }
}

// ==================== GET AVAILABLE MONTHS ====================

export async function getAvailableMonths() {
  try {
    const snap = await fdbDb.ref(`${FB_PATHS.LEADERBOARDS}/monthly`).once("value");
    if (!snap.exists()) return [];
    return Object.keys(snap.val()).sort().reverse();
  } catch (error) {
    console.error("Error fetching available months:", error);
    return [];
  }
}

// ==================== GET AVAILABLE WEEKS ====================

export async function getAvailableWeeks() {
  try {
    const snap = await fdbDb.ref(`${FB_PATHS.LEADERBOARDS}/weekly`).once("value");
    if (!snap.exists()) return [];
    return Object.keys(snap.val()).sort().reverse();
  } catch (error) {
    console.error("Error fetching available weeks:", error);
    return [];
  }
}

// ==================== LEADERBOARD SUMMARY STATS ====================

export async function getLeaderboardStats() {
  try {
    // Use pre-computed all-time leaderboard
    const leaderboardSnap = await fdbDb.ref(`${FB_PATHS.LEADERBOARDS}/all-time`).once("value");
    const leaderboard = leaderboardSnap.val() || [];
    
    const activePlayers = leaderboard.length;
    const totalHours = Math.round(leaderboard.reduce((sum, m) => sum + (m.total_minutes || 0), 0) / 60);
    const topPlayer = leaderboard[0]; // Already sorted by total_minutes
    
    return {
      activePlayers,
      totalHours,
      topPlayer: topPlayer?.username || "N/A",
      topPlayerHours: topPlayer ? Math.round(topPlayer.total_minutes / 60) : 0
    };
  } catch (error) {
    console.error("Error fetching leaderboard stats:", error);
    return { activePlayers: 0, totalHours: 0, topPlayer: "N/A", topPlayerHours: 0 };
  }
}

// Export for global access if needed
window.LeaderboardModule = {
  loadHallOfFame,
  loadMonthlyLeaderboard,
  loadWeeklyLeaderboard,
  getAvailableMonths,
  getAvailableWeeks,
  getLeaderboardStats
};

