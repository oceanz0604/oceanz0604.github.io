/**
 * OceanZ - Global modal scroll lock
 * Prevents background page scroll while any fixed overlay modal is open,
 * including when the modal itself scrolls to its end (scroll chaining).
 */
(function (global) {
  let lockCount = 0;
  let savedScrollY = 0;
  let observer = null;

  function getScrollbarWidth() {
    return Math.max(0, window.innerWidth - document.documentElement.clientWidth);
  }

  function applyLock() {
    savedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const pad = getScrollbarWidth();
    document.documentElement.classList.add("modal-open");
    document.body.classList.add("modal-open");
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    if (pad > 0) document.body.style.paddingRight = `${pad}px`;
  }

  function removeLock() {
    document.documentElement.classList.remove("modal-open");
    document.body.classList.remove("modal-open");
    document.body.style.overflow = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.paddingRight = "";
    window.scrollTo(0, savedScrollY);
  }

  function lockBodyScroll() {
    if (lockCount === 0) applyLock();
    lockCount += 1;
  }

  function unlockBodyScroll() {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) removeLock();
  }

  function isVisibleOverlay(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.id === "sidebar-backdrop") return false;
    if (el.classList.contains("hidden")) return false;

    const style = global.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (style.position !== "fixed") return false;

    const z = parseInt(style.zIndex || "0", 10);
    if (Number.isFinite(z) && z < 40) return false;

    // Full-screen overlays / dialogs
    const coversViewport =
      el.classList.contains("inset-0") ||
      (style.top === "0px" && style.left === "0px" &&
        (style.right === "0px" || el.offsetWidth >= window.innerWidth * 0.9));

    return coversViewport;
  }

  function countOpenOverlays() {
    return Array.from(document.querySelectorAll(".fixed.inset-0, .fixed[class*='z-['], .fixed[style*='z-index']"))
      .filter(isVisibleOverlay).length;
  }

  function syncLockFromDom() {
    const open = countOpenOverlays();
    if (open > 0 && lockCount === 0) {
      lockCount = 1;
      applyLock();
    } else if (open === 0 && lockCount > 0) {
      lockCount = 0;
      removeLock();
    }
  }

  function initModalScrollLock() {
    if (observer) return;

    observer = new MutationObserver(() => {
      // Batch to next frame to avoid thrashing on multi-class toggles
      if (initModalScrollLock._raf) return;
      initModalScrollLock._raf = requestAnimationFrame(() => {
        initModalScrollLock._raf = 0;
        syncLockFromDom();
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });

    // Contain scroll chaining inside modal panels
    document.addEventListener(
      "wheel",
      (e) => {
        if (!document.body.classList.contains("modal-open")) return;
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;
        const overlay = target.closest(".fixed.inset-0");
        if (!overlay) {
          e.preventDefault();
          return;
        }
        // Find nearest scrollable ancestor inside the overlay
        let scroller = target;
        let found = null;
        while (scroller && scroller !== overlay) {
          if (scroller instanceof HTMLElement) {
            const cs = global.getComputedStyle(scroller);
            const oy = cs.overflowY;
            if ((oy === "auto" || oy === "scroll") && scroller.scrollHeight > scroller.clientHeight) {
              found = scroller;
              break;
            }
          }
          scroller = scroller.parentElement;
        }
        if (!found) {
          // Overlay itself may scroll
          if (overlay.scrollHeight > overlay.clientHeight) found = overlay;
        }
        if (!found) {
          e.preventDefault();
          return;
        }

        const { scrollTop, scrollHeight, clientHeight } = found;
        const delta = e.deltaY;
        const atTop = scrollTop <= 0 && delta < 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && delta > 0;
        if (atTop || atBottom) e.preventDefault();
      },
      { passive: false }
    );

    document.addEventListener(
      "touchmove",
      (e) => {
        if (!document.body.classList.contains("modal-open")) return;
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;
        const overlay = target.closest(".fixed.inset-0");
        if (!overlay) {
          e.preventDefault();
          return;
        }
        // Allow touch scrolling only inside scrollable modal content
        const scroller = target.closest(
          ".overflow-y-auto, .overflow-auto, [data-modal-scroll]"
        );
        if (!scroller) {
          // If the overlay itself is the scroll container, allow it
          if (overlay.scrollHeight > overlay.clientHeight) return;
          e.preventDefault();
        }
      },
      { passive: false }
    );

    syncLockFromDom();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initModalScrollLock);
  } else {
    initModalScrollLock();
  }

  global.lockBodyScroll = lockBodyScroll;
  global.unlockBodyScroll = unlockBodyScroll;
  global.syncModalScrollLock = syncLockFromDom;
})(typeof window !== "undefined" ? window : globalThis);
