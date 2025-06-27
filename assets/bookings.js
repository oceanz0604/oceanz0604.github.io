import {
  initializeApp,
  getApps
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  get,
  ref,
  onValue,
  remove,
  update
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const bookingConfig = {
    apiKey: "AIzaSyAc0Gz1Em0TUeGnKD4jQjZl5fn_FyoWCLo",
    databaseURL: "https://gaming-cafe-booking-630f9-default-rtdb.asia-southeast1.firebasedatabase.app",
    authDomain: "gaming-cafe-booking-630f9.firebaseapp.com",
    projectId: "gaming-cafe-booking-630f9",
    storageBucket: "gaming-cafe-booking-630f9.firebasestorage.app",
    messagingSenderId: "872841235480",
    appId: "1:872841235480:web:58cfe4fc38cc8a037b076d",
    measurementId: "G-PSLG65XMBT"
};

// Initialize second app if not already initialized
let secondApp = getApps().find(app => app.name === "SECOND_APP");
if (!secondApp) {
  secondApp = initializeApp(bookingConfig, "SECOND_APP");
}
const db2 = getDatabase(secondApp);

const bookingCardsEl = document.getElementById("bookingCards");

// Listen for real-time booking changes
const bookingsRef = ref(db2, "bookings");
onValue(bookingsRef, (snapshot) => {
  const data = snapshot.val();
  renderBookings(data);
});

window.fetchBookings = () => {
  const now = new Date();
  const data = get(ref(db2, "bookings")).then(snapshot => {
    const val = snapshot.val();
    renderBookings(val);
  });
};

window.downloadCSV = () => {
  const rows = [["Name", "Start", "End", "Duration", "PCs", "Price"]];
  document.querySelectorAll(".booking-card").forEach(card => {
    const cells = Array.from(card.querySelectorAll(".export-cell")).map(cell => cell.textContent);
    rows.push(cells);
  });

  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `bookings_all.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

function formatDate(isoString) {
  const date = new Date(isoString);
  if (isNaN(date)) return "-";
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: true,
  });
}

// Utility to create section with optional collapse
function createSection(title, cards, collapsed = false) {
  const section = document.createElement("div");
  section.className = "mb-8";

  const contentId = `content-${title.replace(/\s+/g, "-").toLowerCase()}`;

  section.innerHTML = `
    <button
      onclick="document.getElementById('${contentId}').classList.toggle('hidden')"
      class="w-full flex justify-between items-center bg-gray-700 hover:bg-gray-600 px-4 py-3 rounded-t-xl text-white font-semibold text-lg"
    >
      <span>${title}</span>
      <i data-lucide="chevron-down" class="w-5 h-5"></i>
    </button>
    <div id="${contentId}" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 bg-gray-800 p-4 rounded-b-xl ${collapsed ? "hidden" : ""}">
    </div>
  `;

  const contentDiv = section.querySelector(`#${contentId}`);
  cards.forEach(c => contentDiv.appendChild(c));

  document.getElementById("bookingCards").appendChild(section);
}

function renderBookings(bookingsData) {
  const container = document.getElementById("bookingCards");
  container.innerHTML = "";

  const now = new Date();
  const upcomingCards = [];
  const ongoingCards = [];
  const pastCards = [];

  const sortedEntries = Object.entries(bookingsData || {}).sort(
    (a, b) => new Date(b[1].start) - new Date(a[1].start)
  );

  sortedEntries.forEach(([key, booking]) => {
    const startTime = new Date(booking.start);
    const endTime = new Date(booking.end);
    const now = new Date();

    let group = "past"; // default
    if (startTime > now) {
      group = "upcoming";
    } else if (startTime <= now && endTime > now) {
      group = "ongoing";
    }

    let statusText = booking.status || "Pending";
    if (group === "past") {
      statusText = "Expired";
    }

    const statusColors = {
      Pending: "bg-yellow-500 text-black",
      Approved: "bg-green-600 text-white",
      Declined: "bg-red-600 text-white",
      Expired: "bg-gray-500 text-white"
    };

    const card = document.createElement("div");
    const borderColor = {
      Pending: "border-yellow-500",
      Approved: "border-green-600",
      Declined: "border-red-600",
      Expired: "border-gray-500",
      hover:"shadow-[0_0_8px_2px_rgba(255,255,255,0.1)]"
    }[statusText] || "border-gray-600";

    card.className = `booking-card border ${borderColor} rounded-xl p-4 bg-gray-800 shadow-md hover:shadow-lg transition`;

    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-lg font-semibold text-blue-400 export-cell">${booking.name}</h3>
        <span class="text-xs font-bold px-2 py-1 rounded-full ${statusColors[statusText]}">
          ${statusText}
        </span>
      </div>

      <div class="grid grid-cols-1 gap-1 text-sm text-gray-300">
        <div><strong>Start:</strong> <span class="export-cell">${formatDate(booking.start)}</span></div>
        <div><strong>End:</strong> <span class="export-cell">${formatDate(booking.end)}</span></div>
        <div><strong>Duration:</strong> <span class="export-cell">${booking.duration} mins</span></div>
        <div><strong>Terminals:</strong> <span class="export-cell">${booking.pcs.join(", ")}</span></div>
        <div><strong>Price:</strong> <span class="export-cell">₹${booking.price}</span></div>
        ${booking.note ? `<div><strong>Note:</strong> ${booking.note}</div>` : ""}
      </div>

      <div class="flex flex-wrap gap-2 mt-4">
        ${(group === "upcoming" || group === "ongoing") && statusText === "Pending" ? `
          <button onclick="approveBooking('${key}')" class="flex items-center gap-1 text-sm px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white">
            <i data-lucide='check-circle' class='w-4 h-4'></i> Approve
          </button>
          <button onclick="declineBooking('${key}')" class="flex items-center gap-1 text-sm px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white">
            <i data-lucide='x-circle' class='w-4 h-4'></i> Decline
          </button>
        ` : ""}
        <button onclick="deleteBooking('${key}')" class="flex items-center gap-1 text-sm px-3 py-1 rounded bg-gray-600 hover:bg-gray-700 text-white">
          <i data-lucide="trash-2" class="w-4 h-4"></i> Delete
        </button>
      </div>
    `;

    if (group === "upcoming") {
      upcomingCards.push(card);
    } else if (group === "ongoing") {
      ongoingCards.push(card);
    } else {
      pastCards.push(card);
    }
  });

  if (upcomingCards.length > 0) {
    createSection("Upcoming Bookings", upcomingCards, false);
  }
  if (ongoingCards.length > 0) {
    createSection("Ongoing Bookings", ongoingCards, false);
  }
  if (pastCards.length > 0) {
    createSection("Past Bookings", pastCards, true); // collapsed by default
  }

  lucide.createIcons(); // initialize icons
}

window.handleBookingAction = async (bookingId, action) => {
  const msgEl = document.getElementById(`msg-${bookingId}`);
  const message = msgEl ? msgEl.value.trim() : "";

  const updates = {
    status: action,
    adminMessage: message,
    respondedAt: new Date().toISOString(),
  };

  try {
    await update(ref(db2, `bookings/${bookingId}`), updates);
    alert(`Booking ${action.toUpperCase()}!`);
    fetchBookings();
  } catch (err) {
    console.error("Failed to update booking:", err);
    alert("Failed to update booking.");
  }
};

window.deleteBooking = async (id) => {
  if (confirm("Are you sure you want to delete this booking?")) {
    await remove(ref(db2, `bookings/${id}`));
  }
};

window.approveBooking = async (id) => {
  await update(ref(db2, `bookings/${id}`), {
    status: "Approved",
    note: ""
  });
  fetchBookings();
  lucide.createIcons();
};

window.declineBooking = async (id) => {
  const note = prompt("Enter reason for decline:");
  await update(ref(db2, `bookings/${id}`), {
    status: "Declined",
    note: note || ""
  });
  fetchBookings();
  lucide.createIcons();
};

