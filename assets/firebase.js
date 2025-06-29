
// Replace these values with your Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyAc0Gz1Em0TUeGnKD4jQjZl5fn_FyoWCLo",
    databaseURL: "https://gaming-cafe-booking-630f9-default-rtdb.asia-southeast1.firebasedatabase.app",
    authDomain: "gaming-cafe-booking-630f9.firebaseapp.com",
    projectId: "gaming-cafe-booking-630f9",
    storageBucket: "gaming-cafe-booking-630f9.firebasestorage.app",
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

const secondApp = firebase.initializeApp(secondAppConfig, "SECOND_APP");
const secondDb = secondApp.database();

const app = firebase.initializeApp(firebaseConfig);
const db = app.database();

const form = document.getElementById("bookingForm");
const resultDiv = document.getElementById("bookingResult");
const priceDisplay = document.getElementById("priceInfo");

document.querySelectorAll('.pc-checkboxes input[type="checkbox"]').forEach(checkbox => {
  checkbox.addEventListener('change', () => {
    checkbox.parentElement.classList.toggle('selected', checkbox.checked);
  });
});

const allPCs = [
    "T1", "T2", "T3", "T4", "T5", "T6", "T7",
    "CT1", "CT2", "CT3", "CT4", "CT5", "CT6", "CT7"
  ];

// Set default time
window.addEventListener('DOMContentLoaded', () => {
    const now = new Date();
    const startHour = now.getHours();
    const endHour = (startHour + 1) % 24;
    const pad = n => n.toString().padStart(2, '0');
    document.getElementById("startTime").value = `${pad(startHour)}:00`;
    document.getElementById("endTime").value = `${pad(endHour)}:00`;
    });

// Next button logic
document.getElementById("nextBtn").addEventListener("click", () => {
    const name = document.getElementById("userName").value.trim();
    const startTime = document.getElementById("startTime").value;
    const endTime = document.getElementById("endTime").value;

    if (!name || !startTime || !endTime) {
      alert("Please fill all fields.");
      return;
    }
    // Move to Step 2
    document.getElementById("step1").style.display = "none";
    document.getElementById("step2").style.display = "block";
    // Simulate available PC filter here
    showAvailablePCs(); // Call dynamic filter
});

// Back button logic
document.getElementById("backBtn").addEventListener("click", () => {
    document.getElementById("priceInfo").textContent = `💰 Total Price: ₹0`;
    resultDiv.style.display = "none";
    resultDiv.textContent = "";
    document.getElementById("step2").style.display = "none";
    document.getElementById("step1").style.display = "block";
});

document.getElementById("startTime").addEventListener("input", updatePriceDisplay);
document.getElementById("endTime").addEventListener("input", updatePriceDisplay);

form.addEventListener("submit", function(e) {
  e.preventDefault();

  const name = document.getElementById("userName").value.trim();
  const startValue = document.getElementById("startTime").value;
  const endValue = document.getElementById("endTime").value;

  const selectedPCs = Array.from(document.querySelectorAll(".pc-option:checked")).map(cb => cb.value);
  if (selectedPCs.length === 0) {
    alert("Please select at least one PC.");
    return;
  }

  const today = new Date();
  const startTime = new Date(today.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T" + startValue + ":00");
  const endTime = new Date(today.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T" + endValue + ":00");

  const duration = (endTime - startTime) / (1000 * 60); // in minutes
  if (duration < 60) {
    alert("Booking should be done for at least 1 hour");
    return;
  }

  const price = duration * selectedPCs.length * 40 / 60;

  const bookingData = {
    name,
    pcs: selectedPCs,
    start: startTime.toISOString(),
    end: endTime.toISOString(),
    duration,
    price
  };

  db.ref("bookings").once("value", snapshot => {
    const bookings = snapshot.val();
    let conflict = false;

    if (bookings) {
      Object.values(bookings).forEach(b => {
        b.pcs.forEach(pc => {
          if (selectedPCs.includes(pc)) {
            const bookedStart = new Date(b.start);
            const bookedEnd = new Date(b.end);
            if (
              (startTime >= bookedStart && startTime < bookedEnd) ||
              (endTime > bookedStart && endTime <= bookedEnd) ||
              (startTime <= bookedStart && endTime >= bookedEnd)
            ) {
              conflict = true;
            }
          }
        });
      });
    }

    if (conflict) {
      resultDiv.style.display = "block";
      resultDiv.innerHTML = "<p style='color:red;'>⚠ One or more PCs are already booked for the selected time.</p>";
    } else {
      const newRef = db.ref("bookings").push();
      newRef.set(bookingData, () => {
        resultDiv.style.display = "block";
        resultDiv.innerHTML = "<p style='color:green;'>✅ Booking successful!</p>";
        form.reset();
        updatePriceDisplay();
      });
    }
  });
});

function logout() {
  firebase.auth().signOut().then(() => {
    window.location.href = "login.html";
  });
}

function fetchAvailablePCsFromFirebase(startTime, endTime, callback) {
  const dbRef = firebase.database().ref("bookings");

  dbRef.once("value", snapshot => {
    const bookings = snapshot.val() || {};
    const unavailablePCs = new Set();

    const today = new Date();
    const selectedStart = new Date(today.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T" + startTime + ":00");
    const selectedEnd = new Date(today.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T" + endTime + ":00");

    Object.values(bookings).forEach(entry => {
      const bookedStart = new Date(entry.start);
      const bookedEnd = new Date(entry.end);
      const pcs = entry.pcs || [];

      // Check for overlap
      const overlaps = selectedStart < bookedEnd && selectedEnd > bookedStart;
      if (overlaps) {
        pcs.forEach(pc => unavailablePCs.add(pc));
      }
    });

    callback(unavailablePCs);
  });
}

// Simulated logic to show all PCs (you can filter based on Firebase data here)
function showAvailablePCs() {
  const pcContainer = document.getElementById("availablePCs");
  pcContainer.innerHTML = "";

  const startTime = document.getElementById("startTime").value;
  const endTime = document.getElementById("endTime").value;

  fetchAvailablePCsFromFirebase(startTime, endTime, (unavailablePCs) => {
    allPCs.forEach(pc => {
      if (!unavailablePCs.has(pc)) {
        const label = document.createElement("label");
        label.className = "pc-label";
        label.innerHTML = `
          <input type="checkbox" class="pc-option" value="${pc}" />
          ${pc.replace(/^T/, "T-Room ").replace(/^CT/, "CT-Room ")}
        `;
        pcContainer.appendChild(label);
      }
    });

    // Add event listener to update price
    document.querySelectorAll(".pc-option").forEach(cb => {
      cb.addEventListener("change", () => {
        cb.parentElement.classList.toggle("selected", cb.checked);
        updatePriceDisplay();
      });
    });

    updatePriceDisplay(); // initial price update
  });
}

// Auto update price
function updatePriceDisplay() {
  const startTime = document.getElementById("startTime").value;
  const endTime = document.getElementById("endTime").value;
  const pcCount = document.querySelectorAll(".pc-option:checked").length;

  if (!startTime || !endTime || pcCount === 0) {
    document.getElementById("priceInfo").textContent = "💰 Total Price: ₹0";
    return;
  }

  const [startHour, startMin] = startTime.split(":").map(Number);
  const [endHour, endMin] = endTime.split(":").map(Number);

  let duration = (endHour + endMin / 60) - (startHour + startMin / 60);
  if (duration <= 0) duration += 24; // Handle overnight booking

  const ratePerHour = 40; // 💡 Your price per PC per hour
  const price = Math.ceil(duration * pcCount * ratePerHour);

  document.getElementById("priceInfo").textContent = `💰 Total Price: ₹${price}`;
}

function renderLeaderboard(members) {
  const leaderboardList = document.getElementById("leaderboardList");
  leaderboardList.innerHTML = "";

  members.forEach((member, index) => {
    let medal = "";
    let medalColor = "";

    if (index === 0) {
      medal = "🥇";
      medalColor = "text-yellow-400";
    } else if (index === 1) {
      medal = "🥈";
      medalColor = "text-gray-300";
    } else if (index === 2) {
      medal = "🥉";
      medalColor = "text-orange-400";
    }

    const row = document.createElement("div");
    row.className = `flex justify-between items-center bg-gray-700 p-3 rounded-lg`;

    row.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="text-xl ${medalColor}">${medal}</span>
        <span class="font-semibold">${member.USERNAME || member.ID}</span>
      </div>
      <span class="text-sm text-gray-300">${Math.round(member.TOTALACTMINUTE)} mins</span>
    `;
    leaderboardList.appendChild(row);
  });
  lucide.createIcons(); // Refresh icons
}

function loadLeaderboard() {
    secondDb.ref('fdb/MEMBERS').once("value").then(snapshot => {
      const data = snapshot.val();
      if (!data) return;
      const memberArray = Object.values(data)
        .filter(m => m.TOTALACTMINUTE !== undefined)
        .sort((a, b) => b.TOTALACTMINUTE - a.TOTALACTMINUTE)
        .slice(0, 10); // top 10

      renderLeaderboard(memberArray);
    }).catch(err => {
      console.error("Leaderboard load failed:", err);
    });
  }

window.addEventListener("DOMContentLoaded", loadLeaderboard);
