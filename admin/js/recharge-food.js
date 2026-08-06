/**
 * OceanZ Gaming Cafe - Food / Snacks on Recharges Page
 *
 * Allows logging food sales against a member or PC from the recharges screen.
 * Writes to the same food_sales / food_credits paths as Counter POS.
 */

import {
  BOOKING_DB_CONFIG,
  FDB_DATASET_CONFIG,
  BOOKING_APP_NAME,
  FDB_APP_NAME,
  FB_PATHS,
  CONSTANTS,
  SharedCache,
  getISTDate
} from "../../shared/config.js";
import { getStaffSession, canEditData } from "./permissions.js";
import {
  FOOD_CUSTOMER_TYPES,
  FOOD_SALE_SOURCES,
  buildFoodSalePayload,
  foodCreditKey,
  normalizeFoodSale,
  getSaleCollectedAmounts
} from "../../shared/food-stats.js";

// ==================== FIREBASE ====================

function waitForFirebase(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (typeof firebase !== "undefined" && firebase.apps) {
      resolve();
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      if (typeof firebase !== "undefined" && firebase.apps) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject(new Error("Firebase SDK not loaded"));
      }
    }, 100);
  });
}

let bookingDb = null;
let fdbDb = null;
let firebaseReady = false;

async function initFoodFirebase() {
  if (firebaseReady && bookingDb) return true;
  try {
    await waitForFirebase();
    let bookingApp = firebase.apps.find(a => a.name === BOOKING_APP_NAME);
    if (!bookingApp) bookingApp = firebase.initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);
    let fdbApp = firebase.apps.find(a => a.name === FDB_APP_NAME);
    if (!fdbApp) fdbApp = firebase.initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);
    bookingDb = bookingApp.database();
    fdbDb = fdbApp.database();
    firebaseReady = true;
    return true;
  } catch (err) {
    console.error("❌ RechargeFood: Firebase init failed", err);
    return false;
  }
}

// ==================== STATE ====================

const $ = id => document.getElementById(id);

let foodMenu = [];
let foodCart = [];
let foodPaymentMode = "cash";
let foodCustomerType = FOOD_CUSTOMER_TYPES.MEMBER; // member | pc
let selectedMemberName = "";
let selectedPcName = "";
let dayFoodSales = [];
let foodSalesListener = null;
let currentFoodDate = null;

function getTodayISTString() {
  const now = getISTDate();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getSelectedRechargeDate() {
  return $("datePicker")?.value || getTodayISTString();
}

function toast(type, message) {
  if (type === "success" && typeof notifySuccess === "function") return notifySuccess(message);
  if (type === "error" && typeof notifyError === "function") return notifyError(message);
  if (type === "warning" && typeof notifyWarning === "function") return notifyWarning(message);
  alert(message);
}

// ==================== INIT ====================

export async function initRechargeFood() {
  await initFoodFirebase();
  initFoodGuestTerminalDropdown();
  setupFoodMemberAutocomplete();
  bindDatePickerHook();
  await loadFoodMenuItems();
  await loadDayFoodSales(getSelectedRechargeDate());
  console.log("✅ RechargeFood: initialized");
}

function bindDatePickerHook() {
  const picker = $("datePicker");
  if (!picker || picker.dataset.foodHooked === "1") return;
  picker.dataset.foodHooked = "1";
  picker.addEventListener("change", () => {
    loadDayFoodSales(picker.value);
  });
}

function initFoodGuestTerminalDropdown() {
  const select = $("foodGuestTerminalSelect");
  if (!select) return;
  const options = CONSTANTS.GUEST_TERMINALS.map(
    t => `<option value="${t}">${t}</option>`
  ).join("");
  select.innerHTML = `<option value="">PC / Guest ▾</option>${options}`;
}

// ==================== MENU ====================

async function loadFoodMenuItems() {
  const ready = await initFoodFirebase();
  if (!ready) return;

  try {
    const snap = await bookingDb.ref(FB_PATHS.FOOD_MENU).once("value");
    const data = snap.val() || {};
    foodMenu = Object.entries(data)
      .map(([id, item]) => ({ id, ...item }))
      .filter(item => item.available !== false)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderFoodMenuPicker();
  } catch (err) {
    console.error("❌ RechargeFood: menu load failed", err);
    foodMenu = [];
  }
}

function renderFoodMenuPicker() {
  const container = $("foodRechargeMenuGrid");
  if (!container) return;

  if (foodMenu.length === 0) {
    container.innerHTML = `<div class="text-center text-gray-500 text-sm py-4 col-span-full">No menu items. Add items in Food Menu first.</div>`;
    return;
  }

  container.innerHTML = foodMenu.map(item => {
    const stockLabel = item.stock === null || item.stock === undefined
      ? ""
      : `<span class="text-[10px] text-gray-500">(${item.stock} left)</span>`;
    const disabled = item.stock !== null && item.stock !== undefined && item.stock <= 0;
    return `
      <button type="button" ${disabled ? "disabled" : ""} onclick="addFoodRechargeItem('${item.id}')"
        class="p-2 rounded-lg text-left transition-all ${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-gray-800"}"
        style="border: 1px solid rgba(255,107,0,0.25); background: rgba(0,0,0,0.25);">
        <div class="text-sm text-white truncate">${item.name}</div>
        <div class="flex items-center justify-between mt-1">
          <span class="font-orbitron text-xs" style="color: var(--neon-orange);">₹${item.price || 0}</span>
          ${stockLabel}
        </div>
      </button>
    `;
  }).join("");
}

// ==================== CUSTOMER ====================

function setupFoodMemberAutocomplete() {
  const input = $("foodMemberInput");
  const box = $("foodMemberSuggestions");
  if (!input || !box) return;

  let timer = null;
  input.addEventListener("input", () => {
    selectedMemberName = input.value.trim();
    foodCustomerType = FOOD_CUSTOMER_TYPES.MEMBER;
    selectedPcName = "";
    const pcSelect = $("foodGuestTerminalSelect");
    if (pcSelect) pcSelect.value = "";

    clearTimeout(timer);
    timer = setTimeout(() => showFoodMemberSuggestions(input.value.trim()), 150);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim().length >= 1) showFoodMemberSuggestions(input.value.trim());
  });

  document.addEventListener("click", (e) => {
    if (!box.contains(e.target) && e.target !== input) {
      box.classList.add("hidden");
    }
  });
}

async function showFoodMemberSuggestions(query) {
  const box = $("foodMemberSuggestions");
  if (!box) return;
  if (!query || query.length < 1) {
    box.classList.add("hidden");
    return;
  }

  try {
    await initFoodFirebase();
    const members = await SharedCache.getMembers(fdbDb, FB_PATHS.MEMBERS);
    const q = query.toLowerCase();
    const matches = members
      .filter(m => {
        const name = (m.DISPLAY_NAME || m.USERNAME || "").toLowerCase();
        const user = (m.USERNAME || "").toLowerCase();
        return name.includes(q) || user.includes(q);
      })
      .slice(0, 8);

    if (matches.length === 0) {
      box.classList.add("hidden");
      return;
    }

    box.innerHTML = matches.map(m => {
      const label = m.DISPLAY_NAME || m.USERNAME;
      return `<div class="px-3 py-2 hover:bg-gray-800 cursor-pointer text-sm" onclick="selectFoodRechargeMember('${escapeJs(label)}')">${label}</div>`;
    }).join("");
    box.classList.remove("hidden");
  } catch (err) {
    console.warn("Food member search failed", err);
  }
}

function escapeJs(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

window.selectFoodRechargeMember = function(name) {
  selectedMemberName = name;
  selectedPcName = "";
  foodCustomerType = FOOD_CUSTOMER_TYPES.MEMBER;
  const input = $("foodMemberInput");
  if (input) input.value = name;
  const pcSelect = $("foodGuestTerminalSelect");
  if (pcSelect) pcSelect.value = "";
  $("foodMemberSuggestions")?.classList.add("hidden");
  updateFoodCustomerBadge();
};

window.selectFoodRechargeTerminal = function(selectEl) {
  const value = selectEl?.value || "";
  if (!value) {
    selectedPcName = "";
    return;
  }
  selectedPcName = value;
  selectedMemberName = "";
  foodCustomerType = FOOD_CUSTOMER_TYPES.PC;
  const input = $("foodMemberInput");
  if (input) input.value = value;
  $("foodMemberSuggestions")?.classList.add("hidden");
  updateFoodCustomerBadge();
};

function updateFoodCustomerBadge() {
  const badge = $("foodCustomerTypeBadge");
  if (!badge) return;
  if (foodCustomerType === FOOD_CUSTOMER_TYPES.PC) {
    badge.textContent = "PC / Guest";
    badge.style.color = "var(--neon-cyan)";
  } else {
    badge.textContent = "Member";
    badge.style.color = "var(--neon-green)";
  }
}

// ==================== CART ====================

window.addFoodRechargeItem = function(itemId) {
  const item = foodMenu.find(m => m.id === itemId);
  if (!item) return;

  if (item.stock !== null && item.stock !== undefined && item.stock <= 0) {
    toast("warning", "Out of stock");
    return;
  }

  const existing = foodCart.find(c => c.id === itemId);
  if (existing) {
    if (item.stock !== null && item.stock !== undefined && existing.qty >= item.stock) {
      toast("warning", "Not enough stock");
      return;
    }
    existing.qty += 1;
  } else {
    foodCart.push({
      id: item.id,
      name: item.name,
      price: Number(item.price) || 0,
      qty: 1
    });
  }
  renderFoodCart();
};

window.changeFoodRechargeQty = function(itemId, delta) {
  const existing = foodCart.find(c => c.id === itemId);
  if (!existing) return;
  existing.qty += delta;
  if (existing.qty <= 0) {
    foodCart = foodCart.filter(c => c.id !== itemId);
  }
  renderFoodCart();
};

window.removeFoodRechargeItem = function(itemId) {
  foodCart = foodCart.filter(c => c.id !== itemId);
  renderFoodCart();
};

function getFoodCartTotal() {
  return foodCart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function renderFoodCart() {
  const container = $("foodRechargeCart");
  const totalEl = $("foodRechargeTotal");
  if (!container) return;

  if (foodCart.length === 0) {
    container.innerHTML = `<div class="text-center text-gray-500 text-sm py-3">Cart is empty — tap items above</div>`;
  } else {
    container.innerHTML = foodCart.map(item => `
      <div class="flex items-center justify-between gap-2 py-2 border-b border-gray-800/60">
        <div class="min-w-0 flex-1">
          <div class="text-sm text-white truncate">${item.name}</div>
          <div class="text-xs text-gray-500">₹${item.price} × ${item.qty}</div>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" onclick="changeFoodRechargeQty('${item.id}', -1)" class="w-7 h-7 rounded bg-gray-800 text-gray-300">−</button>
          <span class="w-6 text-center text-sm font-orbitron">${item.qty}</span>
          <button type="button" onclick="changeFoodRechargeQty('${item.id}', 1)" class="w-7 h-7 rounded bg-gray-800 text-gray-300">+</button>
          <button type="button" onclick="removeFoodRechargeItem('${item.id}')" class="w-7 h-7 rounded text-red-400 ml-1">✕</button>
        </div>
        <div class="font-orbitron text-sm w-14 text-right" style="color: var(--neon-orange);">₹${item.price * item.qty}</div>
      </div>
    `).join("");
  }

  const total = getFoodCartTotal();
  if (totalEl) totalEl.textContent = `₹${total}`;
  updateFoodSplitRemaining();
}

window.setFoodRechargePaymentMode = function(mode) {
  foodPaymentMode = mode;
  document.querySelectorAll(".food-recharge-pay-btn").forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("active", active);
    btn.style.borderColor = active ? "var(--neon-orange)" : "#374151";
    btn.style.background = active ? "rgba(255,107,0,0.15)" : "transparent";
    btn.style.color = active ? "var(--neon-orange)" : "#9ca3af";
  });

  const splitBox = $("foodRechargeSplitFields");
  if (splitBox) splitBox.classList.toggle("hidden", mode !== "split");
  updateFoodSplitRemaining();
};

window.updateFoodRechargeSplit = function() {
  updateFoodSplitRemaining();
};

function updateFoodSplitRemaining() {
  const el = $("foodRechargeSplitRemaining");
  if (!el) return;
  const total = getFoodCartTotal();
  if (foodPaymentMode !== "split") {
    el.textContent = foodPaymentMode === "credit" ? "On credit" : `Total ₹${total}`;
    el.style.color = "var(--neon-orange)";
    return;
  }
  const cash = Number($("foodRechargeCash")?.value) || 0;
  const upi = Number($("foodRechargeUpi")?.value) || 0;
  const credit = Number($("foodRechargeCredit")?.value) || 0;
  const remaining = total - (cash + upi + credit);
  if (remaining === 0) {
    el.textContent = "Split OK";
    el.style.color = "var(--neon-green)";
  } else {
    el.textContent = `Remaining ₹${remaining}`;
    el.style.color = remaining > 0 ? "var(--neon-orange)" : "var(--neon-red)";
  }
}

// ==================== MODAL ====================

window.openAddFoodRechargeModal = async function() {
  if (!canEditData()) {
    toast("warning", "You have view-only access. Editing is not allowed.");
    return;
  }

  await loadFoodMenuItems();
  resetFoodForm();
  const modal = $("addFoodRechargeModal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
  setTimeout(() => $("foodMemberInput")?.focus(), 100);
};

window.closeAddFoodRechargeModal = function() {
  const modal = $("addFoodRechargeModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
  resetFoodForm();
};

function resetFoodForm() {
  foodCart = [];
  foodPaymentMode = "cash";
  foodCustomerType = FOOD_CUSTOMER_TYPES.MEMBER;
  selectedMemberName = "";
  selectedPcName = "";
  if ($("foodMemberInput")) $("foodMemberInput").value = "";
  if ($("foodGuestTerminalSelect")) $("foodGuestTerminalSelect").value = "";
  if ($("foodRechargeNote")) $("foodRechargeNote").value = "";
  if ($("foodRechargeCash")) $("foodRechargeCash").value = "";
  if ($("foodRechargeUpi")) $("foodRechargeUpi").value = "";
  if ($("foodRechargeCredit")) $("foodRechargeCredit").value = "";
  setFoodRechargePaymentMode("cash");
  renderFoodCart();
  updateFoodCustomerBadge();
}

window.saveFoodRechargeSale = async function() {
  if (!canEditData()) {
    toast("warning", "You have view-only access.");
    return;
  }

  const customerInput = ($("foodMemberInput")?.value || "").trim();
  if (!customerInput) {
    toast("warning", "Please select a member or PC name");
    return;
  }
  if (foodCart.length === 0) {
    toast("warning", "Add at least one food item");
    return;
  }

  const total = getFoodCartTotal();
  let cashAmount = 0;
  let upiAmount = 0;
  let creditAmount = 0;

  if (foodPaymentMode === "cash") {
    cashAmount = total;
  } else if (foodPaymentMode === "upi") {
    upiAmount = total;
  } else if (foodPaymentMode === "credit") {
    creditAmount = total;
  } else if (foodPaymentMode === "split") {
    cashAmount = Number($("foodRechargeCash")?.value) || 0;
    upiAmount = Number($("foodRechargeUpi")?.value) || 0;
    creditAmount = Number($("foodRechargeCredit")?.value) || 0;
    if (cashAmount + upiAmount + creditAmount !== total) {
      toast("warning", `Split (₹${cashAmount + upiAmount + creditAmount}) must equal total (₹${total})`);
      return;
    }
  }

  const isPc = foodCustomerType === FOOD_CUSTOMER_TYPES.PC ||
    CONSTANTS.GUEST_TERMINALS.includes(customerInput);
  const customerType = isPc ? FOOD_CUSTOMER_TYPES.PC : FOOD_CUSTOMER_TYPES.MEMBER;
  const session = getStaffSession();
  const saleDate = getSelectedRechargeDate();

  const saleData = buildFoodSalePayload({
    customerName: customerInput,
    customerType,
    memberId: customerType === FOOD_CUSTOMER_TYPES.MEMBER ? customerInput : null,
    memberName: customerType === FOOD_CUSTOMER_TYPES.MEMBER ? customerInput : null,
    pcName: customerType === FOOD_CUSTOMER_TYPES.PC ? customerInput : null,
    source: FOOD_SALE_SOURCES.RECHARGES,
    items: foodCart,
    total,
    paymentMode: foodPaymentMode === "split" && creditAmount > 0 && cashAmount + upiAmount + creditAmount === total
      ? (creditAmount === total ? "credit" : "split")
      : foodPaymentMode,
    cashAmount,
    upiAmount,
    creditAmount,
    staffId: session?.id || "unknown",
    staffName: session?.name || session?.email || "Admin",
    note: ($("foodRechargeNote")?.value || "").trim(),
    timestamp: Date.now()
  });

  // If split includes credit, keep paymentMode as split
  if (foodPaymentMode === "split") {
    saleData.paymentMode = "split";
    saleData.cashAmount = cashAmount;
    saleData.upiAmount = upiAmount;
    if (creditAmount > 0) saleData.creditAmount = creditAmount;
  }

  try {
    const ready = await initFoodFirebase();
    if (!ready) throw new Error("Database not ready");

    const saleRef = bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${saleDate}`).push();
    await saleRef.set(saleData);

    // Credit ledger (only when credit portion exists)
    const creditPart = saleData.paymentMode === "credit"
      ? total
      : (saleData.creditAmount || 0);

    if (creditPart > 0) {
      const key = foodCreditKey(customerInput);
      const creditRef = bookingDb.ref(`${FB_PATHS.FOOD_CREDITS}/${key}`);
      const creditSnap = await creditRef.once("value");
      const existing = creditSnap.val() || { outstanding: 0 };
      await creditRef.update({
        customerName: customerInput,
        customerType,
        memberId: saleData.memberId,
        pcName: saleData.pcName,
        outstanding: (existing.outstanding || 0) + creditPart,
        lastUpdated: Date.now()
      });
    }

    // Stock updates
    for (const item of foodCart) {
      const menuItem = foodMenu.find(m => m.id === item.id);
      if (menuItem && menuItem.stock !== null && menuItem.stock !== undefined) {
        const newStock = Math.max(0, Number(menuItem.stock) - item.qty);
        await bookingDb.ref(`${FB_PATHS.FOOD_MENU}/${item.id}/stock`).set(newStock);
      }
    }

    SharedCache.invalidateFoodSales();
    toast("success", `Food sale saved: ₹${total}`);
    closeAddFoodRechargeModal();
    await loadFoodMenuItems();
    await loadDayFoodSales(saleDate);
  } catch (err) {
    console.error("❌ RechargeFood: save failed", err);
    toast("error", "Failed to save food sale: " + err.message);
  }
};

// ==================== DAY LIST ====================

async function loadDayFoodSales(dateStr) {
  const ready = await initFoodFirebase();
  if (!ready || !bookingDb) return;

  currentFoodDate = dateStr;

  if (foodSalesListener) {
    foodSalesListener.off();
    foodSalesListener = null;
  }

  const ref = bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${dateStr}`);
  foodSalesListener = ref;
  ref.on("value", snap => {
    const data = snap.val() || {};
    dayFoodSales = Object.entries(data).map(([id, sale]) =>
      normalizeFoodSale({ id, date: dateStr, ...sale })
    ).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    renderDayFoodSales();
  }, err => {
    console.error("❌ RechargeFood: day listen failed", err);
    dayFoodSales = [];
    renderDayFoodSales();
  });
}

function renderDayFoodSales() {
  const listEl = $("foodRechargeList");
  const emptyEl = $("foodRechargeEmptyState");
  const countEl = $("foodRechargeCount");
  const totalEl = $("foodDayTotal");
  const cashEl = $("foodDayCash");
  const upiEl = $("foodDayUpi");
  const creditEl = $("foodDayCredit");

  let cash = 0, upi = 0, credit = 0, total = 0;
  dayFoodSales.forEach(sale => {
    const amounts = getSaleCollectedAmounts(sale);
    cash += amounts.cash;
    upi += amounts.upi;
    credit += amounts.credit;
    total += amounts.total;
  });

  if (countEl) countEl.textContent = String(dayFoodSales.length);
  if (totalEl) totalEl.textContent = `₹${total}`;
  if (cashEl) cashEl.textContent = `₹${cash}`;
  if (upiEl) upiEl.textContent = `₹${upi}`;
  if (creditEl) creditEl.textContent = `₹${credit}`;

  if (!listEl) return;

  if (dayFoodSales.length === 0) {
    listEl.innerHTML = "";
    emptyEl?.classList.remove("hidden");
    return;
  }

  emptyEl?.classList.add("hidden");

  const query = ($("foodRechargeSearch")?.value || "").trim().toLowerCase();
  const filtered = query
    ? dayFoodSales.filter(s => {
        const hay = [
          s.customerName,
          s.memberName,
          s.pcName,
          s.note,
          s.staffName,
          ...(s.items || []).map(i => i.name)
        ].join(" ").toLowerCase();
        return hay.includes(query);
      })
    : dayFoodSales;

  if (filtered.length === 0) {
    listEl.innerHTML = `<tr><td colspan="6" class="px-4 py-6 text-center text-gray-500">No matching food sales</td></tr>`;
    return;
  }

  listEl.innerHTML = filtered.map((sale, idx) => {
    const time = sale.timestamp
      ? new Date(sale.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
      : "—";
    const itemsText = (sale.items || []).map(i => `${i.qty || 1}× ${i.name}`).join(", ");
    const typeBadge = sale.customerType === FOOD_CUSTOMER_TYPES.PC
      ? `<span class="text-[10px] px-1.5 py-0.5 rounded ml-1" style="background: rgba(0,240,255,0.15); color: var(--neon-cyan);">PC</span>`
      : `<span class="text-[10px] px-1.5 py-0.5 rounded ml-1" style="background: rgba(0,255,136,0.15); color: var(--neon-green);">Member</span>`;
    const modeLabel = sale.paymentMode || "cash";
    const sourceLabel = sale.source === FOOD_SALE_SOURCES.RECHARGES ? "Recharges" : "POS";

    return `
      <tr class="hover:bg-gray-900/40">
        <td class="px-2 py-3 text-center text-gray-500 text-xs">${idx + 1}</td>
        <td class="px-3 py-3 text-xs text-gray-400">${time}</td>
        <td class="px-3 py-3">
          <div class="text-sm text-white font-medium">${sale.customerName || "—"} ${typeBadge}</div>
          <div class="text-xs text-gray-500 truncate max-w-[220px]">${itemsText || "—"}</div>
        </td>
        <td class="px-3 py-3 text-right font-orbitron text-sm" style="color: var(--neon-orange);">₹${sale.total || 0}</td>
        <td class="px-3 py-3 text-xs text-gray-400 capitalize">${modeLabel}<div class="text-[10px] text-gray-600">${sourceLabel}</div></td>
        <td class="px-3 py-3 text-right">
          <button type="button" onclick="deleteFoodRechargeSale('${sale.id}')" class="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-500/10" title="Delete">🗑</button>
        </td>
      </tr>
    `;
  }).join("");
}

window.filterFoodRechargeList = function() {
  renderDayFoodSales();
};

window.deleteFoodRechargeSale = async function(saleId) {
  if (!canEditData()) {
    toast("warning", "You have view-only access.");
    return;
  }
  if (!confirm("Delete this food sale? Stock will not be restored automatically.")) return;

  try {
    const dateStr = currentFoodDate || getSelectedRechargeDate();
    await bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${dateStr}/${saleId}`).remove();
    SharedCache.invalidateFoodSales();
    toast("success", "Food sale deleted");
  } catch (err) {
    toast("error", "Delete failed: " + err.message);
  }
};

// Auto-init when DOM ready
document.addEventListener("DOMContentLoaded", () => {
  initRechargeFood().catch(err => console.error(err));
});

window.initRechargeFood = initRechargeFood;
