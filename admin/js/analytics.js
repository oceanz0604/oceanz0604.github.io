/**
 * OceanZ Gaming Cafe - Advanced Analytics
 * Revenue charts, peak hours, popular PCs, member stats
 */

import { BOOKING_DB_CONFIG, FDB_DATASET_CONFIG, BOOKING_APP_NAME, FDB_APP_NAME, FB_PATHS } from "../../shared/config.js";

// ==================== FIREBASE INIT (Compat SDK) ====================

let bookingApp = firebase.apps.find(a => a.name === BOOKING_APP_NAME);
if (!bookingApp) bookingApp = firebase.initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);

let fdbApp = firebase.apps.find(a => a.name === FDB_APP_NAME);
if (!fdbApp) fdbApp = firebase.initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);

const bookingDb = bookingApp.database();
const fdbDb = fdbApp.database();

// ==================== STATE ====================

let revenueChart, peakHoursChart, pcUsageChart, memberGrowthChart;

// ==================== LOAD ANALYTICS ====================

export async function loadAnalytics() {
  const container = document.getElementById("analytics-content");
  if (!container) {
    console.error("Analytics container not found");
    return;
  }

  container.innerHTML = `
    <div class="text-center py-8">
      <div class="w-12 h-12 mx-auto mb-4 border-2 border-t-cyan-400 border-r-purple-500 border-b-cyan-400 border-l-purple-500 rounded-full animate-spin"></div>
      <p class="text-gray-500 font-orbitron text-sm">LOADING ANALYTICS...</p>
    </div>
  `;

  // Initialize data with defaults
  let recharges = {}, bookings = {}, members = [], sessions = [], guestSessions = [];

  try {
    console.log("📊 Loading analytics data...");
    
    // Verify databases are initialized
    if (!bookingDb || !fdbDb) {
      throw new Error("Firebase databases not initialized");
    }
    
    // Fetch data in parallel with timeout
    const timeout = (promise, ms) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
    ]);
    
    const results = await Promise.allSettled([
      timeout(bookingDb.ref(FB_PATHS.RECHARGES).once('value'), 10000),
      timeout(bookingDb.ref(FB_PATHS.BOOKINGS).once('value'), 10000),
      timeout(fdbDb.ref(FB_PATHS.LEGACY_MEMBERS).once('value'), 10000),
      timeout(fdbDb.ref(FB_PATHS.SESSIONS).once('value'), 10000),
      timeout(fdbDb.ref(`${FB_PATHS.SESSIONS_BY_MEMBER}/guest`).once('value'), 10000),
      timeout(fdbDb.ref(FB_PATHS.GUEST_SESSIONS).once('value'), 10000) // New messages.msg data
    ]);

    // Process results safely
    if (results[0].status === 'fulfilled') {
      recharges = results[0].value?.val?.() || {};
      console.log("✅ Recharges loaded:", Object.keys(recharges).length);
    } else {
      console.warn("⚠️ Recharges failed:", results[0].reason);
    }
    
    if (results[1].status === 'fulfilled') {
      bookings = results[1].value?.val?.() || {};
      console.log("✅ Bookings loaded:", Object.keys(bookings).length);
    } else {
      console.warn("⚠️ Bookings failed:", results[1].reason);
    }
    
    if (results[2].status === 'fulfilled') {
      members = Object.values(results[2].value?.val?.() || {});
      console.log("✅ Members loaded:", members.length);
    } else {
      console.warn("⚠️ Members failed:", results[2].reason);
    }
    
    if (results[3].status === 'fulfilled') {
      sessions = Object.values(results[3].value?.val?.() || {});
      console.log("✅ Sessions loaded:", sessions.length);
    } else {
      console.warn("⚠️ Sessions failed:", results[3].reason);
    }
    
    // Merge guest sessions from both sources
    if (results[4].status === 'fulfilled') {
      const oldGuestSessions = Object.values(results[4].value?.val?.() || {});
      guestSessions = [...oldGuestSessions];
      console.log("✅ Legacy guest sessions loaded:", oldGuestSessions.length);
    }
    
    // Also load from new messages.msg parsed data
    if (results[5].status === 'fulfilled') {
      const newGuestData = results[5].value?.val?.() || {};
      // Flatten date-based structure: { "2026-01-09": { "CT1_120000": {...} }, ... }
      let newCount = 0;
      Object.values(newGuestData).forEach(dateData => {
        if (dateData && typeof dateData === 'object') {
          Object.values(dateData).forEach(session => {
            // Normalize to same format as legacy data
            guestSessions.push({
              TERMINAL_SHORT: session.terminal_short || session.terminal,
              TERMINALNAME: session.terminal,
              PRICE: session.total || session.usage || 0,
              USINGMIN: session.duration_minutes || 0,
              DATE: session.date,
              source: 'messages.msg'
            });
            newCount++;
          });
        }
      });
      console.log("✅ New guest sessions (messages.msg) loaded:", newCount);
    }
    
    console.log("✅ Total guest sessions:", guestSessions.length);
    
    console.log(`📊 Data loading complete`);
  } catch (error) {
    console.error("Error loading analytics:", error);
  }

  // Always render dashboard, even with empty data
  try {
    renderAnalyticsDashboard(container, { recharges, bookings, members, sessions, guestSessions });
    console.log("📊 Analytics dashboard rendered");
  } catch (renderError) {
    console.error("Error rendering analytics:", renderError);
    container.innerHTML = `
      <div class="text-center py-8">
        <p class="text-red-400 mb-2">Failed to render analytics</p>
        <p class="text-gray-500 text-sm">${renderError.message}</p>
        <button onclick="window.loadAnalytics()" class="mt-4 px-4 py-2 rounded-lg neon-btn neon-btn-cyan">Retry</button>
      </div>
    `;
  }
}

// ==================== RENDER DASHBOARD ====================

function renderAnalyticsDashboard(container, data) {
  const { recharges, bookings, members, sessions, guestSessions = [] } = data;

  // Calculate stats
  const stats = calculateStats(recharges, bookings, members, sessions);
  
  // Calculate guest session stats
  const guestStats = calculateGuestStats(guestSessions);

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
    
    <!-- Payment Breakdown -->
    <div class="grid grid-cols-3 gap-4 mb-8">
      <div class="stat-card p-4 rounded-xl text-center" style="border-color: rgba(0,240,255,0.3);">
        <div class="text-gray-500 text-xs uppercase tracking-wider">💵 Cash Total</div>
        <div class="text-xl font-bold font-orbitron mt-1" style="color: #00f0ff;">₹${stats.totalCash.toLocaleString()}</div>
      </div>
      <div class="stat-card p-4 rounded-xl text-center" style="border-color: rgba(184,41,255,0.3);">
        <div class="text-gray-500 text-xs uppercase tracking-wider">📱 UPI Total</div>
        <div class="text-xl font-bold font-orbitron mt-1" style="color: #b829ff;">₹${stats.totalUpi.toLocaleString()}</div>
      </div>
      <div class="stat-card p-4 rounded-xl text-center" style="border-color: rgba(255,107,0,0.3);">
        <div class="text-gray-500 text-xs uppercase tracking-wider">🔖 Credit Collected</div>
        <div class="text-xl font-bold font-orbitron mt-1" style="color: #ff6b00;">₹${stats.totalCreditCollected.toLocaleString()}</div>
      </div>
    </div>
    
    <!-- Guest Sessions Summary -->
    <div class="neon-card rounded-xl p-4 mb-8" style="border-color: rgba(0,240,255,0.3);">
      <h3 class="font-orbitron text-sm font-bold mb-4 flex items-center gap-2" style="color: #00f0ff;">
        🎮 GUEST SESSIONS (Walk-in Customers)
      </h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="text-center p-3 rounded-lg" style="background: rgba(0,0,0,0.3);">
          <div class="text-xs text-gray-500 mb-1">Total Sessions</div>
          <div class="text-xl font-bold font-orbitron" style="color: #00f0ff;">${guestStats.totalSessions}</div>
        </div>
        <div class="text-center p-3 rounded-lg" style="background: rgba(0,0,0,0.3);">
          <div class="text-xs text-gray-500 mb-1">Total Revenue</div>
          <div class="text-xl font-bold font-orbitron" style="color: #00ff88;">₹${guestStats.totalRevenue.toLocaleString()}</div>
        </div>
        <div class="text-center p-3 rounded-lg" style="background: rgba(0,0,0,0.3);">
          <div class="text-xs text-gray-500 mb-1">Total Time</div>
          <div class="text-xl font-bold font-orbitron" style="color: #b829ff;">${Math.round(guestStats.totalMinutes / 60)}h</div>
        </div>
        <div class="text-center p-3 rounded-lg" style="background: rgba(0,0,0,0.3);">
          <div class="text-xs text-gray-500 mb-1">Avg Duration</div>
          <div class="text-xl font-bold font-orbitron" style="color: #ff6b00;">${guestStats.avgMinutes} min</div>
        </div>
      </div>
      ${guestStats.byTerminal.length > 0 ? `
        <div class="mt-4 pt-4 border-t border-gray-800">
          <div class="text-xs text-gray-500 mb-2">By Terminal</div>
          <div class="flex flex-wrap gap-2">
            ${guestStats.byTerminal.slice(0, 8).map(t => `
              <span class="px-2 py-1 rounded text-xs" style="background: rgba(0,240,255,0.1); color: #00f0ff;">
                ${t.terminal}: ${t.count} (₹${t.revenue.toLocaleString()})
              </span>
            `).join('')}
          </div>
        </div>
      ` : ''}
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

  // Render charts with error handling
  try {
    renderRevenueChart(recharges);
  } catch (e) { console.error("Revenue chart error:", e); }
  
  try {
    renderPeakHoursChart(sessions, bookings);
  } catch (e) { console.error("Peak hours chart error:", e); }
  
  try {
    renderPCUsageChart(sessions, bookings);
  } catch (e) { console.error("PC usage chart error:", e); }
  
  try {
    renderMemberActivityChart(members, sessions);
  } catch (e) { console.error("Member activity chart error:", e); }
  
  try {
    renderTopSpenders(recharges);
  } catch (e) { console.error("Top spenders error:", e); }
}

// ==================== CALCULATE GUEST STATS ====================

function calculateGuestStats(guestSessions) {
  if (!guestSessions || guestSessions.length === 0) {
    return {
      totalSessions: 0,
      totalRevenue: 0,
      totalMinutes: 0,
      avgMinutes: 0,
      byTerminal: []
    };
  }
  
  const terminalStats = {};
  let totalRevenue = 0;
  let totalMinutes = 0;
  
  guestSessions.forEach(session => {
    const terminal = session.TERMINAL_SHORT || session.TERMINALNAME || "Unknown";
    const revenue = Number(session.PRICE) || 0;
    const minutes = Number(session.USINGMIN) || 0;
    
    totalRevenue += revenue;
    totalMinutes += minutes;
    
    if (!terminalStats[terminal]) {
      terminalStats[terminal] = { count: 0, revenue: 0, minutes: 0 };
    }
    terminalStats[terminal].count++;
    terminalStats[terminal].revenue += revenue;
    terminalStats[terminal].minutes += minutes;
  });
  
  const byTerminal = Object.entries(terminalStats)
    .map(([terminal, stats]) => ({ terminal, ...stats }))
    .sort((a, b) => b.count - a.count);
  
  return {
    totalSessions: guestSessions.length,
    totalRevenue,
    totalMinutes,
    avgMinutes: guestSessions.length > 0 ? Math.round(totalMinutes / guestSessions.length) : 0,
    byTerminal
  };
}

// ==================== CALCULATE STATS ====================

function calculateStats(recharges, bookings, members, sessions) {
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);

  // Revenue - calculate from all payment types
  let totalRevenue = 0;
  let monthlyRevenue = 0;
  let totalCash = 0;
  let totalUpi = 0;
  let totalCreditCollected = 0;
  
  Object.entries(recharges).forEach(([date, dayRecharges]) => {
    Object.values(dayRecharges).forEach(r => {
      let entryTotal = 0;
      
      // Handle new split format
      if (r.total !== undefined) {
        entryTotal = (r.cash || 0) + (r.upi || 0) + (r.creditPaid || 0);
        totalCash += r.cash || 0;
        totalUpi += r.upi || 0;
        
        // Add credit collected via cash/UPI
        totalCash += r.lastPaidCash || 0;
        totalUpi += r.lastPaidUpi || 0;
        totalCreditCollected += r.creditPaid || 0;
      } 
      // Handle old format
      else if (r.amount !== undefined) {
        if (r.mode === "credit") {
          if (r.paid) {
            entryTotal = r.amount;
            if (r.paidVia === "cash") totalCash += r.amount;
            else if (r.paidVia === "upi") totalUpi += r.amount;
            else totalCash += r.amount; // Default to cash
            totalCreditCollected += r.amount;
          }
        } else {
          entryTotal = r.amount;
          if (r.mode === "cash") totalCash += r.amount;
          if (r.mode === "upi") totalUpi += r.amount;
        }
      }
      
      totalRevenue += entryTotal;
      if (date.startsWith(thisMonth)) {
        monthlyRevenue += entryTotal;
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
    totalCash,
    totalUpi,
    totalCreditCollected,
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
  if (typeof Chart === 'undefined') {
    console.warn("Chart.js not loaded, skipping revenue chart");
    return;
  }

  // Get last 30 days
  const labels = [];
  const data = [];
  const now = new Date();

  for (let i = 29; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split("T")[0];
    labels.push(date.toLocaleDateString("en-IN", { day: "numeric", month: "short" }));
    
    // Calculate day total from all payment types
    const dayTotal = Object.values(recharges[dateStr] || {}).reduce((sum, r) => {
      // New split format
      if (r.total !== undefined) {
        return sum + (r.cash || 0) + (r.upi || 0) + (r.creditPaid || 0);
      }
      // Old format
      if (r.amount !== undefined) {
        if (r.mode === "credit" && !r.paid) return sum; // Don't count unpaid credits
        return sum + (r.amount || 0);
      }
      return sum;
    }, 0);
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
  if (!ctx || typeof Chart === 'undefined') return;

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
  if (!ctx || typeof Chart === 'undefined') return;

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
  if (!ctx || typeof Chart === 'undefined') return;

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
          let amount = 0;
          // New split format
          if (r.total !== undefined) {
            amount = (r.cash || 0) + (r.upi || 0) + (r.creditPaid || 0);
          }
          // Old format
          else if (r.amount !== undefined) {
            if (r.mode === "credit" && !r.paid) amount = 0; // Don't count unpaid
            else amount = r.amount || 0;
          }
          memberTotals[r.member] = (memberTotals[r.member] || 0) + amount;
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

