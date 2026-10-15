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
 * 409 / ingredient shortage → blocked: true (do not write cafe till).
 * Network / 5xx → ok: false so cafe can still save and flag the row.
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

/** Apply Zentory result onto a cafe food_sales record. Throws when shortage blocked the sale. */
export function applyZentorySaleResult(saleData, zResult) {
  if (!zResult) return saleData;
  if (zResult.skipped) {
    saleData.zentorySyncStatus = "skipped";
    saleData.zentorySyncError = null;
    return saleData;
  }
  if (zResult.ok) {
    saleData.zentorySaleId = zResult.saleId || null;
    saleData.zentoryReceipt = zResult.receiptNumber || null;
    saleData.zentorySyncStatus = "ok";
    saleData.zentorySyncError = null;
    return saleData;
  }
  if (zResult.blocked) {
    const err = new Error(zResult.error || "Not enough ingredients to make this item");
    err.blocked = true;
    throw err;
  }
  saleData.zentorySyncStatus = "failed";
  saleData.zentorySyncError = zResult.error || "Zentory unavailable";
  return saleData;
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
