/**
 * OceanZ Gaming Cafe - Food Analytics
 * Separate analytics page for food sales (not mixed with gaming)
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get, set, push, update, remove, onValue, off, query, orderByChild, startAt, endAt } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { BOOKING_DB_CONFIG, FB_PATHS } from "../../shared/config.js";

// ==================== FIREBASE INIT ====================

const FOOD_ANALYTICS_APP = "OCEANZ_FOOD_ANALYTICS";

let foodAnalyticsApp, db;
try {
  foodAnalyticsApp = getApps().find(app => app.name === FOOD_ANALYTICS_APP);
  if (!foodAnalyticsApp) {
    foodAnalyticsApp = initializeApp(BOOKING_DB_CONFIG, FOOD_ANALYTICS_APP);
  }
  db = getDatabase(foodAnalyticsApp);
} catch (err) {
  console.error("Food Analytics Firebase init error:", err);
}

// ==================== STATE ====================

let currentPeriod = "month"; // "month" or "year"
let currentDate = new Date();
let salesChart = null;
let allFoodSales = [];
let allFoodCredits = [];
let allCreditPayments = [];

// ==================== INITIALIZATION ====================

export function initFoodAnalytics() {
  console.log("[FoodAnalytics] Initializing...");
  loadFoodAnalytics();
}

// ==================== DATA LOADING ====================

async function loadFoodAnalytics() {
  updatePeriodLabel();
  
  const { startDate, endDate, dates } = getPeriodDates();
  
  console.log(`[FoodAnalytics] Loading data for ${startDate} to ${endDate}`);
  
  // Load all data in parallel
  await Promise.all([
    loadFoodSales(dates),
    loadFoodCredits(),
    loadCreditPayments(dates)
  ]);
  
  calculateAndRender();
}

async function loadFoodSales(dates) {
  allFoodSales = [];
  
  for (const dateStr of dates) {
    try {
      const snapshot = await get(ref(db, `${FB_PATHS.FOOD_SALES}/${dateStr}`));
      if (snapshot.exists()) {
        snapshot.forEach(child => {
          allFoodSales.push({
            id: child.key,
            date: dateStr,
            ...child.val()
          });
        });
      }
    } catch (err) {
      console.warn(`[FoodAnalytics] Error loading sales for ${dateStr}:`, err);
    }
  }
  
  console.log(`[FoodAnalytics] Loaded ${allFoodSales.length} food sales`);
}

async function loadFoodCredits() {
  allFoodCredits = [];
  
  try {
    const snapshot = await get(ref(db, FB_PATHS.FOOD_CREDITS));
    if (snapshot.exists()) {
      snapshot.forEach(child => {
        const data = child.val();
        if (data.outstanding > 0) {
          allFoodCredits.push({
            id: child.key,
            ...data
          });
        }
      });
    }
  } catch (err) {
    console.warn("[FoodAnalytics] Error loading credits:", err);
  }
  
  console.log(`[FoodAnalytics] Loaded ${allFoodCredits.length} outstanding credits`);
}

async function loadCreditPayments(dates) {
  allCreditPayments = [];
  
  for (const dateStr of dates) {
    try {
      const snapshot = await get(ref(db, `${FB_PATHS.FOOD_CREDIT_PAYMENTS}/${dateStr}`));
      if (snapshot.exists()) {
        snapshot.forEach(child => {
          allCreditPayments.push({
            id: child.key,
            date: dateStr,
            ...child.val()
          });
        });
      }
    } catch (err) {
      console.warn(`[FoodAnalytics] Error loading credit payments for ${dateStr}:`, err);
    }
  }
  
  console.log(`[FoodAnalytics] Loaded ${allCreditPayments.length} credit payments`);
}

// ==================== CALCULATIONS ====================

function calculateAndRender() {
  let totalSales = 0;
  let cashCollected = 0;
  let upiCollected = 0;
  
  // Process food sales
  allFoodSales.forEach(sale => {
    totalSales += sale.total || 0;
    
    if (sale.paymentMode === "cash") {
      cashCollected += sale.total || 0;
    } else if (sale.paymentMode === "upi") {
      upiCollected += sale.total || 0;
    } else if (sale.paymentMode === "split") {
      cashCollected += sale.cashAmount || 0;
      upiCollected += sale.upiAmount || 0;
    }
    // Credits not counted in collected until paid
  });
  
  // Add credit payments to collected amounts
  allCreditPayments.forEach(payment => {
    cashCollected += payment.cash || 0;
    upiCollected += payment.upi || 0;
  });
  
  // Calculate outstanding credits
  let creditsOutstanding = allFoodCredits.reduce((sum, c) => sum + (c.outstanding || 0), 0);
  
  // Update UI
  document.getElementById("foodTotalSales").textContent = `₹${totalSales.toLocaleString()}`;
  document.getElementById("foodCashCollected").textContent = `₹${cashCollected.toLocaleString()}`;
  document.getElementById("foodUpiCollected").textContent = `₹${upiCollected.toLocaleString()}`;
  document.getElementById("foodCreditsOutstanding").textContent = `₹${creditsOutstanding.toLocaleString()}`;
  
  renderSalesChart();
  renderTopItems();
  renderCreditsList();
  renderRecentSales();
}

// ==================== UI RENDERING ====================

function renderSalesChart() {
  const ctx = document.getElementById("foodSalesChart");
  if (!ctx) return;
  
  const { dates } = getPeriodDates();
  
  // Aggregate sales by date
  const salesByDate = {};
  dates.forEach(d => salesByDate[d] = 0);
  
  allFoodSales.forEach(sale => {
    if (salesByDate[sale.date] !== undefined) {
      salesByDate[sale.date] += sale.total || 0;
    }
  });
  
  const labels = dates.map(d => {
    const [y, m, day] = d.split("-");
    return currentPeriod === "month" ? day : `${m}/${day}`;
  });
  const data = dates.map(d => salesByDate[d]);
  
  // Destroy existing chart
  if (salesChart) {
    salesChart.destroy();
  }
  
  // Create new chart
  if (window.Chart) {
    salesChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Sales (₹)",
          data,
          borderColor: "#b829ff",
          backgroundColor: "rgba(184, 41, 255, 0.1)",
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,0.05)" },
            ticks: { color: "#888" }
          },
          y: {
            grid: { color: "rgba(255,255,255,0.05)" },
            ticks: { color: "#888" }
          }
        }
      }
    });
  }
}

function renderTopItems() {
  const container = document.getElementById("foodTopItems");
  if (!container) return;
  
  // Aggregate items by name
  const itemCounts = {};
  allFoodSales.forEach(sale => {
    if (sale.items) {
      sale.items.forEach(item => {
        const key = item.name;
        if (!itemCounts[key]) {
          itemCounts[key] = { name: key, qty: 0, revenue: 0 };
        }
        itemCounts[key].qty += item.qty || 1;
        itemCounts[key].revenue += (item.price || 0) * (item.qty || 1);
      });
    }
  });
  
  const sorted = Object.values(itemCounts)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
  
  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-gray-500">
        <i data-lucide="bar-chart" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
        <p class="text-sm">No sales data yet</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }
  
  const maxRevenue = sorted[0].revenue;
  
  container.innerHTML = sorted.map((item, idx) => {
    const percent = (item.revenue / maxRevenue) * 100;
    return `
      <div class="flex items-center gap-3">
        <span class="font-orbitron text-sm text-gray-500 w-5">#${idx + 1}</span>
        <div class="flex-1">
          <div class="flex items-center justify-between mb-1">
            <span class="text-sm text-white">${item.name}</span>
            <span class="text-xs text-gray-400">${item.qty} sold</span>
          </div>
          <div class="h-2 rounded-full bg-gray-800 overflow-hidden">
            <div class="h-full rounded-full" style="width: ${percent}%; background: linear-gradient(90deg, var(--neon-orange), var(--neon-purple));"></div>
          </div>
          <div class="text-right text-xs mt-0.5" style="color: var(--neon-green);">₹${item.revenue.toLocaleString()}</div>
        </div>
      </div>
    `;
  }).join("");
  
  if (window.lucide) window.lucide.createIcons();
}

function renderCreditsList() {
  const container = document.getElementById("foodCreditsList");
  if (!container) return;
  
  if (allFoodCredits.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-gray-500">
        <i data-lucide="check-circle" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
        <p class="text-sm">No outstanding credits</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }
  
  container.innerHTML = allFoodCredits.map(credit => `
    <div class="flex items-center justify-between p-3 rounded-lg bg-black/30 border border-gray-800">
      <div class="flex-1">
        <div class="font-semibold text-white">${credit.customerName || credit.id}</div>
        <div class="text-xs text-gray-500">Outstanding: ₹${credit.outstanding}</div>
      </div>
      <button onclick="openFoodCreditCollectModal('${encodeURIComponent(credit.id)}', '${encodeURIComponent(credit.customerName || credit.id)}', ${credit.outstanding})" 
        class="px-3 py-1.5 rounded-lg text-xs font-orbitron" style="background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.3); color: #00ff88;">
        Collect
      </button>
    </div>
  `).join("");
  
  if (window.lucide) window.lucide.createIcons();
}

function renderRecentSales() {
  const container = document.getElementById("foodSalesList");
  if (!container) return;
  
  // Sort by timestamp descending
  const sorted = [...allFoodSales].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 50);
  
  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-gray-500">
        <i data-lucide="receipt" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
        <p class="text-sm">No sales recorded yet</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }
  
  container.innerHTML = sorted.map(sale => {
    const modeIcon = sale.paymentMode === "cash" ? "💵" : sale.paymentMode === "upi" ? "📱" : sale.paymentMode === "split" ? "✂️" : "⏰";
    const itemsText = sale.items ? sale.items.map(i => `${i.qty || 1}x ${i.name}`).join(", ") : "—";
    const time = sale.timestamp ? new Date(sale.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
    
    return `
      <div class="flex items-center justify-between p-3 rounded-lg bg-black/30 border border-gray-800">
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-white text-sm truncate">${sale.customerName || "Walk-in"}</div>
          <div class="text-xs text-gray-500 truncate">${itemsText}</div>
        </div>
        <div class="text-right ml-3 flex-shrink-0">
          <div class="font-orbitron font-bold" style="color: var(--neon-green);">₹${sale.total || 0}</div>
          <div class="text-xs text-gray-500">${modeIcon} ${time}</div>
        </div>
      </div>
    `;
  }).join("");
  
  if (window.lucide) window.lucide.createIcons();
}

// ==================== PERIOD NAVIGATION ====================

function getPeriodDates() {
  const dates = [];
  let startDate, endDate;
  
  if (currentPeriod === "month") {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      dates.push(dateStr);
    }
    
    startDate = dates[0];
    endDate = dates[dates.length - 1];
  } else {
    // Year view - get all months
    const year = currentDate.getFullYear();
    
    for (let m = 0; m < 12; m++) {
      const daysInMonth = new Date(year, m + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        dates.push(dateStr);
      }
    }
    
    startDate = `${year}-01-01`;
    endDate = `${year}-12-31`;
  }
  
  return { startDate, endDate, dates };
}

function updatePeriodLabel() {
  const label = document.getElementById("foodPeriodLabel");
  if (!label) return;
  
  if (currentPeriod === "month") {
    label.textContent = currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } else {
    label.textContent = currentDate.getFullYear().toString();
  }
}

function setFoodPeriod(period) {
  currentPeriod = period;
  
  // Update button styles
  const monthBtn = document.getElementById("foodMonthBtn");
  const yearBtn = document.getElementById("foodYearBtn");
  
  if (monthBtn && yearBtn) {
    if (period === "month") {
      monthBtn.style.background = "rgba(184,41,255,0.2)";
      monthBtn.style.borderColor = "var(--neon-purple)";
      monthBtn.style.color = "var(--neon-purple)";
      yearBtn.style.background = "transparent";
      yearBtn.style.borderColor = "#374151";
      yearBtn.style.color = "#6b7280";
    } else {
      yearBtn.style.background = "rgba(184,41,255,0.2)";
      yearBtn.style.borderColor = "var(--neon-purple)";
      yearBtn.style.color = "var(--neon-purple)";
      monthBtn.style.background = "transparent";
      monthBtn.style.borderColor = "#374151";
      monthBtn.style.color = "#6b7280";
    }
  }
  
  loadFoodAnalytics();
}

function changeFoodPeriod(delta) {
  if (currentPeriod === "month") {
    currentDate.setMonth(currentDate.getMonth() + delta);
  } else {
    currentDate.setFullYear(currentDate.getFullYear() + delta);
  }
  loadFoodAnalytics();
}

// ==================== EXPORT ====================

function exportFoodSales() {
  if (allFoodSales.length === 0) {
    alert("No sales data to export");
    return;
  }
  
  const headers = ["Date", "Time", "Customer", "Items", "Total", "Payment Mode", "Staff"];
  const rows = allFoodSales.map(sale => {
    const time = sale.timestamp ? new Date(sale.timestamp).toLocaleTimeString("en-IN") : "";
    const items = sale.items ? sale.items.map(i => `${i.qty || 1}x ${i.name}`).join("; ") : "";
    return [
      sale.date,
      time,
      sale.customerName || "Walk-in",
      items,
      sale.total || 0,
      sale.paymentMode || "—",
      sale.staffName || "—"
    ];
  });
  
  const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = `food-sales-${currentDate.toISOString().split("T")[0]}.csv`;
  a.click();
  
  URL.revokeObjectURL(url);
}

// ==================== FOOD CREDIT COLLECTION ====================

let collectingFoodCredit = null;

function openFoodCreditCollectModal(encodedId, encodedName, outstanding) {
  const id = decodeURIComponent(encodedId);
  const name = decodeURIComponent(encodedName);
  
  collectingFoodCredit = { id, name, outstanding };
  
  document.getElementById("foodCreditCustomerName").textContent = name;
  document.getElementById("foodCreditOutstanding").textContent = `₹${outstanding}`;
  document.getElementById("foodCreditRemaining").textContent = `₹${outstanding}`;
  document.getElementById("foodCreditCash").value = "";
  document.getElementById("foodCreditUpi").value = "";
  
  document.getElementById("foodCreditCollectModal").classList.remove("hidden");
}

function closeFoodCreditCollectModal() {
  collectingFoodCredit = null;
  document.getElementById("foodCreditCollectModal").classList.add("hidden");
}

function updateFoodCreditRemaining() {
  if (!collectingFoodCredit) return;
  
  const cash = parseFloat(document.getElementById("foodCreditCash").value) || 0;
  const upi = parseFloat(document.getElementById("foodCreditUpi").value) || 0;
  const remaining = collectingFoodCredit.outstanding - cash - upi;
  
  const el = document.getElementById("foodCreditRemaining");
  el.textContent = `₹${Math.max(0, remaining)}`;
  el.style.color = remaining <= 0 ? "var(--neon-green)" : "var(--neon-cyan)";
}

async function confirmFoodCreditCollection() {
  if (!collectingFoodCredit) return;
  
  const cash = parseFloat(document.getElementById("foodCreditCash").value) || 0;
  const upi = parseFloat(document.getElementById("foodCreditUpi").value) || 0;
  const totalPaid = cash + upi;
  
  if (totalPaid <= 0) {
    alert("Please enter an amount to collect");
    return;
  }
  
  if (totalPaid > collectingFoodCredit.outstanding) {
    alert(`Amount (₹${totalPaid}) exceeds outstanding (₹${collectingFoodCredit.outstanding})`);
    return;
  }
  
  try {
    const today = new Date().toISOString().split("T")[0];
    
    // Record the payment
    const paymentRef = ref(db, `${FB_PATHS.FOOD_CREDIT_PAYMENTS}/${today}`);
    const newPaymentRef = push(paymentRef);
    await set(newPaymentRef, {
      customerId: collectingFoodCredit.id,
      customerName: collectingFoodCredit.name,
      cash: cash,
      upi: upi,
      total: totalPaid,
      timestamp: Date.now()
    });
    
    // Update the outstanding amount
    const newOutstanding = collectingFoodCredit.outstanding - totalPaid;
    const creditRef = ref(db, `${FB_PATHS.FOOD_CREDITS}/${collectingFoodCredit.id}`);
    
    if (newOutstanding <= 0) {
      // Remove the credit entry if fully paid
      await remove(creditRef);
    } else {
      // Update the outstanding amount
      await update(creditRef, {
        outstanding: newOutstanding,
        lastPayment: Date.now()
      });
    }
    
    closeFoodCreditCollectModal();
    loadFoodAnalytics(); // Refresh data
    
    alert(`Collected ₹${totalPaid} from ${collectingFoodCredit.name}`);
  } catch (err) {
    console.error("[FoodAnalytics] Collection error:", err);
    alert("Failed to collect: " + err.message);
  }
}

// ==================== GLOBAL EXPORTS ====================

window.setFoodPeriod = setFoodPeriod;
window.changeFoodPeriod = changeFoodPeriod;
window.exportFoodSales = exportFoodSales;
window.initFoodAnalytics = initFoodAnalytics;
window.openFoodCreditCollectModal = openFoodCreditCollectModal;
window.closeFoodCreditCollectModal = closeFoodCreditCollectModal;
window.updateFoodCreditRemaining = updateFoodCreditRemaining;
window.confirmFoodCreditCollection = confirmFoodCreditCollection;

export { loadFoodAnalytics };
