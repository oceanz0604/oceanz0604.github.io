/**
 * OceanZ Gaming Cafe - Admin Dashboard
 * Note: Auth is handled in the HTML file, this just handles data
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { FDB_DATASET_CONFIG, FDB_APP_NAME, TIMEZONE, formatToIST, FB_PATHS, getTodayIST } from "../../shared/config.js";
import { 
  getStaffSession, 
  hasPermission, 
  getCurrentRole, 
  handleStaffLogout,
  clearStaffSession,
  refreshSessionActivity,
  ROLES 
} from "./permissions.js";

// ==================== FIREBASE INIT ====================

let fdbApp = getApps().find(app => app.name === FDB_APP_NAME);
if (!fdbApp) fdbApp = initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);

const db = getDatabase(fdbApp);

// ==================== DATABASE REFS ====================

const terminalsRef = ref(db, FB_PATHS.TERMINAL_STATUS);  // V2: /terminal-status
const sessionsRef = ref(db, FB_PATHS.SESSIONS);

// ==================== DOM ELEMENTS ====================

const $ = id => document.getElementById(id);

const elements = {
  timestamp: $("timestamp"),
  groupContainer: $("group-container"),
  navDashboard: $("nav-dashboard"),
  navMembers: $("nav-members"),
  navBookings: $("nav-bookings"),
  navRecharges: $("nav-recharges"),
  navStaff: $("nav-staff"),
  navCash: $("nav-cash"),
  navLeaderboard: $("nav-leaderboard"),
  navFinance: $("nav-finance"),
  navFoodMenu: $("nav-food-menu"),
  navFoodStock: $("nav-food-stock"),
  navFoodAnalytics: $("nav-food-analytics"),
  dashboardSection: $("dashboard-section"),
  membersSection: $("members-section"),
  bookingsSection: $("bookings-section"),
  rechargesSection: $("recharges-section"),
  staffSection: $("staff-section"),
  cashSection: $("cash-section"),
  leaderboardSection: $("leaderboard-section"),
  financeSection: $("finance-section"),
  foodMenuSection: $("food-menu-section"),
  foodStockSection: $("food-stock-section"),
  foodAnalyticsSection: $("food-analytics-section")
};

// ==================== STATE ====================

let activeSessions = {};
let autoRefreshInterval = null;
let terminalsListener = null;
let sessionsListener = null;
/** Terminals with open detail accordion — survives live re-renders */
const expandedTerminals = new Set();
/** Cached today history for all PCs (guest + member charges) */
let terminalDayCache = { date: null, rows: null, loading: null, error: null };

// CRITICAL: Track if listener is active to prevent duplication
// This was the root cause of 4GB+ bandwidth usage!
let isListenerActive = false;

// ==================== PERMISSIONS SETUP ====================

function initializePermissions() {
  const session = getStaffSession();
  const roleInfo = getCurrentRole();
  
  if (!session || !roleInfo) {
    console.error("❌ No staff session found - redirecting to login");
    // Redirect to login if no session
    window.location.replace("index.html");
    return;
  }
  
  // Update role badge
  const currentUserNameEl = $("currentUserName");
  const currentUserRoleEl = $("currentUserRole");
  const mobileUserInitial = document.querySelector(".mobile-user-initial");
  
  const userName = session.name || session.email?.split("@")[0] || "Unknown";
  if (currentUserNameEl) currentUserNameEl.textContent = userName;
  if (mobileUserInitial) mobileUserInitial.textContent = userName.charAt(0).toUpperCase();
  if (currentUserRoleEl) {
    currentUserRoleEl.textContent = `${roleInfo.icon} ${roleInfo.name}`;
    currentUserRoleEl.style.background = `${roleInfo.color}20`;
    currentUserRoleEl.style.color = roleInfo.color;
    currentUserRoleEl.style.border = `1px solid ${roleInfo.color}50`;
  }
  
  // Filter navigation based on permissions
  const navItems = document.querySelectorAll("#mainNav [data-permission]");
  navItems.forEach(item => {
    const permission = item.dataset.permission;
    if (!hasPermission(permission)) {
      item.style.display = "none";
    }
  });
  
  console.log(`✅ Permissions loaded for ${session.name} (${session.role})`);
}

window.refreshPermissionsUI = initializePermissions;

// ==================== VIEW SWITCHER ====================

let currentView = null;
const loadedAdminModules = new Set();

/** Lazy-load heavy admin modules only when their section is opened */
async function ensureAdminModule(name) {
  if (loadedAdminModules.has(name)) return;
  const map = {
    finance: "./finance.js",
    staff: "./staff.js",
    "food-menu": "./food-menu.js",
    "food-stock": "./food-stock.js",
    "food-analytics": "./food-analytics.js",
    members: "./members.js"
  };
  const path = map[name];
  if (!path) return;
  await import(path);
  loadedAdminModules.add(name);
}

function switchView(view) {
  // Map view names to permission keys
  const permissionMap = {
    "cash": "cash_register",
    "leaderboard": "leaderboard",
    "dashboard": "dashboard",
    "members": "members",
    "bookings": "bookings",
    "recharges": "recharges",
    "staff": "staff",
    "finance": "finance",
    "food-menu": "food_menu",
    "food-stock": "food_menu",
    "food-analytics": "food_analytics"
  };
  const permissionKey = permissionMap[view] || view;
  
  // Check permission before switching
  if (!hasPermission(permissionKey)) {
    console.warn(`Access denied to ${view} - insufficient permissions`);
    showAccessDenied(view);
    return;
  }

  const sections = [
    elements.dashboardSection,
    elements.membersSection,
    elements.bookingsSection,
    elements.rechargesSection,
    elements.staffSection,
    elements.cashSection,
    elements.leaderboardSection,
    elements.financeSection,
    elements.foodMenuSection,
    elements.foodStockSection,
    elements.foodAnalyticsSection
  ];

  const navs = [
    elements.navDashboard,
    elements.navMembers,
    elements.navBookings,
    elements.navRecharges,
    elements.navStaff,
    elements.navCash,
    elements.navLeaderboard,
    elements.navFinance,
    elements.navFoodMenu,
    elements.navFoodStock,
    elements.navFoodAnalytics
  ];

  sections.forEach(s => s?.classList.add("hidden"));
  navs.forEach(n => {
    n?.classList.remove("active");
    n?.classList.add("text-gray-400");
  });

  const viewMap = {
    dashboard: {
      section: elements.dashboardSection,
      nav: elements.navDashboard,
      onShow: () => startDataSync(),
      onHide: null
    },
    members: {
      section: elements.membersSection,
      nav: elements.navMembers,
      onShow: async () => {
        await ensureAdminModule("members");
        window.initMembersPage?.();
      }
    },
    bookings: {
      section: elements.bookingsSection,
      nav: elements.navBookings,
      onShow: () => window.startBookingsSync?.()
    },
    recharges: { section: elements.rechargesSection, nav: elements.navRecharges },
    staff: {
      section: elements.staffSection,
      nav: elements.navStaff,
      onShow: async () => {
        await ensureAdminModule("staff");
        window.loadStaffManagement?.();
      }
    },
    cash: { section: elements.cashSection, nav: elements.navCash, onShow: () => window.loadCashRegister?.() },
    leaderboard: { section: elements.leaderboardSection, nav: elements.navLeaderboard, onShow: () => window.initLeaderboards?.() },
    finance: {
      section: elements.financeSection,
      nav: elements.navFinance,
      onShow: async () => {
        await ensureAdminModule("finance");
        window.loadFinanceDashboard?.();
      }
    },
    "food-menu": {
      section: elements.foodMenuSection,
      nav: elements.navFoodMenu,
      onShow: async () => {
        await ensureAdminModule("food-menu");
        window.initFoodMenu?.();
      }
    },
    "food-stock": {
      section: elements.foodStockSection,
      nav: elements.navFoodStock,
      onShow: async () => {
        await ensureAdminModule("food-stock");
        window.initFoodStock?.();
      }
    },
    "food-analytics": {
      section: elements.foodAnalyticsSection,
      nav: elements.navFoodAnalytics,
      onShow: async () => {
        await ensureAdminModule("food-analytics");
        window.initFoodAnalytics?.();
      }
    }
  };

  // Stop heavy listeners when leaving their views
  if (currentView === "dashboard" && view !== "dashboard") {
    stopDataSync();
  }
  if (currentView === "bookings" && view !== "bookings") {
    window.stopBookingsSync?.();
  }

  const config = viewMap[view];
  if (config) {
    config.section?.classList.remove("hidden");
    config.nav?.classList.remove("text-gray-400");
    config.nav?.classList.add("active");
    config.onShow?.();
  }

  currentView = view;
}

function showAccessDenied(view) {
  // Show temporary access denied message
  const toast = document.createElement("div");
  toast.className = "fixed top-20 right-4 z-50 p-4 rounded-lg font-orbitron text-sm";
  toast.style.cssText = "background: rgba(255,0,68,0.2); border: 1px solid #ff0044; color: #ff0044;";
  toast.innerHTML = `
    <div class="flex items-center gap-2">
      <span>🚫</span>
      <span>Access to <strong>${view}</strong> denied</span>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ==================== NAV EVENTS ====================

const navLinks = [
  { el: elements.navDashboard, view: "dashboard" },
  { el: elements.navMembers, view: "members" },
  { el: elements.navBookings, view: "bookings" },
  { el: elements.navRecharges, view: "recharges" },
  { el: elements.navStaff, view: "staff" },
  { el: elements.navCash, view: "cash" },
  { el: elements.navLeaderboard, view: "leaderboard" },
  { el: elements.navFinance, view: "finance" },
  { el: elements.navFoodMenu, view: "food-menu" },
  { el: elements.navFoodStock, view: "food-stock" },
  { el: elements.navFoodAnalytics, view: "food-analytics" }
];

navLinks.forEach(({ el, view }) => {
  el?.addEventListener("click", e => {
    e.preventDefault();
    switchView(view);
  });
});

// ==================== MEMBERS ====================
// Member roster UI lives in members.js (lazy-loaded on first open)

// ==================== TERMINALS ====================

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortTerminalName(name) {
  const n = String(name || "").toUpperCase().trim();
  if (n.startsWith("CT-ROOM-")) return `CT${n.replace("CT-ROOM-", "")}`;
  if (n.startsWith("T-ROOM-")) return `T${n.replace("T-ROOM-", "")}`;
  if (n === "XBOX ONE X" || n.includes("XBOX")) return "XBOX";
  if (n.includes("PLAYSTATION") || n === "PS") return "PS";
  return n || name;
}

/** Canonical keys for matching CT-ROOM-1 ↔ CT1 ↔ CT ROOM 1 etc. */
function terminalKeys(name) {
  const raw = String(name || "").toUpperCase().trim();
  const keys = new Set();
  if (!raw) return keys;

  const compact = raw.replace(/[^A-Z0-9]/g, "");
  keys.add(compact);
  keys.add(shortTerminalName(raw).replace(/[^A-Z0-9]/g, ""));

  const ct = raw.match(/CT[\s\-]*ROOM[\s\-]*0*(\d+)/) || raw.match(/^CT0*(\d+)$/);
  if (ct) keys.add(`CT${ct[1]}`);

  const t = raw.match(/(?:^|[^C])T[\s\-]*ROOM[\s\-]*0*(\d+)/) || raw.match(/^T0*(\d+)$/);
  if (t) keys.add(`T${t[1]}`);

  if (raw.includes("XBOX")) keys.add("XBOX");
  if (raw === "PS" || raw.includes("PLAYSTATION")) keys.add("PS");

  return keys;
}

function normalizeTerminalKey(name) {
  const keys = [...terminalKeys(name)];
  // Prefer short CT1/T5 style key when available
  const short = keys.find(k => /^(CT|T)\d+$/.test(k) || k === "PS" || k === "XBOX");
  return short || keys[0] || "";
}

function terminalsMatch(a, b) {
  const ka = terminalKeys(a);
  if (!ka.size) return false;
  for (const k of terminalKeys(b)) {
    if (ka.has(k)) return true;
  }
  return false;
}

function findTerminalHistoryPanel(terminalName) {
  return [...document.querySelectorAll(".terminal-history")]
    .find(el => el.dataset.terminal === terminalName) || null;
}

function statusMeta(status) {
  const s = String(status || "unknown").toLowerCase();
  const map = {
    occupied: { label: "OCCUPIED", color: "#ff0044", bg: "rgba(255,0,68,0.15)", cls: "occupied" },
    available: { label: "FREE", color: "#00ff88", bg: "rgba(0,255,136,0.12)", cls: "available" },
    offline: { label: "OFFLINE", color: "#6b7280", bg: "rgba(107,114,128,0.15)", cls: "offline" },
    reserved: { label: "RESERVED", color: "#ffd700", bg: "rgba(255,215,0,0.12)", cls: "reserved" },
    maintenance: { label: "MAINT.", color: "#ff6b00", bg: "rgba(255,107,0,0.15)", cls: "maintenance" },
    closing: { label: "CLOSING", color: "#b829ff", bg: "rgba(184,41,255,0.15)", cls: "closing" }
  };
  return map[s] || { label: s.toUpperCase(), color: "#9ca3af", bg: "rgba(156,163,175,0.12)", cls: "unknown" };
}

function formatDurationMins(mins) {
  const n = Number(mins) || 0;
  if (n < 1) return "<1m";
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatSessionStart(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  } catch {
    return String(iso).slice(11, 16) || "—";
  }
}

function formatClockTime(val) {
  if (!val) return "";
  const s = String(val);
  // Already HH:MM or HH:MM:SS
  if (/^\d{1,2}:\d{2}/.test(s)) return s.slice(0, 5);
  try {
    return new Date(s).toLocaleTimeString("en-IN", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  } catch {
    return s.slice(0, 8);
  }
}

function parseActiveSessions(snapshot) {
  const sessions = snapshot.val() || {};
  const latest = {};
  Object.values(sessions).forEach(s => {
    if (s.active && s.terminal) latest[s.terminal] = s;
  });
  activeSessions = latest;
}

function updateFloorSummary(terminals) {
  const list = Object.values(terminals || {});
  let occupied = 0, free = 0, other = 0;
  list.forEach(t => {
    const s = String(t.status || "").toLowerCase();
    if (s === "occupied") occupied++;
    else if (s === "available") free++;
    else other++;
  });
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("floorStatOccupied", String(occupied));
  set("floorStatFree", String(free));
  set("floorStatOther", String(other));
  set("floorStatTotal", String(list.length));
}

function renderTerminals(data) {
  if (!elements.timestamp || !elements.groupContainer) return;

  elements.timestamp.textContent = "Live · " + formatToIST(new Date());
  updateFloorSummary(data);

  const groups = { "T-ROOM": [], "CT-ROOM": [], "PS / CONSOLE": [] };

  Object.entries(data || {}).forEach(([name, info]) => {
    const group = name.includes("CT") ? "CT-ROOM" : name.includes("T-") ? "T-ROOM" : "PS / CONSOLE";
    groups[group].push({ name, ...info });
  });

  // Preserve scroll + expanded state across live updates
  const openIds = new Set(expandedTerminals);
  elements.groupContainer.innerHTML = "";

  Object.entries(groups).forEach(([group, list]) => {
    if (!list.length) return;

    const occupiedCount = list.filter(t => t.status === "occupied").length;
    const section = document.createElement("section");
    section.className = "terminal-group";
    section.innerHTML = `
      <div class="terminal-group-head">
        <h2 class="terminal-group-title">${escapeHtml(group)}</h2>
        <span class="terminal-group-meta">${occupiedCount}/${list.length} live</span>
      </div>
    `;

    const grid = document.createElement("div");
    grid.className = "terminal-grid";

    list.sort((a, b) => a.name.localeCompare(b.name)).forEach(t => {
      grid.appendChild(buildTerminalCard(t, openIds.has(t.name)));
    });

    section.appendChild(grid);
    elements.groupContainer.appendChild(section);
  });

  // Re-hydrate history panels for still-open cards
  openIds.forEach(name => {
    const panel = findTerminalHistoryPanel(name);
    if (panel) loadTerminalHistory(name, panel);
  });
}

function buildTerminalCard(t, isOpen) {
  const meta = statusMeta(t.status);
  const occupied = t.status === "occupied";
  const short = shortTerminalName(t.name);
  const player = occupied
    ? (t.is_guest || t.member_id === 0
      ? { label: "Guest", color: "#ff6b00" }
      : { label: t.member_username || t.member_name || `ID ${t.member_id}`, color: "#00f0ff" })
    : null;

  const duration = occupied ? (t.duration_minutes || activeSessions[t.name]?.duration_minutes) : null;
  let timerLine = "";
  if (occupied && t.timer_minutes > 0) {
    const remaining = t.timer_minutes - (t.duration_minutes || 0);
    timerLine = remaining > 0
      ? `<span class="term-chip" style="color:#ffff00;background:rgba(255,255,0,0.1);">${formatDurationMins(remaining)} left</span>`
      : `<span class="term-chip" style="color:#ff0044;background:rgba(255,0,68,0.12);">Overtime</span>`;
  } else if (occupied && t.session_type === "unlimited") {
    timerLine = `<span class="term-chip" style="color:#9ca3af;background:rgba(156,163,175,0.1);">Unlimited</span>`;
  }

  const card = document.createElement("div");
  card.className = `terminal-card terminal-card-v2 ${meta.cls}${isOpen ? " is-open" : ""}`;
  card.dataset.terminal = t.name;
  card.dataset.status = t.status || "";
  card.dataset.player = player?.label || "";
  card.dataset.duration = duration != null ? String(duration) : "";
  card.dataset.price = occupied && t.session_price > 0 ? String(t.session_price) : "";

  card.innerHTML = `
    <button type="button" class="terminal-card-toggle" aria-expanded="${isOpen ? "true" : "false"}">
      <div class="terminal-card-top">
        <div class="terminal-id">
          <span class="terminal-short" style="color:${meta.color};">${escapeHtml(short)}</span>
          <span class="terminal-full">${escapeHtml(t.name)}</span>
        </div>
        <div class="terminal-top-right">
          <span class="terminal-status-pill" style="color:${meta.color};background:${meta.bg};">${meta.label}</span>
          <span class="terminal-dot ${occupied ? "alert-pulse" : ""}" style="background:${meta.color};"></span>
          <span class="terminal-chevron ${isOpen ? "rotated" : ""}">▾</span>
        </div>
      </div>
      <div class="terminal-card-summary">
        ${player ? `<span class="term-chip" style="color:${player.color};background:${player.color}22;">${escapeHtml(player.label)}</span>` : `<span class="term-chip muted">Tap for today&apos;s history</span>`}
        ${duration != null ? `<span class="term-chip" style="color:#b829ff;background:rgba(184,41,255,0.12);">${formatDurationMins(duration)} on</span>` : ""}
        ${timerLine}
        ${occupied && t.session_price > 0 ? `<span class="term-chip" style="color:#00ff88;background:rgba(0,255,136,0.12);">₹${Math.round(t.session_price)}</span>` : ""}
      </div>
    </button>
    <div class="terminal-card-body" ${isOpen ? "" : "hidden"}>
      ${buildLiveSessionBlock(t, occupied)}
      <div class="terminal-history-block">
        <div class="terminal-history-title">Today on this PC</div>
        <div class="terminal-history" data-terminal="${escapeHtml(t.name)}">
          <p class="terminal-history-empty">Loading…</p>
        </div>
      </div>
    </div>
  `;

  const toggle = card.querySelector(".terminal-card-toggle");
  toggle.addEventListener("click", () => toggleTerminalCard(card, t.name));

  return card;
}

function buildLiveSessionBlock(t, occupied) {
  if (!occupied) {
    return `
      <div class="terminal-live-grid">
        <div class="terminal-kv"><span>State</span><strong style="color:${statusMeta(t.status).color};">${escapeHtml(statusMeta(t.status).label)}</strong></div>
        <div class="terminal-kv"><span>Updated</span><strong>${escapeHtml(formatSessionStart(t.last_updated))}</strong></div>
        <div class="terminal-kv"><span>MAC</span><strong class="truncate">${escapeHtml(t.mac || "—")}</strong></div>
      </div>
    `;
  }

  const who = t.is_guest || t.member_id === 0
    ? "Guest session"
    : [t.member_name, t.member_username ? `@${t.member_username}` : ""].filter(Boolean).join(" ") || `Member #${t.member_id}`;

  return `
    <div class="terminal-live-grid">
      <div class="terminal-kv"><span>Player</span><strong style="color:#00f0ff;">${escapeHtml(who)}</strong></div>
      <div class="terminal-kv"><span>Started</span><strong>${escapeHtml(formatSessionStart(t.session_start))}</strong></div>
      <div class="terminal-kv"><span>Running</span><strong style="color:#b829ff;">${escapeHtml(formatDurationMins(t.duration_minutes))}</strong></div>
      <div class="terminal-kv"><span>Timer</span><strong>${
        t.session_type === "unlimited"
          ? "Unlimited"
          : (t.timer_minutes ? `${formatDurationMins(t.timer_minutes)} booked` : "—")
      }</strong></div>
      <div class="terminal-kv"><span>Price</span><strong style="color:#00ff88;">${t.session_price > 0 ? `₹${Math.round(t.session_price)}` : "—"}</strong></div>
      <div class="terminal-kv"><span>Started by</span><strong>${escapeHtml(t.started_by || "—")}</strong></div>
      ${t.paused ? `<div class="terminal-kv col-span-2"><span>Paused</span><strong style="color:#ff6b00;">Yes</strong></div>` : ""}
    </div>
  `;
}

function toggleTerminalCard(card, name) {
  const body = card.querySelector(".terminal-card-body");
  const chev = card.querySelector(".terminal-chevron");
  const btn = card.querySelector(".terminal-card-toggle");
  const opening = body.hasAttribute("hidden");

  if (opening) {
    // Accordion: close other open cards so only one expands
    document.querySelectorAll(".terminal-card-v2.is-open").forEach(other => {
      if (other === card) return;
      const otherName = other.dataset.terminal;
      const otherBody = other.querySelector(".terminal-card-body");
      otherBody?.setAttribute("hidden", "");
      other.classList.remove("is-open");
      other.querySelector(".terminal-chevron")?.classList.remove("rotated");
      other.querySelector(".terminal-card-toggle")?.setAttribute("aria-expanded", "false");
      if (otherName) expandedTerminals.delete(otherName);
    });

    body.removeAttribute("hidden");
    card.classList.add("is-open");
    chev?.classList.add("rotated");
    btn?.setAttribute("aria-expanded", "true");
    expandedTerminals.add(name);
    const hist = card.querySelector(".terminal-history");
    if (hist) loadTerminalHistory(name, hist, card);
  } else {
    body.setAttribute("hidden", "");
    card.classList.remove("is-open");
    chev?.classList.remove("rotated");
    btn?.setAttribute("aria-expanded", "false");
    expandedTerminals.delete(name);
  }
}

async function ensureDayHistoryCache() {
  const today = getTodayIST();
  if (terminalDayCache.date === today && Array.isArray(terminalDayCache.rows)) {
    return terminalDayCache.rows;
  }
  if (terminalDayCache.loading && terminalDayCache.date === today) {
    return terminalDayCache.loading;
  }

  terminalDayCache.date = today;
  terminalDayCache.loading = (async () => {
    const rows = [];
    try {
      const [guestSnap, histSnap] = await Promise.all([
        get(ref(db, `${FB_PATHS.GUEST_SESSIONS}/${today}`)),
        get(ref(db, `${FB_PATHS.HISTORY_BY_DATE}/${today}`))
      ]);

      const guests = guestSnap.val() || {};
      Object.entries(guests).forEach(([id, g]) => {
        if (!g || typeof g !== "object") return;
        const term = g.terminal_short || g.terminal || g.TERMINAL_SHORT || g.TERMINALNAME || "";
        rows.push({
          id: `g-${id}`,
          kind: "guest",
          terminal: term,
          terminalKey: normalizeTerminalKey(term),
          time: formatClockTime(g.start_time || g.end_time),
          label: "Guest",
          mins: g.duration_minutes || g.usage || 0,
          amount: Number(g.total || g.prepaid || 0) || 0,
          sort: String(g.start_time || g.end_time || id)
        });
      });

      const hist = histSnap.val() || {};
      Object.entries(hist).forEach(([id, h]) => {
        if (!h || typeof h !== "object") return;
        const term = h.TERMINAL_SHORT || h.TERMINALNAME || h.terminal_short || h.terminal || "";
        const user = h.USERNAME || h.MEMBERS_USERNAME || h.NOTE || "Member";
        rows.push({
          id: `h-${id}`,
          kind: "member",
          terminal: term,
          terminalKey: normalizeTerminalKey(term),
          time: formatClockTime(h.TIME),
          label: user,
          mins: Number(h.USINGMIN) || 0,
          amount: Math.abs(Number(h.CHARGE) || 0),
          sort: String(h.TIME || id)
        });
      });

      rows.sort((a, b) => String(b.sort).localeCompare(String(a.sort)));
      console.log(`[Floor] Day history ${today}: ${rows.length} rows (guest+member)`);
    } catch (err) {
      console.warn("Terminal day history failed:", err);
      terminalDayCache.error = String(err?.message || err);
    }
    terminalDayCache.rows = rows;
    terminalDayCache.loading = null;
    return rows;
  })();

  return terminalDayCache.loading;
}

function paintTerminalHistory(panel, terminalName, rows, card = null) {
  if (!panel) return;

  const liveCard = card || panel.closest(".terminal-card-v2");
  const liveRows = [];

  // Show current session first when this PC is occupied
  if (liveCard && String(liveCard.dataset.status || "").toLowerCase() === "occupied") {
    liveRows.push({
      kind: "live",
      label: liveCard.dataset.player || "Live session",
      time: "Now",
      mins: Number(liveCard.dataset.duration) || 0,
      amount: Number(liveCard.dataset.price) || 0,
      extra: liveCard.dataset.duration ? formatDurationMins(liveCard.dataset.duration) : ""
    });
  }

  const mine = (rows || []).filter(r => terminalsMatch(r.terminal, terminalName)).slice(0, 12);
  const combined = [...liveRows, ...mine];

  if (!combined.length) {
    const err = terminalDayCache.error
      ? `<p class="terminal-history-empty">Could not load history</p>`
      : `<p class="terminal-history-empty">No sessions on this PC today yet</p>`;
    panel.innerHTML = err;
    return;
  }

  panel.innerHTML = combined.map(r => {
    const color = r.kind === "guest" ? "#ff6b00" : r.kind === "live" ? "#00ff88" : "#00f0ff";
    const meta = r.kind === "live"
      ? `${escapeHtml(r.time)}${r.extra ? ` · ${escapeHtml(r.extra)}` : ""}`
      : `${escapeHtml(r.time || "—")}${r.mins ? ` · ${formatDurationMins(r.mins)}` : ""}`;
    const amt = r.kind === "live"
      ? `<span style="color:var(--neon-green);">LIVE</span>`
      : (r.amount ? `₹${Math.round(r.amount)}` : "—");
    return `
      <div class="terminal-feed-row">
        <div class="min-w-0">
          <div class="text-xs truncate" style="color:${color};">${escapeHtml(r.label)}</div>
          <div class="text-[10px] text-gray-500">${meta}</div>
        </div>
        <div class="font-orbitron text-xs shrink-0" style="color: var(--neon-orange);">${amt}</div>
      </div>
    `;
  }).join("");
}

async function loadTerminalHistory(terminalName, panel, card = null) {
  if (!panel) return;
  const today = getTodayIST();

  if (terminalDayCache.date === today && Array.isArray(terminalDayCache.rows)) {
    paintTerminalHistory(panel, terminalName, terminalDayCache.rows, card);
    return;
  }

  panel.innerHTML = `<p class="terminal-history-empty">Loading…</p>`;
  const rows = await ensureDayHistoryCache();
  const livePanel = findTerminalHistoryPanel(terminalName) || panel;
  const liveCard = livePanel.closest?.(".terminal-card-v2") || card;
  paintTerminalHistory(livePanel, terminalName, rows, liveCard);
}

window.refreshTerminalDayHistory = function() {
  terminalDayCache = { date: null, rows: null, loading: null, error: null };
  expandedTerminals.forEach(name => {
    const panel = findTerminalHistoryPanel(name);
    if (panel) loadTerminalHistory(name, panel);
  });
};

// ==================== DATA SYNC ====================

/**
 * Start real-time terminal sync with SINGLE listener
 * 
 * CRITICAL FIX: Previous code was creating new listeners repeatedly,
 * causing 4GB+ daily bandwidth usage!
 * 
 * Firebase onValue listeners automatically receive updates - no polling needed!
 */
function startDataSync() {
  // IMPORTANT: Only set up listener ONCE
  if (isListenerActive) {
    console.log("⚠️ Listeners already active - skipping duplicate setup");
    return;
  }
  
  console.log("🔄 Setting up Firebase listeners...");
  
  // Verify database is ready
  if (!db || !terminalsRef || !sessionsRef) {
    console.error("❌ Firebase database not ready - refs:", { db: !!db, terminalsRef: !!terminalsRef, sessionsRef: !!sessionsRef });
    // Retry after delay
    setTimeout(() => {
      console.log("🔄 Retrying startDataSync...");
      startDataSync();
    }, 2000);
    return;
  }
  
  // Clean up any existing listeners first
  if (terminalsListener) {
    terminalsListener();
    terminalsListener = null;
  }
  if (sessionsListener) {
    sessionsListener();
    sessionsListener = null;
  }
  
  try {
    // Set up real-time listeners (Firebase handles updates automatically)
    terminalsListener = onValue(terminalsRef, snap => {
      renderTerminals(snap.val() || {});
    }, (error) => {
      console.error("❌ Terminal listener error:", error);
    });
    
    sessionsListener = onValue(sessionsRef, parseActiveSessions, (error) => {
      console.error("❌ Sessions listener error:", error);
    });
    
    isListenerActive = true;
  } catch (error) {
    console.error("❌ Failed to set up Firebase listeners:", error);
  }
  
  // NOTE: No setInterval needed! Firebase pushes updates automatically.
  // The old setInterval was creating 120+ duplicate listeners per hour!
}

/**
 * Stop data sync (cleanup)
 */
function stopDataSync() {
  if (terminalsListener) {
    terminalsListener();
    terminalsListener = null;
  }
  if (sessionsListener) {
    sessionsListener();
    sessionsListener = null;
  }
  isListenerActive = false;
  console.log("🛑 Firebase listeners stopped");
}

// ==================== LOGOUT HANDLER ====================

function setupLogout() {
  console.log("🔧 Setting up logout handler...");
  
  const logoutBtn = document.getElementById("logout-btn");
  const logoutModal = document.getElementById("logoutModal");
  const logoutCancelBtn = document.getElementById("logoutCancelBtn");
  const logoutConfirmBtn = document.getElementById("logoutConfirmBtn");
  const logoutBtnText = document.getElementById("logoutBtnText");
  const logoutUserInfo = document.getElementById("logoutUserInfo");
  
  console.log("Logout elements found:", { 
    logoutBtn: !!logoutBtn, 
    logoutModal: !!logoutModal,
    logoutCancelBtn: !!logoutCancelBtn,
    logoutConfirmBtn: !!logoutConfirmBtn
  });
  
  if (!logoutBtn) {
    console.error("❌ Logout button not found!");
    return;
  }
  
  if (!logoutModal) {
    console.error("❌ Logout modal not found!");
    return;
  }
  
  // Remove any existing listeners by cloning
  const newLogoutBtn = logoutBtn.cloneNode(true);
  logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
  
  // Show modal when logout button clicked
  newLogoutBtn.addEventListener("click", function(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log("🚪 Logout button clicked - showing modal");
    
    // Show user info in modal
    const session = getStaffSession();
    if (logoutUserInfo && session) {
      logoutUserInfo.textContent = `Logged in as: ${session.name || session.email}`;
    }
    
    // Show modal
    logoutModal.classList.remove("hidden");
    logoutModal.classList.add("flex");
  });
  
  // Cancel button - close modal
  logoutCancelBtn?.addEventListener("click", function(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log("❌ Cancel clicked - closing modal");
    closeLogoutModal();
  });
  
  // Click outside modal to close
  logoutModal.addEventListener("click", function(e) {
    if (e.target === logoutModal) {
      closeLogoutModal();
    }
  });
  
  // Escape key to close
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && !logoutModal.classList.contains("hidden")) {
      closeLogoutModal();
    }
  });
  
  // Confirm logout
  logoutConfirmBtn?.addEventListener("click", async function(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log("✅ Confirm logout clicked");
    
    // Show loading state
    if (logoutBtnText) logoutBtnText.textContent = "Logging out...";
    if (logoutConfirmBtn) logoutConfirmBtn.disabled = true;
    
    try {
      // Stop data sync before logout
      stopDataSync();
      
      // Clear staff session first
      await handleStaffLogout();
      clearStaffSession();
      
      // Sign out from Firebase Auth (using global auth from dashboard.html)
      if (window.firebaseAuth) {
        console.log("🔄 Signing out from Firebase...");
        await window.firebaseAuth.signOut();
        console.log("✅ Firebase Auth signed out");
      } else {
        console.warn("⚠️ Firebase Auth not found");
      }
      
      // Set a flag so login page knows we just logged out
      sessionStorage.setItem("oceanz_just_logged_out", "true");
      
      console.log("✅ Logged out successfully - redirecting...");
      window.location.href = "index.html";
    } catch (error) {
      console.error("Logout error:", error);
      // Force clear and set flag anyway
      clearStaffSession();
      sessionStorage.setItem("oceanz_just_logged_out", "true");
      window.location.href = "index.html";
    }
  });
  
  function closeLogoutModal() {
    logoutModal.classList.add("hidden");
    logoutModal.classList.remove("flex");
    // Reset button state
    if (logoutBtnText) logoutBtnText.textContent = "Logout";
    if (logoutConfirmBtn) logoutConfirmBtn.disabled = false;
  }
  
  console.log("✅ Logout handler setup complete");
}

// ==================== CLEANUP ON PAGE UNLOAD ====================

window.addEventListener("beforeunload", () => {
  stopDataSync();
});

// ==================== INIT ====================

document.addEventListener("DOMContentLoaded", () => {
  // Refresh session activity timestamp (keeps session alive for PWA)
  refreshSessionActivity();
  
  // Initialize permissions first
  initializePermissions();
  
  // Setup logout
  setupLogout();
  
  // Start with recharges view as default (if user has permission)
  const session = getStaffSession();
  if (session) {
    const role = ROLES[session.role];
    const permissions = role?.permissions || [];
    // Prefer recharges as default, fallback to first available permission
    const defaultView = permissions.includes("recharges") ? "recharges" : (permissions[0] || "dashboard");
    switchView(defaultView);
  } else {
    switchView("recharges");
  }
  
  // Default view is recharges — do NOT start terminal/session listeners until Dashboard is opened
  console.log("✅ Admin dashboard initialized (lazy listeners)");
});

// Export for external use
window.hasPermission = hasPermission;
window.switchView = switchView;
