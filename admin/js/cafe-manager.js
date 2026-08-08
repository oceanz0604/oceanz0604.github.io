/**
 * OceanZ Gaming Cafe - Cafe Manager
 * Consolidated Food Menu + Food Stock module.
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, get, set, update, remove, push, onValue, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  BOOKING_DB_CONFIG, BOOKING_APP_NAME, FB_PATHS, getISTDate
} from "../../shared/config.js";
import { getStaffSession, canEditData } from "./permissions.js";

const CAFE_APP = "OCEANZ_CAFE_MANAGER";
const LOW_STOCK_THRESHOLD = 5;

let app = getApps().find(a => a.name === CAFE_APP);
if (!app) app = initializeApp(BOOKING_DB_CONFIG, CAFE_APP);
const db = getDatabase(app);

const $ = id => document.getElementById(id);

// ==================== STATE ====================

let foodItems = [];
let purchases = [];
let stockLogs = [];
let currentCategory = "all";
let searchQuery = "";
let stockFilter = "all";
let currentTab = "products";
let editingItemId = null;
let deletingItemId = null;
let purchaseLineCount = 0;
let menuListenerAttached = false;

const CATEGORY_ICONS = {
  snacks: "🍿",
  drinks: "🥤",
  meals: "🍽️",
  combos: "🎁"
};

// ==================== HELPERS ====================

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(n) {
  return `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
}

function todayISO() {
  const d = getISTDate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgoISO(n) {
  const d = getISTDate();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function staffLabel() {
  const s = getStaffSession();
  return s?.name || s?.email?.split("@")[0] || "Admin";
}

function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = "fixed top-20 right-4 z-[80] p-3 rounded-lg font-orbitron text-xs";
  el.style.cssText = type === "error"
    ? "background:rgba(255,0,68,0.2);border:1px solid #ff0044;color:#ff0044;"
    : "background:rgba(0,255,136,0.15);border:1px solid #00ff88;color:#00ff88;";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function stockBadgeHtml(item) {
  const stock = item.stock;
  const tracked = stock !== null && stock !== undefined;
  const n = Number(stock) || 0;
  if (!tracked) return `<span class="stock-badge-pill muted">∞</span>`;
  if (n <= 0) return `<span class="stock-badge-pill out">OUT</span>`;
  if (n <= LOW_STOCK_THRESHOLD) return `<span class="stock-badge-pill low">LOW</span>`;
  return `<span class="stock-badge-pill ok">OK</span>`;
}

function marginInfo(item) {
  const price = Number(item.price) || 0;
  const cost = item.cost;
  if (cost === null || cost === undefined || cost === "" || !price) return null;
  const c = Number(cost);
  if (!Number.isFinite(c)) return null;
  const marginRs = price - c;
  const marginPct = (marginRs / price) * 100;
  return { marginRs, marginPct, cost: c };
}

// ==================== INIT ====================

async function initCafeManager() {
  console.log("[CafeManager] Initializing...");

  if (!canEditData()) {
    const btn = $("stockPurchaseBtn") || $("cafePurchaseBtn");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.title = "View-only";
    }
  }

  attachMenuListener();
  await Promise.all([loadPurchases(), loadStockLogs()]);
  updateCafeKpis();
  renderActiveTab();
  if (window.lucide) window.lucide.createIcons();
}

function attachMenuListener() {
  if (menuListenerAttached) return;
  menuListenerAttached = true;
  const itemsRef = ref(db, FB_PATHS.FOOD_MENU);
  onValue(itemsRef, (snapshot) => {
    foodItems = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        foodItems.push({ id: child.key, ...child.val() });
      });
    }
    foodItems.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    console.log(`[CafeManager] Loaded ${foodItems.length} items`);
    updateCafeKpis();
    renderCafeProducts();
    if (currentTab === "purchases") renderPurchases();
    if (currentTab === "log") renderLog();
  }, (error) => {
    console.error("[CafeManager] Menu load error:", error);
  });
}

async function loadPurchases() {
  const from = daysAgoISO(45);
  const snap = await get(ref(db, FB_PATHS.FOOD_PURCHASES));
  const tree = snap.val() || {};
  purchases = [];
  Object.entries(tree).forEach(([date, day]) => {
    if (date < from) return;
    Object.entries(day || {}).forEach(([id, p]) => {
      purchases.push({ id, date, ...p });
    });
  });
  purchases.sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) ||
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
}

async function loadStockLogs() {
  const from = daysAgoISO(30);
  const snap = await get(ref(db, FB_PATHS.FOOD_STOCK_LOG));
  const tree = snap.val() || {};
  stockLogs = [];
  Object.entries(tree).forEach(([date, day]) => {
    if (date < from) return;
    Object.entries(day || {}).forEach(([id, row]) => {
      stockLogs.push({ id, date, ...row });
    });
  });
  stockLogs.sort((a, b) =>
    String(b.timestamp || b.date).localeCompare(String(a.timestamp || a.date))
  );
}

async function refreshPurchasesAndLogs() {
  await Promise.all([loadPurchases(), loadStockLogs()]);
  updateCafeKpis();
  renderActiveTab();
}

// ==================== KPIs ====================

function updateCafeKpis() {
  const tracked = foodItems.filter(i => i.stock !== null && i.stock !== undefined);
  const low = tracked.filter(i => Number(i.stock) <= LOW_STOCK_THRESHOLD);
  const units = tracked.reduce((s, i) => s + (Number(i.stock) || 0), 0);
  const from30 = daysAgoISO(30);
  const purchSum = purchases
    .filter(p => p.date >= from30)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

  // Prefer cafeStat* IDs; fall back to stockStat* for existing HTML
  setText("cafeStatItems", String(foodItems.length));
  setText("cafeStatLow", String(low.length));
  setText("cafeStatUnits", units.toLocaleString("en-IN"));
  setText("cafeStatPurchases", formatMoney(purchSum));

  setText("stockStatSkus", String(tracked.length));
  setText("stockStatLow", String(low.length));
  setText("stockStatUnits", units.toLocaleString("en-IN"));
  setText("stockStatPurchases", formatMoney(purchSum));

  const alert = $("stockLowAlert") || $("cafeLowAlert");
  if (alert) {
    if (low.length) {
      alert.classList.remove("hidden");
      alert.textContent = `Low stock: ${low.slice(0, 6).map(i => `${i.name} (${i.stock})`).join(" · ")}${low.length > 6 ? "…" : ""}`;
    } else {
      alert.classList.add("hidden");
    }
  }
}

// ==================== TABS ====================

function setCafeTab(tab) {
  const map = { inventory: "products", products: "products", purchases: "purchases", log: "log" };
  currentTab = map[tab] || "products";

  document.querySelectorAll(".stock-tab, .cafe-tab").forEach(btn => {
    const t = map[btn.dataset.tab] || btn.dataset.tab;
    btn.classList.toggle("active", t === currentTab);
  });

  $("cafeProductsPanel")?.classList.toggle("hidden", currentTab !== "products");
  $("stockInventoryPanel")?.classList.toggle("hidden", currentTab !== "products");
  $("stockPurchasesPanel")?.classList.toggle("hidden", currentTab !== "purchases");
  $("stockLogPanel")?.classList.toggle("hidden", currentTab !== "log");

  renderActiveTab();
}

function renderActiveTab() {
  if (currentTab === "products") renderCafeProducts();
  else if (currentTab === "purchases") renderPurchases();
  else renderLog();
}

window.setStockTab = setCafeTab;
window.setCafeTab = setCafeTab;

window.filterStockInventory = function() {
  searchQuery = $("stockSearch")?.value || $("cafeSearch")?.value || "";
  stockFilter = $("stockFilter")?.value || $("cafeStockFilter")?.value || "all";
  renderCafeProducts();
};

window.filterCafeSearch = function() {
  searchQuery = $("cafeSearch")?.value || $("stockSearch")?.value || "";
  renderCafeProducts();
};

window.filterFoodCategory = function(category) {
  currentCategory = category;
  document.querySelectorAll(".food-cat-btn, .cafe-cat-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.category === category);
  });
  renderCafeProducts();
};

// ==================== PRODUCTS RENDER ====================

function renderCafeProducts() {
  const list = $("cafeProductList") || $("foodMenuGrid") || $("stockInventoryList");
  if (!list) return;

  const q = searchQuery.trim().toLowerCase();
  let rows = [...foodItems];

  if (currentCategory !== "all") {
    rows = rows.filter(i => i.category === currentCategory);
  }

  if (stockFilter === "low") {
    rows = rows.filter(i => i.stock !== null && i.stock !== undefined && Number(i.stock) > 0 && Number(i.stock) <= LOW_STOCK_THRESHOLD);
  } else if (stockFilter === "out") {
    rows = rows.filter(i => i.stock !== null && i.stock !== undefined && Number(i.stock) <= 0);
  } else if (stockFilter === "untracked") {
    rows = rows.filter(i => i.stock === null || i.stock === undefined);
  } else if (stockFilter === "tracked") {
    rows = rows.filter(i => i.stock !== null && i.stock !== undefined);
  }

  if (q) {
    rows = rows.filter(i => String(i.name || "").toLowerCase().includes(q));
  }

  if (!rows.length) {
    list.innerHTML = `<div class="text-center py-10 text-gray-500 text-sm col-span-full">No matching items</div>`;
    return;
  }

  list.innerHTML = rows.map(item => {
    const stock = item.stock;
    const tracked = stock !== null && stock !== undefined;
    const n = Number(stock) || 0;
    const badge = stockBadgeHtml(item);
    const margin = marginInfo(item);
    const icon = CATEGORY_ICONS[item.category] || "🍽️";
    const availableLabel = item.available === false
      ? `<span class="text-[10px] text-gray-500">Hidden</span>`
      : `<span class="text-[10px] text-green-500">Available</span>`;
    const costLine = margin
      ? `cost ${formatMoney(margin.cost)} · margin ${formatMoney(margin.marginRs)} (${margin.marginPct.toFixed(0)}%)`
      : (item.cost != null && item.cost !== ""
        ? `cost ${formatMoney(item.cost)}`
        : "cost —");

    return `
      <div class="stock-row ${item.available === false ? "opacity-60" : ""}">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-base">${icon}</span>
            <span class="font-orbitron text-sm text-white truncate">${escapeHtml(item.name)}</span>
            ${badge}
            ${availableLabel}
          </div>
          <div class="text-[10px] text-gray-500 mt-0.5">
            ${escapeHtml(item.category || "—")} · sell ${formatMoney(item.price)} · ${costLine}
          </div>
          <div class="text-[10px] mt-0.5" style="color:${!tracked ? "#888" : n <= 0 ? "#ff0044" : n <= LOW_STOCK_THRESHOLD ? "#ff6b00" : "#00ff88"};">
            Stock: ${tracked ? n : "∞"}
          </div>
        </div>
        <div class="flex flex-col gap-1 shrink-0 items-end">
          <div class="flex gap-1">
            <button type="button" class="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:border-cyan-500 hover:text-cyan-400"
              onclick="editFoodItem('${item.id}')">Edit</button>
            <button type="button" class="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:border-orange-500 hover:text-orange-400"
              onclick="quickAdjustFromRow('${item.id}')">Adjust</button>
            <button type="button" class="text-[10px] px-2 py-1 rounded border border-gray-700 text-gray-400 hover:border-red-500 hover:text-red-400"
              onclick="openFoodDeleteModal('${item.id}')">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  if (window.lucide) window.lucide.createIcons();
}

function renderPurchases() {
  const list = $("stockPurchasesList") || $("cafePurchasesList");
  if (!list) return;
  if (!purchases.length) {
    list.innerHTML = `<div class="text-center py-10 text-gray-500 text-sm">No purchases in the last 45 days</div>`;
    return;
  }
  list.innerHTML = purchases.map(p => {
    const items = (p.items || []).map(i => `${i.name} ×${i.qty}`).join(", ");
    return `
      <div class="stock-row">
        <div class="min-w-0">
          <div class="font-orbitron text-sm" style="color: var(--neon-cyan);">${escapeHtml(p.date)} · ${formatMoney(p.amount)}</div>
          <div class="text-[10px] text-gray-500 truncate">${escapeHtml(p.vendor || "—")} · ${escapeHtml(items || p.note || "")}</div>
          <div class="text-[10px] text-gray-600 mt-0.5">Expense linked · ${escapeHtml(p.admin || "")}</div>
        </div>
        <div class="text-right text-[10px] text-gray-500 shrink-0">
          <div>Cash ${formatMoney(p.cash)}</div>
          <div>Online ${formatMoney(p.online)}</div>
        </div>
      </div>
    `;
  }).join("");
}

function renderLog() {
  const list = $("stockLogList") || $("cafeLogList");
  if (!list) return;
  if (!stockLogs.length) {
    list.innerHTML = `<div class="text-center py-10 text-gray-500 text-sm">No stock movements in 30 days</div>`;
    return;
  }
  list.innerHTML = stockLogs.slice(0, 80).map(row => {
    const delta = Number(row.delta) || 0;
    const sign = delta > 0 ? `+${delta}` : String(delta);
    const color = delta > 0 ? "#00ff88" : delta < 0 ? "#ff0044" : "#888";
    return `
      <div class="stock-row">
        <div class="min-w-0">
          <div class="text-sm text-white truncate">${escapeHtml(row.itemName || row.menuItemId)}</div>
          <div class="text-[10px] text-gray-500">${escapeHtml(row.date)} · ${escapeHtml(row.reason || "")} · ${escapeHtml(row.note || "")}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="font-orbitron" style="color:${color};">${sign}</div>
          <div class="text-[10px] text-gray-500">→ ${row.stockAfter ?? "—"}</div>
        </div>
      </div>
    `;
  }).join("");
}

// ==================== FOOD ITEM CRUD ====================

function openFoodItemModal(itemId = null) {
  editingItemId = itemId;

  const modal = $("foodItemModal");
  const title = $("foodItemModalTitle");
  const form = $("foodItemForm");
  if (!modal) return;

  if (itemId) {
    const item = foodItems.find(i => i.id === itemId);
    if (!item) return;

    if (title) title.textContent = "EDIT FOOD ITEM";
    if ($("foodItemId")) $("foodItemId").value = itemId;
    if ($("foodItemName")) $("foodItemName").value = item.name || "";
    if ($("foodItemPrice")) $("foodItemPrice").value = item.price ?? "";
    if ($("foodItemStock")) $("foodItemStock").value = item.stock != null ? item.stock : "";
    if ($("foodItemCategory")) $("foodItemCategory").value = item.category || "snacks";
    if ($("foodItemAvailable")) $("foodItemAvailable").checked = item.available !== false;
    if ($("foodItemCost")) $("foodItemCost").value = item.cost != null ? item.cost : "";
  } else {
    if (title) title.textContent = "ADD FOOD ITEM";
    form?.reset();
    if ($("foodItemId")) $("foodItemId").value = "";
    if ($("foodItemAvailable")) $("foodItemAvailable").checked = true;
    if ($("foodItemCost")) $("foodItemCost").value = "";
  }

  modal.classList.remove("hidden");
}

function closeFoodItemModal() {
  editingItemId = null;
  $("foodItemModal")?.classList.add("hidden");
}

async function saveFoodItem(e) {
  e.preventDefault();
  if (!canEditData()) {
    toast("View-only access", "error");
    return;
  }

  const name = ($("foodItemName")?.value || "").trim();
  const price = parseFloat($("foodItemPrice")?.value) || 0;
  const stockRaw = $("foodItemStock")?.value;
  const category = $("foodItemCategory")?.value || "snacks";
  const available = $("foodItemAvailable")?.checked !== false;
  const costRaw = $("foodItemCost")?.value;

  if (!name || price <= 0) {
    toast("Enter a valid name and price", "error");
    return;
  }

  let cost = null;
  if (costRaw !== undefined && costRaw !== null && String(costRaw).trim() !== "") {
    const parsed = parseFloat(costRaw);
    cost = Number.isFinite(parsed) ? parsed : null;
  }

  const itemData = {
    name,
    price,
    category,
    available,
    stock: stockRaw !== undefined && String(stockRaw).trim() !== "" ? parseInt(stockRaw, 10) : null,
    cost,
    updatedAt: Date.now()
  };

  try {
    if (editingItemId) {
      await update(ref(db, `${FB_PATHS.FOOD_MENU}/${editingItemId}`), itemData);
      toast("Item updated");
    } else {
      itemData.createdAt = Date.now();
      const newRef = push(ref(db, FB_PATHS.FOOD_MENU));
      await set(newRef, itemData);
      toast("Item created");
    }
    closeFoodItemModal();
  } catch (error) {
    console.error("[CafeManager] Save error:", error);
    toast("Failed to save: " + (error.message || error), "error");
  }
}

function openFoodDeleteModal(itemId) {
  if (!canEditData()) {
    toast("View-only access", "error");
    return;
  }
  deletingItemId = itemId;
  $("foodDeleteModal")?.classList.remove("hidden");
}

function closeFoodDeleteModal() {
  deletingItemId = null;
  $("foodDeleteModal")?.classList.add("hidden");
}

async function confirmFoodDelete() {
  if (!deletingItemId) return;
  if (!canEditData()) {
    toast("View-only access", "error");
    return;
  }
  try {
    await remove(ref(db, `${FB_PATHS.FOOD_MENU}/${deletingItemId}`));
    toast("Item deleted");
    closeFoodDeleteModal();
  } catch (error) {
    console.error("[CafeManager] Delete error:", error);
    toast("Failed to delete: " + (error.message || error), "error");
  }
}

// ==================== PURCHASE FLOW ====================

function openStockPurchaseModal() {
  if (!canEditData()) {
    toast("View-only access", "error");
    return;
  }
  if ($("stockPurchaseDate")) $("stockPurchaseDate").value = todayISO();
  if ($("stockPurchaseVendor")) $("stockPurchaseVendor").value = "";
  if ($("stockPurchaseNote")) $("stockPurchaseNote").value = "";
  if ($("stockPurchaseCash")) $("stockPurchaseCash").value = "";
  if ($("stockPurchaseOnline")) $("stockPurchaseOnline").value = "";
  if ($("stockPurchaseLines")) $("stockPurchaseLines").innerHTML = "";
  purchaseLineCount = 0;
  addStockPurchaseLine();
  addStockPurchaseLine();
  syncStockPurchasePay();
  $("stockPurchaseModal")?.classList.remove("hidden");
}

function closeStockPurchaseModal() {
  $("stockPurchaseModal")?.classList.add("hidden");
}

function addStockPurchaseLine() {
  const wrap = $("stockPurchaseLines");
  if (!wrap) return;
  const idx = purchaseLineCount++;
  const opts = foodItems.map(i =>
    `<option value="${i.id}">${escapeHtml(i.name)} ${i.stock != null ? `(${i.stock})` : "(∞)"}</option>`
  ).join("");
  const row = document.createElement("div");
  row.className = "stock-line-row grid grid-cols-12 gap-2 items-end";
  row.dataset.line = String(idx);
  row.innerHTML = `
    <div class="col-span-5">
      <select class="neon-input w-full px-2 py-1.5 rounded text-xs stock-line-item" required>
        <option value="">Item…</option>
        ${opts}
      </select>
    </div>
    <div class="col-span-2">
      <input type="number" min="1" value="1" class="neon-input w-full px-2 py-1.5 rounded text-xs stock-line-qty" placeholder="Qty" required oninput="recalcStockPurchaseLines()">
    </div>
    <div class="col-span-3">
      <input type="number" min="0" step="0.01" class="neon-input w-full px-2 py-1.5 rounded text-xs stock-line-cost" placeholder="Unit ₹" required oninput="recalcStockPurchaseLines()">
    </div>
    <div class="col-span-2">
      <button type="button" class="w-full py-1.5 rounded text-xs border border-gray-700 text-gray-500" onclick="this.closest('.stock-line-row').remove(); recalcStockPurchaseLines();">✕</button>
    </div>
  `;
  wrap.appendChild(row);
}

function recalcStockPurchaseLines() {
  let total = 0;
  document.querySelectorAll("#stockPurchaseLines .stock-line-row").forEach(row => {
    const qty = parseFloat(row.querySelector(".stock-line-qty")?.value) || 0;
    const cost = parseFloat(row.querySelector(".stock-line-cost")?.value) || 0;
    total += qty * cost;
  });
  const el = $("stockPurchaseLinesTotal");
  if (el) el.textContent = formatMoney(total);

  const cash = $("stockPurchaseCash");
  const online = $("stockPurchaseOnline");
  if (cash && online && !cash.value && !online.value && total > 0) {
    cash.placeholder = String(Math.round(total));
  }
}

function syncStockPurchasePay() {
  // visual only — validation on save
}

function collectPurchaseLines() {
  const lines = [];
  document.querySelectorAll("#stockPurchaseLines .stock-line-row").forEach(row => {
    const menuItemId = row.querySelector(".stock-line-item")?.value;
    const qty = parseInt(row.querySelector(".stock-line-qty")?.value, 10) || 0;
    const unitCost = parseFloat(row.querySelector(".stock-line-cost")?.value) || 0;
    if (!menuItemId || qty <= 0) return;
    const item = foodItems.find(i => i.id === menuItemId);
    lines.push({
      menuItemId,
      name: item?.name || menuItemId,
      qty,
      unitCost,
      lineTotal: Math.round(qty * unitCost * 100) / 100
    });
  });
  return lines;
}

async function saveStockPurchase(e) {
  e.preventDefault();
  if (!canEditData()) {
    toast("View-only access", "error");
    return;
  }

  const date = $("stockPurchaseDate")?.value;
  const vendor = ($("stockPurchaseVendor")?.value || "").trim();
  const note = ($("stockPurchaseNote")?.value || "").trim();
  let cash = parseFloat($("stockPurchaseCash")?.value) || 0;
  let online = parseFloat($("stockPurchaseOnline")?.value) || 0;
  const items = collectPurchaseLines();

  if (!date || !items.length) {
    toast("Add date and at least one line", "error");
    return;
  }

  const linesTotal = items.reduce((s, i) => s + i.lineTotal, 0);
  if (cash + online <= 0) {
    cash = linesTotal;
    online = 0;
  }
  const amount = cash + online;
  if (Math.abs(amount - linesTotal) > 1) {
    const ok = confirm(`Payment ${formatMoney(amount)} differs from lines ${formatMoney(linesTotal)}. Continue?`);
    if (!ok) return;
  }

  const btn = $("stockPurchaseSaveBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    const purchaseRef = push(ref(db, `${FB_PATHS.FOOD_PURCHASES}/${date}`));
    const purchaseId = purchaseRef.key;
    const expenseRef = push(ref(db, `${FB_PATHS.EXPENSES}/${date}`));
    const expenseId = expenseRef.key;
    const admin = staffLabel();
    const now = new Date().toISOString();

    const expenseData = {
      category: "food_purchase",
      amount,
      cash,
      online,
      description: note || `Stock purchase${vendor ? ` · ${vendor}` : ""} (${items.length} lines)`,
      vendor,
      purchaseId,
      admin,
      createdAt: now,
      updatedAt: now
    };

    const purchaseData = {
      vendor,
      note,
      cash,
      online,
      amount,
      items,
      expenseId,
      expenseDate: date,
      admin,
      createdAt: now,
      updatedAt: now
    };

    await set(expenseRef, expenseData);
    await set(purchaseRef, purchaseData);

    for (const line of items) {
      const stockPath = `${FB_PATHS.FOOD_MENU}/${line.menuItemId}/stock`;
      let stockAfter = line.qty;
      await runTransaction(ref(db, stockPath), (current) => {
        const base = current === null || current === undefined ? 0 : Number(current) || 0;
        stockAfter = base + line.qty;
        return stockAfter;
      });

      // Update last purchase cost + timestamp
      await update(ref(db, `${FB_PATHS.FOOD_MENU}/${line.menuItemId}`), {
        cost: line.unitCost,
        updatedAt: Date.now()
      });

      const logRef = push(ref(db, `${FB_PATHS.FOOD_STOCK_LOG}/${date}`));
      await set(logRef, {
        menuItemId: line.menuItemId,
        itemName: line.name,
        delta: line.qty,
        reason: "purchase",
        refType: "food_purchases",
        refId: purchaseId,
        stockAfter,
        note: vendor || note || "",
        admin,
        timestamp: now
      });
    }

    toast("Purchase saved · expense + stock updated");
    closeStockPurchaseModal();
    await refreshPurchasesAndLogs();
  } catch (err) {
    console.error(err);
    toast("Failed: " + (err.message || err), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save purchase"; }
  }
}

// ==================== ADJUST ====================

function openStockAdjustModal(preselectId = null) {
  if (!canEditData()) {
    toast("View-only access", "error");
    return;
  }
  const sel = $("stockAdjustItem");
  if (sel) {
    sel.innerHTML = foodItems.map(i =>
      `<option value="${i.id}">${escapeHtml(i.name)} — ${i.stock != null ? i.stock : "∞"}</option>`
    ).join("");
    if (preselectId) sel.value = preselectId;
  }
  if ($("stockAdjustDelta")) $("stockAdjustDelta").value = "";
  if ($("stockAdjustNote")) $("stockAdjustNote").value = "";
  if ($("stockAdjustReason")) $("stockAdjustReason").value = "adjust";
  $("stockAdjustModal")?.classList.remove("hidden");
}

function closeStockAdjustModal() {
  $("stockAdjustModal")?.classList.add("hidden");
}

function quickAdjustFromRow(id) {
  openStockAdjustModal(id);
}

async function saveStockAdjust(e) {
  e.preventDefault();
  if (!canEditData()) {
    toast("View-only access", "error");
    return;
  }
  const menuItemId = $("stockAdjustItem")?.value;
  const delta = parseInt($("stockAdjustDelta")?.value, 10);
  const reason = $("stockAdjustReason")?.value || "adjust";
  const note = ($("stockAdjustNote")?.value || "").trim();
  if (!menuItemId || !Number.isFinite(delta) || delta === 0) {
    toast("Enter a non-zero delta", "error");
    return;
  }
  const item = foodItems.find(i => i.id === menuItemId);
  const date = todayISO();
  const admin = staffLabel();
  const now = new Date().toISOString();

  try {
    let stockAfter = delta;
    await runTransaction(ref(db, `${FB_PATHS.FOOD_MENU}/${menuItemId}/stock`), (current) => {
      const base = current === null || current === undefined ? 0 : Number(current) || 0;
      stockAfter = Math.max(0, base + delta);
      return stockAfter;
    });
    await update(ref(db, `${FB_PATHS.FOOD_MENU}/${menuItemId}`), { updatedAt: Date.now() });
    const logRef = push(ref(db, `${FB_PATHS.FOOD_STOCK_LOG}/${date}`));
    await set(logRef, {
      menuItemId,
      itemName: item?.name || menuItemId,
      delta,
      reason,
      refType: "adjust",
      refId: null,
      stockAfter,
      note,
      admin,
      timestamp: now
    });
    toast("Stock adjusted");
    closeStockAdjustModal();
    await refreshPurchasesAndLogs();
  } catch (err) {
    console.error(err);
    toast("Adjust failed: " + (err.message || err), "error");
  }
}

// ==================== WINDOW / EXPORTS ====================

window.openFoodItemModal = openFoodItemModal;
window.closeFoodItemModal = closeFoodItemModal;
window.saveFoodItem = saveFoodItem;
window.editFoodItem = (id) => openFoodItemModal(id);
window.openFoodDeleteModal = openFoodDeleteModal;
window.closeFoodDeleteModal = closeFoodDeleteModal;
window.confirmFoodDelete = confirmFoodDelete;

window.openStockPurchaseModal = openStockPurchaseModal;
window.closeStockPurchaseModal = closeStockPurchaseModal;
window.addStockPurchaseLine = addStockPurchaseLine;
window.recalcStockPurchaseLines = recalcStockPurchaseLines;
window.syncStockPurchasePay = syncStockPurchasePay;
window.saveStockPurchase = saveStockPurchase;
window.openStockAdjustModal = openStockAdjustModal;
window.closeStockAdjustModal = closeStockAdjustModal;
window.quickAdjustFromRow = quickAdjustFromRow;
window.saveStockAdjust = saveStockAdjust;

window.initCafeManager = initCafeManager;

export {
  initCafeManager,
  foodItems,
  escapeHtml,
  formatMoney,
  toast
};
