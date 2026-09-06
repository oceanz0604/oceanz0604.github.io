const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "inventory-management-oceanz";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) continue;
      fields[k] = encodeValue(val);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function decodeValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = decodeValue(val);
    return out;
  }
  return null;
}

function decodeDoc(doc) {
  if (!doc) return null;
  const data = {};
  for (const [k, v] of Object.entries(doc.fields || {})) data[k] = decodeValue(v);
  if (!data.id && doc.name) data.id = doc.name.split("/").pop();
  return data;
}

async function fsFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    const err = new Error(body?.error?.message || text || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export function genId(prefix = "") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export async function getDoc(collection, id) {
  try {
    return decodeDoc(await fsFetch(`/${collection}/${encodeURIComponent(id)}`));
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function setDoc(collection, id, data, merge = true) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    fields[k] = encodeValue(v);
  }
  const mask = merge
    ? "?" + Object.keys(data).filter((k) => data[k] !== undefined)
      .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&")
    : "";
  return decodeDoc(await fsFetch(`/${collection}/${encodeURIComponent(id)}${mask}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  }));
}

export async function listCollection(collection, pageSize = 300) {
  const out = [];
  let pageToken = "";
  do {
    const q = `?pageSize=${pageSize}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const body = await fsFetch(`/${collection}${q}`);
    (body.documents || []).forEach((d) => out.push(decodeDoc(d)));
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return out;
}

export async function listByOwner(collection, ownerId) {
  const all = await listCollection(collection);
  return all.filter((d) => d && d.ownerId === ownerId);
}
