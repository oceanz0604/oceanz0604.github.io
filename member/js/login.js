/**
 * OceanZ Gaming Cafe - Member Login
 */

import { FDB_DATASET_CONFIG, FDB_APP_NAME } from "../../shared/config.js";

// ==================== FIREBASE INIT ====================

let fdbApp = firebase.apps.find(a => a.name === FDB_APP_NAME);
if (!fdbApp) fdbApp = firebase.initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);

const fdbDb = fdbApp.database();

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

  fdbDb.ref("fdb/MEMBERS").once("value")
    .then(snapshot => {
      const members = snapshot.val() || {};
      const match = Object.values(members).find(m =>
        m.USERNAME?.toLowerCase() === username && m.PASSWORD === password
      );

      if (match) {
        sessionStorage.setItem("member", JSON.stringify(match));
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
