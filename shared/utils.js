/**
 * OceanZ Gaming Cafe - Shared Utilities
 * All date/time functions use IST (India Standard Time - UTC+5:30)
 */

import { TIMEZONE } from "./config.js";

/**
 * Get current date in IST with optional offset
 */
export function getISTDate(offsetDays = 0) {
  const utc = new Date();
  const ist = new Date(utc.toLocaleString("en-US", { timeZone: TIMEZONE }));
  ist.setDate(ist.getDate() + offsetDays);
  return ist;
}

/**
 * Format ISO date string to readable format in IST
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
 */
export function formatTime12h(time24) {
  const [hour, min] = time24.split(":").map(Number);
  const displayHour = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${displayHour}:${min.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * Calculate price based on duration and PC count
 */
export function calculatePrice(startTime, endTime, pcCount, ratePerHour = 40) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let hours = (eh + em / 60) - (sh + sm / 60);
  if (hours <= 0) hours += 24;
  return Math.round(hours * pcCount * ratePerHour);
}

/**
 * Calculate duration in minutes between two times
 */
export function calculateDuration(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  return (end - start) / (1000 * 60);
}

/**
 * Convert minutes to human-readable format
 */
export function minutesToReadable(mins) {
  const hours = mins / 60;
  return hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(mins)}m`;
}

/**
 * Get activity icon based on note content
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
 */
export function getAvatarUrl(username) {
  return `https://api.dicebear.com/7.x/thumbs/svg?seed=${username}`;
}

/**
 * Filter data to current month only (using IST)
 */
export function filterToCurrentMonth(dataMap) {
  const now = getISTDate();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return Object.fromEntries(
    Object.entries(dataMap).filter(([date]) => date.startsWith(thisMonth))
  );
}

/**
 * Calculate streak from history entries
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

/**
 * Debounce function for input handlers
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

