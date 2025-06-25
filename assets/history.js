import {
  getDatabase,
  ref,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

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
const sessionsRef = ref(db, "sessions");

const historyContainer = document.getElementById("history-cards");

function groupAndSortSessions(sessions, isActive = false) {
  const grouped = {};

  sessions
    .filter(s => s.active === isActive)
    .forEach(session => {
      const key = session.terminal || "Unknown";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(session);
    });

  const sortedTerminals = Object.keys(grouped).sort(); // sort terminal names alphabetically

  const sortedSessions = [];

  sortedTerminals.forEach(terminal => {
    const sortedByTime = grouped[terminal].sort(
      (a, b) => new Date(b.start) - new Date(a.start)
    );
    sortedSessions.push(...sortedByTime);
  });

  return sortedSessions;
}

function renderSessions(sessions) {
  if (!historyContainer) return;
  historyContainer.innerHTML = "";

  const sessionList = Object.entries(sessions).map(([id, data]) => ({
    id,
    ...data,
  }));

  const activeSessions = groupAndSortSessions(sessionList, true);
  const pastSessions = groupAndSortSessions(sessionList, false);

  const createSection = (title, sessions) => {
    const section = document.createElement("section");
    section.className = "mb-8";
    section.innerHTML = `<h2 class="text-2xl font-semibold mb-4">${title}</h2>`;

    const grid = document.createElement("div");
    grid.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4";

    sessions.forEach((data) => {
      const start = new Date(data.start).toLocaleString("en-IN");
      const end = data.end ? new Date(data.end).toLocaleString("en-IN") : "-";
      const duration = data.duration_minutes?.toFixed(1) || "-";
      const terminal = data.terminal || "-";
      const ip = data.ip || "-";
      const mac = data.mac || "-";

      const card = document.createElement("div");
      card.className =
        "bg-gray-800 border border-gray-700 rounded-2xl p-4 shadow hover:shadow-lg transition text-sm space-y-2";

      card.innerHTML = `
        <h3 class="text-lg font-semibold text-blue-400">${terminal}</h3>
        <p><strong>Start:</strong> ${start}</p>
        <p><strong>End:</strong> ${end}</p>
        <p><strong>Duration:</strong> ${duration} mins</p>
        <p><strong>IP:</strong> ${ip}</p>
        <p><strong>MAC:</strong> ${mac}</p>
        ${
          data.active
            ? `<span class="inline-block text-xs bg-yellow-400 text-black px-2 py-0.5 rounded">ACTIVE</span>`
            : ""
        }
      `;

      grid.appendChild(card);
    });

    section.appendChild(grid);
    historyContainer.appendChild(section);
  };

  if (activeSessions.length > 0) createSection("Active Sessions", activeSessions);
  if (pastSessions.length > 0) createSection("Past Sessions", pastSessions);
}

// Realtime listener
onValue(sessionsRef, (snapshot) => {
  const data = snapshot.val() || {};
  renderSessions(data);
});
