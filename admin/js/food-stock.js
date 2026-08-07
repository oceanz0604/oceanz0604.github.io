/**
 * OceanZ Gaming Cafe - Food Stock Management
 * Inventory board, purchases → expenses, stock adjustments/log.
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, get, set, update, push, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  BOOKING_DB_CONFIG, BOOKING_APP_NAME, FB_PATHS, getISTDate
} from "../../shared/config.js";
import { getStaffSession, canEditData } from "./permissions.js";

const STOCK_APP = "OCEANZ_FOOD_STOCK";
const LOW_STOCK_THRESHOLD = 5;

let app = getApps().find(a => a.name === STOCK_APP);
if (!app) app = initializeApp(BOOKING_DB_CONFIG, STOCK_APP);
const db = getDatabase(app);

const $ = id => document.getElementById(id);

let menuItems = [];
let purchases = [];
let stockLogs = [];
let currentTab = "inventory";
let inventoryFilter = "all";
let searchQuery = "";
let purchaseLineCount = 0;

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

export async function initFoodStock() {
  if (!canEditData()) {
    const btn = $("stockPurchaseBtn");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.title = "View-only";
    }
  }
  await refreshStockData();
  if (window.lucide) window.lucide.createIcons();
}

async function refreshStockData() {
  await Promise.all([loadMenu(), loadPurchases(), loadStockLogs()]);
  updateKpis();
  renderActiveTab();
}

async function loadMenu() {
  const snap = await get(ref(db, FB_PATHS.FOOD_MENU));
  menuItems = [];
  if (snap.exists()) {
    snap.forEach(child => menuItems.push({ id: child.key, ...child.val() }));
  }
  menuItems.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
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
  purchases.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
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
  stockLogs.sort((a, b) => String(b.timestamp || b.date).localeCompare(String(a.timestamp || a.date)));
}

function updateKpis() {
  const tracked = menuItems.filter(i => i.stock !== null && i.stock !== undefined);
  const low = tracked.filter(i => Number(i.stock) <= LOW_STOCK_THRESHOLD);
  const units = tracked.reduce((s, i) => s + (Number(i.stock) || 0), 0);
  const from30 = daysAgoISO(30);
  const purchSum = purchases
    .filter(p => p.date >= from30)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("stockStatSkus", String(tracked.length));
  set("stockStatLow", String(low.length));
  set("stockStatUnits", units.toLocaleString("en-IN"));
  set("stockStatPurchases", formatMoney(purchSum));

  const alert = $("stockLowAlert");
  if (alert) {
    if (low.length) {
      alert.classList.remove("hidden");
      alert.textContent = `Low stock: ${low.slice(0, 6).map(i => `${i.name} (${i.stock})`).join(" · ")}${low.length > 6 ? "…" : ""}`;
    } else {
      alert.classList.add("hidden");
    }
  }
}

window.setStockTab = function(tab) {
  currentTab = tab;
  document.querySelectorAll(".stock-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  $("stockInventoryPanel")?.classList.toggle("hidden", tab !== "inventory");
  $("stockPurchasesPanel")?.classList.toggle("hidden", tab !== "purchases");
  $("stockLogPanel")?.classList.toggle("hidden", tab !== "log");
  renderActiveTab();
};

window.filterStockInventory = function() {
  searchQuery = $("stockSearch")?.value || "";
  inventoryFilter = $("stockFilter")?.value || "all";
  renderInventory();
};

function renderActiveTab() {
  if (currentTab === "inventory") renderInventory();
  else if (currentTab === "purchases") renderPurchases();
  else renderLog();
}

function renderInventory() {
  const list = $("stockInventoryList");
  if (!list) return;
  const q = searchQuery.trim().toLowerCase();

  let rows = [...menuItems];
  if (inventoryFilter === "low") {
    rows = rows.filter(i => i.stock !== null && i.stock !== undefined && Number(i.stock) > 0 && Number(i.stock) <= LOW_STOCK_THRESHOLD);
  } else if (inventoryFilter === "out") {
    rows = rows.filter(i => i.stock !== null && i.stock !== undefined && Number(i.stock) <= 0);
  } else if (inventoryFilter === "untracked") {
    rows = rows.filter(i => i.stock === null || i.stock === undefined);
  } else {
    rows = rows.filter(i => i.stock !== null && i.stock !== undefined);
  }
  if (q) rows = rows.filter(i => String(i.name || "").toLowerCase().includes(q));

  if (!rows.length) {
    list.innerHTML = `<div class="text-center py-10 text-gray-500 text-sm">No matching items</div>`;
    return;
  }

  list.innerHTML = rows.map(item => {
    const stock = item.stock;
    const tracked = stock !== null && stock !== undefined;
    const n = Number(stock) || 0;
    let badge = tracked
      ? (n <= 0
        ? `<span class="stock-badge-pill out">OUT</span>`
        : n <= LOW_STOCK_THRESHOLD
          ? `<span class="stock-badge-pill low">LOW</span>`
          : `<span class="stock-badge-pill ok">OK</span>`)
      : `<span class="stock-badge-pill muted">∞</span>`;
    const color = !tracked ? "#888" : n <= 0 ? "#ff0044" : n <= LOW_STOCK_THRESHOLD ? "#ff6b00" : "#00ff88";
    return `
      <div class="stock-row">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-orbitron text-sm text-white truncate">${escapeHtml(item.name)}</span>
            ${badge}
          </div>
          <div class="text-[10px] text-gray-500 mt-0.5">${escapeHtml(item.category || "—")} · sell ${formatMoney(item.price)}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="font-orbitron text-lg" style="color:${color};">${tracked ? n : "∞"}</div>
          <button type="button" class="text-[10px] text-gray-500 hover:text-cyan-400" onclick="quickAdjustFromRow('${item.id}')">Adjust</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderPurchases() {
  const list = $("stockPurchasesList");
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
  const list = $("stockLogList");
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

// ==================== PURCHASE FLOW ====================

window.openStockPurchaseModal = function() {
  if (!canEditData()) {
    toast("View-only access", "error");
    return;
  }
  $("stockPurchaseDate").value = todayISO();
  $("stockPurchaseVendor").value = "";
  $("stockPurchaseNote").value = "";
  $("stockPurchaseCash").value = "";
  $("stockPurchaseOnline").value = "";
  $("stockPurchaseLines").innerHTML = "";
  purchaseLineCount = 0;
  addStockPurchaseLine();
  addStockPurchaseLine();
  syncStockPurchasePay();
  $("stockPurchaseModal").classList.remove("hidden");
};

window.closeStockPurchaseModal = function() {
  $("stockPurchaseModal")?.classList.add("hidden");
};

window.addStockPurchaseLine = function() {
  const wrap = $("stockPurchaseLines");
  if (!wrap) return;
  const idx = purchaseLineCount++;
  const opts = menuItems.map(i =>
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
};

window.recalcStockPurchaseLines = function() {
  let total = 0;
  document.querySelectorAll("#stockPurchaseLines .stock-line-row").forEach(row => {
    const qty = parseFloat(row.querySelector(".stock-line-qty")?.value) || 0;
    const cost = parseFloat(row.querySelector(".stock-line-cost")?.value) || 0;
    total += qty * cost;
  });
  const el = $("stockPurchaseLinesTotal");
  if (el) el.textContent = formatMoney(total);

  // If pay fields empty, suggest filling cash with line total
  const cash = $("stockPurchaseCash");
  const online = $("stockPurchaseOnline");
  if (cash && online && !cash.value && !online.value && total > 0) {
    cash.placeholder = String(Math.round(total));
  }
};

window.syncStockPurchasePay = function() {
  // visual only — validation on save
};

function collectPurchaseLines() {
  const lines = [];
  document.querySelectorAll("#stockPurchaseLines .stock-line-row").forEach(row => {
    const menuItemId = row.querySelector(".stock-line-item")?.value;
    const qty = parseInt(row.querySelector(".stock-line-qty")?.value, 10) || 0;
    const unitCost = parseFloat(row.querySelector(".stock-line-cost")?.value) || 0;
    if (!menuItemId || qty <= 0) return;
    const item = menuItems.find(i => i.id === menuItemId);
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

window.saveStockPurchase = async function(e) {
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

    // Increment stock + write logs
    for (const line of items) {
      const stockPath = `${FB_PATHS.FOOD_MENU}/${line.menuItemId}/stock`;
      let stockAfter = line.qty;
      await runTransaction(ref(db, stockPath), (current) => {
        const base = current === null || current === undefined ? 0 : Number(current) || 0;
        stockAfter = base + line.qty;
        return stockAfter;
      });
      // Also mark as available if was out
      await update(ref(db, `${FB_PATHS.FOOD_MENU}/${line.menuItemId}`), {
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
    await refreshStockData();
  } catch (err) {
    console.error(err);
    toast("Failed: " + (err.message || err), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save purchase"; }
  }
};

// ==================== ADJUST ====================

window.openStockAdjustModal = function(preselectId = null) {
  if (!canEditData()) {
    toast("View-only access", "error");
    return;
  }
  const sel = $("stockAdjustItem");
  if (sel) {
    sel.innerHTML = menuItems.map(i =>
      `<option value="${i.id}">${escapeHtml(i.name)} — ${i.stock != null ? i.stock : "∞"}</option>`
    ).join("");
    if (preselectId) sel.value = preselectId;
  }
  $("stockAdjustDelta").value = "";
  $("stockAdjustNote").value = "";
  $("stockAdjustReason").value = "adjust";
  $("stockAdjustModal").classList.remove("hidden");
};

window.closeStockAdjustModal = function() {
  $("stockAdjustModal")?.classList.add("hidden");
};

window.quickAdjustFromRow = function(id) {
  openStockAdjustModal(id);
};

window.saveStockAdjust = async function(e) {
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
  const item = menuItems.find(i => i.id === menuItemId);
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
    await refreshStockData();
  } catch (err) {
    console.error(err);
    toast("Adjust failed: " + (err.message || err), "error");
  }
};

window.initFoodStock = initFoodStock;
