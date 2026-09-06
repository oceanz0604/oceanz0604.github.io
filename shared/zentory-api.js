/**
 * OceanZ cafe → Zentory inventory HTTP client
 * Catalog + dual-write POS sales (stock owned by Zentory).
 */

import { ZENTORY } from "./config.js";

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

/** Load sellable products (+ stock) for Cafe Counter. */
export async function fetchZentoryProducts() {
  const q = new URLSearchParams({
    ownerId: ZENTORY.OWNER_ID,
    locationId: ZENTORY.LOCATION_ID,
  });
  const data = await zentoryFetch(`/api/products?${q}`);
  return Array.isArray(data.products) ? data.products : [];
}

export function mapZentoryPayment(paymentMode) {
  const m = String(paymentMode || "cash").toLowerCase();
  if (m === "upi") return "upi";
  if (m === "card") return "card";
  return "cash"; // cash | credit | split
}

/**
 * Post sale to Zentory after cafe food_sales write.
 * Soft-fails — never blocks cafe till money.
 */
export async function postZentorySale({
  externalId,
  customerName,
  paymentMode,
  items,
  staff,
  note = "",
}) {
  try {
    const payload = {
      externalId,
      channel: ZENTORY.CHANNEL || "oceanz_cafe",
      ownerId: ZENTORY.OWNER_ID,
      locationId: ZENTORY.LOCATION_ID,
      customerName: customerName || "Walk-in",
      paymentMethod: mapZentoryPayment(paymentMode),
      items: (items || []).map((i) => ({
        productId: i.productId || i.id,
        qty: Number(i.qty) || 0,
        unitPrice: Number(i.price) || 0,
        cafeExternalId: i.cafeExternalId || null,
      })),
      staff: staff || null,
      note,
    };
    const data = await zentoryFetch("/api/sales", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return {
      ok: true,
      saleId: data.saleId,
      receiptNumber: data.receiptNumber,
      idempotent: !!data.idempotent,
    };
  } catch (e) {
    console.warn("[Zentory] sale post failed:", e.message);
    return { ok: false, error: e.message };
  }
}

export async function voidZentorySale(externalId) {
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
