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
  const timetableBookings = buildTimetableBookings(data);
  renderTimeHeader();
  renderTimetable(timetableBookings);
  renderCurrentTimeLine();
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

const TIMETABLE_PCS = [
  ...Array.from({ length: 7 }, (_, i) => `CT-ROOM-${i + 1}`),
  ...Array.from({ length: 7 }, (_, i) => `T-ROOM-${i + 1}`),
  "PS",
  "XBOX ONE X"
];

const TIMETABLE_START_HOUR = 10; // 10:00
const TIMETABLE_END_HOUR = 22;   // 22:00
const TIMETABLE_TOTAL_HOURS = TIMETABLE_END_HOUR - TIMETABLE_START_HOUR; // 12
const PC_COL_WIDTH = 150;

function timetableTimeIndex(dateStr) {
  const d = new Date(dateStr);
  return d.getHours() + d.getMinutes() / 60;
}

function timetableColor(status) {
  return status === "Approved"
    ? "bg-green-600/90"
    : "bg-yellow-500/90";
}

function buildTimetableBookings(bookingsData) {
  if (!bookingsData) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Object.values(bookingsData)
    .map(b => {
      if (!Array.isArray(b.pcs) || !b.pcs.length) return null;

      const startDate = new Date(b.start);
      const endDate = new Date(b.end);

      // ❌ Not today
      if (startDate < today || startDate >= new Date(today.getTime() + 86400000)) {
        return null;
      }

      let pc = b.pcs[0].toUpperCase();

      if (/^T\d+$/.test(pc)) pc = `T-ROOM-${pc.slice(1)}`;
      else if (/^CT\d+$/.test(pc)) pc = `CT-ROOM-${pc.slice(2)}`;
      else if (pc === "PS") pc = "PS";
      else if (pc.startsWith("XBOX")) pc = "XBOX ONE X";
      else return null;

      return {
        pc,
        name: b.name || "Booking",
        start: timetableTimeIndex(b.start),
        end: timetableTimeIndex(b.end),
        status: b.status || "Pending"
      };
    })
    .filter(Boolean);
}

function renderTimeHeader() {
  const header = document.getElementById("timeHeader");
  if (!header) return;

  header.innerHTML = `<div></div>`;

  for (let h = TIMETABLE_START_HOUR; h < TIMETABLE_END_HOUR; h++) {
    header.innerHTML += `
      <div class="text-center border-l border-gray-700">
        ${String(h).padStart(2, "0")}:00
      </div>
    `;
  }
}


function renderTimetable(timetableBookings) {
  const body = document.getElementById("timetableBody");
  if (!body) return;

  body.innerHTML = "";

  TIMETABLE_PCS.forEach(pc => {
    const row = document.createElement("div");
    row.className = "grid grid-cols-[140px_repeat(12,_1fr)] relative h-8 bg-gray-900 rounded";

    row.innerHTML = `
      <div class="flex items-center justify-center text-[11px] font-semibold text-white border-r border-gray-700">
        ${pc}
      </div>
    `;

    for (let i = 0; i < 12; i++) {
      row.innerHTML += `<div class="border-l border-gray-800"></div>`;
    }

    timetableBookings
      .filter(b => b.pc === pc)
      .forEach(b => {
        if (b.end <= b.start) return;

        const start = Math.max(b.start, TIMETABLE_START_HOUR);
        const end = Math.min(b.end, TIMETABLE_END_HOUR);
        if (end <= start) return;
        const left = ((start - TIMETABLE_START_HOUR) / TIMETABLE_TOTAL_HOURS) * 100;
        const width = ((end - start) / TIMETABLE_TOTAL_HOURS) * 100;

        const block = document.createElement("div");
        block.className = `
          absolute top-1/2 -translate-y-1/2 h-6 rounded text-[10px]
          text-white px-1 flex items-center
          ${timetableColor(b.status)}
        `;

        block.style.left = `calc(${left}% + ${PC_COL_WIDTH}px)`;
        block.style.width = `calc(${width}% - 4px)`;
        block.textContent = b.name;

        row.appendChild(block);
      });

    body.appendChild(row);
  });

}

function renderCurrentTimeLine() {
  const wrapper = document.getElementById("timetableWrapper");
  if (!wrapper) return;

  // Remove old line
  const oldLine = document.getElementById("currentTimeLine");
  if (oldLine) oldLine.remove();

  const now = new Date();
  const hours = now.getHours() + now.getMinutes() / 60;

  // Outside timetable window → do nothing
  if (hours < TIMETABLE_START_HOUR || hours > TIMETABLE_END_HOUR) return;

  const leftPercent =
    ((hours - TIMETABLE_START_HOUR) / TIMETABLE_TOTAL_HOURS) * 100;

  const line = document.createElement("div");
  line.id = "currentTimeLine";
  line.className =
    "absolute top-0 bottom-0 w-[2px] bg-red-500 z-20 pointer-events-none";

  line.style.left = `calc(${leftPercent}% + 140px)`; // 140 = PC column width

  wrapper.appendChild(line);
}

setInterval(() => {
  renderCurrentTimeLine();
}, 60 * 1000);
