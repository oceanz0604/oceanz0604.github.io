# Zentory HTTP API (OceanZ cafe bridge)

**Source of truth for Zentory-side code lives here** (cafe repo). This Cloud Agent cannot push to `inventory-management-tool`. When Zentory needs a change, we update this folder; you paste the command below into a Cloud Agent started on the Zentory repo.

Live host: `https://inventory-management-tool-ten.vercel.app`

## Command for the Zentory Cloud Agent

Start a new agent on **`oceanz0604/inventory-management-tool`**, then paste:

```
Copy the cafe HTTP API into THIS repo ROOT (do not nest under zentory-api/).

Source (cafe branch, always use the latest commit on this path):
https://github.com/oceanz0604/oceanz0604.github.io/tree/cursor/zentory-integration-6b9a/zentory-api

Required at repo root:
- api/  (health.js, products.js, sales.js, sales/void.js, _lib/*)
- vercel.json
- package.json  (merge "type":"module" if this repo already has package.json)

Keep existing Zentory PWA files (index.html, js/, css/, etc.). Do not delete the storefront.

After copy: commit, push, open/update a PR, merge to the branch Vercel deploys (usually main).

Vercel env (Project → Settings → Environment Variables):
- ZENTORY_API_KEY = oz_zentory_7f3a9c2e1b8d4e6a90f2c5d8e1a4b7c3
- ZENTORY_DEFAULT_OWNER_ID = co_mqgbs2zvzjfei8
- ZENTORY_DEFAULT_LOCATION_ID = loc_26082747d7db19
- FIREBASE_PROJECT_ID = inventory-management-oceanz

When done, confirm GET https://inventory-management-tool-ten.vercel.app/api/health returns {"ok":true,"service":"zentory-api",...}
```

If the cafe PR is already merged, change the source tree URL to:

`https://github.com/oceanz0604/oceanz0604.github.io/tree/main/zentory-api`

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/health` | No auth |
| `GET` | `/api/products?ownerId=&locationId=` | Header `X-Zentory-Key` |
| `POST` | `/api/sales` | FEFO lot consume; idempotent on `externalId` |
| `POST` | `/api/sales/void` | Restore lots |

## Cafe wiring

- Counter / Recharges: catalog from `GET /api/products`; after `food_sales` write, `POST /api/sales` with `externalId = food_sales/{date}/{id}`
- Delete food sale: `POST /api/sales/void` with the same `externalId`
- Cafe Manager: hub link to Zentory UI; purchase expenses stay manual in Finance
