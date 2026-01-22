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
  CONSTANTS,
  SharedCache 
} from "../../shared/config.js";
import { getISTDate, getTodayIST, getISTTimestamp } from "../../shared/utils.js";
import { getStaffSession, clearStaffSession, logStaffActivity } from "./permissions.js";
import { notifySuccess, notifyError, showConfirm } from "../../shared/notify.js";
import { MemberSearch } from "../../shared/member-search.js";

// ==================== FIREBASE INIT ====================

// Wait for firebase global to be available (mobile can be slow to load)
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

// Try to init immediately (will work on desktop)
initFirebase();

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
  
  // Ensure Firebase is ready (important for mobile)
  const fbReady = await initFirebase();
  if (!fbReady) {
    console.error("❌ Firebase not ready - some features may not work");
  }
  
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
    // Use SharedCache for members - shared across all admin pages
    const members = await SharedCache.getMembers(fdbDb, FB_PATHS.MEMBERS);
    
    // Map to counter format (needs PASSWORD for verification)
    // Note: SharedCache doesn't include PASSWORD, so we need raw data for counter
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
        PASSWORD: profile.PASSWORD || ""  // For member verification
      };
    });
    console.log(`✅ Loaded ${allMembers.length} members (SharedCache)`);
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

