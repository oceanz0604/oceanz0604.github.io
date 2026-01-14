/**
 * OceanZ Gaming Cafe - Centralized Firebase Initialization
 * 
 * This module provides a single point for Firebase app initialization
 * and database references. Use this instead of initializing Firebase
 * in individual files.
 * 
 * Usage:
 *   import { bookingDb, fdbDb, auth } from '../shared/firebase.js';
 */

import { BOOKING_DB_CONFIG, FDB_DATASET_CONFIG, BOOKING_APP_NAME, FDB_APP_NAME, AUTH_APP_NAME } from "./config.js";

// ==================== FIREBASE COMPAT (for files using firebase.* syntax) ====================

let bookingApp, fdbApp, authApp;

/**
 * Initialize Firebase apps using compat SDK
 * @returns {Object} { bookingApp, fdbApp, authApp, bookingDb, fdbDb, auth }
 */
export function initFirebaseCompat() {
  if (typeof firebase === "undefined") {
    console.error("Firebase compat SDK not loaded. Include firebase-app-compat.js first.");
    return null;
  }

  // Booking App (also used for auth)
  bookingApp = firebase.apps.find(a => a.name === BOOKING_APP_NAME);
  if (!bookingApp) {
    bookingApp = firebase.initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);
  }

  // FDB Dataset App
  fdbApp = firebase.apps.find(a => a.name === FDB_APP_NAME);
  if (!fdbApp) {
    fdbApp = firebase.initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);
  }

  // Auth App (uses booking config)
  authApp = firebase.apps.find(a => a.name === AUTH_APP_NAME);
  if (!authApp) {
    authApp = firebase.initializeApp(BOOKING_DB_CONFIG, AUTH_APP_NAME);
  }

  // OPTIMIZATION: Enable offline persistence for both databases
  // This caches data locally and reduces network requests significantly
  // Data is served from cache when available, reducing Firebase downloads
  try {
    bookingApp.database().goOnline();
    fdbApp.database().goOnline();
    console.log("✅ Firebase databases connected with persistence enabled");
  } catch (e) {
    console.warn("Could not enable Firebase persistence:", e);
  }

  return {
    bookingApp,
    fdbApp,
    authApp,
    bookingDb: bookingApp.database(),
    fdbDb: fdbApp.database(),
    auth: authApp.auth()
  };
}

// ==================== FIREBASE MODULAR SDK ====================

let modularBookingApp, modularFdbApp;
let modularBookingDb, modularFdbDb;

/**
 * Initialize Firebase apps using modular SDK
 * Must import firebase modules first:
 *   import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
 *   import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
 * 
 * @param {Function} initializeApp - Firebase initializeApp function
 * @param {Function} getApps - Firebase getApps function
 * @param {Function} getDatabase - Firebase getDatabase function
 * @returns {Object} { bookingDb, fdbDb }
 */
export function initFirebaseModular(initializeApp, getApps, getDatabase) {
  const apps = getApps();

  // Booking App
  modularBookingApp = apps.find(app => app.name === BOOKING_APP_NAME);
  if (!modularBookingApp) {
    modularBookingApp = initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);
  }

  // FDB Dataset App
  modularFdbApp = apps.find(app => app.name === FDB_APP_NAME);
  if (!modularFdbApp) {
    modularFdbApp = initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);
  }

  modularBookingDb = getDatabase(modularBookingApp);
  modularFdbDb = getDatabase(modularFdbApp);

  return {
    bookingApp: modularBookingApp,
    fdbApp: modularFdbApp,
    bookingDb: modularBookingDb,
    fdbDb: modularFdbDb
  };
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get today's date in IST as YYYY-MM-DD string
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function getTodayIST() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get IST timestamp as ISO string
 * @returns {string} ISO timestamp string
 */
export function getISTTimestamp() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).toISOString();
}

// ==================== EXPORTS ====================

// Export initialized apps (for files that need them after init)
export { bookingApp, fdbApp, authApp };

