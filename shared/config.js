/**
 * OceanZ Gaming Cafe - Shared Configuration
 * All Firebase configs and app constants in one place
 */

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
 * FDB Dataset Database (fdb-dataset)
 * Used for: Members, Sessions, History, Terminal Status
 */
export const FDB_DATASET_CONFIG = {
  apiKey: "AIzaSyCaC558bQ7mhYlhjmthvZZX9SBVvNe6wYg",
  authDomain: "fdb-dataset.firebaseapp.com",
  databaseURL: "https://fdb-dataset-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "fdb-dataset",
  storageBucket: "fdb-dataset.appspot.com",
  messagingSenderId: "497229278574",
  appId: "1:497229278574:web:c8f127aad76b8ed004657f",
  measurementId: "G-4FLTSGLWBR"
};

// ==================== FIREBASE APP NAMES ====================

export const BOOKING_APP_NAME = "OCEANZ_BOOKING";
export const FDB_APP_NAME = "OCEANZ_FDB";
export const AUTH_APP_NAME = "OCEANZ_AUTH";

// ==================== APP CONSTANTS ====================

export const CONSTANTS = {
  // PC Names for booking
  ALL_PCS: [
    "T1", "T2", "T3", "T4", "T5", "T6", "T7",
    "CT1", "CT2", "CT3", "CT4", "CT5", "CT6", "CT7"
  ],
  
  // PC Names for timetable display
  TIMETABLE_PCS: [
    "CT-ROOM-1", "CT-ROOM-2", "CT-ROOM-3", "CT-ROOM-4", "CT-ROOM-5", "CT-ROOM-6", "CT-ROOM-7",
    "T-ROOM-1", "T-ROOM-2", "T-ROOM-3", "T-ROOM-4", "T-ROOM-5", "T-ROOM-6", "T-ROOM-7",
    "PS", "XBOX ONE X"
  ],
  
  // Pricing
  RATE_PER_HOUR: 40,
  MIN_BOOKING_HOURS: 1,
  
  // Operating hours
  OPERATING_HOURS: { start: 10, end: 22 },
  
  // Timetable settings
  TIMETABLE_START_HOUR: 10,
  TIMETABLE_END_HOUR: 22,
  PC_COL_WIDTH: 140
};

// Legacy exports for backward compatibility
export const PRIMARY_CONFIG = BOOKING_DB_CONFIG;
export const SECONDARY_CONFIG = FDB_DATASET_CONFIG;
