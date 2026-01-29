/**
 * OceanZ Gaming Cafe - Finance Dashboard (Integrated)
 * Expense management, revenue tracking, and financial analysis
 */

import { 
  BOOKING_DB_CONFIG, 
  FDB_DATASET_CONFIG, 
  BOOKING_APP_NAME, 
  FDB_APP_NAME,
  FB_PATHS,
  getISTDate,
  SharedCache
} from "../../shared/config.js";
import { getStaffSession, hasPermission, canEditData } from "./permissions.js";

// ==================== CONSTANTS ====================

const EXPENSE_CATEGORIES = [
  { id: "rent", name: "Rent", icon: "🏠", color: "#ff6b6b" },
  { id: "electricity", name: "Electricity", icon: "⚡", color: "#ffd93d" },
  { id: "internet", name: "Internet", icon: "🌐", color: "#6bcb77" },
  { id: "salary", name: "Staff Salary", icon: "👥", color: "#4d96ff" },
  { id: "maintenance", name: "Maintenance", icon: "🔧", color: "#ff922b" },
  { id: "supplies", name: "Supplies", icon: "📦", color: "#845ef7" },
  { id: "equipment", name: "Equipment", icon: "🖥️", color: "#20c997" },
  { id: "other", name: "Other", icon: "📋", color: "#868e96" }
];

// ==================== STATE ====================

let financeState = {
  period: "month", // "month" or "year"
  selectedDate: new Date(),
  expenses: [],
  recharges: {},
  members: [],
  dailySummaries: {},
  currentFilter: "all",
  editingExpenseId: null,
  deleteExpenseData: null,
  revenueChart: null,
  expenseChart: null,
  initialized: false
};

// Firebase instances
let bookingDb = null;
let fdbDb = null;

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

async function initFinanceFirebase() {
  try {
    await waitForFirebase();
    
    let bookingApp = firebase.apps.find(a => a.name === BOOKING_APP_NAME);
    if (!bookingApp) {
      bookingApp = firebase.initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);
    }
    bookingDb = bookingApp.database();

    let fdbApp = firebase.apps.find(a => a.name === FDB_APP_NAME);
    if (!fdbApp) {
      fdbApp = firebase.initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);
    }
    fdbDb = fdbApp.database();

    console.log("✅ Finance: Firebase initialized");
    return true;
  } catch (error) {
    console.error("❌ Finance: Firebase init failed:", error);
    return false;
  }
}

// ==================== MAIN ENTRY POINT ====================

async function loadFinanceDashboard() {
  console.log("📊 Loading Finance Dashboard...");
  
  try {
    // Initialize Firebase if not done
    if (!bookingDb || !fdbDb) {
      await initFinanceFirebase();
    }

    // Set initial date
    financeState.selectedDate = getISTDate();
    
    // Check edit permissions
    if (!canEditData()) {
      const addBtn = document.getElementById("finAddExpenseBtn");
      if (addBtn) {
        addBtn.disabled = true;
        addBtn.title = "View-only access";
        addBtn.style.opacity = "0.5";
      }
    }

    // Update period display
    updatePeriodDisplay();
    
    // Set default date for expense form
    const dateInput = document.getElementById("finExpenseDate");
    if (dateInput) {
      dateInput.value = formatDateForInput(getISTDate());
    }

    // Load data
    await loadFinanceData();
    
    // Refresh icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
    
    financeState.initialized = true;
    console.log("✅ Finance Dashboard loaded");
    
  } catch (error) {
    console.error("❌ Finance Dashboard error:", error);
  }
}

// ==================== DATA LOADING ====================

async function loadFinanceData() {
  try {
    await Promise.all([
      loadExpenses(),
      loadRecharges(),
      loadMembers(),
      loadDailySummaries()
    ]);

    calculateSummary();
    renderExpenses();
    renderCharts();
    
  } catch (error) {
    console.error("Error loading finance data:", error);
  }
}

async function loadExpenses() {
  const { startDate, endDate } = getDateRange();
  
  try {
    const expensesRef = bookingDb.ref(FB_PATHS.EXPENSES);
    const snapshot = await expensesRef.once("value");
    const allExpenses = snapshot.val() || {};

    financeState.expenses = [];
    
    Object.entries(allExpenses).forEach(([date, dayExpenses]) => {
      if (date >= startDate && date <= endDate) {
        Object.entries(dayExpenses).forEach(([id, expense]) => {
          financeState.expenses.push({ id, date, ...expense });
        });
      }
    });

    financeState.expenses.sort((a, b) => new Date(b.date) - new Date(a.date));
    console.log(`✅ Loaded ${financeState.expenses.length} expenses`);
  } catch (error) {
    console.error("Error loading expenses:", error);
    financeState.expenses = [];
  }
}

async function loadRecharges() {
  try {
    financeState.recharges = await SharedCache.getRecharges(bookingDb, FB_PATHS.RECHARGES);
    console.log(`✅ Loaded recharges`);
  } catch (error) {
    console.error("Error loading recharges:", error);
    financeState.recharges = {};
  }
}

async function loadMembers() {
  try {
    financeState.members = await SharedCache.getMembers(fdbDb, FB_PATHS.MEMBERS);
    console.log(`✅ Loaded ${financeState.members.length} members`);
  } catch (error) {
    console.error("Error loading members:", error);
    financeState.members = [];
  }
}

async function loadDailySummaries() {
  const { startDate, endDate } = getDateRange();

  try {
    const summaryRef = fdbDb.ref(FB_PATHS.DAILY_SUMMARY);
    const snapshot = await summaryRef.once("value");
    const allSummaries = snapshot.val() || {};

    financeState.dailySummaries = {};
    Object.entries(allSummaries).forEach(([date, summary]) => {
      if (date >= startDate && date <= endDate) {
        financeState.dailySummaries[date] = summary;
      }
    });

    console.log(`✅ Loaded ${Object.keys(financeState.dailySummaries).length} daily summaries`);
  } catch (error) {
    console.error("Error loading daily summaries:", error);
    financeState.dailySummaries = {};
  }
}

// ==================== CALCULATIONS ====================

function calculateSummary() {
  const { startDate, endDate } = getDateRange();
  const { recharges, expenses, members, dailySummaries } = financeState;

  // Revenue from recharges (excluding offers/free)
  // Count: direct cash, direct UPI, and credit collections (cash/UPI from collected credits)
  let totalRevenue = 0, cashTotal = 0, upiTotal = 0;

  // First pass: count direct cash and UPI payments (not credit given, not free)
  Object.entries(recharges).forEach(([date, dayData]) => {
    if (date >= startDate && date <= endDate) {
      Object.values(dayData).forEach(r => {
        if (r.total !== undefined) {
          // New split payment format - count direct cash and UPI only
          cashTotal += r.cash || 0;
          upiTotal += r.upi || 0;
        } else if (r.amount !== undefined && r.mode !== "credit") {
          // Old single-mode format - count cash and UPI (not credit given)
          if (r.mode === "cash") cashTotal += r.amount || 0;
          else if (r.mode === "upi") upiTotal += r.amount || 0;
        }
      });
    }
  });

  // Second pass: count credit COLLECTIONS (cash/UPI received when credit is paid)
  // Scan ALL recharges to find credit payments that occurred within our date range
  Object.entries(recharges).forEach(([transactionDate, dayData]) => {
    Object.values(dayData).forEach(r => {
      // NEW FORMAT: creditPayments history with dates as keys
      if (r.creditPayments) {
        Object.entries(r.creditPayments).forEach(([paymentDate, payment]) => {
          // Only count if the payment was made within our period
          if (paymentDate >= startDate && paymentDate <= endDate) {
            cashTotal += payment.cash || 0;
            upiTotal += payment.upi || 0;
          }
        });
      }
      // OLDER FORMAT: lastPaidCash/lastPaidUpi with lastPaidAt timestamp
      else if (r.lastPaidAt && (r.lastPaidCash || r.lastPaidUpi)) {
        const paidDate = r.lastPaidAt.split("T")[0];
        if (paidDate >= startDate && paidDate <= endDate) {
          cashTotal += r.lastPaidCash || 0;
          upiTotal += r.lastPaidUpi || 0;
        }
      }
      // LEGACY FORMAT: paidAt with paidVia
      else if (r.paidAt && r.paidVia && r.mode === "credit") {
        const paidDate = r.paidAt.split("T")[0];
        if (paidDate >= startDate && paidDate <= endDate) {
          if (r.paidVia === "cash" || r.paidVia.includes("cash")) {
            cashTotal += r.amount || 0;
          } else if (r.paidVia === "upi") {
            upiTotal += r.amount || 0;
          }
        }
      }
    });
  });

  // Total revenue = all cash collected + all UPI collected
  totalRevenue = cashTotal + upiTotal;

  // Expenses - track by payment mode
  let totalExpenses = 0, expenseCash = 0, expenseOnline = 0;
  expenses.forEach(exp => {
    const amount = exp.amount || ((exp.cash || 0) + (exp.online || 0));
    totalExpenses += amount;
    
    // Track expenses by payment mode
    if (exp.cash !== undefined || exp.online !== undefined) {
      // New split format
      expenseCash += exp.cash || 0;
      expenseOnline += exp.online || 0;
    } else if (exp.paymentMode === "cash") {
      expenseCash += amount;
    } else if (exp.paymentMode === "online" || exp.paymentMode === "upi") {
      expenseOnline += amount;
    } else {
      // Default: assume cash for old entries without payment mode
      expenseCash += amount;
    }
  });

  const profit = totalRevenue - totalExpenses;
  const cashProfit = cashTotal - expenseCash;
  const onlineProfit = upiTotal - expenseOnline;

  // Usage stats from daily summaries
  let totalMinutes = 0, totalSessions = 0;
  Object.values(dailySummaries).forEach(summary => {
    if (summary.total_minutes) totalMinutes += summary.total_minutes;
    else if (summary.totals?.minutes) totalMinutes += summary.totals.minutes;
    else if (summary.by_member) {
      Object.values(summary.by_member).forEach(m => {
        totalMinutes += m.minutes || m.total_minutes || 0;
        totalSessions += m.sessions || m.session_count || 1;
      });
    }
    if (summary.total_sessions) totalSessions += summary.total_sessions;
    else if (summary.totals?.sessions) totalSessions += summary.totals.sessions;
    else if (summary.session_count) totalSessions += summary.session_count;
  });

  // Member stats
  const periodStart = new Date(startDate);
  const activeMembers = members.filter(m => {
    const lastActive = m.stats?.last_active;
    if (!lastActive) return false;
    return new Date(lastActive) >= periodStart;
  }).length;

  const periodKey = financeState.period === "year" 
    ? startDate.substring(0, 4) 
    : startDate.substring(0, 7);
    
  const newMembers = members.filter(m => {
    const regDate = m.RECDATE;
    if (!regDate) return false;
    if (financeState.period === "year") {
      return regDate.substring(0, 4) === periodKey;
    }
    return regDate.substring(0, 7) === periodKey;
  }).length;

  // Update UI
  const $ = id => document.getElementById(id);
  $("finRevenue").textContent = `₹${formatNumber(totalRevenue)}`;
  $("finExpenses").textContent = `₹${formatNumber(totalExpenses)}`;
  $("finProfit").textContent = `₹${formatNumber(profit)}`;
  
  const profitEl = $("finProfit");
  profitEl.style.color = profit < 0 ? "var(--neon-red)" : "var(--neon-cyan)";

  const hours = Math.floor(totalMinutes / 60);
  $("finMinutes").textContent = `${formatNumber(hours)}h`;
  $("finSessions").textContent = `${formatNumber(totalSessions)} sessions`;

  // Cash & Online summary with profit breakdown
  $("finCash").textContent = `₹${formatNumber(cashTotal)}`;
  $("finUpi").textContent = `₹${formatNumber(upiTotal)}`;
  
  // Expense breakdown by mode
  if ($("finCashExpense")) $("finCashExpense").textContent = `₹${formatNumber(expenseCash)}`;
  if ($("finOnlineExpense")) $("finOnlineExpense").textContent = `₹${formatNumber(expenseOnline)}`;
  
  // Profit breakdown by mode
  if ($("finCashProfit")) {
    $("finCashProfit").textContent = `₹${formatNumber(cashProfit)}`;
    $("finCashProfit").style.color = cashProfit < 0 ? "var(--neon-red)" : "var(--neon-cyan)";
  }
  if ($("finOnlineProfit")) {
    $("finOnlineProfit").textContent = `₹${formatNumber(onlineProfit)}`;
    $("finOnlineProfit").style.color = onlineProfit < 0 ? "var(--neon-red)" : "var(--neon-cyan)";
  }

  $("finActiveMembers").textContent = activeMembers;
  $("finNewMembers").textContent = newMembers;
  $("finTotalSessions").textContent = formatNumber(totalSessions);
  
  if (totalSessions > 0) {
    const avgMins = Math.round(totalMinutes / totalSessions);
    const avgH = Math.floor(avgMins / 60);
    const avgM = avgMins % 60;
    $("finAvgSession").textContent = avgH > 0 ? `${avgH}h ${avgM}m` : `${avgM}m`;
  } else {
    $("finAvgSession").textContent = "-";
  }
}

// ==================== PERIOD MANAGEMENT ====================

function setFinancePeriod(period) {
  financeState.period = period;
  
  // Update buttons
  const monthBtn = document.getElementById("finPeriodMonth");
  const yearBtn = document.getElementById("finPeriodYear");
  
  if (period === "month") {
    monthBtn.classList.add("bg-red-500/20", "text-red-400");
    monthBtn.classList.remove("text-gray-400");
    yearBtn.classList.remove("bg-red-500/20", "text-red-400");
    yearBtn.classList.add("text-gray-400");
  } else {
    yearBtn.classList.add("bg-red-500/20", "text-red-400");
    yearBtn.classList.remove("text-gray-400");
    monthBtn.classList.remove("bg-red-500/20", "text-red-400");
    monthBtn.classList.add("text-gray-400");
  }
  
  updatePeriodDisplay();
  loadFinanceData();
}

function changeFinancePeriod(delta) {
  if (financeState.period === "month") {
    financeState.selectedDate.setMonth(financeState.selectedDate.getMonth() + delta);
  } else {
    financeState.selectedDate.setFullYear(financeState.selectedDate.getFullYear() + delta);
  }
  updatePeriodDisplay();
  loadFinanceData();
}

function updatePeriodDisplay() {
  const el = document.getElementById("finCurrentPeriod");
  if (!el) return;
  
  if (financeState.period === "month") {
    el.textContent = financeState.selectedDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  } else {
    el.textContent = financeState.selectedDate.getFullYear().toString();
  }
}

function getDateRange() {
  const date = financeState.selectedDate;
  let startDate, endDate;
  
  if (financeState.period === "month") {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    startDate = `${year}-${month}-01`;
    endDate = `${year}-${month}-31`;
  } else {
    const year = date.getFullYear();
    startDate = `${year}-01-01`;
    endDate = `${year}-12-31`;
  }
  
  return { startDate, endDate };
}

// ==================== EXPENSE CRUD ====================

function openFinanceExpenseModal(expenseId = null) {
  console.log("📝 openFinanceExpenseModal called with:", expenseId);
  
  if (!canEditData()) {
    showFinanceToast("You don't have permission to add/edit expenses", "error");
    return;
  }

  financeState.editingExpenseId = expenseId;
  const modal = document.getElementById("finExpenseModal");
  const title = document.getElementById("finExpenseModalTitle");
  const form = document.getElementById("finExpenseForm");

  if (!modal || !title || !form) {
    console.error("❌ Modal elements not found:", { modal: !!modal, title: !!title, form: !!form });
    return;
  }

  form.reset();
  document.querySelectorAll(".fin-cat-btn").forEach(btn => btn.classList.remove("selected"));
  document.getElementById("finExpenseCategory").value = "";

  // Reset payment fields
  const cashInput = document.getElementById("finExpenseCash");
  const onlineInput = document.getElementById("finExpenseOnline");
  if (cashInput) cashInput.value = "";
  if (onlineInput) onlineInput.value = "";
  updateExpenseTotal();

  if (expenseId) {
    title.textContent = "EDIT EXPENSE";
    const expense = financeState.expenses.find(e => e.id === expenseId);
    console.log("📝 Found expense for edit:", expense);
    if (expense) {
      document.getElementById("finExpenseId").value = expenseId;
      document.getElementById("finExpenseDate").value = expense.date;
      document.getElementById("finExpenseDesc").value = expense.description || "";
      document.getElementById("finExpenseVendor").value = expense.vendor || "";
      selectFinanceCategory(expense.category);
      
      // Populate cash/online split
      if (expense.cash !== undefined || expense.online !== undefined) {
        if (cashInput) cashInput.value = expense.cash || "";
        if (onlineInput) onlineInput.value = expense.online || "";
      } else {
        // Old format - put full amount in cash by default
        if (cashInput) cashInput.value = expense.amount || "";
      }
      updateExpenseTotal();
    } else {
      console.error("❌ Expense not found in state:", expenseId);
      showFinanceToast("Expense not found", "error");
      return;
    }
  } else {
    title.textContent = "ADD EXPENSE";
    document.getElementById("finExpenseDate").value = formatDateForInput(getISTDate());
  }

  modal.classList.remove("hidden");
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeFinanceExpenseModal() {
  document.getElementById("finExpenseModal").classList.add("hidden");
  financeState.editingExpenseId = null;
}

function selectFinanceCategory(categoryId) {
  document.querySelectorAll(".fin-cat-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.cat === categoryId);
  });
  document.getElementById("finExpenseCategory").value = categoryId;
}

async function saveFinanceExpense(event) {
  event.preventDefault();

  if (!canEditData()) {
    showFinanceToast("You don't have permission to save expenses", "error");
    return;
  }

  const category = document.getElementById("finExpenseCategory").value;
  const cash = parseFloat(document.getElementById("finExpenseCash")?.value) || 0;
  const online = parseFloat(document.getElementById("finExpenseOnline")?.value) || 0;
  const amount = cash + online;
  const date = document.getElementById("finExpenseDate").value;
  const description = document.getElementById("finExpenseDesc").value.trim();
  const vendor = document.getElementById("finExpenseVendor").value.trim();

  if (!category) {
    showFinanceToast("Please select a category", "error");
    return;
  }
  if (amount <= 0) {
    showFinanceToast("Please enter cash or online amount", "error");
    return;
  }
  if (!date) {
    showFinanceToast("Please select a date", "error");
    return;
  }

  const session = getStaffSession();
  const expenseData = {
    category,
    amount,  // Total for backward compatibility
    cash,    // Cash portion
    online,  // Online/UPI portion
    description,
    vendor,
    admin: session?.name || session?.email?.split("@")[0] || "Admin",
    updatedAt: new Date().toISOString()
  };

  try {
    const saveBtn = document.getElementById("finSaveExpenseBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    console.log("💾 Saving expense:", { editingId: financeState.editingExpenseId, date, category, amount });

    if (financeState.editingExpenseId) {
      // Updating existing expense
      const existingExpense = financeState.expenses.find(e => e.id === financeState.editingExpenseId);
      console.log("📝 Found existing expense:", existingExpense);
      
      if (!existingExpense) {
        throw new Error("Could not find expense to update");
      }

      // If date changed, we need to move the expense
      if (existingExpense.date !== date) {
        console.log("📅 Date changed, moving expense from", existingExpense.date, "to", date);
        // Delete from old location
        await bookingDb.ref(`${FB_PATHS.EXPENSES}/${existingExpense.date}/${financeState.editingExpenseId}`).remove();
        // Create at new location with same ID
        expenseData.createdAt = existingExpense.createdAt || new Date().toISOString();
        await bookingDb.ref(`${FB_PATHS.EXPENSES}/${date}/${financeState.editingExpenseId}`).set(expenseData);
      } else {
        // Same date, just update
        await bookingDb.ref(`${FB_PATHS.EXPENSES}/${existingExpense.date}/${financeState.editingExpenseId}`).update(expenseData);
      }
      showFinanceToast("Expense updated", "success");
    } else {
      // Creating new expense
      expenseData.createdAt = new Date().toISOString();
      const newRef = await bookingDb.ref(`${FB_PATHS.EXPENSES}/${date}`).push(expenseData);
      console.log("✅ Created expense with ID:", newRef.key);
      showFinanceToast("Expense added", "success");
    }

    closeFinanceExpenseModal();
    await loadExpenses();
    calculateSummary();
    renderExpenses();
    renderCharts();

  } catch (error) {
    console.error("❌ Error saving expense:", error);
    showFinanceToast(`Failed: ${error.message || "Unknown error"}`, "error");
  } finally {
    const saveBtn = document.getElementById("finSaveExpenseBtn");
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
}

function openFinanceDeleteModal(expenseId, date) {
  console.log("🗑️ openFinanceDeleteModal called:", { expenseId, date });
  
  if (!canEditData()) {
    showFinanceToast("You don't have permission to delete expenses", "error");
    return;
  }
  
  financeState.deleteExpenseData = { id: expenseId, date };
  const modal = document.getElementById("finDeleteModal");
  if (!modal) {
    console.error("❌ Delete modal not found");
    return;
  }
  modal.classList.remove("hidden");
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeFinanceDeleteModal() {
  document.getElementById("finDeleteModal").classList.add("hidden");
  financeState.deleteExpenseData = null;
}

async function confirmFinanceDelete() {
  if (!financeState.deleteExpenseData || !canEditData()) {
    console.log("❌ Delete blocked:", { data: financeState.deleteExpenseData, canEdit: canEditData() });
    return;
  }

  try {
    const { id, date } = financeState.deleteExpenseData;
    console.log("🗑️ Deleting expense:", { id, date });
    
    await bookingDb.ref(`${FB_PATHS.EXPENSES}/${date}/${id}`).remove();
    console.log("✅ Expense deleted successfully");
    showFinanceToast("Expense deleted", "success");
    
    closeFinanceDeleteModal();
    await loadExpenses();
    calculateSummary();
    renderExpenses();
    renderCharts();
  } catch (error) {
    console.error("❌ Error deleting expense:", error);
    showFinanceToast(`Failed: ${error.message || "Unknown error"}`, "error");
  }
}

// ==================== RENDER FUNCTIONS ====================

function renderExpenses() {
  const container = document.getElementById("finExpensesList");
  const emptyState = document.getElementById("finExpensesEmpty");
  if (!container) return;

  const filtered = financeState.currentFilter === "all" 
    ? financeState.expenses 
    : financeState.expenses.filter(e => e.category === financeState.currentFilter);

  if (filtered.length === 0) {
    container.innerHTML = "";
    emptyState?.classList.remove("hidden");
    return;
  }

  emptyState?.classList.add("hidden");
  const canEdit = canEditData();

  // Generate expense items (works on both mobile and desktop)
  const expenseItems = filtered.map(exp => {
    const cat = EXPENSE_CATEGORIES.find(c => c.id === exp.category) || EXPENSE_CATEGORIES[7];
    const dateStr = new Date(exp.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    const actions = canEdit ? `
      <button onclick="openFinanceExpenseModal('${exp.id}')" class="p-2 rounded-lg hover:bg-cyan-500/20 transition-colors" style="color: var(--neon-cyan);">
        <i data-lucide="pencil" class="w-4 h-4"></i>
      </button>
      <button onclick="openFinanceDeleteModal('${exp.id}', '${exp.date}')" class="p-2 rounded-lg hover:bg-red-500/20 transition-colors" style="color: var(--neon-red);">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    ` : '';
    
    // Build payment mode badges
    const amount = exp.amount || ((exp.cash || 0) + (exp.online || 0));
    let paymentBadges = '';
    if (exp.cash > 0) {
      paymentBadges += `<span class="text-xs px-1.5 py-0.5 rounded" style="background: rgba(0,255,136,0.2); color: #00ff88;">💵${formatNumber(exp.cash)}</span>`;
    }
    if (exp.online > 0) {
      paymentBadges += `<span class="text-xs px-1.5 py-0.5 rounded ml-1" style="background: rgba(184,41,255,0.2); color: #b829ff;">📱${formatNumber(exp.online)}</span>`;
    }
    if (!exp.cash && !exp.online && amount > 0) {
      // Old format - show just total
      paymentBadges = `<span class="text-xs text-gray-500">💵 Cash</span>`;
    }

    return `
      <div class="expense-item flex flex-col md:flex-row md:items-center gap-3 p-3 rounded-lg bg-black/20 border border-gray-800 hover:border-gray-700 transition-colors">
        <div class="flex items-center justify-between md:w-24 md:flex-shrink-0">
          <div>
            <div class="text-white font-medium">${dateStr}</div>
            <div class="text-xs text-gray-500">${exp.admin || "Admin"}</div>
          </div>
          <div class="flex md:hidden">${actions}</div>
        </div>
        <div class="md:w-32 md:flex-shrink-0">
          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs" style="background: ${cat.color}20; color: ${cat.color};">
            ${cat.icon} ${cat.name}
          </span>
        </div>
        <div class="flex-1 text-gray-300 text-sm">${exp.description || "-"}</div>
        <div class="flex items-center justify-between md:justify-end gap-4">
          <div class="text-right">
            <div class="font-orbitron font-bold text-lg" style="color: var(--neon-red);">₹${formatNumber(amount)}</div>
            <div class="flex gap-1 justify-end">${paymentBadges}</div>
          </div>
          <div class="hidden md:flex">${actions}</div>
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = expenseItems;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function filterFinanceExpenses(category) {
  financeState.currentFilter = category;
  
  document.querySelectorAll(".fin-filter-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.category === category);
  });

  renderExpenses();
}

// ==================== CHARTS ====================

function renderCharts() {
  renderRevenueChart();
  renderExpenseChart();
}

function renderRevenueChart() {
  const ctx = document.getElementById("finRevenueChart")?.getContext("2d");
  if (!ctx) return;

  const labels = [];
  const data = [];
  const { recharges } = financeState;

  if (financeState.period === "month") {
    // Last 6 months
    for (let i = 5; i >= 0; i--) {
      const month = new Date(financeState.selectedDate);
      month.setMonth(month.getMonth() - i);
      const year = month.getFullYear();
      const m = String(month.getMonth() + 1).padStart(2, "0");
      const start = `${year}-${m}-01`;
      const end = `${year}-${m}-31`;

      labels.push(month.toLocaleDateString("en-IN", { month: "short" }));

      let revenue = 0;
      Object.entries(recharges).forEach(([date, dayData]) => {
        if (date >= start && date <= end) {
          Object.values(dayData).forEach(r => {
            revenue += (r.total || r.amount || 0) + (r.free || 0);
          });
        }
      });
      data.push(revenue);
    }
  } else {
    // Last 12 months of the year
    const year = financeState.selectedDate.getFullYear();
    for (let m = 1; m <= 12; m++) {
      const monthStr = String(m).padStart(2, "0");
      const start = `${year}-${monthStr}-01`;
      const end = `${year}-${monthStr}-31`;
      
      labels.push(new Date(year, m - 1).toLocaleDateString("en-IN", { month: "short" }));

      let revenue = 0;
      Object.entries(recharges).forEach(([date, dayData]) => {
        if (date >= start && date <= end) {
          Object.values(dayData).forEach(r => {
            revenue += (r.total || r.amount || 0) + (r.free || 0);
          });
        }
      });
      data.push(revenue);
    }
  }

  if (financeState.revenueChart) financeState.revenueChart.destroy();

  financeState.revenueChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Revenue",
        data,
        borderColor: "#00ff88",
        backgroundColor: "rgba(0, 255, 136, 0.1)",
        fill: true,
        tension: 0.4,
        pointBackgroundColor: "#00ff88",
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          callbacks: { label: ctx => `₹${formatNumber(ctx.parsed.y)}` }
        }
      },
      scales: {
        x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#888" } },
        y: { 
          grid: { color: "rgba(255,255,255,0.05)" }, 
          ticks: { color: "#888", callback: v => `₹${formatNumber(v)}` }
        }
      }
    }
  });
}

function renderExpenseChart() {
  const ctx = document.getElementById("finExpenseChart")?.getContext("2d");
  if (!ctx) return;

  const categoryTotals = {};
  EXPENSE_CATEGORIES.forEach(c => { categoryTotals[c.id] = 0; });
  financeState.expenses.forEach(exp => {
    if (categoryTotals[exp.category] !== undefined) {
      categoryTotals[exp.category] += exp.amount || 0;
    }
  });

  const active = EXPENSE_CATEGORIES.filter(c => categoryTotals[c.id] > 0);
  
  if (financeState.expenseChart) financeState.expenseChart.destroy();

  if (active.length === 0) {
    ctx.canvas.parentElement.innerHTML = `
      <h3 class="font-orbitron text-sm font-semibold mb-4" style="color: var(--neon-cyan);">EXPENSE BREAKDOWN</h3>
      <div class="flex items-center justify-center h-48 text-gray-500">
        <div class="text-center">
          <i data-lucide="pie-chart" class="w-10 h-10 mx-auto mb-2 opacity-50"></i>
          <p>No expenses this period</p>
        </div>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  financeState.expenseChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: active.map(c => c.name),
      datasets: [{
        data: active.map(c => categoryTotals[c.id]),
        backgroundColor: active.map(c => c.color),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#888", font: { size: 11 }, padding: 10, usePointStyle: true }
        },
        tooltip: {
          backgroundColor: "rgba(0,0,0,0.8)",
          callbacks: { label: ctx => `₹${formatNumber(ctx.parsed)}` }
        }
      },
      cutout: "60%"
    }
  });
}

// ==================== EXPENSE FORM HELPERS ====================

function updateExpenseTotal() {
  const cash = parseFloat(document.getElementById("finExpenseCash")?.value) || 0;
  const online = parseFloat(document.getElementById("finExpenseOnline")?.value) || 0;
  const total = cash + online;
  const totalEl = document.getElementById("finExpenseTotal");
  if (totalEl) {
    totalEl.textContent = `₹${formatNumber(total)}`;
    totalEl.style.color = total > 0 ? "var(--neon-cyan)" : "var(--text-secondary)";
  }
}

// ==================== EXPORT ====================

function exportFinanceExpenses() {
  if (financeState.expenses.length === 0) {
    showFinanceToast("No expenses to export", "error");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const periodLabel = financeState.period === "month" 
    ? financeState.selectedDate.toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : financeState.selectedDate.getFullYear().toString();

  doc.setFontSize(18);
  doc.setTextColor(255, 0, 68);
  doc.text("OceanZ Gaming Cafe", 14, 20);
  
  doc.setFontSize(14);
  doc.setTextColor(100);
  doc.text(`Expense Report - ${periodLabel}`, 14, 30);

  const total = financeState.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text(`Total Expenses: Rs.${formatNumber(total)}`, 14, 45);

  const tableData = financeState.expenses.map(exp => {
    const cat = EXPENSE_CATEGORIES.find(c => c.id === exp.category) || { name: "Other" };
    return [exp.date, cat.name, exp.description || "-", exp.vendor || "-", `Rs.${formatNumber(exp.amount)}`];
  });

  doc.autoTable({
    startY: 55,
    head: [["Date", "Category", "Description", "Vendor", "Amount"]],
    body: tableData,
    theme: "striped",
    headStyles: { fillColor: [255, 0, 68], textColor: [255, 255, 255] }
  });

  doc.save(`expenses-${periodLabel.replace(/\s+/g, "-")}.pdf`);
  showFinanceToast("Report exported", "success");
}

// ==================== UTILITIES ====================

function formatDateForInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatNumber(num) {
  if (num === undefined || num === null) return "0";
  return Math.round(num).toLocaleString("en-IN");
}

function showFinanceToast(message, type = "info") {
  // Use existing toast system if available
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
    return;
  }
  
  // Fallback toast
  const toast = document.createElement("div");
  toast.className = "fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg text-white text-sm font-medium shadow-lg";
  toast.style.background = type === "error" ? "rgba(255,0,68,0.9)" : type === "success" ? "rgba(0,255,136,0.9)" : "rgba(0,240,255,0.9)";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ==================== GLOBAL EXPORTS ====================

window.loadFinanceDashboard = loadFinanceDashboard;
window.setFinancePeriod = setFinancePeriod;
window.changeFinancePeriod = changeFinancePeriod;
window.openFinanceExpenseModal = openFinanceExpenseModal;
window.closeFinanceExpenseModal = closeFinanceExpenseModal;
window.selectFinanceCategory = selectFinanceCategory;
window.saveFinanceExpense = saveFinanceExpense;
window.openFinanceDeleteModal = openFinanceDeleteModal;
window.closeFinanceDeleteModal = closeFinanceDeleteModal;
window.confirmFinanceDelete = confirmFinanceDelete;
window.filterFinanceExpenses = filterFinanceExpenses;
window.exportFinanceExpenses = exportFinanceExpenses;
window.updateExpenseTotal = updateExpenseTotal;
