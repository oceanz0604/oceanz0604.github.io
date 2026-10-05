/**
 * Food-sale accounts on Zentory.
 * POS revenue is the sale document (reports). Credit customers are Khata.
 * Document ids are a hash of the cafe external id so a retry updates the same entry.
 */

import { ZENTORY } from "./config.js";

const FS_BASE = "https://firestore.googleapis.com/v1/projects/inventory-management-oceanz/databases/(default)/documents";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function zentoryPartyId(name) {
  const s = String(name || "Walk-in")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "walk_in";
}

export async function zentoryKhataDocId(externalId) {
  const data = new TextEncoder().encode(String(externalId));
  const buf = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `kh_${hex.slice(0, 20)}`;
}

export function zentoryPayments({ cash, upi, credit, paymentMode, total = 0 } = {}) {
  let c = round2(cash);
  let u = round2(upi);
  let r = round2(credit);
  if (c + u + r <= 0.001) {
    const method = String(paymentMode || "cash").toLowerCase();
    const all = round2(total);
    if (method === "upi") u = all;
    else if (method === "credit") r = all;
    else c = all;
  }
  const parts = [c, u, r].filter((n) => n > 0.001).length;
  let paymentMethod = "cash";
  if (parts > 1) paymentMethod = "split";
  else if (r > 0) paymentMethod = "credit";
  else if (u > 0) paymentMethod = "upi";
  return { cash: c, upi: u, credit: r, paymentMethod };
}

function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) continue;
      fields[k] = encodeValue(val);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

async function writeDoc(collection, id, data, { create = true } = {}) {
  const fields = {};
  for (const [k, val] of Object.entries(data)) {
    if (val === undefined) continue;
    fields[k] = encodeValue(val);
  }
  const mask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");
  const patch = await fetch(`${FS_BASE}/${collection}/${encodeURIComponent(id)}?${mask}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (patch.ok) return;
  if (patch.status === 404 && !create) return;
  if (patch.status === 404 && create) {
    const created = await fetch(`${FS_BASE}/${collection}?documentId=${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    if (created.ok) return;
    const text = await created.text();
    throw new Error(text || `Zentory finance create ${created.status}`);
  }
  const text = await patch.text();
  throw new Error(text || `Zentory finance update ${patch.status}`);
}

async function writeKhata({ externalId, partyName, type, amount, soldAt, description, saleExternalId }) {
  const id = await zentoryKhataDocId(externalId);
  const name = partyName || "Walk-in";
  await writeDoc("khata", id, {
    id,
    ownerId: ZENTORY.OWNER_ID,
    partyId: zentoryPartyId(name),
    partyName: name,
    type,
    amount: round2(amount),
    description: description || "",
    externalId,
    saleExternalId: saleExternalId || "",
    entryNumber: `KH-${id.slice(3, 9).toUpperCase()}`,
    createdAt: soldAt || new Date().toISOString(),
  });
  return id;
}

/** Stamp the Zentory sale with the real day and payment split, and open Khata for credit. */
export async function recordZentorySaleFinance({
  saleId,
  externalId,
  customerName,
  cash,
  upi,
  credit,
  paymentMode,
  items,
  soldAt,
  receiptNumber,
}) {
  if (!saleId) throw new Error("Zentory sale id missing");
  const total = (items || []).reduce(
    (sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price ?? item.unitPrice) || 0),
    0
  );
  const pay = zentoryPayments({ cash, upi, credit, paymentMode, total });
  const createdAt = soldAt || new Date().toISOString();
  const name = customerName || "Walk-in";
  await writeDoc("pos_sales", saleId, {
    createdAt,
    paymentMethod: pay.paymentMethod,
    cash: pay.cash,
    upi: pay.upi,
    credit: pay.credit,
    customerName: name,
  });
  if (pay.credit > 0.001) {
    await writeKhata({
      externalId: `${externalId}#credit`,
      saleExternalId: externalId,
      partyName: name,
      type: "credit",
      amount: pay.credit,
      soldAt: createdAt,
      description: `Food sale ${receiptNumber || ""}`.trim(),
    });
  }
  return pay;
}

/** Khata debit when cafe credit is collected. Amount is the day's collected total, not a delta. */
export async function recordZentoryCreditCollection({
  externalId,
  partyName,
  amount,
  soldAt,
  description,
}) {
  const value = round2(amount);
  if (value <= 0.001) return null;
  return writeKhata({
    externalId,
    saleExternalId: externalId.split("#")[0],
    partyName,
    type: "debit",
    amount: value,
    soldAt: soldAt || new Date().toISOString(),
    description: description || "Food credit collected",
  });
}

/** Drop Khata rows for a deleted food sale so the customer balance does not keep the credit. */
export async function clearZentoryFoodFinance(externalId, sale = {}) {
  const issued = round2(sale.credit);
  const paid = round2(sale.creditPaid);
  if (issued <= 0.001 && paid <= 0.001) return;
  const name = sale.customerName || sale.memberName || "Walk-in";
  if (issued > 0.001) {
    await writeKhata({
      externalId: `${externalId}#credit`,
      saleExternalId: externalId,
      partyName: name,
      type: "credit",
      amount: 0,
      soldAt: new Date().toISOString(),
      description: "Food sale deleted",
    });
  }
  const payments = sale.creditPayments && typeof sale.creditPayments === "object" ? sale.creditPayments : {};
  const dates = Object.keys(payments);
  for (const date of dates) {
    await writeKhata({
      externalId: `${externalId}#collect#${date}`,
      saleExternalId: externalId,
      partyName: name,
      type: "debit",
      amount: 0,
      soldAt: new Date().toISOString(),
      description: `Food credit collection removed ${date}`,
    });
  }
  if (!dates.length && paid > 0.001) {
    await writeKhata({
      externalId: `${externalId}#collect#legacy`,
      saleExternalId: externalId,
      partyName: name,
      type: "debit",
      amount: 0,
      soldAt: new Date().toISOString(),
      description: "Food credit collection removed",
    });
  }
}
