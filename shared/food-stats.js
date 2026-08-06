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
 * @param {object} sale
 * @returns {Object} amounts with cash, upi, credit, and total
 */
export function getSaleCollectedAmounts(sale) {
  const s = normalizeFoodSale(sale);
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
 * Build food_sales write payload (additive schema).
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
  const payload = {
    customerName: customerName || memberName || pcName || "Walk-in",
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
    paymentMode,
    timestamp,
    staffId,
    staffName,
    note: note || ""
  };

  if (paymentMode === "split") {
    payload.cashAmount = Number(cashAmount) || 0;
    payload.upiAmount = Number(upiAmount) || 0;
    if (creditAmount > 0) payload.creditAmount = Number(creditAmount) || 0;
  } else if (paymentMode === "credit") {
    payload.creditAmount = Number(creditAmount) || Number(total) || 0;
  } else if (paymentMode === "cash") {
    payload.cashAmount = Number(total) || 0;
  } else if (paymentMode === "upi") {
    payload.upiAmount = Number(total) || 0;
  }

  return payload;
}

/**
 * Credit key used for food_credits path.
 */
export function foodCreditKey(customerName) {
  return encodeURIComponent(String(customerName || "Walk-in").trim());
}
