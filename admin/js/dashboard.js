/**
 * OceanZ Gaming Cafe - Admin Dashboard
 * Note: Auth is handled in the HTML file, this just handles data
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { FDB_DATASET_CONFIG, FDB_APP_NAME, TIMEZONE, formatToIST } from "../../shared/config.js";
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
  navRecharges: $("nav-recharges"),
  navAnalytics: $("nav-analytics"),
  navStaff: $("nav-staff"),
  navCash: $("nav-cash"),
  navLeaderboard: $("nav-leaderboard"),
  dashboardSection: $("dashboard-section"),
  membersSection: $("members-section"),
  bookingsSection: $("bookings-section"),
  rechargesSection: $("recharges-section"),
  analyticsSection: $("analytics-section"),
  staffSection: $("staff-section"),
  cashSection: $("cash-section"),
  leaderboardSection: $("leaderboard-section")
};

// ==================== STATE ====================

let activeSessions = {};
let autoRefreshInterval = null;

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

// ==================== VIEW SWITCHER ====================

function switchView(view) {
  // Cash register uses recharges permission, leaderboard uses members permission
  const permissionKey = view === "cash" ? "recharges" : view === "leaderboard" ? "members" : view;
  
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
    elements.analyticsSection,
    elements.staffSection,
    elements.cashSection,
    elements.leaderboardSection
  ];

  const navs = [
    elements.navDashboard,
    elements.navMembers,
    elements.navBookings,
    elements.navRecharges,
    elements.navAnalytics,
    elements.navStaff,
    elements.navCash,
    elements.navLeaderboard
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
    recharges: { section: elements.rechargesSection, nav: elements.navRecharges },
    analytics: { section: elements.analyticsSection, nav: elements.navAnalytics, onShow: () => window.loadAnalytics?.() },
    staff: { section: elements.staffSection, nav: elements.navStaff, onShow: () => window.loadStaffManagement?.() },
    cash: { section: elements.cashSection, nav: elements.navCash, onShow: () => window.loadCashRegister?.() },
    leaderboard: { section: elements.leaderboardSection, nav: elements.navLeaderboard, onShow: () => window.initLeaderboards?.() }
  };

  const config = viewMap[view];
  if (config) {
    config.section?.classList.remove("hidden");
    config.nav?.classList.remove("text-gray-400");
    config.nav?.classList.add("active");
    config.onShow?.();
  }
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
  { el: elements.navAnalytics, view: "analytics" },
  { el: elements.navStaff, view: "staff" },
  { el: elements.navCash, view: "cash" },
  { el: elements.navLeaderboard, view: "leaderboard" }
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
  
  // Use IST timezone for timestamp
  elements.timestamp.textContent = "Last updated: " + formatToIST(new Date());

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

// ==================== INIT ====================

document.addEventListener("DOMContentLoaded", () => {
  // Refresh session activity timestamp (keeps session alive for PWA)
  refreshSessionActivity();
  
  // Initialize permissions first
  initializePermissions();
  
  // Setup logout
  setupLogout();
  
  // Start with first available view
  const session = getStaffSession();
  if (session) {
    const role = ROLES[session.role];
    const firstAllowedView = role?.permissions?.[0] || "dashboard";
    switchView(firstAllowedView);
  } else {
    switchView("dashboard");
  }
  
  startDataSync();
});

// Export for external use
window.hasPermission = hasPermission;
window.switchView = switchView;
