import { handleOptions, json, readBody, requireApiKey } from "./_lib/http.js";
import { createSale } from "./_lib/sales.js";
export default async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" }, req);
    requireApiKey(req);
    const body = await readBody(req);
    const result = await createSale(body);
    return json(res, result.idempotent ? 200 : 201, {
      ok: true,
      idempotent: !!result.idempotent,
      saleId: result.sale.id,
      receiptNumber: result.sale.receiptNumber,
      total: result.sale.total,
      sale: result.sale,
    }, req);
  } catch (e) {
    return json(res, e.status || 500, { ok: false, error: e.message || "Server error" }, req);
  }
}
