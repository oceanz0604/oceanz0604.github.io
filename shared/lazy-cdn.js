/**
 * Load Chart.js / jsPDF only when Finance, member stats, or PDF export needs them.
 */

const inflight = new Map();

function loadScript(src) {
  const existing = document.querySelector(`script[data-lazy-src="${src}"]`);
  if (existing) {
    if (existing.dataset.loaded === "1") return Promise.resolve();
    return inflight.get(src) || Promise.resolve();
  }

  const p = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.lazySrc = src;
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
  inflight.set(src, p);
  return p;
}

export function ensureChartJs() {
  if (typeof window.Chart !== "undefined") return Promise.resolve();
  return loadScript("https://cdn.jsdelivr.net/npm/chart.js");
}

export async function ensureJsPdf() {
  const hasAutoTable = () => {
    const J = window.jspdf?.jsPDF;
    return typeof J?.API?.autoTable === "function" || typeof J?.prototype?.autoTable === "function";
  };
  if (window.jspdf?.jsPDF && hasAutoTable()) return;
  if (!window.jspdf?.jsPDF) {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  }
  if (!hasAutoTable()) {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js");
  }
}
