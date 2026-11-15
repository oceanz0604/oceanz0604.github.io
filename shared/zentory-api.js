/**
 * OceanZ cafe → Zentory inventory HTTP client
 * Catalog + dual-write POS sales (stock owned by Zentory).
 */

import { ZENTORY } from "./config.js";
import {
  clearZentoryFoodFinance,
  recordZentoryCreditCollection,
  recordZentorySaleFinance,
} from "./zentory-finance.js";

export { clearZentoryFoodFinance, recordZentoryCreditCollection };

function headers() {
  return {
    "Content-Type": "application/json",
    "X-Zentory-Key": ZENTORY.API_KEY,
  };
}

async function zentoryFetch(path, options = {}) {
  const url = `${ZENTORY.API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = new Error(body?.error || `Zentory API ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const PRODUCT_CACHE_MS = 60_000;
let productCache = { products: null, at: 0 };
let productInflight = null;

export function invalidateZentoryProductCache() {
  productCache = { products: null, at: 0 };
  productInflight = null;
}

/** Load sellable products (+ stock) for Cafe Counter. Cached ~60s to keep POS snappy. */
export async function fetchZentoryProducts({ force = false } = {}) {
  if (!force && productCache.products && Date.now() - productCache.at < PRODUCT_CACHE_MS) {
    return productCache.products;
  }
  if (!force && productInflight) return productInflight;
  const q = new URLSearchParams({
    ownerId: ZENTORY.OWNER_ID,
    locationId: ZENTORY.LOCATION_ID,
  });
  productInflight = zentoryFetch(`/api/products?${q}`)
    .then((data) => {
      const products = Array.isArray(data.products) ? data.products : [];
      productCache = { products, at: Date.now() };
      return products;
    })
    .finally(() => {
      productInflight = null;
    });
  return productInflight;
}

export function mapZentoryPayment(paymentMode) {
  const m = String(paymentMode || "cash").toLowerCase();
  if (m === "upi" || m === "card" || m === "credit" || m === "split") return m;
  return "cash";
}

/** Record a credit collection on the customer's Zentory Khata. */
export async function postZentoryKhata(entry) {
  if (ZENTORY.PUSH_SALES === false) return { ok: true, skipped: true };
  try {
    const id = await recordZentoryCreditCollection(entry);
    return { ok: true, id };
  } catch (e) {
    console.warn("[Zentory] khata update failed:", e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Post sale to Zentory (MTO items deduct BOM lots immediately).
 * 409 / ingredient shortage → blocked: true. Network / 5xx → ok: false.
 */
export async function postZentorySale({
  externalId,
  customerName,
  paymentMode,
  items,
  staff,
  note = "",
  cash,
  upi,
  credit,
  soldAt,
}) {
  if (ZENTORY.PUSH_SALES === false) {
    return { ok: true, skipped: true };
  }
  try {
    const mappedItems = (items || []).map((i) => ({
      productId: i.productId || i.id,
      qty: Number(i.qty) || 0,
      unitPrice: Number(i.price ?? i.unitPrice) || 0,
      price: Number(i.price ?? i.unitPrice) || 0,
      cafeExternalId: i.cafeExternalId || null,
    }));
    const payload = {
      externalId,
      channel: ZENTORY.CHANNEL || "oceanz_cafe",
      ownerId: ZENTORY.OWNER_ID,
      locationId: ZENTORY.LOCATION_ID,
      customerName: customerName || "Walk-in",
      paymentMethod: mapZentoryPayment(paymentMode),
      cash,
      upi,
      credit,
      soldAt: soldAt || null,
      items: mappedItems,
      staff: staff || null,
      note,
    };
    const data = await zentoryFetch("/api/sales", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    let financeOk = true;
    let financeError = null;
    try {
      await recordZentorySaleFinance({
        saleId: data.saleId,
        externalId,
        customerName,
        cash,
        upi,
        credit,
        paymentMode,
        items: mappedItems,
        soldAt,
        receiptNumber: data.receiptNumber,
      });
    } catch (financeErr) {
      financeOk = false;
      financeError = financeErr.message || "Zentory accounts update failed";
      console.warn("[Zentory] finance update failed:", financeError);
    }
    return {
      ok: true,
      saleId: data.saleId,
      receiptNumber: data.receiptNumber,
      idempotent: !!data.idempotent,
      financeOk,
      financeError,
    };
  } catch (e) {
    const blocked = e.status === 409;
    console.warn("[Zentory] sale post failed:", e.message);
    return {
      ok: false,
      blocked,
      status: e.status || 0,
      error: e.message,
      missingIngredient: e.body?.missingIngredient || null,
    };
  }
}

export function isZentoryFoodItem(item, menu = []) {
  const id = String(item?.productId || item?.id || "");
  if (id.startsWith("prod_")) return true;
  const m = menu.find((x) => x.id === id);
  return !!(m?.fromZentory || item?.fromZentory);
}

/** Lower cached stock right after a sale so the picker is correct without a catalog round trip. */
export function deductZentoryCachedStock(items) {
  if (!productCache.products) return;
  const byId = new Map(productCache.products.map((p) => [p.id, p]));
  for (const it of items || []) {
    const p = byId.get(it.productId || it.id);
    if (!p || p.stock === null || p.stock === undefined) continue;
    if (p.makeToOrder && p.ingredientStockTracked === false) continue;
    p.stock = Math.max(0, (Number(p.stock) || 0) - (Number(it.qty) || 0));
  }
}

function zentorySyncFields(result) {
  if (!result || result.skipped) {
    return { zentorySyncStatus: "skipped", zentorySyncError: null, zentoryBlocked: null };
  }
  if (result.ok) {
    return {
      zentorySaleId: result.saleId || null,
      zentoryReceipt: result.receiptNumber || null,
      zentorySyncStatus: "ok",
      zentorySyncError: null,
      zentoryBlocked: null,
      zentoryFinanceError: result.financeOk === false ? (result.financeError || "Accounts update failed") : null,
    };
  }
  return {
    zentorySyncStatus: "failed",
    zentorySyncError: result.error || "Zentory unavailable",
    zentoryBlocked: result.blocked ? true : null,
  };
}

/**
 * Post an already-saved cafe food row to Zentory and write the outcome onto
 * that row. The till write happens first so staff never wait on Zentory.
 */
export async function syncFoodSaleToZentory(saleRef, { date, id, sale, menu = [], note }) {
  const items = (sale.items || []).filter((i) => isZentoryFoodItem(i, menu));
  if (!items.length) {
    await saleRef.update({ zentorySyncStatus: "skipped", zentorySyncError: null }).catch(() => {});
    return { ok: true, skipped: true };
  }
  const result = await postZentorySale({
    externalId: `food_sales/${date}/${id}`,
    customerName: sale.customerName || sale.member || "Walk-in",
    paymentMode: sale.paymentMode,
    cash: Number(sale.cash) || 0,
    upi: Number(sale.upi) || 0,
    credit: Number(sale.credit) || 0,
    soldAt: new Date(sale.timestamp || Date.now()).toISOString(),
    items,
    staff: sale.staffName || sale.admin || "Admin",
    note: note || sale.note || "OceanZ",
  });
  try {
    await saleRef.update(zentorySyncFields(result));
  } catch (e) {
    console.warn("[Zentory] could not record sync result on cafe row:", e.message);
  }
  return result;
}

const RETRY_AFTER_MS = 2 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 5;
const retryInFlight = new Set();

function needsZentoryRetry(sale, now) {
  if (!sale || sale.entryType !== "food") return false;
  const status = sale.zentorySyncStatus;
  if (status !== "pending" && status !== "failed") return false;
  if (sale.zentoryBlocked) return false;
  if ((Number(sale.zentoryAttempts) || 0) >= MAX_RETRY_ATTEMPTS) return false;
  const last = Number(sale.zentoryAttemptAt || sale.timestamp) || 0;
  return now - last > RETRY_AFTER_MS;
}

/**
 * Finish Zentory posts that never completed (tab closed, network drop).
 * Each row is claimed with a transaction so two open tabs never post the same sale at once.
 */
export async function retryPendingZentorySales(db, salesPath, date, dayData) {
  if (ZENTORY.PUSH_SALES === false || !db || !dayData) return;
  const now = Date.now();
  for (const [id, sale] of Object.entries(dayData)) {
    if (!needsZentoryRetry(sale, now)) continue;
    const key = `${date}/${id}`;
    if (retryInFlight.has(key)) continue;
    retryInFlight.add(key);
    const ref = db.ref(`${salesPath}/${date}/${id}`);
    try {
      const tx = await ref.transaction((cur) => {
        if (!cur) return cur;
        if (!needsZentoryRetry(cur, Date.now())) return;
        return {
          ...cur,
          zentoryAttemptAt: Date.now(),
          zentoryAttempts: (Number(cur.zentoryAttempts) || 0) + 1,
        };
      });
      if (!tx.committed || !tx.snapshot?.val()) continue;
      await syncFoodSaleToZentory(ref, { date, id, sale: tx.snapshot.val() });
    } catch (e) {
      console.warn("[Zentory] retry failed:", key, e.message);
    } finally {
      retryInFlight.delete(key);
    }
  }
}

export async function voidZentorySale(externalId) {
  if (ZENTORY.PUSH_SALES === false) {
    return { ok: true, skipped: true };
  }
  try {
    const data = await zentoryFetch("/api/sales/void", {
      method: "POST",
      body: JSON.stringify({
        externalId,
        ownerId: ZENTORY.OWNER_ID,
      }),
    });
    return { ok: true, alreadyVoided: !!data.alreadyVoided, saleId: data.saleId };
  } catch (e) {
    console.warn("[Zentory] void failed:", e.message);
    return { ok: false, error: e.message };
  }
}
