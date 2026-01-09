/**
 * OceanZ Gaming Cafe - Advanced Analytics
 * Revenue charts, peak hours, popular PCs, member stats
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { BOOKING_DB_CONFIG, FDB_DATASET_CONFIG, BOOKING_APP_NAME, FDB_APP_NAME } from "../../shared/config.js";

// ==================== FIREBASE INIT ====================

let bookingApp = getApps().find(app => app.name === BOOKING_APP_NAME);
if (!bookingApp) bookingApp = initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);

let fdbApp = getApps().find(app => app.name === FDB_APP_NAME);
if (!fdbApp) fdbApp = initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);

const bookingDb = getDatabase(bookingApp);
const fdbDb = getDatabase(fdbApp);

// ==================== STATE ====================

let revenueChart, peakHoursChart, pcUsageChart, memberGrowthChart;

// ==================== LOAD ANALYTICS ====================

export async function loadAnalytics() {
  const container = document.getElementById("analytics-content");
  if (!container) return;

  container.innerHTML = `
    <div class="text-center py-8">
      <div class="w-12 h-12 mx-auto mb-4 border-2 border-t-cyan-400 border-r-purple-500 border-b-cyan-400 border-l-purple-500 rounded-full animate-spin"></div>
      <p class="text-gray-500 font-orbitron text-sm">LOADING ANALYTICS...</p>
    </div>
  `;

  try {
    const [rechargesSnap, bookingsSnap, membersSnap, sessionsSnap] = await Promise.all([
      get(ref(bookingDb, "recharges")),
      get(ref(bookingDb, "bookings")),
      get(ref(fdbDb, "fdb/MEMBERS")),
      get(ref(fdbDb, "sessions"))
    ]);

    const recharges = rechargesSnap.val() || {};
    const bookings = bookingsSnap.val() || {};
    const members = Object.values(membersSnap.val() || {});
    const sessions = Object.values(sessionsSnap.val() || {});

    renderAnalyticsDashboard(container, { recharges, bookings, members, sessions });
  } catch (error) {
    console.error("Error loading analytics:", error);
    container.innerHTML = `<p class="text-red-400 text-center">Failed to load analytics data</p>`;
  }
}

// ==================== RENDER DASHBOARD ====================

function renderAnalyticsDashboard(container, data) {
  const { recharges, bookings, members, sessions } = data;

  // Calculate stats
  const stats = calculateStats(recharges, bookings, members, sessions);

  container.innerHTML = `
    <!-- Summary Cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div class="stat-card p-4 rounded-xl text-center">
        <div class="text-gray-500 text-xs uppercase tracking-wider">Total Revenue</div>
        <div class="text-2xl font-bold font-orbitron mt-1" style="color: #00ff88;">₹${stats.totalRevenue.toLocaleString()}</div>
        <div class="text-xs text-gray-600 mt-1">This Month: ₹${stats.monthlyRevenue.toLocaleString()}</div>
      </div>
      <div class="stat-card p-4 rounded-xl text-center">
        <div class="text-gray-500 text-xs uppercase tracking-wider">Total Members</div>
        <div class="text-2xl font-bold font-orbitron mt-1" style="color: #00f0ff;">${stats.totalMembers}</div>
        <div class="text-xs text-gray-600 mt-1">Active: ${stats.activeMembers}</div>
      </div>
      <div class="stat-card p-4 rounded-xl text-center">
        <div class="text-gray-500 text-xs uppercase tracking-wider">Total Bookings</div>
        <div class="text-2xl font-bold font-orbitron mt-1" style="color: #b829ff;">${stats.totalBookings}</div>
        <div class="text-xs text-gray-600 mt-1">Pending: ${stats.pendingBookings}</div>
      </div>
      <div class="stat-card p-4 rounded-xl text-center">
        <div class="text-gray-500 text-xs uppercase tracking-wider">Avg Session</div>
        <div class="text-2xl font-bold font-orbitron mt-1" style="color: #ff6b00;">${stats.avgSessionMins} min</div>
        <div class="text-xs text-gray-600 mt-1">Total: ${stats.totalSessions} sessions</div>
      </div>
    </div>

    <!-- Charts Row 1 -->
    <div class="grid md:grid-cols-2 gap-6 mb-6">
      <div class="chart-container">
        <h3 class="font-orbitron text-sm font-bold mb-4" style="color: #00ff88;">📈 REVENUE TREND (Last 30 Days)</h3>
        <canvas id="revenueChart"></canvas>
      </div>
      <div class="chart-container">
        <h3 class="font-orbitron text-sm font-bold mb-4" style="color: #ff6b00;">🕐 PEAK HOURS</h3>
        <canvas id="peakHoursChart"></canvas>
      </div>
    </div>

    <!-- Charts Row 2 -->
    <div class="grid md:grid-cols-2 gap-6 mb-6">
      <div class="chart-container">
        <h3 class="font-orbitron text-sm font-bold mb-4" style="color: #00f0ff;">🖥️ PC POPULARITY</h3>
        <canvas id="pcUsageChart"></canvas>
      </div>
      <div class="chart-container">
        <h3 class="font-orbitron text-sm font-bold mb-4" style="color: #b829ff;">👥 MEMBER ACTIVITY</h3>
        <canvas id="memberGrowthChart"></canvas>
      </div>
    </div>

    <!-- Top Members & Recent Stats -->
    <div class="grid md:grid-cols-2 gap-6">
      <div class="neon-card rounded-xl p-4 relative">
        <h3 class="font-orbitron text-sm font-bold mb-4" style="color: #ffff00;">🏆 TOP SPENDERS (This Month)</h3>
        <div id="topSpenders" class="space-y-2"></div>
      </div>
      <div class="neon-card rounded-xl p-4 relative">
        <h3 class="font-orbitron text-sm font-bold mb-4" style="color: #00ff88;">📊 QUICK STATS</h3>
        <div class="space-y-3 text-sm">
          <div class="flex justify-between items-center p-2 rounded" style="background: rgba(0,0,0,0.3);">
            <span class="text-gray-400">Most Popular PC</span>
            <span class="font-orbitron" style="color: #00f0ff;">${stats.mostPopularPC}</span>
          </div>
          <div class="flex justify-between items-center p-2 rounded" style="background: rgba(0,0,0,0.3);">
            <span class="text-gray-400">Busiest Day</span>
            <span class="font-orbitron" style="color: #b829ff;">${stats.busiestDay}</span>
          </div>
          <div class="flex justify-between items-center p-2 rounded" style="background: rgba(0,0,0,0.3);">
            <span class="text-gray-400">Peak Hour</span>
            <span class="font-orbitron" style="color: #ff6b00;">${stats.peakHour}:00</span>
          </div>
          <div class="flex justify-between items-center p-2 rounded" style="background: rgba(0,0,0,0.3);">
            <span class="text-gray-400">Avg Revenue/Day</span>
            <span class="font-orbitron" style="color: #00ff88;">₹${stats.avgDailyRevenue}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render charts
  renderRevenueChart(recharges);
  renderPeakHoursChart(sessions, bookings);
  renderPCUsageChart(sessions, bookings);
  renderMemberActivityChart(members, sessions);
  renderTopSpenders(recharges);
}

// ==================== CALCULATE STATS ====================

function calculateStats(recharges, bookings, members, sessions) {
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);

  // Revenue
  let totalRevenue = 0;
  let monthlyRevenue = 0;
  Object.entries(recharges).forEach(([date, dayRecharges]) => {
    Object.values(dayRecharges).forEach(r => {
      totalRevenue += r.amount || 0;
      if (date.startsWith(thisMonth)) {
        monthlyRevenue += r.amount || 0;
      }
    });
  });

  // Bookings
  const bookingList = Object.values(bookings);
  const totalBookings = bookingList.length;
  const pendingBookings = bookingList.filter(b => b.status === "Pending" || !b.status).length;

  // Members
  const totalMembers = members.length;
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const activeMembers = members.filter(m => {
    if (!m.RECDATE) return false;
    return new Date(m.RECDATE) > thirtyDaysAgo || (m.TOTALACTMINUTE && m.TOTALACTMINUTE > 0);
  }).length;

  // Sessions
  const totalSessions = sessions.length;
  const totalMins = sessions.reduce((sum, s) => sum + (s.USINGMIN || 0), 0);
  const avgSessionMins = totalSessions > 0 ? Math.round(totalMins / totalSessions) : 0;

  // PC popularity
  const pcCount = {};
  sessions.forEach(s => {
    if (s.TERMINALNAME) {
      pcCount[s.TERMINALNAME] = (pcCount[s.TERMINALNAME] || 0) + 1;
    }
  });
  bookingList.forEach(b => {
    if (b.pcs) {
      b.pcs.forEach(pc => {
        pcCount[pc] = (pcCount[pc] || 0) + 1;
      });
    }
  });
  const mostPopularPC = Object.entries(pcCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

  // Peak hour
  const hourCount = {};
  sessions.forEach(s => {
    if (s.STARTPOINT) {
      const hour = new Date(s.STARTPOINT).getHours();
      hourCount[hour] = (hourCount[hour] || 0) + 1;
    }
  });
  const peakHour = Object.entries(hourCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 14;

  // Busiest day
  const dayCount = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  sessions.forEach(s => {
    if (s.STARTPOINT) {
      const day = dayNames[new Date(s.STARTPOINT).getDay()];
      dayCount[day]++;
    }
  });
  const busiestDay = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "Sat";

  // Avg daily revenue
  const daysWithRevenue = Object.keys(recharges).length || 1;
  const avgDailyRevenue = Math.round(totalRevenue / daysWithRevenue);

  return {
    totalRevenue,
    monthlyRevenue,
    totalMembers,
    activeMembers,
    totalBookings,
    pendingBookings,
    totalSessions,
    avgSessionMins,
    mostPopularPC,
    peakHour,
    busiestDay,
    avgDailyRevenue
  };
}

// ==================== CHARTS ====================

function renderRevenueChart(recharges) {
  const ctx = document.getElementById("revenueChart")?.getContext("2d");
  if (!ctx) return;

  // Get last 30 days
  const labels = [];
  const data = [];
  const now = new Date();

  for (let i = 29; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split("T")[0];
    labels.push(date.toLocaleDateString("en-IN", { day: "numeric", month: "short" }));
    
    const dayTotal = Object.values(recharges[dateStr] || {}).reduce((sum, r) => sum + (r.amount || 0), 0);
    data.push(dayTotal);
  }

  revenueChart?.destroy();
  revenueChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Revenue",
        data,
        borderColor: "#00ff88",
        backgroundColor: "rgba(0, 255, 136, 0.1)",
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#666" } },
        x: { grid: { display: false }, ticks: { color: "#666", maxTicksLimit: 10 } }
      }
    }
  });
}

function renderPeakHoursChart(sessions, bookings) {
  const ctx = document.getElementById("peakHoursChart")?.getContext("2d");
  if (!ctx) return;

  const hourData = Array(24).fill(0);

  sessions.forEach(s => {
    if (s.STARTPOINT) {
      const hour = new Date(s.STARTPOINT).getHours();
      hourData[hour]++;
    }
  });

  Object.values(bookings).forEach(b => {
    if (b.start) {
      const hour = new Date(b.start).getHours();
      hourData[hour]++;
    }
  });

  const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  const maxVal = Math.max(...hourData);

  peakHoursChart?.destroy();
  peakHoursChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Activity",
        data: hourData,
        backgroundColor: hourData.map(v => 
          v === maxVal ? "#ff6b00" : "rgba(255, 107, 0, 0.3)"
        ),
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#666" } },
        x: { grid: { display: false }, ticks: { color: "#666", maxTicksLimit: 12 } }
      }
    }
  });
}

function renderPCUsageChart(sessions, bookings) {
  const ctx = document.getElementById("pcUsageChart")?.getContext("2d");
  if (!ctx) return;

  const pcCount = {};

  sessions.forEach(s => {
    if (s.TERMINALNAME) {
      pcCount[s.TERMINALNAME] = (pcCount[s.TERMINALNAME] || 0) + 1;
    }
  });

  Object.values(bookings).forEach(b => {
    if (b.pcs) {
      b.pcs.forEach(pc => {
        pcCount[pc] = (pcCount[pc] || 0) + 1;
      });
    }
  });

  const sorted = Object.entries(pcCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = sorted.map(([pc]) => pc);
  const data = sorted.map(([, count]) => count);

  const colors = [
    "#00f0ff", "#b829ff", "#00ff88", "#ff6b00", "#ffff00",
    "#ff00ff", "#00aaff", "#ff0044", "#88ff00", "#ff8800"
  ];

  pcUsageChart?.destroy();
  pcUsageChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, data.length),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#888", font: { size: 10 } }
        }
      }
    }
  });
}

function renderMemberActivityChart(members, sessions) {
  const ctx = document.getElementById("memberGrowthChart")?.getContext("2d");
  if (!ctx) return;

  // Activity by day of week
  const dayData = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  sessions.forEach(s => {
    if (s.STARTPOINT) {
      const day = dayNames[new Date(s.STARTPOINT).getDay()];
      dayData[day]++;
    }
  });

  memberGrowthChart?.destroy();
  memberGrowthChart = new Chart(ctx, {
    type: "radar",
    data: {
      labels: Object.keys(dayData),
      datasets: [{
        label: "Sessions",
        data: Object.values(dayData),
        borderColor: "#b829ff",
        backgroundColor: "rgba(184, 41, 255, 0.2)",
        pointBackgroundColor: "#b829ff"
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          grid: { color: "rgba(255,255,255,0.1)" },
          angleLines: { color: "rgba(255,255,255,0.1)" },
          ticks: { display: false },
          pointLabels: { color: "#888" }
        }
      }
    }
  });
}

function renderTopSpenders(recharges) {
  const container = document.getElementById("topSpenders");
  if (!container) return;

  const thisMonth = new Date().toISOString().slice(0, 7);
  const memberTotals = {};

  Object.entries(recharges).forEach(([date, dayRecharges]) => {
    if (date.startsWith(thisMonth)) {
      Object.values(dayRecharges).forEach(r => {
        if (r.member) {
          memberTotals[r.member] = (memberTotals[r.member] || 0) + (r.amount || 0);
        }
      });
    }
  });

  const sorted = Object.entries(memberTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (sorted.length === 0) {
    container.innerHTML = `<p class="text-gray-500 text-center">No data this month</p>`;
    return;
  }

  container.innerHTML = sorted.map(([member, amount], i) => {
    const colors = ["#ffd700", "#c0c0c0", "#cd7f32", "#00f0ff", "#b829ff"];
    const badges = ["🥇", "🥈", "🥉", "4", "5"];
    return `
      <div class="flex items-center justify-between p-2 rounded" style="background: rgba(0,0,0,0.3);">
        <div class="flex items-center gap-3">
          <span class="w-6 h-6 flex items-center justify-center rounded font-bold text-sm" 
            style="background: ${i < 3 ? colors[i] : 'rgba(0,240,255,0.2)'}; color: ${i < 3 ? '#000' : colors[i]};">
            ${badges[i]}
          </span>
          <span class="font-orbitron text-sm" style="color: #00f0ff;">${member}</span>
        </div>
        <span class="font-orbitron text-sm" style="color: #00ff88;">₹${amount.toLocaleString()}</span>
      </div>
    `;
  }).join("");
}

// Export for use
window.loadAnalytics = loadAnalytics;

