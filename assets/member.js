const firebaseConfig = {
  apiKey: "AIzaSyAc0Gz1Em0TUeGnKD4jQjZl5fn_FyoWCLo",
  databaseURL: "https://gaming-cafe-booking-630f9-default-rtdb.asia-southeast1.firebasedatabase.app",
  authDomain: "gaming-cafe-booking-630f9.firebaseapp.com",
  projectId: "gaming-cafe-booking-630f9",
  storageBucket: "gaming-cafe-booking-630f9.appspot.com",
  messagingSenderId: "872841235480",
  appId: "1:872841235480:web:58cfe4fc38cc8a037b076d",
  measurementId: "G-PSLG65XMBT"
};
const secondAppConfig = {
  apiKey: "AIzaSyCaC558bQ7mhYlhjmthvZZX9SBVvNe6wYg",
  authDomain: "fdb-dataset.firebaseapp.com",
  databaseURL: "https://fdb-dataset-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "fdb-dataset",
  storageBucket: "fdb-dataset.appspot.com",
  messagingSenderId: "497229278574",
  appId: "1:497229278574:web:c8f127aad76b8ed004657f",
  measurementId: "G-4FLTSGLWBR"
};
const app = firebase.initializeApp(firebaseConfig);
const db = app.database();
const secondApp = firebase.initializeApp(secondAppConfig, "SECOND_APP");
const secondDb = secondApp.database();

const member = JSON.parse(sessionStorage.getItem("member"));
if (!member) window.location.href = "member-login.html";

const allPCs = ["T1","T2","T3","T4","T5","T6","T7","CT1","CT2","CT3","CT4","CT5","CT6","CT7"];
const now = new Date();
const startSelect = document.getElementById("startTime");
const endSelect = document.getElementById("endTime");
const bookingDate = document.getElementById("bookingDate");
let selectedPCSet = new Set();
let fullDateMap = {};
let fullSpendMap = {};
let pcChart = null;
let sessionChart = null;
let spendChart = null;

function getISTDate(offsetDays = 0) {
    const utc = new Date();
    const ist = new Date(utc.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    ist.setDate(ist.getDate() + offsetDays);
    return ist;
  }

function populateTimeDropdowns() {
  startSelect.innerHTML = "";
  endSelect.innerHTML = "";

  for (let hour = 10; hour <= 22; hour++) {
    // For each hour, add both :00 and :30
    for (let min of [0, 30]) {
      const value = `${hour.toString().padStart(2, "0")}:${min === 0 ? "00" : "30"}`;

      const displayHour = hour % 12 || 12;
      const displayMin = min === 0 ? "00" : "30";
      const ampm = hour < 12 ? "AM" : "PM";
      const label = `${displayHour}:${displayMin} ${ampm}`;

      startSelect.innerHTML += `<option value="${value}">${label}</option>`;
      endSelect.innerHTML += `<option value="${value}">${label}</option>`;
    }
  }

  // Optional: default selections
  startSelect.value = "10:00";
  endSelect.value = "11:00";
}

function loadMemberBookings(memberUsername) {
  const container = document.getElementById("myBookingsList");
  container.innerHTML = "<p class='text-sm text-gray-400'>Loading your bookings...</p>";

  db.ref("bookings").once("value").then(snapshot => {
    const data = snapshot.val();
    if (!data) {
      container.innerHTML = "<p class='text-sm text-gray-400'>No bookings found.</p>";
      return;
    }

    const now = new Date();
    const upcoming = [];
    const ongoing = [];
    const past = [];

    Object.entries(data).forEach(([id, booking]) => {
      if (booking.name !== memberUsername) return;

      const start = new Date(booking.start);
      const end = new Date(booking.end);
      const isUpcoming = start > now;
      const isOngoing = start <= now && end > now;
      const group = isUpcoming ? "upcoming" : isOngoing ? "ongoing" : "past";
      const status = group === "past" ? "Expired" : (booking.status || "Pending");

      const card = document.createElement("div");
      card.className = "booking-card border border-gray-700 bg-gray-900 rounded-xl p-4";

      card.innerHTML = `
        <div class="flex justify-between items-center mb-2">
          <h3 class="text-blue-400 font-semibold">${booking.name}</h3>
          <span class="text-xs font-bold px-2 py-1 rounded-full ${
            status === "Approved"
              ? "bg-green-600 text-white"
              : status === "Declined"
              ? "bg-red-600 text-white"
              : status === "Expired"
              ? "bg-gray-600 text-white"
              : "bg-yellow-500 text-black"
          }">${status}</span>
        </div>
        <div class="text-sm text-gray-300 space-y-1">
          <div><strong>Start:</strong> ${new Date(booking.start).toLocaleString("en-IN")}</div>
          <div><strong>End:</strong> ${new Date(booking.end).toLocaleString("en-IN")}</div>
          <div><strong>Duration:</strong> ${booking.duration} mins</div>
          <div><strong>Terminals:</strong> ${booking.pcs.join(", ")}</div>
          <div><strong>Price:</strong> ₹${booking.price}</div>
          ${booking.note ? `<div><strong>Note:</strong> ${booking.note}</div>` : ""}
        </div>
      `;

      if (group === "upcoming") upcoming.push(card);
      else if (group === "ongoing") ongoing.push(card);
      else past.push(card);
    });

    container.innerHTML = "";
    if (upcoming.length) container.appendChild(createBookingGroup("Upcoming Bookings", upcoming));
    if (ongoing.length) container.appendChild(createBookingGroup("Ongoing Bookings", ongoing));
    if (past.length) container.appendChild(createBookingGroup("Past Bookings", past, true));

    lucide.createIcons();
  });
}

function createBookingGroup(title, cards, collapsed = false) {
  const group = document.createElement("div");
  const contentId = `member-${title.replace(/\s+/g, "-").toLowerCase()}`;

  group.innerHTML = `
    <button onclick="document.getElementById('${contentId}').classList.toggle('hidden')"
      class="w-full flex justify-between items-center bg-gray-700 px-4 py-2 rounded-t-lg text-white font-semibold hover:bg-gray-600">
      <span>${title}</span>
      <i data-lucide="chevron-down" class="w-5 h-5"></i>
    </button>
    <div id="${contentId}" class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-800 p-4 rounded-b-lg ${collapsed ? "hidden" : ""}">
    </div>
  `;

  const content = group.querySelector(`#${contentId}`);
  cards.forEach(card => content.appendChild(card));
  return group;
}

function loadProfile() {
    const profileDiv = document.getElementById("tab-content").querySelector('[data-tab="profile"]');

    document.getElementById("memberName").textContent = `${member.NAME} ${member.LASTNAME}`;
    document.getElementById("memberUsername").textContent = `👤 Username: ${member.USERNAME}`;
    document.getElementById("avatar").src = `https://api.dicebear.com/7.x/thumbs/svg?seed=${member.USERNAME}`;

    const detailList = document.getElementById("memberDetailsList");
    detailList.innerHTML = `
    <li><strong>🆔 Member ID:</strong> ${member.ID ?? 'N/A'}</li>
    <li><strong>💰 Balance:</strong> ₹${member.BAKIYE ?? 0}</li>
    <li><strong>⏱️ Total Active Time:</strong> ${Math.round(member.TOTALACTMINUTE ?? 0)} minutes</li>
    <li><strong>📆 Created On:</strong> ${member.RECDATE ?? 'N/A'}</li>
    `;

    loadRecentActivity(member.USERNAME);
    loadMemberBookings(member.USERNAME);

    secondDb.ref(`history/${member.USERNAME}`).once("value").then(snapshot => {
      const history = snapshot.val() || {};
      const entries = Object.values(history);
      const streak = calculateStreak(entries);
      const streakDiv = document.getElementById("streakInfo");
      if (streakDiv) {
        if (streak >= 2) {
          streakDiv.innerHTML = `<span class="inline-block text-orange-500 text-sm font-semibold">${streak}🔥</span>`;
        } else {
          streakDiv.innerHTML = "";
        }
      }
    });

}

function getMemberSince(member) {
  if (member.RECDATE) {
    try {
      const date = new Date(member.RECDATE);
      return date.toLocaleString("default", { month: "long", year: "numeric" });
    } catch {
      return "Unknown";
    }
  }
  return "Unknown";
}

function calculateStreak(historyEntries) {
  const dateSet = new Set();

  // Collect all unique session dates, ignoring today
  const todayStr = getISTDate(0).toISOString().split("T")[0];
  historyEntries.forEach(entry => {
    const dateStr = entry.DATE;
    if (dateStr !== todayStr) {
      dateSet.add(dateStr);
    }
  });

  let streak = 0;
  let day = getISTDate(-1); // start from yesterday

  while (true) {
    const dateStr = day.toISOString().split("T")[0];
    if (dateSet.has(dateStr)) {
      streak++;
      day.setDate(day.getDate() - 1); // go to previous day
    } else {
      break;
    }
  }

  return streak;
}

async function loadLeaderboard() {
  const membersSnap = await secondDb.ref('fdb/MEMBERS').once("value");
  const historyRef = secondDb.ref("history");
  const members = Object.values(membersSnap.val() || {});
  const now = new Date();

  // Compute leaderboard stats
  const leaderboard = members
    .filter(m => m.TOTALACTMINUTE)
    .sort((a, b) => b.TOTALACTMINUTE - a.TOTALACTMINUTE)
    .slice(0, 10);

  // Get spent for each member
  const historyData = await Promise.all(
    leaderboard.map(async m => {
      const snapshot = await historyRef.child(m.USERNAME).once("value");
      const entries = Object.values(snapshot.val() || {});
      const spent = entries.reduce((sum, h) => sum + (h.CHARGE < 0 ? -h.CHARGE : 0), 0);
      const lastDate = entries
        .map(h => new Date(`${h.DATE}T${h.TIME.split('.')[0]}`))
        .sort((a, b) => b - a)[0];
      const streak = calculateStreak(entries);
      return {
        username: m.USERNAME,
        spent,
        lastDate,
        streak,
      };
    })
  );

  const maxSpent = Math.max(...historyData.map(h => h.spent));
  const maxMinutes = leaderboard[0]?.TOTALACTMINUTE ?? 0;

  const list = document.getElementById("leaderboardList");
  list.innerHTML = "";

  leaderboard.forEach((m, i) => {
    const avatar = `https://api.dicebear.com/7.x/thumbs/svg?seed=${m.USERNAME}`;
    const timeInHours = Math.round(m.TOTALACTMINUTE / 60);
    const since = m.RECDATE ? new Date(m.RECDATE).toLocaleDateString("en-IN", { year: 'numeric', month: 'short' }) : "N/A";

    const { spent, lastDate, streak } = historyData.find(h => h.username === m.USERNAME) || {};
    const isBigSpender = spent === maxSpent;
    const isGrinder = m.TOTALACTMINUTE === maxMinutes;

    // Avatar ring color
    let ringColor = "border-gray-500"; // default
    if (lastDate) {
      const diffDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
      if (diffDays <= 2) ringColor = "border-green-400";
      else if (diffDays <= 7) ringColor = "border-yellow-400";
    }

    // Dynamic badge/title
    let badge = "";
    if (i === 0) badge = "🥇 Champion";
    else if (i === 1) badge = "🥈 Runner Up";
    else if (i === 2) badge = "🥉 Third Place";
    if (isGrinder) badge += (badge ? " • " : "") + "👑 Grinder";
    if (isBigSpender) badge += (badge ? " • " : "") + "🏅 Big Spender";
    if (lastDate) {
      const inactiveDays = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
      if (inactiveDays > 7) badge += (badge ? " • " : "") + "🐢 Ghost";
    }

    const flame = `<span class="animate-pulse text-orange-500">🔥</span>`;
    const streakBadge = streak > 0 ? `
      <span class="text-sm flex items-center gap-1">
      ${flame}<span class="text-orange-400">${streak}-Day Streak</span></span>
    `: "";

    const row = document.createElement("div");
    row.className = "flex items-start justify-between p-4 rounded-xl bg-gray-800";
    row.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between w-full gap-4">
        <!-- Left: Avatar and Info -->
        <div class="flex items-center gap-4 w-full sm:w-auto">
          <img src="${avatar}" class="w-12 h-12 rounded-full border-2 ${ringColor}" />
          <div class="flex flex-col">
            <div class="font-bold text-white flex items-center flex-wrap gap-2">
              ${m.USERNAME}
              ${streakBadge}
            </div>
            <div class="text-sm text-gray-400">
              ⏱️ ${timeInHours} hrs • 🗓️ Since: ${since}
            </div>
            <div class="text-xs text-gray-500">
              Last Active: ${lastDate?.toLocaleDateString("en-IN") || "N/A"}
            </div>
          </div>
        </div>

        <!-- Right: Badges -->
        ${badge
          ? `<div class="flex flex-wrap gap-1 justify-center sm:justify-end text-xs text-yellow-200">
              ${badge.split(" • ").map(b => `
                <span class="inline-block bg-yellow-800 rounded-full px-2 py-0.5 font-medium">
                  ${b}
                </span>
              `).join("")}
            </div>`
          : ""
        }
      </div>
    `;
    list.appendChild(row);
  });
}

function updatePrice() {
  const pcCount = selectedPCSet.size;
  const [sh, sm] = startSelect.value.split(":").map(Number);
  const [eh, em] = endSelect.value.split(":").map(Number);
  let hours = (eh + em / 60) - (sh + sm / 60);
  if (hours <= 0) hours += 24;
  const price = Math.round(hours * pcCount * 40);
  document.getElementById("priceInfo").textContent = `💰 Total Price: ₹${price}`;
}

function fetchUnavailablePCs(start, end, cb) {
  db.ref("bookings").once("value", snap => {
    const bookings = snap.val() || {};
    const unavailable = new Set();
    const selectedDate = document.getElementById("bookingDate").value;
    const startTime = new Date(`${selectedDate}T${start}:00+05:30`);
    const endTime = new Date(`${selectedDate}T${end}:00+05:30`);

    Object.values(bookings).forEach(b => {
      const bStart = new Date(b.start);
      const bEnd = new Date(b.end);
      const overlaps = startTime < bEnd && endTime > bStart;
      if (overlaps) b.pcs.forEach(pc => unavailable.add(pc));
    });
    cb(unavailable);
  });
}

function showPCs() {
  const pcDiv = document.getElementById("availablePCs");
  pcDiv.innerHTML = "";
  selectedPCSet.clear();
  fetchUnavailablePCs(startSelect.value, endSelect.value, (unavailable) => {
    const groups = {
      "T-ROOM": allPCs.filter(pc => pc.startsWith("T")),
      "CT-ROOM": allPCs.filter(pc => pc.startsWith("CT"))
    };
    for (const [groupName, pcs] of Object.entries(groups)) {
      const groupWrapper = document.createElement("div");
      groupWrapper.className = "mb-4";
      const groupTitle = document.createElement("h3");
      groupTitle.textContent = `🎮 ${groupName}`;
      groupTitle.className = "text-white font-bold mb-2";
      groupWrapper.appendChild(groupTitle);
      const grid = document.createElement("div");
      grid.className = "grid grid-cols-2 sm:grid-cols-3 gap-3";
      pcs.forEach(pc => {
        if (!unavailable.has(pc)) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "pc-btn w-full px-4 py-2 rounded bg-gray-700 text-gray-200 hover:bg-blue-600 transition";
          btn.textContent = pc;
          btn.dataset.pc = pc;
          btn.addEventListener("click", () => {
            if (selectedPCSet.has(pc)) {
              selectedPCSet.delete(pc);
              btn.classList.remove("bg-blue-600", "text-white");
              btn.classList.add("bg-gray-700", "text-gray-200");
            } else {
              selectedPCSet.add(pc);
              btn.classList.remove("bg-gray-700", "text-gray-200");
              btn.classList.add("bg-blue-600", "text-white");
            }
            updatePrice();
          });
          grid.appendChild(btn);
        }
      });
      groupWrapper.appendChild(grid);
      pcDiv.appendChild(groupWrapper);
    }
    updatePrice();
  });
}

function loadMemberHistory(username) {
  const list = document.getElementById("memberHistoryList");
  list.innerHTML = `<p class="text-gray-400">⏳ Loading your history...</p>`;

  secondDb.ref(`history/${username}`).once("value").then(snapshot => {
    const history = snapshot.val();

    if (!history || Object.keys(history).length === 0) {
      list.innerHTML = `<p class="text-gray-400">No history available.</p>`;
      return;
    }

    // Sort entries by ID (descending)
    const sortedEntries = Object.values(history).sort((a, b) => b.ID - a.ID);

    list.innerHTML = "";

    sortedEntries.forEach(entry => {
      const div = document.createElement("div");
      div.className = "bg-gray-700 p-4 rounded-lg shadow space-y-1";

      const chargeColor = entry.CHARGE > 0
        ? "text-green-400"
        : entry.CHARGE < 0
        ? "text-red-400"
        : "text-gray-300";

      div.innerHTML = `
        <div class="flex justify-between items-center">
          <span class="font-semibold text-white">${entry.NOTE}</span>
          <span class="text-sm ${chargeColor}">${entry.CHARGE > 0 ? '+' : ''}${entry.CHARGE} ₹</span>
        </div>
        <div class="text-sm text-gray-400">
          ${entry.DATE} ${entry.TIME.split('.')[0]}${entry.TERMINALNAME ? ` | 🖥️ ${entry.TERMINALNAME}` : ""}
        </div>
        <div class="text-xs text-gray-500">Balance: ₹${entry.BALANCE}</div>
      `;

      list.appendChild(div);
    });
  }).catch(err => {
    list.innerHTML = `<p class="text-red-400">⚠️ Failed to load history.</p>`;
    console.error("Error loading history:", err);
  });
}

function loadBookingDates(){
    const today = getISTDate(0);
    const tomorrow = getISTDate(1);
    bookingDate.innerHTML = `
      <option value="${today.toISOString().split('T')[0]}">Today (${today.toDateString().slice(0, 10)})</option>
      <option value="${tomorrow.toISOString().split('T')[0]}">Tomorrow (${tomorrow.toDateString().slice(0, 10)})</option>
    `;
    populateTimeDropdowns();
}

function setupDateButtons() {
  const nowIST = getISTDate();
  const hourIST = nowIST.getHours();

  const dates = [];

  if (hourIST < 21) {
    dates.push(getISTDate()); // Today
    dates.push(getISTDate(1)); // Tomorrow
  } else {
    dates.push(getISTDate(1)); // Tomorrow
    dates.push(getISTDate(2)); // Day After
  }

  const container = document.getElementById("dateButtons");
  const hiddenInput = document.getElementById("bookingDate");
  container.innerHTML = "";

  dates.forEach((d, i) => {
    const label = i === 0 ? "📅 " + (hourIST < 21 ? "Today" : "Tomorrow") : "📅 " + (hourIST < 21 ? "Tomorrow" : "Day After");
    const isoDate = d.toISOString().split("T")[0]; // yyyy-mm-dd

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "date-btn px-4 py-2 rounded bg-gray-700 hover:bg-blue-600 transition-colors";
    btn.dataset.date = isoDate;
    btn.textContent = label;

    btn.addEventListener("click", () => {
      // Remove active class from all
      document.querySelectorAll(".date-btn").forEach(b => {
        b.classList.remove("bg-blue-600", "text-white");
        b.classList.add("bg-gray-700", "text-gray-200");
      });
      // Set active class on this button
      btn.classList.remove("bg-gray-700", "text-gray-200");
      btn.classList.add("bg-blue-600", "text-white");
      // Set hidden input
      hiddenInput.value = isoDate;
    });
    container.appendChild(btn);
  });

  // Auto-select first button
  container.querySelector(".date-btn")?.click();
}

function loadRecentActivity(username) {
  secondDb.ref(`history/${username}`).once("value").then(snapshot => {
    const data = snapshot.val();
    const recentDiv = document.getElementById("recentActivity");

    if (!data || Object.keys(data).length === 0) {
      recentDiv.innerHTML = `<p class="text-gray-400">No recent activity found.</p>`;
      return;
    }

    const entries = Object.values(data).sort((a, b) => b.ID - a.ID).slice(0, 5); // latest 5

    const getIcon = note => {
      if (note.includes("created")) return "🆕";
      if (note.includes("deposited")) return "💰";
      if (note.includes("withdrawn")) return "📤";
      if (note.includes("started")) return "🎮";
      if (note.includes("closed")) return "🛑";
      return "ℹ️";
    };

    recentDiv.innerHTML = entries.map(event => `
      <div class="flex items-start gap-3">
        <div class="text-xl">${getIcon(event.NOTE)}</div>
        <div>
          <div class="text-gray-100">${event.NOTE}</div>
          <div class="text-xs text-gray-400">
            ${event.DATE} @ ${event.TIME.slice(0, 8)} ${event.TERMINALNAME ? `on ${event.TERMINALNAME}` : `Change in balance ₹ ${event.CHARGE}`}</div>
        </div>
      </div>
    `).join("");
  });
}

function filterToCurrentMonth(dataMap) {
  const thisMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  return Object.fromEntries(
    Object.entries(dataMap).filter(([date, _]) => date.startsWith(thisMonth))
  );
}

function updateChart(chart, dataMap, color = "#10b981") {
  const labels = Object.keys(dataMap).sort();
  chart.data.labels = labels;
  chart.data.datasets[0].data = labels.map(d => dataMap[d]);
  chart.update();
}

function setActiveToggle(activeBtn, inactiveBtn) {
  activeBtn.classList.add("bg-blue-600", "text-white");
  activeBtn.classList.remove("bg-gray-700", "text-gray-300");

  inactiveBtn.classList.add("bg-gray-700", "text-gray-300");
  inactiveBtn.classList.remove("bg-blue-600", "text-white");
}

async function loadAnalytics(memberId) {
  const snapshot = await secondDb.ref(`sessions-by-member/${memberId}`).once("value");
  if (!snapshot.exists()) return;

  const sessions = Object.values(snapshot.val());

  // Summary stats
  const totalSessions = sessions.length;
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.USINGMIN || 0), 0);
  const totalSpent = sessions.reduce((sum, s) => sum + (s.TOTALPRICE > 0 ? s.TOTALPRICE : 0), 0);

  const terminalCount = {};
  fullDateMap = {};
  fullSpendMap = {};

  sessions.forEach(s => {
    terminalCount[s.TERMINALNAME] = (terminalCount[s.TERMINALNAME] || 0) + 1;
    // Aggregate per date
    const date = new Date(s.ENDPOINT).toISOString().split("T")[0];
    fullDateMap[date] = (fullDateMap[date] || 0) + 1;
    fullSpendMap[date] = (fullSpendMap[date] || 0) + (s.TOTALPRICE > 0 ? s.TOTALPRICE : 0);
  });

  const mostUsedPC = Object.entries(terminalCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

  // Populate DOM
  document.getElementById("totalSessions").textContent = totalSessions;
  document.getElementById("totalMinutes").textContent = totalMinutes;
  document.getElementById("totalSpent").textContent = `₹${totalSpent}`;
  document.getElementById("mostUsedPC").textContent = mostUsedPC;

  if (pcChart) pcChart.destroy();
  if (sessionChart) sessionChart.destroy();
  if (spendChart) spendChart.destroy();

  const pcCtx = document.getElementById("pcUsageChart")?.getContext("2d");
  const sessionCtx = document.getElementById("sessionTimeChart")?.getContext("2d");
  const spendCtx = document.getElementById("spendChart")?.getContext("2d");

  if (pcCtx) {
    pcChart = new Chart(pcCtx, {
      type: "bar",
      data: {
        labels: Object.keys(terminalCount),
        datasets: [{
          label: "Sessions",
          data: Object.values(terminalCount),
          backgroundColor: "#38bdf8"
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } }
      }
    });
  }

  const monthSessionData = filterToCurrentMonth(fullDateMap);
  const sessionLabels = Object.keys(monthSessionData).sort();
  if (sessionCtx) {
    sessionChart = new Chart(sessionCtx, {
      type: "line",
      data: {
        labels: sessionLabels,
        datasets: [{
          label: "Sessions",
          data: sessionLabels.map(d => monthSessionData[d]),
          borderColor: "#10b981",
          backgroundColor: "#10b98133",
          fill: true
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } }
      }
    });
  }

  const monthSpendData = filterToCurrentMonth(fullSpendMap);
  const spendLabels = Object.keys(monthSpendData).sort();
  if (spendCtx) {
    spendChart = new Chart(spendCtx, {
      type: "line",
      data: {
        labels: spendLabels,
        datasets: [{
          label: "₹ Spent",
          data: spendLabels.map(d => monthSpendData[d]),
          borderColor: "#f97316",
          backgroundColor: "#f9731633",
          fill: true
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } }
      }
    });
  }

  // Recent sessions
  const recentList = document.getElementById("recentSessionsList");
  recentList.innerHTML = sessions
    .sort((a, b) => new Date(b.ENDPOINT) - new Date(a.ENDPOINT))
    .slice(0, 5)
    .map(s => `
      <li class="bg-gray-700 rounded-lg p-3">
        <div class="font-semibold text-white">${s.TERMINALNAME}</div>
        <div>🕒 ${s.USINGMIN} min | 💰 ₹${s.TOTALPRICE}</div>
        <div class="text-xs text-gray-400">Ended: ${new Date(s.ENDPOINT).toLocaleString()}</div>
      </li>
    `).join("");

  setActiveToggle(
    document.getElementById("sessionToggleMonth"),
    document.getElementById("sessionToggleAll")
  );
  setActiveToggle(
    document.getElementById("spendToggleMonth"),
    document.getElementById("spendToggleAll")
  );

  document.getElementById("sessionToggleMonth").onclick = () => {
    const filtered = filterToCurrentMonth(fullDateMap);
    updateChart(sessionChart, filtered, "#10b981");
    setActiveToggle(sessionToggleMonth, sessionToggleAll);
  };

  document.getElementById("sessionToggleAll").onclick = () => {
    updateChart(sessionChart, fullDateMap, "#10b981");
    setActiveToggle(sessionToggleAll, sessionToggleMonth);
  };

  document.getElementById("spendToggleMonth").onclick = () => {
    const filtered = filterToCurrentMonth(fullSpendMap);
    updateChart(spendChart, filtered, "#f97316");
    setActiveToggle(spendToggleMonth, spendToggleAll);
  };

  document.getElementById("spendToggleAll").onclick = () => {
    updateChart(spendChart, fullSpendMap, "#f97316");
    setActiveToggle(spendToggleAll, spendToggleMonth);
  };

}

document.getElementById("nextBtn").addEventListener("click", () => {
  showPCs();
  document.getElementById("step1").style.display = "none";
  document.getElementById("step2").style.display = "block";
});
document.getElementById("backBtn").addEventListener("click", () => {
  document.getElementById("step2").style.display = "none";
  document.getElementById("step1").style.display = "block";
});
document.getElementById("bookingForm").addEventListener("submit", e => {
  e.preventDefault();
  const selectedDate = document.getElementById("bookingDate").value;
  const start = startSelect.value;
  const end = endSelect.value;
  const selectedPCs = Array.from(selectedPCSet);

  if (!selectedPCs.length) {
    alert("Select at least one PC.");
    return;
  }

  const startTime = new Date(`${selectedDate}T${start}:00+05:30`);
  const endTime = new Date(`${selectedDate}T${end}:00+05:30`);
  const duration = (endTime - startTime) / (1000 * 60);

  if (duration < 60) {
    alert("Minimum 1 hour booking required.");
    return;
  }

  const booking = {
    name: member.USERNAME,
    pcs: selectedPCs,
    start: startTime.toISOString(),
    end: endTime.toISOString(),
    duration,
    price: duration * selectedPCs.length * 40 / 60
  };

  db.ref("bookings").push(booking, () => {
      const resultDiv = document.getElementById("bookingResult");
      resultDiv.classList.remove("hidden");
      resultDiv.textContent = "✅ Booking successful!";

      // Reset form
      document.getElementById("bookingForm").reset();
      selectedPCSet.clear();

      // Reset time selects to default
      startSelect.value = "10:00";
      endSelect.value = "11:00";

      // Clear PC checkboxes
      document.getElementById("availablePCs").innerHTML = "";

      // Reset price display
      const priceInfo = document.getElementById("priceInfo");
      if (priceInfo) priceInfo.textContent = "💰 Total Price: ₹0";

      // Return to Step 1
      document.getElementById("step2").style.display = "none";
      document.getElementById("step1").style.display = "block";

      // Refresh the "My Bookings" section
      const listDiv = document.getElementById("myBookingsList");
      if (listDiv) {
        listDiv.innerHTML = ""; // Clear old list
        loadMemberBookings(member.USERNAME); // Reload
      }

      // Auto-hide success message
      setTimeout(() => {
        resultDiv.classList.add("hidden");
        resultDiv.textContent = "";
      }, 3000);
  });
});
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    document.querySelectorAll(".tab-pane").forEach(pane =>
      pane.classList.toggle("hidden", pane.dataset.tab !== target)
    );
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("bg-blue-600"));
    if (target) btn.classList.add("bg-blue-600");
    if (target === "analytics") {
      setTimeout(() => {
        loadAnalytics(member.ID);  // 🔁 Reload charts only when Analytics tab is shown
      }, 100); // Delay to ensure DOM is rendered
    }
  });
});
document.getElementById("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("member");
  window.location.href = "member-login.html";
});
window.addEventListener("DOMContentLoaded", () => {
  loadMemberHistory(member.USERNAME);
  loadAnalytics(member.ID);
  loadLeaderboard();
  loadProfile();
  loadBookingDates();
  setupDateButtons();
  // Optional: Preload analytics if analytics tab is default
  if (document.querySelector('.tab-btn[data-tab="analytics"]').classList.contains("bg-blue-600")) {
    loadAnalytics(member.ID);
  }
  lucide.createIcons();
});
