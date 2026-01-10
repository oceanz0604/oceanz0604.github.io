/**
 * OceanZ Gaming Cafe - Daily Recharges Management
 */

import { 
  BOOKING_DB_CONFIG, 
  FDB_DATASET_CONFIG, 
  BOOKING_APP_NAME, 
  FDB_APP_NAME,
  TIMEZONE,
  getISTDate,
  formatToIST
} from "../../shared/config.js";
import { getStaffSession } from "./permissions.js";

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

// ==================== DATE PICKER ====================

if (elements.datePicker) {
  elements.datePicker.value = selectedDate;
  elements.datePicker.onchange = e => {
    selectedDate = e.target.value;
    loadDay();
  };
}

// ==================== MEMBER AUTOCOMPLETE ====================

fdbDb.ref("fdb/MEMBERS").once("value").then(snap => {
  allMembers = Object.values(snap.val() || []);
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
    loadAudit();
    // Reload outstanding credits whenever data changes (including new credit entries)
    loadAllOutstandingCredits();
  });
}

// Load all outstanding credits across all dates
function loadAllOutstandingCredits() {
  rechargeDb.ref("recharges").once("value").then(snap => {
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
  // When credit is collected via cash/UPI, it's added to those totals
  state.forEach(r => {
    if (r.total !== undefined) {
      // New split payment format
      // Direct cash and UPI payments
      cashTotal += r.cash || 0;
      upiTotal += r.upi || 0;
      freeTotal += r.free || 0;
      
      // Add collected credit payments to cash/UPI based on how they were paid
      if (r.lastPaidCash) cashTotal += r.lastPaidCash;
      if (r.lastPaidUpi) upiTotal += r.lastPaidUpi;
      
      // Calculate totals
      const collected = (r.cash || 0) + (r.upi || 0) + (r.creditPaid || 0);
      totalCollected += collected;
      creditPending += (r.credit || 0) - (r.creditPaid || 0);
    } else if (r.amount !== undefined) {
      // Old single-mode format (backward compatibility)
      if (r.mode === "credit") {
        if (r.paid) {
          // Credit was paid - add to appropriate payment method
          if (r.paidVia === "cash" || r.paidVia === "cash+upi") {
            cashTotal += r.amount; // Approximate: add full to cash for old records
          } else if (r.paidVia === "upi") {
            upiTotal += r.amount;
          } else {
            cashTotal += r.amount; // Default to cash for old paid credits
          }
          totalCollected += r.amount;
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
        // Show how the credit was settled (via cash/UPI)
        if (r.creditPaid > 0) {
          if (r.lastPaidCash > 0 && r.lastPaidUpi > 0) {
            badges.push(`<span class="payment-badge cash" title="Credit settled">✓💵 ₹${r.lastPaidCash}</span>`);
            badges.push(`<span class="payment-badge upi" title="Credit settled">✓📱 ₹${r.lastPaidUpi}</span>`);
          } else if (r.lastPaidCash > 0) {
            badges.push(`<span class="payment-badge cash" title="Credit settled via Cash">✓💵 ₹${r.lastPaidCash}</span>`);
          } else if (r.lastPaidUpi > 0) {
            badges.push(`<span class="payment-badge upi" title="Credit settled via UPI">✓📱 ₹${r.lastPaidUpi}</span>`);
          } else {
            // Fallback for old records without lastPaid info
            badges.push(`<span class="payment-badge credit-paid">✓ ₹${r.creditPaid}</span>`);
          }
        }
      }
      paymentBadges = badges.join(" ");
    } else {
      // Old single-mode format
      if (r.mode === "credit" && r.paid) {
        // Show as settled via the payment method used
        const paidVia = r.paidVia || "cash";
        if (paidVia.includes("cash")) {
          paymentBadges = `<span class="payment-badge cash">✓💵 ₹${r.amount}</span>`;
        } else if (paidVia === "upi") {
          paymentBadges = `<span class="payment-badge upi">✓📱 ₹${r.amount}</span>`;
        } else {
          paymentBadges = `<span class="payment-badge credit-paid">✓ ₹${r.amount}</span>`;
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
        <span class="font-orbitron font-bold text-lg" style="color: var(--neon-green);">₹${(r.total || r.amount || 0) + (r.free || 0)}</span>
        ${r.free > 0 ? `<div class="text-xs" style="color: #ffff00;">(₹${r.total || 0} + ₹${r.free} free)</div>` : ''}
      </td>
      <td class="px-4 py-3">
        <div class="flex flex-wrap gap-1">${paymentBadges}</div>
      </td>
      <td class="px-4 py-3 text-gray-400 text-xs max-w-32 truncate" title="${r.note || ''}">
        ${r.note || "-"}
      </td>
      <td class="px-4 py-3">
        <span class="text-xs px-2 py-1 rounded" style="background: rgba(0,240,255,0.1); color: var(--neon-cyan);">${r.admin || "Admin"}</span>
      </td>
      <td class="px-4 py-3 text-right">
        <div class="flex gap-1 justify-end items-center">
          ${pendingCreditAmount > 0 ? `
            <button onclick="collectCredit('${r.id}', ${pendingCreditAmount})" 
              class="text-xs px-2 py-1 rounded transition-all hover:scale-105"
              style="background: rgba(255,107,0,0.2); color: #ff6b00; border: 1px solid rgba(255,107,0,0.3);">
              Collect
            </button>
          ` : ''}
          <button onclick="editRecharge('${r.id}')" 
            class="p-1.5 rounded transition-all hover:scale-110 hover:bg-cyan-500/20" style="color: var(--neon-cyan);">
            ✏️
          </button>
          <button onclick="deleteRecharge('${r.id}')" 
            class="p-1.5 rounded transition-all hover:scale-110 hover:bg-red-500/20" style="color: #ff0044;">
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
    // New split format - update the record
    const newCreditPaid = (originalRecord.creditPaid || 0) + collected;
    const newCreditRemaining = (originalRecord.credit || 0) - newCreditPaid;
    
    rechargeDb.ref(`recharges/${date}/${id}`).update({
      creditPaid: newCreditPaid,
      lastPaidAt: new Date().toISOString(),
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
  rechargeDb.ref("recharge_audit").push({
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

  rechargeDb.ref("recharge_audit").limitToLast(auditLimit).once("value").then(snap => {
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

window.exportMonthCSV = () => {
  const ym = selectedDate.slice(0, 7);
  const rows = [["Date", "Member", "Amount", "Mode", "Admin"]];

  rechargeDb.ref("recharges").once("value").then(snap => {
    Object.entries(snap.val() || {}).forEach(([d, v]) => {
      if (!d.startsWith(ym)) return;
      Object.values(v).forEach(r => rows.push([d, r.member, r.amount, r.mode, r.admin]));
    });

    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `recharges_${ym}.csv`;
    a.click();
  });
};

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
