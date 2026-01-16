/**
 * OceanZ Gaming Cafe - Member Login
 */

import { FDB_DATASET_CONFIG, FDB_APP_NAME, FB_PATHS } from "../../shared/config.js";

// ==================== FIREBASE INIT ====================

let fdbApp = firebase.apps.find(a => a.name === FDB_APP_NAME);
if (!fdbApp) fdbApp = firebase.initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);

const fdbDb = fdbApp.database();

// ==================== MEMBER SESSION (localStorage for PWA persistence) ====================

const MEMBER_SESSION_KEY = "oceanz_member_session";
const MEMBER_SESSION_TIME_KEY = "oceanz_member_session_time";
const SESSION_MAX_AGE_DAYS = 7; // Session expires after 7 days

function getMemberSession() {
  try {
    const data = localStorage.getItem(MEMBER_SESSION_KEY);
    if (!data) return null;
    
    // Check if session has expired
    const timestamp = localStorage.getItem(MEMBER_SESSION_TIME_KEY);
    if (timestamp) {
      const lastActivity = new Date(timestamp);
      const now = new Date();
      const daysSinceActivity = (now - lastActivity) / (1000 * 60 * 60 * 24);
      
      if (daysSinceActivity > SESSION_MAX_AGE_DAYS) {
        console.log("Member session expired due to inactivity");
        clearMemberSession();
        return null;
      }
    }
    
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function setMemberSession(memberData) {
  localStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify(memberData));
  localStorage.setItem(MEMBER_SESSION_TIME_KEY, new Date().toISOString());
  // Also set in sessionStorage for backward compatibility
  sessionStorage.setItem("member", JSON.stringify(memberData));
}

function clearMemberSession() {
  localStorage.removeItem(MEMBER_SESSION_KEY);
  localStorage.removeItem(MEMBER_SESSION_TIME_KEY);
  sessionStorage.removeItem("member");
}

// Export for use in other files
window.getMemberSession = getMemberSession;
window.setMemberSession = setMemberSession;
window.clearMemberSession = clearMemberSession;

// ==================== CHECK EXISTING SESSION ====================

// If already logged in, redirect to dashboard
const existingSession = getMemberSession();
if (existingSession) {
  console.log("✅ Existing member session found:", existingSession.USERNAME);
  window.location.replace("dashboard.html");
}

// ==================== LOGIN HANDLER ====================

document.getElementById("memberLoginForm")?.addEventListener("submit", function(e) {
  e.preventDefault();

  const username = document.getElementById("username").value.trim().toLowerCase();
  const password = document.getElementById("password").value.trim();
  const errorDiv = document.getElementById("login-error");

  if (!username || !password) {
    showError(errorDiv, "⚠ Please enter both username and password.");
    return;
  }

  // V2: Single-member lookup /members/{username} - much more efficient!
  fdbDb.ref(`${FB_PATHS.MEMBERS}/${username}`).once("value")
    .then(snapshot => {
      const memberData = snapshot.val();
      
      if (!memberData) {
        showError(errorDiv, "❌ Invalid credentials. Please try again.");
        return;
      }
      
      const profile = memberData.profile || {};
      const storedPassword = profile.PASSWORD || "";
      
      if (storedPassword === password) {
        // Build session object from V2 structure
        const sessionData = {
          USERNAME: username,
          DISPLAY_NAME: profile.DISPLAY_NAME || username,
          FIRSTNAME: profile.FIRSTNAME || "",
          LASTNAME: profile.LASTNAME || "",
          RECDATE: profile.RECDATE || "",
          BALANCE: memberData.balance?.current_balance || 0,
          TOTALACTMINUTE: memberData.stats?.total_minutes || 0
        };
        setMemberSession(sessionData);
        window.location.href = "dashboard.html";
      } else {
        showError(errorDiv, "❌ Invalid credentials. Please try again.");
      }
    })
    .catch(err => {
      console.error("Login failed:", err);
      showError(errorDiv, "🔥 Error connecting to database.");
    });
});

function showError(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}
