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
  foodSaleToLedger,
  removeFoodCreditPaymentsForSale,
  purgeOrphanedFoodCreditPayments
} from "../../shared/food-stats.js";
import { fitCollectionsToSale } from "../../shared/sale-cash.js";
import { fetchZentoryProducts, postZentorySale, voidZentorySale, invalidateZentoryProductCache, applyZentorySaleResult } from "../../shared/zentory-api.js";
import {
  uniqueFoodCategories,
  filterFoodItems,
  indexFoodItem,
  foodCategoryEmoji,
  escapeFoodHtml,
  mapZentoryMenuProduct,
  foodItemOutOfStock,
  foodStockHint,
  canAddFoodQty,
} from "../../shared/food-picker.js";

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
let foodMenuQuery = "";
let foodMenuCategory = "all";
let foodMenuSearchTimer = null;
let foodPaymentMode = "cash"; // cash | upi | split | credit — UI mode
let foodCustomerType = FOOD_CUSTOMER_TYPES.MEMBER;
let selectedMemberName = "";
let selectedPcName = "";
let foodEditId = null;
let foodEditCollected = 0;
let foodDayState = [];
let foodSalesListener = null;
let foodSalesHandler = null;
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

  if (foodSalesListener && foodSalesHandler) {
    foodSalesListener.off("value", foodSalesHandler);
    foodSalesListener = null;
    foodSalesHandler = null;
  }

  return new Promise(resolve => {
    const ref = bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${dateStr}`);
    foodSalesListener = ref;
    foodSalesHandler = snap => {
      const data = snap.val() || {};
      foodDayState = Object.entries(data).map(([id, sale]) =>
        foodSaleToLedger({ ...sale, id, date: dateStr })
      );
      if (typeof onFoodStateChange === "function") onFoodStateChange(foodDayState);
      hideLegacyFoodBlock();
      resolve(foodDayState);
    };
    ref.on("value", foodSalesHandler, err => {
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
  await loadFoodMenuItems({ force: false });
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

async function loadFoodMenuItems({ force = false } = {}) {
  const ready = await initFoodFirebase();
  if (!ready) return;

  try {
    const products = await fetchZentoryProducts({ force });
    foodMenu = products.map((p) => mapZentoryMenuProduct(p));
    foodMenu.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderFoodMenuPicker({ chips: true });
  } catch (err) {
    console.warn("[RechargeFood] Zentory catalog unavailable, falling back:", err);
    try {
      const snap = await bookingDb.ref(FB_PATHS.FOOD_MENU).once("value");
      const data = snap.val() || {};
      foodMenu = Object.entries(data)
        .map(([id, item]) => indexFoodItem({ id, ...item, fromZentory: false }))
        .filter(item => item.available !== false)
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      renderFoodMenuPicker({ chips: true });
      toast("warning", "Zentory catalog unavailable — using local menu");
    } catch (e2) {
      console.error("❌ RechargeFood: menu load failed", e2);
      foodMenu = [];
    }
  }
}

function bindFoodMenuGridOnce() {
  const container = $("foodRechargeMenuGrid");
  if (!container || container.dataset.bound === "1") return;
  container.dataset.bound = "1";
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-food-id]");
    if (!btn || btn.disabled) return;
    window.addFoodRechargeItem(btn.dataset.foodId);
  });
}

function renderFoodCatChips() {
  const bar = $("foodRechargeCatChips");
  if (!bar) return;
  const cats = uniqueFoodCategories(foodMenu);
  const chip = (key, label, extra = "") => {
    const on = foodMenuCategory === key;
    const safe = String(key).replace(/'/g, "\\'");
    return `<button type="button" data-cat="${escapeFoodHtml(key)}" onclick="filterFoodRechargeMenu('${safe}')"
      class="food-cat-btn ${on ? "selected" : ""}">${escapeFoodHtml(label)}${extra}</button>`;
  };
  bar.innerHTML = [
    chip("all", "All", foodMenu.length ? ` (${foodMenu.length})` : ""),
    ...cats.map((c) => chip(c.key, `${c.emoji} ${c.label}`, c.count ? ` (${c.count})` : "")),
  ].join("");
}

function renderFoodMenuPicker({ chips = false } = {}) {
  const container = $("foodRechargeMenuGrid");
  if (!container) return;
  bindFoodMenuGridOnce();
  if (chips) renderFoodCatChips();

  if (foodMenu.length === 0) {
    container.innerHTML = `<div class="text-center text-gray-500 text-sm py-6 col-span-full">Loading menu…</div>`;
    return;
  }

  const filtered = filterFoodItems(foodMenu, { query: foodMenuQuery, categoryKey: foodMenuCategory });
  if (filtered.length === 0) {
    container.innerHTML = `<div class="text-center text-gray-500 text-sm py-6 col-span-full">No items match that search.</div>`;
    return;
  }

  let html = "";
  for (const item of filtered) {
    const disabled = foodItemOutOfStock(item);
    const cat = item.categoryName || item.category || "";
    const emoji = item._emoji || foodCategoryEmoji(cat);
    const hint = foodStockHint(item);
    html += `<button type="button" data-food-id="${escapeFoodHtml(item.id)}" ${disabled ? "disabled" : ""} class="food-menu-tile${disabled ? " is-disabled" : ""}">`
      + `<span class="food-menu-tile-name">${emoji} ${escapeFoodHtml(item.name)}</span>`
      + `<span class="food-menu-tile-meta"><b>₹${item.price || 0}</b>`
      + (hint ? `<span>${escapeFoodHtml(hint)}</span>` : "")
      + `</span></button>`;
  }
  container.innerHTML = html;
}

window.searchFoodRechargeMenu = function(query) {
  foodMenuQuery = query || "";
  clearTimeout(foodMenuSearchTimer);
  foodMenuSearchTimer = setTimeout(() => renderFoodMenuPicker({ chips: false }), 40);
};

window.filterFoodRechargeMenu = function(categoryKey) {
  foodMenuCategory = categoryKey || "all";
  renderFoodCatChips();
  renderFoodMenuPicker({ chips: false });
};

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

  if (foodItemOutOfStock(item)) {
    toast("warning", item.makeToOrder ? "Need ingredients in Zentory" : "Out of stock");
    return;
  }

  const existing = foodCart.find(c => c.id === itemId);
  if (existing) {
    if (!canAddFoodQty(item, existing.qty + 1)) {
      toast("warning", item.makeToOrder ? "Not enough ingredients for another plate" : "Not enough stock");
      return;
    }
    existing.qty += 1;
  } else {
    foodCart.push({
      id: item.id,
      name: item.name,
      price: Number(item.price) || 0,
      qty: 1,
      cafeExternalId: item.cafeExternalId || null,
      fromZentory: !!item.fromZentory
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
  updateFoodSaleMenuSummary();
}

function updateFoodSaleMenuSummary() {
  const el = $("foodSaleMenuCartSummary");
  if (!el) return;
  const n = foodCart.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const total = getFoodCartTotal();
  el.textContent = n ? `${n} item${n === 1 ? "" : "s"} · ₹${total}` : "Empty";
}

function setFoodSaleStep(step) {
  const menu = $("foodSaleStepMenu");
  const checkout = $("foodSaleStepCheckout");
  const hint = $("foodSaleStepHint");
  menu?.classList.toggle("is-active", step === 1);
  checkout?.classList.toggle("is-active", step === 2);
  if (hint) {
    hint.textContent = step === 2
      ? "Step 2 of 2 — check the cart and take payment."
      : "Step 1 of 2 — pick items. Cart and payment are next.";
  }
  if (step === 2) renderFoodCart();
}

window.goFoodSaleCheckout = function() {
  if (!foodCart.length) {
    toast("warning", "Add at least one item first");
    return;
  }
  setFoodSaleStep(2);
};

window.goFoodSaleMenu = function() {
  setFoodSaleStep(1);
};

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
  const collectedNote = foodEditCollected > 0 ? ` · ₹${foodEditCollected} already collected` : "";
  if (total === 0) {
    el.textContent = "Add items first" + collectedNote;
    el.style.color = "var(--neon-orange)";
  } else if (remaining === 0) {
    el.textContent = "Split OK" + collectedNote;
    el.style.color = "var(--neon-green)";
  } else {
    el.textContent = `Remaining ₹${remaining}` + collectedNote;
    el.style.color = remaining > 0 ? "var(--neon-orange)" : "var(--neon-red)";
  }
}

// ==================== MODAL ====================

window.openAddFoodRechargeModal = function(isEdit = false) {
  if (!canEditData()) {
    toast("warning", "You have view-only access. Editing is not allowed.");
    return;
  }

  const modal = $("addFoodRechargeModal");
  const title = modal?.querySelector("h3");
  if (title) title.textContent = isEdit ? "EDIT FOOD / SNACKS" : "ADD FOOD / SNACKS";

  if (!isEdit) resetFoodForm();

  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }

  setFoodSaleStep(isEdit ? 2 : 1);
  loadFoodMenuItems({ force: false });
  setTimeout(() => $("foodMemberInput")?.focus(), 30);
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
  foodEditCollected = 0;
  foodMenuQuery = "";
  foodMenuCategory = "all";
  if ($("foodRechargeItemSearch")) $("foodRechargeItemSearch").value = "";
  if ($("foodMemberInput")) $("foodMemberInput").value = "";
  if ($("foodGuestTerminalSelect")) $("foodGuestTerminalSelect").value = "";
  if ($("foodRechargeNote")) $("foodRechargeNote").value = "";
  if ($("foodRechargeCash")) $("foodRechargeCash").value = "";
  if ($("foodRechargeUpi")) $("foodRechargeUpi").value = "";
  if ($("foodRechargeCredit")) $("foodRechargeCredit").value = "";
  setFoodSaleStep(1);
  setFoodRechargePaymentMode("cash");
  renderFoodCart();
  renderFoodMenuPicker({ chips: true });
  updateFoodCustomerBadge();
}

async function resolveFoodSale(id, dateOverride) {
  const inMemory = foodDayState.find(s => s.id === id);
  const dateStr = dateOverride || inMemory?.date || currentFoodDate || getSelectedRechargeDate();
  if (inMemory && (!dateOverride || dateOverride === inMemory.date)) return inMemory;
  const raw = await fetchFoodSale(dateStr, id);
  if (!raw) return null;
  return foodSaleToLedger({ ...raw, id, date: dateStr });
}

window.editFoodRecharge = async function(id, dateOverride) {
  if (!canEditData()) {
    toast("warning", "You have view-only access.");
    return;
  }

  const sale = await resolveFoodSale(id, dateOverride);
  if (!sale) {
    toast("error", "Food entry not found");
    return;
  }

  await loadFoodMenuItems({ force: false });
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

  // Keep the original split. Collected credit stays in creditPayments and must
  // not be copied into cash/upi or the cash register counts it twice.
  const actualCash = Number(sale.cash) || 0;
  const actualUpi = Number(sale.upi) || 0;
  const issuedCredit = Number(sale.credit) || 0;
  const alreadyCollected = Number(sale.creditPaid) || 0;
  foodEditCollected = alreadyCollected;

  if (issuedCredit > 0 && actualCash === 0 && actualUpi === 0) foodPaymentMode = "credit";
  else if (issuedCredit > 0 || (actualCash > 0 && actualUpi > 0)) foodPaymentMode = "split";
  else if (actualUpi > 0 && actualCash === 0) foodPaymentMode = "upi";
  else foodPaymentMode = "cash";

  setFoodRechargePaymentMode(foodPaymentMode);
  if ($("foodRechargeCash")) $("foodRechargeCash").value = actualCash || "";
  if ($("foodRechargeUpi")) $("foodRechargeUpi").value = actualUpi || "";
  if ($("foodRechargeCredit")) $("foodRechargeCredit").value = issuedCredit || "";

  renderFoodCart();
  updateFoodCustomerBadge();
  openAddFoodRechargeModal(true);
};

window.deleteFoodRecharge = async function(id, dateOverride) {
  if (!canEditData()) {
    toast("warning", "You have view-only access.");
    return;
  }

  const sale = await resolveFoodSale(id, dateOverride);
  const dateStr = sale?.date || dateOverride || currentFoodDate || getSelectedRechargeDate();

  if (!sale) {
    toast("error", "Food entry not found");
    return;
  }

  const pending = Math.max(0, (sale.credit || 0) - (sale.creditPaid || 0));
  const collected = Number(sale.creditPaid) || 0;
  const warnParts = [];
  if (pending > 0) warnParts.push(`₹${pending} pending credit will be cleared`);
  if (collected > 0) warnParts.push(`₹${collected} already-collected credit will be removed from finance`);

  const confirmMsg = warnParts.length
    ? `Delete this food entry? ${warnParts.join(". ")}.`
    : "Delete this food entry?";

  const confirmed = typeof showConfirm === "function"
    ? await showConfirm(confirmMsg, {
        title: "Delete Food Entry",
        type: "error",
        confirmText: "Delete",
        cancelText: "Cancel"
      })
    : confirm(confirmMsg);

  if (!confirmed) return;

  try {
    await initFoodFirebase();

    // Restore Zentory stock for this cafe sale (soft-fail).
    const zVoid = await voidZentorySale(`food_sales/${dateStr}/${id}`);
    if (!zVoid?.ok) {
      console.warn("[RechargeFood] Zentory void failed:", zVoid?.error);
    }

    // Remove sale first, then scrub matching credit-collection log rows
    await bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${dateStr}/${id}`).remove();

    const paymentsRemoved = await removeFoodCreditPaymentsForSale(
      bookingDb,
      id,
      dateStr,
      FB_PATHS.FOOD_CREDIT_PAYMENTS
    );

    if (pending > 0 && sale.member) {
      await adjustFoodCreditLedger(sale.member, -pending, sale.customerType, sale);
    }

    SharedCache.invalidateFoodSales();
    const extra = paymentsRemoved > 0 ? ` (cleared ${paymentsRemoved} credit collection${paymentsRemoved > 1 ? "s" : ""})` : "";
    toast("success", "Food entry deleted" + extra);
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

  if (foodEditId) {
    const fitted = fitCollectionsToSale({
      total: saleData.total,
      cash: saleData.cash,
      upi: saleData.upi,
      credit: saleData.credit,
      creditPaid: saleData.creditPaid,
      creditPayments: saleData.creditPayments,
    });
    saleData.creditPaid = fitted.creditPaid;
    saleData.creditPayments = fitted.creditPayments;
    saleData.lastPaidCash = fitted.lastPaidCash;
    saleData.lastPaidUpi = fitted.lastPaidUpi;
    if (fitted.clearLastPaid) {
      saleData.lastPaidAt = null;
      saleData.lastPaidBy = null;
    }
  }

  try {
    const ready = await initFoodFirebase();
    if (!ready) throw new Error("Database not ready");

    let saleId = foodEditId;
    let saleRef = null;
    if (foodEditId) {
      saleRef = bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${saleDate}/${foodEditId}`);
      await saleRef.update(saleData);
    } else {
      saleRef = bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${saleDate}`).push();
      saleId = saleRef.key;

      const zentoryItems = foodCart.filter((item) => {
        const menu = foodMenu.find((m) => m.id === item.id);
        return menu?.fromZentory || String(item.id || "").startsWith("prod_");
      });
      if (zentoryItems.length) {
        const paymentMode = credit > 0 && cash === 0 && upi === 0
          ? "credit"
          : (cash > 0 && upi > 0) || (cash > 0 && credit > 0) || (upi > 0 && credit > 0)
            ? "split"
            : upi > 0 ? "upi" : "cash";
        const zResult = await postZentorySale({
          externalId: `food_sales/${saleDate}/${saleId}`,
          customerName: customerInput,
          paymentMode,
          items: zentoryItems,
          staff: session?.name || session?.email || "Admin",
          note: ($("foodRechargeNote")?.value || "").trim() || "OceanZ Recharges",
        });
        applyZentorySaleResult(saleData, zResult);
        if (zResult.ok === false && !zResult.blocked) {
          toast("warning", "Sale saved. Stock sync to Zentory failed — check this row later.");
        }
      }
      try {
        await saleRef.set(saleData);
      } catch (writeErr) {
        if (saleData.zentorySaleId) {
          await voidZentorySale(`food_sales/${saleDate}/${saleId}`);
        }
        throw writeErr;
      }
    }

    // Sync aggregate food credit ledger by delta of pending credit
    const newPending = Math.max(0, saleData.credit - (saleData.creditPaid || 0));
    const creditDelta = newPending - previousPending;
    if (creditDelta !== 0) {
      await adjustFoodCreditLedger(customerInput, creditDelta, customerType, saleData);
    }

    SharedCache.invalidateFoodSales();
    toast("success", foodEditId ? `Food sale updated: ₹${total}` : `Food sale saved: ₹${total}`);
    closeAddFoodRechargeModal();
    invalidateZentoryProductCache();
    loadFoodMenuItems({ force: true });
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
function issuedFoodCredit(sale = {}) {
  if (sale.credit !== undefined && sale.credit !== null && sale.credit !== "") {
    return Number(sale.credit) || 0;
  }
  if (sale.paymentMode === "credit") return Number(sale.creditAmount || sale.total) || 0;
  if (sale.paymentMode === "split") return Number(sale.creditAmount) || 0;
  return Number(sale.creditAmount) || 0;
}

export async function collectFoodSaleCredit({ date, id, cash, upi, stillCredit, collected, adminName }) {
  await initFoodFirebase();
  const ref = bookingDb.ref(`${FB_PATHS.FOOD_SALES}/${date}/${id}`);
  const today = getTodayISTString();
  const now = new Date().toISOString();
  let applied = null;

  // Firebase calls this with null before the sale is in the local cache.
  // Returning undefined aborts the whole collect. Return null so it retries
  // with the real record.
  let blocked = false;
  const tx = await ref.transaction((current) => {
    if (!current) return current;
    const issued = issuedFoodCredit(current);
    const already = Number(current.creditPaid) || 0;
    const room = Math.max(0, issued - already);
    if (collected > room + 0.001) {
      blocked = true;
      return;
    }
    blocked = false;
    const existingPayments = current.creditPayments || {};
    const todayPayment = existingPayments[today] || { cash: 0, upi: 0 };
    const updatedPayments = {
      ...existingPayments,
      [today]: {
        cash: (Number(todayPayment.cash) || 0) + cash,
        upi: (Number(todayPayment.upi) || 0) + upi,
        at: now,
        by: adminName || getAdminName()
      }
    };
    return {
      ...current,
      credit: issued,
      creditPaid: already + collected,
      creditPayments: updatedPayments,
      lastPaidAt: now,
      lastPaidCash: cash,
      lastPaidUpi: upi,
      lastPaidBy: adminName || getAdminName()
    };
  });

  if (!tx.committed || !tx.snapshot?.val()) {
    if (blocked) {
      throw new Error("This credit was already collected. Refresh the list and try again.");
    }
    throw new Error("Food sale not found");
  }
  applied = tx.snapshot.val() || {};
  const ledger = foodSaleToLedger({ ...applied, id, date });

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
  initRechargeFood()
    .then(() => scrubOrphanFoodCreditPaymentsQuietly())
    .catch(err => console.error(err));
});

/** One-shot cleanup of orphaned food credit payment logs (does not block UI). */
async function scrubOrphanFoodCreditPaymentsQuietly() {
  try {
    const ready = await initFoodFirebase();
    if (!ready || !bookingDb) return;
    // At most once per browser day
    const key = "oceanz_food_credit_orphan_scrub";
    const today = getTodayISTString();
    if (localStorage.getItem(key) === today) return;

    const result = await purgeOrphanedFoodCreditPayments(
      bookingDb,
      FB_PATHS.FOOD_SALES,
      FB_PATHS.FOOD_CREDIT_PAYMENTS
    );
    localStorage.setItem(key, today);
    if (result.removed > 0) {
      SharedCache.invalidateFoodSales();
      console.log(`🧹 Removed ${result.removed} orphaned food credit payment(s)`);
    }
  } catch (err) {
    console.warn("Food credit orphan scrub skipped:", err);
  }
}

window.initRechargeFood = initRechargeFood;
window.getFoodDayState = getFoodDayState;
window.loadFoodDay = loadFoodDay;
