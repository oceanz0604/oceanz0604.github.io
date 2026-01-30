/**
 * OceanZ Gaming Cafe - POS Counter
 * 
 * Full-featured POS interface with recharges, bookings, credits, and sync.
 */

import { 
  BOOKING_DB_CONFIG, 
  FDB_DATASET_CONFIG, 
  BOOKING_APP_NAME, 
  FDB_APP_NAME, 
  AUTH_APP_NAME, 
  FB_PATHS, 
  CONSTANTS,
  SharedCache 
} from "../../shared/config.js";
import { getISTDate, getTodayIST, getISTTimestamp } from "../../shared/utils.js";
import { getStaffSession, clearStaffSession, logStaffActivity } from "./permissions.js";
import { notifySuccess, notifyError, notifyWarning, showConfirm } from "../../shared/notify.js";
import { MemberSearch } from "../../shared/member-search.js";

// ==================== FIREBASE INIT ====================

function waitForFirebase(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (typeof firebase !== 'undefined' && firebase.apps) {
      resolve();
      return;
    }
    
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (typeof firebase !== 'undefined' && firebase.apps) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('Firebase SDK not loaded'));
      }
    }, 100);
  });
}

let authApp, bookingApp, fdbApp, auth, bookingDb, fdbDb;
let firebaseReady = false;

async function initFirebase() {
  if (firebaseReady) return true;
  
  try {
    await waitForFirebase();
    
    authApp = firebase.apps.find(a => a.name === AUTH_APP_NAME) || firebase.initializeApp(BOOKING_DB_CONFIG, AUTH_APP_NAME);
    bookingApp = firebase.apps.find(a => a.name === BOOKING_APP_NAME) || firebase.initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);
    fdbApp = firebase.apps.find(a => a.name === FDB_APP_NAME) || firebase.initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);
    
    auth = authApp.auth();
    bookingDb = bookingApp.database();
    fdbDb = fdbApp.database();
    
    firebaseReady = true;
    console.log("✅ Counter: Firebase initialized");
    return true;
  } catch (error) {
    console.error("❌ Counter: Firebase init failed:", error);
    return false;
  }
}

// ==================== STATE ====================

let selectedMember = "";
let selectedAmount = 0;
let freeAmount = 0;
let paymentMode = "cash"; // cash, upi, split, credit
let splitCash = 0;
let splitUpi = 0;
let allMembers = [];
let stats = { cash: 0, upi: 0, credit: 0, count: 0 };
let recentTx = [];
let memberSearch = null;
let allRecharges = {};
let pendingBookings = [];
let todayBookings = [];
let outstandingCredits = [];
let collectingCredit = null;

// ==================== DOM ELEMENTS ====================

const $ = id => document.getElementById(id);

// ==================== AUTH CHECK ====================

async function checkAuthAndInit() {
  try {
    const ready = await initFirebase();
    if (!ready) {
      console.error("❌ Firebase failed to initialize");
      $("loadingScreen").innerHTML = `
        <div class="text-center">
          <div class="text-red-500 text-xl mb-2">⚠️</div>
          <p class="text-gray-500 text-sm">Failed to load. Please refresh.</p>
        </div>
      `;
      return;
    }
    
    auth.onAuthStateChanged(user => {
      if (!user || !getStaffSession()) {
        window.location.replace("index.html");
        return;
      }
      init(getStaffSession());
    });
  } catch (error) {
    console.error("❌ Counter init error:", error);
  }
}

checkAuthAndInit();

// ==================== INITIALIZATION ====================

async function init(session) {
  $("loadingScreen")?.classList.add("hidden");
  $("posApp")?.classList.remove("hidden");
  
  if (typeof lucide !== "undefined") lucide.createIcons();
  
  if ($("userName")) $("userName").textContent = session.name || session.email;
  
  updateDateTime();
  setInterval(updateDateTime, 60000);
  
  await initFirebase();
  await loadMembers();
  setupMemberSearch();
  setupAmountButtons();
  setupRealtimeUpdates();
  loadBookings();
  loadCredits();
  
  console.log("✅ POS Counter initialized");
}

function updateDateTime() {
  const now = getISTDate();
  if ($("dateTime")) {
    $("dateTime").textContent = now.toLocaleString("en-IN", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true
    });
  }
}

// ==================== TAB SWITCHING ====================

window.switchPosTab = (tab) => {
  document.querySelectorAll(".pos-tab").forEach(t => t.classList.remove("active"));
  document.querySelector(`.pos-tab[data-tab="${tab}"]`)?.classList.add("active");
  
  document.querySelectorAll(".pos-panel").forEach(p => p.classList.remove("active"));
  $(`${tab}Panel`)?.classList.add("active");
  
  if (typeof lucide !== "undefined") lucide.createIcons();
};

// ==================== MEMBERS ====================

async function loadMembers() {
  try {
    const rawData = await SharedCache.getMembersRaw(fdbDb, FB_PATHS.MEMBERS);
    
    allMembers = Object.entries(rawData).map(([username, memberData]) => {
      const profile = memberData.profile || {};
      const balance = memberData.balance || {};
      return {
        USERNAME: username,
        DISPLAY_NAME: profile.DISPLAY_NAME || username,
        FIRSTNAME: profile.FIRSTNAME || "",
        LASTNAME: profile.LASTNAME || "",
        BALANCE: balance.current_balance || 0,
        PASSWORD: profile.PASSWORD || ""
      };
    });
    console.log(`✅ Loaded ${allMembers.length} members`);
  } catch (error) {
    console.error("Failed to load members:", error);
    allMembers = [];
  }
}

function setupMemberSearch() {
  const input = $("memberInput");
  const suggestions = $("suggestions");
  if (!input || !suggestions) return;
  
  memberSearch = new MemberSearch({
    inputElement: input,
    suggestionsElement: suggestions,
    includeGuests: true,
    onSelect: (member) => {
      selectedMember = member;
      updateUI();
    }
  });
  
  memberSearch.setMembers(allMembers);
}

// ==================== AMOUNT BUTTONS ====================

function setupAmountButtons() {
  // Regular amount buttons (not combo)
  document.querySelectorAll(".amount-btn[data-amount]:not(.combo)").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".amount-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedAmount = parseInt(btn.dataset.amount);
      freeAmount = 0;
      if ($("customAmount")) $("customAmount").value = "";
      if ($("freeAmount")) $("freeAmount").value = "";
      updateUI();
    });
  });
  
  $("customAmount")?.addEventListener("input", (e) => {
    document.querySelectorAll(".amount-btn").forEach(b => b.classList.remove("selected"));
    e.target.closest(".amount-btn")?.classList.add("selected");
    selectedAmount = parseInt(e.target.value) || 0;
    freeAmount = 0;
    if ($("freeAmount")) $("freeAmount").value = "";
    updateUI();
  });
  
  $("freeAmount")?.addEventListener("input", (e) => {
    freeAmount = parseInt(e.target.value) || 0;
    updateUI();
  });
}

// Select combo (amount + free)
window.selectCombo = (amount, free) => {
  document.querySelectorAll(".amount-btn").forEach(b => b.classList.remove("selected"));
  const comboBtn = document.querySelector(`.amount-btn.combo[data-amount="${amount}"][data-free="${free}"]`);
  comboBtn?.classList.add("selected");
  
  selectedAmount = amount;
  freeAmount = free;
  
  if ($("customAmount")) $("customAmount").value = "";
  if ($("freeAmount")) $("freeAmount").value = free;
  
  updateUI();
};

// ==================== PAYMENT MODE ====================

window.selectPaymentMode = (mode) => {
  paymentMode = mode;
  document.querySelectorAll(".payment-opt").forEach(b => b.classList.remove("selected"));
  document.querySelector(`.payment-opt.${mode}`)?.classList.add("selected");
  
  const splitFields = $("splitFields");
  if (mode === "split") {
    splitFields?.classList.remove("hidden");
  } else {
    splitFields?.classList.add("hidden");
    splitCash = 0;
    splitUpi = 0;
    if ($("splitCash")) $("splitCash").value = "";
    if ($("splitUpi")) $("splitUpi").value = "";
  }
  
  updateUI();
};

window.updateSplitTotal = () => {
  splitCash = parseInt($("splitCash")?.value) || 0;
  splitUpi = parseInt($("splitUpi")?.value) || 0;
  updateUI();
};

// ==================== UI UPDATE ====================

function updateUI() {
  const total = selectedAmount + freeAmount;
  
  if ($("totalDisplay")) $("totalDisplay").textContent = `₹${total}`;
  
  if ($("breakdownDisplay")) {
    let breakdown = "";
    if (selectedAmount > 0) {
      if (paymentMode === "split" && (splitCash > 0 || splitUpi > 0)) {
        const parts = [];
        if (splitCash > 0) parts.push(`₹${splitCash} cash`);
        if (splitUpi > 0) parts.push(`₹${splitUpi} upi`);
        breakdown = parts.join(" + ");
      } else {
        breakdown = `₹${selectedAmount} ${paymentMode}`;
      }
    }
    if (freeAmount > 0) breakdown += (breakdown ? " + " : "") + `₹${freeAmount} free`;
    $("breakdownDisplay").textContent = breakdown || "Select amount";
  }
  
  // Validate split payment
  let canConfirm = selectedMember && (selectedAmount > 0 || freeAmount > 0);
  if (paymentMode === "split" && selectedAmount > 0) {
    canConfirm = canConfirm && (splitCash + splitUpi === selectedAmount);
  }
  
  if ($("confirmBtn")) $("confirmBtn").disabled = !canConfirm;
}

// ==================== REALTIME UPDATES ====================

function setupRealtimeUpdates() {
  const today = getTodayIST();
  
  // Listen to today's recharges for recent transactions
  bookingDb.ref(`${FB_PATHS.RECHARGES}/${today}`).on("value", snap => {
    const data = snap.val() || {};
    allRecharges = data;
    recentTx = [];
    
    Object.entries(data).forEach(([id, r]) => {
      recentTx.push({
        id,
        member: r.member,
        amount: (r.total || 0) + (r.free || 0),
        cash: r.cash || 0,
        upi: r.upi || 0,
        credit: r.credit || 0,
        time: r.createdAt
      });
    });
    
    recentTx.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
    updateRecent();
  });
  
  // Listen to ALL recharges for accurate stats (includes credit collections)
  bookingDb.ref(FB_PATHS.RECHARGES).on("value", snap => {
    stats = { cash: 0, upi: 0, pending: 0, count: 0 };
    
    snap.forEach(dateSnap => {
      const isToday = dateSnap.key === today;
      
      dateSnap.forEach(txSnap => {
        const r = txSnap.val();
        
        // Count today's direct transactions
        if (isToday) {
          stats.count++;
          stats.cash += (r.cash || 0);
          stats.upi += (r.upi || 0);
        }
        
        // Count today's credit collections (from ANY date's recharge)
        if (r.creditPayments && r.creditPayments[today]) {
          const payment = r.creditPayments[today];
          stats.cash += (payment.cash || 0);
          stats.upi += (payment.upi || 0);
        }
        
        // Track pending collections (outstanding credit)
        const credit = r.credit || 0;
        const creditPaid = r.creditPaid || 0;
        const outstanding = credit - creditPaid;
        if (outstanding > 0) {
          stats.pending += outstanding;
        }
      });
    });
    
    updateStats();
  });
}

function updateStats() {
  if ($("statCash")) $("statCash").textContent = `₹${stats.cash}`;
  if ($("statUpi")) $("statUpi").textContent = `₹${stats.upi}`;
  if ($("statPending")) $("statPending").textContent = `₹${stats.pending}`;
  if ($("statCount")) $("statCount").textContent = stats.count;
  
  // Summary in More tab
  if ($("summaryCash")) $("summaryCash").textContent = `₹${stats.cash}`;
  if ($("summaryUpi")) $("summaryUpi").textContent = `₹${stats.upi}`;
  if ($("summaryPending")) $("summaryPending").textContent = `₹${stats.pending}`;
  if ($("summaryTotal")) $("summaryTotal").textContent = `₹${stats.cash + stats.upi}`;
}

function updateRecent() {
  const list = $("recentList");
  if (!list) return;
  
  const recent = recentTx.slice(0, 10);
  
  if (recent.length === 0) {
    list.innerHTML = '<div class="empty-state"><p class="text-sm">No transactions yet</p></div>';
    return;
  }
  
  list.innerHTML = recent.map(tx => {
    let time = "-";
    if (tx.time) {
      try {
        const d = new Date(tx.time);
        if (!isNaN(d)) time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
      } catch(e) {}
    }
    
    let modeIcon = "💵";
    if (tx.credit > 0) modeIcon = "⏰";
    else if (tx.upi > 0 && tx.cash > 0) modeIcon = "✂️";
    else if (tx.upi > 0) modeIcon = "📱";
    
    return `
      <div class="recent-item">
        <div class="info">
          <span class="member">${tx.member || "?"}</span>
          <span class="time">${time} ${modeIcon}</span>
        </div>
        <div class="amount">₹${tx.amount || 0}</div>
      </div>
    `;
  }).join("");
}

// ==================== BOOKINGS ====================

let ongoingBookings = [];
let upcomingBookings = [];

async function loadBookings() {
  const now = getISTDate();
  const today = getTodayIST();
  
  // Calculate tomorrow's date
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  
  try {
    // Load ALL bookings and categorize them
    bookingDb.ref(FB_PATHS.BOOKINGS).on("value", snap => {
      pendingBookings = [];
      todayBookings = [];
      ongoingBookings = [];
      upcomingBookings = [];
      
      const bookingsData = snap.val() || {};
      
      Object.entries(bookingsData).forEach(([key, booking]) => {
        const bookingObj = { id: key, ...booking };
        
        // Get start and end times
        const startTime = booking.start ? new Date(booking.start) : null;
        const endTime = booking.end ? new Date(booking.end) : null;
        
        if (!startTime) return; // Skip invalid bookings
        
        const bookingDate = startTime.toISOString().split('T')[0];
        const status = (booking.status || "Pending").toLowerCase();
        
        // Only show today and tomorrow bookings
        if (bookingDate !== today && bookingDate !== tomorrowStr) return;
        
        // Categorize bookings
        if (status === "pending") {
          pendingBookings.push(bookingObj);
        } else if (status === "approved") {
          // Check if ongoing (current time within booking time)
          if (startTime <= now && endTime && endTime > now) {
            ongoingBookings.push(bookingObj);
          } else if (startTime > now) {
            upcomingBookings.push(bookingObj);
          } else {
            // Past approved booking (today but ended)
            todayBookings.push(bookingObj);
          }
        } else if (status === "declined" || status === "expired") {
          // Skip declined/expired
        }
      });
      
      // Sort bookings by start time
      pendingBookings.sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));
      ongoingBookings.sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));
      upcomingBookings.sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));
      todayBookings.sort((a, b) => new Date(b.start || 0) - new Date(a.start || 0));
      
      renderPendingBookings();
      renderOngoingBookings();
      renderUpcomingBookings();
      renderCompletedBookings();
      updateBadges();
      
      console.log(`📅 Bookings: ${pendingBookings.length} pending, ${ongoingBookings.length} ongoing, ${upcomingBookings.length} upcoming, ${todayBookings.length} completed`);
    });
  } catch (error) {
    console.error("Error loading bookings:", error);
  }
}

function formatBookingTime(booking) {
  if (!booking.start) return "-";
  const start = new Date(booking.start);
  const timeStr = start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  const dateStr = start.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const today = getTodayIST();
  const bookingDate = start.toISOString().split('T')[0];
  
  if (bookingDate === today) {
    return timeStr;
  }
  return `${dateStr} ${timeStr}`;
}

function getBookingDuration(booking) {
  if (!booking.start || !booking.end) return "1h";
  const start = new Date(booking.start);
  const end = new Date(booking.end);
  const hours = Math.round((end - start) / (1000 * 60 * 60));
  return `${hours}h`;
}

function renderPendingBookings() {
  const container = $("pendingBookings");
  if (!container) return;
  
  if (pendingBookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="check-circle" class="w-8 h-8"></i>
        <p class="text-sm">No pending bookings</p>
      </div>
    `;
    if (typeof lucide !== "undefined") lucide.createIcons();
    return;
  }
  
  container.innerHTML = pendingBookings.map(b => `
    <div class="booking-item pending">
      <div class="info">
        <div class="name">${b.member || b.name || "Unknown"}</div>
        <div class="details">${formatBookingTime(b)} • ${getBookingDuration(b)} • ${b.pc || "Any"}</div>
      </div>
      <div class="actions">
        <button class="booking-action approve" onclick="approveBooking('${b.id}')">✓</button>
        <button class="booking-action decline" onclick="declineBooking('${b.id}')">✕</button>
      </div>
    </div>
  `).join("");
  
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function renderOngoingBookings() {
  const container = $("ongoingBookings");
  if (!container) return;
  
  if (ongoingBookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="users" class="w-8 h-8"></i>
        <p class="text-sm">No active sessions</p>
      </div>
    `;
    if (typeof lucide !== "undefined") lucide.createIcons();
    return;
  }
  
  container.innerHTML = ongoingBookings.map(b => `
    <div class="booking-item ongoing">
      <div class="info">
        <div class="name">${b.member || b.name || "Unknown"}</div>
        <div class="details">${formatBookingTime(b)} • ${getBookingDuration(b)} • ${b.pc || "Any"}</div>
      </div>
      <div class="status-badge" style="background: var(--pos-green); color: #000; padding: 4px 8px; border-radius: 4px; font-size: 0.65rem;">🎮 LIVE</div>
    </div>
  `).join("");
  
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function renderUpcomingBookings() {
  const container = $("todayBookings");
  if (!container) return;
  
  if (upcomingBookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="calendar-x" class="w-8 h-8"></i>
        <p class="text-sm">No upcoming bookings</p>
      </div>
    `;
    if (typeof lucide !== "undefined") lucide.createIcons();
    return;
  }
  
  container.innerHTML = upcomingBookings.map(b => `
    <div class="booking-item">
      <div class="info">
        <div class="name">${b.member || b.name || "Unknown"}</div>
        <div class="details">${formatBookingTime(b)} • ${getBookingDuration(b)} • ${b.pc || "Any"}</div>
      </div>
    </div>
  `).join("");
  
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function renderCompletedBookings() {
  const container = $("pastBookings");
  if (!container) return;
  
  if (todayBookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="check-circle" class="w-8 h-8"></i>
        <p class="text-sm">No completed sessions</p>
      </div>
    `;
    if (typeof lucide !== "undefined") lucide.createIcons();
    return;
  }
  
  container.innerHTML = todayBookings.map(b => `
    <div class="booking-item past" style="opacity: 0.7;">
      <div class="info">
        <div class="name">${b.member || b.name || "Unknown"}</div>
        <div class="details">${formatBookingTime(b)} • ${getBookingDuration(b)}</div>
      </div>
      <div class="status-badge" style="background: rgba(255,255,255,0.1); color: #888; padding: 4px 8px; border-radius: 4px; font-size: 0.65rem;">DONE</div>
    </div>
  `).join("");
  
  if (typeof lucide !== "undefined") lucide.createIcons();
}

window.approveBooking = async (id) => {
  try {
    await bookingDb.ref(`${FB_PATHS.BOOKINGS}/${id}`).update({
      status: "approved",
      approvedAt: getISTTimestamp(),
      approvedBy: getStaffSession()?.name || "Admin"
    });
    notifySuccess("Booking approved!");
    await logStaffActivity("booking_approve", "Approved booking", id);
  } catch (error) {
    console.error("Error approving booking:", error);
    notifyError("Failed to approve booking");
  }
};

window.declineBooking = async (id) => {
  const confirmed = await showConfirm("Decline this booking?", "The member will be notified.");
  if (!confirmed) return;
  
  try {
    await bookingDb.ref(`${FB_PATHS.BOOKINGS}/${id}`).update({
      status: "declined",
      declinedAt: getISTTimestamp(),
      declinedBy: getStaffSession()?.name || "Admin"
    });
    notifySuccess("Booking declined");
    await logStaffActivity("booking_decline", "Declined booking", id);
  } catch (error) {
    console.error("Error declining booking:", error);
    notifyError("Failed to decline booking");
  }
};

// ==================== CREDITS ====================

async function loadCredits() {
  try {
    // Get all recharges with outstanding credit
    bookingDb.ref(FB_PATHS.RECHARGES).on("value", snap => {
      outstandingCredits = [];
      let totalOutstanding = 0;
      let collectedToday = 0;
      const today = getTodayIST();
      
      snap.forEach(dateSnap => {
        dateSnap.forEach(txSnap => {
          const tx = txSnap.val();
          const credit = tx.credit || 0;
          const creditPaid = tx.creditPaid || 0;
          const outstanding = credit - creditPaid;
          
          if (outstanding > 0) {
            outstandingCredits.push({
              id: txSnap.key,
              date: dateSnap.key,
              member: tx.member,
              credit,
              creditPaid,
              outstanding,
              createdAt: tx.createdAt
            });
            totalOutstanding += outstanding;
          }
          
          // Check for today's collections
          if (tx.creditPayments) {
            Object.entries(tx.creditPayments).forEach(([payDate, payment]) => {
              if (payDate === today) {
                collectedToday += (payment.cash || 0) + (payment.upi || 0);
              }
            });
          }
        });
      });
      
      // Sort by date (newest first)
      outstandingCredits.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      
      renderCredits();
      updateBadges();
      
      if ($("totalCredits")) $("totalCredits").textContent = `₹${totalOutstanding}`;
      if ($("collectedToday")) $("collectedToday").textContent = `₹${collectedToday}`;
    });
  } catch (error) {
    console.error("Error loading credits:", error);
  }
}

function renderCredits() {
  const container = $("creditsList");
  if (!container) return;
  
  if (outstandingCredits.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="check-circle" class="w-8 h-8"></i>
        <p class="text-sm">No outstanding credits</p>
      </div>
    `;
    if (typeof lucide !== "undefined") lucide.createIcons();
    return;
  }
  
  container.innerHTML = outstandingCredits.map(c => {
    const dateStr = new Date(c.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    return `
      <div class="credit-item">
        <div>
          <div class="member">${c.member}</div>
          <div class="text-xs text-gray-500">${dateStr} • Paid: ₹${c.creditPaid}/${c.credit}</div>
        </div>
        <div class="flex items-center gap-3">
          <div class="amount">₹${c.outstanding}</div>
          <button class="collect-btn" onclick="openCollectModal('${c.date}', '${c.id}', '${c.member}', ${c.outstanding})">Collect</button>
        </div>
      </div>
    `;
  }).join("");
  
  if (typeof lucide !== "undefined") lucide.createIcons();
}

window.openCollectModal = (date, id, member, amount) => {
  collectingCredit = { date, id, member, amount };
  
  $("collectMemberName").textContent = member;
  $("collectAmount").textContent = `₹${amount}`;
  $("collectCash").value = "";
  $("collectUpi").value = "";
  $("collectTotal").textContent = "₹0";
  
  $("collectModal")?.classList.remove("hidden");
  if (typeof lucide !== "undefined") lucide.createIcons();
};

window.closeCollectModal = () => {
  $("collectModal")?.classList.add("hidden");
  collectingCredit = null;
};

window.updateCollectTotal = () => {
  const cash = parseInt($("collectCash")?.value) || 0;
  const upi = parseInt($("collectUpi")?.value) || 0;
  $("collectTotal").textContent = `₹${cash + upi}`;
};

window.confirmCollect = async () => {
  if (!collectingCredit) return;
  
  const cash = parseInt($("collectCash")?.value) || 0;
  const upi = parseInt($("collectUpi")?.value) || 0;
  const total = cash + upi;
  
  if (total <= 0) {
    notifyWarning("Enter amount to collect");
    return;
  }
  
  if (total > collectingCredit.amount) {
    notifyWarning("Amount exceeds outstanding credit");
    return;
  }
  
  const session = getStaffSession();
  const today = getTodayIST();
  
  try {
    // Get current recharge data
    const txRef = bookingDb.ref(`${FB_PATHS.RECHARGES}/${collectingCredit.date}/${collectingCredit.id}`);
    const snap = await txRef.once("value");
    const tx = snap.val();
    
    if (!tx) {
      notifyError("Transaction not found");
      return;
    }
    
    const newCreditPaid = (tx.creditPaid || 0) + total;
    
    // Update the recharge with payment info
    const updates = {
      creditPaid: newCreditPaid,
      [`creditPayments/${today}`]: {
        cash,
        upi,
        total,
        collectedBy: session?.name || session?.email || "Admin",
        collectedAt: getISTTimestamp()
      }
    };
    
    await txRef.update(updates);
    
    // Log activity
    await logStaffActivity("credit_collect", "Credit collection", `${collectingCredit.member}: ₹${total}`);
    
    notifySuccess(`Collected ₹${total} from ${collectingCredit.member}`);
    closeCollectModal();
    
    // Show success flash
    const flash = $("successFlash");
    if (flash) {
      flash.style.display = "flex";
      setTimeout(() => flash.style.display = "none", 400);
    }
  } catch (error) {
    console.error("Error collecting credit:", error);
    notifyError("Failed to collect credit");
  }
};

// ==================== BADGES ====================

function updateBadges() {
  const pendingBadge = $("pendingBadge");
  if (pendingBadge) {
    if (pendingBookings.length > 0) {
      pendingBadge.textContent = pendingBookings.length;
      pendingBadge.classList.remove("hidden");
    } else {
      pendingBadge.classList.add("hidden");
    }
  }
  
  const creditBadge = $("creditBadge");
  if (creditBadge) {
    if (outstandingCredits.length > 0) {
      creditBadge.textContent = outstandingCredits.length;
      creditBadge.classList.remove("hidden");
    } else {
      creditBadge.classList.add("hidden");
    }
  }
}

// ==================== CONFIRM RECHARGE ====================

window.confirmRecharge = async () => {
  if (!selectedMember || (selectedAmount <= 0 && freeAmount <= 0)) return;
  
  // Validate split payment
  if (paymentMode === "split" && selectedAmount > 0) {
    if (splitCash + splitUpi !== selectedAmount) {
      notifyWarning("Split amounts must equal total amount");
      return;
    }
  }
  
  const session = getStaffSession();
  if (!session) {
    window.location.replace("index.html");
    return;
  }
  
  const btn = $("confirmBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "...";
  }
  
  try {
    const today = getTodayIST();
    
    // Calculate cash and UPI based on payment mode
    let cashAmount = 0, upiAmount = 0, creditAmount = 0;
    
    if (paymentMode === "cash") {
      cashAmount = selectedAmount;
    } else if (paymentMode === "upi") {
      upiAmount = selectedAmount;
    } else if (paymentMode === "split") {
      cashAmount = splitCash;
      upiAmount = splitUpi;
    } else if (paymentMode === "credit") {
      creditAmount = selectedAmount;
    }
    
    const entry = {
      member: selectedMember,
      total: selectedAmount,
      free: freeAmount,
      cash: cashAmount,
      upi: upiAmount,
      credit: creditAmount,
      creditPaid: 0,
      note: "",
      admin: session.name || session.email,
      createdAt: getISTTimestamp()
    };
    
    await bookingDb.ref(`${FB_PATHS.RECHARGES}/${today}`).push(entry);
    
    const modeLabel = paymentMode === "split" ? `split (₹${cashAmount} cash + ₹${upiAmount} upi)` : paymentMode;
    await logStaffActivity("recharge", "POS Recharge", `${selectedMember}: ₹${selectedAmount + freeAmount} (${modeLabel})`);
    
    // Success flash
    const flash = $("successFlash");
    if (flash) {
      flash.style.display = "flex";
      setTimeout(() => flash.style.display = "none", 400);
    }
    
    resetForm();
    notifySuccess(`Added: ${entry.member} ₹${entry.total + entry.free}`);
  } catch (err) {
    console.error(err);
    notifyError("Failed to add recharge");
  }
  
  if (btn) {
    btn.disabled = false;
    btn.textContent = "✓ ADD";
  }
  updateUI();
};

function resetForm() {
  selectedMember = "";
  selectedAmount = 0;
  freeAmount = 0;
  splitCash = 0;
  splitUpi = 0;
  
  if ($("memberInput")) $("memberInput").value = "";
  if ($("customAmount")) $("customAmount").value = "";
  if ($("freeAmount")) $("freeAmount").value = "";
  if ($("splitCash")) $("splitCash").value = "";
  if ($("splitUpi")) $("splitUpi").value = "";
  
  document.querySelectorAll(".amount-btn").forEach(b => b.classList.remove("selected"));
  
  if (memberSearch) memberSearch.clear();
}

// ==================== SYNC MODAL ====================

window.openSyncModal = () => {
  $("syncModal")?.classList.remove("hidden");
  if (typeof lucide !== "undefined") lucide.createIcons();
};

window.closeSyncModal = () => {
  $("syncModal")?.classList.add("hidden");
};

// ==================== REFRESH ====================

window.refreshData = async () => {
  notifySuccess("Refreshing data...");
  await loadMembers();
  if (memberSearch) memberSearch.setMembers(allMembers);
  loadBookings();
  loadCredits();
};

// ==================== LOGOUT ====================

window.posLogout = async () => {
  const confirmed = await showConfirm("Logout from POS?", "You will be redirected to login page.");
  if (confirmed) {
    clearStaffSession();
    await auth.signOut();
    window.location.replace("index.html");
  }
};
