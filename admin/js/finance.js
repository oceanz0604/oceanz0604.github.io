/**
 * OceanZ Gaming Cafe - Finance Dashboard
 * Expense management, revenue tracking, and financial analysis
 */

import { 
  BOOKING_DB_CONFIG, 
  FDB_DATASET_CONFIG, 
  BOOKING_APP_NAME, 
  FDB_APP_NAME,
  FB_PATHS,
  getISTDate,
  formatToIST,
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

let selectedMonth = new Date(); // Current month being viewed
let expenses = [];
let recharges = {};
let members = [];
let currentFilter = "all";
let editingExpenseId = null;
let deleteExpenseData = null;
let revenueChart = null;
let expenseChart = null;

// Firebase instances
let bookingDb = null;
let fdbDb = null;

// ==================== FIREBASE INIT ====================

async function initFirebase() {
  try {
    // Initialize booking database (for expenses, recharges)
    let bookingApp = firebase.apps.find(a => a.name === BOOKING_APP_NAME);
    if (!bookingApp) {
      bookingApp = firebase.initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);
    }
    bookingDb = bookingApp.database();

    // Initialize FDB database (for members, sessions, daily-summary)
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

// ==================== PERMISSION CHECK ====================

function checkPermissions() {
  const session = getStaffSession();
  if (!session) {
    window.location.href = "login.html";
    return false;
  }

  if (!hasPermission("finance")) {
    showToast("Access denied. You don't have permission to view this page.", "error");
    setTimeout(() => {
      window.location.href = "dashboard.html";
    }, 2000);
    return false;
  }

  // Disable add/edit buttons for view-only users
  if (!canEditData()) {
    const addBtn = document.getElementById("addExpenseBtn");
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.title = "View-only access";
    }
  }

  return true;
}

// ==================== INITIALIZATION ====================

async function init() {
  try {
    // Check permissions first
    if (!checkPermissions()) return;

    // Initialize Firebase
    await initFirebase();

    // Set initial month
    selectedMonth = getISTDate();
    updateMonthDisplay();

    // Load all data
    await loadAllData();

    // Hide loading, show app
    document.getElementById("loading-screen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");

    // Initialize Lucide icons
    lucide.createIcons();

    // Set default date for expense form
    document.getElementById("expenseDate").value = formatDateForInput(getISTDate());

  } catch (error) {
    console.error("Finance init error:", error);
    document.getElementById("loading-status").textContent = "Error loading dashboard";
  }
}

// ==================== DATA LOADING ====================

async function loadAllData() {
  try {
    await Promise.all([
      loadExpenses(),
      loadRecharges(),
      loadMembers()
    ]);

    // Calculate and display summaries
    calculateMonthlySummary();
    renderExpenses();
    renderCharts();

  } catch (error) {
    console.error("Error loading data:", error);
    showToast("Failed to load some data", "error");
  }
}

async function loadExpenses() {
  const monthKey = getMonthKey(selectedMonth);
  const startDate = `${monthKey}-01`;
  const endDate = `${monthKey}-31`;

  try {
    // Load all expenses for the month
    const expensesRef = bookingDb.ref(FB_PATHS.EXPENSES);
    const snapshot = await expensesRef.once("value");
    const allExpenses = snapshot.val() || {};

    expenses = [];
    
    // Filter expenses for selected month
    Object.entries(allExpenses).forEach(([date, dayExpenses]) => {
      if (date >= startDate && date <= endDate) {
        Object.entries(dayExpenses).forEach(([id, expense]) => {
          expenses.push({
            id,
            date,
            ...expense
          });
        });
      }
    });

    // Sort by date descending
    expenses.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    console.log(`✅ Loaded ${expenses.length} expenses for ${monthKey}`);
  } catch (error) {
    console.error("Error loading expenses:", error);
    expenses = [];
  }
}

async function loadRecharges() {
  try {
    // Use SharedCache to get recharges
    recharges = await SharedCache.getRecharges(bookingDb, FB_PATHS.RECHARGES);
    console.log(`✅ Loaded recharges data`);
  } catch (error) {
    console.error("Error loading recharges:", error);
    recharges = {};
  }
}

async function loadMembers() {
  try {
    members = await SharedCache.getMembers(fdbDb, FB_PATHS.MEMBERS);
    console.log(`✅ Loaded ${members.length} members`);
  } catch (error) {
    console.error("Error loading members:", error);
    members = [];
  }
}

// ==================== MONTHLY SUMMARY ====================

function calculateMonthlySummary() {
  const monthKey = getMonthKey(selectedMonth);
  const startDate = `${monthKey}-01`;
  const endDate = `${monthKey}-31`;

  // Calculate revenue from recharges
  let totalRevenue = 0;
  let cashTotal = 0;
  let upiTotal = 0;
  let creditTotal = 0;

  Object.entries(recharges).forEach(([date, dayData]) => {
    if (date >= startDate && date <= endDate) {
      Object.values(dayData).forEach(r => {
        if (r.total !== undefined) {
          totalRevenue += (r.total || 0) + (r.free || 0);
          cashTotal += r.cash || 0;
          upiTotal += r.upi || 0;
          creditTotal += r.credit || 0;
        } else if (r.amount !== undefined) {
          totalRevenue += r.amount || 0;
          if (r.mode === "cash") cashTotal += r.amount;
          else if (r.mode === "upi") upiTotal += r.amount;
          else if (r.mode === "credit") creditTotal += r.amount;
        }
      });
    }
  });

  // Calculate expenses by category
  let totalExpenses = 0;
  const expensesByCategory = {};
  EXPENSE_CATEGORIES.forEach(cat => {
    expensesByCategory[cat.id] = 0;
  });

  expenses.forEach(exp => {
    totalExpenses += exp.amount || 0;
    if (expensesByCategory[exp.category] !== undefined) {
      expensesByCategory[exp.category] += exp.amount || 0;
    }
  });

  // Calculate profit
  const profit = totalRevenue - totalExpenses;

  // Calculate member stats
  const monthStart = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
  const activeMembers = members.filter(m => {
    const lastActive = m.stats?.last_active;
    if (!lastActive) return false;
    return new Date(lastActive) >= monthStart;
  }).length;

  const newMembers = members.filter(m => {
    const regDate = m.RECDATE;
    if (!regDate) return false;
    const regMonth = regDate.substring(0, 7);
    return regMonth === monthKey;
  }).length;

  // Update UI
  document.getElementById("totalRevenue").textContent = `₹${formatNumber(totalRevenue)}`;
  document.getElementById("totalExpenses").textContent = `₹${formatNumber(totalExpenses)}`;
  document.getElementById("totalProfit").textContent = `₹${formatNumber(profit)}`;
  
  // Update profit color based on positive/negative
  const profitEl = document.getElementById("totalProfit");
  if (profit < 0) {
    profitEl.style.color = "var(--neon-red)";
  } else {
    profitEl.style.color = "var(--neon-cyan)";
  }

  // Calculate total minutes (placeholder - would need session data)
  const totalMinutes = calculateTotalMinutes();
  const hours = Math.floor(totalMinutes / 60);
  document.getElementById("totalMinutes").textContent = `${formatNumber(hours)}h`;

  // Payment breakdown
  document.getElementById("cashTotal").textContent = `₹${formatNumber(cashTotal)}`;
  document.getElementById("upiTotal").textContent = `₹${formatNumber(upiTotal)}`;
  document.getElementById("creditTotal").textContent = `₹${formatNumber(creditTotal)}`;

  // Member stats
  document.getElementById("activeMembers").textContent = activeMembers;
  document.getElementById("newMembers").textContent = newMembers;
  document.getElementById("totalSessions").textContent = "-";
  document.getElementById("avgSession").textContent = "-";

  // Calculate month-over-month changes
  calculateMoMChanges(totalRevenue, totalExpenses, profit);

  return { totalRevenue, totalExpenses, profit, expensesByCategory, cashTotal, upiTotal, creditTotal };
}

function calculateTotalMinutes() {
  // This would need to fetch session data from FDB
  // For now, return a placeholder
  return 0;
}

async function calculateMoMChanges(currentRevenue, currentExpenses, currentProfit) {
  // Get previous month data
  const prevMonth = new Date(selectedMonth);
  prevMonth.setMonth(prevMonth.getMonth() - 1);
  const prevMonthKey = getMonthKey(prevMonth);
  const startDate = `${prevMonthKey}-01`;
  const endDate = `${prevMonthKey}-31`;

  let prevRevenue = 0;
  Object.entries(recharges).forEach(([date, dayData]) => {
    if (date >= startDate && date <= endDate) {
      Object.values(dayData).forEach(r => {
        prevRevenue += (r.total || r.amount || 0) + (r.free || 0);
      });
    }
  });

  // Update change indicators
  updateChangeIndicator("revenueChange", currentRevenue, prevRevenue);
  // For expenses and profit, we'd need to load previous month's expenses
  // For now, hide the change indicators
  document.getElementById("expenseChange").style.display = "none";
  document.getElementById("profitChange").style.display = "none";
}

function updateChangeIndicator(elementId, current, previous) {
  const el = document.getElementById(elementId);
  if (!el || previous === 0) {
    el.style.display = "none";
    return;
  }

  const change = ((current - previous) / previous) * 100;
  const isPositive = change >= 0;
  
  el.className = `summary-change ${isPositive ? "positive" : "negative"}`;
  el.innerHTML = `
    <i data-lucide="${isPositive ? "trending-up" : "trending-down"}" class="w-3 h-3"></i>
    <span>${isPositive ? "+" : ""}${change.toFixed(1)}%</span>
  `;
  el.style.display = "inline-flex";
  lucide.createIcons();
}

// ==================== EXPENSE CRUD ====================

function openExpenseModal(expenseId = null) {
  if (!canEditData()) {
    showToast("You don't have permission to add/edit expenses", "error");
    return;
  }

  editingExpenseId = expenseId;
  const modal = document.getElementById("expenseModal");
  const title = document.getElementById("expenseModalTitle");
  const form = document.getElementById("expenseForm");

  // Reset form
  form.reset();
  document.querySelectorAll(".category-option").forEach(opt => opt.classList.remove("selected"));
  document.getElementById("expenseCategory").value = "";

  if (expenseId) {
    // Edit mode
    title.textContent = "EDIT EXPENSE";
    const expense = expenses.find(e => e.id === expenseId);
    if (expense) {
      document.getElementById("expenseId").value = expenseId;
      document.getElementById("expenseAmount").value = expense.amount;
      document.getElementById("expenseDate").value = expense.date;
      document.getElementById("expenseDescription").value = expense.description || "";
      document.getElementById("expenseVendor").value = expense.vendor || "";
      document.getElementById("expenseRecurring").checked = expense.is_recurring || false;
      selectCategory(expense.category);
    }
  } else {
    // Add mode
    title.textContent = "ADD EXPENSE";
    document.getElementById("expenseDate").value = formatDateForInput(getISTDate());
  }

  modal.classList.remove("hidden");
  lucide.createIcons();
}

function closeExpenseModal() {
  document.getElementById("expenseModal").classList.add("hidden");
  editingExpenseId = null;
}

function selectCategory(categoryId) {
  document.querySelectorAll(".category-option").forEach(opt => {
    opt.classList.toggle("selected", opt.dataset.category === categoryId);
  });
  document.getElementById("expenseCategory").value = categoryId;
}

async function saveExpense(event) {
  event.preventDefault();

  if (!canEditData()) {
    showToast("You don't have permission to save expenses", "error");
    return;
  }

  const category = document.getElementById("expenseCategory").value;
  const amount = parseFloat(document.getElementById("expenseAmount").value);
  const date = document.getElementById("expenseDate").value;
  const description = document.getElementById("expenseDescription").value.trim();
  const vendor = document.getElementById("expenseVendor").value.trim();
  const isRecurring = document.getElementById("expenseRecurring").checked;

  if (!category) {
    showToast("Please select a category", "error");
    return;
  }

  if (!amount || amount <= 0) {
    showToast("Please enter a valid amount", "error");
    return;
  }

  if (!date) {
    showToast("Please select a date", "error");
    return;
  }

  const session = getStaffSession();
  const expenseData = {
    category,
    amount,
    description,
    vendor,
    is_recurring: isRecurring,
    admin: session?.name || session?.email?.split("@")[0] || "Admin",
    updatedAt: new Date().toISOString()
  };

  try {
    const saveBtn = document.getElementById("saveExpenseBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    if (editingExpenseId) {
      // Update existing expense
      const existingExpense = expenses.find(e => e.id === editingExpenseId);
      await bookingDb.ref(`${FB_PATHS.EXPENSES}/${existingExpense.date}/${editingExpenseId}`).update(expenseData);
      showToast("Expense updated successfully", "success");
    } else {
      // Create new expense
      expenseData.createdAt = new Date().toISOString();
      await bookingDb.ref(`${FB_PATHS.EXPENSES}/${date}`).push(expenseData);
      showToast("Expense added successfully", "success");
    }

    closeExpenseModal();
    await loadExpenses();
    calculateMonthlySummary();
    renderExpenses();
    renderCharts();

  } catch (error) {
    console.error("Error saving expense:", error);
    showToast("Failed to save expense", "error");
  } finally {
    const saveBtn = document.getElementById("saveExpenseBtn");
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Expense";
  }
}

function openDeleteModal(expenseId, date) {
  if (!canEditData()) {
    showToast("You don't have permission to delete expenses", "error");
    return;
  }

  deleteExpenseData = { id: expenseId, date };
  document.getElementById("deleteModal").classList.remove("hidden");
  lucide.createIcons();
}

function closeDeleteModal() {
  document.getElementById("deleteModal").classList.add("hidden");
  deleteExpenseData = null;
}

async function confirmDeleteExpense() {
  if (!deleteExpenseData || !canEditData()) return;

  try {
    await bookingDb.ref(`${FB_PATHS.EXPENSES}/${deleteExpenseData.date}/${deleteExpenseData.id}`).remove();
    showToast("Expense deleted successfully", "success");
    
    closeDeleteModal();
    await loadExpenses();
    calculateMonthlySummary();
    renderExpenses();
    renderCharts();

  } catch (error) {
    console.error("Error deleting expense:", error);
    showToast("Failed to delete expense", "error");
  }
}

// ==================== RENDER FUNCTIONS ====================

function renderExpenses() {
  const tbody = document.getElementById("expensesList");
  const emptyState = document.getElementById("expensesEmpty");

  // Filter expenses
  const filteredExpenses = currentFilter === "all" 
    ? expenses 
    : expenses.filter(e => e.category === currentFilter);

  if (filteredExpenses.length === 0) {
    tbody.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  const canEdit = canEditData();

  tbody.innerHTML = filteredExpenses.map(expense => {
    const category = EXPENSE_CATEGORIES.find(c => c.id === expense.category) || EXPENSE_CATEGORIES[7];
    const dateObj = new Date(expense.date);
    const dateStr = dateObj.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

    return `
      <tr>
        <td>
          <div class="text-white font-medium">${dateStr}</div>
          <div class="text-xs text-gray-500">${expense.admin || "Admin"}</div>
        </td>
        <td>
          <span class="category-badge ${expense.category}">
            <span>${category.icon}</span>
            <span>${category.name}</span>
          </span>
          ${expense.is_recurring ? '<span class="ml-2 text-xs" style="color: var(--neon-purple);">🔄</span>' : ''}
        </td>
        <td>
          <div class="text-white">${expense.description || "-"}</div>
        </td>
        <td class="hide-mobile text-gray-400">${expense.vendor || "-"}</td>
        <td class="text-right">
          <span class="font-orbitron font-bold" style="color: var(--neon-red);">₹${formatNumber(expense.amount)}</span>
        </td>
        <td class="text-right">
          ${canEdit ? `
            <div class="flex gap-1 justify-end">
              <button onclick="openExpenseModal('${expense.id}')" class="p-2 rounded-lg hover:bg-cyan-500/20 transition-colors" style="color: var(--neon-cyan);" title="Edit">
                <i data-lucide="pencil" class="w-4 h-4"></i>
              </button>
              <button onclick="openDeleteModal('${expense.id}', '${expense.date}')" class="p-2 rounded-lg hover:bg-red-500/20 transition-colors" style="color: var(--neon-red);" title="Delete">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          ` : '-'}
        </td>
      </tr>
    `;
  }).join("");

  lucide.createIcons();
}

function filterExpenses(category) {
  currentFilter = category;
  
  // Update tab styles
  document.querySelectorAll(".filter-tab").forEach(tab => {
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
  const ctx = document.getElementById("revenueTrendChart").getContext("2d");
  
  // Get last 6 months of revenue data
  const labels = [];
  const data = [];
  
  for (let i = 5; i >= 0; i--) {
    const month = new Date(selectedMonth);
    month.setMonth(month.getMonth() - i);
    const monthKey = getMonthKey(month);
    const startDate = `${monthKey}-01`;
    const endDate = `${monthKey}-31`;

    labels.push(month.toLocaleDateString("en-IN", { month: "short" }));

    let monthRevenue = 0;
    Object.entries(recharges).forEach(([date, dayData]) => {
      if (date >= startDate && date <= endDate) {
        Object.values(dayData).forEach(r => {
          monthRevenue += (r.total || r.amount || 0) + (r.free || 0);
        });
      }
    });
    data.push(monthRevenue);
  }

  // Destroy existing chart
  if (revenueChart) {
    revenueChart.destroy();
  }

  revenueChart = new Chart(ctx, {
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
        pointBorderColor: "#00ff88",
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          titleFont: { family: "Orbitron" },
          bodyFont: { family: "Rajdhani" },
          callbacks: {
            label: ctx => `₹${formatNumber(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#888" }
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: {
            color: "#888",
            callback: value => `₹${formatNumber(value)}`
          }
        }
      }
    }
  });
}

function renderExpenseChart() {
  const ctx = document.getElementById("expenseBreakdownChart").getContext("2d");

  // Calculate expenses by category
  const categoryTotals = {};
  EXPENSE_CATEGORIES.forEach(cat => {
    categoryTotals[cat.id] = 0;
  });

  expenses.forEach(exp => {
    if (categoryTotals[exp.category] !== undefined) {
      categoryTotals[exp.category] += exp.amount || 0;
    }
  });

  // Filter out zero values
  const activeCategories = EXPENSE_CATEGORIES.filter(cat => categoryTotals[cat.id] > 0);
  
  if (activeCategories.length === 0) {
    // Show empty state
    if (expenseChart) {
      expenseChart.destroy();
      expenseChart = null;
    }
    ctx.canvas.parentElement.innerHTML = `
      <h3 class="font-orbitron text-sm font-semibold mb-4" style="color: var(--neon-cyan);">EXPENSE BREAKDOWN</h3>
      <div class="flex items-center justify-center h-64 text-gray-500">
        <div class="text-center">
          <i data-lucide="pie-chart" class="w-12 h-12 mx-auto mb-2 opacity-50"></i>
          <p>No expenses this month</p>
        </div>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  // Destroy existing chart
  if (expenseChart) {
    expenseChart.destroy();
  }

  expenseChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: activeCategories.map(cat => cat.name),
      datasets: [{
        data: activeCategories.map(cat => categoryTotals[cat.id]),
        backgroundColor: activeCategories.map(cat => cat.color),
        borderColor: "transparent",
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: "#888",
            font: { family: "Rajdhani", size: 12 },
            padding: 15,
            usePointStyle: true
          }
        },
        tooltip: {
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          titleFont: { family: "Orbitron" },
          bodyFont: { family: "Rajdhani" },
          callbacks: {
            label: ctx => `₹${formatNumber(ctx.parsed)}`
          }
        }
      },
      cutout: "60%"
    }
  });
}

// ==================== MONTH NAVIGATION ====================

function changeMonth(delta) {
  selectedMonth.setMonth(selectedMonth.getMonth() + delta);
  updateMonthDisplay();
  loadAllData();
}

function updateMonthDisplay() {
  const monthStr = selectedMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  document.getElementById("currentMonth").textContent = monthStr;
}

// ==================== EXPORT FUNCTIONS ====================

function exportExpenses() {
  if (expenses.length === 0) {
    showToast("No expenses to export", "error");
    return;
  }

  const monthKey = getMonthKey(selectedMonth);
  const monthName = selectedMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  // Create PDF using jsPDF
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Header
  doc.setFontSize(18);
  doc.setTextColor(255, 0, 68);
  doc.text("OceanZ Gaming Cafe", 14, 20);
  
  doc.setFontSize(14);
  doc.setTextColor(100);
  doc.text(`Expense Report - ${monthName}`, 14, 30);

  // Summary
  const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text(`Total Expenses: Rs.${formatNumber(totalExpenses)}`, 14, 45);

  // Table
  const tableData = expenses.map(exp => {
    const category = EXPENSE_CATEGORIES.find(c => c.id === exp.category) || { name: "Other" };
    return [
      exp.date,
      category.name,
      exp.description || "-",
      exp.vendor || "-",
      `Rs.${formatNumber(exp.amount)}`
    ];
  });

  doc.autoTable({
    startY: 55,
    head: [["Date", "Category", "Description", "Vendor", "Amount"]],
    body: tableData,
    theme: "striped",
    headStyles: {
      fillColor: [255, 0, 68],
      textColor: [255, 255, 255],
      fontStyle: "bold"
    },
    styles: {
      fontSize: 10
    }
  });

  doc.save(`expenses-${monthKey}.pdf`);
  showToast("Expense report exported", "success");
}

// ==================== UTILITY FUNCTIONS ====================

function getMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatNumber(num) {
  if (num === undefined || num === null) return "0";
  return Math.round(num).toLocaleString("en-IN");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  
  const colors = {
    success: { bg: "rgba(0, 255, 136, 0.9)", icon: "check-circle" },
    error: { bg: "rgba(255, 0, 68, 0.9)", icon: "alert-circle" },
    info: { bg: "rgba(0, 240, 255, 0.9)", icon: "info" }
  };
  
  const style = colors[type] || colors.info;
  
  toast.className = "flex items-center gap-3 px-4 py-3 rounded-lg text-white text-sm font-medium shadow-lg";
  toast.style.cssText = `background: ${style.bg}; animation: slideIn 0.3s ease;`;
  toast.innerHTML = `
    <i data-lucide="${style.icon}" class="w-5 h-5"></i>
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  lucide.createIcons();
  
  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==================== GLOBAL EXPORTS ====================

window.changeMonth = changeMonth;
window.openExpenseModal = openExpenseModal;
window.closeExpenseModal = closeExpenseModal;
window.selectCategory = selectCategory;
window.saveExpense = saveExpense;
window.openDeleteModal = openDeleteModal;
window.closeDeleteModal = closeDeleteModal;
window.confirmDeleteExpense = confirmDeleteExpense;
window.filterExpenses = filterExpenses;
window.exportExpenses = exportExpenses;

// ==================== INITIALIZE ====================

document.addEventListener("DOMContentLoaded", init);
