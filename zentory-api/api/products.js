import { handleOptions, json, requireApiKey } from "./_lib/http.js";
import { listProducts } from "./_lib/sales.js";
export default async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" }, req);
    requireApiKey(req);
    const url = new URL(req.url, "http://localhost");
    const ownerId = url.searchParams.get("ownerId") || process.env.ZENTORY_DEFAULT_OWNER_ID;
    const locationId = url.searchParams.get("locationId") || process.env.ZENTORY_DEFAULT_LOCATION_ID;
    if (!ownerId) return json(res, 400, { error: "ownerId required" }, req);
    const { products, categories } = await listProducts({ ownerId, locationId });
    return json(res, 200, {
      ok: true,
      ownerId,
      locationId,
      count: products.length,
      products,
      categories,
    }, req);
  } catch (e) {
    return json(res, e.status || 500, { ok: false, error: e.message || "Server error" }, req);
  }
}
