/**
 * OceanZ Gaming Cafe - Cash Register Management
 * Daily cash tracking with denomination breakdown
 * 
 * Redesigned: Card-based history with modal details
 */

import { 
  BOOKING_DB_CONFIG, 
  BOOKING_APP_NAME,
  TIMEZONE,
  getISTDate,
  formatToIST,
  FB_PATHS,
  SharedCache
} from "../../shared/config.js";
import { getStaffSession, canEditData } from "./permissions.js";

// ==================== FIREBASE INIT ====================

let bookingApp = firebase.apps.find(a => a.name === BOOKING_APP_NAME);
if (!bookingApp) bookingApp = firebase.initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);

const db = bookingApp.database();

// ==================== STATE ====================

let cashData = [];
let selectedMonth = getISTDateString().slice(0, 7); // YYYY-MM format
let currentDetailEntry = null; // For modal

function getISTDateString() {
  const now = getISTDate();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getAdminName() {
  const session = getStaffSession();
  return session?.name || session?.email?.split("@")[0] || "Admin";
}

// ==================== DENOMINATION CONFIG ====================

const DENOMINATIONS = [
  { value: 500, label: "₹500", color: "#00ff88" },
  { value: 200, label: "₹200", color: "#00f0ff" },
  { value: 100, label: "₹100", color: "#b829ff" },
  { value: 50, label: "₹50", color: "#ff6b00" },
  { value: 20, label: "₹20", color: "#ffff00" },
  { value: 10, label: "₹10", color: "#ff0044" },
  { value: 0, label: "Coins", color: "#888", isCoins: true } // Coins - direct amount input
];

// ==================== RENDER CASH REGISTER UI ====================

window.loadCashRegister = function() {
  const container = document.getElementById("cash-register-content");
  if (!container) return;

  container.innerHTML = `
    <div class="space-y-6">
      
      <!-- Header with Add Button -->
      <div class="flex items-center justify-between flex-wrap gap-4">
          <div>
          <h2 class="font-orbitron text-xl font-bold" style="color: #00f0ff;">💰 CASH REGISTER</h2>
          <p class="text-gray-500 text-sm mt-1">Daily cash tracking and denomination breakdown</p>
          </div>
        <div class="flex items-center gap-3">
          <input type="month" id="monthPicker" class="neon-input px-3 py-2 rounded-lg text-white text-sm"/>
          <button onclick="exportCashPDF()" class="neon-btn px-4 py-2 rounded-lg text-sm" style="border-color: rgba(0,240,255,0.3); color: #00f0ff;">
            📄 Export
          </button>
          <button onclick="openCashEntryModal()" class="px-4 py-2 rounded-lg font-orbitron font-bold text-sm"
            style="background: linear-gradient(135deg, #00ff88, #00cc66); color: #000;">
            + NEW ENTRY
          </button>
            </div>
          </div>

      <!-- Monthly Stats Summary Cards -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div class="p-4 rounded-xl text-center" style="background: linear-gradient(135deg, rgba(0,255,136,0.1), rgba(0,255,136,0.05)); border: 1px solid rgba(0,255,136,0.2);">
          <div class="text-gray-500 text-[10px] uppercase tracking-wider">Total Sales</div>
          <div id="monthSales" class="text-xl font-bold font-orbitron mt-1" style="color: #00ff88;">₹0</div>
              </div>
        <div class="p-4 rounded-xl text-center" style="background: linear-gradient(135deg, rgba(255,107,0,0.1), rgba(255,107,0,0.05)); border: 1px solid rgba(255,107,0,0.2);">
          <div class="text-gray-500 text-[10px] uppercase tracking-wider">Withdrawals</div>
          <div id="monthWithdrawals" class="text-xl font-bold font-orbitron mt-1" style="color: #ff6b00;">₹0</div>
              </div>
        <div class="p-4 rounded-xl text-center" style="background: linear-gradient(135deg, rgba(255,0,68,0.1), rgba(255,0,68,0.05)); border: 1px solid rgba(255,0,68,0.2);">
          <div class="text-gray-500 text-[10px] uppercase tracking-wider">Expenses</div>
          <div id="monthExpenses" class="text-xl font-bold font-orbitron mt-1" style="color: #ff0044;">₹0</div>
            </div>
        <div class="p-4 rounded-xl text-center" style="background: linear-gradient(135deg, rgba(0,240,255,0.1), rgba(0,240,255,0.05)); border: 1px solid rgba(0,240,255,0.2);">
          <div class="text-gray-500 text-[10px] uppercase tracking-wider">Net Cash</div>
          <div id="monthNet" class="text-xl font-bold font-orbitron mt-1" style="color: #00f0ff;">₹0</div>
          </div>
        <div class="p-4 rounded-xl text-center" style="background: linear-gradient(135deg, rgba(184,41,255,0.1), rgba(184,41,255,0.05)); border: 1px solid rgba(184,41,255,0.2);">
          <div class="text-gray-500 text-[10px] uppercase tracking-wider">Avg Daily</div>
          <div id="avgDailySale" class="text-xl font-bold font-orbitron mt-1" style="color: #b829ff;">₹0</div>
          </div>
        </div>

      <!-- History Cards Grid -->
      <div id="cashHistoryCards" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
      
      <!-- Empty State -->
      <div id="cashEmptyState" class="hidden text-center py-12">
        <div class="text-6xl mb-4">📭</div>
        <p class="text-gray-500">No entries for this month</p>
        <button onclick="openCashEntryModal()" class="mt-4 px-6 py-2 rounded-lg text-sm" 
          style="background: rgba(0,255,136,0.2); color: #00ff88; border: 1px solid rgba(0,255,136,0.3);">
          Add First Entry
        </button>
          </div>
        </div>

    <!-- Detail/Edit Modal -->
    <div id="cashDetailModal" class="fixed inset-0 z-50 hidden" style="background: rgba(0,0,0,0.8); backdrop-filter: blur(8px);">
      <div class="flex items-center justify-center min-h-screen p-4">
        <div class="neon-card rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative"
          style="border-color: rgba(0,240,255,0.3); background: linear-gradient(180deg, #0a1628 0%, #0d1f3c 100%);">
          
          <!-- Modal Header -->
          <div class="sticky top-0 z-10 p-4 border-b border-gray-800 flex items-center justify-between"
            style="background: linear-gradient(180deg, #0a1628 0%, #0d1f3c 100%);">
            <div>
              <h3 id="modalTitle" class="font-orbitron text-lg font-bold" style="color: #00f0ff;">Cash Entry</h3>
              <p id="modalSubtitle" class="text-xs text-gray-500 mt-0.5"></p>
        </div>
            <button onclick="closeCashModal()" class="p-2 rounded-lg hover:bg-gray-800 transition-colors">
              <span class="text-2xl text-gray-400">×</span>
        </button>
      </div>

          <!-- Modal Content -->
          <div id="modalContent" class="p-6">
            <!-- Content will be dynamically loaded -->
          </div>
        </div>
      </div>
    </div>
  `;

  // Set month picker
  const monthPicker = document.getElementById("monthPicker");
  monthPicker.value = selectedMonth;
  monthPicker.onchange = (e) => {
    selectedMonth = e.target.value;
    loadCashHistory();
  };

  // Load history
  loadCashHistory();
};

// ==================== CALCULATIONS (Legacy - kept for compatibility) ====================

window.calculateDenominations = function() {
  calculateModalDenominations();
};

window.calculateCashTotals = function() {
  calculateModalTotals();
};

// ==================== SAVE ENTRY (Legacy - redirects to modal) ====================

window.saveCashEntry = async function() {
  // Legacy function - now handled by modal
  saveModalEntry();
};

// Refresh sale from recharges (button handler - redirects to modal)
window.refreshSaleFromRecharges = async function() {
  refreshModalSale();
};

async function loadCashHistory() {
  const cardsEl = document.getElementById("cashHistoryCards");
  const emptyEl = document.getElementById("cashEmptyState");
  if (!cardsEl) return;
  
  cardsEl.innerHTML = `
    <div class="col-span-full py-8 text-center text-gray-500">
      <div class="animate-pulse">Loading...</div>
    </div>
  `;
  
  try {
    const snapshot = await db.ref(FB_PATHS.CASH_REGISTER).orderByKey().once("value");
    const allData = snapshot.val() || {};
    
    // Filter by selected month and sort by date DESCENDING (recent first)
    cashData = Object.entries(allData)
      .filter(([date]) => date.startsWith(selectedMonth))
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => b.date.localeCompare(a.date)); // Recent first
    
    if (cashData.length === 0) {
      cardsEl.innerHTML = "";
      emptyEl?.classList.remove("hidden");
      updateMonthlyStats([]);
      return;
    }
    
    emptyEl?.classList.add("hidden");
    
    // Render as cards
    cardsEl.innerHTML = cashData.map((entry, index) => {
      const isToday = entry.date === getISTDateString();
      const hasWithdrawal = entry.withdrawal > 0;
      const hasExpenses = entry.expenses > 0;
      const diff = entry.difference || 0;
      const isBalanced = diff === 0;
      const isExcess = diff > 0;
      const isShortage = diff < 0;
      
      // Card accent color based on status
      let accentColor = "rgba(0,240,255,0.3)"; // Default cyan
      if (isToday) accentColor = "rgba(0,255,136,0.5)"; // Green for today
      else if (isShortage) accentColor = "rgba(255,0,68,0.3)"; // Red for shortage
      else if (isExcess) accentColor = "rgba(255,200,0,0.3)"; // Yellow for excess
      
      // Date formatting
      const dateObj = new Date(entry.date);
      const dayName = dateObj.toLocaleDateString("en-IN", { weekday: "short" });
      const dayNum = dateObj.getDate();
      const monthName = dateObj.toLocaleDateString("en-IN", { month: "short" });
      
      return `
        <div class="group cursor-pointer rounded-xl overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-lg"
          onclick="openEntryDetail('${entry.date}')"
          style="background: linear-gradient(135deg, rgba(13,31,60,0.9), rgba(10,22,40,0.95)); border: 1px solid ${accentColor};">
          
          <!-- Card Header -->
          <div class="p-4 border-b border-gray-800/50">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="text-center p-2 rounded-lg" style="background: rgba(0,240,255,0.1); min-width: 50px;">
                  <div class="text-2xl font-orbitron font-bold" style="color: ${isToday ? '#00ff88' : '#00f0ff'};">${dayNum}</div>
                  <div class="text-[10px] text-gray-500 uppercase">${dayName}</div>
            </div>
                <div>
                  ${isToday ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold" style="background: rgba(0,255,136,0.2); color: #00ff88;">TODAY</span>' : ''}
                  <div class="text-xs text-gray-500 mt-0.5">${monthName} ${dateObj.getFullYear()}</div>
            </div>
          </div>
              <div class="text-right">
                <div class="text-xs text-gray-500">Total Sale</div>
                <div class="text-xl font-orbitron font-bold" style="color: #00ff88;">
                  ₹${(entry.sale || 0).toLocaleString("en-IN")}
            </div>
          </div>
            </div>
          </div>
          
          <!-- Card Body - Quick Stats -->
          <div class="p-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <div class="text-[10px] text-gray-500 uppercase">Opening</div>
              <div class="font-orbitron text-sm" style="color: #00f0ff;">₹${(entry.opening || 0).toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div class="text-[10px] text-gray-500 uppercase">Closing</div>
              <div class="font-orbitron text-sm" style="color: #b829ff;">₹${(entry.actualClosing || entry.closing || 0).toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div class="text-[10px] text-gray-500 uppercase">Status</div>
              <div class="text-sm font-bold" style="color: ${isBalanced ? '#00ff88' : isExcess ? '#ffff00' : '#ff0044'};">
                ${isBalanced ? '✓ OK' : isExcess ? `+${diff}` : `${diff}`}
              </div>
            </div>
          </div>
          
          <!-- Card Footer - Badges -->
          <div class="px-4 pb-3 flex items-center gap-2 flex-wrap">
            ${hasWithdrawal ? `
              <span class="px-2 py-1 rounded text-[10px]" style="background: rgba(255,107,0,0.15); color: #ff6b00; border: 1px solid rgba(255,107,0,0.3);">
                💸 W/D: ₹${entry.withdrawal}
              </span>
            ` : ''}
            ${hasExpenses ? `
              <span class="px-2 py-1 rounded text-[10px]" style="background: rgba(255,0,68,0.15); color: #ff0044; border: 1px solid rgba(255,0,68,0.3);">
                📤 Exp: ₹${entry.expenses}
              </span>
            ` : ''}
            ${entry.comments ? `
              <span class="px-2 py-1 rounded text-[10px] text-gray-400 truncate" style="background: rgba(100,100,100,0.15); max-width: 120px;" title="${entry.comments}">
                📝 ${entry.comments}
              </span>
            ` : ''}
            ${!hasWithdrawal && !hasExpenses && !entry.comments ? `
              <span class="text-[10px] text-gray-600">Click for details</span>
            ` : ''}
          </div>
        </div>
      `;
    }).join("");
    
    updateMonthlyStats(cashData);
    
  } catch (error) {
    console.error("Error loading cash history:", error);
    cardsEl.innerHTML = `<div class="col-span-full py-8 text-center text-red-400">Error loading data</div>`;
  }
}

function updateMonthlyStats(data) {
  const totalSales = data.reduce((sum, e) => sum + (e.sale || 0), 0);
  const totalWithdrawals = data.reduce((sum, e) => sum + (e.withdrawal || 0), 0);
  const totalExpenses = data.reduce((sum, e) => sum + (e.expenses || 0), 0);
  const netCash = totalSales - totalWithdrawals - totalExpenses;
  const avgDaily = data.length > 0 ? Math.round(totalSales / data.length) : 0;
  
  document.getElementById("monthSales").textContent = `₹${totalSales.toLocaleString("en-IN")}`;
  document.getElementById("monthWithdrawals").textContent = `₹${totalWithdrawals.toLocaleString("en-IN")}`;
  document.getElementById("monthExpenses").textContent = `₹${totalExpenses.toLocaleString("en-IN")}`;
  document.getElementById("monthNet").textContent = `₹${netCash.toLocaleString("en-IN")}`;
  document.getElementById("avgDailySale").textContent = `₹${avgDaily.toLocaleString("en-IN")}`;
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ==================== MODAL FUNCTIONS ====================

// Open entry detail view
window.openEntryDetail = async function(date) {
  const modal = document.getElementById("cashDetailModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalSubtitle = document.getElementById("modalSubtitle");
  const modalContent = document.getElementById("modalContent");
  
  if (!modal) return;
  
  // Find entry in cached data
  const entry = cashData.find(e => e.date === date);
  if (!entry) return;
  
  currentDetailEntry = entry;
  
  const dateObj = new Date(date);
  const isToday = date === getISTDateString();
  const diff = entry.difference || 0;
  
  modalTitle.innerHTML = `📅 ${dateObj.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`;
  modalSubtitle.textContent = entry.admin ? `Last updated by ${entry.admin}` : "";
  
  // Build denomination display
  let denomHtml = "";
  if (entry.denominations) {
    const denomItems = [];
  DENOMINATIONS.forEach(d => {
    const key = d.isCoins ? "coins" : `d${d.value}`;
      const count = entry.denominations[key] || 0;
      if (count > 0) {
        const amount = d.isCoins ? count : count * d.value;
        denomItems.push(`
          <div class="flex items-center justify-between p-2 rounded-lg" style="background: rgba(0,0,0,0.3);">
            <span style="color: ${d.color};">${d.label}</span>
            <span class="text-white font-orbitron">${d.isCoins ? `₹${count}` : `${count} × ₹${d.value} = ₹${amount}`}</span>
          </div>
        `);
      }
    });
    if (denomItems.length > 0) {
      denomHtml = `
        <div class="mb-6">
          <h4 class="text-xs text-gray-400 uppercase tracking-wider mb-3">💵 Denomination Breakdown</h4>
          <div class="grid grid-cols-1 gap-2">
            ${denomItems.join("")}
          </div>
        </div>
      `;
    }
  }
  
  modalContent.innerHTML = `
    <!-- Summary Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="p-4 rounded-xl text-center" style="background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.2);">
        <div class="text-[10px] text-gray-500 uppercase">Opening</div>
        <div class="text-xl font-orbitron font-bold" style="color: #00ff88;">₹${(entry.opening || 0).toLocaleString("en-IN")}</div>
      </div>
      <div class="p-4 rounded-xl text-center" style="background: rgba(0,240,255,0.1); border: 1px solid rgba(0,240,255,0.2);">
        <div class="text-[10px] text-gray-500 uppercase">Sale (Cash)</div>
        <div class="text-xl font-orbitron font-bold" style="color: #00f0ff;">₹${(entry.sale || 0).toLocaleString("en-IN")}</div>
      </div>
      <div class="p-4 rounded-xl text-center" style="background: rgba(184,41,255,0.1); border: 1px solid rgba(184,41,255,0.2);">
        <div class="text-[10px] text-gray-500 uppercase">Closing</div>
        <div class="text-xl font-orbitron font-bold" style="color: #b829ff;">₹${(entry.actualClosing || entry.closing || 0).toLocaleString("en-IN")}</div>
      </div>
      <div class="p-4 rounded-xl text-center" style="background: ${diff === 0 ? 'rgba(0,255,136,0.1)' : diff > 0 ? 'rgba(255,255,0,0.1)' : 'rgba(255,0,68,0.1)'}; border: 1px solid ${diff === 0 ? 'rgba(0,255,136,0.2)' : diff > 0 ? 'rgba(255,255,0,0.2)' : 'rgba(255,0,68,0.2)'};">
        <div class="text-[10px] text-gray-500 uppercase">Difference</div>
        <div class="text-xl font-orbitron font-bold" style="color: ${diff === 0 ? '#00ff88' : diff > 0 ? '#ffff00' : '#ff0044'};">
          ${diff === 0 ? '✓ Balanced' : (diff > 0 ? '+' : '') + '₹' + diff.toLocaleString("en-IN")}
        </div>
      </div>
    </div>
    
    <!-- Details Grid -->
    <div class="grid md:grid-cols-2 gap-4 mb-6">
      <div class="p-4 rounded-xl" style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05);">
        <h4 class="text-xs text-gray-400 uppercase tracking-wider mb-3">💰 Cash Flow</h4>
        <div class="space-y-2">
          <div class="flex justify-between items-center py-2 border-b border-gray-800">
            <span class="text-gray-400">Opening Balance</span>
            <span class="font-orbitron" style="color: #00ff88;">+₹${(entry.opening || 0).toLocaleString("en-IN")}</span>
          </div>
          <div class="flex justify-between items-center py-2 border-b border-gray-800">
            <span class="text-gray-400">Today's Sale</span>
            <span class="font-orbitron" style="color: #00f0ff;">+₹${(entry.sale || 0).toLocaleString("en-IN")}</span>
          </div>
          ${entry.withdrawal ? `
          <div class="flex justify-between items-center py-2 border-b border-gray-800">
            <span class="text-gray-400">Withdrawal</span>
            <span class="font-orbitron" style="color: #ff6b00;">-₹${entry.withdrawal.toLocaleString("en-IN")}</span>
            ${entry.withdrawalCash && entry.withdrawalCoins ? `<span class="text-xs text-gray-600">(💵${entry.withdrawalCash} + 🪙${entry.withdrawalCoins})</span>` : ''}
          </div>
          ` : ''}
          ${entry.expenses ? `
          <div class="flex justify-between items-center py-2 border-b border-gray-800">
            <span class="text-gray-400">Expenses</span>
            <span class="font-orbitron" style="color: #ff0044;">-₹${entry.expenses.toLocaleString("en-IN")}</span>
          </div>
          ` : ''}
          <div class="flex justify-between items-center py-2 font-bold">
            <span class="text-white">Expected Closing</span>
            <span class="font-orbitron" style="color: #00ff88;">₹${(entry.closing || 0).toLocaleString("en-IN")}</span>
          </div>
          <div class="flex justify-between items-center py-2 font-bold">
            <span class="text-white">Actual Closing</span>
            <span class="font-orbitron" style="color: #b829ff;">₹${(entry.actualClosing || 0).toLocaleString("en-IN")}</span>
          </div>
        </div>
      </div>
      
      <div>
        ${denomHtml || `
        <div class="p-4 rounded-xl h-full flex items-center justify-center" style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05);">
          <p class="text-gray-500 text-sm">No denomination breakdown recorded</p>
        </div>
        `}
      </div>
    </div>
    
    <!-- Comments -->
    ${entry.comments ? `
    <div class="p-4 rounded-xl mb-6" style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05);">
      <h4 class="text-xs text-gray-400 uppercase tracking-wider mb-2">📝 Comments</h4>
      <p class="text-white">${entry.comments}</p>
    </div>
    ` : ''}
    
    <!-- Action Buttons -->
    <div class="flex items-center justify-end gap-3 pt-4 border-t border-gray-800">
      <button onclick="closeCashModal()" class="px-6 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
        style="background: rgba(100,100,100,0.2);">
        Close
      </button>
      <button onclick="editCashEntryInModal('${date}')" class="px-6 py-2 rounded-lg text-sm font-orbitron font-bold"
        style="background: linear-gradient(135deg, #00f0ff, #0088cc); color: #000;">
        ✏️ Edit Entry
      </button>
    </div>
  `;
  
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
};

// Close modal
window.closeCashModal = function() {
  const modal = document.getElementById("cashDetailModal");
  if (modal) {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }
  currentDetailEntry = null;
  window.editingDate = null;
};

// Open new entry modal
window.openCashEntryModal = async function(dateToEdit = null) {
  const modal = document.getElementById("cashDetailModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalSubtitle = document.getElementById("modalSubtitle");
  const modalContent = document.getElementById("modalContent");
  
  if (!modal) return;
  
  const isEditing = !!dateToEdit;
  const targetDate = dateToEdit || getISTDateString();
  window.editingDate = isEditing ? dateToEdit : null;
  
  // Get existing data if editing
  let existingData = null;
  if (dateToEdit) {
    const entry = cashData.find(e => e.date === dateToEdit);
    existingData = entry || null;
  }
  
  // Check for today's entry
  if (!isEditing) {
    const todayEntry = cashData.find(e => e.date === getISTDateString());
    if (todayEntry) {
      existingData = todayEntry;
      window.editingDate = todayEntry.date;
    }
  }
  
  const dateObj = new Date(targetDate);
  modalTitle.innerHTML = isEditing || existingData 
    ? `✏️ Edit Entry - ${dateObj.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
    : `💰 New Cash Entry`;
  modalSubtitle.textContent = isEditing || existingData ? "Update the entry details below" : "Enter today's cash register data";
  
  // Auto-fetch opening balance
  let openingBalance = existingData?.opening || 0;
  let openingLocked = false;
  let openingHint = "Enter manually";
  
  if (!existingData) {
    // Try to get from previous day
    const prevEntry = cashData.find(e => e.date < targetDate);
    if (prevEntry?.actualClosing) {
      openingBalance = prevEntry.actualClosing;
      openingLocked = true;
      openingHint = `From ${formatDateShort(prevEntry.date)}'s closing`;
    }
  } else {
    openingLocked = true;
    openingHint = "From saved entry";
  }
  
  // Auto-fetch sale for the target date (not just today)
  let todaySale = existingData?.sale || 0;
  if (!existingData) {
    todaySale = await calculateSaleFromRecharges(targetDate);
  }
  
  modalContent.innerHTML = `
    <form id="cashEntryForm" class="space-y-6">
      <!-- Basic Info -->
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
            Opening Balance ${openingLocked ? '<span class="text-green-400">🔒</span>' : ''}
          </label>
          <input type="number" id="modalOpeningBalance" value="${openingBalance}" 
            ${openingLocked ? 'readonly' : ''}
            class="neon-input w-full px-4 py-3 rounded-lg text-white text-lg font-orbitron" 
            style="border-color: rgba(0,255,136,0.3); ${openingLocked ? 'opacity: 0.8; cursor: not-allowed;' : ''}"
            oninput="calculateModalTotals()"/>
          <p class="text-xs text-gray-600 mt-1">${openingHint}</p>
        </div>
        <div>
          <label class="text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
            Today's Sale (Cash) <span class="text-cyan-400">🔒</span>
            <button type="button" onclick="refreshModalSale()" class="text-cyan-400 hover:text-cyan-300 text-xs">↻</button>
          </label>
          <div class="px-4 py-3 rounded-lg font-orbitron text-lg font-bold"
            style="background: rgba(0,240,255,0.1); border: 1px solid rgba(0,240,255,0.3); color: #00f0ff;">
            ₹<span id="modalSaleDisplay">${todaySale.toLocaleString("en-IN")}</span>
          </div>
          <input type="hidden" id="modalTodaySale" value="${todaySale}"/>
          <p class="text-xs text-gray-600 mt-1">From recharges (cash only)</p>
        </div>
      </div>
      
      <!-- Withdrawals & Expenses -->
      <div class="grid md:grid-cols-3 gap-4">
        <div>
          <label class="text-xs text-gray-400 uppercase tracking-wider mb-2 block">💵 Cash Withdrawal</label>
          <input type="number" id="modalWithdrawalCash" value="${existingData?.withdrawalCash || existingData?.withdrawal || ''}" 
            placeholder="₹0"
            class="neon-input w-full px-4 py-3 rounded-lg text-white font-orbitron" 
            style="border-color: rgba(255,107,0,0.3);"
            oninput="calculateModalTotals()"/>
        </div>
        <div>
          <label class="text-xs text-gray-400 uppercase tracking-wider mb-2 block">🪙 Coins Withdrawal</label>
          <input type="number" id="modalWithdrawalCoins" value="${existingData?.withdrawalCoins || ''}" 
            placeholder="₹0"
            class="neon-input w-full px-4 py-3 rounded-lg text-white font-orbitron" 
            style="border-color: rgba(255,200,0,0.3);"
            oninput="calculateModalTotals()"/>
        </div>
        <div>
          <label class="text-xs text-gray-400 uppercase tracking-wider mb-2 block">📤 Expenses</label>
          <input type="number" id="modalExpenses" value="${existingData?.expenses || ''}" 
            placeholder="₹0"
            class="neon-input w-full px-4 py-3 rounded-lg text-white font-orbitron" 
            style="border-color: rgba(255,0,68,0.3);"
            oninput="calculateModalTotals()"/>
        </div>
      </div>
      
      <!-- Denomination Breakdown -->
      <div class="p-4 rounded-xl" style="background: rgba(0,0,0,0.3); border: 1px dashed rgba(255,255,255,0.1);">
        <div class="flex items-center justify-between mb-4">
          <span class="text-xs text-gray-400 uppercase tracking-wider">💵 Cash Denomination Count</span>
          <span id="modalDenomTotal" class="font-orbitron text-sm" style="color: #00f0ff;">Total: ₹0</span>
        </div>
        <div class="grid grid-cols-4 md:grid-cols-7 gap-3">
          ${DENOMINATIONS.map(d => {
            const key = d.isCoins ? "coins" : `d${d.value}`;
            const val = existingData?.denominations?.[key] || "";
            return `
              <div class="text-center">
                <label class="text-xs mb-1 block font-orbitron" style="color: ${d.color};">${d.label}</label>
                <input type="number" id="modalDenom${d.value}" data-value="${d.value}" value="${val}"
                  placeholder="${d.isCoins ? '₹' : '0'}" 
                  class="neon-input w-full px-2 py-2 rounded-lg text-white text-center text-sm" 
                  oninput="calculateModalDenominations()"
                  title="${d.isCoins ? 'Enter total coin amount in ₹' : `Number of ₹${d.value} notes`}"/>
              </div>
            `;
          }).join("")}
        </div>
        <p class="text-xs text-gray-600 mt-2">💡 Enter note counts. For Coins, enter total amount.</p>
      </div>
      
      <!-- Calculated Totals -->
      <div class="grid md:grid-cols-3 gap-4">
        <div class="p-3 rounded-lg text-center" style="background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.2);">
          <div class="text-[10px] text-gray-500 uppercase">Expected Closing</div>
          <div id="modalExpectedClosing" class="text-xl font-orbitron font-bold" style="color: #00ff88;">₹0</div>
        </div>
        <div class="p-3 rounded-lg text-center" style="background: rgba(184,41,255,0.1); border: 1px solid rgba(184,41,255,0.2);">
          <div class="text-[10px] text-gray-500 uppercase">Actual Cash Count</div>
          <div id="modalActualClosing" class="text-xl font-orbitron font-bold" style="color: #b829ff;">₹0</div>
        </div>
        <div id="modalDiffContainer" class="p-3 rounded-lg text-center" style="background: rgba(100,100,100,0.1); border: 1px solid rgba(100,100,100,0.2);">
          <div class="text-[10px] text-gray-500 uppercase">Difference</div>
          <div id="modalDifference" class="text-xl font-orbitron font-bold" style="color: #888;">₹0</div>
        </div>
      </div>
      
      <!-- Comments -->
      <div>
        <label class="text-xs text-gray-400 uppercase tracking-wider mb-2 block">📝 Comments</label>
        <input type="text" id="modalComments" value="${existingData?.comments || ''}" 
          placeholder="Any notes for today..."
          class="neon-input w-full px-4 py-3 rounded-lg text-white"/>
      </div>
      
      <!-- Action Buttons -->
      <div class="flex items-center justify-end gap-3 pt-4 border-t border-gray-800">
        <button type="button" onclick="closeCashModal()" class="px-6 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
          style="background: rgba(100,100,100,0.2);">
          Cancel
        </button>
        <button type="submit" class="px-8 py-3 rounded-lg text-sm font-orbitron font-bold"
          style="background: linear-gradient(135deg, #00ff88, #00cc66); color: #000;">
          💾 ${isEditing || existingData ? 'UPDATE' : 'SAVE'} ENTRY
        </button>
      </div>
    </form>
  `;
  
  // Setup form submission
  document.getElementById("cashEntryForm").onsubmit = (e) => {
    e.preventDefault();
    saveModalEntry();
  };
  
  // Calculate initial totals
  calculateModalDenominations();
  
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
};

// Edit from detail view
window.editCashEntryInModal = function(date) {
  openCashEntryModal(date);
};

// Legacy edit function (redirects to modal)
window.editCashEntry = function(date) {
  openCashEntryModal(date);
};

// Calculate denominations in modal
window.calculateModalDenominations = function() {
  let total = 0;
        DENOMINATIONS.forEach(d => {
    const input = document.getElementById(`modalDenom${d.value}`);
    const count = Number(input?.value) || 0;
    
    if (d.isCoins) {
      total += count;
    } else {
      total += count * d.value;
    }
  });
  
  const totalEl = document.getElementById("modalDenomTotal");
  if (totalEl) totalEl.textContent = `Total: ₹${total.toLocaleString("en-IN")}`;
  
  const actualEl = document.getElementById("modalActualClosing");
  if (actualEl) actualEl.textContent = `₹${total.toLocaleString("en-IN")}`;
  
  window.modalActualCash = total;
  calculateModalTotals();
};

// Calculate totals in modal
window.calculateModalTotals = function() {
  const opening = Number(document.getElementById("modalOpeningBalance")?.value) || 0;
  const sale = Number(document.getElementById("modalTodaySale")?.value) || 0;
  const withdrawalCash = Number(document.getElementById("modalWithdrawalCash")?.value) || 0;
  const withdrawalCoins = Number(document.getElementById("modalWithdrawalCoins")?.value) || 0;
  const withdrawal = withdrawalCash + withdrawalCoins;
  const expenses = Number(document.getElementById("modalExpenses")?.value) || 0;
  const actual = window.modalActualCash || 0;
  
  const expected = opening + sale - withdrawal - expenses;
  const diff = actual - expected;
  
  const expectedEl = document.getElementById("modalExpectedClosing");
  if (expectedEl) expectedEl.textContent = `₹${expected.toLocaleString("en-IN")}`;
  
  const diffEl = document.getElementById("modalDifference");
  const diffContainer = document.getElementById("modalDiffContainer");
  
  if (diffEl && diffContainer && actual > 0) {
    diffEl.textContent = `${diff >= 0 ? '+' : ''}₹${Math.abs(diff).toLocaleString("en-IN")}`;
    
    if (diff === 0) {
      diffEl.style.color = "#00ff88";
      diffContainer.style.background = "rgba(0,255,136,0.1)";
      diffContainer.style.borderColor = "rgba(0,255,136,0.2)";
    } else if (diff > 0) {
      diffEl.style.color = "#ffff00";
      diffContainer.style.background = "rgba(255,255,0,0.1)";
      diffContainer.style.borderColor = "rgba(255,255,0,0.2)";
    } else {
      diffEl.style.color = "#ff0044";
      diffContainer.style.background = "rgba(255,0,68,0.1)";
      diffContainer.style.borderColor = "rgba(255,0,68,0.2)";
    }
  }
};

// Helper: Calculate sale from recharges for a specific date
async function calculateSaleFromRecharges(targetDate) {
  const dateStr = targetDate || getISTDateString();
  try {
    const allRecharges = await SharedCache.getRecharges(db, FB_PATHS.RECHARGES);
    
    let totalCash = 0;
    let creditCash = 0;
    
    // Direct recharges for the target date
    const dateRecharges = allRecharges[dateStr] || {};
    Object.values(dateRecharges).forEach(r => {
      if (r.total !== undefined) {
        totalCash += r.cash || 0;
      } else if (r.amount !== undefined && r.mode === "cash") {
        totalCash += r.amount;
      }
    });
    
    // Credit collections that happened on the target date
    Object.entries(allRecharges).forEach(([date, dayData]) => {
      Object.values(dayData).forEach(r => {
        if (r.lastPaidAt?.split("T")[0] === dateStr) {
            creditCash += r.lastPaidCash || 0;
        }
        if (r.paidAt?.split("T")[0] === dateStr && r.mode === "credit" && r.paid && r.paidVia === "cash") {
          creditCash += r.amount;
        }
      });
    });
    
    return totalCash + creditCash;
  } catch (error) {
    console.error("Error calculating sale:", error);
    return 0;
  }
}

// Legacy alias for backwards compatibility
async function calculateTodaySaleFromRecharges() {
  return calculateSaleFromRecharges(getISTDateString());
}

// Refresh sale in modal - uses the editing date or today
window.refreshModalSale = async function() {
  const targetDate = window.editingDate || getISTDateString();
  const sale = await calculateSaleFromRecharges(targetDate);
  document.getElementById("modalTodaySale").value = sale;
  document.getElementById("modalSaleDisplay").textContent = sale.toLocaleString("en-IN");
  calculateModalTotals();
  
  const isToday = targetDate === getISTDateString();
  notifySuccess(isToday ? "Sale updated from today's recharges!" : `Sale updated for ${formatDateShort(targetDate)}!`);
};

// Save modal entry
async function saveModalEntry() {
  if (!canEditData()) {
    notifyWarning("You have view-only access. Saving is not allowed.");
      return;
    }
    
  const dateToSave = window.editingDate || getISTDateString();
  
  let actualClosing = 0;
  DENOMINATIONS.forEach(d => {
    const count = Number(document.getElementById(`modalDenom${d.value}`)?.value) || 0;
    if (d.isCoins) {
      actualClosing += count;
    } else {
      actualClosing += count * d.value;
    }
  });
  
  const entry = {
    date: dateToSave,
    opening: Number(document.getElementById("modalOpeningBalance")?.value) || 0,
    sale: Number(document.getElementById("modalTodaySale")?.value) || 0,
    withdrawalCash: Number(document.getElementById("modalWithdrawalCash")?.value) || 0,
    withdrawalCoins: Number(document.getElementById("modalWithdrawalCoins")?.value) || 0,
    withdrawal: (Number(document.getElementById("modalWithdrawalCash")?.value) || 0) + 
                (Number(document.getElementById("modalWithdrawalCoins")?.value) || 0),
    expenses: Number(document.getElementById("modalExpenses")?.value) || 0,
    actualClosing: actualClosing,
    comments: document.getElementById("modalComments")?.value || "",
    denominations: {},
    admin: getAdminName(),
    updatedAt: new Date().toISOString()
  };
  
  // Collect denominations
      DENOMINATIONS.forEach(d => {
        const key = d.isCoins ? "coins" : `d${d.value}`;
    entry.denominations[key] = Number(document.getElementById(`modalDenom${d.value}`)?.value) || 0;
  });
  
  entry.closing = entry.opening + entry.sale - entry.withdrawal - entry.expenses;
  entry.difference = entry.actualClosing - entry.closing;
  
  try {
    await db.ref(`cash_register/${dateToSave}`).set(entry);
    
    notifySuccess(window.editingDate ? "Entry updated!" : "Entry saved!");
    closeCashModal();
    loadCashHistory();
  } catch (error) {
    console.error("Error saving:", error);
    notifyError("Failed to save: " + error.message);
  }
}

// ==================== EXPORT ====================

window.exportCashPDF = function() {
  if (cashData.length === 0) {
    notifyWarning("No data to export");
    return;
  }
  
  // Calculate totals
  let totalSale = 0, totalWithdrawal = 0, totalExpenses = 0;
  cashData.forEach(e => {
    totalSale += e.sale || 0;
    totalWithdrawal += e.withdrawal || 0;
    totalExpenses += e.expenses || 0;
  });
  
  // Get month name
  const monthName = new Date(selectedMonth + "-01").toLocaleString('en-IN', { 
    month: 'long', 
    year: 'numeric' 
  });
  
  // Prepare rows for main table
  const rows = cashData.map(e => {
    const diff = e.difference || 0;
    const diffStr = diff >= 0 ? `+Rs.${diff}` : `-Rs.${Math.abs(diff)}`;
    return [
      e.date,
      `Rs.${e.opening || 0}`,
      `Rs.${e.actualClosing || e.closing || 0}`,
      `Rs.${e.sale || 0}`,
      `Rs.${e.withdrawal || 0}`,
      `Rs.${e.expenses || 0}`,
      diffStr
    ];
  });
  
  // Create PDF
  const doc = PDFExport.createStyledPDF({ orientation: 'landscape' });
  let y = PDFExport.addPDFHeader(doc, 'Cash Register Report', monthName);
  
  // Summary stats
  y = PDFExport.addPDFSummary(doc, [
    { label: 'Days Recorded', value: String(cashData.length), color: 'neonCyan' },
    { label: 'Total Sale', value: `Rs.${totalSale}`, color: 'neonGreen' },
    { label: 'Withdrawals', value: `Rs.${totalWithdrawal}`, color: 'neonOrange' },
    { label: 'Expenses', value: `Rs.${totalExpenses}`, color: 'neonRed' },
  ], y);
  
  // Main table
  y = PDFExport.addPDFTable(doc, 
    ['Date', 'Opening', 'Closing', 'Sale', 'Withdrawal', 'Expenses', 'Diff'],
    rows,
    y,
    { 
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' }
      }
    }
  );
  
  // Add denomination breakdown on new page if there's data
  const denomData = cashData.filter(e => e.denominations);
  if (denomData.length > 0) {
    y = PDFExport.addPageBreak(doc);
    
    // Denomination section header
    const { jsPDF } = window.jspdf;
    doc.setTextColor(0, 240, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('DENOMINATION BREAKDOWN', 15, y);
    y += 10;
    
    const denomRows = denomData.map(e => [
      e.date,
      e.denominations?.d500 || 0,
      e.denominations?.d200 || 0,
      e.denominations?.d100 || 0,
      e.denominations?.d50 || 0,
      e.denominations?.d20 || 0,
      e.denominations?.d10 || 0,
      `Rs.${e.denominations?.coins || 0}`,
      e.comments || "-"
    ]);
    
    PDFExport.addPDFTable(doc, 
      ['Date', 'Rs.500', 'Rs.200', 'Rs.100', 'Rs.50', 'Rs.20', 'Rs.10', 'Coins', 'Comments'],
      denomRows,
      y
    );
  }
  
  PDFExport.savePDF(doc, `cash_register_${selectedMonth}`);
  notifySuccess("Cash register report exported as PDF");
};

// Backward compatibility
window.exportCashCSV = window.exportCashPDF;

