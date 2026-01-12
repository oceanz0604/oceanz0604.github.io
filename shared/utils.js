/**
 * OceanZ Gaming Cafe - Shared Utilities
 * 
 * All date/time functions use IST (India Standard Time - UTC+5:30)
 * 
 * Usage:
 *   import { getISTDate, formatDate, getTodayIST } from '../shared/utils.js';
 */

// ==================== TIMEZONE ====================

export const TIMEZONE = "Asia/Kolkata";
export const TIMEZONE_OFFSET = "+05:30";

// ==================== DATE/TIME UTILITIES ====================

/**
 * Get current date/time in IST
 * @param {number} offsetDays - Optional days to add/subtract
 * @returns {Date} Date object adjusted to IST
 */
export function getISTDate(offsetDays = 0) {
  const utc = new Date();
  const ist = new Date(utc.toLocaleString("en-US", { timeZone: TIMEZONE }));
  if (offsetDays !== 0) {
    ist.setDate(ist.getDate() + offsetDays);
  }
  return ist;
}

/**
 * Get today's date in IST as YYYY-MM-DD string
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function getTodayIST() {
  const now = getISTDate();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get current timestamp in IST as ISO string
 * @returns {string} ISO timestamp string
 */
export function getISTTimestamp() {
  return getISTDate().toISOString();
}

/**
 * Get today's date at midnight in IST
 * @returns {Date} Today at 00:00:00 IST
 */
export function getISTToday() {
  const now = getISTDate();
  now.setHours(0, 0, 0, 0);
  return now;
}

/**
 * Get hours in IST from a date (with minutes as decimal)
 * @param {Date|string} date - Date to extract hours from
 * @returns {number} Hours with minutes as decimal in IST
 */
export function getISTHours(date) {
  const d = typeof date === "string" ? new Date(date) : date;
  const istString = d.toLocaleString("en-US", { 
    timeZone: TIMEZONE, 
    hour: "2-digit", 
    minute: "2-digit", 
    hour12: false 
  });
  const [hours, minutes] = istString.split(":").map(Number);
  return hours + minutes / 60;
}

/**
 * Format a date to IST timezone
 * @param {Date|string} date - Date to format
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string in IST
 */
export function formatToIST(date, options = {}) {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d)) return "-";
  
  const defaultOptions = {
    timeZone: TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
    hour12: true
  };
  
  return d.toLocaleString("en-IN", { ...defaultOptions, ...options });
}

/**
 * Format ISO date string to readable format in IST
 * @param {string} isoString - ISO date string
 * @param {Object} options - Formatting options
 * @returns {string} Formatted date string
 */
export function formatDate(isoString, options = {}) {
  const date = new Date(isoString);
  if (isNaN(date)) return "-";
  return date.toLocaleString("en-IN", {
    timeZone: TIMEZONE,
    dateStyle: options.dateStyle || "medium",
    timeStyle: options.timeStyle || "short",
    hour12: true,
    ...options
  });
}

/**
 * Format time (HH:MM) to 12-hour format
 * @param {string} time24 - Time in HH:MM format
 * @returns {string} Time in 12-hour format
 */
export function formatTime12h(time24) {
  if (!time24) return "-";
  const [hour, min] = time24.split(":").map(Number);
  const displayHour = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${displayHour}:${String(min).padStart(2, "0")} ${ampm}`;
}

/**
 * Get relative time string (e.g., "5 mins ago")
 * @param {string} isoString - ISO date string
 * @returns {string} Relative time string
 */
export function getRelativeTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/**
 * Check if a date is within N minutes of now
 * @param {string} isoString - ISO date string
 * @param {number} minutes - Number of minutes
 * @returns {boolean} True if within the time range
 */
export function isWithinMinutes(isoString, minutes) {
  const date = new Date(isoString);
  const now = new Date();
  return (now - date) < minutes * 60 * 1000;
}

// ==================== DURATION & PRICE UTILITIES ====================

/**
 * Calculate price based on duration and PC count
 * @param {string} startTime - Start time in HH:MM format
 * @param {string} endTime - End time in HH:MM format
 * @param {number} pcCount - Number of PCs
 * @param {number} ratePerHour - Hourly rate (default: 40)
 * @returns {number} Calculated price
 */
export function calculatePrice(startTime, endTime, pcCount = 1, ratePerHour = 40) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let hours = (eh + em / 60) - (sh + sm / 60);
  if (hours <= 0) hours += 24;
  return Math.round(hours * pcCount * ratePerHour);
}

/**
 * Calculate duration in minutes between two times
 * @param {string} startTime - Start time (ISO string or HH:MM)
 * @param {string} endTime - End time (ISO string or HH:MM)
 * @returns {number} Duration in minutes
 */
export function calculateDuration(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  return (end - start) / (1000 * 60);
}

/**
 * Convert minutes to human-readable format
 * @param {number} mins - Minutes
 * @returns {string} Human-readable duration
 */
export function minutesToReadable(mins) {
  const hours = mins / 60;
  return hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(mins)}m`;
}

// ==================== MEMBER & ACTIVITY UTILITIES ====================

/**
 * Get activity icon based on note content
 * @param {string} note - Activity note
 * @returns {string} Emoji icon
 */
export function getActivityIcon(note) {
  if (!note) return "ℹ️";
  const n = note.toLowerCase();
  if (n.includes("created")) return "🆕";
  if (n.includes("deposited")) return "💰";
  if (n.includes("withdrawn")) return "📤";
  if (n.includes("started")) return "🎮";
  if (n.includes("closed")) return "🛑";
  return "ℹ️";
}

/**
 * Generate avatar URL from username
 * @param {string} username - Member username
 * @returns {string} Avatar URL
 */
export function getAvatarUrl(username) {
  return `https://api.dicebear.com/7.x/thumbs/svg?seed=${username}`;
}

/**
 * Filter data to current month only (using IST)
 * @param {Object} dataMap - Object with date keys
 * @returns {Object} Filtered data
 */
export function filterToCurrentMonth(dataMap) {
  const now = getISTDate();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return Object.fromEntries(
    Object.entries(dataMap).filter(([date]) => date.startsWith(thisMonth))
  );
}

/**
 * Calculate streak from history entries
 * @param {Array} historyEntries - Array of history entries with DATE field
 * @returns {number} Streak count
 */
export function calculateStreak(historyEntries) {
  const dateSet = new Set();
  const todayStr = getISTDate(0).toISOString().split("T")[0];
  
  historyEntries.forEach(entry => {
    if (entry.DATE !== todayStr) {
      dateSet.add(entry.DATE);
    }
  });

  let streak = 0;
  let day = getISTDate(-1);

  while (dateSet.has(day.toISOString().split("T")[0])) {
    streak++;
    day.setDate(day.getDate() - 1);
  }

  return streak;
}

// ==================== GENERAL UTILITIES ====================

/**
 * Debounce function for input handlers
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * Escape HTML for safe display
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format currency in INR
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
export function formatCurrency(amount) {
  return `₹${(amount || 0).toLocaleString("en-IN")}`;
}

/**
 * Get time until a future timestamp
 * @param {string} isoString - Future ISO timestamp
 * @returns {string} Time until string
 */
export function getTimeUntil(isoString) {
  const target = new Date(isoString);
  const now = new Date();
  const diffMs = target - now;
  
  if (diffMs <= 0) return "now";
  
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  
  if (diffSecs < 60) return `${diffSecs}s`;
  return `${diffMins}m ${diffSecs % 60}s`;
}
