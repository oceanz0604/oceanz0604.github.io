/**
 * OceanZ Gaming Cafe - Cash Register Management
 * Daily cash tracking with denomination breakdown
 */

import { 
  BOOKING_DB_CONFIG, 
  BOOKING_APP_NAME,
  TIMEZONE,
  getISTDate,
  formatToIST
} from "../../shared/config.js";
import { getStaffSession } from "./permissions.js";

// ==================== FIREBASE INIT ====================

let bookingApp = firebase.apps.find(a => a.name === BOOKING_APP_NAME);
if (!bookingApp) bookingApp = firebase.initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);

const db = bookingApp.database();

// ==================== STATE ====================

let cashData = [];
let selectedMonth = getISTDateString().slice(0, 7); // YYYY-MM format

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
      
      <!-- Today's Quick Entry -->
      <div class="neon-card rounded-xl p-6 relative" style="border-color: rgba(0,255,136,0.3);">
        <div class="absolute top-0 left-0 right-0 h-1 rounded-t-xl" style="background: linear-gradient(90deg, #00ff88, #00f0ff);"></div>
        
        <div class="flex items-center justify-between mb-6">
          <h3 class="font-orbitron text-lg font-bold flex items-center gap-2" style="color: #00ff88;">
            💰 TODAY'S CASH ENTRY
          </h3>
          <span id="todayDate" class="text-sm px-3 py-1 rounded-full font-orbitron" 
            style="background: rgba(0,255,136,0.2); color: #00ff88;"></span>
        </div>

        <!-- Opening & Closing Balance -->
        <div class="grid md:grid-cols-4 gap-4 mb-6">
          <div>
            <label class="text-xs text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              Opening Balance
              <span id="openingBalanceIcon" class="text-green-400 hidden" title="Auto-fetched from previous day">🔒</span>
            </label>
            <input type="number" id="openingBalance" placeholder="₹0" 
              class="neon-input w-full px-4 py-3 rounded-lg text-white text-lg font-orbitron" 
              style="border-color: rgba(0,255,136,0.3);" oninput="calculateCashTotals()" onfocus="this.select()"/>
            <p id="openingBalanceHint" class="text-xs text-gray-600 mt-1">Enter manually (no previous record)</p>
          </div>
          <div>
            <label class="text-xs text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-2">
              Today's Sale (Cash Only)
              <span class="text-cyan-400" title="Auto-fetched from recharges">🔒</span>
              <button onclick="refreshSaleFromRecharges()" class="text-cyan-400 hover:text-cyan-300 text-xs" title="Refresh from recharges">↻</button>
            </label>
            <div id="todaySaleDisplay" class="px-4 py-3 rounded-lg font-orbitron text-lg font-bold"
              style="background: rgba(0,240,255,0.1); border: 1px solid rgba(0,240,255,0.3); color: #00f0ff;">
              ₹0
            </div>
            <input type="hidden" id="todaySale" value="0"/>
            <p class="text-xs text-gray-600 mt-1">From recharges (cash only)</p>
          </div>
          <div>
            <label class="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Withdrawal</label>
            <input type="number" id="withdrawal" placeholder="₹0" 
              class="neon-input w-full px-4 py-3 rounded-lg text-white text-lg font-orbitron" 
              style="border-color: rgba(255,107,0,0.3);" oninput="calculateCashTotals()" onfocus="this.select()"/>
            <p class="text-xs text-gray-600 mt-1">Cash taken out</p>
          </div>
          <div>
            <label class="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Expenses</label>
            <input type="number" id="expenses" placeholder="₹0" 
              class="neon-input w-full px-4 py-3 rounded-lg text-white text-lg font-orbitron" 
              style="border-color: rgba(255,0,68,0.3);" oninput="calculateCashTotals()" onfocus="this.select()"/>
            <p class="text-xs text-gray-600 mt-1">Daily expenses</p>
          </div>
        </div>

        <!-- Denomination Breakdown -->
        <div class="p-4 rounded-lg mb-6" style="background: rgba(0,0,0,0.3); border: 1px dashed rgba(255,255,255,0.1);">
          <div class="flex items-center justify-between mb-4">
            <span class="text-xs text-gray-400 uppercase tracking-wider">Cash Denomination Count (Notes × Count)</span>
            <span id="denominationTotal" class="font-orbitron text-sm" style="color: #00f0ff;">Total: ₹0</span>
          </div>
          <div class="grid grid-cols-4 md:grid-cols-7 gap-3">
            ${DENOMINATIONS.map(d => `
              <div class="text-center">
                <label class="text-xs mb-1 block font-orbitron" style="color: ${d.color};">${d.label}</label>
                <input type="number" id="denom${d.value}" data-value="${d.value}" placeholder="${d.isCoins ? '₹' : '0'}" 
                  class="neon-input w-full px-2 py-2 rounded-lg text-white text-center text-sm" 
                  oninput="calculateDenominations()" onfocus="this.select()"
                  title="${d.isCoins ? 'Enter total coin amount in ₹' : `Number of ₹${d.value} notes`}"/>
              </div>
            `).join("")}
          </div>
          <p class="text-xs text-gray-600 mt-2">💡 Enter note counts (e.g., 5 for five ₹500 notes). For Coins, enter total amount.</p>
        </div>

        <!-- Calculated Balances -->
        <div class="grid md:grid-cols-3 gap-4 mb-6">
          <div>
            <label class="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Expected Closing</label>
            <div id="closingBalance" class="px-4 py-3 rounded-lg font-orbitron text-xl font-bold"
              style="background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.3); color: #00ff88;">
              ₹0
            </div>
            <p class="text-xs text-gray-600 mt-1">Open + Sale - W/D - Exp</p>
          </div>
          <div>
            <label class="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Actual Cash Count</label>
            <div id="actualClosing" class="px-4 py-3 rounded-lg font-orbitron text-xl font-bold"
              style="background: rgba(184,41,255,0.1); border: 1px solid rgba(184,41,255,0.3); color: #b829ff;">
              ₹0
            </div>
            <p class="text-xs text-gray-600 mt-1">Sum of all denominations</p>
          </div>
          <div>
            <label class="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Difference</label>
            <div id="differenceDisplay" class="px-4 py-3 rounded-lg font-orbitron text-xl font-bold"
              style="background: rgba(100,100,100,0.1); border: 1px solid rgba(100,100,100,0.3); color: #888;">
              ₹0
            </div>
            <p id="differenceLabel" class="text-xs text-gray-600 mt-1">Actual - Expected</p>
          </div>
        </div>

        <!-- Difference Alert -->
        <div id="differenceAlert" class="hidden p-3 rounded-lg mb-6" style="background: rgba(255,255,0,0.1); border: 1px solid rgba(255,255,0,0.3);">
          <div class="flex items-center gap-2">
            <span>⚠️</span>
            <span id="differenceText" class="text-sm font-orbitron" style="color: #ffff00;"></span>
          </div>
        </div>

        <!-- Comments -->
        <div class="mb-6">
          <label class="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Comments</label>
          <input type="text" id="cashComments" placeholder="Any notes for today..." 
            class="neon-input w-full px-4 py-3 rounded-lg text-white"/>
        </div>

        <!-- Save Button -->
        <button onclick="saveCashEntry()" class="w-full py-4 rounded-lg font-orbitron font-bold text-sm transition-all"
          style="background: linear-gradient(135deg, #00ff88, #00cc66); color: #000;">
          💾 SAVE TODAY'S ENTRY
        </button>
      </div>

      <!-- Monthly Summary -->
      <div class="neon-card rounded-xl p-6 relative">
        <div class="flex items-center justify-between mb-6 flex-wrap gap-4">
          <h3 class="font-orbitron text-lg font-bold flex items-center gap-2" style="color: #00f0ff;">
            📊 MONTHLY SUMMARY
          </h3>
          <div class="flex items-center gap-3">
            <input type="month" id="monthPicker" class="neon-input px-3 py-2 rounded-lg text-white"/>
            <button onclick="exportCashPDF()" class="neon-btn neon-btn-cyan px-4 py-2 rounded-lg text-sm">
              📄 Export PDF
            </button>
          </div>
        </div>

        <!-- Stats Grid -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div class="stat-card p-4 rounded-xl text-center">
            <div class="text-gray-500 text-xs uppercase tracking-wider">Total Sales</div>
            <div id="monthSales" class="text-2xl font-bold font-orbitron mt-1" style="color: #00ff88;">₹0</div>
          </div>
          <div class="stat-card p-4 rounded-xl text-center">
            <div class="text-gray-500 text-xs uppercase tracking-wider">Withdrawals</div>
            <div id="monthWithdrawals" class="text-2xl font-bold font-orbitron mt-1" style="color: #ff6b00;">₹0</div>
          </div>
          <div class="stat-card p-4 rounded-xl text-center">
            <div class="text-gray-500 text-xs uppercase tracking-wider">Expenses</div>
            <div id="monthExpenses" class="text-2xl font-bold font-orbitron mt-1" style="color: #ff0044;">₹0</div>
          </div>
          <div class="stat-card p-4 rounded-xl text-center">
            <div class="text-gray-500 text-xs uppercase tracking-wider">Net Cash</div>
            <div id="monthNet" class="text-2xl font-bold font-orbitron mt-1" style="color: #00f0ff;">₹0</div>
          </div>
          <div class="stat-card p-4 rounded-xl text-center">
            <div class="text-gray-500 text-xs uppercase tracking-wider">Avg Daily Sale</div>
            <div id="avgDailySale" class="text-2xl font-bold font-orbitron mt-1" style="color: #b829ff;">₹0</div>
          </div>
        </div>

        <!-- History Table -->
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left" style="border-bottom: 1px solid rgba(0,240,255,0.2);">
                <th class="py-3 px-2 font-orbitron text-xs" style="color: #00f0ff;">Date</th>
                <th class="py-3 px-2 font-orbitron text-xs text-right" style="color: #00ff88;">Open</th>
                <th class="py-3 px-2 font-orbitron text-xs text-right" style="color: #00ff88;">Close</th>
                <th class="py-3 px-2 font-orbitron text-xs text-right" style="color: #b829ff;">Sale</th>
                <th class="py-3 px-2 font-orbitron text-xs text-right" style="color: #ff6b00;">W/D</th>
                <th class="py-3 px-2 font-orbitron text-xs text-right" style="color: #ff0044;">Exp</th>
                <th class="py-3 px-2 font-orbitron text-xs" style="color: #666;">Denom</th>
                <th class="py-3 px-2 font-orbitron text-xs" style="color: #666;">Note</th>
                <th class="py-3 px-2"></th>
              </tr>
            </thead>
            <tbody id="cashHistoryTable"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Set today's date
  document.getElementById("todayDate").textContent = getISTDate().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short"
  });

  // Set month picker
  const monthPicker = document.getElementById("monthPicker");
  monthPicker.value = selectedMonth;
  monthPicker.onchange = (e) => {
    selectedMonth = e.target.value;
    loadCashHistory();
  };

  // Load existing data
  loadTodayEntry();
  loadCashHistory();
};

// ==================== CALCULATIONS ====================

window.calculateDenominations = function() {
  let total = 0;
  DENOMINATIONS.forEach(d => {
    const input = document.getElementById(`denom${d.value}`);
    const count = Number(input?.value) || 0;
    
    if (d.isCoins) {
      // Coins - direct amount
      total += count;
    } else {
      // Notes - multiply by value
      total += count * d.value;
    }
  });
  
  const totalEl = document.getElementById("denominationTotal");
  if (totalEl) totalEl.textContent = `Total: ₹${total.toLocaleString("en-IN")}`;
  
  // Auto-update actual closing display
  const actualEl = document.getElementById("actualClosing");
  if (actualEl) actualEl.textContent = `₹${total.toLocaleString("en-IN")}`;
  
  // Store for calculations
  window.currentActualCash = total;
  
  calculateCashTotals();
};

window.calculateCashTotals = function() {
  const opening = Number(document.getElementById("openingBalance")?.value) || 0;
  const sale = Number(document.getElementById("todaySale")?.value) || 0;
  const withdrawal = Number(document.getElementById("withdrawal")?.value) || 0;
  const expenses = Number(document.getElementById("expenses")?.value) || 0;
  const actual = window.currentActualCash || 0;
  
  // Calculate expected closing
  const expectedClosing = opening + sale - withdrawal - expenses;
  
  // Update displays
  const closingEl = document.getElementById("closingBalance");
  if (closingEl) closingEl.textContent = `₹${expectedClosing.toLocaleString("en-IN")}`;
  
  // Calculate and display difference
  const diff = actual - expectedClosing;
  const diffDisplayEl = document.getElementById("differenceDisplay");
  const diffLabelEl = document.getElementById("differenceLabel");
  const diffAlertEl = document.getElementById("differenceAlert");
  const diffTextEl = document.getElementById("differenceText");
  
  if (diffDisplayEl) {
    diffDisplayEl.textContent = `₹${Math.abs(diff).toLocaleString("en-IN")}`;
    
    if (actual > 0) {
      if (diff > 0) {
        diffDisplayEl.style.color = "#00ff88";
        diffDisplayEl.style.borderColor = "rgba(0,255,136,0.3)";
        diffDisplayEl.style.background = "rgba(0,255,136,0.1)";
        if (diffLabelEl) diffLabelEl.textContent = "Excess (+)";
      } else if (diff < 0) {
        diffDisplayEl.style.color = "#ff0044";
        diffDisplayEl.style.borderColor = "rgba(255,0,68,0.3)";
        diffDisplayEl.style.background = "rgba(255,0,68,0.1)";
        if (diffLabelEl) diffLabelEl.textContent = "Shortage (-)";
      } else {
        diffDisplayEl.style.color = "#00ff88";
        diffDisplayEl.style.borderColor = "rgba(0,255,136,0.3)";
        diffDisplayEl.style.background = "rgba(0,255,136,0.1)";
        if (diffLabelEl) diffLabelEl.textContent = "✓ Balanced";
      }
    }
  }
  
  // Show alert for significant differences
  if (actual > 0 && diff !== 0) {
    diffAlertEl?.classList.remove("hidden");
    
    if (diff > 0) {
      diffTextEl.textContent = `Excess: ₹${diff.toLocaleString("en-IN")} in drawer (more than expected)`;
      diffAlertEl.style.background = "rgba(0,255,136,0.1)";
      diffAlertEl.style.borderColor = "rgba(0,255,136,0.3)";
      diffTextEl.style.color = "#00ff88";
    } else {
      diffTextEl.textContent = `Shortage: ₹${Math.abs(diff).toLocaleString("en-IN")} from drawer (less than expected)`;
      diffAlertEl.style.background = "rgba(255,0,68,0.1)";
      diffAlertEl.style.borderColor = "rgba(255,0,68,0.3)";
      diffTextEl.style.color = "#ff0044";
    }
  } else {
    diffAlertEl?.classList.add("hidden");
  }
};

// ==================== SAVE ENTRY ====================

window.saveCashEntry = async function() {
  // Use editing date if present, otherwise today
  const dateToSave = window.editingDate || getISTDateString();
  
  // Calculate actual closing from denominations
  let actualClosing = 0;
  DENOMINATIONS.forEach(d => {
    const count = Number(document.getElementById(`denom${d.value}`)?.value) || 0;
    if (d.isCoins) {
      actualClosing += count;
    } else {
      actualClosing += count * d.value;
    }
  });
  
  const entry = {
    date: dateToSave,
    opening: Number(document.getElementById("openingBalance")?.value) || 0,
    sale: Number(document.getElementById("todaySale")?.value) || 0,
    withdrawal: Number(document.getElementById("withdrawal")?.value) || 0,
    expenses: Number(document.getElementById("expenses")?.value) || 0,
    actualClosing: actualClosing,
    comments: document.getElementById("cashComments")?.value || "",
    denominations: {},
    admin: getAdminName(),
    updatedAt: new Date().toISOString()
  };
  
  // Collect denominations (store count for notes, amount for coins)
  DENOMINATIONS.forEach(d => {
    const key = d.isCoins ? "coins" : `d${d.value}`;
    entry.denominations[key] = Number(document.getElementById(`denom${d.value}`)?.value) || 0;
  });
  
  // Calculate expected closing
  entry.closing = entry.opening + entry.sale - entry.withdrawal - entry.expenses;
  entry.difference = entry.actualClosing - entry.closing;
  
  try {
    await db.ref(`cash_register/${dateToSave}`).set(entry);
    
    const isEdit = !!window.editingDate;
    notifySuccess(isEdit ? "Entry updated successfully!" : "Cash entry saved successfully!");
    
    // Reset editing state
    window.editingDate = null;
    
    // Reset form to today
    resetFormToToday();
    
    loadCashHistory();
  } catch (error) {
    console.error("Error saving cash entry:", error);
    notifyError("Failed to save entry: " + error.message);
  }
};

// Reset form to today's entry
function resetFormToToday() {
  window.editingDate = null;
  
  // Reset date display
  document.getElementById("todayDate").textContent = getISTDate().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
  
  // Reset save button
  const saveBtn = document.querySelector("#cash-register-content button[onclick='saveCashEntry()']");
  if (saveBtn) {
    saveBtn.innerHTML = "💾 SAVE TODAY'S ENTRY";
    saveBtn.style.background = "linear-gradient(135deg, #00ff88, #00cc66)";
  }
  
  // Clear form fields
  document.getElementById("withdrawal").value = "";
  document.getElementById("expenses").value = "";
  document.getElementById("cashComments").value = "";
  DENOMINATIONS.forEach(d => {
    const el = document.getElementById(`denom${d.value}`);
    if (el) el.value = "";
  });
  
  // Reset opening balance field state (will be set properly by loadTodayEntry)
  const openingInput = document.getElementById("openingBalance");
  openingInput.value = "";
  openingInput.readOnly = false;
  openingInput.style.opacity = "1";
  openingInput.style.cursor = "text";
  
  // Reload today's entry
  loadTodayEntry();
}

// ==================== LOAD DATA ====================

async function loadTodayEntry() {
  const today = getISTDateString();
  
  try {
    // Check if today's entry already exists
    const snapshot = await db.ref(`cash_register/${today}`).once("value");
    const data = snapshot.val();
    
    if (data) {
      // Fill form with existing data
      const openingInput = document.getElementById("openingBalance");
      const openingIcon = document.getElementById("openingBalanceIcon");
      const openingHint = document.getElementById("openingBalanceHint");
      const saleDisplay = document.getElementById("todaySaleDisplay");
      
      openingInput.value = data.opening || "";
      // Lock opening balance for existing entries
      openingInput.readOnly = true;
      openingInput.style.opacity = "0.8";
      openingInput.style.cursor = "not-allowed";
      openingIcon?.classList.remove("hidden");
      if (openingHint) openingHint.textContent = "Saved entry";
      
      document.getElementById("todaySale").value = data.sale || "";
      if (saleDisplay) saleDisplay.textContent = `₹${(data.sale || 0).toLocaleString("en-IN")}`;
      
      document.getElementById("withdrawal").value = data.withdrawal || "";
      document.getElementById("expenses").value = data.expenses || "";
      document.getElementById("cashComments").value = data.comments || "";
      
      // Fill denominations
      if (data.denominations) {
        DENOMINATIONS.forEach(d => {
          const key = d.isCoins ? "coins" : `d${d.value}`;
          const el = document.getElementById(`denom${d.value}`);
          if (el) el.value = data.denominations[key] || "";
        });
      }
      
      calculateDenominations();
    } else {
      // New entry - auto-fetch opening balance and sale
      await autoFetchOpeningBalance();
      await autoFetchTodaySale();
    }
  } catch (error) {
    console.error("Error loading today's entry:", error);
  }
}

// Auto-fetch opening balance from previous day's closing
async function autoFetchOpeningBalance() {
  const openingInput = document.getElementById("openingBalance");
  const openingIcon = document.getElementById("openingBalanceIcon");
  const openingHint = document.getElementById("openingBalanceHint");
  
  try {
    // Find the most recent entry
    const snapshot = await db.ref("cash_register").orderByKey().limitToLast(5).once("value");
    const entries = snapshot.val();
    
    if (entries) {
      const today = getISTDateString();
      const sortedDates = Object.keys(entries).sort().reverse();
      
      // Find the most recent entry that's not today
      for (const date of sortedDates) {
        if (date < today && entries[date]?.actualClosing) {
          openingInput.value = entries[date].actualClosing;
          
          // Lock the field since we have previous data
          openingInput.readOnly = true;
          openingInput.style.opacity = "0.8";
          openingInput.style.cursor = "not-allowed";
          openingIcon?.classList.remove("hidden");
          if (openingHint) openingHint.textContent = `From ${formatDateShort(date)}'s closing`;
          
          console.log(`✅ Opening balance auto-fetched from ${date}: ₹${entries[date].actualClosing}`);
          return;
        }
      }
    }
    
    // No previous record found - keep field editable
    openingInput.readOnly = false;
    openingInput.style.opacity = "1";
    openingInput.style.cursor = "text";
    openingIcon?.classList.add("hidden");
    if (openingHint) openingHint.textContent = "Enter manually (no previous record)";
    
  } catch (error) {
    console.error("Error fetching opening balance:", error);
    // On error, keep field editable
    openingInput.readOnly = false;
  }
}

// Auto-fetch today's sale from recharges data
async function autoFetchTodaySale() {
  const today = getISTDateString();
  const saleInput = document.getElementById("todaySale");
  const saleDisplay = document.getElementById("todaySaleDisplay");
  
  try {
    // Get all recharges (to include credit collections from any date that were paid today)
    const allSnapshot = await db.ref("recharges").once("value");
    const allRecharges = allSnapshot.val() || {};
    
    let totalCash = 0;
    let totalUpi = 0;
    let creditCash = 0; // Credit collected via cash
    let creditUpi = 0;  // Credit collected via UPI
    
    // Process today's direct recharges
    const todayRecharges = allRecharges[today] || {};
    Object.values(todayRecharges).forEach(r => {
      // Handle both old format (mode-based) and new format (split payment)
      if (r.total !== undefined) {
        // New split format - direct payments
        totalCash += r.cash || 0;
        totalUpi += r.upi || 0;
      } else if (r.amount !== undefined) {
        // Old format
        if (r.mode === "cash") totalCash += r.amount;
        if (r.mode === "upi") totalUpi += r.amount;
      }
    });
    
    // Process credit collections that happened today (from any date's recharges)
    Object.entries(allRecharges).forEach(([date, dayData]) => {
      Object.values(dayData).forEach(r => {
        // Check if credit was paid today
        if (r.lastPaidAt) {
          const paidDate = r.lastPaidAt.split("T")[0];
          if (paidDate === today) {
            creditCash += r.lastPaidCash || 0;
            creditUpi += r.lastPaidUpi || 0;
          }
        }
        // Also check old format credit payments
        if (r.paidAt && r.mode === "credit" && r.paid) {
          const paidDate = r.paidAt.split("T")[0];
          if (paidDate === today) {
            if (r.paidVia === "cash") creditCash += r.amount;
            else if (r.paidVia === "upi") creditUpi += r.amount;
            else if (r.paidVia === "cash+upi") {
              // Split - assume half each if not specified
              creditCash += Math.floor(r.amount / 2);
              creditUpi += r.amount - Math.floor(r.amount / 2);
            }
          }
        }
      });
    });
    
    // Total cash in drawer = direct cash + credit collected via cash
    const totalCashInDrawer = totalCash + creditCash;
    const totalUpiCollected = totalUpi + creditUpi;
    
    // Update hidden input and display
    saleInput.value = totalCashInDrawer;
    if (saleDisplay) {
      let displayParts = [`₹${totalCashInDrawer.toLocaleString("en-IN")}`];
      let subParts = [];
      
      if (creditCash > 0) subParts.push(`+₹${creditCash} credit`);
      if (totalUpiCollected > 0) subParts.push(`₹${totalUpiCollected} UPI`);
      
      if (subParts.length > 0) {
        saleDisplay.innerHTML = `${displayParts[0]} <span class="text-xs text-gray-500">(${subParts.join(", ")})</span>`;
      } else {
        saleDisplay.textContent = displayParts[0];
      }
    }
    
    console.log(`✅ Today's sale: Cash ₹${totalCashInDrawer} (Direct: ₹${totalCash}, Credit: ₹${creditCash}) | UPI ₹${totalUpiCollected} (Direct: ₹${totalUpi}, Credit: ₹${creditUpi})`);
    
    // Show info about UPI if any
    if (totalUpiCollected > 0) {
      const commentsEl = document.getElementById("cashComments");
      if (commentsEl && !commentsEl.value) {
        commentsEl.placeholder = `UPI collected: ₹${totalUpiCollected} (not in drawer)`;
      }
    }
    
    calculateCashTotals();
  } catch (error) {
    console.error("Error fetching today's sale:", error);
  }
}

// Refresh sale from recharges (button handler)
window.refreshSaleFromRecharges = async function() {
  await autoFetchTodaySale();
  notifySuccess("Sale updated from today's recharges!");
};

async function loadCashHistory() {
  const tableBody = document.getElementById("cashHistoryTable");
  if (!tableBody) return;
  
  tableBody.innerHTML = `<tr><td colspan="9" class="py-4 text-center text-gray-500">Loading...</td></tr>`;
  
  try {
    const snapshot = await db.ref("cash_register").orderByKey().once("value");
    const allData = snapshot.val() || {};
    
    // Filter by selected month
    cashData = Object.entries(allData)
      .filter(([date]) => date.startsWith(selectedMonth))
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    if (cashData.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="9" class="py-4 text-center text-gray-500">No entries for this month</td></tr>`;
      updateMonthlyStats([]);
      return;
    }
    
    // Render table
    tableBody.innerHTML = cashData.map(entry => {
      // Build denomination string including coins
      let denomStr = "-";
      if (entry.denominations) {
        const parts = [];
        if (entry.denominations.d500) parts.push(`5H:${entry.denominations.d500}`);
        if (entry.denominations.d200) parts.push(`2H:${entry.denominations.d200}`);
        if (entry.denominations.d100) parts.push(`1H:${entry.denominations.d100}`);
        if (entry.denominations.d50) parts.push(`50:${entry.denominations.d50}`);
        if (entry.denominations.d20) parts.push(`20:${entry.denominations.d20}`);
        if (entry.denominations.d10) parts.push(`10:${entry.denominations.d10}`);
        if (entry.denominations.coins) parts.push(`C:₹${entry.denominations.coins}`);
        denomStr = parts.length > 0 ? parts.join(" ") : "-";
      }
      
      const diffColor = entry.difference > 0 ? "#00ff88" : entry.difference < 0 ? "#ff0044" : "#888";
      const diffText = entry.difference !== 0 ? `(${entry.difference > 0 ? '+' : ''}${entry.difference})` : "";
      
      return `
        <tr class="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
          <td class="py-3 px-2 font-orbitron text-xs">${formatDateShort(entry.date)}</td>
          <td class="py-3 px-2 text-right" style="color: #00ff88;">₹${(entry.opening || 0).toLocaleString("en-IN")}</td>
          <td class="py-3 px-2 text-right">
            <span style="color: #00ff88;">₹${(entry.actualClosing || entry.closing || 0).toLocaleString("en-IN")}</span>
            ${diffText ? `<span class="text-xs ml-1" style="color: ${diffColor};">${diffText}</span>` : ""}
          </td>
          <td class="py-3 px-2 text-right font-bold" style="color: #b829ff;">₹${(entry.sale || 0).toLocaleString("en-IN")}</td>
          <td class="py-3 px-2 text-right" style="color: #ff6b00;">${entry.withdrawal ? `₹${entry.withdrawal.toLocaleString("en-IN")}` : "-"}</td>
          <td class="py-3 px-2 text-right" style="color: #ff0044;">${entry.expenses ? `₹${entry.expenses.toLocaleString("en-IN")}` : "-"}</td>
          <td class="py-3 px-2 text-xs text-gray-500 max-w-[150px] truncate" title="${denomStr}">${denomStr}</td>
          <td class="py-3 px-2 text-xs text-gray-400 max-w-[100px] truncate">${entry.comments || "-"}</td>
          <td class="py-3 px-2">
            <button onclick="editCashEntry('${entry.date}')" class="text-cyan-400 hover:text-cyan-300 text-xs">✏️</button>
          </td>
        </tr>
      `;
    }).join("");
    
    updateMonthlyStats(cashData);
    
  } catch (error) {
    console.error("Error loading cash history:", error);
    tableBody.innerHTML = `<tr><td colspan="9" class="py-4 text-center text-red-400">Error loading data</td></tr>`;
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

// ==================== EDIT ENTRY ====================

window.editCashEntry = async function(date) {
  try {
    const snapshot = await db.ref(`cash_register/${date}`).once("value");
    const data = snapshot.val();
    
    if (!data) return;
    
    // Store the date being edited
    window.editingDate = date;
    
    const openingInput = document.getElementById("openingBalance");
    const openingIcon = document.getElementById("openingBalanceIcon");
    const openingHint = document.getElementById("openingBalanceHint");
    const saleDisplay = document.getElementById("todaySaleDisplay");
    
    // Fill form
    openingInput.value = data.opening || "";
    // Lock opening balance for editing
    openingInput.readOnly = true;
    openingInput.style.opacity = "0.8";
    openingInput.style.cursor = "not-allowed";
    openingIcon?.classList.remove("hidden");
    if (openingHint) openingHint.textContent = "From saved entry";
    
    document.getElementById("todaySale").value = data.sale || "";
    if (saleDisplay) saleDisplay.textContent = `₹${(data.sale || 0).toLocaleString("en-IN")}`;
    
    document.getElementById("withdrawal").value = data.withdrawal || "";
    document.getElementById("expenses").value = data.expenses || "";
    document.getElementById("cashComments").value = data.comments || "";
    
    // Fill denominations
    if (data.denominations) {
      DENOMINATIONS.forEach(d => {
        const key = d.isCoins ? "coins" : `d${d.value}`;
        const el = document.getElementById(`denom${d.value}`);
        if (el) el.value = data.denominations[key] || "";
      });
    }
    
    // Update date display
    document.getElementById("todayDate").textContent = new Date(date).toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short"
    }) + " (Editing)";
    
    // Change save button text
    const saveBtn = document.querySelector("#cash-register-content button[onclick='saveCashEntry()']");
    if (saveBtn) {
      saveBtn.innerHTML = "💾 UPDATE ENTRY";
      saveBtn.style.background = "linear-gradient(135deg, #00f0ff, #0088cc)";
    }
    
    calculateDenominations();
    
    // Scroll to form
    document.querySelector("#cash-register-content").scrollIntoView({ behavior: "smooth" });
    
  } catch (error) {
    console.error("Error loading entry for edit:", error);
  }
};

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

