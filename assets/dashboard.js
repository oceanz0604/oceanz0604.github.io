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
const terminalsRef = ref(db, "fdb/TERMINALS");
const membersRef = ref(db, "fdb/MEMBERS");

// UI elements
const timestampEl = document.getElementById("timestamp");
const groupContainer = document.getElementById("group-container");
const searchInput = document.getElementById("search");
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

// Search
searchInput?.addEventListener("input", applySearch);

function applySearch() {
  const query = searchInput.value.toLowerCase();
  const filtered = rawData.filter(t =>
    t.NAME?.toLowerCase().includes(query) || t.MEMBERID?.toLowerCase().includes(query)
  );
  render(filtered);
}

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

function render(data) {
  const now = new Date();
  timestampEl.textContent = "Last updated: " + now.toLocaleString();

  const groups = { "T-room": [], "CT-room": [], "PS/XBOX": [] };
  data.forEach(t => {
    const name = t.NAME?.toUpperCase() || "";
    if (name.includes("CT-")) groups["CT-room"].push(t);
    else if (name.includes("T-")) groups["T-room"].push(t);
    else if (name.includes("PS") || name.includes("XBOX")) groups["PS/XBOX"].push(t);
  });

  groupContainer.innerHTML = "";

  for (const [groupName, terminals] of Object.entries(groups)) {
    const section = document.createElement("section");
    section.innerHTML = `<h2 class="text-2xl font-semibold mb-4 border-b border-gray-600 pb-1">${groupName}</h2>`;

    const grid = document.createElement("div");
    grid.className = "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4";

    terminals
      .sort((a, b) => a.NAME.localeCompare(b.NAME))
      .forEach((terminal) => {
        const isOccupied = terminal.TERMINALSTATUS === 1;
        const { text: durationText, minutes: durationMinutes } = calculateDuration(terminal.STARTDATE + "T" + terminal.STARTTIME);
        const longSession = isOccupied && durationMinutes > 120;

        const card = document.createElement("div");
        card.className = `p-4 rounded-2xl shadow-lg ${
          isOccupied ? "bg-red-600" : "bg-green-600"
        } text-white transition hover:scale-[1.01] ${longSession ? "alert" : ""}`;

        getMemberById(terminal.MEMBERID).then((member) => {
          const username = member?.USERNAME || "Guest";
          card.innerHTML = `
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-bold">${terminal.NAME}</h2>
              <span class="text-2xl">${isOccupied ? "🔴" : "🟢"}</span>
            </div>
            <p class="mt-1 text-sm">Status: <strong>${isOccupied ? "Occupied" : "Available"}</strong></p>
            <p class="text-sm">User: <b>${username}</b></p>
            <p class="text-sm">Start Time: ${formatTime(terminal.STARTDATE + "T" + terminal.STARTTIME)}</p>
            <p class="text-sm">Duration: ${durationText}</p>
            <p class="text-sm">Session Price: ₹${terminal.SESSIONPRICE || terminal.MEMBERSESSIONPRICE || 0}</p>
          `;
          grid.appendChild(card);
        });
      });

    section.appendChild(grid);
    groupContainer.appendChild(section);
  }
}

function startDataSync() {
  fetchData(); // Initial
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  autoRefreshInterval = setInterval(fetchData, 30000);
}

function fetchData() {
  onValue(terminalsRef, (snapshot) => {
    rawData = Object.values(snapshot.val() || {});
    applySearch();
  });
}
