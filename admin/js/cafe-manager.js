/**
 * OceanZ Gaming Cafe - Cafe Manager
 * Inventory (products / stock / purchases) lives in Zentory.
 * This view is a staff hub: open Zentory + short ops notes.
 * Food purchase expenses stay manual in Finance.
 */

import { ZENTORY } from "../../shared/config.js";

const $ = (id) => document.getElementById(id);

function renderZentoryHub() {
  const section = $("cafe-manager-section");
  if (!section) return;

  const appUrl = ZENTORY.APP_URL || "https://inventory-management-tool-ten.vercel.app";

  section.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h2 class="font-orbitron text-2xl font-bold flex items-center gap-3" style="color: var(--neon-orange);">
          <i data-lucide="coffee" class="w-7 h-7"></i> CAFE
        </h2>
        <p class="text-sm text-gray-500 mt-1">Products, stock &amp; purchases are managed in Zentory</p>
      </div>
      <a href="${appUrl}" target="_blank" rel="noopener noreferrer"
        class="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-orbitron text-sm"
        style="background: rgba(255,107,0,0.2); border: 1px solid var(--neon-orange); color: var(--neon-orange);">
        <i data-lucide="external-link" class="w-4 h-4"></i>
        Open Zentory
      </a>
    </div>

    <div class="neon-card rounded-2xl p-5 md:p-6 space-y-5" style="border: 1px solid rgba(255,107,0,0.25);">
      <div>
        <h3 class="font-orbitron text-sm mb-2" style="color: var(--neon-cyan);">Where things live</h3>
        <ul class="text-sm text-gray-400 space-y-2 list-disc list-inside">
          <li><span class="text-gray-200">Zentory</span> — products, stock levels, purchases, inventory analytics</li>
          <li><span class="text-gray-200">Counter / Recharges</span> — sell food; stock deducts in Zentory automatically</li>
          <li><span class="text-gray-200">Finance</span> — cash register, food credits, gaming; enter food purchase expenses manually</li>
        </ul>
      </div>

      <div>
        <h3 class="font-orbitron text-sm mb-2" style="color: var(--neon-green);">Staff checklist</h3>
        <ol class="text-sm text-gray-400 space-y-2 list-decimal list-inside">
          <li>Add or edit products and receive stock in <strong class="text-gray-200">Zentory</strong> (location: Cafe Counter).</li>
          <li>Sell from Counter or Recharges as usual — do not adjust local menu stock.</li>
          <li>When you buy stock, record the spend in <strong class="text-gray-200">Finance → Expenses</strong> (Food Purchase).</li>
        </ol>
      </div>

      <p class="text-xs text-gray-500">
        Login for Zentory is company-scoped (company code <code class="text-gray-400">oceanz</code>).
        Ask an admin if you need credentials.
      </p>
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();
}

function initCafeManager() {
  renderZentoryHub();
}

window.initCafeManager = initCafeManager;

// Keep stub handlers so any leftover onclick in cached HTML does not throw
window.openFoodItemModal = () => {};
window.closeFoodItemModal = () => {};
window.saveFoodItem = (e) => e?.preventDefault?.();
window.editFoodItem = () => {};
window.openFoodDeleteModal = () => {};
window.closeFoodDeleteModal = () => {};
window.confirmFoodDelete = () => {};
window.openStockPurchaseModal = () => {};
window.closeStockPurchaseModal = () => {};
window.addStockPurchaseLine = () => {};
window.recalcStockPurchaseLines = () => {};
window.syncStockPurchasePay = () => {};
window.saveStockPurchase = (e) => e?.preventDefault?.();
window.openStockAdjustModal = () => {};
window.closeStockAdjustModal = () => {};
window.quickAdjustFromRow = () => {};
window.saveStockAdjust = (e) => e?.preventDefault?.();
window.setCafeTab = () => {};
window.setStockTab = () => {};
window.filterFoodCategory = () => {};
window.filterCafeSearch = () => {};
window.filterStockInventory = () => {};

export { initCafeManager };
