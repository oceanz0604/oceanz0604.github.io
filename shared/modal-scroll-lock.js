/**
 * OceanZ - Lightweight modal scroll lock
 * Locks background scroll while fixed overlay modals are open.
 * Avoids document-wide MutationObservers (those caused UI lag).
 */
(function (global) {
  let lockCount = 0;
  let savedScrollY = 0;
  let observed = new WeakSet();
  let bodyChildObserver = null;

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

    return (
      el.classList.contains("inset-0") ||
      (style.top === "0px" && style.left === "0px")
    );
  }

  function countOpenOverlays() {
    return Array.from(
      document.querySelectorAll(".fixed.inset-0, [id$='Modal'], [id$='modal']")
    ).filter(isVisibleOverlay).length;
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

  function watchOverlay(el) {
    if (!(el instanceof HTMLElement) || observed.has(el)) return;
    if (!el.classList.contains("fixed") && !/modal/i.test(el.id || "")) return;
    observed.add(el);
    new MutationObserver(syncLockFromDom).observe(el, {
      attributes: true,
      attributeFilter: ["class", "style"]
    });
  }

  function initModalScrollLock() {
    // Watch known modals only (class toggles), not the whole document tree
    document.querySelectorAll(".fixed.inset-0, [id$='Modal'], [id$='modal']").forEach(watchOverlay);

    // Watch for dynamically inserted overlays (confirm dialogs) — childList only
    bodyChildObserver = new MutationObserver(mutations => {
      let needsSync = false;
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node instanceof HTMLElement) {
            watchOverlay(node);
            if (node.classList?.contains("fixed")) needsSync = true;
            node.querySelectorAll?.(".fixed.inset-0").forEach(watchOverlay);
          }
        });
        if (m.removedNodes.length) needsSync = true;
      });
      if (needsSync) syncLockFromDom();
    });
    bodyChildObserver.observe(document.body, { childList: true, subtree: false });

    // Contain scroll chaining at edges of modal content
    document.addEventListener(
      "wheel",
      (e) => {
        if (!document.body.classList.contains("modal-open")) return;
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;
        const overlay = target.closest(".fixed.inset-0, [id$='Modal']");
        if (!overlay) {
          e.preventDefault();
          return;
        }

        let node = target;
        let scroller = null;
        while (node && node !== overlay) {
          if (node instanceof HTMLElement) {
            const cs = global.getComputedStyle(node);
            if ((cs.overflowY === "auto" || cs.overflowY === "scroll") &&
                node.scrollHeight > node.clientHeight) {
              scroller = node;
              break;
            }
          }
          node = node.parentElement;
        }
        if (!scroller && overlay.scrollHeight > overlay.clientHeight) scroller = overlay;
        if (!scroller) {
          e.preventDefault();
          return;
        }

        const { scrollTop, scrollHeight, clientHeight } = scroller;
        const atTop = scrollTop <= 0 && e.deltaY < 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;
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
        const overlay = target.closest(".fixed.inset-0, [id$='Modal']");
        if (!overlay) {
          e.preventDefault();
          return;
        }
        const scroller = target.closest(".overflow-y-auto, .overflow-auto, [data-modal-scroll]");
        if (!scroller && !(overlay.scrollHeight > overlay.clientHeight)) {
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
