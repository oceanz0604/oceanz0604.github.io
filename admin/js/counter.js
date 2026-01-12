/**
 * OceanZ Gaming Cafe - POS Counter
 * 
 * Simplified POS interface for quick recharges.
 */

import { 
  BOOKING_DB_CONFIG, 
  FDB_DATASET_CONFIG, 
  BOOKING_APP_NAME, 
  FDB_APP_NAME, 
  AUTH_APP_NAME, 
  FB_PATHS, 
  CONSTANTS 
} from "../../shared/config.js";
import { getISTDate, getTodayIST, getISTTimestamp } from "../../shared/utils.js";
import { getStaffSession, clearStaffSession, logStaffActivity } from "./permissions.js";
import { notifySuccess, notifyError, showConfirm } from "../../shared/notify.js";
import { MemberSearch } from "../../shared/member-search.js";

// ==================== FIREBASE INIT ====================

let authApp = firebase.apps.find(a => a.name === AUTH_APP_NAME) || firebase.initializeApp(BOOKING_DB_CONFIG, AUTH_APP_NAME);
let bookingApp = firebase.apps.find(a => a.name === BOOKING_APP_NAME) || firebase.initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);
let fdbApp = firebase.apps.find(a => a.name === FDB_APP_NAME) || firebase.initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);

const auth = authApp.auth();
const bookingDb = bookingApp.database();
const fdbDb = fdbApp.database();

// ==================== STATE ====================

let selectedMember = "";
let selectedAmount = 0;
let freeAmount = 0;
let selectedPayment = "cash";
let allMembers = [];
let stats = { cash: 0, upi: 0, credit: 0, count: 0 };
let recentTx = [];
let memberSearch = null;

// ==================== DOM ELEMENTS ====================

const $ = id => document.getElementById(id);

const elements = {
  loadingScreen: $("loadingScreen"),
  posApp: $("posApp"),
  userName: $("userName"),
  dateTime: $("dateTime"),
  memberInput: $("memberInput"),
  suggestions: $("suggestions"),
  guestSelect: $("guestSelect"),
  customAmount: $("customAmount"),
  freeAmount: $("freeAmount"),
  totalDisplay: $("totalDisplay"),
  breakdownDisplay: $("breakdownDisplay"),
  confirmBtn: $("confirmBtn"),
  statCash: $("statCash"),
  statUpi: $("statUpi"),
  statCredit: $("statCredit"),
  statCount: $("statCount"),
  recentList: $("recentList"),
  successFlash: $("successFlash")
};

// ==================== AUTH CHECK ====================

auth.onAuthStateChanged(user => {
  if (!user || !getStaffSession()) {
    window.location.replace("index.html");
    return;
  }
  init(getStaffSession());
});

// ==================== INITIALIZATION ====================

async function init(session) {
  // Hide loading, show app
  elements.loadingScreen?.classList.add("hidden");
  elements.posApp?.classList.remove("hidden");
  
  // Initialize Lucide icons
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
  
  // Set user info
  if (elements.userName) {
    elements.userName.textContent = session.name || session.email;
  }
  
  // Start clock
  updateDateTime();
  setInterval(updateDateTime, 60000);
  
  // Load members and setup search
  await loadMembers();
  setupMemberSearch();
  setupAmountButtons();
  setupRealtimeUpdates();
  
  console.log("✅ POS Counter initialized");
}

function updateDateTime() {
  const now = getISTDate();
  if (elements.dateTime) {
    elements.dateTime.textContent = now.toLocaleString("en-IN", {
      day: "numeric", 
      month: "short", 
      hour: "2-digit", 
      minute: "2-digit", 
      hour12: true
    });
  }
}

// ==================== MEMBERS ====================

async function loadMembers() {
  try {
    const snap = await fdbDb.ref(FB_PATHS.LEGACY_MEMBERS).once("value");
    const data = snap.val() || [];
    allMembers = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
    console.log(`✅ Loaded ${allMembers.length} members`);
  } catch (error) {
    console.error("Failed to load members:", error);
    allMembers = [];
  }
}

function setupMemberSearch() {
  if (!elements.memberInput || !elements.suggestions) return;
  
  // Use the shared MemberSearch component
  memberSearch = new MemberSearch({
    inputElement: elements.memberInput,
    suggestionsElement: elements.suggestions,
    guestDropdown: elements.guestSelect,
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
  // Quick amount buttons
  document.querySelectorAll(".amount-btn[data-amount]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".amount-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedAmount = parseInt(btn.dataset.amount);
      if (elements.customAmount) elements.customAmount.value = "";
      updateUI();
    });
  });
  
  // Custom amount input
  elements.customAmount?.addEventListener("input", (e) => {
    document.querySelectorAll(".amount-btn").forEach(b => b.classList.remove("selected"));
    e.target.closest(".amount-btn")?.classList.add("selected");
    selectedAmount = parseInt(e.target.value) || 0;
    updateUI();
  });
  
  // Free amount input
  elements.freeAmount?.addEventListener("input", (e) => {
    freeAmount = parseInt(e.target.value) || 0;
    updateUI();
  });
}

// ==================== PAYMENT SELECTION ====================

window.selectPayment = (type) => {
  selectedPayment = type;
  document.querySelectorAll(".payment-btn").forEach(b => b.classList.remove("selected"));
  document.querySelector(`.payment-btn.${type}`)?.classList.add("selected");
};

// ==================== UI UPDATE ====================

function updateUI() {
  const total = selectedAmount + freeAmount;
  
  if (elements.totalDisplay) {
    elements.totalDisplay.textContent = `₹${total}`;
  }
  
  if (elements.breakdownDisplay) {
    let breakdown = "";
    if (selectedAmount > 0) breakdown += `₹${selectedAmount} paid`;
    if (freeAmount > 0) breakdown += (breakdown ? " + " : "") + `₹${freeAmount} free`;
    elements.breakdownDisplay.textContent = breakdown || "Select amount";
  }
  
  if (elements.confirmBtn) {
    elements.confirmBtn.disabled = !selectedMember || (selectedAmount <= 0 && freeAmount <= 0);
  }
}

// ==================== REALTIME UPDATES ====================

function setupRealtimeUpdates() {
  const today = getTodayIST();
  
  bookingDb.ref(`${FB_PATHS.RECHARGES}/${today}`).on("value", snap => {
    const data = snap.val() || {};
    stats = { cash: 0, upi: 0, credit: 0, count: 0 };
    recentTx = [];
    
    Object.entries(data).forEach(([id, r]) => {
      stats.count++;
      stats.cash += (r.cash || 0);
      stats.upi += (r.upi || 0);
      stats.credit += (r.credit || 0);
      
      recentTx.push({
        member: r.member,
        amount: (r.total || 0) + (r.free || 0),
        time: r.createdAt
      });
    });
    
    recentTx.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
    updateStats();
    updateRecent();
  });
}

function updateStats() {
  if (elements.statCash) elements.statCash.textContent = `₹${stats.cash}`;
  if (elements.statUpi) elements.statUpi.textContent = `₹${stats.upi}`;
  if (elements.statCredit) elements.statCredit.textContent = `₹${stats.credit}`;
  if (elements.statCount) elements.statCount.textContent = stats.count;
}

function updateRecent() {
  if (!elements.recentList) return;
  
  const recent = recentTx.slice(0, 8);
  
  if (recent.length === 0) {
    elements.recentList.innerHTML = '<p class="text-gray-600 text-center text-xs py-4">No transactions</p>';
    return;
  }
  
  elements.recentList.innerHTML = recent.map(tx => {
    let time = "-";
    if (tx.time) {
      try {
        const d = new Date(tx.time);
        if (!isNaN(d)) {
          time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
        }
      } catch(e) {}
    }
    
    return `
      <div class="recent-item">
        <div>
          <div class="member">${tx.member || "?"}</div>
          <div class="time">${time}</div>
        </div>
        <div class="amount">₹${tx.amount || 0}</div>
      </div>
    `;
  }).join("");
}

// ==================== CONFIRM RECHARGE ====================

window.confirmRecharge = async () => {
  if (!selectedMember || (selectedAmount <= 0 && freeAmount <= 0)) return;
  
  const session = getStaffSession();
  if (!session) {
    window.location.replace("index.html");
    return;
  }
  
  const btn = elements.confirmBtn;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "...";
  }
  
  try {
    const today = getTodayIST();
    const entry = {
      member: selectedMember,
      total: selectedAmount,
      free: freeAmount,
      cash: selectedPayment === "cash" ? selectedAmount : 0,
      upi: selectedPayment === "upi" ? selectedAmount : 0,
      credit: selectedPayment === "credit" ? selectedAmount : 0,
      creditPaid: 0,
      note: "",
      admin: session.name || session.email,
      createdAt: getISTTimestamp()
    };
    
    await bookingDb.ref(`${FB_PATHS.RECHARGES}/${today}`).push(entry);
    await logStaffActivity("recharge", "POS Recharge", `${selectedMember}: ₹${selectedAmount + freeAmount} (${selectedPayment})`);
    
    // Success flash
    if (elements.successFlash) {
      elements.successFlash.style.display = "flex";
      setTimeout(() => elements.successFlash.style.display = "none", 400);
    }
    
    // Reset form
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
  
  if (elements.memberInput) elements.memberInput.value = "";
  if (elements.customAmount) elements.customAmount.value = "";
  if (elements.freeAmount) elements.freeAmount.value = "";
  
  document.querySelectorAll(".amount-btn").forEach(b => b.classList.remove("selected"));
  
  if (memberSearch) memberSearch.clear();
}

// ==================== LOGOUT ====================

window.posLogout = async () => {
  const confirmed = await showConfirm("Logout from POS?", "You will be redirected to login page.");
  if (confirmed) {
    clearStaffSession();
    await auth.signOut();
    window.location.replace("index.html");
  }
};

// ==================== TOGGLE SECTIONS ====================

window.toggleSection = (sectionId) => {
  const content = document.getElementById(sectionId);
  if (content) {
    content.classList.toggle("show");
  }
};

