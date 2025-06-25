import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, query, orderByChild, equalTo, get, off } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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
const membersRef = ref(db, "fdb/MEMBERS");

// UI elements
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
const navBookings = document.getElementById("nav-bookings");
const dashboardSection = document.getElementById("dashboard-section");
const bookingsSection = document.getElementById("bookings-section");

let rawData = [];
let autoRefreshInterval = null;

// View switching
function switchView(view) {
  const activeClass = ["bg-gray-700", "text-white", "font-semibold"];
  const inactiveClass = ["text-gray-300"];

  if (view === "dashboard") {
    dashboardSection.classList.remove("hidden");
    bookingsSection.classList.add("hidden");

    navDashboard.classList.add(...activeClass);
    navDashboard.classList.remove(...inactiveClass);

    navBookings.classList.remove(...activeClass);
    navBookings.classList.add(...inactiveClass);
  } else if (view === "bookings") {
    dashboardSection.classList.add("hidden");
    bookingsSection.classList.remove("hidden");

    navBookings.classList.add(...activeClass);
    navBookings.classList.remove(...inactiveClass);

    navDashboard.classList.remove(...activeClass);
    navDashboard.classList.add(...inactiveClass);
  }
}

// Navigation handlers
navDashboard?.addEventListener("click", (e) => {
  e.preventDefault();
  switchView("dashboard");
});
navBookings?.addEventListener("click", (e) => {
  e.preventDefault();
  switchView("bookings");
});

// Login
loginBtn?.addEventListener("click", () => {
  const email = emailInput.value;
  const password = passwordInput.value;
  signInWithEmailAndPassword(auth, email, password)
    .then(() => {
      loginError.classList.add("hidden");
    })
    .catch(err => {
      loginError.textContent = "Invalid email or password";
      loginError.classList.remove("hidden");
    });
});

// Logout
logoutBtn?.addEventListener("click", () => {
  signOut(auth).then(() => {
    dashboardSection.classList.add("hidden");
    bookingsSection.classList.add("hidden");

    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }

    off(terminalsRef); // remove Firebase listener

    navDashboard?.classList.remove("border-blue-500", "text-white", "font-semibold");
    navDashboard?.classList.add("text-gray-300");

    navBookings?.classList.remove("border-blue-500", "text-white", "font-semibold");
    navBookings?.classList.add("text-gray-300");
  });
});

// Auth state
onAuthStateChanged(auth, (user) => {
  if (user) {
    loginView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    switchView("dashboard");
    startDataSync();
  } else {
    loginView.classList.remove("hidden");
    dashboardView.classList.add("hidden");
    dashboardSection?.classList.add("hidden");
    bookingsSection?.classList.add("hidden");
  }
});

function formatTime(timestamp) {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  return isNaN(date) ? "-" : date.toLocaleString();
}

function calculateDuration(startTimestamp) {
  if (!startTimestamp) return { text: "-", minutes: 0 };
  const now = Date.now();
  const diffMs = now - new Date(startTimestamp).getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return { text: `${hours}h ${mins}m`, minutes };
}

async function getMemberById(memberId) {
  try {
    const q = query(membersRef, orderByChild("ID"), equalTo(memberId));
    const snapshot = await get(q);
    if (snapshot.exists()) return Object.values(snapshot.val())[0];
    return null;
  } catch (err) {
    console.error("Error fetching member:", err);
    return null;
  }
}

function renderTerminals(data) {
  const now = new Date();
  timestampEl.textContent = "Last updated: " + now.toLocaleString("en-IN");

  const groups = { "T-room": [], "CT-room": [], "PS/XBOX": [] };

  for (const [name, info] of Object.entries(data)) {
    const group =
      name.includes("CT") ? "CT-room" :
      name.includes("T-") ? "T-room" : "PS/XBOX";
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
      const lastUpdated = new Date(terminal.last_updated);
      const ageMinutes = Math.floor((Date.now() - lastUpdated.getTime()) / 60000);
      const isStale = ageMinutes > 5;

      const bgColor = isOccupied ? "bg-gray-700 text-white" : "bg-gray-200 text-black";
      const glowBorder = isStale ? "border-4 border-yellow-400" : "border-2 border-blue-400";
      const shadowClass = "shadow-lg hover:shadow-xl hover:scale-[1.01] transition";

      const card = document.createElement("div");
      card.className = `
        p-4 rounded-2xl ${shadowClass} ${bgColor} ${glowBorder}
        relative break-words
      `;

      const statusBadge = `
        <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide
          ${isOccupied ? "bg-red-500 text-white" : "bg-green-500 text-white"}">
          ${terminal.status}
        </span>
      `;

      const statusIcon = isOccupied
        ? `<i data-lucide="x-circle" class="w-5 h-5 text-red-400"></i>`
        : `<i data-lucide="check-circle" class="w-5 h-5 text-green-500"></i>`;

      card.innerHTML = `
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-xl font-bold truncate">${terminal.name}</h2>
          ${statusIcon}
        </div>

        <p class="text-sm mb-1"><strong>Status:</strong> ${statusBadge}</p>
        <p class="text-sm mb-1"><strong>IP:</strong> ${terminal.ip || "-"}</p>
        <p class="text-sm mb-1"><strong>MAC:</strong> ${terminal.mac || "-"}</p>
        <p class="text-sm"><strong>Last Updated:</strong> ${lastUpdated.toLocaleString("en-IN")}</p>

        ${
          isStale
            ? `<div class="absolute top-2 right-2 bg-yellow-400 text-black text-xs px-2 py-1 rounded shadow stale-alert">
                ⚠ ${ageMinutes} min old
              </div>`
            : ""
        }
      `;

      grid.appendChild(card);
    });

    section.appendChild(grid);
    groupContainer.appendChild(section);
  }

  // Refresh lucide icons inside dynamic content
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
    rawData = Object.entries(terminalsData).map(([name, info]) => ({ name, ...info }));
    renderTerminals(terminalsData);
  });
}
