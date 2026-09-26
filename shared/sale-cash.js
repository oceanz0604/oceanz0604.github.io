/**
 * Cash / credit-collection math shared by Recharges and Cash Register.
 * Upfront cash+upi on a sale and later credit collections must not be added
 * twice, and collections must not push the counted total past the sale total.
 */

export function sumCreditPayments(record) {
  const payments = record?.creditPayments;
  let cash = 0;
  let upi = 0;
  if (payments && typeof payments === "object") {
    Object.values(payments).forEach((p) => {
      if (!p || typeof p !== "object") return;
      cash += Number(p.cash) || 0;
      upi += Number(p.upi) || 0;
    });
  }
  return { cash, upi };
}

function legacyCollection(record) {
  if (record?.creditPayments && Object.keys(record.creditPayments).length) {
    return null;
  }
  if (record?.lastPaidAt && ((Number(record.lastPaidCash) || 0) || (Number(record.lastPaidUpi) || 0))) {
    return {
      date: String(record.lastPaidAt).slice(0, 10),
      cash: Number(record.lastPaidCash) || 0,
      upi: Number(record.lastPaidUpi) || 0,
    };
  }
  if (
    record?.paidAt &&
    record?.mode === "credit" &&
    record?.paid &&
    !record?.lastPaidCash &&
    !record?.lastPaidUpi
  ) {
    const amount = Number(record.amount) || 0;
    let cash = 0;
    let upi = 0;
    if (record.paidVia === "upi") upi = amount;
    else if (record.paidVia === "cash+upi") {
      cash = Math.floor(amount / 2);
      upi = amount - cash;
    } else cash = amount;
    return { date: String(record.paidAt).slice(0, 10), cash, upi };
  }
  return null;
}

/** Direct cash/upi stored on the sale itself (not later credit collection). */
export function upfrontCashUpi(record = {}) {
  const total = Number(record.total ?? record.amount ?? 0) || 0;

  if (record.cash !== undefined || record.upi !== undefined || record.total !== undefined) {
    let cash = Number(record.cash) || 0;
    let upi = Number(record.upi) || 0;
    if (record.cash === undefined && record.upi === undefined) {
      if (record.paymentMode === "cash") cash = total;
      else if (record.paymentMode === "upi") upi = total;
      else if (record.paymentMode === "split") {
        cash = Number(record.cashAmount) || 0;
        upi = Number(record.upiAmount) || 0;
      }
    }
    return { cash, upi, total };
  }

  if (record.mode === "cash") return { cash: total, upi: 0, total };
  if (record.mode === "upi") return { cash: 0, upi: total, total };
  return { cash: 0, upi: 0, total };
}

function collectionScale(record) {
  const { cash, upi, total } = upfrontCashUpi(record);
  if (total <= 0) return 1;
  const payments = sumCreditPayments(record);
  let allCash = payments.cash;
  let allUpi = payments.upi;
  const legacy = legacyCollection(record);
  if (legacy) {
    allCash = legacy.cash;
    allUpi = legacy.upi;
  }
  const allSum = allCash + allUpi;
  const budget = Math.max(0, total - cash - upi);
  if (allSum <= 0 || allSum <= budget + 0.001) return 1;
  return budget / allSum;
}

/**
 * Cash/upi from credit collection that should count on `dateStr`.
 * Scaled down when upfront cash/upi already includes that money.
 */
export function countableCollectionOnDate(record, dateStr) {
  if (!record || !dateStr) return { cash: 0, upi: 0 };

  let todayCash = 0;
  let todayUpi = 0;
  const payments = record.creditPayments;
  if (payments && typeof payments === "object" && payments[dateStr] && typeof payments[dateStr] === "object") {
    todayCash = Number(payments[dateStr].cash) || 0;
    todayUpi = Number(payments[dateStr].upi) || 0;
  } else {
    const legacy = legacyCollection(record);
    if (legacy && legacy.date === dateStr) {
      todayCash = legacy.cash;
      todayUpi = legacy.upi;
    }
  }

  const scale = collectionScale(record);
  return {
    cash: Math.round(todayCash * scale * 100) / 100,
    upi: Math.round(todayUpi * scale * 100) / 100,
  };
}

/**
 * Shrink stored creditPayments so upfront cash+upi + collections <= sale total,
 * and collected credit does not exceed the credit still on the sale.
 * Returns null payments when nothing collected remains (Firebase delete).
 */
export function fitCollectionsToSale({
  total = 0,
  cash = 0,
  upi = 0,
  credit = 0,
  creditPaid = 0,
  creditPayments = null,
} = {}) {
  const saleTotal = Number(total) || 0;
  const upfrontCash = Number(cash) || 0;
  const upfrontUpi = Number(upi) || 0;
  const issued = Math.max(0, Number(credit) || 0);
  const room = Math.max(0, saleTotal - upfrontCash - upfrontUpi);
  const maxCollect = Math.min(issued, room);

  const entries = Object.entries(creditPayments || {})
    .filter(([, p]) => p && typeof p === "object")
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  let keptCash = 0;
  let keptUpi = 0;
  const next = {};
  entries.forEach(([date, p]) => {
    let c = Number(p.cash) || 0;
    let u = Number(p.upi) || 0;
    const sum = keptCash + keptUpi;
    const space = Math.max(0, maxCollect - sum);
    const slice = c + u;
    if (space <= 0 || slice <= 0) return;
    if (slice > space) {
      const scale = space / slice;
      c = Math.round(c * scale * 100) / 100;
      u = Math.round((space - c) * 100) / 100;
    }
    if (c + u <= 0) return;
    next[date] = { ...p, cash: c, upi: u };
    keptCash += c;
    keptUpi += u;
  });

  const collected = Math.round((keptCash + keptUpi) * 100) / 100;
  const dates = Object.keys(next);
  const last = dates.length ? next[dates[dates.length - 1]] : null;

  return {
    creditPaid: collected,
    creditPayments: dates.length ? next : null,
    lastPaidCash: last ? (Number(last.cash) || 0) : 0,
    lastPaidUpi: last ? (Number(last.upi) || 0) : 0,
    clearLastPaid: !dates.length,
  };
}
