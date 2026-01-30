/**
 * OceanZ Gaming Cafe - Food Menu Management
 * Admin interface for managing food items
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get, set, update, remove, push, onValue, off } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { BOOKING_DB_CONFIG, BOOKING_APP_NAME, FB_PATHS } from "../../shared/config.js";

// ==================== FIREBASE INIT ====================

const FOOD_APP_NAME = "OCEANZ_FOOD";

let foodApp, db;
try {
  foodApp = getApps().find(app => app.name === FOOD_APP_NAME);
  if (!foodApp) {
    foodApp = initializeApp(BOOKING_DB_CONFIG, FOOD_APP_NAME);
  }
  db = getDatabase(foodApp);
} catch (err) {
  console.error("Food Firebase init error:", err);
}

// ==================== STATE ====================

let foodItems = [];
let currentCategory = "all";
let editingItemId = null;
let deletingItemId = null;

const CATEGORY_ICONS = {
  snacks: "🍿",
  drinks: "🥤",
  meals: "🍽️",
  combos: "🎁"
};

// ==================== INITIALIZATION ====================

export function initFoodMenu() {
  console.log("[FoodMenu] Initializing...");
  loadFoodItems();
}

// ==================== DATA OPERATIONS ====================

function loadFoodItems() {
  const itemsRef = ref(db, FB_PATHS.FOOD_MENU);
  
  onValue(itemsRef, (snapshot) => {
    foodItems = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        foodItems.push({ id: child.key, ...child.val() });
      });
    }
    
    // Sort by name
    foodItems.sort((a, b) => a.name.localeCompare(b.name));
    
    console.log(`[FoodMenu] Loaded ${foodItems.length} items`);
    renderFoodItems();
  }, (error) => {
    console.error("[FoodMenu] Load error:", error);
  });
}

async function saveFoodItem(e) {
  e.preventDefault();
  
  const name = document.getElementById("foodItemName").value.trim();
  const price = parseFloat(document.getElementById("foodItemPrice").value) || 0;
  const stock = document.getElementById("foodItemStock").value;
  const category = document.getElementById("foodItemCategory").value;
  const available = document.getElementById("foodItemAvailable").checked;
  
  if (!name || price <= 0) {
    alert("Please enter a valid name and price");
    return;
  }
  
  const itemData = {
    name,
    price,
    category,
    available,
    stock: stock ? parseInt(stock) : null,
    updatedAt: Date.now()
  };
  
  try {
    if (editingItemId) {
      // Update existing item
      await update(ref(db, `${FB_PATHS.FOOD_MENU}/${editingItemId}`), itemData);
      console.log(`[FoodMenu] Updated item: ${editingItemId}`);
    } else {
      // Create new item
      itemData.createdAt = Date.now();
      const newRef = push(ref(db, FB_PATHS.FOOD_MENU));
      await set(newRef, itemData);
      console.log(`[FoodMenu] Created item: ${newRef.key}`);
    }
    
    closeFoodItemModal();
  } catch (error) {
    console.error("[FoodMenu] Save error:", error);
    alert("Failed to save item: " + error.message);
  }
}

async function deleteFoodItem() {
  if (!deletingItemId) return;
  
  try {
    await remove(ref(db, `${FB_PATHS.FOOD_MENU}/${deletingItemId}`));
    console.log(`[FoodMenu] Deleted item: ${deletingItemId}`);
    closeFoodDeleteModal();
  } catch (error) {
    console.error("[FoodMenu] Delete error:", error);
    alert("Failed to delete item: " + error.message);
  }
}

// ==================== UI RENDERING ====================

function renderFoodItems() {
  const grid = document.getElementById("foodMenuGrid");
  if (!grid) return;
  
  // Filter items by category
  let filteredItems = currentCategory === "all" 
    ? foodItems 
    : foodItems.filter(item => item.category === currentCategory);
  
  if (filteredItems.length === 0) {
    grid.innerHTML = `
      <div class="neon-card rounded-xl p-8 text-center col-span-full">
        <i data-lucide="utensils" class="w-12 h-12 mx-auto mb-4 text-gray-600"></i>
        <p class="text-gray-500">${currentCategory === "all" ? 'No food items yet. Click "Add Item" to get started.' : 'No items in this category.'}</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }
  
  grid.innerHTML = filteredItems.map(item => {
    const icon = CATEGORY_ICONS[item.category] || "🍽️";
    const isOutOfStock = item.stock !== null && item.stock <= 0;
    const stockBadge = item.stock !== null 
      ? (isOutOfStock 
        ? `<span class="stock-badge bg-red-500/20 text-red-400">Out of Stock</span>`
        : `<span class="stock-badge bg-green-500/20 text-green-400">${item.stock} left</span>`)
      : "";
    
    return `
      <div class="food-item-card ${isOutOfStock ? 'out-of-stock' : ''} ${!item.available ? 'opacity-60' : ''}">
        <div class="flex items-start justify-between mb-3">
          <div class="text-2xl">${icon}</div>
          <div class="flex items-center gap-2">
            ${stockBadge}
            ${!item.available ? '<span class="stock-badge bg-gray-500/20 text-gray-400">Hidden</span>' : ''}
          </div>
        </div>
        <h4 class="font-orbitron font-semibold text-white mb-1">${item.name}</h4>
        <div class="font-orbitron text-xl font-bold mb-3" style="color: var(--neon-green);">₹${item.price}</div>
        <div class="flex gap-2">
          <button onclick="editFoodItem('${item.id}')" class="flex-1 py-1.5 rounded-lg text-xs border border-gray-700 text-gray-400 hover:border-cyan-500 hover:text-cyan-400">
            <i data-lucide="pencil" class="w-3 h-3 inline mr-1"></i> Edit
          </button>
          <button onclick="openFoodDeleteModal('${item.id}')" class="py-1.5 px-3 rounded-lg text-xs border border-gray-700 text-gray-400 hover:border-red-500 hover:text-red-400">
            <i data-lucide="trash-2" class="w-3 h-3"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");
  
  if (window.lucide) window.lucide.createIcons();
}

// ==================== MODAL HANDLING ====================

function openFoodItemModal(itemId = null) {
  editingItemId = itemId;
  
  const modal = document.getElementById("foodItemModal");
  const title = document.getElementById("foodItemModalTitle");
  const form = document.getElementById("foodItemForm");
  
  if (itemId) {
    // Edit mode
    const item = foodItems.find(i => i.id === itemId);
    if (!item) return;
    
    title.textContent = "EDIT FOOD ITEM";
    document.getElementById("foodItemId").value = itemId;
    document.getElementById("foodItemName").value = item.name;
    document.getElementById("foodItemPrice").value = item.price;
    document.getElementById("foodItemStock").value = item.stock || "";
    document.getElementById("foodItemCategory").value = item.category;
    document.getElementById("foodItemAvailable").checked = item.available !== false;
  } else {
    // Add mode
    title.textContent = "ADD FOOD ITEM";
    form.reset();
    document.getElementById("foodItemId").value = "";
    document.getElementById("foodItemAvailable").checked = true;
  }
  
  modal.classList.remove("hidden");
}

function closeFoodItemModal() {
  editingItemId = null;
  document.getElementById("foodItemModal").classList.add("hidden");
}

function openFoodDeleteModal(itemId) {
  deletingItemId = itemId;
  document.getElementById("foodDeleteModal").classList.remove("hidden");
}

function closeFoodDeleteModal() {
  deletingItemId = null;
  document.getElementById("foodDeleteModal").classList.add("hidden");
}

// ==================== CATEGORY FILTER ====================

function filterFoodCategory(category) {
  currentCategory = category;
  
  // Update button states
  document.querySelectorAll(".food-cat-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.category === category);
  });
  
  renderFoodItems();
}

// ==================== EXPORTS ====================

// Global exports for HTML onclick handlers
window.openFoodItemModal = openFoodItemModal;
window.closeFoodItemModal = closeFoodItemModal;
window.saveFoodItem = saveFoodItem;
window.editFoodItem = (id) => openFoodItemModal(id);
window.openFoodDeleteModal = openFoodDeleteModal;
window.closeFoodDeleteModal = closeFoodDeleteModal;
window.confirmFoodDelete = deleteFoodItem;
window.filterFoodCategory = filterFoodCategory;
window.initFoodMenu = initFoodMenu;

export { foodItems };
