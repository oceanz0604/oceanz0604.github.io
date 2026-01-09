/**
 * OceanZ Gaming Cafe - Admin Dashboard
 * Note: Auth is handled in the HTML file, this just handles data
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { FDB_DATASET_CONFIG, FDB_APP_NAME } from "../../shared/config.js";

// ==================== FIREBASE INIT ====================

let fdbApp = getApps().find(app => app.name === FDB_APP_NAME);
if (!fdbApp) fdbApp = initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);

const db = getDatabase(fdbApp);

// ==================== DATABASE REFS ====================

const terminalsRef = ref(db, "status");
const sessionsRef = ref(db, "sessions");
const membersRef = ref(db, "fdb/MEMBERS");

// ==================== DOM ELEMENTS ====================

const $ = id => document.getElementById(id);

const elements = {
  timestamp: $("timestamp"),
  groupContainer: $("group-container"),
  navDashboard: $("nav-dashboard"),
  navMembers: $("nav-members"),
  navBookings: $("nav-bookings"),
  navHistory: $("nav-history"),
  navRecharges: $("nav-recharges"),
  dashboardSection: $("dashboard-section"),
  membersSection: $("members-section"),
  bookingsSection: $("bookings-section"),
  historySection: $("history-section"),
  rechargesSection: $("recharges-section")
};

// ==================== STATE ====================

let activeSessions = {};
let autoRefreshInterval = null;

// ==================== VIEW SWITCHER ====================

function switchView(view) {
  const sections = [
    elements.dashboardSection,
    elements.membersSection,
    elements.bookingsSection,
    elements.historySection,
    elements.rechargesSection
  ];

  const navs = [
    elements.navDashboard,
    elements.navMembers,
    elements.navBookings,
    elements.navHistory,
    elements.navRecharges
  ];

  sections.forEach(s => s?.classList.add("hidden"));
  navs.forEach(n => {
    n?.classList.remove("active");
    n?.classList.add("text-gray-400");
  });

  const viewMap = {
    dashboard: { section: elements.dashboardSection, nav: elements.navDashboard },
    members: { section: elements.membersSection, nav: elements.navMembers, onShow: loadAllMembers },
    bookings: { section: elements.bookingsSection, nav: elements.navBookings },
    history: { section: elements.historySection, nav: elements.navHistory },
    recharges: { section: elements.rechargesSection, nav: elements.navRecharges }
  };

  const config = viewMap[view];
  if (config) {
    config.section?.classList.remove("hidden");
    config.nav?.classList.remove("text-gray-400");
    config.nav?.classList.add("active");
    config.onShow?.();
  }
}

// ==================== NAV EVENTS ====================

const navLinks = [
  { el: elements.navDashboard, view: "dashboard" },
  { el: elements.navMembers, view: "members" },
  { el: elements.navBookings, view: "bookings" },
  { el: elements.navHistory, view: "history" },
  { el: elements.navRecharges, view: "recharges" }
];

navLinks.forEach(({ el, view }) => {
  el?.addEventListener("click", e => {
    e.preventDefault();
    switchView(view);
  });
});

// ==================== MEMBERS ====================

function loadAllMembers() {
  const container = $("membersList");
  if (!container) return;
  
  container.innerHTML = `<p class="text-gray-500 font-orbitron text-sm">🔄 LOADING...</p>`;

  get(membersRef).then(snapshot => {
    if (!snapshot.exists()) {
      container.innerHTML = `<p class="text-gray-500">No members found</p>`;
      return;
    }

    const members = Object.values(snapshot.val());
    container.innerHTML = members.map(m => `
      <div class="member-card p-4 rounded-xl">
        <h3 class="font-orbitron font-bold" style="color: #00f0ff;">${m.NAME}</h3>
        <p class="text-sm text-gray-400">@${m.USERNAME}</p>
        <p class="text-xs text-gray-600 mt-2">Joined: <span style="color: #b829ff;">${m.RECDATE || "-"}</span></p>
      </div>
    `).join("");
  });
}

// ==================== TERMINALS ====================

function parseActiveSessions(snapshot) {
  const sessions = snapshot.val() || {};
  const latest = {};
  Object.values(sessions).forEach(s => {
    if (s.active) latest[s.terminal] = s;
  });
  activeSessions = latest;
}

function renderTerminals(data) {
  if (!elements.timestamp || !elements.groupContainer) return;
  
  elements.timestamp.textContent = "Last updated: " + new Date().toLocaleString("en-IN");

  const groups = { "T-ROOM": [], "CT-ROOM": [], "PS/XBOX": [] };

  Object.entries(data).forEach(([name, info]) => {
    const group = name.includes("CT") ? "CT-ROOM" : name.includes("T-") ? "T-ROOM" : "PS/XBOX";
    groups[group].push({ name, ...info });
  });

  elements.groupContainer.innerHTML = "";

  Object.entries(groups).forEach(([group, list]) => {
    const section = document.createElement("section");
    section.innerHTML = `<h2 class="font-orbitron text-xl font-bold mb-4" style="color: #b829ff;">${group}</h2>`;

    const grid = document.createElement("div");
    grid.className = "grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4";

    list.sort((a, b) => a.name.localeCompare(b.name)).forEach(t => {
      const session = activeSessions[t.name];
      const occupied = t.status === "occupied";

      grid.innerHTML += `
        <div class="terminal-card ${occupied ? 'occupied' : 'available'} p-4 rounded-xl">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-orbitron text-lg font-bold" style="color: ${occupied ? '#ff0044' : '#00ff88'};">${t.name}</h3>
            <span class="w-3 h-3 rounded-full ${occupied ? 'bg-red-500 alert-pulse' : 'bg-green-500'}"></span>
          </div>
          <p class="text-sm text-gray-400">Status: <span style="color: ${occupied ? '#ff0044' : '#00ff88'};">${t.status.toUpperCase()}</span></p>
          ${session ? `<p class="text-sm mt-1" style="color: #b829ff;">🕒 ${Math.round(session.duration_minutes)} min</p>` : ""}
        </div>
      `;
    });

    section.appendChild(grid);
    elements.groupContainer.appendChild(section);
  });
}

// ==================== DATA SYNC ====================

function startDataSync() {
  fetchData();
  autoRefreshInterval = setInterval(fetchData, 30000);
}

function fetchData() {
  onValue(terminalsRef, snap => renderTerminals(snap.val() || {}), { onlyOnce: false });
  onValue(sessionsRef, parseActiveSessions, { onlyOnce: false });
}

// ==================== INIT ====================

document.addEventListener("DOMContentLoaded", () => {
  switchView("dashboard");
  startDataSync();
});
