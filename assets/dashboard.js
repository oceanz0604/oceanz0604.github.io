import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  query,
  orderByChild,
  equalTo,
  get,
  off
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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
const terminalsRef = ref(db, "status");
const sessionsRef = ref(db, "sessions");
const membersRef = ref(db, "fdb/MEMBERS");

const timestampEl = document.getElementById("timestamp");
const groupContainer = document.getElementById("group-container");
const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const navDashboard = document.getElementById("nav-dashboard");
const navMembers = document.getElementById("nav-members");
const navBookings = document.getElementById("nav-bookings");
const dashboardSection = document.getElementById("dashboard-section");
const bookingsSection = document.getElementById("bookings-section");
const navHistory = document.getElementById("nav-history");
const historySection = document.getElementById("history-section");
const membersSection = document.getElementById("members-section");

let activeSessions = {};
let autoRefreshInterval = null;

function loadAllMembers() {
  const container = document.getElementById("membersList");
  container.innerHTML = "🔄 Loading...";
  get(membersRef).then(snapshot => {
    if (!snapshot.exists()) {
      container.innerHTML = "<p>No members found.</p>";
      return;
    }
    const members = Object.values(snapshot.val());
    container.innerHTML = members.map(member => `
      <div class="bg-gray-800 p-4 rounded-xl shadow-md border border-gray-700 hover:shadow-lg transition">
        <div class="flex justify-between items-center mb-2">
          <h3 class="text-lg font-bold text-yellow-400">${member.NAME}</h3>
          <span class="text-xs bg-blue-600 text-white px-2 py-1 rounded">${member.USERNAME}</span>
        </div>
        <p class="text-sm text-gray-300">📧 ${member.EMAIL || "-"}</p>
        <p class="text-sm text-gray-300">🕐 Joined: ${member.RECDATE || "-"}</p>
        <p class="text-sm text-gray-300">🎮 Last Active: ${member.LLOGDATE || "-"}</p>
      </div>
    `).join("");
  });
}

function switchView(view) {
  const activeClass = ["bg-gray-700", "text-white", "font-semibold"];
  const inactiveClass = ["text-gray-300"];

  const allSections = [dashboardSection, bookingsSection, historySection, membersSection];
  const allNavs = [navDashboard, navBookings, navHistory, navMembers];

  allSections.forEach(sec => sec?.classList.add("hidden"));
  allNavs.forEach(nav => {
    nav?.classList.remove(...activeClass);
    nav?.classList.add(...inactiveClass);
  });

  if (view === "dashboard") {
    dashboardSection?.classList.remove("hidden");
    navDashboard?.classList.add(...activeClass);
    navDashboard?.classList.remove(...inactiveClass);
  } else if (view === "bookings") {
    bookingsSection?.classList.remove("hidden");
    navBookings?.classList.add(...activeClass);
    navBookings?.classList.remove(...inactiveClass);
  } else if (view === "history") {
    historySection?.classList.remove("hidden");
    navHistory?.classList.add(...activeClass);
    navHistory?.classList.remove(...inactiveClass);
  } else if (view === "members-section") {
    membersSection?.classList.remove("hidden");
    navMembers?.classList.add(...activeClass);
  }
}

navDashboard?.addEventListener("click", (e) => {
  e.preventDefault();
  switchView("dashboard");
});
navMembers?.addEventListener("click", () => {
  switchView("members-section");
  loadAllMembers();
});
navBookings?.addEventListener("click", (e) => {
  e.preventDefault();
  switchView("bookings");
});
navHistory?.addEventListener("click", (e) => {
  e.preventDefault();
  switchView("history");
});
loginBtn?.addEventListener("click", () => {
  const email = emailInput.value;
  const password = passwordInput.value;
  signInWithEmailAndPassword(auth, email, password)
    .then(() => loginError.classList.add("hidden"))
    .catch(() => {
      loginError.textContent = "Invalid email or password";
      loginError.classList.remove("hidden");
    });
});
logoutBtn?.addEventListener("click", () => {
  signOut(auth).then(() => {
    dashboardSection.classList.add("hidden");
    bookingsSection.classList.add("hidden");
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    off(terminalsRef);
    off(sessionsRef);
  });
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    switchView("dashboard");
    startDataSync();
  } else {
    loginView.classList.remove("hidden");
    dashboardView.classList.add("hidden");
  }
});

function toggleSidebar() {
  const sidebar = document.getElementById("mobile-sidebar");
  const overlay = document.getElementById("sidebar-overlay");

  const isOpen = sidebar.classList.contains("translate-x-0");

  if (isOpen) {
    sidebar.classList.replace("translate-x-0", "-translate-x-full");
    overlay.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
  } else {
    sidebar.classList.replace("-translate-x-full", "translate-x-0");
    overlay.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
  }
}

function parseActiveSessions(snapshot) {
  const sessions = snapshot.val() || {};
  const latest = {};
  for (const [key, session] of Object.entries(sessions)) {
    if (session.active) {
      latest[session.terminal] = session;
    }
  }
  activeSessions = latest;
}

function renderTerminals(data) {
  timestampEl.textContent = "Last updated: " + new Date().toLocaleString("en-IN");

  const groups = {
    "T-ROOM": [],
    "CT-ROOM": [],
    "PS/XBOX": []
  };

  for (const [name, info] of Object.entries(data)) {
    const group =
      name.includes("CT") ? "CT-ROOM" :
      name.includes("T-") ? "T-ROOM" : "PS/XBOX";
    groups[group].push({ name, ...info });
  }

  groupContainer.innerHTML = "";

  for (const [groupName, terminals] of Object.entries(groups)) {
    const section = document.createElement("section");
    section.innerHTML = `<h2 class="text-2xl font-semibold mb-4 border-b border-gray-600 pb-1">${groupName}</h2>`;

    const grid = document.createElement("div");
    grid.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4";

    terminals.sort((a, b) => a.name.localeCompare(b.name)).forEach(terminal => {
      const isOccupied = terminal.status === "occupied";
      const session = activeSessions[terminal.name];
      const lastUpdated = new Date(terminal.last_updated);
      const ageMinutes = Math.floor((Date.now() - lastUpdated.getTime()) / 60000);
      const isStale = ageMinutes > 5;
      const duration = session ? Math.round(session.duration_minutes) : null;

      const bgColor = isOccupied ? "bg-gray-800 text-white" : "bg-gray-200 text-black";
      const borderGlow = session ? "border-4 border-blue-400 animate-pulse" : "border border-gray-500";
      const card = document.createElement("div");

      card.className = `
        p-4 rounded-2xl relative ${bgColor} ${borderGlow}
        shadow-md hover:shadow-xl transition
      `;

      const statusBadge = `
        <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide
          ${isOccupied ? "bg-red-500 text-white" : "bg-green-600 text-white"}">
          ${terminal.status}
        </span>
      `;

      const durationBadge = session
        ? `<span class="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full ml-2">🕒 ${duration}m</span>`
        : "";

      const statusIcon = isOccupied
        ? `<i data-lucide="x-circle" class="w-5 h-5 text-red-500"></i>`
        : `<i data-lucide="check-circle" class="w-5 h-5 text-green-500"></i>`;

      card.innerHTML = `
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-xl font-bold truncate">${terminal.name}</h2>
          ${statusIcon}
        </div>

        <p class="text-sm mb-1"><strong>Status:</strong> ${statusBadge} ${durationBadge}</p>
        <p class="text-sm mb-1"><strong>IP:</strong> ${terminal.ip || "-"}</p>
        <p class="text-sm mb-1"><strong>MAC:</strong> ${terminal.mac || "-"}</p>
        <p class="text-sm"><strong>Last Updated:</strong> ${lastUpdated.toLocaleString("en-IN")}</p>

        ${
          isStale
            ? `<div class="absolute top-2 right-2 bg-yellow-400 text-black text-xs px-2 py-1 rounded shadow stale-alert">
                ⚠ ${ageMinutes} min old
              </div>` : ""
        }
      `;

      grid.appendChild(card);
    });

    section.appendChild(grid);
    groupContainer.appendChild(section);
  }

  lucide.createIcons();
}

function startDataSync() {
  fetchData(); // Initial
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  autoRefreshInterval = setInterval(fetchData, 30000);
}

function fetchData() {
  onValue(terminalsRef, (snapshot) => {
    const terminalsData = snapshot.val() || {};
    renderTerminals(terminalsData);
  });

  onValue(sessionsRef, (snapshot) => {
    parseActiveSessions(snapshot);
  });
}
