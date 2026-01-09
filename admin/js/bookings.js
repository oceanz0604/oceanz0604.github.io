/**
 * OceanZ Gaming Cafe - Bookings Management
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, get, ref, onValue, remove, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { BOOKING_DB_CONFIG, BOOKING_APP_NAME, CONSTANTS } from "../../shared/config.js";
import { getStaffSession } from "./permissions.js";

// Get admin name from staff session
function getAdminName() {
  const session = getStaffSession();
  return session?.name || session?.email?.split("@")[0] || "Admin";
}

// ==================== FIREBASE INIT ====================

let bookingApp = getApps().find(app => app.name === BOOKING_APP_NAME);
if (!bookingApp) bookingApp = initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);

const db = getDatabase(bookingApp);

// ==================== CONSTANTS ====================

const { TIMETABLE_PCS, TIMETABLE_START_HOUR, TIMETABLE_END_HOUR, PC_COL_WIDTH } = CONSTANTS;
const TIMETABLE_TOTAL_HOURS = TIMETABLE_END_HOUR - TIMETABLE_START_HOUR;

// ==================== UTILITIES ====================

function formatDate(isoString) {
  const date = new Date(isoString);
  if (isNaN(date)) return "-";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", hour12: true });
}

function timetableTimeIndex(dateStr) {
  const d = new Date(dateStr);
  return d.getHours() + d.getMinutes() / 60;
}

function timetableColor(status) {
  return status === "Approved" 
    ? "bg-gradient-to-r from-green-600 to-green-500" 
    : "bg-gradient-to-r from-yellow-600 to-yellow-500";
}

// ==================== REAL-TIME LISTENER ====================

const bookingsRef = ref(db, "bookings");

onValue(bookingsRef, snapshot => {
  const data = snapshot.val();
  renderBookings(data);
  renderTimeHeader();
  renderTimetable(buildTimetableBookings(data));
  renderCurrentTimeLine();
});

// ==================== EXPORTS FOR GLOBAL ACCESS ====================

window.fetchBookings = () => {
  get(ref(db, "bookings")).then(snapshot => renderBookings(snapshot.val()));
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
  link.download = "bookings_all.csv";
  link.click();
  URL.revokeObjectURL(url);
};

window.deleteBooking = async id => {
  if (confirm("Are you sure you want to delete this booking?")) {
    const adminName = getAdminName();
    console.log(`🗑️ Booking ${id} deleted by ${adminName}`);
    await remove(ref(db, `bookings/${id}`));
  }
};

window.approveBooking = async id => {
  const adminName = getAdminName();
  await update(ref(db, `bookings/${id}`), { 
    status: "Approved", 
    note: "",
    approvedBy: adminName,
    approvedAt: new Date().toISOString()
  });
  console.log(`✅ Booking ${id} approved by ${adminName}`);
  window.fetchBookings();
  lucide?.createIcons();
};

window.declineBooking = async id => {
  const adminName = getAdminName();
  const note = prompt("Enter reason for decline:");
  await update(ref(db, `bookings/${id}`), { 
    status: "Declined", 
    note: note || "",
    declinedBy: adminName,
    declinedAt: new Date().toISOString()
  });
  console.log(`❌ Booking ${id} declined by ${adminName}`);
  window.fetchBookings();
  lucide?.createIcons();
};

// ==================== RENDER BOOKINGS ====================

function createSection(title, cards, collapsed = false) {
  const section = document.createElement("div");
  section.className = "mb-6";
  const contentId = `content-${title.replace(/\s+/g, "-").toLowerCase()}`;

  section.innerHTML = `
    <button onclick="document.getElementById('${contentId}').classList.toggle('hidden')"
      class="w-full flex justify-between items-center px-4 py-3 rounded-t-xl font-orbitron text-sm font-bold tracking-wider"
      style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,0,68,0.3); border-bottom: none; color: #ff0044;">
      <span>${title}</span>
      <i data-lucide="chevron-down" class="w-5 h-5"></i>
    </button>
    <div id="${contentId}" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 rounded-b-xl ${collapsed ? "hidden" : ""}"
      style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,0,68,0.2); border-top: none;"></div>
  `;

  const contentDiv = section.querySelector(`#${contentId}`);
  cards.forEach(c => contentDiv.appendChild(c));
  document.getElementById("bookingCards").appendChild(section);
}

function renderBookings(bookingsData) {
  const container = document.getElementById("bookingCards");
  container.innerHTML = "";

  const now = new Date();
  const groups = { upcoming: [], ongoing: [], past: [] };

  const sortedEntries = Object.entries(bookingsData || {}).sort(
    (a, b) => new Date(b[1].start) - new Date(a[1].start)
  );

  sortedEntries.forEach(([key, booking]) => {
    const startTime = new Date(booking.start);
    const endTime = new Date(booking.end);
    const group = startTime > now ? "upcoming" : (startTime <= now && endTime > now) ? "ongoing" : "past";
    const statusText = group === "past" ? "Expired" : (booking.status || "Pending");

    const statusClasses = {
      Pending: "status-pending",
      Approved: "status-approved",
      Declined: "status-declined",
      Expired: "opacity-50"
    };

    const card = document.createElement("div");
    card.className = "booking-card rounded-xl p-4";

    // Build action info
    let actionInfo = "";
    if (booking.approvedBy) {
      actionInfo = `<div class="text-xs mt-2 pt-2 border-t border-gray-700">
        <span style="color: #00ff88;">✓ Approved by ${booking.approvedBy}</span>
      </div>`;
    } else if (booking.declinedBy) {
      actionInfo = `<div class="text-xs mt-2 pt-2 border-t border-gray-700">
        <span style="color: #ff0044;">✕ Declined by ${booking.declinedBy}</span>
        ${booking.note ? `<br><span class="text-gray-500">Reason: ${booking.note}</span>` : ""}
      </div>`;
    }

    card.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-orbitron text-sm font-bold export-cell" style="color: #00f0ff;">${booking.name}</h3>
        <span class="text-xs font-bold px-3 py-1 rounded-full ${statusClasses[statusText]}">${statusText}</span>
      </div>
      <div class="grid grid-cols-1 gap-2 text-sm text-gray-400">
        <div><span class="text-gray-500">Start:</span> <span class="export-cell">${formatDate(booking.start)}</span></div>
        <div><span class="text-gray-500">End:</span> <span class="export-cell">${formatDate(booking.end)}</span></div>
        <div><span class="text-gray-500">Duration:</span> <span class="export-cell" style="color: #b829ff;">${booking.duration} mins</span></div>
        <div><span class="text-gray-500">Terminal:</span> <span class="export-cell" style="color: #00ff88;">${booking.pcs.join(", ")}</span></div>
        <div><span class="text-gray-500">Price:</span> <span class="export-cell" style="color: #ffff00;">₹${booking.price}</span></div>
        ${booking.note && !booking.declinedBy ? `<div><span class="text-gray-500">Note:</span> ${booking.note}</div>` : ""}
      </div>
      ${actionInfo}
      <div class="flex flex-wrap gap-2 mt-4">
        ${(group === "upcoming" || group === "ongoing") && statusText === "Pending" ? `
          <button onclick="approveBooking('${key}')" class="neon-btn neon-btn-green flex items-center gap-1 text-xs px-3 py-2 rounded-lg">
            <i data-lucide='check-circle' class='w-4 h-4'></i> Approve
          </button>
          <button onclick="declineBooking('${key}')" class="neon-btn flex items-center gap-1 text-xs px-3 py-2 rounded-lg">
            <i data-lucide='x-circle' class='w-4 h-4'></i> Decline
          </button>
        ` : ""}
        <button onclick="deleteBooking('${key}')" class="neon-btn neon-btn-purple flex items-center gap-1 text-xs px-3 py-2 rounded-lg">
          <i data-lucide="trash-2" class="w-4 h-4"></i> Delete
        </button>
      </div>
    `;

    groups[group].push(card);
  });

  if (groups.upcoming.length) createSection("Upcoming Bookings", groups.upcoming, false);
  if (groups.ongoing.length) createSection("Ongoing Bookings", groups.ongoing, false);
  if (groups.past.length) createSection("Past Bookings", groups.past, true);

  lucide?.createIcons();
}

// ==================== TIMETABLE ====================

function buildTimetableBookings(bookingsData) {
  if (!bookingsData) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Object.values(bookingsData)
    .map(b => {
      if (!Array.isArray(b.pcs) || !b.pcs.length) return null;

      const startDate = new Date(b.start);
      if (startDate < today || startDate >= new Date(today.getTime() + 86400000)) return null;

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

  header.innerHTML = "<div></div>";
  for (let h = TIMETABLE_START_HOUR; h < TIMETABLE_END_HOUR; h++) {
    header.innerHTML += `<div class="text-center font-orbitron" style="border-left: 1px solid rgba(255,0,68,0.2); color: #666;">${String(h).padStart(2, "0")}:00</div>`;
  }
}

function renderTimetable(timetableBookings) {
  const body = document.getElementById("timetableBody");
  if (!body) return;

  body.innerHTML = "";

  TIMETABLE_PCS.forEach(pc => {
    const row = document.createElement("div");
    row.className = "timetable-row grid grid-cols-[140px_repeat(12,_1fr)] relative h-8 rounded";

    row.innerHTML = `<div class="flex items-center justify-center text-[10px] font-orbitron font-bold border-r" style="color: #00f0ff; border-color: rgba(255,0,68,0.2);">${pc}</div>`;

    for (let i = 0; i < 12; i++) {
      row.innerHTML += `<div style="border-left: 1px solid rgba(255,0,68,0.1);"></div>`;
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
        block.className = `absolute top-1/2 -translate-y-1/2 h-6 rounded text-[10px] text-white px-1 flex items-center ${timetableColor(b.status)}`;
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

  const oldLine = document.getElementById("currentTimeLine");
  if (oldLine) oldLine.remove();

  const now = new Date();
  const hours = now.getHours() + now.getMinutes() / 60;

  if (hours < TIMETABLE_START_HOUR || hours > TIMETABLE_END_HOUR) return;

  const leftPercent = ((hours - TIMETABLE_START_HOUR) / TIMETABLE_TOTAL_HOURS) * 100;

  const line = document.createElement("div");
  line.id = "currentTimeLine";
  line.className = "absolute top-0 bottom-0 w-[2px] z-20 pointer-events-none";
  line.style.left = `calc(${leftPercent}% + ${PC_COL_WIDTH}px)`;
  line.style.background = "#ff0044";
  line.style.boxShadow = "0 0 10px #ff0044";

  wrapper.appendChild(line);
}

setInterval(renderCurrentTimeLine, 60 * 1000);
