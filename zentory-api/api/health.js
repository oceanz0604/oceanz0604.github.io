import { handleOptions, json } from "./_lib/http.js";
export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  return json(res, 200, {
    ok: true,
    service: "zentory-api",
    endpoints: ["GET /api/health", "GET /api/products", "POST /api/sales", "POST /api/sales/void"],
  }, req);
}
