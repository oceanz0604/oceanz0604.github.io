/**
 * OceanZ Gaming Cafe - Staff Management
 * Admin roles, activity logs, permissions
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get, set, push, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { BOOKING_DB_CONFIG, BOOKING_APP_NAME } from "../../shared/config.js";

// ==================== FIREBASE INIT ====================

let bookingApp = getApps().find(app => app.name === BOOKING_APP_NAME);
if (!bookingApp) bookingApp = initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);

const db = getDatabase(bookingApp);

// ==================== REFS ====================

const staffRef = ref(db, "staff");
const activityLogRef = ref(db, "activity_log");

// ==================== ROLES ====================

const ROLES = {
  SUPER_ADMIN: {
    name: "Super Admin",
    color: "#ff0044",
    permissions: ["all"]
  },
  ADMIN: {
    name: "Admin",
    color: "#b829ff",
    permissions: ["members", "bookings", "recharges", "history", "analytics"]
  },
  MANAGER: {
    name: "Manager",
    color: "#00f0ff",
    permissions: ["members", "bookings", "recharges"]
  },
  STAFF: {
    name: "Staff",
    color: "#00ff88",
    permissions: ["bookings", "recharges"]
  }
};

// ==================== LOAD STAFF MANAGEMENT ====================

export async function loadStaffManagement() {
  const container = document.getElementById("staff-content");
  if (!container) return;

  container.innerHTML = `
    <div class="text-center py-8">
      <div class="w-12 h-12 mx-auto mb-4 border-2 border-t-yellow-400 border-r-red-500 border-b-yellow-400 border-l-red-500 rounded-full animate-spin"></div>
      <p class="text-gray-500 font-orbitron text-sm">LOADING STAFF DATA...</p>
    </div>
  `;

  try {
    const [staffSnap, activitySnap] = await Promise.all([
      get(staffRef),
      get(activityLogRef)
    ]);

    const staff = staffSnap.val() || {};
    const activities = activitySnap.val() || {};

    renderStaffDashboard(container, staff, activities);
  } catch (error) {
    console.error("Error loading staff:", error);
    container.innerHTML = `<p class="text-red-400 text-center">Failed to load staff data</p>`;
  }
}

// ==================== RENDER DASHBOARD ====================

function renderStaffDashboard(container, staff, activities) {
  const staffList = Object.entries(staff);
  const activityList = Object.entries(activities).sort((a, b) => 
    new Date(b[1].timestamp) - new Date(a[1].timestamp)
  ).slice(0, 50);

  container.innerHTML = `
    <div class="grid lg:grid-cols-3 gap-6">
      <!-- Staff List -->
      <div class="lg:col-span-2 space-y-6">
        <!-- Add Staff Form -->
        <div class="neon-card rounded-xl p-4 relative">
          <h3 class="font-orbitron text-sm font-bold mb-4" style="color: #ffff00;">➕ ADD STAFF MEMBER</h3>
          <div class="grid md:grid-cols-4 gap-3">
            <input id="staffEmail" type="email" placeholder="Email" class="neon-input px-3 py-2 rounded-lg text-white"/>
            <input id="staffName" type="text" placeholder="Display Name" class="neon-input px-3 py-2 rounded-lg text-white"/>
            <select id="staffRole" class="neon-select px-3 py-2 rounded-lg text-white">
              <option value="STAFF">Staff</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Admin</option>
              <option value="SUPER_ADMIN">Super Admin</option>
            </select>
            <button onclick="addStaffMember()" class="neon-btn neon-btn-green rounded-lg px-4 py-2 text-sm font-orbitron">
              ADD
            </button>
          </div>
        </div>

        <!-- Staff Members -->
        <div class="neon-card rounded-xl p-4 relative">
          <h3 class="font-orbitron text-sm font-bold mb-4" style="color: #00f0ff;">👥 TEAM MEMBERS</h3>
          <div id="staffList" class="space-y-3">
            ${staffList.length === 0 ? `
              <p class="text-gray-500 text-center py-4">No staff members yet</p>
            ` : staffList.map(([id, member]) => renderStaffCard(id, member)).join("")}
          </div>
        </div>

        <!-- Role Permissions -->
        <div class="neon-card rounded-xl p-4 relative">
          <h3 class="font-orbitron text-sm font-bold mb-4" style="color: #b829ff;">🔐 ROLE PERMISSIONS</h3>
          <div class="grid md:grid-cols-2 gap-4">
            ${Object.entries(ROLES).map(([key, role]) => `
              <div class="p-3 rounded-lg" style="background: rgba(0,0,0,0.3); border-left: 3px solid ${role.color};">
                <div class="flex items-center justify-between mb-2">
                  <span class="font-orbitron text-sm" style="color: ${role.color};">${role.name}</span>
                  <span class="text-xs px-2 py-1 rounded" style="background: ${role.color}20; color: ${role.color};">
                    ${role.permissions.includes("all") ? "Full Access" : role.permissions.length + " modules"}
                  </span>
                </div>
                <div class="flex flex-wrap gap-1">
                  ${(role.permissions.includes("all") ? ["All Modules"] : role.permissions).map(p => `
                    <span class="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">${p}</span>
                  `).join("")}
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>

      <!-- Activity Log -->
      <div class="space-y-6">
        <div class="neon-card rounded-xl p-4 relative">
          <h3 class="font-orbitron text-sm font-bold mb-4" style="color: #ff6b00;">📋 ACTIVITY LOG</h3>
          <div id="activityLog" class="space-y-2 max-h-96 overflow-y-auto">
            ${activityList.length === 0 ? `
              <p class="text-gray-500 text-center py-4">No activity recorded</p>
            ` : activityList.map(([id, activity]) => renderActivityItem(activity)).join("")}
          </div>
        </div>

        <!-- Quick Stats -->
        <div class="neon-card rounded-xl p-4 relative">
          <h3 class="font-orbitron text-sm font-bold mb-4" style="color: #00ff88;">📊 STAFF STATS</h3>
          <div class="space-y-3">
            ${renderStaffStats(staffList, activityList)}
          </div>
        </div>
      </div>
    </div>
  `;

  // Setup real-time listener for activities
  onValue(activityLogRef, snap => {
    const log = document.getElementById("activityLog");
    if (!log) return;
    
    const activities = Object.entries(snap.val() || {})
      .sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp))
      .slice(0, 50);
    
    if (activities.length === 0) {
      log.innerHTML = `<p class="text-gray-500 text-center py-4">No activity recorded</p>`;
    } else {
      log.innerHTML = activities.map(([id, a]) => renderActivityItem(a)).join("");
    }
  });
}

// ==================== RENDER HELPERS ====================

function renderStaffCard(id, member) {
  const role = ROLES[member.role] || ROLES.STAFF;
  const statusColor = member.active ? "#00ff88" : "#666";
  
  return `
    <div class="flex items-center justify-between p-3 rounded-lg transition-all hover:bg-gray-800/30" 
      style="background: rgba(0,0,0,0.2); border-left: 3px solid ${role.color};">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg flex items-center justify-center font-orbitron font-bold text-lg"
          style="background: ${role.color}20; color: ${role.color};">
          ${member.name?.charAt(0).toUpperCase() || "?"}
        </div>
        <div>
          <p class="font-orbitron text-sm" style="color: #00f0ff;">${member.name || "Unknown"}</p>
          <p class="text-xs text-gray-500">${member.email || "No email"}</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs px-2 py-1 rounded font-orbitron" style="background: ${role.color}20; color: ${role.color};">
          ${role.name}
        </span>
        <div class="w-2 h-2 rounded-full" style="background: ${statusColor};"></div>
        <button onclick="removeStaffMember('${id}')" class="text-red-400 hover:text-red-300 p-1" title="Remove">
          ✕
        </button>
      </div>
    </div>
  `;
}

function renderActivityItem(activity) {
  const typeColors = {
    login: "#00f0ff",
    logout: "#666",
    booking_approve: "#00ff88",
    booking_decline: "#ff0044",
    recharge_add: "#00ff88",
    recharge_edit: "#ffff00",
    recharge_delete: "#ff0044",
    member_view: "#b829ff",
    default: "#888"
  };

  const typeIcons = {
    login: "🔓",
    logout: "🔒",
    booking_approve: "✅",
    booking_decline: "❌",
    recharge_add: "💰",
    recharge_edit: "✏️",
    recharge_delete: "🗑️",
    member_view: "👤",
    default: "📝"
  };

  const color = typeColors[activity.type] || typeColors.default;
  const icon = typeIcons[activity.type] || typeIcons.default;
  const time = new Date(activity.timestamp).toLocaleString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short"
  });

  return `
    <div class="flex items-start gap-2 p-2 rounded text-xs" style="background: rgba(0,0,0,0.2);">
      <span>${icon}</span>
      <div class="flex-1">
        <span class="font-orbitron" style="color: ${color};">${activity.admin || "Unknown"}</span>
        <span class="text-gray-500"> ${activity.action || activity.type}</span>
        ${activity.details ? `<p class="text-gray-600 mt-0.5">${activity.details}</p>` : ""}
      </div>
      <span class="text-gray-600 whitespace-nowrap">${time}</span>
    </div>
  `;
}

function renderStaffStats(staffList, activityList) {
  const totalStaff = staffList.length;
  const activeStaff = staffList.filter(([, m]) => m.active).length;
  const todayActivities = activityList.filter(([, a]) => {
    const today = new Date().toDateString();
    return new Date(a.timestamp).toDateString() === today;
  }).length;

  return `
    <div class="flex justify-between items-center p-2 rounded" style="background: rgba(0,0,0,0.2);">
      <span class="text-gray-400">Total Staff</span>
      <span class="font-orbitron" style="color: #00f0ff;">${totalStaff}</span>
    </div>
    <div class="flex justify-between items-center p-2 rounded" style="background: rgba(0,0,0,0.2);">
      <span class="text-gray-400">Active Now</span>
      <span class="font-orbitron" style="color: #00ff88;">${activeStaff}</span>
    </div>
    <div class="flex justify-between items-center p-2 rounded" style="background: rgba(0,0,0,0.2);">
      <span class="text-gray-400">Today's Actions</span>
      <span class="font-orbitron" style="color: #ff6b00;">${todayActivities}</span>
    </div>
  `;
}

// ==================== STAFF ACTIONS ====================

async function addStaffMember() {
  const email = document.getElementById("staffEmail")?.value.trim();
  const name = document.getElementById("staffName")?.value.trim();
  const role = document.getElementById("staffRole")?.value || "STAFF";

  if (!email || !name) {
    alert("Please fill in email and name");
    return;
  }

  try {
    const newRef = push(staffRef);
    await set(newRef, {
      email,
      name,
      role,
      active: false,
      createdAt: new Date().toISOString()
    });

    // Log activity
    await logActivity("staff_add", `Added staff member: ${name}`);

    // Clear form
    document.getElementById("staffEmail").value = "";
    document.getElementById("staffName").value = "";

    // Reload
    loadStaffManagement();
  } catch (error) {
    console.error("Error adding staff:", error);
    alert("Failed to add staff member");
  }
}

async function removeStaffMember(id) {
  if (!confirm("Remove this staff member?")) return;

  try {
    await set(ref(db, `staff/${id}`), null);
    await logActivity("staff_remove", `Removed staff member`);
    loadStaffManagement();
  } catch (error) {
    console.error("Error removing staff:", error);
  }
}

// ==================== ACTIVITY LOGGING ====================

export async function logActivity(type, action, details = "") {
  const currentUser = firebase.auth?.()?.currentUser;
  
  try {
    await push(activityLogRef, {
      type,
      action,
      details,
      admin: currentUser?.email || "Unknown",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error logging activity:", error);
  }
}

// ==================== EXPORTS ====================

window.loadStaffManagement = loadStaffManagement;
window.addStaffMember = addStaffMember;
window.removeStaffMember = removeStaffMember;
window.logActivity = logActivity;

