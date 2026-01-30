/**
 * OceanZ Gaming Cafe - Shared Configuration
 * 
 * All Firebase configs and app constants in one place.
 * IMPORTANT: Keep Firebase paths in sync with scripts/config.py
 * 
 * Usage:
 *   import { BOOKING_DB_CONFIG, FB_PATHS, CONSTANTS } from '../shared/config.js';
 */

// Re-export utilities from utils.js for backward compatibility
export { 
  getISTDate, 
  getTodayIST,
  getISTTimestamp,
  getISTToday, 
  getISTHours,
  formatToIST, 
  formatDate,
  formatTime12h,
  getRelativeTime,
  isWithinMinutes,
  TIMEZONE, 
  TIMEZONE_OFFSET 
} from "./utils.js";

// ==================== FIREBASE CONFIGS ====================

/**
 * Booking Database (gaming-cafe-booking)
 * Used for: Bookings, Recharges, Admin Authentication
 */
export const BOOKING_DB_CONFIG = {
  apiKey: "AIzaSyAc0Gz1Em0TUeGnKD4jQjZl5fn_FyoWCLo",
  authDomain: "gaming-cafe-booking-630f9.firebaseapp.com",
  databaseURL: "https://gaming-cafe-booking-630f9-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "gaming-cafe-booking-630f9",
  storageBucket: "gaming-cafe-booking-630f9.firebasestorage.app",
  messagingSenderId: "872841235480",
  appId: "1:872841235480:web:58cfe4fc38cc8a037b076d",
  measurementId: "G-PSLG65XMBT"
};

/**
 * FDB Dataset Database (oceanz-fdb)
 * Used for: Members, Sessions, History, Terminal Status
 */
export const FDB_DATASET_CONFIG = {
  apiKey: "AIzaSyB-DKTtleay44TXjFH0inqAFMztdy7JB1E",
  authDomain: "oceanz-fdb.firebaseapp.com",
  databaseURL: "https://oceanz-fdb-default-rtdb.firebaseio.com",
  projectId: "oceanz-fdb",
  storageBucket: "oceanz-fdb.firebasestorage.app",
  messagingSenderId: "67265567513",
  appId: "1:67265567513:web:25595b8adf10aa3d7c8388"
};

// ==================== FIREBASE APP NAMES ====================

export const BOOKING_APP_NAME = "OCEANZ_BOOKING";
export const FDB_APP_NAME = "OCEANZ_FDB";
export const AUTH_APP_NAME = "OCEANZ_AUTH";

// ==================== FIREBASE DATA PATHS ====================
// Keep in sync with scripts/config.py FB_PATHS class

export const FB_PATHS = {
  // Core FDB Dataset paths (PanCafe data)
  MEMBERS: "members",                         // /members/{USERNAME}
  HISTORY: "history",                         // /history/{USERNAME}/{ID}
  SESSIONS: "sessions",                       // /sessions/{SESSION_ID}
  SESSIONS_BY_MEMBER: "sessions-by-member",   // /sessions-by-member/{MEMBER_ID}/{SESSION_ID}
  TERMINAL_STATUS: "terminal-status",         // /terminal-status/{TERMINAL_NAME}
  
  // Optimized query paths (pre-aggregated data)
  HISTORY_BY_DATE: "history-by-date",         // /history-by-date/{YYYY-MM-DD}/{ID}
  DAILY_SUMMARY: "daily-summary",             // /daily-summary/{YYYY-MM-DD}
  MONTHLY_SUMMARY: "monthly-summary",         // /monthly-summary/{YYYY-MM}
  
  // Leaderboards (pre-computed)
  LEADERBOARDS: "leaderboards",               // /leaderboards/all-time, /monthly/{YYYY-MM}, /weekly/{YYYY-Wxx}
  
  // Guest sessions (from messages.msg parsing)
  GUEST_SESSIONS: "guest-sessions",           // /guest-sessions/{YYYY-MM-DD}/{terminal_time}
  
  // Sync metadata
  SYNC_META: "sync-meta",                     // /sync-meta/{script_name}
  
  // Sync control (for remote sync triggering)
  SYNC_CONTROL: "sync-control",               // /sync-control/
  SYNC_REQUEST: "sync-control/request",       // Write timestamp to trigger sync
  SYNC_STATUS: "sync-control/status",         // idle, syncing, completed, error
  SYNC_PROGRESS: "sync-control/progress",     // Array of progress messages
  SYNC_LAST: "sync-control/last_sync",        // Last sync info
  SYNC_HEARTBEAT: "sync-control/service_heartbeat", // Service health check
  
  // Cash Register & Revenue (from KASAHAR table)
  CASH_REGISTER_FDB: "cash-register",         // /cash-register/{YYYY-MM-DD} - transactions
  DAILY_REVENUE: "daily-revenue",             // /daily-revenue/{YYYY-MM-DD} - daily summaries
  
  // Legacy paths (for backward compatibility)
  LEGACY_MEMBERS: "fdb/MEMBERS",              // Old: /fdb/MEMBERS (array format)
  LEGACY_STATUS: "status",                    // Old: /status/{terminal}
  
  // ==================== BOOKING DATABASE PATHS ====================
  // These paths are in the booking-db (gaming-cafe-booking) database
  
  BOOKINGS: "bookings",                       // /bookings/{booking_id}
  RECHARGES: "recharges",                     // /recharges/{YYYY-MM-DD}/{entry_id}
  CASH_REGISTER: "cash_register",             // /cash_register/{YYYY-MM-DD}
  RECHARGE_AUDIT: "recharge_audit",           // /recharge_audit/{audit_id}
  STAFF: "staff",                             // /staff/{staff_id}
  ACTIVITY_LOG: "activity_log",               // /activity_log/{log_id}
  
  // Finance Dashboard (Expenses & Summaries)
  EXPENSES: "expenses",                       // /expenses/{YYYY-MM-DD}/{expense_id}
  EXPENSE_AUDIT: "expense_audit",             // /expense_audit/{audit_id}
  FINANCE_MONTHLY: "finance_monthly",         // /finance_monthly/{YYYY-MM} - cached monthly summaries
  
  // Food Sales (separate from gaming recharges)
  FOOD_MENU: "food_menu",                     // /food_menu/{item_id} - menu items with prices
  FOOD_SALES: "food_sales",                   // /food_sales/{YYYY-MM-DD}/{sale_id} - daily sales
  FOOD_CREDITS: "food_credits",               // /food_credits/{customer_id} - outstanding credits
  FOOD_CREDIT_PAYMENTS: "food_credit_payments" // /food_credit_payments/{YYYY-MM-DD}/{payment_id}
};

// ==================== APP CONSTANTS ====================

export const CONSTANTS = {
  // PC Names for booking (short format)
  ALL_PCS: [
    "T1", "T2", "T3", "T4", "T5", "T6", "T7",
    "CT1", "CT2", "CT3", "CT4", "CT5", "CT6", "CT7"
  ],
  
  // PC Names for timetable display (PanCafe format)
  TIMETABLE_PCS: [
    "CT-ROOM-1", "CT-ROOM-2", "CT-ROOM-3", "CT-ROOM-4", "CT-ROOM-5", "CT-ROOM-6", "CT-ROOM-7",
    "T-ROOM-1", "T-ROOM-2", "T-ROOM-3", "T-ROOM-4", "T-ROOM-5", "T-ROOM-6", "T-ROOM-7",
    "PS", "XBOX ONE X"
  ],
  
  // Guest terminals (no member account - for recharge entries)
  GUEST_TERMINALS: [
    "CT-ROOM-1", "CT-ROOM-2", "CT-ROOM-3", "CT-ROOM-4", "CT-ROOM-5", "CT-ROOM-6", "CT-ROOM-7",
    "T-ROOM-1", "T-ROOM-2", "T-ROOM-3", "T-ROOM-4", "T-ROOM-5", "T-ROOM-6", "T-ROOM-7",
    "PS", "XBOX ONE X"
  ],
  
  // Pricing per device type
  RATE_PER_HOUR: 40,  // Default PC rate
  RATES: {
    PC: 40,
    XBOX: 60,
    PS: 100
  },
  
  // Available devices for booking
  DEVICES: [
    { id: 'PC', name: 'Gaming PC', rate: 40, icon: '🖥️' },
    { id: 'XBOX', name: 'Xbox', rate: 60, icon: '🎮' },
    { id: 'PS', name: 'PlayStation', rate: 100, icon: '🕹️' }
  ],
  
  MIN_BOOKING_HOURS: 1,
  
  // Operating hours
  OPERATING_HOURS: { start: 10, end: 22 },
  
  // Timetable settings
  TIMETABLE_START_HOUR: 10,
  TIMETABLE_END_HOUR: 22,
  PC_COL_WIDTH: 140
};

// ==================== TERMINAL UTILITIES ====================
// Keep in sync with scripts/config.py terminal functions

/**
 * Terminal name aliases for normalization
 */
const TERMINAL_ALIASES = {
  "PLAYSTATION": "PS",
  "XBOX": "XBOX ONE X",
  "PS5": "PS",
  "XBOX ONE": "XBOX ONE X"
};

/**
 * Normalize terminal name for consistent matching.
 * @param {string} name - Terminal name in any format
 * @returns {string} Normalized terminal name (PanCafe format)
 * 
 * @example
 * normalizeTerminalName("CT1") // "CT-ROOM-1"
 * normalizeTerminalName("ct-room-1") // "CT-ROOM-1"
 * normalizeTerminalName("XBOX") // "XBOX ONE X"
 */
export function normalizeTerminalName(name) {
  if (!name) return null;
  
  name = String(name).toUpperCase().trim();
  
  // Check aliases
  if (TERMINAL_ALIASES[name]) {
    return TERMINAL_ALIASES[name];
  }
  
  // Convert short format to PanCafe format
  const ctMatch = name.match(/^CT(\d+)$/);
  if (ctMatch) {
    return `CT-ROOM-${ctMatch[1]}`;
  }
  
  const tMatch = name.match(/^T(\d+)$/);
  if (tMatch) {
    return `T-ROOM-${tMatch[1]}`;
  }
  
  // Check if it's already a known terminal
  for (const terminal of CONSTANTS.TIMETABLE_PCS) {
    if (terminal.toUpperCase() === name) {
      return terminal;
    }
  }
  
  return name;
}

/**
 * Get shortened terminal name for display.
 * @param {string} name - Terminal name in PanCafe format
 * @returns {string} Short display name
 * 
 * @example
 * getShortTerminalName("CT-ROOM-1") // "CT1"
 * getShortTerminalName("T-ROOM-5") // "T5"
 * getShortTerminalName("XBOX ONE X") // "XBOX"
 */
export function getShortTerminalName(name) {
  if (!name) return "";
  
  name = String(name).toUpperCase().trim();
  
  if (name.startsWith("CT-ROOM-")) {
    return `CT${name.replace("CT-ROOM-", "")}`;
  }
  if (name.startsWith("T-ROOM-")) {
    return `T${name.replace("T-ROOM-", "")}`;
  }
  if (name === "XBOX ONE X") {
    return "XBOX";
  }
  
  return name;
}

/**
 * Check if a terminal name represents a guest session.
 * Guest sessions don't have member accounts in PanCafe.
 * @param {string} name - Terminal name
 * @returns {boolean} True if it's a guest terminal
 * 
 * Valid guest terminals: CT1-CT7, T1-T7, PS, XBOX
 */
export function isGuestTerminal(name) {
  if (!name) return false;
  
  const upper = name.toUpperCase().trim();
  
  // Check for exact matches first
  if (upper === "PS" || upper === "XBOX" || upper === "XBOX ONE X" || upper === "PLAYSTATION") {
    return true;
  }
  
  // Check for CT-ROOM-X or CTX format (CT1-CT7)
  if (/^CT-?ROOM-?\d+$/i.test(upper) || /^CT\d+$/i.test(upper)) {
    return true;
  }
  
  // Check for T-ROOM-X or TX format (T1-T7) - but NOT names like "TATYAINCHU"
  // Must be exactly "T" followed by a number, or "T-ROOM-" followed by a number
  if (/^T-?ROOM-?\d+$/i.test(upper) || /^T\d+$/i.test(upper)) {
    return true;
  }
  
  return false;
}

// ==================== OPTIMIZED PATHS (V2) ====================
// For single-key lookups and pre-computed data

export const FB_PATHS_V2 = {
  // Member data (single-key lookup) - /members/{username}/{ profile, balance, stats, ranks, badges, recent_history, recent_sessions }
  MEMBERS: "members",
  MEMBER: (username) => `members/${username}`,
  MEMBER_PROFILE: (username) => `members/${username}/profile`,
  MEMBER_BALANCE: (username) => `members/${username}/balance`,
  MEMBER_STATS: (username) => `members/${username}/stats`,
  MEMBER_RANKS: (username) => `members/${username}/ranks`,
  MEMBER_BADGES: (username) => `members/${username}/badges`,
  MEMBER_RECENT_HISTORY: (username) => `members/${username}/recent_history`,
  MEMBER_RECENT_SESSIONS: (username) => `members/${username}/recent_sessions`,
  
  // Terminals (real-time status with session embedded)
  TERMINALS: "terminals",
  TERMINAL: (name) => `terminals/${name}`,
  
  // Leaderboards (pre-computed, ready to render)
  LEADERBOARD_ALL_TIME: "leaderboards/all-time",
  LEADERBOARD_MONTHLY: (month) => `leaderboards/monthly/${month}`,  // YYYY-MM
  LEADERBOARD_WEEKLY: (week) => `leaderboards/weekly/${week}`,      // YYYY-Wxx
  
  // Daily stats (pre-computed analytics)
  DAILY_STATS: "daily-stats",
  DAILY_STAT: (date) => `daily-stats/${date}`,  // YYYY-MM-DD
  
  // History archive (full history, rarely needed)
  HISTORY_ARCHIVE: "history-archive",
  HISTORY_MONTH: (month, username) => `history-archive/${month}/${username}`,
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Get current month key (YYYY-MM)
 */
export function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get current week key (YYYY-Wxx)
 */
export function getCurrentWeekKey() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil((((now - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Get today's date key (YYYY-MM-DD)
 */
export function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

// ==================== CACHING UTILITIES ====================

/**
 * Generic cache class for Firebase data
 * Usage: 
 *   const myCache = new DataCache(5 * 60 * 1000); // 5 min TTL
 *   if (myCache.isValid()) return myCache.data;
 *   myCache.set(newData);
 */
export class DataCache {
  constructor(ttl = 5 * 60 * 1000) {
    this.data = null;
    this.timestamp = 0;
    this.ttl = ttl;
  }
  
  isValid() {
    return this.data !== null && (Date.now() - this.timestamp < this.ttl);
  }
  
  set(data) {
    this.data = data;
    this.timestamp = Date.now();
  }
  
  invalidate() {
    this.data = null;
    this.timestamp = 0;
  }
}

// ==================== SHARED GLOBAL CACHE ====================
// These caches are shared across ALL admin pages to avoid duplicate downloads

/**
 * Helper: Fetch data from Firebase (supports both modular and compat SDK)
 * @param {object} dbWrapper - Object with { ref, get } for modular SDK or compat database
 * @param {string} path - Firebase path
 * @returns {Promise<object>} Snapshot data
 */
async function fetchFirebaseData(dbWrapper, path) {
  try {
    // Check if it's modular SDK style (has get function at wrapper level)
    if (typeof dbWrapper.get === 'function' && typeof dbWrapper.ref === 'function') {
      console.log(`🔌 SharedCache: Using modular SDK for path: ${path}`);
      const dbRef = dbWrapper.ref(path);
      const snap = await dbWrapper.get(dbRef);
      return snap.val() || {};
    }
    
    // Compat SDK style - Database object with .ref().once()
    if (typeof dbWrapper.ref === 'function') {
      const testRef = dbWrapper.ref(path);
      if (typeof testRef.once === 'function') {
        console.log(`🔌 SharedCache: Using compat SDK for path: ${path}`);
        const snap = await testRef.once("value");
        return snap.val() || {};
      }
    }
    
    // Debug info for failed detection
    console.error("SharedCache: Could not detect SDK type", {
      hasRef: typeof dbWrapper.ref,
      hasGet: typeof dbWrapper.get,
      path
    });
    throw new Error("SharedCache: Invalid database wrapper - must have { ref, get } or compat SDK");
  } catch (error) {
    console.error(`❌ SharedCache: Failed to fetch ${path}:`, error.message);
    throw error;
  }
}

/**
 * Global shared cache for expensive Firebase data.
 * Shared across all admin pages (dashboard, counter, recharges, analytics).
 * 
 * Usage (Modular SDK - Firebase v10+):
 *   import { getDatabase, ref, get } from "firebase/database";
 *   const db = getDatabase(app);
 *   const dbWrapper = { ref: (path) => ref(db, path), get };
 *   const members = await SharedCache.getMembers(dbWrapper, FB_PATHS.MEMBERS);
 * 
 * Usage (Compat SDK):
 *   const db = firebase.database();
 *   const members = await SharedCache.getMembers(db, FB_PATHS.MEMBERS);
 */
export const SharedCache = {
  // Members cache (5 min TTL) - shared across all admin pages
  _membersCache: new DataCache(5 * 60 * 1000),
  _membersPromise: null,
  
  // Recharges cache (3 min TTL) - shared across recharges, analytics, cash-register
  _rechargesCache: new DataCache(3 * 60 * 1000),
  _rechargesPromise: null,
  
  /**
   * Get all members from Firebase with caching.
   * Returns V2 structure: array of { profile, balance, stats, ... }
   * @param {object} dbWrapper - Firebase database wrapper { ref, get } or compat db
   * @param {string} path - Firebase path (FB_PATHS.MEMBERS)
   * @returns {Promise<Array>} Array of member objects
   */
  async getMembers(dbWrapper, path = "members") {
    // Return cached data if valid
    if (this._membersCache.isValid()) {
      console.log("📦 SharedCache: Using cached members data");
      return this._membersCache.data;
    }
    
    // If already fetching, wait for that promise
    if (this._membersPromise) {
      console.log("⏳ SharedCache: Waiting for pending members fetch");
      return this._membersPromise;
    }
    
    // Fetch from Firebase
    console.log("🔄 SharedCache: Fetching members from Firebase");
    this._membersPromise = fetchFirebaseData(dbWrapper, path)
      .then(rawData => {
        // Convert V2 structure to array
        const members = Object.entries(rawData).map(([username, memberData]) => {
          const profile = memberData.profile || {};
          return {
            username,
            id: profile.ID,
            USERNAME: profile.USERNAME || username,
            FIRSTNAME: profile.FIRSTNAME || "",
            LASTNAME: profile.LASTNAME || "",
            DISPLAY_NAME: profile.DISPLAY_NAME || profile.USERNAME || username,
            EMAIL: profile.EMAIL || "",
            PHONE: profile.PHONE || "",
            RECDATE: profile.RECDATE || "",
            MEMBERSTATE: profile.MEMBERSTATE || 0,
            PASSWORD: profile.PASSWORD || "",
            // Include balance and stats for convenience
            balance: memberData.balance || {},
            stats: memberData.stats || {},
            ranks: memberData.ranks || {},
            badges: memberData.badges || {},
          };
        });
        
        this._membersCache.set(members);
        this._membersPromise = null;
        console.log(`✅ SharedCache: Loaded ${members.length} members`);
        return members;
      })
      .catch(err => {
        this._membersPromise = null;
        console.error("❌ SharedCache: Failed to load members", err);
        throw err;
      });
    
    return this._membersPromise;
  },
  
  /**
   * Get all recharges from Firebase with caching.
   * @param {object} dbWrapper - Firebase database wrapper { ref, get } or compat db
   * @param {string} path - Firebase path (FB_PATHS.RECHARGES)
   * @returns {Promise<Object>} Recharges data keyed by date
   */
  async getRecharges(dbWrapper, path = "recharges") {
    // Return cached data if valid
    if (this._rechargesCache.isValid()) {
      console.log("📦 SharedCache: Using cached recharges data");
      return this._rechargesCache.data;
    }
    
    // If already fetching, wait for that promise
    if (this._rechargesPromise) {
      console.log("⏳ SharedCache: Waiting for pending recharges fetch");
      return this._rechargesPromise;
    }
    
    // Fetch from Firebase
    console.log("🔄 SharedCache: Fetching recharges from Firebase");
    this._rechargesPromise = fetchFirebaseData(dbWrapper, path)
      .then(data => {
        this._rechargesCache.set(data);
        this._rechargesPromise = null;
        console.log(`✅ SharedCache: Loaded recharges for ${Object.keys(data).length} dates`);
        return data;
      })
      .catch(err => {
        this._rechargesPromise = null;
        console.error("❌ SharedCache: Failed to load recharges", err);
        throw err;
      });
    
    return this._rechargesPromise;
  },
  
  /**
   * Invalidate members cache (call after adding/editing member)
   */
  invalidateMembers() {
    this._membersCache.invalidate();
    this._membersPromise = null;
    console.log("🗑️ SharedCache: Members cache invalidated");
  },
  
  /**
   * Invalidate recharges cache (call after adding/editing recharge)
   */
  invalidateRecharges() {
    this._rechargesCache.invalidate();
    this._rechargesPromise = null;
    console.log("🗑️ SharedCache: Recharges cache invalidated");
  },
  
  /**
   * Get raw members data (V2 structure as-is from Firebase)
   * @param {object} dbWrapper - Firebase database wrapper { ref, get } or compat db
   * @param {string} path - Firebase path (FB_PATHS.MEMBERS)
   * @returns {Promise<Object>} Raw members data keyed by username
   */
  async getMembersRaw(dbWrapper, path = "members") {
    if (this._membersCache.isValid()) {
      // Convert back to raw format - this is a bit wasteful but maintains compatibility
      const raw = {};
      this._membersCache.data.forEach(m => {
        raw[m.username] = {
          profile: {
            ID: m.id,
            USERNAME: m.USERNAME,
            FIRSTNAME: m.FIRSTNAME,
            LASTNAME: m.LASTNAME,
            DISPLAY_NAME: m.DISPLAY_NAME,
            EMAIL: m.EMAIL,
            PHONE: m.PHONE,
            RECDATE: m.RECDATE,
            MEMBERSTATE: m.MEMBERSTATE,
            PASSWORD: m.PASSWORD,
          },
          balance: m.balance,
          stats: m.stats,
          ranks: m.ranks,
          badges: m.badges,
        };
      });
      return raw;
    }
    
    // Fetch fresh and return raw format
    const data = await fetchFirebaseData(dbWrapper, path);
    
    // Also populate the parsed cache
    const members = Object.entries(data).map(([username, memberData]) => {
      const profile = memberData.profile || {};
      return {
        username,
        id: profile.ID,
        USERNAME: profile.USERNAME || username,
        FIRSTNAME: profile.FIRSTNAME || "",
        LASTNAME: profile.LASTNAME || "",
        DISPLAY_NAME: profile.DISPLAY_NAME || profile.USERNAME || username,
        EMAIL: profile.EMAIL || "",
        PHONE: profile.PHONE || "",
        RECDATE: profile.RECDATE || "",
        MEMBERSTATE: profile.MEMBERSTATE || 0,
        PASSWORD: profile.PASSWORD || "",
        balance: memberData.balance || {},
        stats: memberData.stats || {},
        ranks: memberData.ranks || {},
        badges: memberData.badges || {},
      };
    });
    this._membersCache.set(members);
    
    return data;
  }
};

// Legacy exports for backward compatibility
export const PRIMARY_CONFIG = BOOKING_DB_CONFIG;
export const SECONDARY_CONFIG = FDB_DATASET_CONFIG;
