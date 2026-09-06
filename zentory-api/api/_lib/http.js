const DEFAULT_ORIGINS = [
  "https://oceanz0604.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
];

export function corsHeaders(req) {
  const origin = req.headers?.origin || "";
  const allow = DEFAULT_ORIGINS.includes(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Zentory-Key, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function json(res, status, body, req) {
  res.statusCode = status;
  Object.entries({ "Content-Type": "application/json", ...corsHeaders(req) })
    .forEach(([k, v]) => res.setHeader(k, v));
  res.end(status === 204 ? "" : JSON.stringify(body));
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

export function requireApiKey(req) {
  const expected = process.env.ZENTORY_API_KEY || "oz_zentory_7f3a9c2e1b8d4e6a90f2c5d8e1a4b7c3";
  const key =
    req.headers["x-zentory-key"] ||
    (String(req.headers.authorization || "").toLowerCase().startsWith("bearer ")
      ? String(req.headers.authorization).slice(7).trim()
      : "");
  if (!key || key !== expected) {
    const err = new Error("Unauthorized — missing or invalid X-Zentory-Key");
    err.status = 401;
    throw err;
  }
}

export function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    json(res, 204, {}, req);
    return true;
  }
  return false;
}
