/**
 * OceanZ Gaming Cafe - Session History
 */

export function loadHistory() {
  const container = document.getElementById("history-cards");
  if (!container) return;
  
  container.innerHTML = `
    <div class="bg-gray-800 p-6 rounded-xl text-center text-gray-400">
      <p>Session history is available in the Dashboard view.</p>
      <p class="text-sm mt-2">Real-time terminal status shows active sessions.</p>
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", loadHistory);

