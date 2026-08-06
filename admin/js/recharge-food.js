/**
 * OceanZ Gaming Cafe - Food / Snacks on Recharges Page
 *
 * Food sales use the same cash/upi/credit ledger shape as gaming recharges.
 * Today's Transactions (recharges.js) merges and renders both entry types.
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
  buildFoodLedgerSale,
  foodCreditKey,
  foodSaleToLedger
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
let foodPaymentMode = "cash"; // cash | upi | split | credit — UI mode
let foodCustomerType = FOOD_CUSTOMER_TYPES.MEMBER;
let selectedMemberName = "";
let selectedPcName = "";
let foodEditId = null;
let foodDayState = [];
let foodSalesListener = null;
let currentFoodDate = null;
let onFoodStateChange = null;

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

function getAdminName() {
  const session = getStaffSession();
  return session?.name || session?.email?.split("@")[0] || "Admin";
}

// ==================== PUBLIC API (used by recharges.js) ====================

export function getFoodDayState() {
  return foodDayState;
}

export function onFoodDayChange(callback) {
  onFoodStateChange = callback;
}

export async function loadFoodDay(dateStr) {
  const ready = await initFoodFirebase();
  if (!ready || !bookingDb) return [];

  currentFoodDate = dateStr;

  if (foodSalesListener) {
    foodSalesListener.off();
    foodSalesListener = null;
  }

  return new Promise(resolve => {
    const ref = bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${dateStr}`);
    foodSalesListener = ref;
    ref.on("value", snap => {
      const data = snap.val() || {};
      foodDayState = Object.entries(data).map(([id, sale]) =>
        foodSaleToLedger({ id, date: dateStr, ...sale })
      );
      if (typeof onFoodStateChange === "function") onFoodStateChange(foodDayState);
      // Hide legacy separate food block if still in DOM
      hideLegacyFoodBlock();
      resolve(foodDayState);
    }, err => {
      console.error("❌ RechargeFood: day listen failed", err);
      foodDayState = [];
      if (typeof onFoodStateChange === "function") onFoodStateChange(foodDayState);
      resolve([]);
    });
  });
}

function hideLegacyFoodBlock() {
  const block = $("foodRechargeList")?.closest(".neon-card");
  // Prefer hiding the dedicated food section card (has foodDayTotal)
  const dayTotal = $("foodDayTotal");
  if (dayTotal) {
    const section = dayTotal.closest(".neon-card");
    if (section) section.classList.add("hidden");
  }
}

export async function getAllFoodSalesTree() {
  await initFoodFirebase();
  try {
    return await SharedCache.getFoodSales(bookingDb, FB_PATHS.FOOD_SALES);
  } catch (e) {
    return {};
  }
}

export function getBookingDb() {
  return bookingDb;
}

// ==================== INIT ====================

export async function initRechargeFood() {
  await initFoodFirebase();
  initFoodGuestTerminalDropdown();
  setupFoodMemberAutocomplete();
  bindDatePickerHook();
  await loadFoodMenuItems();
  await loadFoodDay(getSelectedRechargeDate());
  console.log("✅ RechargeFood: initialized");
}

function bindDatePickerHook() {
  const picker = $("datePicker");
  if (!picker || picker.dataset.foodHooked === "1") return;
  picker.dataset.foodHooked = "1";
  picker.addEventListener("change", () => {
    loadFoodDay(picker.value);
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
  // Always show split fields so cash/upi/credit can be set like recharges
  if (splitBox) splitBox.classList.remove("hidden");

  // Auto-fill based on mode
  const total = getFoodCartTotal();
  if (mode === "cash") {
    if ($("foodRechargeCash")) $("foodRechargeCash").value = total || "";
    if ($("foodRechargeUpi")) $("foodRechargeUpi").value = "";
    if ($("foodRechargeCredit")) $("foodRechargeCredit").value = "";
  } else if (mode === "upi") {
    if ($("foodRechargeCash")) $("foodRechargeCash").value = "";
    if ($("foodRechargeUpi")) $("foodRechargeUpi").value = total || "";
    if ($("foodRechargeCredit")) $("foodRechargeCredit").value = "";
  } else if (mode === "credit") {
    if ($("foodRechargeCash")) $("foodRechargeCash").value = "";
    if ($("foodRechargeUpi")) $("foodRechargeUpi").value = "";
    if ($("foodRechargeCredit")) $("foodRechargeCredit").value = total || "";
  }
  updateFoodSplitRemaining();
};

window.updateFoodRechargeSplit = function() {
  updateFoodSplitRemaining();
};

function updateFoodSplitRemaining() {
  const el = $("foodRechargeSplitRemaining");
  if (!el) return;
  const total = getFoodCartTotal();
  const cash = Number($("foodRechargeCash")?.value) || 0;
  const upi = Number($("foodRechargeUpi")?.value) || 0;
  const credit = Number($("foodRechargeCredit")?.value) || 0;
  const remaining = total - (cash + upi + credit);
  if (total === 0) {
    el.textContent = "Add items first";
    el.style.color = "var(--neon-orange)";
  } else if (remaining === 0) {
    el.textContent = "Split OK";
    el.style.color = "var(--neon-green)";
  } else {
    el.textContent = `Remaining ₹${remaining}`;
    el.style.color = remaining > 0 ? "var(--neon-orange)" : "var(--neon-red)";
  }
}

// ==================== MODAL ====================

window.openAddFoodRechargeModal = async function(isEdit = false) {
  if (!canEditData()) {
    toast("warning", "You have view-only access. Editing is not allowed.");
    return;
  }

  await loadFoodMenuItems();
  if (!isEdit) resetFoodForm();

  const modal = $("addFoodRechargeModal");
  const title = modal?.querySelector("h3");
  if (title) title.innerHTML = isEdit ? "✏️ EDIT FOOD / SNACKS" : "🍔 ADD FOOD / SNACKS";

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
  foodEditId = null;
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

window.editFoodRecharge = async function(id) {
  if (!canEditData()) {
    toast("warning", "You have view-only access.");
    return;
  }

  const sale = foodDayState.find(s => s.id === id);
  if (!sale) {
    toast("error", "Food entry not found");
    return;
  }

  await loadFoodMenuItems();
  foodEditId = id;
  foodCart = (sale.items || []).map(i => ({
    id: i.id,
    name: i.name,
    price: Number(i.price) || 0,
    qty: Number(i.qty) || 1
  }));

  const name = sale.member || sale.customerName || "";
  if ($("foodMemberInput")) $("foodMemberInput").value = name;

  if (sale.customerType === FOOD_CUSTOMER_TYPES.PC || CONSTANTS.GUEST_TERMINALS.includes(name)) {
    foodCustomerType = FOOD_CUSTOMER_TYPES.PC;
    selectedPcName = name;
    selectedMemberName = "";
    if ($("foodGuestTerminalSelect")) $("foodGuestTerminalSelect").value = name;
  } else {
    foodCustomerType = FOOD_CUSTOMER_TYPES.MEMBER;
    selectedMemberName = name;
    selectedPcName = "";
  }

  if ($("foodRechargeNote")) $("foodRechargeNote").value = sale.note || "";

  // Show remaining credit as editable credit portion
  const pendingCredit = Math.max(0, (sale.credit || 0) - (sale.creditPaid || 0));
  const actualCash = (sale.cash || 0) + (sale.lastPaidCash || 0);
  const actualUpi = (sale.upi || 0) + (sale.lastPaidUpi || 0);

  if ($("foodRechargeCash")) $("foodRechargeCash").value = actualCash || "";
  if ($("foodRechargeUpi")) $("foodRechargeUpi").value = actualUpi || "";
  if ($("foodRechargeCredit")) $("foodRechargeCredit").value = pendingCredit || "";

  if (pendingCredit > 0 && actualCash === 0 && actualUpi === 0) foodPaymentMode = "credit";
  else if (pendingCredit > 0 || (actualCash > 0 && actualUpi > 0)) foodPaymentMode = "split";
  else if (actualUpi > 0 && actualCash === 0) foodPaymentMode = "upi";
  else foodPaymentMode = "cash";

  setFoodRechargePaymentMode(foodPaymentMode);
  // Restore amounts after mode auto-fill
  if ($("foodRechargeCash")) $("foodRechargeCash").value = actualCash || "";
  if ($("foodRechargeUpi")) $("foodRechargeUpi").value = actualUpi || "";
  if ($("foodRechargeCredit")) $("foodRechargeCredit").value = pendingCredit || "";

  renderFoodCart();
  updateFoodCustomerBadge();
  openAddFoodRechargeModal(true);
};

window.deleteFoodRecharge = async function(id, dateOverride) {
  if (!canEditData()) {
    toast("warning", "You have view-only access.");
    return;
  }

  const dateStr = dateOverride || currentFoodDate || getSelectedRechargeDate();
  let sale = null;
  if ((!dateOverride || dateOverride === currentFoodDate) && foodDayState.find(s => s.id === id)) {
    sale = foodDayState.find(s => s.id === id);
  } else {
    const raw = await fetchFoodSale(dateStr, id);
    if (raw) sale = foodSaleToLedger({ id, date: dateStr, ...raw });
  }

  if (!sale) {
    toast("error", "Food entry not found");
    return;
  }

  const confirmed = typeof showConfirm === "function"
    ? await showConfirm("Delete this food entry? Pending food credit for this sale will be reduced.", {
        title: "Delete Food Entry",
        type: "error",
        confirmText: "Delete",
        cancelText: "Cancel"
      })
    : confirm("Delete this food entry?");

  if (!confirmed) return;

  try {
    await initFoodFirebase();
    const pending = Math.max(0, (sale.credit || 0) - (sale.creditPaid || 0));
    await bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${dateStr}/${id}`).remove();

    if (pending > 0 && sale.member) {
      await adjustFoodCreditLedger(sale.member, -pending, sale.customerType, sale);
    }

    SharedCache.invalidateFoodSales();
    toast("success", "Food entry deleted");
    if (typeof window.loadAllOutstandingCredits === "function") {
      window.loadAllOutstandingCredits();
    }
  } catch (err) {
    toast("error", "Delete failed: " + err.message);
  }
};

async function fetchFoodSale(dateStr, id) {
  await initFoodFirebase();
  const snap = await bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${dateStr}/${id}`).once("value");
  return snap.val();
}

async function adjustFoodCreditLedger(customerName, delta, customerType, sale = {}) {
  if (!customerName || !delta) return;
  const key = foodCreditKey(customerName);
  const creditRef = bookingDb.ref(`${FB_PATHS.FOOD_CREDITS}/${key}`);
  const snap = await creditRef.once("value");
  const existing = snap.val() || { outstanding: 0 };
  const next = Math.max(0, (existing.outstanding || 0) + delta);

  if (next <= 0) {
    await creditRef.remove();
  } else {
    await creditRef.update({
      customerName,
      customerType: customerType || existing.customerType || FOOD_CUSTOMER_TYPES.WALKIN,
      memberId: sale.memberId || existing.memberId || null,
      pcName: sale.pcName || existing.pcName || null,
      outstanding: next,
      lastUpdated: Date.now()
    });
  }
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
  const cash = Number($("foodRechargeCash")?.value) || 0;
  const upi = Number($("foodRechargeUpi")?.value) || 0;
  const credit = Number($("foodRechargeCredit")?.value) || 0;

  if (cash + upi + credit !== total) {
    toast("warning", `Split (₹${cash + upi + credit}) must equal total (₹${total})`);
    return;
  }

  const isPc = foodCustomerType === FOOD_CUSTOMER_TYPES.PC ||
    CONSTANTS.GUEST_TERMINALS.includes(customerInput);
  const customerType = isPc ? FOOD_CUSTOMER_TYPES.PC : FOOD_CUSTOMER_TYPES.MEMBER;
  const session = getStaffSession();
  const saleDate = getSelectedRechargeDate();

  const previous = foodEditId
    ? foodDayState.find(s => s.id === foodEditId)
    : null;
  const previousPending = previous
    ? Math.max(0, (previous.credit || 0) - (previous.creditPaid || 0))
    : 0;

  const saleData = buildFoodLedgerSale({
    customerName: customerInput,
    customerType,
    memberId: customerType === FOOD_CUSTOMER_TYPES.MEMBER ? customerInput : null,
    memberName: customerType === FOOD_CUSTOMER_TYPES.MEMBER ? customerInput : null,
    pcName: customerType === FOOD_CUSTOMER_TYPES.PC ? customerInput : null,
    source: FOOD_SALE_SOURCES.RECHARGES,
    items: foodCart,
    total,
    cash,
    upi,
    credit,
    note: ($("foodRechargeNote")?.value || "").trim(),
    admin: getAdminName(),
    staffId: session?.id || "unknown",
    staffName: session?.name || session?.email || "Admin",
    timestamp: previous?.timestamp || Date.now(),
    // Preserve collected credit history on edit
    creditPaid: foodEditId ? (previous?.creditPaid || 0) : 0,
    creditPayments: foodEditId ? (previous?.creditPayments || {}) : {}
  });

  // If editing and reducing credit below already paid, clamp
  if (saleData.creditPaid > saleData.credit) {
    saleData.creditPaid = saleData.credit;
  }

  try {
    const ready = await initFoodFirebase();
    if (!ready) throw new Error("Database not ready");

    if (foodEditId) {
      await bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${saleDate}/${foodEditId}`).update(saleData);
    } else {
      const saleRef = bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${saleDate}`).push();
      await saleRef.set(saleData);
    }

    // Sync aggregate food credit ledger by delta of pending credit
    const newPending = Math.max(0, saleData.credit - (saleData.creditPaid || 0));
    const creditDelta = newPending - previousPending;
    if (creditDelta !== 0) {
      await adjustFoodCreditLedger(customerInput, creditDelta, customerType, saleData);
    }

    // Stock: only adjust on create (simple & safe). Edit does not re-adjust stock.
    if (!foodEditId) {
      for (const item of foodCart) {
        const menuItem = foodMenu.find(m => m.id === item.id);
        if (menuItem && menuItem.stock !== null && menuItem.stock !== undefined) {
          const newStock = Math.max(0, Number(menuItem.stock) - item.qty);
          await bookingDb.ref(`${FB_PATHS.FOOD_MENU}/${item.id}/stock`).set(newStock);
        }
      }
    }

    SharedCache.invalidateFoodSales();
    toast("success", foodEditId ? `Food sale updated: ₹${total}` : `Food sale saved: ₹${total}`);
    closeAddFoodRechargeModal();
    await loadFoodMenuItems();
    if (typeof window.loadAllOutstandingCredits === "function") {
      window.loadAllOutstandingCredits();
    }
  } catch (err) {
    console.error("❌ RechargeFood: save failed", err);
    toast("error", "Failed to save food sale: " + err.message);
  }
};

/**
 * Collect food credit against a specific food_sales entry (same UX as gaming).
 */
export async function collectFoodSaleCredit({ date, id, cash, upi, stillCredit, collected, adminName }) {
  await initFoodFirebase();
  const ref = bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${date}/${id}`);
  const snap = await ref.once("value");
  const original = snap.val();
  if (!original) throw new Error("Food sale not found");

  const ledger = foodSaleToLedger({ id, date, ...original });
  const today = getTodayISTString();
  const now = new Date().toISOString();
  const newCreditPaid = (ledger.creditPaid || 0) + collected;

  const existingPayments = ledger.creditPayments || {};
  const todayPayment = existingPayments[today] || { cash: 0, upi: 0 };
  const updatedPayments = {
    ...existingPayments,
    [today]: {
      cash: (todayPayment.cash || 0) + cash,
      upi: (todayPayment.upi || 0) + upi,
      at: now,
      by: adminName || getAdminName()
    }
  };

  await ref.update({
    creditPaid: newCreditPaid,
    creditPayments: updatedPayments,
    lastPaidAt: now,
    lastPaidCash: cash,
    lastPaidUpi: upi,
    lastPaidBy: adminName || getAdminName()
  });

  // Also log in food_credit_payments + reduce food_credits outstanding
  if (collected > 0) {
    await bookingDb.ref(`${FB_PATHS.FOOD_CREDIT_PAYMENTS}/${today}`).push({
      saleId: id,
      saleDate: date,
      customerId: foodCreditKey(ledger.member),
      customerName: ledger.member,
      cash,
      upi,
      total: collected,
      timestamp: Date.now(),
      by: adminName || getAdminName()
    });
    await adjustFoodCreditLedger(ledger.member, -collected, ledger.customerType, ledger);
  }

  SharedCache.invalidateFoodSales();
  return true;
}

// Auto-init
document.addEventListener("DOMContentLoaded", () => {
  initRechargeFood().catch(err => console.error(err));
});

window.initRechargeFood = initRechargeFood;
window.getFoodDayState = getFoodDayState;
window.loadFoodDay = loadFoodDay;
