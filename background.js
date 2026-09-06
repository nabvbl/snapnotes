// background.js — SnapNotes v3
// Mode A: live drag atas page (default, macam Copyfish)
// Mode B: capture-then-drag dalam panel (fallback utk PDF/special pages)
// Trigger: hotkey Alt+Shift+S ATAU SNAP message dari popup.

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tab;
}

// ── Mode A: live drag ──
async function startLiveDrag() {
  const tab = await getActiveTab();
  if (!tab || tab.id === undefined) return;
  try {
    // inject content script (guard: executeScript idempotent-ish; live-drag.js
    // ada self-guard window.__snapnotesLiveDrag)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["live-drag.js"],
    });
    // beritahu content script mula drag
    await chrome.tabs.sendMessage(tab.id, { type: "LIVE_START" });
  } catch (e) {
    // inject/send gagal — contoh page chrome:// PDF viewer, chrome store, dll
    console.warn("Mode A tak boleh (", e.message, ") — fallback Mode B");
    await startCapturePanel();
  }
}

// ── Mode B: capture-then-drag dalam panel ──
async function startCapturePanel() {
  const tab = await getActiveTab();
  if (!tab || tab.id === undefined) return;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
    await chrome.storage.session.set({ snapDataUrl: dataUrl });
    const url = chrome.runtime.getURL("panel.html");
    await chrome.windows.create({
      url,
      type: "popup",
      width: 960,
      height: 800,
      focused: true,
    });
  } catch (e) {
    console.error("SnapNotes capture fail:", e);
  }
}

// ── LIVE_SELECTED: user dah drag dalam Mode A, crop & buka panel ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "LIVE_SELECTED" && sender.tab) {
    (async () => {
      try {
        // capture penuh viewport
        const dataUrl = await chrome.tabs.captureVisibleTab(
          sender.tab.windowId,
          { format: "png" }
        );
        // simpan + rect untuk panel crop (tukar CSS px -> natural px guna dpr)
        const dpr = msg.rect.dpr || 1;
        await chrome.storage.session.set({
          snapDataUrl: dataUrl,
          snapRect: {
            x: Math.round(msg.rect.x * dpr),
            y: Math.round(msg.rect.y * dpr),
            w: Math.round(msg.rect.w * dpr),
            h: Math.round(msg.rect.h * dpr),
          },
        });
        const url = chrome.runtime.getURL("panel.html");
        await chrome.windows.create({
          url,
          type: "popup",
          width: 960,
          height: 800,
          focused: true,
        });
        sendResponse({ ok: true });
      } catch (e) {
        console.error("live select fail:", e);
        sendResponse({ ok: false, err: String(e) });
      }
    })();
    return true; // async
  }
  return false;
});

// ── triggers ──
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "snap") startLiveDrag();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "SNAP") {
    startLiveDrag();
    sendResponse({ ok: true });
  }
  return false;
});
