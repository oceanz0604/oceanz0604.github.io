/**
 * Post October food sales that were saved in OceanZ while Zentory posting was paused.
 * Safe to re-run: Zentory treats externalId as idempotent, and Khata ids are stable.
 *
 *   node scripts/backfill-zentory-october.mjs
 */
import { BOOKING_DB_CONFIG } from "../shared/config.js";
import { postZentoryKhata, postZentorySale } from "../shared/zentory-api.js";

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

const summary = { posted: 0, already: 0, blocked: 0, failed: 0, financeFailed: 0, cafeMarked: 0, problems: [] };

for (const date of DATES) {
  const rows = await loadDay(date);
  for (const { id, sale } of rows) {
    const externalId = `food_sales/${date}/${id}`;
    const items = Array.isArray(sale.items) ? sale.items : [];
    const result = await postZentorySale({
      externalId,
      customerName: sale.customerName || "Walk-in",
      paymentMode: sale.paymentMode,
      cash: sale.cash,
      upi: sale.upi,
      credit: sale.credit,
      soldAt: soldAt(sale, date),
      items,
      staff: sale.staffName || sale.admin || "OceanZ",
      note: sale.note || "OceanZ October backfill",
    });
    if (!result.ok) {
      if (result.blocked) summary.blocked += 1;
      else summary.failed += 1;
      summary.problems.push({ date, id, error: result.error, missing: result.missingIngredient || null });
      console.log("FAIL", date, id, result.error);
      continue;
    }
    if (result.idempotent) summary.already += 1;
    else summary.posted += 1;
    if (result.financeOk === false) {
      summary.financeFailed += 1;
      summary.problems.push({ date, id, error: result.financeError, saleId: result.saleId });
      console.log("FINANCE", date, id, result.financeError);
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
        zentorySyncError: result.financeError || null,
      });
      summary.cafeMarked += 1;
    } catch (e) {
      summary.problems.push({ date, id, error: `cafe mark: ${e.message}`, saleId: result.saleId });
      console.log("MARK", date, id, e.message);
    }
    console.log(result.idempotent ? "AGAIN" : "OK", date, id, result.saleId);
  }
}

console.log(JSON.stringify(summary, null, 2));
if (summary.blocked || summary.failed) process.exitCode = 1;
