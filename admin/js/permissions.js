/**
 * OceanZ Gaming Cafe - Permissions System
 * Role-based access control for admin panel
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get, set, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { BOOKING_DB_CONFIG, BOOKING_APP_NAME } from "../../shared/config.js";

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
    permissions: ["dashboard", "bookings", "recharges", "members", "history", "analytics", "staff", "settings"]
  },
  ADMIN: {
    name: "Admin",
    level: 80,
    color: "#b829ff",
    icon: "⚡",
    permissions: ["dashboard", "bookings", "recharges", "members", "history", "analytics"]
  },
  MANAGER: {
    name: "Manager",
    level: 60,
    color: "#00f0ff",
    icon: "🎯",
    permissions: ["dashboard", "bookings", "recharges", "members"]
  },
  STAFF: {
    name: "Staff",
    level: 40,
    color: "#00ff88",
    icon: "🎮",
    permissions: ["dashboard", "bookings", "recharges"]
  }
};

// Module to navigation mapping
export const MODULE_NAV_MAP = {
  dashboard: { name: "Dashboard", icon: "monitor", view: "dashboard" },
  bookings: { name: "Bookings", icon: "calendar", view: "bookings" },
  recharges: { name: "Recharges", icon: "indian-rupee", view: "recharges" },
  members: { name: "Members", icon: "users", view: "members" },
  history: { name: "History", icon: "history", view: "history" },
  analytics: { name: "Analytics", icon: "bar-chart-3", view: "analytics" },
  staff: { name: "Staff", icon: "shield", view: "staff" }
};

// ==================== STAFF SESSION ====================

const SESSION_KEY = "oceanz_staff_session";
const SESSION_TIMESTAMP_KEY = "oceanz_staff_session_time";
const SESSION_MAX_AGE_DAYS = 7; // Session expires after 7 days of inactivity

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
  // Also clear any legacy sessionStorage
  sessionStorage.removeItem(SESSION_KEY);
}

// ==================== STAFF LOOKUP ====================

// Find staff record by email
export async function getStaffByEmail(email) {
  if (!email) return null;
  
  try {
    const staffRef = ref(db, "staff");
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
      const staffRef = ref(db, "staff");
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

