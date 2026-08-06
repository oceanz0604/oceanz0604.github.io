/**
 * OceanZ Gaming Cafe - Shared Food Sales Stats
 *
 * Pure aggregators used by Food Analytics, Finance, Analytics, and Recharges.
 * Keep payment math identical across all pages.
 */

export const FOOD_CUSTOMER_TYPES = {
  MEMBER: "member",
  PC: "pc",
  WALKIN: "walkin"
};

export const FOOD_SALE_SOURCES = {
  POS: "pos",
  RECHARGES: "recharges"
};

/**
 * Normalize a food sale for display / aggregation (backward compatible).
 * @param {object} sale
 * @returns {object}
 */
export function normalizeFoodSale(sale = {}) {
  const customerType =
    sale.customerType ||
    (sale.pcName ? FOOD_CUSTOMER_TYPES.PC :
      sale.memberId || sale.memberName ? FOOD_CUSTOMER_TYPES.MEMBER :
        FOOD_CUSTOMER_TYPES.WALKIN);

  const displayName =
    sale.customerName ||
    sale.memberName ||
    sale.pcName ||
    "Walk-in";

  return {
    ...sale,
    customerType,
    customerName: displayName,
    memberId: sale.memberId || null,
    memberName: sale.memberName || (customerType === FOOD_CUSTOMER_TYPES.MEMBER ? displayName : null),
    pcName: sale.pcName || (customerType === FOOD_CUSTOMER_TYPES.PC ? displayName : null),
    source: sale.source || FOOD_SALE_SOURCES.POS,
    items: Array.isArray(sale.items) ? sale.items : [],
    total: Number(sale.total) || 0,
    paymentMode: sale.paymentMode || "cash",
    cashAmount: Number(sale.cashAmount) || 0,
    upiAmount: Number(sale.upiAmount) || 0,
    creditAmount: Number(sale.creditAmount) || 0,
    timestamp: sale.timestamp || 0,
    note: sale.note || ""
  };
}

/**
 * Cash / UPI collected from a single sale (credit not included until paid).
 * Prefers recharge-style ledger fields (cash/upi/credit) when present.
 * @param {object} sale
 * @returns {Object} amounts with cash, upi, credit, and total
 */
export function getSaleCollectedAmounts(sale) {
  const s = normalizeFoodSale(sale);

  // New ledger format (aligned with gaming recharges)
  if (sale.cash !== undefined || sale.upi !== undefined || sale.credit !== undefined) {
    return {
      cash: Number(sale.cash) || 0,
      upi: Number(sale.upi) || 0,
      credit: Number(sale.credit) || 0,
      total: Number(sale.total) || s.total || 0
    };
  }

  let cash = 0;
  let upi = 0;
  let credit = 0;

  if (s.paymentMode === "cash") {
    cash = s.total;
  } else if (s.paymentMode === "upi") {
    upi = s.total;
  } else if (s.paymentMode === "split") {
    cash = s.cashAmount;
    upi = s.upiAmount;
    credit = s.creditAmount;
  } else if (s.paymentMode === "credit") {
    credit = s.creditAmount || s.total;
  }

  return { cash, upi, credit, total: s.total };
}

/**
 * Aggregate food sales + credit payments for a period.
 * @param {Array} sales - flat list with { date, ...sale }
 * @param {Array} creditPayments - flat list with { date, cash, upi, total }
 * @param {Array} creditRecords - outstanding credit records { outstanding }
 * @returns {object}
 */
export function aggregateFoodStats(sales = [], creditPayments = [], creditRecords = []) {
  let totalSales = 0;
  let cashCollected = 0;
  let upiCollected = 0;
  let creditIssued = 0;
  let saleCount = 0;

  const byDate = {};
  const itemCounts = {};

  sales.forEach(raw => {
    const sale = normalizeFoodSale(raw);
    const amounts = getSaleCollectedAmounts(sale);

    totalSales += amounts.total;
    cashCollected += amounts.cash;
    upiCollected += amounts.upi;
    creditIssued += amounts.credit;
    saleCount += 1;

    const dateKey = sale.date || "unknown";
    if (!byDate[dateKey]) {
      byDate[dateKey] = { total: 0, cash: 0, upi: 0, credit: 0, count: 0 };
    }
    byDate[dateKey].total += amounts.total;
    byDate[dateKey].cash += amounts.cash;
    byDate[dateKey].upi += amounts.upi;
    byDate[dateKey].credit += amounts.credit;
    byDate[dateKey].count += 1;

    sale.items.forEach(item => {
      const key = item.name || "Item";
      if (!itemCounts[key]) {
        itemCounts[key] = { name: key, qty: 0, revenue: 0 };
      }
      const qty = Number(item.qty) || 1;
      const price = Number(item.price) || 0;
      itemCounts[key].qty += qty;
      itemCounts[key].revenue += price * qty;
    });
  });

  creditPayments.forEach(payment => {
    cashCollected += Number(payment.cash) || 0;
    upiCollected += Number(payment.upi) || 0;
  });

  const creditsOutstanding = creditRecords.reduce(
    (sum, c) => sum + (Number(c.outstanding) || 0),
    0
  );

  const topItems = Object.values(itemCounts)
    .sort((a, b) => b.revenue - a.revenue);

  return {
    totalSales,
    cashCollected,
    upiCollected,
    creditIssued,
    creditsOutstanding,
    collectedTotal: cashCollected + upiCollected,
    saleCount,
    byDate,
    topItems
  };
}

/**
 * Flatten food_sales/{date}/{id} map into an array for a date range.
 * @param {object} salesByDate - Firebase tree keyed by YYYY-MM-DD
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Array}
 */
export function flattenFoodSalesByDate(salesByDate = {}, startDate = "", endDate = "") {
  const list = [];
  Object.entries(salesByDate).forEach(([date, daySales]) => {
    if (startDate && date < startDate) return;
    if (endDate && date > endDate) return;
    if (!daySales || typeof daySales !== "object") return;
    Object.entries(daySales).forEach(([id, sale]) => {
      list.push(normalizeFoodSale({ id, date, ...sale }));
    });
  });
  list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return list;
}

/**
 * Flatten food_credit_payments/{date}/{id} for a date range.
 */
export function flattenFoodCreditPayments(paymentsByDate = {}, startDate = "", endDate = "") {
  const list = [];
  Object.entries(paymentsByDate).forEach(([date, dayPayments]) => {
    if (startDate && date < startDate) return;
    if (endDate && date > endDate) return;
    if (!dayPayments || typeof dayPayments !== "object") return;
    Object.entries(dayPayments).forEach(([id, payment]) => {
      list.push({ id, date, ...payment });
    });
  });
  return list;
}

/**
 * Sum food expenses from finance expense list.
 * @param {Array} expenses
 * @param {string[]} foodCategoryIds
 */
export function sumFoodExpenses(expenses = [], foodCategoryIds = ["food_purchase", "food_supplies"]) {
  const set = new Set(foodCategoryIds);
  let total = 0;
  let cash = 0;
  let online = 0;

  expenses.forEach(exp => {
    if (!set.has(exp.category)) return;
    const amount = Number(exp.amount) || ((Number(exp.cash) || 0) + (Number(exp.online) || 0));
    total += amount;
    cash += Number(exp.cash) || 0;
    online += Number(exp.online) || 0;
  });

  return { total, cash, online };
}

/**
 * Map any food sale (legacy POS or new ledger) into recharge-compatible payment fields.
 * @param {object} sale
 * @returns {object}
 */
export function foodSaleToLedger(sale = {}) {
  const normalized = normalizeFoodSale(sale);
  const amounts = getSaleCollectedAmounts(normalized);

  // Prefer explicit ledger fields when present (recharges-style)
  const hasLedger =
    sale.cash !== undefined ||
    sale.upi !== undefined ||
    sale.credit !== undefined ||
    sale.creditPaid !== undefined;

  const cash = hasLedger ? (Number(sale.cash) || 0) : amounts.cash;
  const upi = hasLedger ? (Number(sale.upi) || 0) : amounts.upi;
  const credit = hasLedger
    ? (Number(sale.credit) || 0)
    : (amounts.credit || (normalized.paymentMode === "credit" ? normalized.total : 0));
  const creditPaid = Number(sale.creditPaid) || 0;

  const member =
    sale.member ||
    normalized.customerName ||
    normalized.memberName ||
    normalized.pcName ||
    "Walk-in";

  const createdAt =
    sale.createdAt ||
    (sale.timestamp ? new Date(sale.timestamp).toISOString() : null);

  const itemsNote = (normalized.items || [])
    .map(i => `${i.qty || 1}× ${i.name}`)
    .join(", ");

  return {
    ...normalized,
    entryType: "food",
    member,
    total: Number(sale.total) || normalized.total || 0,
    cash,
    upi,
    credit,
    creditPaid,
    creditPayments: sale.creditPayments || {},
    free: 0,
    note: sale.note || itemsNote || "",
    admin: sale.admin || sale.staffName || "Admin",
    createdAt,
    items: normalized.items,
    pendingCredit: Math.max(0, credit - creditPaid)
  };
}

/**
 * Build recharge-style food sale write payload (cash/upi/credit + items).
 */
export function buildFoodLedgerSale({
  customerName,
  customerType = FOOD_CUSTOMER_TYPES.WALKIN,
  memberId = null,
  memberName = null,
  pcName = null,
  source = FOOD_SALE_SOURCES.RECHARGES,
  items = [],
  total = 0,
  cash = 0,
  upi = 0,
  credit = 0,
  note = "",
  admin = "Admin",
  staffId = "unknown",
  staffName = "Unknown",
  timestamp = Date.now(),
  creditPaid = 0,
  creditPayments = null
}) {
  const displayName = customerName || memberName || pcName || "Walk-in";
  let paymentMode = "cash";
  if (credit > 0 && cash === 0 && upi === 0) paymentMode = "credit";
  else if (credit > 0 || (cash > 0 && upi > 0)) paymentMode = "split";
  else if (upi > 0 && cash === 0) paymentMode = "upi";

  return {
    entryType: "food",
    member: displayName,
    customerName: displayName,
    customerType,
    memberId: memberId || null,
    memberName: memberName || null,
    pcName: pcName || null,
    source,
    items: items.map(item => ({
      id: item.id,
      name: item.name,
      price: Number(item.price) || 0,
      qty: Number(item.qty) || 1
    })),
    total: Number(total) || 0,
    cash: Number(cash) || 0,
    upi: Number(upi) || 0,
    credit: Number(credit) || 0,
    creditPaid: Number(creditPaid) || 0,
    creditPayments: creditPayments || {},
    free: 0,
    paymentMode,
    cashAmount: Number(cash) || 0,
    upiAmount: Number(upi) || 0,
    creditAmount: Number(credit) || 0,
    note: note || "",
    admin,
    staffId,
    staffName,
    timestamp,
    createdAt: new Date(timestamp).toISOString()
  };
}

/**
 * Backward-compatible POS payload builder.
 */
export function buildFoodSalePayload({
  customerName,
  customerType = FOOD_CUSTOMER_TYPES.WALKIN,
  memberId = null,
  memberName = null,
  pcName = null,
  source = FOOD_SALE_SOURCES.POS,
  items = [],
  total = 0,
  paymentMode = "cash",
  cashAmount = 0,
  upiAmount = 0,
  creditAmount = 0,
  staffId = "unknown",
  staffName = "Unknown",
  note = "",
  timestamp = Date.now()
}) {
  let cash = 0, upi = 0, credit = 0;
  if (paymentMode === "cash") cash = total;
  else if (paymentMode === "upi") upi = total;
  else if (paymentMode === "credit") credit = total;
  else if (paymentMode === "split") {
    cash = cashAmount;
    upi = upiAmount;
    credit = creditAmount;
  }

  return buildFoodLedgerSale({
    customerName,
    customerType,
    memberId,
    memberName,
    pcName,
    source,
    items,
    total,
    cash,
    upi,
    credit,
    note,
    admin: staffName,
    staffId,
    staffName,
    timestamp
  });
}

/**
 * Credit key used for food_credits path.
 */
export function foodCreditKey(customerName) {
  return encodeURIComponent(String(customerName || "Walk-in").trim());
}

/**
 * Remove food_credit_payments rows that belong to a deleted sale.
 * Finance / food-analytics read this separate log — leaving orphans inflates revenue.
 *
 * @param {object} db - Firebase compat database OR modular-like { ref().once/remove }
 * @param {string} saleId
 * @param {string} [saleDate] - optional hint to scan that date first
 * @param {string} paymentsPath - FB path root
 * @returns {Promise<number>} number of payment rows removed
 */
export async function removeFoodCreditPaymentsForSale(
  db,
  saleId,
  saleDate = null,
  paymentsPath = "food_credit_payments"
) {
  if (!db || !saleId) return 0;
  let removed = 0;

  const removeMatchingInDay = async (dayKey, dayData) => {
    if (!dayData || typeof dayData !== "object") return;
    const deletes = [];
    Object.entries(dayData).forEach(([payId, payment]) => {
      if (!payment || typeof payment !== "object") return;
      if (payment.saleId === saleId) {
        deletes.push(payId);
      }
    });
    for (const payId of deletes) {
      await db.ref(`${paymentsPath}/${dayKey}/${payId}`).remove();
      removed += 1;
    }
  };

  // Prefer scanning the collection dates from the sale if available, else full tree
  const treeSnap = await db.ref(paymentsPath).once("value");
  const tree = treeSnap.val() || {};

  if (saleDate && tree[saleDate]) {
    await removeMatchingInDay(saleDate, tree[saleDate]);
  }

  // Payments can land on a different day than the sale — scan all days
  for (const [dayKey, dayData] of Object.entries(tree)) {
    if (saleDate && dayKey === saleDate) continue; // already handled
    await removeMatchingInDay(dayKey, dayData);
  }

  return removed;
}

/**
 * Delete orphaned food_credit_payments that reference a missing saleId.
 * Payments without saleId (customer-level collections from Food Analytics) are kept.
 *
 * @returns {Promise<{removed: number, scanned: number}>}
 */
export async function purgeOrphanedFoodCreditPayments(
  db,
  salesPath = "food_sales",
  paymentsPath = "food_credit_payments"
) {
  if (!db) return { removed: 0, scanned: 0 };

  const [salesSnap, paysSnap] = await Promise.all([
    db.ref(salesPath).once("value"),
    db.ref(paymentsPath).once("value")
  ]);

  const salesTree = salesSnap.val() || {};
  const paysTree = paysSnap.val() || {};
  const existingSaleIds = new Set();

  Object.values(salesTree).forEach(day => {
    if (!day || typeof day !== "object") return;
    Object.keys(day).forEach(id => existingSaleIds.add(id));
  });

  let removed = 0;
  let scanned = 0;

  for (const [dayKey, dayPays] of Object.entries(paysTree)) {
    if (!dayPays || typeof dayPays !== "object") continue;
    for (const [payId, payment] of Object.entries(dayPays)) {
      scanned += 1;
      const saleId = payment?.saleId;
      // Only scrub payments tied to a specific sale that no longer exists
      if (saleId && !existingSaleIds.has(saleId)) {
        await db.ref(`${paymentsPath}/${dayKey}/${payId}`).remove();
        removed += 1;
      }
    }
  }

  return { removed, scanned };
}
