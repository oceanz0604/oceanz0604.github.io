/**
 * OceanZ Gaming Cafe - Staff Management
 * Admin roles, activity logs, permissions
 */

import { initializeApp, getApps, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get, set, push, onValue, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, createUserWithEmailAndPassword, updatePassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { BOOKING_DB_CONFIG, BOOKING_APP_NAME } from "../../shared/config.js";
import { getStaffSession, logStaffActivity, ROLES, hasPermission } from "./permissions.js";

// ==================== FIREBASE INIT ====================

let bookingApp = getApps().find(app => app.name === BOOKING_APP_NAME);
if (!bookingApp) bookingApp = initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);

const db = getDatabase(bookingApp);

// Helper: Create Firebase Auth user using a temporary app instance
async function createAuthUser(email, password) {
  // Create a temporary Firebase app to create the user
  // This prevents the current admin from being signed out
  const tempAppName = "TEMP_CREATE_USER_" + Date.now();
  const tempApp = initializeApp(BOOKING_DB_CONFIG, tempAppName);
  const tempAuth = getAuth(tempApp);
  
  try {
    const userCredential = await createUserWithEmailAndPassword(tempAuth, email, password);
    console.log("✅ Firebase Auth user created:", userCredential.user.uid);
    return { success: true, uid: userCredential.user.uid };
  } catch (error) {
    console.error("❌ Failed to create auth user:", error);
    return { success: false, error: error.message };
  } finally {
    // Clean up the temporary app
    try {
      await deleteApp(tempApp);
    } catch (e) {
      console.warn("Temp app cleanup failed:", e);
    }
  }
}

// Helper: Update user password (requires re-authentication)
async function updateUserPassword(email, currentPassword, newPassword) {
  const tempAppName = "TEMP_UPDATE_PWD_" + Date.now();
  const tempApp = initializeApp(BOOKING_DB_CONFIG, tempAppName);
  const tempAuth = getAuth(tempApp);
  
  try {
    // Sign in as the user to update their password
    const userCredential = await signInWithEmailAndPassword(tempAuth, email, currentPassword);
    await updatePassword(userCredential.user, newPassword);
    console.log("✅ Password updated for:", email);
    return { success: true };
  } catch (error) {
    console.error("❌ Failed to update password:", error);
    return { success: false, error: error.message };
  } finally {
    try {
      await deleteApp(tempApp);
    } catch (e) {
      console.warn("Temp app cleanup failed:", e);
    }
  }
}

// ==================== REFS ====================

const staffRef = ref(db, "staff");
const activityLogRef = ref(db, "activity_log");

// Note: ROLES is imported from permissions.js

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
          <div class="grid md:grid-cols-5 gap-3">
            <input id="newStaffEmail" type="email" placeholder="Email" class="neon-input px-3 py-2 rounded-lg text-white"/>
            <input id="newStaffName" type="text" placeholder="Display Name" class="neon-input px-3 py-2 rounded-lg text-white"/>
            <input id="newStaffPassword" type="password" placeholder="Password (min 6)" class="neon-input px-3 py-2 rounded-lg text-white"/>
            <select id="newStaffRole" class="neon-select px-3 py-2 rounded-lg text-white">
              <option value="STAFF">Staff</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Admin</option>
              <option value="SUPER_ADMIN">Super Admin</option>
            </select>
            <button onclick="addStaffMember()" id="addStaffBtn" class="neon-btn neon-btn-green rounded-lg px-4 py-2 text-sm font-orbitron">
              ADD
            </button>
          </div>
          <p class="text-xs text-gray-500 mt-2">💡 This will create a Firebase Auth account for the staff member</p>
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
  const currentSession = getStaffSession();
  const isCurrentUser = member.email?.toLowerCase() === currentSession?.email?.toLowerCase();
  const canModify = hasPermission("staff") && !isCurrentUser;
  const currentRole = ROLES[currentSession?.role];
  const canChangeRole = currentSession?.role === "SUPER_ADMIN" || (currentRole && role.level < currentRole.level);
  
  return `
    <div class="flex items-center justify-between p-3 rounded-lg transition-all hover:bg-gray-800/30" 
      style="background: rgba(0,0,0,0.2); border-left: 3px solid ${role.color}; ${isCurrentUser ? 'box-shadow: 0 0 10px ' + role.color + '40;' : ''}">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg flex items-center justify-center font-orbitron font-bold text-lg relative"
          style="background: ${role.color}20; color: ${role.color};">
          ${member.name?.charAt(0).toUpperCase() || "?"}
          ${isCurrentUser ? '<span class="absolute -top-1 -right-1 text-xs">👤</span>' : ''}
        </div>
        <div>
          <p class="font-orbitron text-sm flex items-center gap-2" style="color: #00f0ff;">
            ${member.name || "Unknown"}
            ${isCurrentUser ? '<span class="text-xs px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-normal">YOU</span>' : ''}
          </p>
          <p class="text-xs text-gray-500">${member.email || "No email"}</p>
          ${member.lastLogin ? `<p class="text-xs text-gray-600">Last: ${new Date(member.lastLogin).toLocaleDateString()}</p>` : ''}
        </div>
      </div>
      <div class="flex items-center gap-3">
        ${canModify && canChangeRole ? `
          <select onchange="changeStaffRole('${id}', this.value)" 
            class="text-xs px-2 py-1 rounded font-orbitron cursor-pointer" 
            style="background: ${role.color}20; color: ${role.color}; border: 1px solid ${role.color}40;">
            ${Object.entries(ROLES).map(([key, r]) => {
              const disabled = currentSession?.role !== "SUPER_ADMIN" && r.level >= currentRole.level;
              return `<option value="${key}" ${key === member.role ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${r.icon} ${r.name}</option>`;
            }).join('')}
          </select>
        ` : `
          <span class="text-xs px-2 py-1 rounded font-orbitron" style="background: ${role.color}20; color: ${role.color};">
            ${role.icon} ${role.name}
          </span>
        `}
        <div class="w-2 h-2 rounded-full ${member.active ? 'animate-pulse' : ''}" style="background: ${statusColor};" title="${member.active ? 'Online' : 'Offline'}"></div>
        ${canModify ? `
          <button onclick="openEditStaffModal('${id}')" class="text-cyan-400 hover:text-cyan-300 p-1" title="Edit">
            ✏️
          </button>
          <button onclick="removeStaffMember('${id}')" class="text-red-400 hover:text-red-300 p-1" title="Remove">
            ✕
          </button>
        ` : ''}
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
  // Check permission
  if (!hasPermission("staff")) {
    alert("You don't have permission to manage staff");
    return;
  }

  const currentSession = getStaffSession();
  const currentRole = ROLES[currentSession?.role];
  
  const emailEl = document.getElementById("newStaffEmail");
  const nameEl = document.getElementById("newStaffName");
  const passwordEl = document.getElementById("newStaffPassword");
  const roleEl = document.getElementById("newStaffRole");
  const addBtn = document.getElementById("addStaffBtn");
  
  const email = emailEl?.value?.trim() || "";
  const name = nameEl?.value?.trim() || "";
  const password = passwordEl?.value || "";
  const role = roleEl?.value || "STAFF";
  const targetRole = ROLES[role];

  // Validation
  if (!email || !name) {
    alert("Please fill in email and name");
    return;
  }

  if (!password || password.length < 6) {
    alert("Password must be at least 6 characters");
    return;
  }

  // Only super admins can create super admins
  if (role === "SUPER_ADMIN" && currentSession?.role !== "SUPER_ADMIN") {
    alert("Only Super Admins can create Super Admin accounts");
    return;
  }

  // Can only create roles with lower level than yourself
  if (targetRole && currentRole && targetRole.level >= currentRole.level && currentSession?.role !== "SUPER_ADMIN") {
    alert(`You can only create roles below your level (${currentRole.name})`);
    return;
  }

  // Show loading state
  if (addBtn) {
    addBtn.disabled = true;
    addBtn.innerHTML = "⏳ Creating...";
  }

  try {
    // Step 1: Create Firebase Auth user
    const authResult = await createAuthUser(email, password);
    
    if (!authResult.success) {
      throw new Error(authResult.error || "Failed to create auth user");
    }

    // Step 2: Create staff record in database
    const newRef = push(staffRef);
    await set(newRef, {
      email: email.toLowerCase(),
      name,
      role,
      uid: authResult.uid,
      active: false,
      createdAt: new Date().toISOString(),
      createdBy: currentSession?.email || "Unknown"
    });

    // Log activity
    await logActivity("staff_add", `Added staff member: ${name} as ${role}`);
    
    console.log("✅ Staff member added successfully");
    alert(`✅ Staff member "${name}" created successfully!\n\nEmail: ${email}\nRole: ${role}`);

    // Clear form
    if (emailEl) emailEl.value = "";
    if (nameEl) nameEl.value = "";
    if (passwordEl) passwordEl.value = "";

    // Reload
    loadStaffManagement();
  } catch (error) {
    console.error("Error adding staff:", error);
    alert("❌ Failed to add staff member:\n" + error.message);
  } finally {
    // Reset button
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.innerHTML = "ADD";
    }
  }
}

async function removeStaffMember(id) {
  // Check permission
  if (!hasPermission("staff")) {
    alert("You don't have permission to manage staff");
    return;
  }

  const currentSession = getStaffSession();
  
  // Get the staff member to be removed
  const staffSnap = await get(ref(db, `staff/${id}`));
  const staffMember = staffSnap.val();
  
  if (!staffMember) {
    alert("Staff member not found");
    return;
  }

  // Cannot remove yourself
  if (staffMember.email?.toLowerCase() === currentSession?.email?.toLowerCase()) {
    alert("You cannot remove yourself");
    return;
  }

  // Only super admins can remove other super admins
  if (staffMember.role === "SUPER_ADMIN" && currentSession?.role !== "SUPER_ADMIN") {
    alert("Only Super Admins can remove Super Admin accounts");
    return;
  }

  if (!confirm(`Remove ${staffMember.name} (${staffMember.role})?`)) return;

  try {
    await set(ref(db, `staff/${id}`), null);
    await logActivity("staff_remove", `Removed staff member: ${staffMember.name}`);
    loadStaffManagement();
  } catch (error) {
    console.error("Error removing staff:", error);
  }
}

// ==================== ACTIVITY LOGGING ====================

// Use logStaffActivity from permissions.js instead
export async function logActivity(type, action, details = "") {
  return logStaffActivity(type, action, details);
}

// ==================== CHANGE ROLE ====================

async function changeStaffRole(id, newRole) {
  if (!hasPermission("staff")) {
    alert("You don't have permission to manage staff");
    return;
  }

  const currentSession = getStaffSession();
  const currentRoleInfo = ROLES[currentSession?.role];
  const newRoleInfo = ROLES[newRole];

  if (!newRoleInfo) {
    alert("Invalid role");
    return;
  }

  // Only super admins can assign super admin role
  if (newRole === "SUPER_ADMIN" && currentSession?.role !== "SUPER_ADMIN") {
    alert("Only Super Admins can assign Super Admin role");
    loadStaffManagement(); // Refresh to reset dropdown
    return;
  }

  // Can only assign roles lower than your own (except super admins)
  if (currentSession?.role !== "SUPER_ADMIN" && newRoleInfo.level >= currentRoleInfo.level) {
    alert("You can only assign roles below your level");
    loadStaffManagement(); // Refresh to reset dropdown
    return;
  }

  try {
    const staffSnap = await get(ref(db, `staff/${id}`));
    const staffMember = staffSnap.val();

    await update(ref(db, `staff/${id}`), {
      role: newRole,
      updatedAt: new Date().toISOString(),
      updatedBy: currentSession?.email || "Unknown"
    });

    await logActivity("staff_role_change", `Changed ${staffMember?.name}'s role to ${newRoleInfo.name}`);
    loadStaffManagement();
  } catch (error) {
    console.error("Error changing role:", error);
    alert("Failed to change role");
  }
}

// ==================== EDIT STAFF MODAL ====================

let currentEditId = null;

function createEditModal() {
  // Check if modal already exists
  if (document.getElementById("editStaffModal")) return;
  
  const modal = document.createElement("div");
  modal.id = "editStaffModal";
  modal.className = "fixed inset-0 z-50 hidden items-center justify-center";
  modal.style.cssText = "background: rgba(0,0,0,0.8); backdrop-filter: blur(5px);";
  
  modal.innerHTML = `
    <div class="neon-card rounded-2xl w-full max-w-md p-6 mx-4 relative" style="border-color: rgba(0,240,255,0.5);">
      <button onclick="closeEditStaffModal()" class="absolute top-4 right-4 text-gray-500 hover:text-white">✕</button>
      
      <h3 class="font-orbitron text-lg font-bold mb-4" style="color: #00f0ff;">✏️ EDIT STAFF MEMBER</h3>
      
      <div class="space-y-4">
        <div>
          <label class="text-xs text-gray-500 mb-1 block">Email (cannot be changed)</label>
          <input id="editStaffEmail" type="email" disabled class="neon-input w-full px-3 py-2 rounded-lg text-gray-500 cursor-not-allowed"/>
        </div>
        
        <div>
          <label class="text-xs text-gray-500 mb-1 block">Display Name</label>
          <input id="editStaffName" type="text" placeholder="Display Name" class="neon-input w-full px-3 py-2 rounded-lg text-white"/>
        </div>
        
        <div>
          <label class="text-xs text-gray-500 mb-1 block">Role</label>
          <select id="editStaffRole" class="neon-select w-full px-3 py-2 rounded-lg text-white">
            <option value="STAFF">🎮 Staff</option>
            <option value="MANAGER">🎯 Manager</option>
            <option value="ADMIN">⚡ Admin</option>
            <option value="SUPER_ADMIN">👑 Super Admin</option>
          </select>
        </div>
        
        <div class="pt-4 border-t border-gray-700">
          <label class="text-xs text-gray-500 mb-1 block">Reset Password (leave blank to keep current)</label>
          <div class="grid grid-cols-2 gap-2">
            <input id="editStaffCurrentPwd" type="password" placeholder="Current Password" class="neon-input px-3 py-2 rounded-lg text-white"/>
            <input id="editStaffNewPwd" type="password" placeholder="New Password" class="neon-input px-3 py-2 rounded-lg text-white"/>
          </div>
          <p class="text-xs text-gray-600 mt-1">⚠️ Current password required to change password</p>
        </div>

        <div class="flex gap-3 pt-2">
          <button onclick="closeEditStaffModal()" class="flex-1 px-4 py-3 rounded-lg text-gray-400" style="background: rgba(100,100,100,0.2);">
            Cancel
          </button>
          <button onclick="saveStaffEdit()" id="saveEditBtn" class="flex-1 px-4 py-3 rounded-lg font-orbitron font-bold" style="background: linear-gradient(135deg, #00f0ff, #0088ff); color: #000;">
            ✓ Save Changes
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

async function openEditStaffModal(id) {
  currentEditId = id;
  createEditModal();
  
  // Fetch staff data
  const staffSnap = await get(ref(db, `staff/${id}`));
  const staff = staffSnap.val();
  
  if (!staff) {
    alert("Staff member not found");
    return;
  }
  
  // Populate form
  document.getElementById("editStaffEmail").value = staff.email || "";
  document.getElementById("editStaffName").value = staff.name || "";
  document.getElementById("editStaffRole").value = staff.role || "STAFF";
  document.getElementById("editStaffCurrentPwd").value = "";
  document.getElementById("editStaffNewPwd").value = "";
  
  // Show modal
  const modal = document.getElementById("editStaffModal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function closeEditStaffModal() {
  const modal = document.getElementById("editStaffModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
  currentEditId = null;
}

async function saveStaffEdit() {
  if (!currentEditId) return;
  
  const currentSession = getStaffSession();
  const name = document.getElementById("editStaffName")?.value?.trim();
  const role = document.getElementById("editStaffRole")?.value;
  const currentPwd = document.getElementById("editStaffCurrentPwd")?.value;
  const newPwd = document.getElementById("editStaffNewPwd")?.value;
  const saveBtn = document.getElementById("saveEditBtn");
  
  if (!name) {
    alert("Please enter a display name");
    return;
  }
  
  // Get current staff data
  const staffSnap = await get(ref(db, `staff/${currentEditId}`));
  const staff = staffSnap.val();
  
  if (!staff) {
    alert("Staff member not found");
    return;
  }
  
  // Role change permission check
  const currentRole = ROLES[currentSession?.role];
  const newRoleInfo = ROLES[role];
  
  if (role !== staff.role) {
    if (role === "SUPER_ADMIN" && currentSession?.role !== "SUPER_ADMIN") {
      alert("Only Super Admins can assign Super Admin role");
      return;
    }
    if (currentSession?.role !== "SUPER_ADMIN" && newRoleInfo.level >= currentRole.level) {
      alert("You can only assign roles below your level");
      return;
    }
  }
  
  // Show loading
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = "⏳ Saving...";
  }
  
  try {
    // Update database record
    await update(ref(db, `staff/${currentEditId}`), {
      name,
      role,
      updatedAt: new Date().toISOString(),
      updatedBy: currentSession?.email || "Unknown"
    });
    
    // Handle password change if provided
    if (currentPwd && newPwd) {
      if (newPwd.length < 6) {
        alert("New password must be at least 6 characters");
        return;
      }
      
      const pwdResult = await updateUserPassword(staff.email, currentPwd, newPwd);
      if (!pwdResult.success) {
        alert("Password update failed: " + pwdResult.error);
        // Database update succeeded, just password failed
      } else {
        console.log("✅ Password updated");
      }
    }
    
    await logActivity("staff_edit", `Updated staff member: ${name}`);
    alert("✅ Staff member updated successfully!");
    
    closeEditStaffModal();
    loadStaffManagement();
  } catch (error) {
    console.error("Error updating staff:", error);
    alert("❌ Failed to update staff member:\n" + error.message);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = "✓ Save Changes";
    }
  }
}

// ==================== EXPORTS ====================

window.loadStaffManagement = loadStaffManagement;
window.addStaffMember = addStaffMember;
window.removeStaffMember = removeStaffMember;
window.changeStaffRole = changeStaffRole;
window.openEditStaffModal = openEditStaffModal;
window.closeEditStaffModal = closeEditStaffModal;
window.saveStaffEdit = saveStaffEdit;
window.logActivity = logActivity;

