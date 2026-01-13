/**
 * OceanZ Gaming Cafe - Daily Recharges Management
 */

import { 
  BOOKING_DB_CONFIG, 
  FDB_DATASET_CONFIG, 
  BOOKING_APP_NAME, 
  FDB_APP_NAME,
  TIMEZONE,
  CONSTANTS,
  FB_PATHS,
  getISTDate,
  formatToIST,
  normalizeTerminalName,
  getShortTerminalName,
  isGuestTerminal
} from "../../shared/config.js";
import { getStaffSession, canEditData } from "./permissions.js";

// ==================== FIREBASE INIT ====================

// Initialize both Firebase apps
let bookingApp = firebase.apps.find(a => a.name === BOOKING_APP_NAME);
if (!bookingApp) bookingApp = firebase.initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);

let fdbApp = firebase.apps.find(a => a.name === FDB_APP_NAME);
if (!fdbApp) fdbApp = firebase.initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);

const rechargeDb = bookingApp.database();
const fdbDb = fdbApp.database();

// ==================== STATE ====================

// Get today's date in IST
function getISTDateString() {
  const now = getISTDate();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

let selectedDate = getISTDateString();
let editId = null;
let state = [];
let allMembers = [];
let auditData = [];
let auditLimit = 20;
let auditFilter = "all";

// Get admin name from staff session
function getAdminName() {
  const session = getStaffSession();
  return session?.name || session?.email?.split("@")[0] || "Admin";
}

// ==================== DOM ELEMENTS ====================

const $ = id => document.getElementById(id);

const elements = {
  memberInput: $("memberInput"),
  totalAmountInput: $("totalAmountInput"),
  freeRechargeInput: $("freeRechargeInput"),
  cashInput: $("cashInput"),
  upiInput: $("upiInput"),
  creditInput: $("creditInput"),
  noteInput: $("noteInput"),
  splitRemaining: $("splitRemaining"),
  listEl: $("rechargeList"),
  suggestionsBox: $("memberSuggestions"),
  totalEl: $("totalAmount"),
  cashEl: $("cashTotal"),
  upiEl: $("upiTotal"),
  creditEl: $("creditTotal"),
  freeEl: $("freeTotal"),
  outstandingSection: $("outstandingCreditsSection"),
  outstandingList: $("outstandingCreditsList"),
  outstandingCount: $("outstandingCount"),
  outstandingTotal: $("outstandingTotal"),
  datePicker: $("datePicker")
};

// ==================== SPLIT PAYMENT HELPERS ====================

window.updateSplitRemaining = () => {
  const total = Number(elements.totalAmountInput?.value) || 0;
  const cash = Number(elements.cashInput?.value) || 0;
  const upi = Number(elements.upiInput?.value) || 0;
  const credit = Number(elements.creditInput?.value) || 0;
  
  const remaining = total - cash - upi - credit;
  
  if (elements.splitRemaining) {
    if (remaining < 0) {
      elements.splitRemaining.textContent = `Over by: ₹${Math.abs(remaining)}`;
      elements.splitRemaining.style.color = "#ff0044";
    } else if (remaining > 0) {
      elements.splitRemaining.textContent = `Remaining: ₹${remaining}`;
      elements.splitRemaining.style.color = "#ffff00";
    } else {
      elements.splitRemaining.textContent = `✓ Balanced`;
      elements.splitRemaining.style.color = "#00ff88";
    }
  }
};

window.autoFillCash = () => {
  const total = Number(elements.totalAmountInput?.value) || 0;
  const upi = Number(elements.upiInput?.value) || 0;
  const credit = Number(elements.creditInput?.value) || 0;
  if (elements.cashInput) elements.cashInput.value = Math.max(0, total - upi - credit);
  updateSplitRemaining();
};

window.autoFillUpi = () => {
  const total = Number(elements.totalAmountInput?.value) || 0;
  const cash = Number(elements.cashInput?.value) || 0;
  const credit = Number(elements.creditInput?.value) || 0;
  if (elements.upiInput) elements.upiInput.value = Math.max(0, total - cash - credit);
  updateSplitRemaining();
};

window.autoFillCredit = () => {
  const total = Number(elements.totalAmountInput?.value) || 0;
  const cash = Number(elements.cashInput?.value) || 0;
  const upi = Number(elements.upiInput?.value) || 0;
  if (elements.creditInput) elements.creditInput.value = Math.max(0, total - cash - upi);
  updateSplitRemaining();
};

window.clearSplit = () => {
  if (elements.cashInput) elements.cashInput.value = "";
  if (elements.upiInput) elements.upiInput.value = "";
  if (elements.creditInput) elements.creditInput.value = "";
  updateSplitRemaining();
};

// Initialize guest terminal dropdown from config
function initGuestTerminalDropdown() {
  const select = document.getElementById("guestTerminalSelect");
  if (!select) return;
  
  const terminals = CONSTANTS.TIMETABLE_PCS || [];
  
  terminals.forEach(terminal => {
    const option = document.createElement("option");
    option.value = terminal.toUpperCase();
    
    // Create shorter display name
    let displayName = terminal
      .replace("CT-ROOM-", "CT")
      .replace("T-ROOM-", "T")
      .replace("XBOX ONE X", "Xbox");
    
    option.textContent = displayName;
    select.appendChild(option);
  });
}

// Handle guest terminal selection from dropdown
window.selectGuestTerminal = (selectElement) => {
  const memberInput = document.getElementById("memberInput");
  if (memberInput && selectElement.value) {
    // Use the exact terminal name in uppercase to match PanCafe transactions
    memberInput.value = selectElement.value;
    
    // Hide suggestions
    const suggestions = document.getElementById("memberSuggestions");
    if (suggestions) suggestions.classList.add("hidden");
  }
  // Reset dropdown to placeholder
  selectElement.selectedIndex = 0;
};

// Initialize guest dropdown when DOM is ready
document.addEventListener("DOMContentLoaded", initGuestTerminalDropdown);

// ==================== DATE PICKER ====================

if (elements.datePicker) {
  elements.datePicker.value = selectedDate;
  elements.datePicker.onchange = e => {
    selectedDate = e.target.value;
    loadDay();
  };
}

// ==================== MEMBER AUTOCOMPLETE ====================

// Load members from Firebase (supports both new and legacy format)
fdbDb.ref(FB_PATHS.LEGACY_MEMBERS).once("value").then(snap => {
  const data = snap.val();
  if (Array.isArray(data)) {
    allMembers = data.filter(m => m); // Legacy array format
  } else if (data && typeof data === "object") {
    allMembers = Object.values(data); // New object format
  } else {
    allMembers = [];
  }
});

elements.memberInput?.addEventListener("input", () => {
  const q = elements.memberInput.value.toLowerCase();
  elements.suggestionsBox.innerHTML = "";

  if (!q) {
    elements.suggestionsBox.classList.add("hidden");
    return;
  }

  const matches = allMembers
    .filter(m => m.USERNAME?.toLowerCase().includes(q))
    .slice(0, 6);

  matches.forEach(m => {
    const div = document.createElement("div");
    div.className = "px-3 py-2 hover:bg-gray-700 cursor-pointer";
    div.textContent = m.USERNAME;
    div.onclick = () => {
      elements.memberInput.value = m.USERNAME;
      elements.suggestionsBox.classList.add("hidden");
    };
    elements.suggestionsBox.appendChild(div);
  });

  elements.suggestionsBox.classList.remove("hidden");
});

// ==================== LOAD DATA ====================

function loadDay() {
  const ref = rechargeDb.ref(`recharges/${selectedDate}`);
  ref.off();
  ref.on("value", snap => {
    state = snap.val()
      ? Object.entries(snap.val()).map(([id, r]) => ({ id, ...r }))
      : [];
    render();
    // After rendering, scan for credit collections that happened on selectedDate
    loadCreditCollectionsForDate(selectedDate);
    // Load credit collections from OTHER dates that were collected on this date
    loadOtherDayCollections(selectedDate);
    loadAudit();
    // Reload outstanding credits whenever data changes (including new credit entries)
    loadAllOutstandingCredits();
  });
}

// Scan ALL recharges to find credit collections that happened on a specific date
// and update the displayed totals (cash/UPI from credit collections)
async function loadCreditCollectionsForDate(targetDate) {
  try {
    const snap = await rechargeDb.ref(FB_PATHS.RECHARGES).once("value");
    const allRecharges = snap.val() || {};
    
    // Track collections separately:
    // - sameDayCash/UPI: credit collected same day as transaction (total already counted in render)
    // - otherDayCash/UPI: credit collected today for transactions from other dates (add to total)
    let sameDayCash = 0, sameDayUpi = 0;
    let otherDayCash = 0, otherDayUpi = 0;
    
    // Scan all dates for credit collections that happened on targetDate
    Object.entries(allRecharges).forEach(([transactionDate, dayData]) => {
      Object.values(dayData).forEach(r => {
        // NEW FORMAT with creditPayments history (supports partial payments across multiple days)
        if (r.creditPayments && r.creditPayments[targetDate]) {
          const payment = r.creditPayments[targetDate];
          if (transactionDate === targetDate) {
            sameDayCash += payment.cash || 0;
            sameDayUpi += payment.upi || 0;
          } else {
            otherDayCash += payment.cash || 0;
            otherDayUpi += payment.upi || 0;
          }
        }
        // FALLBACK: Old format with lastPaidAt (single payment only)
        else if (r.lastPaidAt && !r.creditPayments) {
          const paidDate = r.lastPaidAt.split("T")[0];
          if (paidDate === targetDate) {
            if (transactionDate === targetDate) {
              sameDayCash += r.lastPaidCash || 0;
              sameDayUpi += r.lastPaidUpi || 0;
            } else {
              otherDayCash += r.lastPaidCash || 0;
              otherDayUpi += r.lastPaidUpi || 0;
            }
          }
        }
        // LEGACY: Old format with paidAt (credit mode) - only if NO new format fields
        // Skip if creditPayments exists (already handled above)
        if (r.paidAt && r.mode === "credit" && r.paid && !r.creditPayments && !r.lastPaidCash && !r.lastPaidUpi) {
          const paidDate = r.paidAt.split("T")[0];
          if (paidDate === targetDate) {
            let cash = 0, upi = 0;
            if (r.paidVia === "cash") cash = r.amount;
            else if (r.paidVia === "upi") upi = r.amount;
            else if (r.paidVia === "cash+upi") {
              cash = Math.floor(r.amount / 2);
              upi = r.amount - Math.floor(r.amount / 2);
            } else {
              cash = r.amount; // Default to cash
            }
            
            if (transactionDate === targetDate) {
              sameDayCash += cash;
              sameDayUpi += upi;
            } else {
              otherDayCash += cash;
              otherDayUpi += upi;
            }
          }
        }
      });
    });
    
    const totalCollectedCash = sameDayCash + otherDayCash;
    const totalCollectedUpi = sameDayUpi + otherDayUpi;
    
    // Update the displayed totals with credit collections
    if (totalCollectedCash > 0 || totalCollectedUpi > 0) {
      const cashEl = elements.cashEl;
      const upiEl = elements.upiEl;
      
      // Update cash display - add all credit collections to total
      if (cashEl) {
        const currentCash = parseInt(cashEl.textContent.replace(/[₹,]/g, "")) || 0;
        cashEl.innerHTML = `₹${currentCash + totalCollectedCash}`;
        // Only show green indicator for OTHER-DAY credit collections (not same-day)
        if (otherDayCash > 0) {
          cashEl.innerHTML += ` <span class="text-xs" style="color: #00ff88;">(+₹${otherDayCash} credit)</span>`;
        }
      }
      
      // Update UPI display - add all credit collections to total
      if (upiEl) {
        const currentUpi = parseInt(upiEl.textContent.replace(/[₹,]/g, "")) || 0;
        upiEl.innerHTML = `₹${currentUpi + totalCollectedUpi}`;
        // Only show green indicator for OTHER-DAY credit collections (not same-day)
        if (otherDayUpi > 0) {
          upiEl.innerHTML += ` <span class="text-xs" style="color: #00ff88;">(+₹${otherDayUpi} credit)</span>`;
        }
      }
      
      // ONLY add to total for credit collections from OTHER dates
      // (same-day collections are already counted in render via creditPaid)
      if (elements.totalEl && (otherDayCash > 0 || otherDayUpi > 0)) {
        const currentTotal = parseInt(elements.totalEl.textContent.replace(/[₹,]/g, "")) || 0;
        elements.totalEl.textContent = `₹${currentTotal + otherDayCash + otherDayUpi}`;
      }
    }
    
    // Get current values from render() before adding credit collections
    const renderCash = parseInt(elements.cashEl?.textContent?.replace(/[₹,]/g, "")) || 0;
    const renderUpi = parseInt(elements.upiEl?.textContent?.replace(/[₹,]/g, "")) || 0;
    
    console.log(`[RECHARGES] Date: ${targetDate}`);
    console.log(`  From render() - Direct Cash: ₹${renderCash}, Direct UPI: ₹${renderUpi}`);
    console.log(`  Credit collections - Same-day: Cash ₹${sameDayCash}, UPI ₹${sameDayUpi}`);
    console.log(`  Credit collections - Other-day: Cash ₹${otherDayCash}, UPI ₹${otherDayUpi}`);
    console.log(`  Final totals: Cash ₹${renderCash + totalCollectedCash}, UPI ₹${renderUpi + totalCollectedUpi}`);
  } catch (error) {
    console.warn("Could not load credit collections:", error);
  }
}

// Load and display credit collections from OTHER dates that were collected on the selected date
async function loadOtherDayCollections(targetDate) {
  const section = document.getElementById("otherDayCollectionsSection");
  const listEl = document.getElementById("otherDayCollectionsList");
  const countEl = document.getElementById("otherDayCollectionCount");
  const totalEl = document.getElementById("otherDayCollectionTotal");
  
  if (!section || !listEl) return;
  
  try {
    const snap = await rechargeDb.ref(FB_PATHS.RECHARGES).once("value");
    const allRecharges = snap.val() || {};
    
    const collections = [];
    
    // Scan all dates for credit collections that happened on targetDate from OTHER dates
    Object.entries(allRecharges).forEach(([transactionDate, dayData]) => {
      // Skip same-day transactions
      if (transactionDate === targetDate) return;
      
      Object.entries(dayData).forEach(([id, r]) => {
        // NEW FORMAT with creditPayments history
        if (r.creditPayments && r.creditPayments[targetDate]) {
          const payment = r.creditPayments[targetDate];
          const totalCollected = (payment.cash || 0) + (payment.upi || 0);
          if (totalCollected > 0) {
            collections.push({
              id,
              transactionDate,
              member: r.member,
              cash: payment.cash || 0,
              upi: payment.upi || 0,
              total: totalCollected,
              collectedAt: payment.at,
              collectedBy: payment.by
            });
          }
        }
        // FALLBACK: Old format with lastPaidAt
        else if (r.lastPaidAt && !r.creditPayments) {
          const paidDate = r.lastPaidAt.split("T")[0];
          if (paidDate === targetDate) {
            const totalCollected = (r.lastPaidCash || 0) + (r.lastPaidUpi || 0);
            if (totalCollected > 0) {
              collections.push({
                id,
                transactionDate,
                member: r.member,
                cash: r.lastPaidCash || 0,
                upi: r.lastPaidUpi || 0,
                total: totalCollected,
                collectedAt: r.lastPaidAt,
                collectedBy: r.lastPaidBy
              });
            }
          }
        }
        // LEGACY: Old format with paidAt - only if NO new format fields
        if (r.paidAt && r.mode === "credit" && r.paid && !r.creditPayments && !r.lastPaidCash && !r.lastPaidUpi) {
          const paidDate = r.paidAt.split("T")[0];
          if (paidDate === targetDate) {
            let cash = 0, upi = 0;
            if (r.paidVia === "cash") cash = r.amount;
            else if (r.paidVia === "upi") upi = r.amount;
            else if (r.paidVia === "cash+upi") {
              cash = Math.floor(r.amount / 2);
              upi = r.amount - Math.floor(r.amount / 2);
            } else {
              cash = r.amount;
            }
            
            collections.push({
              id,
              transactionDate,
              member: r.member,
              cash,
              upi,
              total: cash + upi,
              collectedAt: r.paidAt,
              collectedBy: r.paidBy
            });
          }
        }
      });
    });
    
    // Sort by transaction date (newest first)
    collections.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
    
    // Update section visibility and counts
    if (collections.length === 0) {
      section.classList.add("hidden");
      return;
    }
    
    section.classList.remove("hidden");
    const grandTotal = collections.reduce((sum, c) => sum + c.total, 0);
    
    if (countEl) countEl.textContent = collections.length;
    if (totalEl) totalEl.textContent = `₹${grandTotal.toLocaleString("en-IN")}`;
    
    // Render table rows
    listEl.innerHTML = collections.map(c => {
      const origDate = new Date(c.transactionDate).toLocaleDateString("en-IN", { 
        day: "numeric", 
        month: "short" 
      });
      
      let methodBadges = "";
      if (c.cash > 0) {
        methodBadges += `<span class="text-xs px-2 py-0.5 rounded" style="background: rgba(0,240,255,0.2); color: #00f0ff;">💵 ₹${c.cash}</span> `;
      }
      if (c.upi > 0) {
        methodBadges += `<span class="text-xs px-2 py-0.5 rounded" style="background: rgba(184,41,255,0.2); color: #b829ff;">📱 ₹${c.upi}</span>`;
      }
      
      return `
        <tr class="border-b border-gray-800/30 hover:bg-gray-800/20">
          <td class="py-2 px-2 text-gray-400 text-xs">${origDate}</td>
          <td class="py-2 px-2 font-orbitron font-bold" style="color: var(--neon-cyan);">${c.member}</td>
          <td class="py-2 px-2 text-right font-orbitron font-bold" style="color: var(--neon-green);">₹${c.total}</td>
          <td class="py-2 px-2">${methodBadges}</td>
        </tr>
      `;
    }).join("");
    
  } catch (error) {
    console.warn("Could not load other-day collections:", error);
    section.classList.add("hidden");
  }
}

// Load all outstanding credits across all dates
function loadAllOutstandingCredits() {
  rechargeDb.ref(FB_PATHS.RECHARGES).once("value").then(snap => {
    const allCredits = [];
    
    Object.entries(snap.val() || {}).forEach(([date, dayData]) => {
      Object.entries(dayData).forEach(([id, r]) => {
        // Handle new split format
        if (r.total !== undefined) {
          const pendingCredit = (r.credit || 0) - (r.creditPaid || 0);
          if (pendingCredit > 0) {
            allCredits.push({ 
              id, 
              date, 
              member: r.member,
              amount: pendingCredit,
              originalCredit: r.credit,
              creditPaid: r.creditPaid || 0,
              note: r.note,
              createdAt: r.createdAt,
              isNewFormat: true
            });
          }
        }
        // Handle old single-mode format
        else if (r.mode === "credit" && !r.paid) {
          allCredits.push({ 
            id, 
            date, 
            member: r.member,
            amount: r.amount,
            note: r.note,
            createdAt: r.createdAt,
            isNewFormat: false
          });
        }
      });
    });

    // Sort by date (oldest first)
    allCredits.sort((a, b) => new Date(a.createdAt || a.date) - new Date(b.createdAt || b.date));

    renderAllOutstandingCredits(allCredits);
  });
}

function renderAllOutstandingCredits(credits) {
  if (!elements.outstandingSection) return;

  if (credits.length === 0) {
    elements.outstandingSection.classList.add("hidden");
    return;
  }

  const totalPending = credits.reduce((sum, r) => sum + r.amount, 0);

  elements.outstandingSection.classList.remove("hidden");
  if (elements.outstandingCount) elements.outstandingCount.textContent = credits.length;
  if (elements.outstandingTotal) elements.outstandingTotal.textContent = `₹${totalPending}`;

  if (elements.outstandingList) {
    elements.outstandingList.innerHTML = credits.map(r => {
      // Use IST for date formatting
      const createdDate = r.createdAt 
        ? formatToIST(r.createdAt, { dateStyle: "medium", timeStyle: undefined })
        : r.date;
      
      // Calculate days since in IST
      const now = getISTDate();
      const daysSince = r.createdAt 
        ? Math.floor((now - new Date(r.createdAt)) / 86400000)
        : Math.floor((now - new Date(r.date)) / 86400000);
      
      const urgencyColor = daysSince > 7 ? "#ff0044" : daysSince > 3 ? "#ff6b00" : "#ffff00";
      const urgencyBg = daysSince > 7 ? "rgba(255,0,68,0.1)" : "rgba(255,107,0,0.1)";

      // Show partial payment info if applicable
      const partialInfo = r.creditPaid > 0 
        ? `<span class="text-xs px-2 py-0.5 rounded" style="background: rgba(0,255,136,0.2); color: #00ff88;">₹${r.creditPaid} already paid</span>`
        : "";

      return `
        <div class="credit-item flex items-center justify-between gap-4" style="background: ${urgencyBg};">
          <div class="flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-orbitron font-bold" style="color: #00f0ff;">${r.member}</span>
              <span class="font-orbitron font-bold" style="color: #ff6b00;">₹${r.amount}</span>
              ${daysSince > 0 
                ? `<span class="text-xs px-2 py-0.5 rounded" style="background: ${urgencyColor}20; color: ${urgencyColor};">${daysSince}d</span>` 
                : '<span class="text-xs px-2 py-0.5 rounded" style="background: rgba(255,255,0,0.2); color: #ffff00;">Today</span>'}
              ${partialInfo}
            </div>
            <div class="text-xs text-gray-500 mt-1">
              📅 ${createdDate}
              ${r.note ? ` • 📝 ${r.note}` : ""}
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button onclick="collectCreditGlobal('${r.date}', '${r.id}', ${r.amount}, ${r.isNewFormat})" class="mark-paid-btn flex items-center gap-1">
              💰 Collect
            </button>
            <button onclick="deleteCreditGlobal('${r.date}', '${r.id}')" 
              class="hover:scale-110 transition-transform p-1" style="color: #ff0044;">✖</button>
          </div>
        </div>
      `;
    }).join("");
  }
}

// Global credit collection function - opens the modal
window.collectCreditGlobal = (date, id, amount, isNewFormat) => {
  rechargeDb.ref(`recharges/${date}/${id}`).once("value").then(snap => {
    const r = snap.val();
    if (!r) return;

    openCollectModal({
      date: date,
      id: id,
      member: r.member,
      pendingAmount: amount,
      isNewFormat: isNewFormat,
      originalRecord: r
    });
  });
};

window.deleteCreditGlobal = async (date, id) => {
  const confirmed = await showConfirm("Delete this credit entry? This will remove the entire recharge record.", {
    title: "Delete Credit Entry",
    type: "error",
    confirmText: "Delete",
    cancelText: "Cancel"
  });
  
  if (confirmed) {
    rechargeDb.ref(`recharges/${date}/${id}`).remove();
    logAudit("DELETE", `Entry from ${date}`);
    notifySuccess("Credit entry deleted");
    loadAllOutstandingCredits();
    
    if (date === selectedDate) {
      loadDay();
    }
  }
};

// Setup audit log toggle
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("auditToggle");
  const container = document.getElementById("auditLogContainer");
  const chevron = document.getElementById("auditChevron");

  toggle?.addEventListener("click", () => {
    container?.classList.toggle("hidden");
    chevron?.style.setProperty("transform", container?.classList.contains("hidden") ? "rotate(0deg)" : "rotate(180deg)");
    
    if (!container?.classList.contains("hidden")) {
      loadAudit();
      lucide?.createIcons();
    }
  });
});

loadDay();

// ==================== ADD RECHARGE MODAL ====================

window.openAddRechargeModal = (isEdit = false) => {
  // Check if user can edit (Finance Manager cannot)
  if (!canEditData()) {
    notifyWarning("You have view-only access. Editing is not allowed.");
    return;
  }
  
  const modal = document.getElementById("addRechargeModal");
  const modalTitle = modal?.querySelector("h3");
  const saveBtn = modal?.querySelector("button[onclick='addRecharge()']");
  
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    
    // Update title and button based on mode
    if (modalTitle) {
      modalTitle.innerHTML = isEdit ? "✏️ EDIT RECHARGE" : "➕ ADD RECHARGE";
    }
    if (saveBtn) {
      saveBtn.innerHTML = isEdit ? "💾 Update" : "💾 Save";
    }
    
    // Focus on member input
    setTimeout(() => {
      elements.memberInput?.focus();
    }, 100);
  }
};

window.closeAddRechargeModal = () => {
  const modal = document.getElementById("addRechargeModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
  
  // Clear form
  editId = null;
  if (elements.memberInput) elements.memberInput.value = "";
  if (elements.totalAmountInput) elements.totalAmountInput.value = "";
  if (elements.freeRechargeInput) elements.freeRechargeInput.value = "";
  if (elements.noteInput) elements.noteInput.value = "";
  clearSplit();
};

// ==================== ADD / EDIT ====================

window.addRecharge = () => {
  const member = elements.memberInput?.value.trim();
  const total = Number(elements.totalAmountInput?.value) || 0;
  const free = Number(elements.freeRechargeInput?.value) || 0;
  const cash = Number(elements.cashInput?.value) || 0;
  const upi = Number(elements.upiInput?.value) || 0;
  const credit = Number(elements.creditInput?.value) || 0;

  if (!member) {
    notifyWarning("Please enter member name");
    return;
  }

  if (total <= 0 && free <= 0) {
    notifyWarning("Please enter paid amount or free recharge");
    return;
  }

  if (total > 0) {
    const splitTotal = cash + upi + credit;
    if (splitTotal !== total) {
      notifyWarning(`Split amounts (₹${splitTotal}) don't match paid amount (₹${total}). Please adjust.`);
      return;
    }
  }

  const data = {
    member,
    total,
    free: free || 0,
    cash: cash || 0,
    upi: upi || 0,
    credit: credit || 0,
    creditPaid: 0, // Reset - credit tracking starts fresh
    lastPaidCash: 0, // Reset settlement data
    lastPaidUpi: 0, // Reset settlement data
    note: elements.noteInput?.value || "",
    admin: getAdminName(),
    createdAt: new Date().toISOString()
  };

  const refPath = `recharges/${selectedDate}`;

  if (editId) {
    // When editing, preserve createdAt from original record
    const originalRecord = state.find(x => x.id === editId);
    if (originalRecord?.createdAt) {
      data.createdAt = originalRecord.createdAt;
    }
    data.updatedAt = new Date().toISOString();
    data.updatedBy = getAdminName();
    
    rechargeDb.ref(`${refPath}/${editId}`).update(data);
    logAudit("EDIT", member, total + free);
  } else {
    rechargeDb.ref(refPath).push(data);
    logAudit("ADD", member, total + free);
  }

  // Close modal and clear form
  closeAddRechargeModal();
};

// ==================== RENDER LIST ====================

let searchQuery = "";

window.filterRechargeList = () => {
  const searchInput = document.getElementById("rechargeSearch");
  searchQuery = (searchInput?.value || "").toLowerCase().trim();
  render();
};

function render() {
  elements.listEl.innerHTML = "";
  const countEl = document.getElementById("rechargeCount");
  const emptyEl = document.getElementById("rechargeEmptyState");
  const noResultsEl = document.getElementById("rechargeNoResults");
  
  let totalCollected = 0, cashTotal = 0, upiTotal = 0, creditPending = 0, freeTotal = 0;

  // Sort by createdAt in descending order (newest first)
  const sortedState = [...state].sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
    const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
    return dateB - dateA;
  });

  // Filter based on search query
  const filteredState = sortedState.filter(r => {
    if (!searchQuery) return true;
    
    const memberMatch = r.member?.toLowerCase().includes(searchQuery);
    const noteMatch = r.note?.toLowerCase().includes(searchQuery);
    const amountMatch = String(r.total || r.amount).includes(searchQuery);
    const adminMatch = r.admin?.toLowerCase().includes(searchQuery);
    
    return memberMatch || noteMatch || amountMatch || adminMatch;
  });

  // Calculate totals from all state (not filtered)
  // IMPORTANT: Credit collections are counted on the DATE they were COLLECTED, not the original transaction date
  state.forEach(r => {
    if (r.total !== undefined) {
      // New split payment format
      // Direct cash and UPI payments (always count on original date)
      cashTotal += r.cash || 0;
      upiTotal += r.upi || 0;
      freeTotal += r.free || 0;
      
      // For creditPaid: only count in total if paid on the SAME day (selectedDate)
      // If paid on a different day, it will be counted via loadCreditCollectionsForDate
      let sameDayCreditPaid = 0;
      
      // NEW: Check creditPayments history for same-day payments
      if (r.creditPayments && r.creditPayments[selectedDate]) {
        const todayPayment = r.creditPayments[selectedDate];
        sameDayCreditPaid = (todayPayment.cash || 0) + (todayPayment.upi || 0);
      }
      // FALLBACK: Old format with lastPaidAt (single payment)
      else if (r.creditPaid > 0 && r.lastPaidAt && !r.creditPayments) {
        const paidDate = r.lastPaidAt.split("T")[0];
        if (paidDate === selectedDate) {
          sameDayCreditPaid = r.creditPaid;
        }
      } 
      // LEGACY: No payment tracking - assume same day
      else if (r.creditPaid > 0 && !r.lastPaidAt && !r.creditPayments) {
        sameDayCreditPaid = r.creditPaid;
      }
      
      // Calculate totals: direct payments + same-day credit payments only
      const collected = (r.cash || 0) + (r.upi || 0) + sameDayCreditPaid;
      totalCollected += collected;
      creditPending += (r.credit || 0) - (r.creditPaid || 0);
    } else if (r.amount !== undefined) {
      // Old single-mode format (backward compatibility)
      if (r.mode === "credit") {
        if (r.paid) {
          // Check if paid on the same day
          let sameDayPaid = false;
          if (r.paidAt) {
            const paidDate = r.paidAt.split("T")[0];
            sameDayPaid = (paidDate === selectedDate);
          } else {
            // No paidAt means assume same day
            sameDayPaid = true;
          }
          
          if (sameDayPaid) {
            totalCollected += r.amount;
          }
          // If paid on different day, will be counted via loadCreditCollectionsForDate
        } else {
          creditPending += r.amount;
        }
      } else {
        totalCollected += r.amount;
        if (r.mode === "cash") cashTotal += r.amount;
        if (r.mode === "upi") upiTotal += r.amount;
      }
    }
  });

  // Update count
  if (countEl) countEl.textContent = state.length;

  // Handle empty states
  if (state.length === 0) {
    if (emptyEl) emptyEl.classList.remove("hidden");
    if (noResultsEl) noResultsEl.classList.add("hidden");
  } else if (filteredState.length === 0) {
    if (emptyEl) emptyEl.classList.add("hidden");
    if (noResultsEl) noResultsEl.classList.remove("hidden");
  } else {
    if (emptyEl) emptyEl.classList.add("hidden");
    if (noResultsEl) noResultsEl.classList.add("hidden");
  }

  // Render table rows
  filteredState.forEach((r, index) => {
    const row = document.createElement("tr");
    row.className = "hover:bg-gray-800/30 transition-colors";
    
    // Determine if this entry has pending credit
    const hasPendingCredit = r.total !== undefined 
      ? ((r.credit || 0) - (r.creditPaid || 0)) > 0
      : (r.mode === "credit" && !r.paid);
    
    if (hasPendingCredit) {
      row.style.borderLeft = "3px solid #ff6b00";
    }

    // Format time from createdAt
    const createdDate = r.createdAt ? new Date(r.createdAt) : null;
    const timeStr = createdDate 
      ? createdDate.toLocaleTimeString("en-IN", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: true })
      : "-";
    const dateStr = createdDate 
      ? createdDate.toLocaleDateString("en-IN", { timeZone: TIMEZONE, day: "numeric", month: "short" })
      : selectedDate;

    // Build payment badges
    let paymentBadges = "";
    if (r.total !== undefined || r.free !== undefined) {
      const badges = [];
      // Show direct cash payment
      if (r.cash > 0) badges.push(`<span class="payment-badge cash">💵 ₹${r.cash}</span>`);
      // Show direct UPI payment
      if (r.upi > 0) badges.push(`<span class="payment-badge upi">📱 ₹${r.upi}</span>`);
      // Show free recharge
      if (r.free > 0) badges.push(`<span class="payment-badge free">🎁 ₹${r.free}</span>`);
      
      if (r.credit > 0) {
        const remaining = (r.credit || 0) - (r.creditPaid || 0);
        // Show pending credit
        if (remaining > 0) {
          badges.push(`<span class="payment-badge credit-pending">🔖 ₹${remaining}</span>`);
        }
        // Show how the credit was settled (via cash/UPI) with collection date if different
        if (r.creditPaid > 0) {
          // NEW: Show payment history from creditPayments
          if (r.creditPayments && Object.keys(r.creditPayments).length > 0) {
            // Show each payment date's amounts
            Object.entries(r.creditPayments).forEach(([paymentDate, payment]) => {
              const isOtherDay = paymentDate !== selectedDate;
              const dateStr = isOtherDay 
                ? ` on ${new Date(paymentDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                : "";
              
              if (payment.cash > 0) {
                badges.push(`<span class="payment-badge credit-paid" title="Credit settled via Cash${dateStr}">✓ ₹${payment.cash} Cash${dateStr}</span>`);
              }
              if (payment.upi > 0) {
                badges.push(`<span class="payment-badge credit-paid" title="Credit settled via UPI${dateStr}">✓ ₹${payment.upi} UPI${dateStr}</span>`);
              }
            });
          }
          // FALLBACK: Old format with lastPaidAt (single payment)
          else if (r.lastPaidCash || r.lastPaidUpi) {
            let collectionDateStr = "";
            if (r.lastPaidAt) {
              const collectionDate = r.lastPaidAt.split("T")[0];
              if (collectionDate !== selectedDate) {
                const collDate = new Date(collectionDate);
                collectionDateStr = ` on ${collDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
              }
            }
            
            if (r.lastPaidCash > 0) {
              badges.push(`<span class="payment-badge credit-paid" title="Credit settled via Cash${collectionDateStr}">✓ ₹${r.lastPaidCash} Cash${collectionDateStr}</span>`);
            }
            if (r.lastPaidUpi > 0) {
              badges.push(`<span class="payment-badge credit-paid" title="Credit settled via UPI${collectionDateStr}">✓ ₹${r.lastPaidUpi} UPI${collectionDateStr}</span>`);
            }
          }
          // LEGACY: No payment details, just show total
          else {
            badges.push(`<span class="payment-badge credit-paid">✓ ₹${r.creditPaid}</span>`);
          }
        }
      }
      paymentBadges = badges.join(" ");
    } else {
      // Old single-mode format
      if (r.mode === "credit" && r.paid) {
        // Show as settled via the payment method used, with collection date if different
        let collectionDateStr = "";
        if (r.paidAt) {
          const collectionDate = r.paidAt.split("T")[0];
          if (collectionDate !== selectedDate) {
            const collDate = new Date(collectionDate);
            collectionDateStr = ` on ${collDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
          }
        }
        
        const paidVia = r.paidVia || "cash";
        if (paidVia.includes("cash")) {
          paymentBadges = `<span class="payment-badge credit-paid" title="Credit settled${collectionDateStr}">✓ ₹${r.amount} Cash${collectionDateStr}</span>`;
        } else if (paidVia === "upi") {
          paymentBadges = `<span class="payment-badge credit-paid" title="Credit settled${collectionDateStr}">✓ ₹${r.amount} UPI${collectionDateStr}</span>`;
        } else {
          paymentBadges = `<span class="payment-badge credit-paid">✓ ₹${r.amount}${collectionDateStr}</span>`;
        }
      } else {
        const badgeClass = r.mode === "cash" ? "cash" : r.mode === "upi" ? "upi" : "credit-pending";
        const icon = { cash: "💵", upi: "📱", credit: "🔖" }[r.mode] || "";
        let label = r.mode?.toUpperCase() || "";
        if (r.mode === "credit") {
          label = "PENDING";
        }
        paymentBadges = `<span class="payment-badge ${badgeClass}">${icon} ${label}</span>`;
      }
    }

    const pendingCreditAmount = r.total !== undefined 
      ? (r.credit || 0) - (r.creditPaid || 0)
      : (r.mode === "credit" && !r.paid ? r.amount : 0);

    row.innerHTML = `
      <td class="px-4 py-3">
        <div class="text-white font-medium">${timeStr}</div>
        <div class="text-xs text-gray-500">${dateStr}</div>
      </td>
      <td class="px-4 py-3">
        <span class="font-orbitron font-bold" style="color: var(--neon-cyan);">${r.member}</span>
      </td>
      <td class="px-4 py-3 text-right">
        <span class="font-orbitron font-bold" style="color: var(--neon-green);">₹${(r.total || r.amount || 0) + (r.free || 0)}</span>
        ${r.free > 0 ? `<div class="text-xs" style="color: #ffff00;">(+₹${r.free})</div>` : ''}
      </td>
      <td class="px-4 py-3 recharge-col-payment">
        <div class="flex flex-wrap gap-1">${paymentBadges}</div>
      </td>
      <td class="px-4 py-3 text-gray-400 text-xs max-w-32 truncate recharge-col-note" title="${r.note || ''}">
        ${r.note || "-"}
      </td>
      <td class="px-4 py-3 recharge-col-admin">
        <span class="text-xs px-2 py-1 rounded" style="background: rgba(0,240,255,0.1); color: var(--neon-cyan);">${r.admin || "Admin"}</span>
      </td>
      <td class="px-4 py-3 text-right">
        <div class="flex gap-1 justify-end items-center">
          ${pendingCreditAmount > 0 ? `
            <button onclick="collectCredit('${r.id}', ${pendingCreditAmount})" 
              class="text-xs px-2 py-1 rounded transition-all hover:scale-105"
              style="background: rgba(255,107,0,0.2); color: #ff6b00; border: 1px solid rgba(255,107,0,0.3);"
              title="Collect Credit">
              💰
            </button>
          ` : ''}
          <button onclick="editRecharge('${r.id}')" 
            class="p-1 rounded transition-all hover:bg-cyan-500/20" style="color: var(--neon-cyan);" title="Edit">
            ✏️
          </button>
          <button onclick="deleteRecharge('${r.id}')" 
            class="p-1 rounded transition-all hover:bg-red-500/20" style="color: #ff0044;" title="Delete">
            🗑️
          </button>
        </div>
      </td>
    `;
    elements.listEl.appendChild(row);
  });

  // Update totals
  if (elements.totalEl) elements.totalEl.textContent = `₹${totalCollected}`;
  if (elements.cashEl) elements.cashEl.textContent = `₹${cashTotal}`;
  if (elements.upiEl) elements.upiEl.textContent = `₹${upiTotal}`;
  if (elements.creditEl) elements.creditEl.textContent = `₹${creditPending}`;
  if (elements.freeEl) elements.freeEl.textContent = `₹${freeTotal}`;
}

// ==================== CREDIT COLLECTION MODAL ====================

let collectModalData = null;

// Open collect credit modal
window.collectCredit = (id, pendingAmount) => {
  // Check if user can edit (Finance Manager cannot)
  if (!canEditData()) {
    notifyWarning("You have view-only access. Collecting credits is not allowed.");
    return;
  }
  
  const r = state.find(x => x.id === id);
  if (!r) return;

  openCollectModal({
    date: selectedDate,
    id: id,
    member: r.member,
    pendingAmount: pendingAmount,
    isNewFormat: r.total !== undefined,
    originalRecord: r
  });
};

function openCollectModal(data) {
  collectModalData = data;
  
  const modal = document.getElementById("collectCreditModal");
  const infoEl = document.getElementById("collectModalInfo");
  const pendingEl = document.getElementById("collectPendingAmount");
  
  if (infoEl) infoEl.textContent = `Collecting credit from ${data.member}`;
  if (pendingEl) pendingEl.textContent = `₹${data.pendingAmount}`;
  
  // Reset inputs
  const cashInput = document.getElementById("collectCashInput");
  const upiInput = document.getElementById("collectUpiInput");
  const creditInput = document.getElementById("collectCreditInput");
  
  if (cashInput) cashInput.value = "";
  if (upiInput) upiInput.value = "";
  if (creditInput) creditInput.value = "";
  
  updateCollectRemaining();
  
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
}

window.closeCollectModal = () => {
  const modal = document.getElementById("collectCreditModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
  collectModalData = null;
};

window.updateCollectRemaining = () => {
  if (!collectModalData) return;
  
  const pending = collectModalData.pendingAmount;
  const cash = Number(document.getElementById("collectCashInput")?.value) || 0;
  const upi = Number(document.getElementById("collectUpiInput")?.value) || 0;
  const stillCredit = Number(document.getElementById("collectCreditInput")?.value) || 0;
  
  const remaining = pending - cash - upi - stillCredit;
  const remainingEl = document.getElementById("collectRemaining");
  
  if (remainingEl) {
    if (remaining < 0) {
      remainingEl.textContent = `Over by: ₹${Math.abs(remaining)}`;
      remainingEl.style.color = "#ff0044";
    } else if (remaining > 0) {
      remainingEl.textContent = `Remaining: ₹${remaining}`;
      remainingEl.style.color = "#ffff00";
    } else {
      remainingEl.textContent = `✓ Balanced`;
      remainingEl.style.color = "#00ff88";
    }
  }
};

window.collectAllCash = () => {
  if (!collectModalData) return;
  const pending = collectModalData.pendingAmount;
  const upi = Number(document.getElementById("collectUpiInput")?.value) || 0;
  const stillCredit = Number(document.getElementById("collectCreditInput")?.value) || 0;
  const cashInput = document.getElementById("collectCashInput");
  if (cashInput) cashInput.value = Math.max(0, pending - upi - stillCredit);
  updateCollectRemaining();
};

window.collectAllUpi = () => {
  if (!collectModalData) return;
  const pending = collectModalData.pendingAmount;
  const cash = Number(document.getElementById("collectCashInput")?.value) || 0;
  const stillCredit = Number(document.getElementById("collectCreditInput")?.value) || 0;
  const upiInput = document.getElementById("collectUpiInput");
  if (upiInput) upiInput.value = Math.max(0, pending - cash - stillCredit);
  updateCollectRemaining();
};

window.confirmCollectCredit = () => {
  if (!collectModalData) return;
  
  const pending = collectModalData.pendingAmount;
  const cash = Number(document.getElementById("collectCashInput")?.value) || 0;
  const upi = Number(document.getElementById("collectUpiInput")?.value) || 0;
  const stillCredit = Number(document.getElementById("collectCreditInput")?.value) || 0;
  
  const total = cash + upi + stillCredit;
  
  if (total !== pending) {
    notifyWarning(`Split amounts (₹${total}) don't match pending (₹${pending}). Please adjust.`);
    return;
  }
  
  const collected = cash + upi;
  
  if (collected === 0 && stillCredit === pending) {
    notifyWarning("No payment collected. Adjust the amounts.");
    return;
  }
  
  const { date, id, member, isNewFormat, originalRecord } = collectModalData;
  
  // Build payment description for audit
  const paymentParts = [];
  if (cash > 0) paymentParts.push(`₹${cash} Cash`);
  if (upi > 0) paymentParts.push(`₹${upi} UPI`);
  if (stillCredit > 0) paymentParts.push(`₹${stillCredit} still credit`);
  
  if (isNewFormat) {
    // New split format - update the record with payment history
    const newCreditPaid = (originalRecord.creditPaid || 0) + collected;
    const today = getISTDateString();
    const now = new Date().toISOString();
    
    // Build credit payments history (supports multiple partial payments across days)
    const existingPayments = originalRecord.creditPayments || {};
    const todayPayment = existingPayments[today] || { cash: 0, upi: 0 };
    
    // Add today's payment to the history
    const updatedPayments = {
      ...existingPayments,
      [today]: {
        cash: todayPayment.cash + cash,
        upi: todayPayment.upi + upi,
        at: now,
        by: getAdminName()
      }
    };
    
    rechargeDb.ref(`recharges/${date}/${id}`).update({
      creditPaid: newCreditPaid,
      creditPayments: updatedPayments,
      // Keep lastPaid fields for backward compatibility
      lastPaidAt: now,
      lastPaidCash: cash,
      lastPaidUpi: upi,
      lastPaidBy: getAdminName()
    });
  } else {
    // Old format
    if (stillCredit > 0) {
      // Partial payment on old format - convert to new format
      rechargeDb.ref(`recharges/${date}/${id}`).update({
        total: originalRecord.amount,
        cash: cash,
        upi: upi,
        credit: stillCredit,
        creditPaid: 0,
        mode: null, // Clear old mode
        paid: null,
        lastPaidAt: new Date().toISOString(),
        lastPaidBy: getAdminName()
      });
    } else {
      // Full payment on old format
      rechargeDb.ref(`recharges/${date}/${id}`).update({
        paid: true,
        paidAt: new Date().toISOString(),
        paidVia: cash > 0 ? (upi > 0 ? "cash+upi" : "cash") : "upi",
        paidBy: getAdminName()
      });
    }
  }
  
  logAudit("CREDIT_PAID", `${member}: ${paymentParts.join(", ")}`, collected);
  
  closeCollectModal();
  loadAllOutstandingCredits();
  
  if (date === selectedDate) {
    loadDay();
  }
};


window.editRecharge = id => {
  // Check if user can edit (Finance Manager cannot)
  if (!canEditData()) {
    notifyWarning("You have view-only access. Editing is not allowed.");
    return;
  }
  
  const r = state.find(x => x.id === id);
  if (!r) return;

  editId = id;
  if (elements.memberInput) elements.memberInput.value = r.member;
  if (elements.noteInput) elements.noteInput.value = r.note || "";
  if (elements.freeRechargeInput) elements.freeRechargeInput.value = r.free || "";
  
  // Handle both formats
  if (r.total !== undefined) {
    // New split format - show ACTUAL current state including settled credits
    // Cash = original cash + any cash used to settle credit
    const actualCash = (r.cash || 0) + (r.lastPaidCash || 0);
    // UPI = original upi + any upi used to settle credit
    const actualUpi = (r.upi || 0) + (r.lastPaidUpi || 0);
    // Credit = remaining unpaid credit
    const actualCredit = (r.credit || 0) - (r.creditPaid || 0);
    
    if (elements.totalAmountInput) elements.totalAmountInput.value = r.total;
    if (elements.cashInput) elements.cashInput.value = actualCash || "";
    if (elements.upiInput) elements.upiInput.value = actualUpi || "";
    if (elements.creditInput) elements.creditInput.value = actualCredit > 0 ? actualCredit : "";
  } else {
    // Old single-mode format
    if (r.mode === "credit" && r.paid) {
      // Credit was paid - show as cash/upi based on paidVia
      if (elements.totalAmountInput) elements.totalAmountInput.value = r.amount;
      if (r.paidVia === "upi") {
        if (elements.cashInput) elements.cashInput.value = "";
        if (elements.upiInput) elements.upiInput.value = r.amount;
        if (elements.creditInput) elements.creditInput.value = "";
      } else {
        // Default to cash
        if (elements.cashInput) elements.cashInput.value = r.amount;
        if (elements.upiInput) elements.upiInput.value = "";
        if (elements.creditInput) elements.creditInput.value = "";
      }
    } else {
      if (elements.totalAmountInput) elements.totalAmountInput.value = r.amount;
      if (elements.cashInput) elements.cashInput.value = r.mode === "cash" ? r.amount : "";
      if (elements.upiInput) elements.upiInput.value = r.mode === "upi" ? r.amount : "";
      if (elements.creditInput) elements.creditInput.value = r.mode === "credit" ? r.amount : "";
    }
  }
  
  updateSplitRemaining();
  
  // Open modal for editing
  openAddRechargeModal(true);
};

window.deleteRecharge = async id => {
  // Check if user can edit (Finance Manager cannot)
  if (!canEditData()) {
    notifyWarning("You have view-only access. Deleting is not allowed.");
    return;
  }
  
  const confirmed = await showConfirm("Delete this recharge entry?", {
    title: "Delete Entry",
    type: "error",
    confirmText: "Delete",
    cancelText: "Cancel"
  });
  
  if (confirmed) {
    rechargeDb.ref(`recharges/${selectedDate}/${id}`).remove();
    logAudit("DELETE", id);
    notifySuccess("Entry deleted");
  }
};

// ==================== AUDIT LOG ====================

function logAudit(action, ref, amount = "") {
  rechargeDb.ref(FB_PATHS.RECHARGE_AUDIT).push({
    action,
    ref,
    amount,
    mode: elements.modeInput?.value || "",
    admin: getAdminName(),
    date: selectedDate,
    at: new Date().toISOString()
  });
}

function loadAudit() {
  const el = $("auditLog");
  const countEl = $("auditCount");
  if (!el) return;

  el.innerHTML = `<div class="text-center text-gray-500 py-4">Loading...</div>`;

  rechargeDb.ref(FB_PATHS.RECHARGE_AUDIT).limitToLast(auditLimit).once("value").then(snap => {
    auditData = Object.values(snap.val() || {}).reverse();
    
    if (countEl) countEl.textContent = auditData.length;
    
    renderAudit();
  });
}

function renderAudit() {
  const el = $("auditLog");
  if (!el) return;

  const filtered = auditFilter === "all" 
    ? auditData 
    : auditData.filter(a => a.action === auditFilter);

  if (filtered.length === 0) {
    el.innerHTML = `<div class="text-center text-gray-500 py-4">No entries found</div>`;
    return;
  }

  el.innerHTML = filtered.map(a => {
    const actionColors = {
      ADD: { bg: "rgba(0,255,136,0.1)", color: "#00ff88", icon: "➕", label: "Added" },
      EDIT: { bg: "rgba(0,240,255,0.1)", color: "#00f0ff", icon: "✏️", label: "Edited" },
      DELETE: { bg: "rgba(255,0,68,0.1)", color: "#ff0044", icon: "🗑️", label: "Deleted" }
    };
    
    const style = actionColors[a.action] || actionColors.ADD;
    const date = a.at ? new Date(a.at) : new Date();
    // Use IST for time display
    const timeStr = date.toLocaleTimeString("en-IN", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" });
    const dateStr = date.toLocaleDateString("en-IN", { timeZone: TIMEZONE, day: "numeric", month: "short" });
    const relativeTime = getRelativeTime(date);

    return `
      <div class="audit-entry action-${a.action}">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0" 
              style="background: ${style.bg};">
              ${style.icon}
            </div>
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-orbitron text-sm font-bold" style="color: ${style.color};">${style.label}</span>
                ${a.ref ? `<span class="text-white font-medium">${a.ref}</span>` : ""}
                ${a.amount ? `<span class="px-2 py-0.5 rounded text-xs" style="background: rgba(0,255,136,0.2); color: #00ff88;">₹${a.amount}</span>` : ""}
                ${a.mode ? `<span class="text-xs text-gray-500 uppercase">${a.mode}</span>` : ""}
              </div>
              <div class="text-xs text-gray-500 mt-1 flex items-center gap-2">
                <span>by <span style="color: #00f0ff;">${a.admin || "Unknown"}</span></span>
                ${a.date ? `<span>• on ${a.date}</span>` : ""}
              </div>
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="text-xs text-gray-400">${timeStr}</div>
            <div class="text-xs text-gray-600">${relativeTime}</div>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function getRelativeTime(date) {
  // Use IST for relative time calculation
  const now = getISTDate();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-IN", { timeZone: TIMEZONE, day: "numeric", month: "short" });
}

window.filterAudit = (filter) => {
  auditFilter = filter;
  
  // Update active state
  document.querySelectorAll(".audit-filter").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
  
  renderAudit();
};

window.loadMoreAudit = () => {
  auditLimit += 20;
  loadAudit();
};


// ==================== EXPORTS ====================

window.exportMonthPDF = () => {
  const ym = selectedDate.slice(0, 7);
  const monthName = new Date(selectedDate).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  rechargeDb.ref(FB_PATHS.RECHARGES).once("value").then(snap => {
    const allData = snap.val() || {};
    const rows = [];
    let totalCash = 0, totalUPI = 0, totalCredit = 0, totalFree = 0, grandTotal = 0;

    Object.entries(allData).forEach(([d, v]) => {
      if (!d.startsWith(ym)) return;
      Object.values(v).forEach(r => {
        const cash = r.cash || 0;
        const upi = r.upi || 0;
        const credit = r.credit || 0;
        const free = r.free || 0;
        const total = (r.total || r.amount || 0) + free;
        
        // For old format
        let mode = "Split";
        if (r.mode) mode = r.mode.toUpperCase();
        else if (cash > 0 && upi === 0 && credit === 0) mode = "Cash";
        else if (upi > 0 && cash === 0 && credit === 0) mode = "UPI";
        else if (credit > 0 && cash === 0 && upi === 0) mode = "Credit";
        
        rows.push([
          d,
          r.member || "-",
          `Rs.${total}`,
          mode,
          r.admin || "Admin"
        ]);
        
        totalCash += cash + (r.lastPaidCash || 0);
        totalUPI += upi + (r.lastPaidUpi || 0);
        totalCredit += (credit - (r.creditPaid || 0));
        totalFree += free;
        grandTotal += total;
      });
    });

    if (rows.length === 0) {
      notifyWarning("No data to export for this month");
      return;
    }

    // Create PDF
    const doc = PDFExport.createStyledPDF();
    let y = PDFExport.addPDFHeader(doc, 'Monthly Recharges Report', monthName);
    
    // Summary stats
    y = PDFExport.addPDFSummary(doc, [
      { label: 'Total', value: `Rs.${grandTotal}`, color: 'neonGreen' },
      { label: 'Cash', value: `Rs.${totalCash}`, color: 'neonCyan' },
      { label: 'UPI', value: `Rs.${totalUPI}`, color: 'neonPurple' },
      { label: 'Credit Pending', value: `Rs.${totalCredit}`, color: 'neonOrange' },
    ], y);
    
    // Table
    PDFExport.addPDFTable(doc, 
      ['Date', 'Member', 'Amount', 'Mode', 'Admin'],
      rows,
      y,
      { statusColumn: 3 }
    );
    
    PDFExport.savePDF(doc, `recharges_${ym}`);
    notifySuccess("Monthly report exported as PDF");
  });
};

// Keep old function name for backward compatibility
window.exportMonthCSV = window.exportMonthPDF;

window.printSheet = () => {
  const w = window.open("");
  w.document.write(`
    <h2>Daily Recharge Sheet</h2>
    <p>Date: ${selectedDate}</p>
    <p>${elements.totalEl.textContent}</p>
    <p>${elements.cashEl.textContent} | ${elements.upiEl.textContent} | ${elements.cardEl.textContent}</p>
    <br><p>Admin: ${getAdminName()}</p>
  `);
  w.print();
};

// ==================== PANCAFE SYNC ====================

let syncResults = [];
let syncFilter = "all";

window.openSyncModal = () => {
  const modal = document.getElementById("syncModal");
  const dateBadge = document.getElementById("syncDateBadge");
  
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  
  if (dateBadge) {
    dateBadge.textContent = selectedDate;
  }
  
  runSync();
};

window.closeSyncModal = () => {
  const modal = document.getElementById("syncModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
};

async function runSync() {
  const loadingEl = document.getElementById("syncLoading");
  const resultsEl = document.getElementById("syncResults");
  const errorEl = document.getElementById("syncError");
  
  // Show loading
  loadingEl?.classList.remove("hidden");
  resultsEl?.classList.add("hidden");
  errorEl?.classList.add("hidden");
  
  try {
    // Get admin recharge entries for selected date
    const adminEntries = state.map(r => ({
      id: r.id,
      member: r.member?.toUpperCase().trim(),
      amount: (r.total || r.amount || 0) + (r.free || 0),
      paid: r.total || r.amount || 0,
      free: r.free || 0,
      createdAt: r.createdAt,
      note: r.note,
      mode: r.total !== undefined ? "split" : r.mode
    }));
    
    // Get PanCafe history entries for all members for selected date
    const panCafeEntries = await fetchPanCafeEntriesForDate(selectedDate);
    
    // Get guest sessions from Firebase for matching
    const guestSessionsData = await fetchGuestSessionsForDate(selectedDate);
    console.log(`📋 Found ${guestSessionsData.length} guest sessions in Firebase for ${selectedDate}`);
    
    // Debug: Log all unique member names from both sides
    const adminMembers = [...new Set(adminEntries.map(e => e.member))];
    const panCafeMembers = [...new Set(panCafeEntries.map(e => e.member))];
    console.log("📋 Admin members:", adminMembers);
    console.log("📋 PanCafe members:", panCafeMembers);
    
    // Match entries (with guest sessions data)
    const results = matchEntries(adminEntries, panCafeEntries, guestSessionsData);
    syncResults = results;
    
    // Update counts
    const matched = results.filter(r => r.status === "matched").length;
    const adminOnly = results.filter(r => r.status === "admin-only").length;
    const guestVerified = results.filter(r => r.status === "guest-verified").length;
    const guestUnverified = results.filter(r => r.status === "guest-session").length;
    const panCafeOnly = results.filter(r => r.status === "pancafe-only").length;
    const mismatch = results.filter(r => r.status === "mismatch").length;
    
    document.getElementById("syncMatched").textContent = matched + guestVerified;
    document.getElementById("syncOnlyAdmin").textContent = adminOnly + guestUnverified;
    document.getElementById("syncOnlyPanCafe").textContent = panCafeOnly;
    document.getElementById("syncMismatch").textContent = mismatch;
    
    // Update summary
    const summary = document.getElementById("syncSummary");
    if (summary) {
      const totalAdmin = adminEntries.length;
      const totalPanCafe = panCafeEntries.length;
      const guestNote = (guestVerified + guestUnverified) > 0 
        ? ` | 🎮 ${guestVerified + guestUnverified} guest (${guestVerified} verified)` 
        : "";
      summary.textContent = `Admin: ${totalAdmin} | PanCafe: ${totalPanCafe}${guestNote}`;
    }
    
    // Render results
    syncFilter = "all";
    renderSyncResults();
    
    // Show results
    loadingEl?.classList.add("hidden");
    resultsEl?.classList.remove("hidden");
    
  } catch (error) {
    console.error("Sync error:", error);
    loadingEl?.classList.add("hidden");
    errorEl?.classList.remove("hidden");
    
    const errorMsg = document.getElementById("syncErrorMsg");
    if (errorMsg) {
      errorMsg.textContent = error.message || "Failed to sync with PanCafe. Please try again.";
    }
  }
}

// Fetch guest sessions from Firebase for a specific date
async function fetchGuestSessionsForDate(date) {
  try {
    const sessions = [];
    
    // PRIMARY: Fetch from new guest-sessions/{date} path (from messages.msg parsing)
    try {
      const guestSessionsSnap = await fdbDb.ref(`${FB_PATHS.GUEST_SESSIONS}/${date}`).once("value");
      const guestSessionsData = guestSessionsSnap.val() || {};
      
      console.log(`🔍 Guest sessions from messages.msg (${date}):`, Object.keys(guestSessionsData).length, "entries");
      
      if (Object.keys(guestSessionsData).length > 0) {
        // Log sample structure
        const sampleKey = Object.keys(guestSessionsData)[0];
        console.log("🔍 Sample guest session:", guestSessionsData[sampleKey]);
        
        Object.entries(guestSessionsData).forEach(([sessionId, session]) => {
          sessions.push({
            id: sessionId,
            terminal: session.terminal || session.terminal_short,
            terminalShort: session.terminal_short || getShortTerminalName(session.terminal),
            minutes: session.duration_minutes || 0,
            price: session.total || session.usage || 0,
            startTime: session.start_time,
            endTime: session.end_time,
            source: "messages.msg"
          });
        });
      }
    } catch (e) {
      console.log("🔍 No guest-sessions data, trying fallback...");
    }
    
    // FALLBACK: If no data from messages.msg, try sessions-by-member/guest
    if (sessions.length === 0) {
      const guestSnap = await fdbDb.ref(`${FB_PATHS.SESSIONS_BY_MEMBER}/guest`).once("value");
      const guestData = guestSnap.val() || {};
      
      console.log("🔍 Fallback: Guest sessions from sessions-by-member/guest");
      
      Object.entries(guestData).forEach(([sessionId, session]) => {
        let sessionDate = session.DATE || session.date;
        
        // Extract date from STARTPOINT if needed
        if (!sessionDate && session.STARTPOINT) {
          sessionDate = session.STARTPOINT.split('T')[0].split(' ')[0];
        }
        if (!sessionDate && session.startpoint) {
          sessionDate = session.startpoint.split('T')[0].split(' ')[0];
        }
        
        if (sessionDate === date) {
          sessions.push({
            id: sessionId,
            terminal: normalizeTerminalName(session.TERMINALNAME) || session.TERMINALNAME,
            terminalShort: getShortTerminalName(session.TERMINALNAME),
            minutes: session.USINGMIN || 0,
            price: session.PRICE || 0,
            startTime: session.STARTPOINT,
            endTime: session.ENDPOINT,
            source: "sessions-by-member"
          });
        }
      });
    }
    
    console.log(`🔍 Total guest sessions found for ${date}: ${sessions.length}`);
    return sessions;
  } catch (error) {
    console.warn("Could not fetch guest sessions:", error);
    return [];
  }
}

async function fetchPanCafeEntriesForDate(date) {
  // Fetch all history data from fdb-dataset
  const historySnap = await fdbDb.ref(FB_PATHS.HISTORY).once("value");
  const historyData = historySnap.val() || {};
  
  const entries = [];
  
  // Iterate through all users' history
  Object.entries(historyData).forEach(([username, records]) => {
    if (!records) return;
    
    Object.entries(records).forEach(([recordId, record]) => {
      // Check if the record date matches selected date
      const recordDate = record.DATE; // Format: YYYY-MM-DD
      
      if (recordDate === date) {
        // Only include recharges (positive CHARGE amounts)
        const charge = Number(record.CHARGE) || 0;
        if (charge > 0) {
          entries.push({
            id: recordId,
            member: username.toUpperCase().trim(),
            amount: charge,
            balance: record.BALANCE,
            time: record.TIME,
            date: record.DATE,
            raw: record
          });
        }
      }
    });
  });
  
  return entries;
}

// Normalize terminal/member names for comparison
// Handles various formats: CT-ROOM-1, CT-ROOM 1, CTROOM1, CT1, etc.
function normalizeMemberName(name) {
  if (!name) return "";
  let n = name.toUpperCase().trim();
  
  // Remove common prefixes/variations
  n = n.replace(/[-_\s]+/g, ""); // Remove hyphens, underscores, spaces
  n = n.replace(/ROOM/g, "");    // Remove "ROOM"
  
  // Normalize Xbox variations
  if (n.includes("XBOX")) return "XBOX";
  
  // Normalize PlayStation variations  
  if (n === "PS" || n.includes("PLAYSTATION")) return "PS";
  
  return n;
}

// Check if two member names match (handles format variations)
function membersMatch(name1, name2) {
  if (!name1 || !name2) return false;
  
  // First try exact match (case-insensitive)
  const n1 = name1.toUpperCase().trim();
  const n2 = name2.toUpperCase().trim();
  if (n1 === n2) return true;
  
  // Then try normalized match
  const norm1 = normalizeMemberName(name1);
  const norm2 = normalizeMemberName(name2);
  
  // Debug logging for guest sessions
  if (norm1.match(/^(CT|T)\d+$/) || norm2.match(/^(CT|T)\d+$/)) {
    console.log(`🔍 Comparing: "${name1}" (${norm1}) vs "${name2}" (${norm2}) = ${norm1 === norm2}`);
  }
  
  return norm1 === norm2;
}

function matchEntries(adminEntries, panCafeEntries, guestSessions = []) {
  const results = [];
  const usedAdminIds = new Set();
  const usedPanCafeIds = new Set();
  const usedGuestIds = new Set();
  
  // First pass: exact matches (member + amount)
  adminEntries.forEach(admin => {
    const matchingPanCafe = panCafeEntries.find(pc => 
      membersMatch(pc.member, admin.member) && 
      pc.amount === admin.amount && 
      !usedPanCafeIds.has(pc.id)
    );
    
    if (matchingPanCafe) {
      results.push({
        status: "matched",
        member: admin.member,
        adminAmount: admin.amount,
        panCafeAmount: matchingPanCafe.amount,
        adminId: admin.id,
        panCafeId: matchingPanCafe.id,
        adminData: admin,
        panCafeData: matchingPanCafe
      });
      usedAdminIds.add(admin.id);
      usedPanCafeIds.add(matchingPanCafe.id);
    }
  });
  
  // Second pass: same member, different amount (potential mismatch)
  adminEntries.forEach(admin => {
    if (usedAdminIds.has(admin.id)) return;
    
    const sameMember = panCafeEntries.find(pc => 
      membersMatch(pc.member, admin.member) && 
      !usedPanCafeIds.has(pc.id)
    );
    
    if (sameMember) {
      results.push({
        status: "mismatch",
        member: admin.member,
        adminAmount: admin.amount,
        panCafeAmount: sameMember.amount,
        difference: admin.amount - sameMember.amount,
        adminId: admin.id,
        panCafeId: sameMember.id,
        adminData: admin,
        panCafeData: sameMember
      });
      usedAdminIds.add(admin.id);
      usedPanCafeIds.add(sameMember.id);
    }
  });
  
  // Third pass: guest session matching with Firebase data
  adminEntries.forEach(admin => {
    if (usedAdminIds.has(admin.id)) return;
    
    const isGuest = isGuestTerminal(admin.member);
    if (!isGuest) return;
    
    // Try to find a matching guest session from Firebase
    const normalizedMember = normalizeTerminalName(admin.member) || admin.member;
    const shortName = getShortTerminalName(admin.member);
    
    const matchingGuestSession = guestSessions.find(gs => 
      !usedGuestIds.has(gs.id) &&
      (gs.terminal === normalizedMember || 
       gs.terminalShort === shortName ||
       gs.terminal?.toUpperCase() === admin.member?.toUpperCase())
    );
    
    if (matchingGuestSession) {
      results.push({
        status: "guest-verified",
        member: admin.member,
        adminAmount: admin.amount,
        adminId: admin.id,
        adminData: admin,
        guestSession: matchingGuestSession,
        sessionMinutes: matchingGuestSession.minutes,
        sessionPrice: matchingGuestSession.price,
        isGuest: true
      });
      usedAdminIds.add(admin.id);
      usedGuestIds.add(matchingGuestSession.id);
    } else {
      // Guest session without Firebase verification
      results.push({
        status: "guest-session",
        member: admin.member,
        adminAmount: admin.amount,
        adminId: admin.id,
        adminData: admin,
        isGuest: true
      });
      usedAdminIds.add(admin.id);
    }
  });
  
  // Fourth pass: admin-only entries (not found in PanCafe and not guests)
  adminEntries.forEach(admin => {
    if (usedAdminIds.has(admin.id)) return;
    
    results.push({
      status: "admin-only",
      member: admin.member,
      adminAmount: admin.amount,
      adminId: admin.id,
      adminData: admin,
      isGuest: false
    });
  });
  
  // Fifth pass: pancafe-only entries (not found in Admin)
  panCafeEntries.forEach(pc => {
    if (usedPanCafeIds.has(pc.id)) return;
    
    results.push({
      status: "pancafe-only",
      member: pc.member,
      panCafeAmount: pc.amount,
      panCafeId: pc.id,
      panCafeData: pc
    });
  });
  
  // Sort by member name
  results.sort((a, b) => a.member.localeCompare(b.member));
  
  return results;
}

window.filterSyncResults = (filter) => {
  syncFilter = filter;
  
  // Update tab active state
  document.querySelectorAll(".sync-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === filter);
  });
  
  renderSyncResults();
};

function renderSyncResults() {
  const listEl = document.getElementById("syncResultsList");
  if (!listEl) return;
  
  // Handle filter with related statuses
  const filtered = syncFilter === "all" 
    ? syncResults 
    : syncFilter === "matched"
      ? syncResults.filter(r => r.status === "matched" || r.status === "guest-verified")
      : syncFilter === "admin-only"
        ? syncResults.filter(r => r.status === "admin-only" || r.status === "guest-session")
        : syncResults.filter(r => r.status === syncFilter);
  
  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-8 text-gray-500">
        <span class="text-4xl block mb-3">📭</span>
        <p>No entries found${syncFilter !== "all" ? " for this filter" : ""}</p>
      </div>
    `;
    return;
  }
  
  listEl.innerHTML = filtered.map(r => {
    const statusConfig = {
      "matched": { icon: "✅", label: "Matched", color: "#00ff88" },
      "guest-verified": { icon: "🎮✓", label: "Guest (Verified)", color: "#00ff88" },
      "admin-only": { icon: "⚠️", label: "Only in Admin", color: "#ffff00" },
      "guest-session": { icon: "🎮", label: "Guest (Unverified)", color: "#00f0ff" },
      "pancafe-only": { icon: "❌", label: "Only in PanCafe", color: "#ff0044" },
      "mismatch": { icon: "🔄", label: "Amount Mismatch", color: "#b829ff" }
    };
    
    const config = statusConfig[r.status] || statusConfig["admin-only"];
    
    let detailsHtml = "";
    
    if (r.status === "matched") {
      detailsHtml = `
        <div class="grid grid-cols-2 gap-4 mt-2 text-sm">
          <div class="p-2 rounded" style="background: rgba(0,0,0,0.3);">
            <div class="text-xs text-gray-500 mb-1">Admin Entry</div>
            <div style="color: #00f0ff;">₹${r.adminAmount}</div>
            ${r.adminData?.note ? `<div class="text-xs text-gray-500 mt-1">📝 ${r.adminData.note}</div>` : ""}
          </div>
          <div class="p-2 rounded" style="background: rgba(0,0,0,0.3);">
            <div class="text-xs text-gray-500 mb-1">PanCafe Entry</div>
            <div style="color: #00ff88;">₹${r.panCafeAmount}</div>
            ${r.panCafeData?.time ? `<div class="text-xs text-gray-500 mt-1">⏰ ${r.panCafeData.time}</div>` : ""}
          </div>
        </div>
      `;
    } else if (r.status === "guest-verified") {
      detailsHtml = `
        <div class="mt-2 p-2 rounded text-sm" style="background: rgba(0,255,136,0.1);">
          <div class="flex items-center justify-between">
            <span style="color: #00ff88;">₹${r.adminAmount}</span>
            <span class="text-xs px-2 py-0.5 rounded" style="background: rgba(0,255,136,0.2); color: #00ff88;">✓ Verified</span>
          </div>
          <div class="text-xs text-gray-400 mt-1">
            🎮 Guest session verified in Firebase 
            ${r.sessionMinutes ? `• ${r.sessionMinutes} min` : ""}
            ${r.sessionPrice ? `• Session: ₹${r.sessionPrice}` : ""}
          </div>
        </div>
      `;
    } else if (r.status === "guest-session") {
      detailsHtml = `
        <div class="mt-2 p-2 rounded text-sm" style="background: rgba(0,240,255,0.1);">
          <div class="flex items-center justify-between">
            <span style="color: #00f0ff;">₹${r.adminAmount}</span>
            ${r.adminData?.note ? `<span class="text-xs text-gray-500">📝 ${r.adminData.note}</span>` : ""}
          </div>
          <div class="text-xs text-gray-400 mt-1">🎮 Guest session - no Firebase record found (may be offline session)</div>
        </div>
      `;
    } else if (r.status === "admin-only") {
      detailsHtml = `
        <div class="mt-2 p-2 rounded text-sm" style="background: rgba(255,255,0,0.1);">
          <div class="flex items-center justify-between">
            <span style="color: #00f0ff;">₹${r.adminAmount}</span>
            ${r.adminData?.note ? `<span class="text-xs text-gray-500">📝 ${r.adminData.note}</span>` : ""}
          </div>
          <div class="text-xs text-gray-400 mt-1">This entry exists in Admin but not in PanCafe system</div>
        </div>
      `;
    } else if (r.status === "pancafe-only") {
      detailsHtml = `
        <div class="mt-2 p-2 rounded text-sm" style="background: rgba(255,0,68,0.1);">
          <div class="flex items-center justify-between">
            <span style="color: #00ff88;">₹${r.panCafeAmount}</span>
            ${r.panCafeData?.time ? `<span class="text-xs text-gray-500">⏰ ${r.panCafeData.time}</span>` : ""}
          </div>
          <div class="text-xs text-gray-400 mt-1">This entry exists in PanCafe but not recorded in Admin</div>
        </div>
      `;
    } else if (r.status === "mismatch") {
      const diffColor = r.difference > 0 ? "#00ff88" : "#ff0044";
      const diffSign = r.difference > 0 ? "+" : "";
      detailsHtml = `
        <div class="grid grid-cols-3 gap-3 mt-2 text-sm">
          <div class="p-2 rounded text-center" style="background: rgba(0,240,255,0.1);">
            <div class="text-xs text-gray-500 mb-1">Admin</div>
            <div style="color: #00f0ff;">₹${r.adminAmount}</div>
          </div>
          <div class="p-2 rounded text-center" style="background: rgba(0,255,136,0.1);">
            <div class="text-xs text-gray-500 mb-1">PanCafe</div>
            <div style="color: #00ff88;">₹${r.panCafeAmount}</div>
          </div>
          <div class="p-2 rounded text-center" style="background: rgba(184,41,255,0.1);">
            <div class="text-xs text-gray-500 mb-1">Difference</div>
            <div style="color: ${diffColor};">${diffSign}₹${r.difference}</div>
          </div>
        </div>
      `;
    }
    
    return `
      <div class="sync-item ${r.status}">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="text-xl">${config.icon}</span>
            <span class="font-orbitron font-bold" style="color: #00f0ff;">${r.member}</span>
          </div>
          <span class="text-xs px-2 py-1 rounded" style="background: ${config.color}20; color: ${config.color};">
            ${config.label}
          </span>
        </div>
        ${detailsHtml}
      </div>
    `;
  }).join("");
}

window.exportSyncReport = () => {
  if (syncResults.length === 0) {
    notifyWarning("No sync results to export");
    return;
  }
  
  // Count by status
  const matched = syncResults.filter(r => r.status === "matched").length;
  const adminOnly = syncResults.filter(r => r.status === "admin-only").length;
  const panCafeOnly = syncResults.filter(r => r.status === "pancafe-only").length;
  const mismatch = syncResults.filter(r => r.status === "mismatch").length;
  
  // Prepare rows with status labels (ASCII-safe)
  const rows = syncResults.map(r => {
    const statusLabels = {
      "matched": "MATCHED",
      "admin-only": "ADMIN ONLY",
      "pancafe-only": "PANCAFE ONLY",
      "mismatch": "MISMATCH"
    };
    return [
      statusLabels[r.status] || r.status,
      r.member,
      r.adminAmount ? `Rs.${r.adminAmount}` : "-",
      r.panCafeAmount ? `Rs.${r.panCafeAmount}` : "-",
      r.difference ? `Rs.${r.difference}` : "-",
      r.adminData?.note || "-"
    ];
  });
  
  // Create PDF
  const doc = PDFExport.createStyledPDF();
  let y = PDFExport.addPDFHeader(doc, 'PanCafe Sync Report', selectedDate);
  
  // Summary stats
  y = PDFExport.addPDFSummary(doc, [
    { label: 'Matched', value: String(matched), color: 'neonGreen' },
    { label: 'Admin Only', value: String(adminOnly), color: 'neonYellow' },
    { label: 'PanCafe Only', value: String(panCafeOnly), color: 'neonRed' },
    { label: 'Mismatch', value: String(mismatch), color: 'neonPurple' },
  ], y);
  
  // Table
  PDFExport.addPDFTable(doc, 
    ['Status', 'Member', 'Admin Amt', 'PanCafe Amt', 'Diff', 'Note'],
    rows,
    y,
    { statusColumn: 0 }
  );
  
  PDFExport.savePDF(doc, `sync-report-${selectedDate}`);
  notifySuccess("Sync report exported as PDF");
};
