/**
 * OceanZ cafe → Zentory inventory HTTP client
 * Catalog + dual-write POS sales (stock owned by Zentory).
 */

import { ZENTORY } from "./config.js";
import {
  clearZentoryFoodFinance,
  recordZentoryCreditCollection,
  recordZentorySaleFinance,
  zeroZentorySaleCredit,
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

/** Zentory matches sales by external id, so each edited version gets its own (`#r1`, `#r2`…). */
export function zentoryExternalIdFor(date, id, sale = {}) {
  return sale.zentoryExternalId || `food_sales/${date}/${id}`;
}

function zentoryLinesKey(items, menu) {
  return (items || [])
    .filter((i) => isZentoryFoodItem(i, menu))
    .map((i) => `${i.productId || i.id}:${Number(i.qty) || 0}:${Number(i.price ?? i.unitPrice) || 0}`)
    .sort()
    .join("|");
}

/**
 * Decide what an edit means for Zentory and return the row fields to write with it.
 * - items changed → void the old Zentory sale and post the edit under a new revision id
 * - only payment / customer changed on a synced sale → re-stamp the existing Zentory sale
 */
export function planZentoryEdit({ date, id, before, after, menu = [] }) {
  if (ZENTORY.PUSH_SALES === false || !before) return { mode: "none", fields: {} };
  const status = before.zentorySyncStatus || (before.zentorySaleId ? "ok" : null);
  const wasPosted = !!before.zentorySaleId || ["ok", "pending", "failed"].includes(status);
  const itemsChanged = zentoryLinesKey(before.items, menu) !== zentoryLinesKey(after.items, menu);
  const hasZentoryItems = (after.items || []).some((i) => isZentoryFoodItem(i, menu));

  if (itemsChanged && (wasPosted || hasZentoryItems)) {
    const rev = (Number(before.zentoryRev) || 0) + 1;
    const oldExt = zentoryExternalIdFor(date, id, before);
    const fields = {
      zentoryRev: rev,
      zentoryExternalId: `food_sales/${date}/${id}#r${rev}`,
      zentorySyncStatus: "pending",
      zentorySyncError: null,
      zentoryBlocked: null,
      zentoryAttemptAt: Date.now(),
      zentoryAttempts: 0,
    };
    if (wasPosted) {
      fields.zentoryVoidExternalId = before.zentoryVoidExternalId || oldExt;
      fields.zentoryVoidCredit = before.zentoryVoidExternalId
        ? Number(before.zentoryVoidCredit) || 0
        : Number(before.credit) || 0;
    }
    return { mode: "repost", fields };
  }

  const paymentChanged =
    (Number(before.cash) || 0) !== (Number(after.cash) || 0) ||
    (Number(before.upi) || 0) !== (Number(after.upi) || 0) ||
    (Number(before.credit) || 0) !== (Number(after.credit) || 0) ||
    (before.customerName || before.member || "") !== (after.customerName || "");
  if (paymentChanged && status === "ok" && before.zentorySaleId) {
    return { mode: "restamp", fields: {} };
  }
  return { mode: "none", fields: {} };
}

/** Push an edit's new payment split / customer onto the Zentory sale that is already there. */
export async function restampZentorySale({ date, id, before, after }) {
  try {
    await recordZentorySaleFinance({
      saleId: before.zentorySaleId,
      externalId: zentoryExternalIdFor(date, id, before),
      customerName: after.customerName || "Walk-in",
      cash: Number(after.cash) || 0,
      upi: Number(after.upi) || 0,
      credit: Number(after.credit) || 0,
      paymentMode: after.paymentMode,
      items: after.items || [],
      soldAt: new Date(after.timestamp || Date.now()).toISOString(),
      receiptNumber: before.zentoryReceipt || "",
      previousCredit: Number(before.credit) || 0,
    });
    return { ok: true };
  } catch (e) {
    console.warn("[Zentory] re-stamp failed:", e.message);
    return { ok: false, error: e.message };
  }
}

async function voidAndClearCredit(externalId, credit) {
  const z = await voidZentorySale(externalId);
  if (!z.ok && !/not found/i.test(z.error || "")) throw new Error(z.error || "Zentory void failed");
  if (Number(credit) > 0.001) await zeroZentorySaleCredit(externalId);
}

function zentorySyncFields(result) {
  if (!result || result.skipped) {
    return {
      zentorySyncStatus: "skipped",
      zentorySyncError: null,
      zentoryBlocked: null,
      zentorySaleId: null,
      zentoryReceipt: null,
    };
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
  if (sale.zentoryVoidExternalId) {
    try {
      await voidAndClearCredit(sale.zentoryVoidExternalId, sale.zentoryVoidCredit);
      await saleRef.update({ zentoryVoidExternalId: null, zentoryVoidCredit: null });
    } catch (e) {
      const result = { ok: false, error: `Old version not reversed: ${e.message}` };
      await saleRef.update(zentorySyncFields(result)).catch(() => {});
      return result;
    }
  }

  const externalId = zentoryExternalIdFor(date, id, sale);
  const items = (sale.items || []).filter((i) => isZentoryFoodItem(i, menu));
  if (!items.length) {
    await saleRef.update(zentorySyncFields({ skipped: true })).catch(() => {});
    return { ok: true, skipped: true };
  }
  const result = await postZentorySale({
    externalId,
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
    // Deleted or edited again while this post was in flight: take it back out.
    const current = (await saleRef.once("value")).val();
    if (!current || zentoryExternalIdFor(date, id, current) !== externalId) {
      if (result.ok) await voidAndClearCredit(externalId, sale.credit);
      return { ok: true, superseded: true };
    }
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
