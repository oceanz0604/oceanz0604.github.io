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

export function filterFoodItems(items, { query = "", categoryKey = "all" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  return (items || []).filter((item) => {
    if (categoryKey && categoryKey !== "all" && foodCategoryKey(item) !== categoryKey) return false;
    if (!q) return true;
    const hay = `${item.name || ""} ${item.categoryName || ""} ${item.category || ""} ${item.sku || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

export function escapeFoodHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
