/**
 * OceanZ Gaming Cafe - Member Dashboard
 */

import { BOOKING_DB_CONFIG, FDB_DATASET_CONFIG, BOOKING_APP_NAME, FDB_APP_NAME, CONSTANTS } from '../../shared/config.js';
import { 
  getISTDate, formatDate, calculatePrice, minutesToReadable, 
  getActivityIcon, getAvatarUrl, filterToCurrentMonth, calculateStreak 
} from '../../shared/utils.js';

// ==================== FIREBASE INIT ====================

let bookingApp = firebase.apps.find(a => a.name === BOOKING_APP_NAME);
if (!bookingApp) bookingApp = firebase.initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);

let fdbApp = firebase.apps.find(a => a.name === FDB_APP_NAME);
if (!fdbApp) fdbApp = firebase.initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);

const db = bookingApp.database();
const secondDb = fdbApp.database();

// ==================== AUTH CHECK ====================

const member = JSON.parse(sessionStorage.getItem("member"));
if (!member) window.location.href = "login.html";

// ==================== DOM REFERENCES ====================

const startSelect = document.getElementById("startTime");
const endSelect = document.getElementById("endTime");
const bookingDateInput = document.getElementById("bookingDate");

// ==================== STATE ====================

let selectedPCSet = new Set();
let fullDateMap = {};
let fullSpendMap = {};
let charts = { pc: null, session: null, spend: null };

// ==================== TIME DROPDOWNS ====================

function populateTimeDropdowns() {
  if (!startSelect || !endSelect) return;
  
  const { start, end } = CONSTANTS.OPERATING_HOURS;
  startSelect.innerHTML = "";
  endSelect.innerHTML = "";

  for (let hour = start; hour <= end; hour++) {
    for (let min of [0, 30]) {
      const value = `${hour.toString().padStart(2, "0")}:${min === 0 ? "00" : "30"}`;
      const displayHour = hour % 12 || 12;
      const ampm = hour < 12 ? "AM" : "PM";
      const label = `${displayHour}:${min === 0 ? "00" : "30"} ${ampm}`;

      startSelect.innerHTML += `<option value="${value}">${label}</option>`;
      endSelect.innerHTML += `<option value="${value}">${label}</option>`;
    }
  }

  startSelect.value = "10:00";
  endSelect.value = "11:00";
}

// ==================== DATE BUTTONS ====================

function setupDateButtons() {
  const nowIST = getISTDate();
  const hourIST = nowIST.getHours();
  const container = document.getElementById("dateButtons");
  const hiddenInput = document.getElementById("bookingDate");
  
  if (!container) return;

  const dates = hourIST < 21 
    ? [getISTDate(), getISTDate(1)] 
    : [getISTDate(1), getISTDate(2)];

  const labels = hourIST < 21 
    ? ["📅 Today", "📅 Tomorrow"] 
    : ["📅 Tomorrow", "📅 Day After"];

  container.innerHTML = "";

  dates.forEach((d, i) => {
    const isoDate = d.toISOString().split("T")[0];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "date-btn px-5 py-3 rounded-lg font-orbitron text-sm transition-all";
    btn.dataset.date = isoDate;
    btn.textContent = labels[i];

    btn.addEventListener("click", () => {
      document.querySelectorAll(".date-btn").forEach(b => {
        b.classList.remove("selected");
      });
      btn.classList.add("selected");
      hiddenInput.value = isoDate;
    });

    container.appendChild(btn);
  });

  container.querySelector(".date-btn")?.click();
}

// ==================== PC SELECTION ====================

function fetchUnavailablePCs(start, end, callback) {
  const selectedDate = bookingDateInput?.value;
  if (!selectedDate) return callback(new Set());

  db.ref("bookings").once("value", snap => {
    const bookings = snap.val() || {};
    const unavailable = new Set();
    const startTime = new Date(`${selectedDate}T${start}:00+05:30`);
    const endTime = new Date(`${selectedDate}T${end}:00+05:30`);

    Object.values(bookings).forEach(b => {
      const bStart = new Date(b.start);
      const bEnd = new Date(b.end);
      if (startTime < bEnd && endTime > bStart) {
        b.pcs.forEach(pc => unavailable.add(pc));
      }
    });
    callback(unavailable);
  });
}

function showPCs() {
  const pcDiv = document.getElementById("availablePCs");
  if (!pcDiv) return;
  
  pcDiv.innerHTML = "";
  selectedPCSet.clear();

  fetchUnavailablePCs(startSelect.value, endSelect.value, (unavailable) => {
    const groups = {
      "T-ROOM": CONSTANTS.ALL_PCS.filter(pc => pc.startsWith("T") && !pc.startsWith("CT")),
      "CT-ROOM": CONSTANTS.ALL_PCS.filter(pc => pc.startsWith("CT"))
    };

    for (const [groupName, pcs] of Object.entries(groups)) {
      const wrapper = document.createElement("div");
      wrapper.className = "mb-6";
      wrapper.innerHTML = `<h3 class="font-orbitron text-sm font-bold mb-3" style="color: #00f0ff;">🎮 ${groupName}</h3>`;

      const grid = document.createElement("div");
      grid.className = "grid grid-cols-2 sm:grid-cols-3 gap-3";

      pcs.forEach(pc => {
        if (unavailable.has(pc)) return;
        
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pc-btn w-full px-4 py-3 rounded-lg font-orbitron text-sm transition-all";
        btn.textContent = pc;
        btn.dataset.pc = pc;

        btn.addEventListener("click", () => {
          document.querySelectorAll(".pc-btn").forEach(b => {
            b.classList.remove("selected");
          });
          selectedPCSet.clear();
          selectedPCSet.add(pc);
          btn.classList.add("selected");
          updatePrice();
        });

        grid.appendChild(btn);
      });

      wrapper.appendChild(grid);
      pcDiv.appendChild(wrapper);
    }
    updatePrice();
  });
}

function updatePrice() {
  const priceEl = document.getElementById("priceInfo");
  if (!priceEl || !startSelect || !endSelect) return;
  
  const price = calculatePrice(startSelect.value, endSelect.value, selectedPCSet.size, CONSTANTS.RATE_PER_HOUR);
  priceEl.textContent = `💰 Total Price: ₹${price}`;
}

// ==================== PROFILE ====================

function loadProfile() {
  document.getElementById("memberName").textContent = `${member.NAME} ${member.LASTNAME || ''}`.trim();
  document.getElementById("memberUsername").textContent = `👤 Username: ${member.USERNAME}`;
  document.getElementById("avatar").src = getAvatarUrl(member.USERNAME);

  const detailList = document.getElementById("memberDetailsList");
  if (detailList) {
    detailList.innerHTML = `
      <li><strong>🆔 Member ID:</strong> ${member.ID ?? 'N/A'}</li>
      <li><strong>💰 Balance:</strong> ₹${member.BAKIYE ?? 0}</li>
      <li><strong>⏱️ Total Active Time:</strong> ${Math.round(member.TOTALACTMINUTE ?? 0)} minutes</li>
      <li><strong>📆 Created On:</strong> ${member.RECDATE ?? 'N/A'}</li>
    `;
  }

  loadRecentActivity(member.USERNAME);
  loadMemberBookings(member.USERNAME);
  loadStreak();
}

function loadStreak() {
  secondDb.ref(`history/${member.USERNAME}`).once("value").then(snapshot => {
    const entries = Object.values(snapshot.val() || {});
    const streak = calculateStreak(entries);
    const streakDiv = document.getElementById("streakInfo");
    
    if (streakDiv) {
      streakDiv.innerHTML = streak >= 2 
        ? `<span class="inline-block text-orange-500 text-sm font-semibold">${streak}🔥</span>` 
        : "";
    }
  });
}

function loadRecentActivity(username) {
  const recentDiv = document.getElementById("recentActivity");
  if (!recentDiv) return;

  secondDb.ref(`history/${username}`).once("value").then(snapshot => {
    const data = snapshot.val();
    if (!data || Object.keys(data).length === 0) {
      recentDiv.innerHTML = `<p class="text-gray-400">No recent activity found.</p>`;
      return;
    }

    const entries = Object.values(data).sort((a, b) => b.ID - a.ID).slice(0, 5);
    recentDiv.innerHTML = entries.map(event => `
      <div class="flex items-start gap-3 p-3 rounded-lg" style="background: rgba(0,0,0,0.3); border-left: 2px solid #b829ff;">
        <div class="text-xl">${getActivityIcon(event.NOTE)}</div>
        <div class="flex-1">
          <div class="text-white font-medium">${event.NOTE}</div>
          <div class="text-xs text-gray-500 mt-1">
            ${event.DATE} @ ${event.TIME?.slice(0, 8) || ''} 
            ${event.TERMINALNAME ? `<span style="color: #00f0ff;">on ${event.TERMINALNAME}</span>` : `<span style="color: ${event.CHARGE > 0 ? '#00ff88' : '#ff0064'};">₹${event.CHARGE}</span>`}
          </div>
        </div>
      </div>
    `).join("");
  });
}

// ==================== BOOKINGS ====================

function loadMemberBookings(memberUsername) {
  const container = document.getElementById("myBookingsList");
  if (!container) return;
  
  container.innerHTML = "<p class='text-sm text-gray-400'>Loading your bookings...</p>";

  db.ref("bookings").once("value").then(snapshot => {
    const data = snapshot.val();
    if (!data) {
      container.innerHTML = "<p class='text-sm text-gray-400'>No bookings found.</p>";
      return;
    }

    const now = new Date();
    const groups = { upcoming: [], ongoing: [], past: [] };

    Object.entries(data).forEach(([id, booking]) => {
      if (booking.name !== memberUsername) return;

      const start = new Date(booking.start);
      const end = new Date(booking.end);
      const group = start > now ? "upcoming" : (start <= now && end > now) ? "ongoing" : "past";
      const status = group === "past" ? "Expired" : (booking.status || "Pending");

      const statusClasses = {
        Approved: "status-approved",
        Declined: "status-declined",
        Expired: "status-expired",
        Pending: "status-pending"
      };

      const card = document.createElement("div");
      card.className = "booking-card rounded-xl p-4";
      card.innerHTML = `
        <div class="flex justify-between items-center mb-3">
          <h3 class="font-orbitron text-sm font-bold" style="color: #00f0ff;">${booking.name}</h3>
          <span class="text-xs font-bold px-3 py-1 rounded-full ${statusClasses[status]}">${status}</span>
        </div>
        <div class="text-sm text-gray-400 space-y-2">
          <div><span class="text-gray-500">Start:</span> ${formatDate(booking.start)}</div>
          <div><span class="text-gray-500">End:</span> ${formatDate(booking.end)}</div>
          <div><span class="text-gray-500">Duration:</span> <span style="color: #b829ff;">${booking.duration} mins</span></div>
          <div><span class="text-gray-500">Terminal:</span> <span style="color: #00ff88;">${booking.pcs.join(", ")}</span></div>
          <div><span class="text-gray-500">Price:</span> <span style="color: #ffff00;">₹${booking.price}</span></div>
          ${booking.note ? `<div><span class="text-gray-500">Note:</span> ${booking.note}</div>` : ""}
        </div>
      `;
      groups[group].push(card);
    });

    container.innerHTML = "";
    if (groups.upcoming.length) container.appendChild(createBookingGroup("Upcoming Bookings", groups.upcoming));
    if (groups.ongoing.length) container.appendChild(createBookingGroup("Ongoing Bookings", groups.ongoing));
    if (groups.past.length) container.appendChild(createBookingGroup("Past Bookings", groups.past, true));

    lucide?.createIcons();
  });
}

function createBookingGroup(title, cards, collapsed = false) {
  const group = document.createElement("div");
  const contentId = `member-${title.replace(/\s+/g, "-").toLowerCase()}`;

  group.innerHTML = `
    <button onclick="document.getElementById('${contentId}').classList.toggle('hidden')"
      class="w-full flex justify-between items-center px-4 py-3 rounded-t-lg font-orbitron text-sm font-bold tracking-wider"
      style="background: rgba(0,0,0,0.4); border: 1px solid rgba(0,240,255,0.3); border-bottom: none; color: #00f0ff;">
      <span>${title}</span>
      <i data-lucide="chevron-down" class="w-5 h-5"></i>
    </button>
    <div id="${contentId}" class="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-b-lg ${collapsed ? "hidden" : ""}"
      style="background: rgba(0,0,0,0.2); border: 1px solid rgba(0,240,255,0.2); border-top: none;"></div>
  `;

  const content = group.querySelector(`#${contentId}`);
  cards.forEach(card => content.appendChild(card));
  return group;
}

// ==================== HISTORY ====================

function loadMemberHistory(username) {
  const list = document.getElementById("memberHistoryList");
  if (!list) return;
  
  list.innerHTML = `<p class="text-gray-400">⏳ Loading your history...</p>`;

  secondDb.ref(`history/${username}`).once("value").then(snapshot => {
    const history = snapshot.val();
    if (!history || Object.keys(history).length === 0) {
      list.innerHTML = `<p class="text-gray-500">No history available.</p>`;
      return;
    }

    const sorted = Object.values(history).sort((a, b) => b.ID - a.ID);
    list.innerHTML = sorted.map(entry => {
      const chargeColor = entry.CHARGE > 0 ? "#00ff88" : entry.CHARGE < 0 ? "#ff0064" : "#888";
      return `
        <div class="history-card p-4 rounded-lg space-y-2">
          <div class="flex justify-between items-center">
            <span class="font-semibold text-white">${entry.NOTE}</span>
            <span class="font-orbitron text-sm font-bold" style="color: ${chargeColor};">${entry.CHARGE > 0 ? '+' : ''}${entry.CHARGE} ₹</span>
          </div>
          <div class="text-sm text-gray-500">
            ${entry.DATE} ${entry.TIME?.split('.')[0] || ''}${entry.TERMINALNAME ? ` | <span style="color: #00f0ff;">🖥️ ${entry.TERMINALNAME}</span>` : ""}
          </div>
          <div class="text-xs text-gray-600">Balance: <span style="color: #b829ff;">₹${entry.BALANCE}</span></div>
        </div>
      `;
    }).join("");
  }).catch(() => {
    list.innerHTML = `<p class="text-red-400">⚠️ Failed to load history.</p>`;
  });
}

// ==================== LEADERBOARD ====================

async function loadLeaderboard() {
  const membersSnap = await secondDb.ref('fdb/MEMBERS').once("value");
  const historyRef = secondDb.ref("history");
  const members = Object.values(membersSnap.val() || {});
  const now = new Date();

  const leaderboard = members
    .filter(m => m.TOTALACTMINUTE)
    .sort((a, b) => b.TOTALACTMINUTE - a.TOTALACTMINUTE)
    .slice(0, 10);

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
  const list = document.getElementById("leaderboardList");
  if (!list) return;

  list.innerHTML = "";

  leaderboard.forEach((m, i) => {
    const avatar = getAvatarUrl(m.USERNAME);
    const timeInHours = Math.round(m.TOTALACTMINUTE / 60);
    const since = m.RECDATE ? new Date(m.RECDATE).toLocaleDateString("en-IN", { year: 'numeric', month: 'short' }) : "N/A";
    const { spent, lastDate, streak } = historyData.find(h => h.username === m.USERNAME) || {};

    const badges = [];
    if (i === 0) badges.push("🥇 Champion");
    else if (i === 1) badges.push("🥈 Runner Up");
    else if (i === 2) badges.push("🥉 Third Place");
    if (m.TOTALACTMINUTE === maxMinutes) badges.push("👑 Grinder");
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

    const streakBadge = streak > 0 ? `<span class="text-sm flex items-center gap-1"><span class="animate-pulse">🔥</span><span style="color: #ff6b00;">${streak}-Day</span></span>` : "";

    const rankBadge = i < 3 ? `<div class="rank-badge rank-${i+1} font-orbitron text-sm">${i+1}</div>` : 
                              `<div class="rank-badge font-orbitron text-sm" style="background: rgba(0,240,255,0.2); border: 1px solid rgba(0,240,255,0.5); color: #00f0ff;">${i+1}</div>`;

    const row = document.createElement("div");
    row.className = "leaderboard-item flex items-center gap-4 p-4 rounded-xl";
    row.innerHTML = `
      ${rankBadge}
      <img src="${avatar}" class="w-12 h-12 rounded-full border-2" style="${ringStyle}" />
      <div class="flex-1 min-w-0">
        <div class="font-orbitron font-bold flex items-center flex-wrap gap-2" style="color: #00f0ff;">${m.USERNAME} ${streakBadge}</div>
        <div class="text-sm text-gray-400">⏱️ <span style="color: #b829ff;">${timeInHours} hrs</span> • Since: ${since}</div>
        <div class="text-xs text-gray-600">Last: ${lastDate?.toLocaleDateString("en-IN") || "N/A"}</div>
      </div>
      ${badges.length ? `<div class="flex flex-wrap gap-1 justify-end text-xs">
        ${badges.map(b => `<span class="inline-block rounded-full px-2 py-0.5 font-medium" style="background: rgba(255,255,0,0.2); border: 1px solid rgba(255,255,0,0.5); color: #ffff00;">${b}</span>`).join("")}
      </div>` : ""}
    `;
    list.appendChild(row);
  });
}

async function loadMonthlyLeaderboard(loggedUserName) {
  if (!loggedUserName) return;

  const monthKey = new Date().toISOString().slice(0, 7);
  const snap = await secondDb.ref(`leaderboards/monthly/${monthKey}`).get();
  const container = document.getElementById("monthlyLeaderboard");
  
  if (!container) return;
  if (!snap.exists()) {
    container.innerHTML = "<p class='text-gray-400'>No data for this month.</p>";
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

  const userEntry = list.find(x => x.username?.toLowerCase() === loggedUserName.toLowerCase().trim());
  const top10 = list.slice(0, 10);
  let html = "";

  if (userEntry && !top10.includes(userEntry)) {
    html += `
      <div class="leaderboard-item highlight p-4 mb-4 rounded-lg">
        <div class="font-orbitron font-bold" style="color: #00ff88;">${userEntry.username} <span class="text-xs">(YOU)</span></div>
        <div class="text-gray-400 text-sm">Your Rank: <span style="color: #ffff00;">#${list.indexOf(userEntry) + 1}</span></div>
        <div class="text-gray-400 text-sm">Playtime: <span style="color: #b829ff;">${userEntry.hoursLabel}</span></div>
      </div>`;
  }

  top10.forEach((row, i) => {
    const isUser = row.username?.toLowerCase() === loggedUserName.toLowerCase().trim();
    const rankBadge = i < 3 ? `<div class="rank-badge rank-${i+1} font-orbitron text-sm shrink-0">${i+1}</div>` : 
                              `<div class="rank-badge font-orbitron text-sm shrink-0" style="background: rgba(0,240,255,0.2); border: 1px solid rgba(0,240,255,0.5); color: #00f0ff;">${i+1}</div>`;
    html += `
      <div class="leaderboard-item ${isUser ? 'highlight' : ''} flex items-center gap-4 p-4 rounded-lg">
        ${rankBadge}
        <div class="flex-1 min-w-0">
          <div class="font-orbitron font-bold" style="color: ${isUser ? '#00ff88' : '#00f0ff'};">${row.username} ${isUser ? '<span class="text-xs">(YOU)</span>' : ''}</div>
          <div class="text-gray-500 text-sm">Sessions: <span style="color: #b829ff;">${row.count}</span></div>
        </div>
        <div class="font-orbitron font-bold text-right" style="color: #ffff00;">${row.hoursLabel}</div>
      </div>`;
  });

  container.innerHTML = html;
}

// ==================== ANALYTICS ====================

async function loadAnalytics(memberId) {
  const snapshot = await secondDb.ref(`sessions-by-member/${memberId}`).once("value");
  if (!snapshot.exists()) return;

  const sessions = Object.values(snapshot.val());
  const totalSessions = sessions.length;
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.USINGMIN || 0), 0);
  const totalSpent = sessions.reduce((sum, s) => sum + (s.TOTALPRICE > 0 ? s.TOTALPRICE : 0), 0);

  const terminalCount = {};
  fullDateMap = {};
  fullSpendMap = {};

  sessions.forEach(s => {
    terminalCount[s.TERMINALNAME] = (terminalCount[s.TERMINALNAME] || 0) + 1;
    const date = new Date(s.ENDPOINT).toISOString().split("T")[0];
    fullDateMap[date] = (fullDateMap[date] || 0) + 1;
    fullSpendMap[date] = (fullSpendMap[date] || 0) + (s.TOTALPRICE > 0 ? s.TOTALPRICE : 0);
  });

  const mostUsedPC = Object.entries(terminalCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

  document.getElementById("totalSessions").textContent = totalSessions;
  document.getElementById("totalMinutes").textContent = totalMinutes;
  document.getElementById("totalSpent").textContent = `₹${totalSpent}`;
  document.getElementById("mostUsedPC").textContent = mostUsedPC;

  renderCharts(terminalCount);
  renderRecentSessions(sessions);
  setupChartToggles();
}

function renderCharts(terminalCount) {
  Object.values(charts).forEach(c => c?.destroy());

  const pcCtx = document.getElementById("pcUsageChart")?.getContext("2d");
  const sessionCtx = document.getElementById("sessionTimeChart")?.getContext("2d");
  const spendCtx = document.getElementById("spendChart")?.getContext("2d");

  if (pcCtx) {
    charts.pc = new Chart(pcCtx, {
      type: "bar",
      data: {
        labels: Object.keys(terminalCount),
        datasets: [{ label: "Sessions", data: Object.values(terminalCount), backgroundColor: "#38bdf8" }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }

  const monthSessionData = filterToCurrentMonth(fullDateMap);
  const sessionLabels = Object.keys(monthSessionData).sort();
  
  if (sessionCtx) {
    charts.session = new Chart(sessionCtx, {
      type: "line",
      data: {
        labels: sessionLabels,
        datasets: [{ label: "Sessions", data: sessionLabels.map(d => monthSessionData[d]), borderColor: "#10b981", backgroundColor: "#10b98133", fill: true }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }

  const monthSpendData = filterToCurrentMonth(fullSpendMap);
  const spendLabels = Object.keys(monthSpendData).sort();
  
  if (spendCtx) {
    charts.spend = new Chart(spendCtx, {
      type: "line",
      data: {
        labels: spendLabels,
        datasets: [{ label: "₹ Spent", data: spendLabels.map(d => monthSpendData[d]), borderColor: "#f97316", backgroundColor: "#f9731633", fill: true }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  }
}

function renderRecentSessions(sessions) {
  const recentList = document.getElementById("recentSessionsList");
  if (!recentList) return;

  recentList.innerHTML = sessions
    .sort((a, b) => new Date(b.ENDPOINT) - new Date(a.ENDPOINT))
    .slice(0, 5)
    .map(s => `
      <li class="history-card rounded-lg p-4">
        <div class="font-orbitron font-bold" style="color: #00f0ff;">${s.TERMINALNAME}</div>
        <div class="text-gray-400 text-sm mt-1">🕒 <span style="color: #b829ff;">${s.USINGMIN} min</span> | 💰 <span style="color: #00ff88;">₹${s.TOTALPRICE}</span></div>
        <div class="text-xs text-gray-600 mt-1">Ended: ${new Date(s.ENDPOINT).toLocaleString()}</div>
      </li>
    `).join("");
}

function setupChartToggles() {
  const setActive = (active, inactive) => {
    active.style.opacity = "1";
    inactive.style.opacity = "0.5";
  };

  const updateChart = (chart, dataMap) => {
    const labels = Object.keys(dataMap).sort();
    chart.data.labels = labels;
    chart.data.datasets[0].data = labels.map(d => dataMap[d]);
    chart.update();
  };

  const sessionMonth = document.getElementById("sessionToggleMonth");
  const sessionAll = document.getElementById("sessionToggleAll");
  const spendMonth = document.getElementById("spendToggleMonth");
  const spendAll = document.getElementById("spendToggleAll");

  sessionMonth?.addEventListener("click", () => {
    updateChart(charts.session, filterToCurrentMonth(fullDateMap));
    setActive(sessionMonth, sessionAll);
  });

  sessionAll?.addEventListener("click", () => {
    updateChart(charts.session, fullDateMap);
    setActive(sessionAll, sessionMonth);
  });

  spendMonth?.addEventListener("click", () => {
    updateChart(charts.spend, filterToCurrentMonth(fullSpendMap));
    setActive(spendMonth, spendAll);
  });

  spendAll?.addEventListener("click", () => {
    updateChart(charts.spend, fullSpendMap);
    setActive(spendAll, spendMonth);
  });

  if (sessionMonth) setActive(sessionMonth, sessionAll);
  if (spendMonth) setActive(spendMonth, spendAll);
}

// ==================== BOOKING FORM ====================

document.getElementById("nextBtn")?.addEventListener("click", () => {
  showPCs();
  document.getElementById("step1").style.display = "none";
  document.getElementById("step2").style.display = "block";
});

document.getElementById("backBtn")?.addEventListener("click", () => {
  document.getElementById("step2").style.display = "none";
  document.getElementById("step1").style.display = "block";
});

document.getElementById("bookingForm")?.addEventListener("submit", e => {
  e.preventDefault();

  const termsAccepted = document.getElementById("termsAccepted")?.checked;
  if (!termsAccepted) {
    alert("Please accept the Terms & Conditions to continue.");
    return;
  }

  if (selectedPCSet.size !== 1) {
    alert("Please select exactly one PC.");
    return;
  }

  const selectedDate = bookingDateInput.value;
  const start = startSelect.value;
  const end = endSelect.value;
  const selectedPCs = Array.from(selectedPCSet);

  const startTime = new Date(`${selectedDate}T${start}:00+05:30`);
  const endTime = new Date(`${selectedDate}T${end}:00+05:30`);
  const duration = (endTime - startTime) / (1000 * 60);

  if (duration < 60) {
    alert("Minimum 1 hour booking required.");
    return;
  }

  const booking = {
    name: member.USERNAME,
    pcs: selectedPCs,
    start: startTime.toISOString(),
    end: endTime.toISOString(),
    duration,
    price: duration * selectedPCs.length * CONSTANTS.RATE_PER_HOUR / 60
  };

  db.ref("bookings").push(booking, () => {
    const resultDiv = document.getElementById("bookingResult");
    resultDiv.classList.remove("hidden");
    resultDiv.textContent = "✅ Booking successful!";

    document.getElementById("bookingForm").reset();
    selectedPCSet.clear();
    startSelect.value = "10:00";
    endSelect.value = "11:00";
    document.getElementById("availablePCs").innerHTML = "";
    document.getElementById("priceInfo").textContent = "💰 Total Price: ₹0";
    document.getElementById("step2").style.display = "none";
    document.getElementById("step1").style.display = "block";

    loadMemberBookings(member.USERNAME);
    setTimeout(() => resultDiv.classList.add("hidden"), 3000);
  });
});

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.tab === "analytics") {
      setTimeout(() => loadAnalytics(member.ID), 100);
    }
  });
});

// ==================== INIT ====================

window.addEventListener("DOMContentLoaded", () => {
  loadMemberHistory(member.USERNAME);
  loadAnalytics(member.ID);
  loadMonthlyLeaderboard(member.USERNAME);
  loadLeaderboard();
  loadProfile();
  populateTimeDropdowns();
  setupDateButtons();
  lucide?.createIcons();
});

