import { handleOptions, json, readBody, requireApiKey } from "../_lib/http.js";
import { voidSale } from "../_lib/sales.js";
export default async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" }, req);
    requireApiKey(req);
    const body = await readBody(req);
    const result = await voidSale(body);
    return json(res, 200, {
      ok: true,
      alreadyVoided: !!result.alreadyVoided,
      saleId: result.sale.id,
      sale: result.sale,
    }, req);
  } catch (e) {
    return json(res, e.status || 500, { ok: false, error: e.message || "Server error" }, req);
  }
}
