# Zentory HTTP API (OceanZ cafe bridge)

Exposes catalog + POS sales for the OceanZ cafe PWA. Copy this folder into the
**inventory-management-tool** Vercel project (or deploy it as its own project).

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/health` | No auth |
| `GET` | `/api/products?ownerId=&locationId=` | Catalog + stock |
| `POST` | `/api/sales` | FEFO lot consume; idempotent on `externalId` |
| `POST` | `/api/sales/void` | Restore lots for a prior external sale |

Auth header: `X-Zentory-Key: <secret>`

## Vercel env

| Variable | Default / notes |
|----------|-----------------|
| `ZENTORY_API_KEY` | Must match cafe `ZENTORY.API_KEY` |
| `ZENTORY_DEFAULT_OWNER_ID` | `co_mqgbs2zvzjfei8` |
| `ZENTORY_DEFAULT_LOCATION_ID` | `loc_26082747d7db19` |
| `FIREBASE_PROJECT_ID` | `inventory-management-oceanz` |

See `.env.example`.

## Deploy

1. **Preferred:** grant this agent write on `oceanz0604/inventory-management-tool`, copy `api/` + `vercel.json` + `package.json` into that repo root, push (Vercel auto-deploys).
2. Or deploy this folder as a separate Vercel project and set cafe `ZENTORY.API_BASE` to that URL.

Until `/api/health` returns 200 on the API host, cafe dual-write soft-fails and local `food_sales` still post.

## Cafe wiring

OceanZ uses `shared/zentory-api.js` + `ZENTORY` in `shared/config.js`:

- Counter / Recharges load catalog from `GET /api/products`
- After writing `food_sales`, they `POST /api/sales` with `externalId = food_sales/{date}/{id}`
- Cafe Manager UI is a hub linking to Zentory; stock/purchases are not edited in cafe
