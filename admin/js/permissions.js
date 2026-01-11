/**
 * OceanZ Gaming Cafe - Permissions System
 * Role-based access control for admin panel
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get, set, update, onValue, off } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { BOOKING_DB_CONFIG, BOOKING_APP_NAME, FB_PATHS } from "../../shared/config.js";

// ==================== FIREBASE INIT ====================

// Use a unique name for permissions module to avoid conflicts
const PERM_APP_NAME = "OCEANZ_PERMISSIONS";

let permApp;
try {
  permApp = getApps().find(app => app.name === PERM_APP_NAME);
  if (!permApp) {
    permApp = initializeApp(BOOKING_DB_CONFIG, PERM_APP_NAME);
  }
} catch (err) {
  console.warn("Permissions Firebase init error:", err);
  // Try without name as fallback
  permApp = getApps()[0] || initializeApp(BOOKING_DB_CONFIG);
}

let db;
try {
  db = getDatabase(permApp);
} catch (err) {
  console.error("Database init error:", err);
}

// ==================== ROLE DEFINITIONS ====================

export const ROLES = {
  SUPER_ADMIN: {
    name: "Super Admin",
    level: 100,
    color: "#ff0044",
    icon: "👑",
    permissions: ["dashboard", "bookings", "recharges", "members", "history", "analytics", "staff", "settings", "cash_register", "leaderboard"],
    canEdit: true,
    description: "Full access to all features"
  },
  ADMIN: {
    name: "Admin",
    level: 80,
    color: "#b829ff",
    icon: "⚡",
    permissions: ["dashboard", "bookings", "recharges", "members", "history", "analytics", "cash_register", "leaderboard"],
    canEdit: true,
    description: "Full access except staff management"
  },
  MANAGER: {
    name: "Manager",
    level: 60,
    color: "#00f0ff",
    icon: "🎯",
    permissions: ["dashboard", "bookings", "recharges", "members", "cash_register", "leaderboard"],
    canEdit: true,
    description: "Day-to-day operations management"
  },
  FINANCE_MANAGER: {
    name: "Finance Manager",
    level: 55,
    color: "#ffd700",
    icon: "💰",
    permissions: ["dashboard", "analytics", "cash_register", "leaderboard"],
    canEdit: false,  // View-only for finance data
    description: "View-only access to financial reports"
  },
  COUNTER: {
    name: "Counter/Cashier",
    level: 30,
    color: "#ff6b00",
    icon: "🧾",
    permissions: ["counter", "bookings"],  // Special "counter" permission for POS interface
    canEdit: true,
    usePOSInterface: true,  // Use simplified POS counter interface
    description: "Add recharges and confirm bookings only"
  },
  STAFF: {
    name: "Staff",
    level: 40,
    color: "#00ff88",
    icon: "🎮",
    permissions: ["dashboard", "bookings", "recharges"],
    canEdit: true,
    description: "Basic staff access"
  }
};

// Module to navigation mapping
export const MODULE_NAV_MAP = {
  dashboard: { name: "Dashboard", icon: "layout-dashboard", view: "dashboard" },
  bookings: { name: "Bookings", icon: "calendar-clock", view: "bookings" },
  recharges: { name: "Recharges", icon: "wallet", view: "recharges" },
  members: { name: "Members", icon: "users", view: "members" },
  history: { name: "History", icon: "history", view: "history" },
  analytics: { name: "Analytics", icon: "bar-chart-3", view: "analytics" },
  staff: { name: "Staff", icon: "shield-check", view: "staff" },
  cash_register: { name: "Cash Register", icon: "banknote", view: "cash" },
  leaderboard: { name: "Leaderboards", icon: "trophy", view: "leaderboard" },
  counter: { name: "POS Counter", icon: "receipt", view: "counter", redirect: "counter.html" }
};

// Check if user can edit (vs view-only)
export function canEditData() {
  const session = getStaffSession();
  if (!session) return false;
  
  const role = ROLES[session.role];
  if (!role) return false;
  
  // Super admin always can edit
  if (session.role === "SUPER_ADMIN") return true;
  
  return role.canEdit !== false;
}

// Check if user should use POS interface
export function shouldUsePOSInterface() {
  const session = getStaffSession();
  if (!session) return false;
  
  const role = ROLES[session.role];
  return role?.usePOSInterface === true;
}

// ==================== STAFF SESSION ====================

const SESSION_KEY = "oceanz_staff_session";
const SESSION_TIMESTAMP_KEY = "oceanz_staff_session_time";
const SESSION_PERMISSION_VERSION_KEY = "oceanz_staff_permission_version";
const SESSION_MAX_AGE_DAYS = 7; // Session expires after 7 days of inactivity

// Real-time permission listener
let permissionListener = null;
let permissionListenerStaffId = null;

// Get current staff session from localStorage (persistent for PWA)
export function getStaffSession() {
  try {
    const data = localStorage.getItem(SESSION_KEY);
    if (!data) return null;
    
    // Check if session has expired (7 days of inactivity)
    const timestamp = localStorage.getItem(SESSION_TIMESTAMP_KEY);
    if (timestamp) {
      const lastActivity = new Date(timestamp);
      const now = new Date();
      const daysSinceActivity = (now - lastActivity) / (1000 * 60 * 60 * 24);
      
      if (daysSinceActivity > SESSION_MAX_AGE_DAYS) {
        console.log("Session expired due to inactivity");
        clearStaffSession();
        return null;
      }
    }
    
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Save staff session to localStorage (persistent for PWA)
export function setStaffSession(staffData) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(staffData));
  localStorage.setItem(SESSION_TIMESTAMP_KEY, new Date().toISOString());
  // Store permission version for change detection
  if (staffData.permissionVersion || staffData.lastPermissionUpdate) {
    localStorage.setItem(SESSION_PERMISSION_VERSION_KEY, staffData.permissionVersion || staffData.lastPermissionUpdate);
  }
}

// Update session activity timestamp (call on user actions)
export function refreshSessionActivity() {
  if (localStorage.getItem(SESSION_KEY)) {
    localStorage.setItem(SESSION_TIMESTAMP_KEY, new Date().toISOString());
  }
}

// Clear staff session (only on explicit logout)
export function clearStaffSession() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_TIMESTAMP_KEY);
  localStorage.removeItem(SESSION_PERMISSION_VERSION_KEY);
  // Also clear any legacy sessionStorage
  sessionStorage.removeItem(SESSION_KEY);
  // Stop permission listener
  stopPermissionListener();
}

// ==================== REAL-TIME PERMISSION MONITORING ====================

/**
 * Start listening for permission changes on the current user's staff record.
 * If permissions change, the user is notified and logged out.
 */
export function startPermissionListener() {
  const session = getStaffSession();
  if (!session?.id || !db || session.temporary) {
    console.log("Permission listener not started - no valid session");
    return;
  }
  
  // Don't start duplicate listeners
  if (permissionListenerStaffId === session.id && permissionListener) {
    return;
  }
  
  // Stop any existing listener
  stopPermissionListener();
  
  console.log(`🔒 Starting permission listener for staff: ${session.id}`);
  
  const staffRef = ref(db, `staff/${session.id}`);
  
  // Store the initial permission version
  const currentVersion = localStorage.getItem(SESSION_PERMISSION_VERSION_KEY);
  
  permissionListenerStaffId = session.id;
  permissionListener = onValue(staffRef, (snapshot) => {
    if (!snapshot.exists()) {
      // Staff record was deleted - force logout
      console.warn("Staff record deleted - forcing logout");
      handlePermissionChange("deleted", "Your account has been removed by an administrator.");
      return;
    }
    
    const staffData = snapshot.val();
    
    // Check if staff was deactivated
    if (staffData.active === false) {
      console.warn("Staff deactivated - forcing logout");
      handlePermissionChange("deactivated", "Your account has been deactivated.");
      return;
    }
    
    // Check if permission version changed (indicates role/permission update)
    const newVersion = staffData.permissionVersion || staffData.lastPermissionUpdate;
    const storedVersion = localStorage.getItem(SESSION_PERMISSION_VERSION_KEY);
    
    if (newVersion && storedVersion && newVersion !== storedVersion) {
      console.warn("Permissions updated - forcing session refresh");
      handlePermissionChange("updated", "Your permissions have been updated. Please log in again to apply changes.");
      return;
    }
    
    // Check if role changed
    const storedSession = getStaffSession();
    if (storedSession && staffData.role !== storedSession.role) {
      console.warn("Role changed - updating session");
      // Update local session with new role
      storedSession.role = staffData.role;
      storedSession.name = staffData.name || storedSession.name;
      setStaffSession(storedSession);
      
      // If on dashboard, refresh permissions display
      if (typeof window.refreshPermissionsUI === 'function') {
        window.refreshPermissionsUI();
      }
      
      // Show notification
      showPermissionNotification("info", "Your role has been updated to " + staffData.role);
    }
    
  }, (error) => {
    console.error("Permission listener error:", error);
  });
}

/**
 * Stop the permission listener
 */
export function stopPermissionListener() {
  if (permissionListener && permissionListenerStaffId) {
    try {
      const staffRef = ref(db, `staff/${permissionListenerStaffId}`);
      off(staffRef, 'value', permissionListener);
    } catch (e) {
      console.warn("Error stopping permission listener:", e);
    }
    permissionListener = null;
    permissionListenerStaffId = null;
  }
}

/**
 * Handle permission change - show notification and force logout
 */
function handlePermissionChange(type, message) {
  // Stop listener to prevent multiple triggers
  stopPermissionListener();
  
  // Show modal notification
  showPermissionModal(type, message);
  
  // Clear session after a short delay
  setTimeout(() => {
    clearStaffSession();
  }, 500);
}

/**
 * Show permission change modal
 */
function showPermissionModal(type, message) {
  // Remove any existing modal
  const existingModal = document.getElementById('permissionChangeModal');
  if (existingModal) existingModal.remove();
  
  const iconMap = {
    deleted: '🚫',
    deactivated: '⚠️',
    updated: '🔄'
  };
  
  const modal = document.createElement('div');
  modal.id = 'permissionChangeModal';
  modal.className = 'fixed inset-0 z-[100] flex items-center justify-center';
  modal.style.cssText = 'background: rgba(0,0,0,0.9); backdrop-filter: blur(10px);';
  
  modal.innerHTML = `
    <div class="neon-card rounded-2xl w-full max-w-md p-8 mx-4 text-center" style="border-color: rgba(255,0,68,0.5);">
      <div class="text-6xl mb-4">${iconMap[type] || '🔒'}</div>
      <h3 class="font-orbitron text-xl font-bold mb-3" style="color: #ff0044;">Session Ended</h3>
      <p class="text-gray-400 mb-6">${message}</p>
      <button onclick="window.location.href='index.html'" 
        class="w-full px-6 py-3 rounded-lg font-orbitron font-bold transition-all"
        style="background: linear-gradient(135deg, #ff0044, #cc0033); color: #fff;">
        Login Again
      </button>
    </div>
  `;
  
  document.body.appendChild(modal);
}

/**
 * Show a non-blocking notification for minor permission updates
 */
function showPermissionNotification(type, message) {
  // Use the existing notify system if available
  if (typeof window.notifyInfo === 'function') {
    window.notifyInfo(message);
  } else {
    console.log(`[${type}] ${message}`);
  }
}

// ==================== STAFF LOOKUP ====================

// Find staff record by email
export async function getStaffByEmail(email) {
  if (!email) return null;
  
  try {
    const staffRef = ref(db, FB_PATHS.STAFF);
    const snapshot = await get(staffRef);
    
    if (!snapshot.exists()) return null;
    
    const staffData = snapshot.val();
    for (const [id, member] of Object.entries(staffData)) {
      if (member.email?.toLowerCase() === email.toLowerCase()) {
        return { id, ...member };
      }
    }
    return null;
  } catch (error) {
    console.error("Error fetching staff:", error);
    return null;
  }
}

// Create or update staff record on login
export async function handleStaffLogin(email, displayName = null) {
  if (!email) return null;
  
  // If database is not available, create a temporary session
  if (!db) {
    console.warn("Database not available, creating temporary session");
    const tempSession = {
      id: "temp_" + Date.now(),
      email: email.toLowerCase(),
      name: displayName || email.split("@")[0],
      role: "SUPER_ADMIN", // Grant full access when DB is unavailable
      active: true,
      temporary: true
    };
    setStaffSession(tempSession);
    return tempSession;
  }
  
  try {
    let staffRecord = await getStaffByEmail(email);
    
    // If no staff record exists, check if this is the first user (make them super admin)
    if (!staffRecord) {
      const staffRef = ref(db, FB_PATHS.STAFF);
      const snapshot = await get(staffRef);
      
      const isFirstUser = !snapshot.exists() || Object.keys(snapshot.val() || {}).length === 0;
      
      // Create new staff record
      const newStaffRef = ref(db, `staff/${Date.now()}`);
      const newRecord = {
        email: email.toLowerCase(),
        name: displayName || email.split("@")[0],
        role: isFirstUser ? "SUPER_ADMIN" : "STAFF", // First user is super admin
        active: true,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };
      
      await set(newStaffRef, newRecord);
      staffRecord = { id: Date.now().toString(), ...newRecord };
      
      console.log(isFirstUser ? "First user - granted SUPER_ADMIN" : "New staff created with STAFF role");
    } else {
      // Update existing record
      await update(ref(db, `staff/${staffRecord.id}`), {
        active: true,
        lastLogin: new Date().toISOString()
      });
      staffRecord.active = true;
      staffRecord.lastLogin = new Date().toISOString();
    }
    
    // Save to session
    setStaffSession(staffRecord);
    
    // Start real-time permission listener
    startPermissionListener();
    
    // Log activity (non-blocking)
    logStaffActivity("login", "Logged in").catch(err => console.warn("Activity log failed:", err));
    
    return staffRecord;
  } catch (error) {
    console.error("handleStaffLogin error:", error);
    // Create temporary session on error
    const tempSession = {
      id: "temp_" + Date.now(),
      email: email.toLowerCase(),
      name: displayName || email.split("@")[0],
      role: "SUPER_ADMIN",
      active: true,
      temporary: true
    };
    setStaffSession(tempSession);
    return tempSession;
  }
}

// Handle staff logout
export async function handleStaffLogout() {
  const session = getStaffSession();
  
  if (session?.id && db && !session.temporary) {
    try {
      await update(ref(db, `staff/${session.id}`), {
        active: false,
        lastLogout: new Date().toISOString()
      });
      await logStaffActivity("logout", "Logged out");
    } catch (err) {
      console.warn("Logout update failed:", err);
    }
  }
  
  clearStaffSession();
}

// ==================== PERMISSION CHECKS ====================

// Check if current user has permission for a module
export function hasPermission(module) {
  const session = getStaffSession();
  if (!session) return false;
  
  const role = ROLES[session.role];
  if (!role) return false;
  
  // Super admin has all permissions
  if (session.role === "SUPER_ADMIN") return true;
  
  return role.permissions.includes(module);
}

// Get all allowed modules for current user
export function getAllowedModules() {
  const session = getStaffSession();
  if (!session) return [];
  
  const role = ROLES[session.role];
  if (!role) return [];
  
  return role.permissions;
}

// Get current user's role info
export function getCurrentRole() {
  const session = getStaffSession();
  if (!session) return null;
  
  return {
    ...ROLES[session.role],
    key: session.role,
    staffName: session.name,
    staffEmail: session.email
  };
}

// Check if user can perform action based on level
export function canPerformAction(requiredLevel) {
  const session = getStaffSession();
  if (!session) return false;
  
  const role = ROLES[session.role];
  return role && role.level >= requiredLevel;
}

// ==================== ACTIVITY LOGGING ====================

export async function logStaffActivity(type, action, details = "") {
  if (!db) {
    console.warn("Database not available for activity logging");
    return;
  }
  
  const session = getStaffSession();
  
  try {
    const activityRef = ref(db, `activity_log/${Date.now()}`);
    await set(activityRef, {
      type,
      action,
      details,
      admin: session?.email || "Unknown",
      adminName: session?.name || "Unknown",
      role: session?.role || "Unknown",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.warn("Error logging activity:", error);
  }
}

// ==================== UI HELPERS ====================

// Generate role badge HTML
export function getRoleBadge(roleKey, size = "normal") {
  const role = ROLES[roleKey];
  if (!role) return "";
  
  const sizeClasses = size === "small" 
    ? "text-xs px-2 py-0.5" 
    : "text-sm px-3 py-1";
  
  return `
    <span class="${sizeClasses} rounded-full font-orbitron" 
      style="background: ${role.color}20; color: ${role.color}; border: 1px solid ${role.color}50;">
      ${role.icon} ${role.name}
    </span>
  `;
}

// Generate navigation items based on permissions
export function getNavigationItems() {
  const allowed = getAllowedModules();
  
  return allowed
    .filter(mod => MODULE_NAV_MAP[mod])
    .map(mod => ({
      module: mod,
      ...MODULE_NAV_MAP[mod]
    }));
}

// ==================== EXPORTS ====================

// Export to window for global access
window.hasPermission = hasPermission;
window.getCurrentRole = getCurrentRole;
window.logStaffActivity = logStaffActivity;
window.getStaffSession = getStaffSession;
window.clearStaffSession = clearStaffSession;
window.refreshSessionActivity = refreshSessionActivity;
window.startPermissionListener = startPermissionListener;
window.stopPermissionListener = stopPermissionListener;
window.canEditData = canEditData;
window.shouldUsePOSInterface = shouldUsePOSInterface;

// Auto-start permission listener if user is already logged in
// (for page reloads / returning to dashboard)
setTimeout(() => {
  const session = getStaffSession();
  if (session && session.id && !session.temporary) {
    console.log("🔒 Auto-starting permission listener for existing session");
    startPermissionListener();
  }
}, 1000);

