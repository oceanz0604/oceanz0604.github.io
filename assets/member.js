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
    const value = hour.toString().padStart(2, "0") + ":00";
    const label = `${(hour % 12 || 12)}:00 ${hour < 12 ? "AM" : "PM"}`;
    startSelect.innerHTML += `<option value="${value}">${label}</option>`;
    endSelect.innerHTML += `<option value="${value}">${label}</option>`;
  }
  startSelect.value = "10:00";
  endSelect.value = "11:00";
}

function loadMemberBookings(username) {
  db.ref("bookings").once("value").then(snapshot => {
    const allBookings = snapshot.val() || {};
    const myBookings = Object.values(allBookings).filter(b => {
      return b.name?.toLowerCase() === username.toLowerCase();
    });

    const listDiv = document.getElementById("myBookingsList");
    if (myBookings.length === 0) {
      listDiv.innerHTML = `<div class="text-gray-400">You have no bookings yet.</div>`;
      return;
    }

    // Sort by start time, newest first
    myBookings.sort((a, b) => new Date(b.start) - new Date(a.start));

    myBookings.forEach(booking => {
      const start = new Date(booking.start);
      const end = new Date(booking.end);
      const card = document.createElement("div");
      card.className = "bg-gray-700 p-4 rounded-lg shadow";

      card.innerHTML = `
        <div class="flex justify-between items-center">
          <div>
            <div class="text-white font-semibold">${start.toLocaleDateString()} - ${booking.pcs.join(", ")}</div>
            <div class="text-sm text-gray-300">${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} → ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
          <div class="text-yellow-400 font-medium">₹${booking.price}</div>
        </div>
      `;
      listDiv.appendChild(card);
    });
  });
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
}

function loadLeaderboard() {
  secondDb.ref('fdb/MEMBERS').once("value").then(snapshot => {
    const members = Object.values(snapshot.val() || {});
    const top = members
      .filter(m => m.TOTALACTMINUTE)
      .sort((a, b) => b.TOTALACTMINUTE - a.TOTALACTMINUTE)
      .slice(0, 10);

    const list = document.getElementById("leaderboardList");
    list.innerHTML = "";
    top.forEach((m, i) => {
      const medal = ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
      const avatar = `https://api.dicebear.com/7.x/thumbs/svg?seed=${m.USERNAME}`;
      const row = document.createElement("div");
      row.className = "flex items-center justify-between p-3 rounded-lg bg-gray-800";
      row.innerHTML = `
        <div class="flex items-center gap-3">
          <img src="${avatar}" class="w-8 h-8 rounded-full">
          <span>${medal} <strong>${m.USERNAME}</strong></span>
        </div>
        <span class="text-gray-300">${Math.round(m.TOTALACTMINUTE)} mins</span>
      `;
      list.appendChild(row);
    });
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
  });
});
document.getElementById("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("member");
  window.location.href = "member-login.html";
});
window.addEventListener("DOMContentLoaded", () => {
  loadMemberHistory(member.USERNAME);
  loadLeaderboard();
  loadProfile();
  loadBookingDates();
  setupDateButtons();
  lucide.createIcons();
});
