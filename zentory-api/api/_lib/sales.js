import { genId, getDoc, setDoc, listByOwner, listCollection } from "./firestore.js";

function lotSort(a, b) {
  const ax = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
  const bx = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
  if (ax !== bx) return ax - bx;
  return new Date(a.purchaseDate || a.createdAt || 0) - new Date(b.purchaseDate || b.createdAt || 0);
}

async function availableLots(productId, locationId, ownerId) {
  const batches = await listByOwner("batches", ownerId);
  return batches
    .filter((b) => b.productId === productId && b.locationId === locationId && (b.qty || 0) > 0)
    .sort(lotSort);
}

async function recountStock(productId, locationId, ownerId, minStock = 0) {
  const lots = await availableLots(productId, locationId, ownerId);
  const qty = lots.reduce((s, b) => s + Math.max(0, Number(b.qty) || 0), 0);
  const allStock = await listByOwner("stock", ownerId);
  const rec = allStock.find((s) => s.productId === productId && s.locationId === locationId);
  const id = rec?.id || genId("stk_");
  await setDoc("stock", id, {
    id, ownerId, productId, locationId, quantity: qty, minStock: rec?.minStock ?? minStock,
  });
  return qty;
}

async function pickLots(productId, locationId, ownerId, qty) {
  const lots = await availableLots(productId, locationId, ownerId);
  let need = Number(qty) || 0;
  const picks = [];
  for (const l of lots) {
    if (need <= 0) break;
    const take = Math.min(Number(l.qty) || 0, need);
    if (take <= 0) continue;
    picks.push({ batchId: l.id, qty: take, unitCost: Number(l.unitCost) || 0 });
    need -= take;
  }
  return need > 0.0001 ? null : picks;
}

async function consumeLots(picks, ownerId) {
  let cost = 0;
  for (const pk of picks || []) {
    const b = await getDoc("batches", pk.batchId);
    if (!b) continue;
    const take = Math.max(0, Math.min(Number(b.qty) || 0, Number(pk.qty) || 0));
    cost += take * (Number(b.unitCost) || 0);
    await setDoc("batches", b.id, { ...b, qty: (Number(b.qty) || 0) - take });
    await recountStock(b.productId, b.locationId, ownerId, 0);
  }
  return cost;
}

async function restoreLots(consumedLots, ownerId) {
  for (const pk of consumedLots || []) {
    const b = await getDoc("batches", pk.batchId);
    if (!b) continue;
    await setDoc("batches", b.id, { ...b, qty: (Number(b.qty) || 0) + (Number(pk.qty) || 0) });
    await recountStock(b.productId, b.locationId, ownerId, 0);
  }
}

function nextReceipt() {
  return `RCT-${Date.now().toString(36).toUpperCase()}`;
}

export function slugifyCategory(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "uncategorized";
}

async function findSaleByExternalId(ownerId, externalId) {
  const sales = await listByOwner("pos_sales", ownerId);
  return sales.find((s) => s.externalId === externalId) || null;
}

export async function listProducts({ ownerId, locationId }) {
  const [productDocs, categoryDocs, stock] = await Promise.all([
    listByOwner("products", ownerId),
    listCollection("categories"),
    listByOwner("stock", ownerId),
  ]);
  const catById = Object.fromEntries(categoryDocs.map((c) => [c.id, c]));
  const stockMap = {};
  stock.filter((s) => !locationId || s.locationId === locationId)
    .forEach((s) => { stockMap[s.productId] = (stockMap[s.productId] || 0) + (Number(s.quantity) || 0); });

  const productsOut = productDocs
    .filter((p) => {
      const type = p.type || "simple";
      return type === "simple" || type === "complex";
    })
    .filter((p) => p.available !== false)
    .map((p) => {
      const cat = catById[p.categoryId] || {};
      const categoryName = String(cat.name || "").trim() || "Uncategorized";
      return {
        id: p.id,
        name: p.name,
        sku: p.sku || "",
        price: Number(p.price) || 0,
        costPrice: Number(p.costPrice) || 0,
        gstRate: Number(p.gstRate) || 0,
        unit: p.unit || "pcs",
        categoryId: p.categoryId || "",
        category: slugifyCategory(categoryName),
        categoryName,
        stock: stockMap[p.id] ?? 0,
        cafeExternalId: p.cafeExternalId || null,
        type: p.type || "simple",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const catMap = new Map();
  for (const p of productsOut) {
    const id = p.categoryId || p.category;
    if (!catMap.has(id)) {
      catMap.set(id, {
        id: p.categoryId || p.category,
        name: p.categoryName,
        slug: p.category,
        count: 0,
      });
    }
    catMap.get(id).count += 1;
  }
  const categories = [...catMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { products: productsOut, categories };
}

export async function createSale(payload) {
  const ownerId = payload.ownerId || process.env.ZENTORY_DEFAULT_OWNER_ID;
  const locationId = payload.locationId || process.env.ZENTORY_DEFAULT_LOCATION_ID;
  const externalId = String(payload.externalId || "").trim();
  const channel = String(payload.channel || "oceanz_cafe");
  const itemsIn = Array.isArray(payload.items) ? payload.items : [];

  if (!ownerId) throw Object.assign(new Error("ownerId is required"), { status: 400 });
  if (!locationId) throw Object.assign(new Error("locationId is required"), { status: 400 });
  if (!itemsIn.length) throw Object.assign(new Error("items are required"), { status: 400 });
  if (!externalId) throw Object.assign(new Error("externalId is required"), { status: 400 });

  const existing = await findSaleByExternalId(ownerId, externalId);
  if (existing && !existing.voided) return { sale: existing, idempotent: true };

  const products = await listByOwner("products", ownerId);
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const lineItems = [];
  const allConsumed = [];

  for (const raw of itemsIn) {
    const productId = raw.productId || raw.id;
    const qty = Number(raw.qty) || 0;
    if (!productId || qty <= 0) throw Object.assign(new Error("Each item needs productId and qty > 0"), { status: 400 });
    const product = byId[productId];
    if (!product) throw Object.assign(new Error(`Unknown productId: ${productId}`), { status: 400 });
    const price = raw.unitPrice != null ? Number(raw.unitPrice) : Number(product.price) || 0;
    const picks = await pickLots(productId, locationId, ownerId, qty);
    if (!picks) throw Object.assign(new Error(`Insufficient stock for ${product.name} (need ${qty})`), { status: 409 });
    const costTotal = await consumeLots(picks, ownerId);
    allConsumed.push(...picks.map((pk) => ({ ...pk, productId })));
    lineItems.push({
      productId,
      name: product.name,
      sku: product.sku || "",
      price,
      costPrice: costTotal / Math.max(1, qty),
      gstRate: Number(product.gstRate) || 0,
      qty,
      cafeExternalId: product.cafeExternalId || raw.cafeExternalId || null,
    });
  }

  let paymentMethod = String(payload.paymentMethod || "cash").toLowerCase();
  if (!["cash", "upi", "card"].includes(paymentMethod)) paymentMethod = "cash";

  const subtotal = lineItems.reduce((s, i) => s + i.qty * i.price, 0);
  const taxAmount = lineItems.reduce((s, i) => s + i.qty * i.price * ((i.gstRate || 0) / 100), 0);
  const sale = {
    id: genId("sale_"),
    receiptNumber: nextReceipt(),
    ownerId,
    locationId,
    items: lineItems,
    subtotal,
    taxAmount,
    total: subtotal + taxAmount,
    paymentMethod,
    customerName: payload.customerName || "Walk-in",
    channel,
    externalId,
    staff: payload.staff || null,
    note: payload.note || "",
    consumedLots: allConsumed,
    voided: false,
    createdAt: new Date().toISOString(),
  };
  await setDoc("pos_sales", sale.id, sale, false);
  return { sale, idempotent: false };
}

export async function voidSale({ externalId, ownerId }) {
  const ext = String(externalId || "").trim();
  if (!ext) throw Object.assign(new Error("externalId is required"), { status: 400 });
  const oid = ownerId || process.env.ZENTORY_DEFAULT_OWNER_ID;
  if (!oid) throw Object.assign(new Error("ownerId is required"), { status: 400 });
  const sale = await findSaleByExternalId(oid, ext);
  if (!sale) throw Object.assign(new Error("Sale not found for externalId"), { status: 404 });
  if (sale.voided) return { sale, alreadyVoided: true };
  await restoreLots(sale.consumedLots || [], sale.ownerId);
  const patched = { ...sale, voided: true, voidedAt: new Date().toISOString() };
  await setDoc("pos_sales", sale.id, patched);
  return { sale: patched, alreadyVoided: false };
}
