/**
 * Post October food sales that were saved in OceanZ while Zentory posting was paused.
 * Sales already deducted from lots are left alone. The rest are written to Zentory
 * reports and Khata without taking more stock, because current lots cannot cover them.
 * Safe to re-run: booked sale ids and Khata ids are stable.
 *
 *   node scripts/backfill-zentory-october.mjs
 */
import { BOOKING_DB_CONFIG } from "../shared/config.js";
import { postZentoryKhata } from "../shared/zentory-api.js";
import { bookHistoricalFoodSale } from "../shared/zentory-finance.js";

const FS = "https://firestore.googleapis.com/v1/projects/inventory-management-oceanz/databases/(default)/documents";

const DATES = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];

function asIso(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const n = Number(value);
    if (n > 100000000000) return new Date(n).toISOString();
  }
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? fallback : t.toISOString();
}

function soldAt(sale, date) {
  return asIso(sale.timestamp, new Date(`${date}T12:00:00+05:30`).toISOString());
}

async function loadDay(date) {
  const url = `${BOOKING_DB_CONFIG.databaseURL}/food_sales/${date}.json?auth=${BOOKING_DB_CONFIG.apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`food_sales ${date} HTTP ${res.status}`);
  const data = await res.json();
  if (!data || typeof data !== "object") return [];
  return Object.entries(data).map(([id, sale]) => ({ id, sale }));
}

async function markCafeSale(date, id, fields) {
  const url = `${BOOKING_DB_CONFIG.databaseURL}/food_sales/${date}/${id}.json?auth=${BOOKING_DB_CONFIG.apiKey}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `cafe update HTTP ${res.status}`);
  }
}

function decodeFs(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeFs);
  if ("mapValue" in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = decodeFs(val);
    return out;
  }
  return null;
}

async function loadProducts() {
  const byId = {};
  let page = "";
  do {
    const url = `${FS}/products?pageSize=300` + (page ? `&pageToken=${encodeURIComponent(page)}` : "");
    const body = await (await fetch(url)).json();
    for (const doc of body.documents || []) {
      const row = {};
      for (const [k, v] of Object.entries(doc.fields || {})) row[k] = decodeFs(v);
      row.id = row.id || doc.name.split("/").pop();
      byId[row.id] = row;
    }
    page = body.nextPageToken || "";
  } while (page);
  return byId;
}

async function syncCollections(date, id, sale) {
  const name = sale.customerName || "Walk-in";
  const payments = sale.creditPayments && typeof sale.creditPayments === "object" ? sale.creditPayments : {};
  const days = Object.keys(payments);
  for (const day of days) {
    const p = payments[day] || {};
    const amount = (Number(p.cash) || 0) + (Number(p.upi) || 0);
    if (amount <= 0.001) continue;
    const khata = await postZentoryKhata({
      externalId: `food_sales/${date}/${id}#collect#${day}`,
      partyName: name,
      amount,
      soldAt: asIso(p.at, new Date(`${day}T18:00:00+05:30`).toISOString()),
      description: `Food credit collected ${day}`,
    });
    if (khata && khata.ok === false) {
      throw new Error(khata.error || "khata collection failed");
    }
  }
  const paid = Number(sale.creditPaid) || 0;
  if (!days.length && paid > 0.001) {
    const khata = await postZentoryKhata({
      externalId: `food_sales/${date}/${id}#collect#legacy`,
      partyName: name,
      amount: Math.min(paid, Number(sale.credit) || paid),
      soldAt: asIso(sale.lastPaidAt, soldAt(sale, date)),
      description: "Food credit collected",
    });
    if (khata && khata.ok === false) throw new Error(khata.error || "khata collection failed");
  }
}

const summary = { alreadyDeducted: 0, booked: 0, financeFailed: 0, cafeMarked: 0, problems: [] };
const productsById = await loadProducts();

for (const date of DATES) {
  const rows = await loadDay(date);
  for (const { id, sale } of rows) {
    const externalId = `food_sales/${date}/${id}`;
    if (sale.zentorySyncStatus === "ok" && sale.zentorySaleId) {
      summary.alreadyDeducted += 1;
      console.log("SKIP", date, id);
      continue;
    }
    const items = Array.isArray(sale.items) ? sale.items : [];
    let result;
    try {
      result = await bookHistoricalFoodSale({
        externalId,
        customerName: sale.customerName || "Walk-in",
        paymentMode: sale.paymentMode,
        cash: sale.cash,
        upi: sale.upi,
        credit: sale.credit,
        soldAt: soldAt(sale, date),
        items,
        staff: sale.staffName || sale.admin || "OceanZ",
        note: "OceanZ October backfill. Lots were short, so this sale is on the books only.",
        productsById,
      });
      summary.booked += 1;
    } catch (e) {
      summary.financeFailed += 1;
      summary.problems.push({ date, id, error: e.message });
      console.log("FAIL", date, id, e.message);
      continue;
    }
    try {
      await syncCollections(date, id, sale);
    } catch (e) {
      summary.financeFailed += 1;
      summary.problems.push({ date, id, error: e.message, saleId: result.saleId });
      console.log("KHATA", date, id, e.message);
    }
    try {
      await markCafeSale(date, id, {
        zentorySaleId: result.saleId || null,
        zentoryReceipt: result.receiptNumber || null,
        zentorySyncStatus: "ok",
        zentorySyncError: "On Zentory reports and Khata. Stock was not deducted because lots were short.",
      });
      summary.cafeMarked += 1;
    } catch (e) {
      summary.problems.push({ date, id, error: `cafe mark: ${e.message}`, saleId: result.saleId });
      console.log("MARK", date, id, e.message);
    }
    console.log("BOOK", date, id, result.saleId);
  }
}

console.log(JSON.stringify(summary, null, 2));
if (summary.financeFailed) process.exitCode = 1;
