import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  get,
  off
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ---------------- FIREBASE CONFIG ---------------- */

const firebaseConfig = {
  apiKey: "AIzaSyCaC558bQ7mhYlhjmthvZZX9SBVvNe6wYg",
  authDomain: "fdb-dataset.firebaseapp.com",
  databaseURL: "https://fdb-dataset-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "fdb-dataset",
  storageBucket: "fdb-dataset.appspot.com",
  messagingSenderId: "497229278574",
  appId: "1:497229278574:web:c8f127aad76b8ed004657f",
  measurementId: "G-4FLTSGLWBR"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

/* ---------------- DATABASE REFS ---------------- */

const terminalsRef = ref(db, "status");
const sessionsRef = ref(db, "sessions");
const membersRef = ref(db, "fdb/MEMBERS");

/* ---------------- DOM ELEMENTS ---------------- */

const timestampEl = document.getElementById("timestamp");
const groupContainer = document.getElementById("group-container");

const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");

/* Sidebar navs */
const navDashboard = document.getElementById("nav-dashboard");
const navMembers = document.getElementById("nav-members");
const navBookings = document.getElementById("nav-bookings");
const navHistory = document.getElementById("nav-history");
const navRecharges = document.getElementById("nav-recharges");

/* Sections */
const dashboardSection = document.getElementById("dashboard-section");
const membersSection = document.getElementById("members-section");
const bookingsSection = document.getElementById("bookings-section");
const historySection = document.getElementById("history-section");
const rechargesSection = document.getElementById("recharges-section");

/* ---------------- STATE ---------------- */

let activeSessions = {};
let autoRefreshInterval = null;
let rechargesLoaded = false;

/* ---------------- VIEW SWITCHER ---------------- */

function switchView(view) {
  const activeClass = ["bg-gray-700", "text-white", "font-semibold"];
  const inactiveClass = ["text-gray-300"];

  const sections = [
    dashboardSection,
    membersSection,
    bookingsSection,
    historySection,
    rechargesSection
  ];

  const navs = [
    navDashboard,
    navMembers,
    navBookings,
    navHistory,
    navRecharges
  ];

  sections.forEach(s => s?.classList.add("hidden"));
  navs.forEach(n => {
    n?.classList.remove(...activeClass);
    n?.classList.add(...inactiveClass);
  });

  if (view === "dashboard") {
    dashboardSection.classList.remove("hidden");
    navDashboard.classList.add(...activeClass);
  }

  if (view === "members") {
    membersSection.classList.remove("hidden");
    navMembers.classList.add(...activeClass);
    loadAllMembers();
  }

  if (view === "bookings") {
    bookingsSection.classList.remove("hidden");
    navBookings.classList.add(...activeClass);
  }

  if (view === "history") {
    historySection.classList.remove("hidden");
    navHistory.classList.add(...activeClass);
  }

  if (view === "recharges") {
    rechargesSection.classList.remove("hidden");
    navRecharges.classList.add(...activeClass);
  }
}

/* ---------------- NAV EVENTS ---------------- */

navDashboard?.addEventListener("click", e => {
  e.preventDefault();
  switchView("dashboard");
});

navMembers?.addEventListener("click", e => {
  e.preventDefault();
  switchView("members");
});

navBookings?.addEventListener("click", e => {
  e.preventDefault();
  switchView("bookings");
});

navHistory?.addEventListener("click", e => {
  e.preventDefault();
  switchView("history");
});

navRecharges?.addEventListener("click", e => {
  e.preventDefault();
  switchView("recharges");
});

/* ---------------- AUTH ---------------- */

loginBtn?.addEventListener("click", () => {
  signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value)
    .then(() => loginError.classList.add("hidden"))
    .catch(() => {
      loginError.textContent = "Invalid email or password";
      loginError.classList.remove("hidden");
    });
});

logoutBtn?.addEventListener("click", () => {
  signOut(auth).then(() => {
    dashboardView.classList.add("hidden");
    loginView.classList.remove("hidden");

    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    off(terminalsRef);
    off(sessionsRef);
  });
});

onAuthStateChanged(auth, user => {
  if (user) {
    loginView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    switchView("dashboard");
    startDataSync();
  } else {
    dashboardView.classList.add("hidden");
    loginView.classList.remove("hidden");
  }
});

/* ---------------- MEMBERS ---------------- */

function loadAllMembers() {
  const container = document.getElementById("membersList");
  container.innerHTML = "🔄 Loading...";

  get(membersRef).then(snapshot => {
    if (!snapshot.exists()) {
      container.innerHTML = "No members found";
      return;
    }

    const members = Object.values(snapshot.val());

    container.innerHTML = members.map(m => `
      <div class="bg-gray-800 p-4 rounded-xl border border-gray-700">
        <h3 class="font-bold text-yellow-400">${m.NAME}</h3>
        <p class="text-sm text-gray-300">@${m.USERNAME}</p>
        <p class="text-xs text-gray-400">Joined: ${m.RECDATE || "-"}</p>
      </div>
    `).join("");
  });
}

/* ---------------- TERMINALS ---------------- */

function parseActiveSessions(snapshot) {
  const sessions = snapshot.val() || {};
  const latest = {};
  Object.values(sessions).forEach(s => {
    if (s.active) latest[s.terminal] = s;
  });
  activeSessions = latest;
}

function renderTerminals(data) {
  timestampEl.textContent =
    "Last updated: " + new Date().toLocaleString("en-IN");

  const groups = { "T-ROOM": [], "CT-ROOM": [], "PS/XBOX": [] };

  Object.entries(data).forEach(([name, info]) => {
    const g = name.includes("CT") ? "CT-ROOM" :
              name.includes("T-") ? "T-ROOM" : "PS/XBOX";
    groups[g].push({ name, ...info });
  });

  groupContainer.innerHTML = "";

  Object.entries(groups).forEach(([group, list]) => {
    const section = document.createElement("section");
    section.innerHTML = `<h2 class="text-2xl font-bold mb-4">${group}</h2>`;

    const grid = document.createElement("div");
    grid.className = "grid sm:grid-cols-2 lg:grid-cols-3 gap-4";

    list.sort((a, b) => a.name.localeCompare(b.name)).forEach(t => {
      const session = activeSessions[t.name];
      const occupied = t.status === "occupied";

      grid.innerHTML += `
        <div class="p-4 rounded-xl border ${occupied ? "border-red-500" : "border-green-500"}">
          <h3 class="text-xl font-bold">${t.name}</h3>
          <p>Status: ${t.status}</p>
          ${session ? `<p>🕒 ${Math.round(session.duration_minutes)} min</p>` : ""}
        </div>
      `;
    });

    section.appendChild(grid);
    groupContainer.appendChild(section);
  });
}

/* ---------------- DATA SYNC ---------------- */

function startDataSync() {
  fetchData();
  autoRefreshInterval = setInterval(fetchData, 30000);
}

function fetchData() {
  onValue(terminalsRef, snap => renderTerminals(snap.val() || {}));
  onValue(sessionsRef, parseActiveSessions);
}
