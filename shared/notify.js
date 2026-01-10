/**
 * OceanZ Gaming Cafe - Toast Notification System
 * Replaces native alerts with styled toast notifications
 */

// ==================== INIT ====================

// Ensure notification container exists
function ensureContainer() {
  let container = document.getElementById("oceanz-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "oceanz-toast-container";
    container.className = "fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none";
    container.style.maxWidth = "400px";
    document.body.appendChild(container);
  }
  return container;
}

// ==================== TOAST TYPES ====================

const TOAST_TYPES = {
  success: {
    bg: "rgba(0, 40, 20, 0.95)",
    border: "#00ff88",
    icon: "✅",
    title: "Success"
  },
  error: {
    bg: "rgba(40, 0, 10, 0.95)",
    border: "#ff0044",
    icon: "❌",
    title: "Error"
  },
  warning: {
    bg: "rgba(40, 30, 0, 0.95)",
    border: "#ff6b00",
    icon: "⚠️",
    title: "Warning"
  },
  info: {
    bg: "rgba(0, 20, 40, 0.95)",
    border: "#00f0ff",
    icon: "ℹ️",
    title: "Info"
  }
};

// ==================== SHOW TOAST ====================

function showToast(message, type = "info", duration = 4000) {
  const container = ensureContainer();
  const config = TOAST_TYPES[type] || TOAST_TYPES.info;
  
  const toast = document.createElement("div");
  toast.className = "pointer-events-auto transform translate-x-full opacity-0 transition-all duration-300";
  toast.style.cssText = `
    background: ${config.bg};
    border: 1px solid ${config.border};
    border-left: 4px solid ${config.border};
    border-radius: 12px;
    padding: 16px 20px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.5), 0 0 20px ${config.border}40;
    backdrop-filter: blur(10px);
  `;
  
  toast.innerHTML = `
    <div class="flex items-start gap-3">
      <span class="text-xl shrink-0">${config.icon}</span>
      <div class="flex-1 min-w-0">
        <div class="font-orbitron text-xs font-bold mb-1" style="color: ${config.border};">${config.title.toUpperCase()}</div>
        <div class="text-sm text-gray-200 break-words">${escapeHtml(message)}</div>
      </div>
      <button onclick="this.closest('[data-toast]').remove()" class="shrink-0 text-gray-500 hover:text-white transition-colors ml-2">
        ✕
      </button>
    </div>
  `;
  toast.setAttribute("data-toast", "true");
  
  container.appendChild(toast);
  
  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove("translate-x-full", "opacity-0");
    toast.classList.add("translate-x-0", "opacity-100");
  });
  
  // Auto remove
  if (duration > 0) {
    setTimeout(() => {
      toast.classList.add("translate-x-full", "opacity-0");
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  
  return toast;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ==================== CONVENIENCE FUNCTIONS ====================

function notifySuccess(message, duration = 3000) {
  return showToast(message, "success", duration);
}

function notifyError(message, duration = 5000) {
  return showToast(message, "error", duration);
}

function notifyWarning(message, duration = 4000) {
  return showToast(message, "warning", duration);
}

function notifyInfo(message, duration = 4000) {
  return showToast(message, "info", duration);
}

// ==================== CONFIRM DIALOG ====================

function showConfirm(message, options = {}) {
  return new Promise((resolve) => {
    const {
      title = "Confirm",
      confirmText = "Confirm",
      cancelText = "Cancel",
      type = "warning"
    } = options;
    
    const config = TOAST_TYPES[type] || TOAST_TYPES.warning;
    
    // Create backdrop
    const backdrop = document.createElement("div");
    backdrop.className = "fixed inset-0 z-[9998] flex items-center justify-center";
    backdrop.style.cssText = "background: rgba(0,0,0,0.8); backdrop-filter: blur(5px);";
    
    backdrop.innerHTML = `
      <div class="transform scale-95 opacity-0 transition-all duration-200" id="confirm-modal">
        <div class="rounded-2xl p-6 mx-4 max-w-md w-full" style="background: ${config.bg}; border: 1px solid ${config.border}; box-shadow: 0 0 40px ${config.border}40;">
          <div class="flex items-start gap-4 mb-6">
            <span class="text-3xl">${config.icon}</span>
            <div>
              <h3 class="font-orbitron text-lg font-bold mb-2" style="color: ${config.border};">${escapeHtml(title)}</h3>
              <p class="text-gray-300">${escapeHtml(message)}</p>
            </div>
          </div>
          <div class="flex gap-3 justify-end">
            <button id="confirm-cancel" class="px-5 py-2.5 rounded-lg font-orbitron text-sm transition-all" style="background: rgba(255,255,255,0.05); color: #888;">
              ${escapeHtml(cancelText)}
            </button>
            <button id="confirm-ok" class="px-5 py-2.5 rounded-lg font-orbitron text-sm font-bold transition-all" style="background: ${config.border}; color: #000;">
              ${escapeHtml(confirmText)}
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(backdrop);
    
    // Animate in
    requestAnimationFrame(() => {
      const modal = backdrop.querySelector("#confirm-modal");
      modal.classList.remove("scale-95", "opacity-0");
      modal.classList.add("scale-100", "opacity-100");
    });
    
    // Handle buttons
    const cleanup = (result) => {
      const modal = backdrop.querySelector("#confirm-modal");
      modal.classList.add("scale-95", "opacity-0");
      setTimeout(() => backdrop.remove(), 200);
      resolve(result);
    };
    
    backdrop.querySelector("#confirm-ok").onclick = () => cleanup(true);
    backdrop.querySelector("#confirm-cancel").onclick = () => cleanup(false);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) cleanup(false);
    };
    
    // Focus confirm button
    backdrop.querySelector("#confirm-ok").focus();
  });
}

// ==================== EXPORT TO WINDOW ====================

window.showToast = showToast;
window.notifySuccess = notifySuccess;
window.notifyError = notifyError;
window.notifyWarning = notifyWarning;
window.notifyInfo = notifyInfo;
window.showConfirm = showConfirm;

// Also export as module for ES6 imports
export { showToast, notifySuccess, notifyError, notifyWarning, notifyInfo, showConfirm };

