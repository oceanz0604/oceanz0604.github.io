/**
 * Post October food sales into Zentory through today.
 * Sales that already deducted finished-goods stock are left alone.
 * Make-to-order lines follow the company setting (no raw-lot deduction when tracking is off).
 * A sale that still cannot be filled because a simple SKU is short is written to reports and Khata only.
 *
 *   node scripts/backfill-zentory-october.mjs
 */
import { BOOKING_DB_CONFIG, ZENTORY } from "../shared/config.js";
import { postZentoryKhata, postZentorySale } from "../shared/zentory-api.js";
import { bookHistoricalFoodSale } from "../shared/zentory-finance.js";

const FS = "https://firestore.googleapis.com/v1/projects/inventory-management-oceanz/databases/(default)/documents";

const DATES = Array.from({ length: 15 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

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

function booksOnly(sale) {
  return String(sale.zentorySyncError || "").includes("not deducted");
}

async function deleteZentorySale(saleId) {
  const res = await fetch(`${FS}/pos_sales/${encodeURIComponent(saleId)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(await res.text() || `delete ${saleId} HTTP ${res.status}`);
  }
}

async function loadCatalog() {
  const q = new URLSearchParams({ ownerId: ZENTORY.OWNER_ID, locationId: ZENTORY.LOCATION_ID });
  const res = await fetch(`${ZENTORY.API_BASE}/api/products?${q}`, {
    headers: { "X-Zentory-Key": ZENTORY.API_KEY },
  });
  if (!res.ok) throw new Error(`products HTTP ${res.status}`);
  const data = await res.json();
  const products = Array.isArray(data.products) ? data.products : [];
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const stock = new Map(products.map((p) => [p.id, Number(p.stock) || 0]));
  return { byId, stock };
}

function saleNeeds(items, byId) {
  const need = new Map();
  for (const item of items) {
    const id = item.productId || item.id;
    const product = byId[id];
    if (!product) return { ok: false, reason: `Unknown product ${item.name || id}` };
    if (product.ingredientStockTracked === false) continue;
    need.set(id, (need.get(id) || 0) + (Number(item.qty) || 0));
  }
  return { ok: true, need };
}

function stockCovers(need, stock) {
  for (const [id, qty] of need) {
    if ((stock.get(id) || 0) + 1e-6 < qty) return id;
  }
  return null;
}

const summary = { alreadyPosted: 0, posted: 0, booked: 0, financeFailed: 0, cafeMarked: 0, problems: [] };
const productsById = await loadProducts();
const catalog = await loadCatalog();

for (const date of DATES) {
  const rows = await loadDay(date);
  for (const { id, sale } of rows) {
    const externalId = `food_sales/${date}/${id}`;
    const items = Array.isArray(sale.items) ? sale.items : [];
    const placeholder = booksOnly(sale);
    if (sale.zentorySyncStatus === "ok" && sale.zentorySaleId && !placeholder) {
      summary.alreadyPosted += 1;
      console.log("SKIP", date, id);
      continue;
    }

    const checked = saleNeeds(items, catalog.byId);
    const shortId = checked.ok ? stockCovers(checked.need, catalog.stock) : checked.reason;
    const canPost = checked.ok && !shortId;

    const payload = {
      externalId,
      customerName: sale.customerName || "Walk-in",
      paymentMode: sale.paymentMode,
      cash: sale.cash,
      upi: sale.upi,
      credit: sale.credit,
      soldAt: soldAt(sale, date),
      items,
      staff: sale.staffName || sale.admin || "OceanZ",
    };

    let result;
    let books = false;
    try {
      if (canPost) {
        if (placeholder && sale.zentorySaleId) await deleteZentorySale(sale.zentorySaleId);
        result = await postZentorySale({ ...payload, note: sale.note || "OceanZ October backfill" });
        if (!result.ok) throw new Error(result.error || "Zentory sale failed");
        for (const [pid, qty] of checked.need) {
          catalog.stock.set(pid, (catalog.stock.get(pid) || 0) - qty);
        }
        summary.posted += 1;
      } else {
        const reason = checked.ok ? (catalog.byId[shortId]?.name || shortId) : shortId;
        if (placeholder) {
          summary.booked += 1;
          console.log("KEEP", date, id, reason);
          continue;
        }
        result = await bookHistoricalFoodSale({
          ...payload,
          note: `OceanZ October backfill. ${reason} was short, so stock was not deducted.`,
          productsById,
        });
        books = true;
        summary.booked += 1;
        summary.problems.push({ date, id, error: `short: ${reason}` });
      }
    } catch (e) {
      summary.financeFailed += 1;
      summary.problems.push({ date, id, error: e.message });
      console.log("FAIL", date, id, e.message);
      if (placeholder) {
        try {
          await bookHistoricalFoodSale({
            ...payload,
            note: "OceanZ October backfill. Lots were short, so this sale is on the books only.",
            productsById,
          });
        } catch (err) {
          console.log("REBOOK", date, id, err.message);
        }
      }
      continue;
    }

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
        zentorySyncError: books ? "On Zentory reports and Khata. Stock was not deducted because a finished item was short." : null,
      });
      summary.cafeMarked += 1;
    } catch (e) {
      summary.problems.push({ date, id, error: `cafe mark: ${e.message}`, saleId: result.saleId });
      console.log("MARK", date, id, e.message);
    }
    console.log(books ? "BOOK" : "POST", date, id, result.saleId);
  }
}

console.log(JSON.stringify(summary, null, 2));
if (summary.financeFailed) process.exitCode = 1;
