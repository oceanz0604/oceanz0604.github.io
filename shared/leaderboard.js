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
    const membersSnap = await fdbDb.ref(FB_PATHS.LEGACY_MEMBERS).once("value");
    const historyRef = fdbDb.ref(FB_PATHS.HISTORY);
    const membersData = membersSnap.val();
    const members = Array.isArray(membersData) ? membersData.filter(m => m) : Object.values(membersData || {});
    const now = new Date();

    const leaderboard = members
      .filter(m => m.TOTALACTMINUTE)
      .sort((a, b) => b.TOTALACTMINUTE - a.TOTALACTMINUTE)
      .slice(0, 10);

    if (leaderboard.length === 0) {
      container.innerHTML = `<p class="text-gray-400 text-center">No leaderboard data available.</p>`;
      return;
    }

    const historyData = await Promise.all(
      leaderboard.map(async m => {
        const snapshot = await historyRef.child(m.USERNAME).once("value");
        const entries = Object.values(snapshot.val() || {});
        const spent = entries.reduce((sum, h) => sum + (h.CHARGE < 0 ? -h.CHARGE : 0), 0);
        const lastDate = entries
          .map(h => new Date(`${h.DATE}T${h.TIME?.split('.')[0] || '00:00:00'}`))
          .sort((a, b) => b - a)[0];
        return { username: m.USERNAME, spent, lastDate, streak: calculateStreak(entries) };
      })
    );

    const maxSpent = Math.max(...historyData.map(h => h.spent));
    const maxMinutes = leaderboard[0]?.TOTALACTMINUTE ?? 0;

    container.innerHTML = "";

    leaderboard.forEach((m, i) => {
      const avatar = getAvatarUrl(m.USERNAME);
      const timeInHours = Math.round(m.TOTALACTMINUTE / 60);
      const since = m.RECDATE ? new Date(m.RECDATE).toLocaleDateString("en-IN", { year: 'numeric', month: 'short' }) : "N/A";
      const { spent, lastDate, streak } = historyData.find(h => h.username === m.USERNAME) || {};
      const isHighlighted = highlightUsername && m.USERNAME?.toLowerCase() === highlightUsername.toLowerCase().trim();

      const badges = [];
      if (i === 0) badges.push("🥇 Champion");
      else if (i === 1) badges.push("🥈 Runner Up");
      else if (i === 2) badges.push("🥉 Third Place");
      if (m.TOTALACTMINUTE === maxMinutes && i > 0) badges.push("👑 Grinder");
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
          <img src="${avatar}" class="lb-avatar" style="${ringStyle}" alt="${m.USERNAME}" />
        </div>
        <div class="lb-content">
          <div class="lb-name" style="color: ${isHighlighted ? '#00ff88' : '#00f0ff'};">
            ${m.USERNAME} ${isHighlighted ? '<span class="lb-you">(YOU)</span>' : ''} ${streakBadge}
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
    const snap = await fdbDb.ref(`${FB_PATHS.LEADERBOARDS}/monthly/${targetMonth}`).get();

    if (!snap.exists()) {
      container.innerHTML = `<p class="text-gray-400 text-center">No data for ${targetMonth}</p>`;
      return;
    }

    const data = snap.val();
    let list = Object.entries(data).map(([memberId, info]) => ({
      memberId,
      username: info.username,
      minutes: info.total_minutes,
      hoursLabel: minutesToReadable(info.total_minutes),
      count: info.sessions_count
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

// ==================== LEADERBOARD SUMMARY STATS ====================

export async function getLeaderboardStats() {
  try {
    const membersSnap = await fdbDb.ref(FB_PATHS.LEGACY_MEMBERS).once("value");
    const membersData = membersSnap.val();
    const members = Array.isArray(membersData) ? membersData.filter(m => m) : Object.values(membersData || {});
    
    const activePlayers = members.filter(m => m.TOTALACTMINUTE > 0).length;
    const totalHours = Math.round(members.reduce((sum, m) => sum + (m.TOTALACTMINUTE || 0), 0) / 60);
    const topPlayer = members.sort((a, b) => (b.TOTALACTMINUTE || 0) - (a.TOTALACTMINUTE || 0))[0];
    
    return {
      activePlayers,
      totalHours,
      topPlayer: topPlayer?.USERNAME || "N/A",
      topPlayerHours: topPlayer ? Math.round(topPlayer.TOTALACTMINUTE / 60) : 0
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
  getAvailableMonths,
  getLeaderboardStats
};

