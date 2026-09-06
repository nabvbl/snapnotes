// live-drag.js — SnapNotes Mode A: drag terus atas page (macam Copyfish)
// Di-inject oleh background bila user pilih Snap. Overlay + crosshair,
// drag untuk pilih kawasan, hantar rect ke background untuk crop+OCR.

(function () {
  if (window.__snapnotesLiveDrag) return; // guard double-inject
  window.__snapnotesLiveDrag = true;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function makeOverlay() {
    const o = document.createElement("div");
    o.id = "snapnotes-live-overlay";
    o.style.cssText =
      "position:fixed;top:0;left:0;width:100vw;height:100vh;" +
      "background:rgba(0,0,0,0.25);cursor:crosshair;z-index:2147483646;" +
      "user-select:none;-webkit-user-select:none;";
    const sel = document.createElement("div");
    sel.id = "snapnotes-live-sel";
    sel.style.cssText =
      "position:absolute;border:1.5px solid #C6F04C;" +
      "background:rgba(198,240,76,0.10);display:none;pointer-events:none;";
    o.appendChild(sel);
    return o;
  }

  async function startDrag() {
    // buang overlay lama kalau ada
    document.getElementById("snapnotes-live-overlay")?.remove();
    const overlay = makeOverlay();
    document.body.appendChild(overlay);
    const sel = overlay.querySelector("#snapnotes-live-sel");

    // hint text
    const hint = document.createElement("div");
    hint.textContent = "Drag to select area. Esc to cancel.";
    hint.style.cssText =
      "position:fixed;top:12px;left:50%;transform:translateX(-50%);" +
      "background:#141416;color:#C6F04C;border:1px solid #2A2B2F;" +
      "padding:6px 14px;border-radius:6px;font:600 13px/1.4 'Segoe UI',sans-serif;" +
      "z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,.4);";
    overlay.appendChild(hint);

    let sx = 0, sy = 0, dragging = false;

    const onDown = (e) => {
      e.preventDefault();
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      sel.style.left = sx + "px";
      sel.style.top = sy + "px";
      sel.style.width = "0px";
      sel.style.height = "0px";
      sel.style.display = "block";
    };
    const onMove = (e) => {
      if (!dragging) return;
      const w = e.clientX - sx, h = e.clientY - sy;
      sel.style.left = (w < 0 ? e.clientX : sx) + "px";
      sel.style.top = (h < 0 ? e.clientY : sy) + "px";
      sel.style.width = Math.abs(w) + "px";
      sel.style.height = Math.abs(h) + "px";
    };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      const w = Math.abs(e.clientX - sx);
      const h = Math.abs(e.clientY - sy);
      cleanup();
      if (w < 10 || h < 10) return; // terlalu kecil, abaikan
      const rect = {
        x: Math.round(Math.min(sx, e.clientX)),
        y: Math.round(Math.min(sy, e.clientY)),
        w: Math.round(w),
        h: Math.round(h),
        dpr: window.devicePixelRatio || 1,
      };
      chrome.runtime.sendMessage({ type: "LIVE_SELECTED", rect });
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        cleanup();
      }
    };
    function cleanup() {
      overlay.remove();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey, true);
      window.__snapnotesLiveDrag = false; // allow re-arm on next click
    }

    overlay.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey, true);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "LIVE_START") {
      startDrag();
      sendResponse({ ok: true });
    }
    return false;
  });
})();
