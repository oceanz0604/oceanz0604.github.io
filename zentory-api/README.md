# Zentory HTTP API (OceanZ cafe bridge)

**Source of truth for Zentory-side code lives here** (cafe repo). Paste the command below into a Cloud Agent started on `inventory-management-tool`.

Live host: `https://inventory-management-tool-ten.vercel.app`

## Command for the Zentory Cloud Agent (categories + API)

Start a new agent on **`oceanz0604/inventory-management-tool`**, then paste:

```
Two jobs: (1) copy latest cafe HTTP API to this repo ROOT, (2) split the OceanZ product catalog into real food categories.

1) Copy API from cafe branch (do not nest under zentory-api/):
https://github.com/oceanz0604/oceanz0604.github.io/tree/cursor/food-menu-search-6b9a/zentory-api

Required at repo root: api/, vercel.json, and package.json "type":"module" (merge if package.json exists).
Keep the existing Zentory PWA (index.html, js/, css/, sw.js). Do not delete the storefront.

API change vs previous: GET /api/products must return real category names (do NOT collapse everything to snacks/drinks/meals/combos). Each product should include categoryId, category (slug of the real name), categoryName. Also return a top-level "categories" array: [{ id, name, slug, count }].

2) Catalog (OceanZ company, location Cafe Counter): create categories if missing and recategorize the ~38 cafe products so staff can filter by type. Suggested names:
- Drinks
- Fries
- Maggi
- Pasta
- Sandwiches
- Pizza
- Momos
- Other (only if needed)

Use product names to assign (e.g. "Cheese Maggi" → Maggi, "Salted Fries" → Fries, "White Sauce Pasta" → Pasta, "Pepsi"/"Water" → Drinks, "Paneer sandwich" → Sandwiches, pizzas → Pizza, momos → Momos). Do not rename products or change prices/stock unless required to attach a category.

Commit, PR, merge to the branch Vercel deploys. Confirm:
GET https://inventory-management-tool-ten.vercel.app/api/products?ownerId=co_mqgbs2zvzjfei8&locationId=loc_26082747d7db19
with header X-Zentory-Key: oz_zentory_7f3a9c2e1b8d4e6a90f2c5d8e1a4b7c3
returns products[].categoryName like Maggi/Fries/Drinks (not only Snacks/Drinks) and a categories[] list.
```

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/health` | No auth |
| `GET` | `/api/products?ownerId=&locationId=` | `categories[]`; complex items include `makeToOrder` and `stock` = how many you can make from lots |
| `POST` | `/api/sales` | Simple SKUs: FEFO finished goods. Complex MTO: deduct BOM lots immediately. **409** if an ingredient is short (`missingIngredient`). Idempotent on `externalId` |
| `POST` | `/api/sales/void` | Restore consumed lots |

## Command for the Zentory Cloud Agent (MTO sales.js)

Live Zentory already has MTO (PR #4). If cafe `zentory-api/api/_lib/sales.js` is newer (named ingredient on 409), paste:

```
Copy api/_lib/sales.js and api/sales.js from
https://github.com/oceanz0604/oceanz0604.github.io/tree/cursor/mto-food-sales-6b9a/zentory-api
into this repo root api/ (do not nest under zentory-api/). Keep the PWA. Merge, deploy.
409 responses should include error text naming the missing ingredient.
```
