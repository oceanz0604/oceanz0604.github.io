/**
 * Shared food-menu picker helpers (Counter + Recharges).
 * Categories come from Zentory product.categoryName / categoryId.
 */

export function slugifyCategory(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "uncategorized";
}

export function foodCategoryKey(item) {
  if (item?.categoryId) return String(item.categoryId);
  if (item?.category && String(item.category).startsWith("cat_")) return String(item.category);
  const label = item?.categoryName || item?.category || "Uncategorized";
  return slugifyCategory(label);
}

export function foodCategoryLabel(item) {
  const raw = item?.categoryName || item?.category || "Uncategorized";
  if (/^cat_/i.test(String(raw))) return "Uncategorized";
  return String(raw).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function foodCategoryEmoji(label) {
  const s = String(label || "").toLowerCase();
  if (s.includes("drink") || s.includes("beverage") || s.includes("juice") || s.includes("cola")) return "🥤";
  if (s.includes("tea") || s.includes("coffee") || s.includes("chai")) return "☕";
  if (s.includes("fries") || s.includes("fry")) return "🍟";
  if (s.includes("maggi") || s.includes("noodle")) return "🍜";
  if (s.includes("pasta")) return "🍝";
  if (s.includes("sandwich") || s.includes("grill")) return "🥪";
  if (s.includes("pizza")) return "🍕";
  if (s.includes("momo")) return "🥟";
  if (s.includes("combo")) return "🎁";
  if (s.includes("meal")) return "🍽️";
  if (s.includes("snack")) return "🍿";
  return "🍽️";
}

export function uniqueFoodCategories(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = foodCategoryKey(item);
    const label = foodCategoryLabel(item);
    if (!map.has(key)) {
      map.set(key, { key, label, emoji: foodCategoryEmoji(label), count: 0 });
    }
    map.get(key).count += 1;
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function indexFoodItem(item) {
  const categoryName = item.categoryName || item.category || "Snacks";
  item.categoryName = categoryName;
  item._catKey = foodCategoryKey(item);
  item._q = `${item.name || ""} ${categoryName} ${item.category || ""} ${item.sku || ""}`.toLowerCase();
  item._emoji = foodCategoryEmoji(categoryName);
  return item;
}

export function filterFoodItems(items, { query = "", categoryKey = "all" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const filtered = (items || []).filter((item) => {
    const key = item._catKey || foodCategoryKey(item);
    if (categoryKey && categoryKey !== "all" && key !== categoryKey) return false;
    if (!q) return true;
    const hay = item._q || `${item.name || ""} ${item.categoryName || ""} ${item.category || ""} ${item.sku || ""}`.toLowerCase();
    return hay.includes(q);
  });
  return sortFoodItemsAvailableFirst(filtered);
}

/** In-stock / makeable items first, then out of stock. */
export function sortFoodItemsAvailableFirst(items) {
  return [...(items || [])].sort((a, b) => {
    const ao = foodItemOutOfStock(a) ? 1 : 0;
    const bo = foodItemOutOfStock(b) ? 1 : 0;
    if (ao !== bo) return ao - bo;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

export function escapeFoodHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function mapZentoryMenuProduct(p) {
  return indexFoodItem({
    id: p.id,
    name: p.name,
    price: p.price,
    category: p.category || "snacks",
    categoryName: p.categoryName || p.category || "Snacks",
    categoryId: p.categoryId || "",
    sku: p.sku || "",
    stock: p.stock,
    makeToOrder: !!p.makeToOrder,
    type: p.type || "simple",
    cafeExternalId: p.cafeExternalId || null,
    available: true,
    fromZentory: true,
  });
}

/** Zentory `stock` is on-hand for simple SKUs and makeable plates for MTO. */
export function foodItemOutOfStock(item) {
  if (item?.stock === null || item?.stock === undefined) return false;
  return Number(item.stock) <= 0;
}

export function foodStockHint(item) {
  if (item?.stock === null || item?.stock === undefined) return "";
  const n = Number(item.stock) || 0;
  if (item.makeToOrder) return n > 0 ? `${n} ready` : "Need ingredients";
  return n > 0 ? String(n) : "Out";
}

export function canAddFoodQty(item, nextQty) {
  if (item?.stock === null || item?.stock === undefined) return true;
  return nextQty <= Number(item.stock);
}
