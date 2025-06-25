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

for (let h = 0; h < 24; h++) {
  const hour = h.toString().padStart(2, "0") + ":00";
  const label = `${((h + 11) % 12 + 1)}:00 ${h < 12 ? "AM" : "PM"}`;
  startSelect.innerHTML += `<option value="${hour}">${label}</option>`;
  endSelect.innerHTML += `<option value="${hour}">${label}</option>`;
}
const pad = n => n.toString().padStart(2, "0");
startSelect.value = `${pad(now.getHours())}:00`;
endSelect.value = `${pad((now.getHours() + 1) % 24)}:00`;

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

function loadProfile(){
    const profileDiv = document.getElementById("tab-content").querySelector('[data-tab="profile"]');
    document.getElementById("memberName").textContent = `${member.NAME} ${member.LASTNAME}`;
    document.getElementById("memberInfo").textContent = `Username: ${member.USERNAME} | Balance: ₹${member.BAKIYE ?? 0}`;
    document.getElementById("avatar").src = `https://api.dicebear.com/7.x/thumbs/svg?seed=${member.USERNAME}`;
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
  const pcCount = document.querySelectorAll(".pc-option:checked").length;
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
    const startTime = new Date(`${now.toLocaleDateString("en-CA")}T${start}:00`);
    const endTime = new Date(`${now.toLocaleDateString("en-CA")}T${end}:00`);

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
  pcDiv.innerHTML = ""; // Clear previous checkboxes

  // Reset price display
  const priceInfo = document.getElementById("priceInfo");
  if (priceInfo) priceInfo.textContent = "💰 Total Price: ₹0";
  fetchUnavailablePCs(startSelect.value, endSelect.value, (unavailable) => {
    allPCs.forEach(pc => {
      if (!unavailable.has(pc)) {
        const label = document.createElement("label");
        label.className = "flex gap-2 items-center bg-gray-700 p-2 rounded cursor-pointer";
        label.innerHTML = `<input type="checkbox" value="${pc}" class="pc-option"/> ${pc}`;
        pcDiv.appendChild(label);
      }
      document.querySelectorAll(".pc-option").forEach(cb => {
        cb.addEventListener("change", updatePrice);
      });
      updatePrice();
    });
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
  const start = startSelect.value;
  const end = endSelect.value;
  const selectedPCs = Array.from(document.querySelectorAll(".pc-option:checked")).map(cb => cb.value);

  if (!selectedPCs.length) {
    alert("Select at least one PC.");
    return;
  }

  const startTime = new Date(`${now.toLocaleDateString("en-CA")}T${start}:00`);
  const endTime = new Date(`${now.toLocaleDateString("en-CA")}T${end}:00`);
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

      // Reset time selects to default
      const now = new Date();
      const pad = n => n.toString().padStart(2, "0");
      startSelect.value = `${pad(now.getHours())}:00`;
      endSelect.value = `${pad((now.getHours() + 1) % 24)}:00`;

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
  lucide.createIcons();
});
