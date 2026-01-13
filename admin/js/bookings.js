/**
 * OceanZ Gaming Cafe - Bookings Management
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, get, ref, onValue, remove, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { 
  BOOKING_DB_CONFIG, 
  BOOKING_APP_NAME, 
  CONSTANTS, 
  TIMEZONE,
  formatToIST,
  getISTHours,
  getISTDate,
  getISTToday,
  FB_PATHS
} from "../../shared/config.js";
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

// Global storage for bookings data (for modal access)
let currentBookingsData = {};

// ==================== UTILITIES (IST TIMEZONE) ====================

function formatDate(isoString) {
  return formatToIST(isoString);
}

function timetableTimeIndex(dateStr) {
  return getISTHours(dateStr);
}

// ==================== TIMETABLE TOGGLE ====================

function initTimetableToggle() {
  const toggle = document.getElementById("timetableToggle");
  const container = document.getElementById("timetableContainer");
  const chevron = document.getElementById("timetableChevron");
  const dateBadge = document.getElementById("timetableDateBadge");
  
  if (!toggle || !container) return;
  
  // Set today's date in badge (IST)
  if (dateBadge) {
    dateBadge.textContent = getISTDate().toLocaleDateString("en-IN", { 
      weekday: "short", 
      day: "numeric", 
      month: "short" 
    });
  }
  
  toggle.addEventListener("click", () => {
    const isHidden = container.classList.toggle("hidden");
    chevron?.classList.toggle("rotate-180", !isHidden);
  });
}

// Initialize toggle when DOM is ready
document.addEventListener("DOMContentLoaded", initTimetableToggle);

// Status colors for timetable blocks
function getTimetableBlockStyle(booking) {
  const now = getISTDate();
  const startTime = new Date(booking.startTime);
  const endTime = new Date(booking.endTime);
  const minutesUntilStart = (startTime - now) / 60000;
  
  // Currently running
  if (startTime <= now && endTime > now) {
    return {
      class: "timetable-block-running",
      bg: "linear-gradient(135deg, #00ff88, #00cc6a)",
      border: "#00ff88",
      pulse: true,
      label: "🎮 LIVE"
    };
  }
  
  // Starting within 15 minutes
  if (minutesUntilStart > 0 && minutesUntilStart <= 15 && booking.status === "Approved") {
    return {
      class: "timetable-block-soon",
      bg: "linear-gradient(135deg, #ff6b00, #ff9500)",
      border: "#ff6b00",
      pulse: true,
      label: "⏰ SOON"
    };
  }
  
  // Approved (future)
  if (booking.status === "Approved") {
    return {
      class: "timetable-block-approved",
      bg: "linear-gradient(135deg, #00f0ff, #0099cc)",
      border: "#00f0ff",
      pulse: false,
      label: null
    };
  }
  
  // Pending
  return {
    class: "timetable-block-pending",
    bg: "linear-gradient(135deg, #ffff00, #ccaa00)",
    border: "#ffff00",
    pulse: false,
    label: "⏳"
  };
}

// Legacy function for backward compatibility
function timetableColor(status) {
  return status === "Approved" 
    ? "timetable-block-approved" 
    : "timetable-block-pending";
}

// ==================== REAL-TIME LISTENER ====================

const bookingsRef = ref(db, FB_PATHS.BOOKINGS);

onValue(bookingsRef, snapshot => {
  const data = snapshot.val();
  currentBookingsData = data || {};
  renderBookings(data);
  renderTimeHeader();
  renderTimetable(buildTimetableBookings(data));
  renderCurrentTimeLine();
});

// ==================== EXPORTS FOR GLOBAL ACCESS ====================

window.fetchBookings = () => {
  get(ref(db, FB_PATHS.BOOKINGS)).then(snapshot => renderBookings(snapshot.val()));
};

window.downloadCSV = () => {
  // Alias for PDF export (backward compatibility)
  window.downloadPDF();
};

window.downloadPDF = () => {
  const rows = [];
  let approvedCount = 0, pendingCount = 0, declinedCount = 0;
  let totalRevenue = 0;
  
  document.querySelectorAll(".booking-card").forEach(card => {
    const cells = Array.from(card.querySelectorAll(".export-cell")).map(cell => cell.textContent);
    if (cells.length >= 6) {
      rows.push(cells);
      // Extract price (remove ₹ symbol)
      const price = parseFloat(cells[5].replace('₹', '').replace(',', '')) || 0;
      totalRevenue += price;
    }
    
    // Count by status
    const statusBadge = card.querySelector('.status-approved, .status-pending, .status-declined');
    if (statusBadge) {
      if (statusBadge.classList.contains('status-approved')) approvedCount++;
      else if (statusBadge.classList.contains('status-pending')) pendingCount++;
      else if (statusBadge.classList.contains('status-declined')) declinedCount++;
    }
  });

  if (rows.length === 0) {
    if (window.notifyWarning) {
      window.notifyWarning("No bookings to export");
    } else {
      alert("No bookings to export");
    }
    return;
  }

  // Create PDF
  const doc = PDFExport.createStyledPDF();
  const today = new Date().toLocaleDateString('en-IN', { 
    timeZone: 'Asia/Kolkata',
    day: 'numeric', 
    month: 'long', 
    year: 'numeric' 
  });
  let y = PDFExport.addPDFHeader(doc, 'Bookings Report', today);
  
  // Summary stats
  y = PDFExport.addPDFSummary(doc, [
    { label: 'Total Bookings', value: String(rows.length), color: 'neonCyan' },
    { label: 'Approved', value: String(approvedCount), color: 'neonGreen' },
    { label: 'Pending', value: String(pendingCount), color: 'neonYellow' },
    { label: 'Revenue', value: `Rs.${totalRevenue}`, color: 'neonPurple' },
  ], y);
  
  // Table
  PDFExport.addPDFTable(doc, 
    ['Name', 'Start', 'End', 'Duration', 'PCs', 'Price'],
    rows,
    y,
    { 
      columnStyles: {
        5: { halign: 'right' } // Price column right-aligned
      }
    }
  );
  
  PDFExport.savePDF(doc, `bookings_${new Date().toISOString().slice(0, 10)}`);
  
  if (window.notifySuccess) {
    window.notifySuccess("Bookings report exported as PDF");
  }
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
  section.className = "mb-4";
  const contentId = `content-${title.replace(/\s+/g, "-").toLowerCase()}`;
  
  // Icons for different section types
  const icons = {
    "Upcoming Bookings": "🕐",
    "Ongoing Bookings": "🎮",
    "Past Bookings": "📋"
  };
  const icon = icons[title] || "📅";
  const count = cards.length;

  section.innerHTML = `
    <button onclick="document.getElementById('${contentId}').classList.toggle('hidden'); this.querySelector('.section-chevron').classList.toggle('rotate-180')"
      class="w-full flex justify-between items-center px-4 py-2.5 rounded-lg font-orbitron text-xs font-bold tracking-wider transition-all hover:bg-opacity-60"
      style="background: rgba(0,0,0,0.5); border: 1px solid rgba(255,0,68,0.2);">
      <span class="flex items-center gap-2">
        <span>${icon}</span>
        <span style="color: #ff0044;">${title}</span>
        <span class="px-2 py-0.5 rounded-full text-[10px]" style="background: rgba(255,0,68,0.2); color: #ff6666;">${count}</span>
      </span>
      <i data-lucide="chevron-down" class="w-4 h-4 section-chevron transition-transform ${collapsed ? '' : 'rotate-180'}" style="color: #ff0044;"></i>
    </button>
    <div id="${contentId}" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pt-3 ${collapsed ? "hidden" : ""}"></div>
  `;

  const contentDiv = section.querySelector(`#${contentId}`);
  cards.forEach(c => contentDiv.appendChild(c));
  document.getElementById("bookingCards").appendChild(section);
}

function renderBookings(bookingsData) {
  const container = document.getElementById("bookingCards");
  container.innerHTML = "";

  const now = getISTDate();
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
    card.className = `booking-card booking-card-${statusText.toLowerCase()}`;
    card.dataset.bookingKey = key;

    // Format time nicely
    const startTimeStr = new Date(booking.start).toLocaleTimeString("en-IN", { 
      hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" 
    });
    const endTimeStr = new Date(booking.end).toLocaleTimeString("en-IN", { 
      hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" 
    });
    const dateStr = new Date(booking.start).toLocaleDateString("en-IN", { 
      day: "numeric", month: "short", timeZone: "Asia/Kolkata" 
    });

    // Compact action info
    let actionBy = "";
    if (booking.approvedBy) {
      actionBy = `<span class="text-[9px] text-gray-600">✓ ${booking.approvedBy}</span>`;
    } else if (booking.declinedBy) {
      actionBy = `<span class="text-[9px]" style="color: #ff6666;">✕ ${booking.declinedBy}</span>`;
    }

    // Device type info
    const deviceIcons = { PC: '🖥️', XBOX: '🎮', PS: '🕹️' };
    const deviceType = booking.deviceType || 'PC';
    const deviceIcon = deviceIcons[deviceType] || '🖥️';
    const deviceName = booking.deviceName || (deviceType === 'PC' ? 'Gaming PC' : deviceType);

    card.innerHTML = `
      <div class="booking-card-clickable" onclick="openBookingModal('${key}')">
        <div class="booking-card-header">
          <div class="booking-card-name">
            <h3 class="font-orbitron export-cell">${booking.name}</h3>
            <span class="booking-status-badge ${statusClasses[statusText]}">${statusText}</span>
          </div>
          <span class="booking-card-price export-cell">₹${booking.price}</span>
        </div>
        <div class="booking-card-details">
          <span>${deviceIcon} ${deviceType === 'PC' ? booking.pcs.join(", ") : deviceName}</span>
          <span class="booking-card-divider">•</span>
          <span>${dateStr}</span>
          <span class="booking-card-divider">•</span>
          <span>${startTimeStr} → ${endTimeStr}</span>
        </div>
      </div>
      <div class="hidden">
        <span class="export-cell">${formatDate(booking.start)}</span>
        <span class="export-cell">${formatDate(booking.end)}</span>
        <span class="export-cell">${booking.duration} mins</span>
        <span class="export-cell">${booking.pcs.join(", ")}</span>
      </div>
      <div class="booking-card-actions">
        <div class="booking-card-meta">${actionBy}</div>
        <div class="booking-card-buttons">
          ${(group === "upcoming" || group === "ongoing") && statusText === "Pending" ? `
            <button onclick="approveBooking('${key}')" class="booking-action-btn booking-action-approve" title="Approve">
              <i data-lucide='check' class='w-2.5 h-2.5'></i>
            </button>
            <button onclick="declineBooking('${key}')" class="booking-action-btn booking-action-decline" title="Decline">
              <i data-lucide='x' class='w-2.5 h-2.5'></i>
            </button>
          ` : ""}
          <button onclick="deleteBooking('${key}')" class="booking-action-btn booking-action-delete" title="Delete">
            <i data-lucide="trash-2" class="w-2.5 h-2.5"></i>
          </button>
        </div>
      </div>
    `;

    groups[group].push(card);
  });

  if (groups.upcoming.length) createSection("Upcoming Bookings", groups.upcoming, false);
  if (groups.ongoing.length) createSection("Ongoing Bookings", groups.ongoing, false);
  if (groups.past.length) createSection("Past Bookings", groups.past, true);

  lucide?.createIcons();
}

// ==================== SEARCH/FILTER ====================

function filterBookings(searchTerm) {
  const cards = document.querySelectorAll(".booking-card");
  const term = searchTerm.toLowerCase().trim();
  const clearBtn = document.getElementById("bookingSearchClear");
  
  // Show/hide clear button
  if (clearBtn) {
    clearBtn.classList.toggle("hidden", !term);
  }
  
  cards.forEach(card => {
    const name = card.querySelector("h3")?.textContent?.toLowerCase() || "";
    const match = !term || name.includes(term);
    card.style.display = match ? "" : "none";
  });
  
  // Update section visibility and counts
  document.querySelectorAll("#bookingCards > div").forEach(section => {
    const visibleCards = section.querySelectorAll(".booking-card:not([style*='display: none'])");
    const countBadge = section.querySelector(".rounded-full");
    if (countBadge) {
      countBadge.textContent = visibleCards.length;
    }
    // Hide section if no visible cards
    const contentDiv = section.querySelector("[id^='content-']");
    if (contentDiv && visibleCards.length === 0) {
      section.style.display = "none";
    } else {
      section.style.display = "";
    }
  });
}

window.filterBookings = filterBookings;

// ==================== BOOKING DETAILS MODAL ====================

function openBookingModal(bookingKey) {
  const booking = currentBookingsData[bookingKey];
  if (!booking) {
    window.notifyError?.("Booking not found");
    return;
  }
  
  const modal = document.getElementById("bookingDetailsModal");
  if (!modal) return;
  
  // Determine status
  const now = getISTDate();
  const startTime = new Date(booking.start);
  const endTime = new Date(booking.end);
  const isExpired = endTime < now;
  const statusText = isExpired ? "Expired" : (booking.status || "Pending");
  
  // Format dates
  const dateStr = startTime.toLocaleDateString("en-IN", { 
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" 
  });
  const startTimeStr = startTime.toLocaleTimeString("en-IN", { 
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" 
  });
  const endTimeStr = endTime.toLocaleTimeString("en-IN", { 
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" 
  });
  
  // Calculate duration in minutes
  const durationMins = Math.round((endTime - startTime) / 60000);
  const hours = Math.floor(durationMins / 60);
  const mins = durationMins % 60;
  const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  
  // Device type info
  const deviceIcons = { PC: '🖥️', XBOX: '🎮', PS: '🕹️' };
  const deviceType = booking.deviceType || 'PC';
  const deviceIcon = deviceIcons[deviceType] || '🖥️';
  const deviceName = booking.deviceName || (deviceType === 'PC' ? 'Gaming PC' : deviceType);

  // Populate modal
  document.getElementById("bookingModalName").textContent = booking.name || "Unknown";
  document.getElementById("bookingModalDate").textContent = dateStr;
  document.getElementById("bookingModalPC").textContent = deviceType === 'PC' 
    ? `${deviceIcon} ${booking.pcs?.join(", ") || "-"}` 
    : `${deviceIcon} ${deviceName}`;
  document.getElementById("bookingModalTime").textContent = `${startTimeStr} → ${endTimeStr}`;
  document.getElementById("bookingModalDuration").textContent = durationStr;
  document.getElementById("bookingModalPrice").textContent = `₹${booking.price || 0}`;
  
  // Status badge
  const statusColors = {
    Pending: { bg: "rgba(255,255,0,0.15)", border: "rgba(255,255,0,0.4)", color: "#ffff00" },
    Approved: { bg: "rgba(0,255,136,0.15)", border: "rgba(0,255,136,0.4)", color: "#00ff88" },
    Declined: { bg: "rgba(255,0,68,0.15)", border: "rgba(255,0,68,0.4)", color: "#ff0044" },
    Expired: { bg: "rgba(100,100,100,0.15)", border: "rgba(100,100,100,0.4)", color: "#888" }
  };
  const statusStyle = statusColors[statusText] || statusColors.Pending;
  document.getElementById("bookingModalStatus").innerHTML = 
    `<span class="px-2 py-0.5 rounded text-[10px] font-bold" style="background: ${statusStyle.bg}; border: 1px solid ${statusStyle.border}; color: ${statusStyle.color};">${statusText}</span>`;
  
  // Action info
  const actionInfo = document.getElementById("bookingModalActionInfo");
  if (booking.approvedBy) {
    actionInfo.innerHTML = `<span style="color: #00ff88;">✓ Approved by ${booking.approvedBy}</span>`;
    actionInfo.classList.remove("hidden");
  } else if (booking.declinedBy) {
    actionInfo.innerHTML = `<span style="color: #ff0044;">✕ Declined by ${booking.declinedBy}</span>`;
    actionInfo.classList.remove("hidden");
  } else {
    actionInfo.classList.add("hidden");
  }
  
  // Note
  const noteWrapper = document.getElementById("bookingModalNoteWrapper");
  if (booking.note) {
    document.getElementById("bookingModalNote").textContent = booking.note;
    noteWrapper.classList.remove("hidden");
  } else {
    noteWrapper.classList.add("hidden");
  }
  
  // Action buttons
  const actionsDiv = document.getElementById("bookingModalActions");
  let actionsHtml = "";
  
  if (!isExpired && statusText === "Pending") {
    actionsHtml += `
      <button onclick="approveBooking('${bookingKey}'); closeBookingModal();" 
        class="flex-1 py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110"
        style="background: linear-gradient(135deg, rgba(0,255,136,0.2), rgba(0,200,100,0.1)); border: 1px solid #00ff88; color: #00ff88;">
        <i data-lucide="check" class="w-4 h-4"></i> Approve
      </button>
      <button onclick="declineBooking('${bookingKey}'); closeBookingModal();" 
        class="flex-1 py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110"
        style="background: linear-gradient(135deg, rgba(255,107,0,0.2), rgba(200,80,0,0.1)); border: 1px solid #ff6b00; color: #ff6b00;">
        <i data-lucide="x" class="w-4 h-4"></i> Decline
      </button>
    `;
  }
  
  actionsHtml += `
    <button onclick="deleteBooking('${bookingKey}'); closeBookingModal();" 
      class="py-2.5 px-4 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110"
      style="background: linear-gradient(135deg, rgba(255,0,68,0.2), rgba(200,0,50,0.1)); border: 1px solid #ff0044; color: #ff0044;">
      <i data-lucide="trash-2" class="w-4 h-4"></i> Delete
    </button>
  `;
  
  actionsDiv.innerHTML = actionsHtml;
  
  // Show modal
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  
  // Reinitialize lucide icons
  lucide?.createIcons();
}

function closeBookingModal() {
  const modal = document.getElementById("bookingDetailsModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

window.openBookingModal = openBookingModal;
window.closeBookingModal = closeBookingModal;

// ==================== TIMETABLE ====================

function buildTimetableBookings(bookingsData) {
  if (!bookingsData) return [];

  const today = getISTToday();

  return Object.entries(bookingsData)
    .map(([key, b]) => {
      if (!Array.isArray(b.pcs) || !b.pcs.length) return null;

      const startDate = new Date(b.start);
      if (startDate < today || startDate >= new Date(today.getTime() + 86400000)) return null;

      // Handle device type
      const deviceType = b.deviceType || 'PC';
      let pc;
      
      if (deviceType === 'XBOX') {
        pc = "XBOX ONE X";
      } else if (deviceType === 'PS') {
        pc = "PS";
      } else {
        // PC - map to timetable PC names
        const slot = b.pcs[0].toUpperCase();
        if (/^T\d+$/.test(slot)) pc = `T-ROOM-${slot.slice(1)}`;
        else if (/^CT\d+$/.test(slot)) pc = `CT-ROOM-${slot.slice(2)}`;
        else return null;
      }

      return {
        key,
        pc,
        name: b.name || "Booking",
        start: timetableTimeIndex(b.start),
        end: timetableTimeIndex(b.end),
        status: b.status || "Pending",
        startTime: b.start,
        endTime: b.end,
        deviceType
      };
    })
    .filter(Boolean);
}

function renderTimeHeader() {
  const header = document.getElementById("timeHeader");
  if (!header) return;

  header.innerHTML = "<div></div>";
  for (let h = TIMETABLE_START_HOUR; h < TIMETABLE_END_HOUR; h++) {
    header.innerHTML += `<div class="text-center font-orbitron text-[10px]" style="border-left: 1px solid rgba(255,0,68,0.2); color: #666;">${h}</div>`;
  }
}

function renderTimetable(timetableBookings) {
  const body = document.getElementById("timetableBody");
  if (!body) return;

  body.innerHTML = "";

  TIMETABLE_PCS.forEach(pc => {
    const row = document.createElement("div");
    row.className = "timetable-row grid grid-cols-[140px_repeat(12,_1fr)] relative h-10 rounded";

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

        const leftPercent = ((start - TIMETABLE_START_HOUR) / TIMETABLE_TOTAL_HOURS) * 100;
        const widthPercent = ((end - start) / TIMETABLE_TOTAL_HOURS) * 100;
        
        // Get dynamic styling based on status and time
        const style = getTimetableBlockStyle(b);

        const block = document.createElement("div");
        block.className = `timetable-block ${style.class} ${style.pulse ? 'timetable-pulse' : ''}`;
        block.style.left = `calc(${PC_COL_WIDTH}px + (100% - ${PC_COL_WIDTH}px) * ${leftPercent / 100})`;
        block.style.width = `calc((100% - ${PC_COL_WIDTH}px) * ${widthPercent / 100} - 4px)`;
        block.style.background = style.bg;
        block.style.borderColor = style.border;
        block.style.cursor = "pointer";
        block.dataset.bookingKey = b.key;
        
        // Click handler to open booking modal
        block.addEventListener("click", () => openBookingModal(b.key));
        
        // Content with optional status label
        const labelHtml = style.label ? `<span class="timetable-label">${style.label}</span>` : '';
        block.innerHTML = `<span class="timetable-name">${b.name}</span>${labelHtml}`;

        row.appendChild(block);
      });

    body.appendChild(row);
  });
  
  // Update legend counts
  updateTimetableLegend(timetableBookings);
}

function updateTimetableLegend(bookings) {
  const now = getISTDate();
  
  let running = 0, soon = 0, approved = 0, pending = 0;
  
  bookings.forEach(b => {
    const startTime = new Date(b.startTime);
    const endTime = new Date(b.endTime);
    const minutesUntilStart = (startTime - now) / 60000;
    
    if (startTime <= now && endTime > now) {
      running++;
    } else if (minutesUntilStart > 0 && minutesUntilStart <= 15 && b.status === "Approved") {
      soon++;
    } else if (b.status === "Approved") {
      approved++;
    } else {
      pending++;
    }
  });
  
  // Update legend badges if they exist
  const runningEl = document.getElementById("legendRunning");
  const soonEl = document.getElementById("legendSoon");
  const approvedEl = document.getElementById("legendApproved");
  const pendingEl = document.getElementById("legendPending");
  
  if (runningEl) runningEl.textContent = running;
  if (soonEl) soonEl.textContent = soon;
  if (approvedEl) approvedEl.textContent = approved;
  if (pendingEl) pendingEl.textContent = pending;
}

function renderCurrentTimeLine() {
  const inner = document.getElementById("timetableInner");
  if (!inner) return;

  const oldLine = document.getElementById("currentTimeLine");
  if (oldLine) oldLine.remove();

  // Use IST timezone for current time
  const now = getISTDate();
  const hours = now.getHours() + now.getMinutes() / 60;

  if (hours < TIMETABLE_START_HOUR || hours > TIMETABLE_END_HOUR) return;

  const timePercent = ((hours - TIMETABLE_START_HOUR) / TIMETABLE_TOTAL_HOURS) * 100;

  const line = document.createElement("div");
  line.id = "currentTimeLine";
  line.className = "absolute top-0 bottom-0 w-[2px] z-20 pointer-events-none";
  // Position relative to the time slots area (after the PC column)
  line.style.left = `calc(${PC_COL_WIDTH}px + (100% - ${PC_COL_WIDTH}px) * ${timePercent / 100})`;
  line.style.background = "#ff0044";
  line.style.boxShadow = "0 0 10px #ff0044";

  inner.appendChild(line);
}

setInterval(renderCurrentTimeLine, 60 * 1000);
