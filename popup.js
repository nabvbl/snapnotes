// popup.js — SnapNotes search + snap button
const searchInput = document.getElementById("search");
const listEl = document.getElementById("list");
const snapBtn = document.getElementById("snapBtn");

// ── IndexedDB ──
const DB_NAME = "snapnotes";
const DB_VER = 1;
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("notes")) {
        const store = db.createObjectStore("notes", {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("subject", "subject");
        store.createIndex("created", "created");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllNotes() {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDb();
      const tx = db.transaction("notes", "readonly");
      const req = tx.objectStore("notes").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

// ── search ──
function fuzzyMatch(text, q) {
  const t = text.toLowerCase();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => t.includes(w));
}

async function render(query) {
  const notes = await getAllNotes();
  const q = (query || "").trim();
  const filtered = q
    ? notes.filter(
        (n) => fuzzyMatch(n.subject + " " + n.text, q) ||
          fuzzyMatch(n.subject, q)
      )
    : notes;

  // sort newest first
  filtered.sort((a, b) => (b.created || 0) - (a.created || 0));

  if (filtered.length === 0) {
    listEl.innerHTML = q
      ? '<div class="empty">No notes found for "' + q + '"</div>'
      : '<div class="empty">No notes yet. Snap & save first!</div>';
    return;
  }
  listEl.innerHTML = "";
  for (const n of filtered) {
    const div = document.createElement("div");
    div.className = "note";
    const d = new Date(n.created);
    const dateStr = d.toLocaleDateString("en-MY") + " " +
      d.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
    const fullTxt = (n.text || "").trim();
    const preview = fullTxt.slice(0, 260);
    const isLong = fullTxt.length > 260;
    const fname = (n.filename || "").split("/").pop();

    // header: subject + copy button
    const head = document.createElement("div");
    head.className = "head";
    const subj = document.createElement("div");
    subj.className = "subj";
    subj.textContent = n.subject || "Other";
    const copyBtn = document.createElement("button");
    copyBtn.className = "copyBtn";
    copyBtn.textContent = "Copy";
    copyBtn.title = "Copy full text";
    copyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(fullTxt);
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy"), 900);
      } catch (err) {}
    });
    head.appendChild(subj);
    head.appendChild(copyBtn);

    // text preview (expandable)
    const txt = document.createElement("div");
    txt.className = "txt";
    txt.textContent = preview || "(no text)";
    txt.title = "Click to expand / collapse";

    // meta + expand hint
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = dateStr + " - " + fname;
    if (isLong) {
      const expand = document.createElement("div");
      expand.className = "expand";
      expand.textContent = "Show full text";
      meta.appendChild(document.createElement("br"));
      meta.appendChild(expand);
    }

    // click card -> toggle expand
    div.addEventListener("click", () => {
      const isOpen = txt.classList.contains("open");
      if (isOpen) {
        txt.classList.remove("open");
        txt.textContent = preview || "(no text)";
        if (isLong) div.querySelector(".expand").textContent = "Show full text";
      } else {
        txt.classList.add("open");
        txt.textContent = fullTxt || "(no text)";
        if (isLong) div.querySelector(".expand").textContent = "Show less";
      }
    });

    // actions: open location + delete
    const acts = document.createElement("div");
    acts.className = "acts";

    // Open location
    const openBtn = document.createElement("button");
    openBtn.className = "actBtn";
    openBtn.textContent = "Open Location";
    openBtn.title = "Show file in folder";
    openBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        if (n.downloadId !== undefined && n.downloadId !== null) {
          // buka Explorer & highlight file tu
          chrome.downloads.show(n.downloadId);
        } else {
          // fallback: buka folder Downloads (best effort)
          chrome.downloads.showDefaultFolder();
        }
        window.close();
      } catch (err) {}
    });
    acts.appendChild(openBtn);

    // Delete (two-step confirm)
    const delBtn = document.createElement("button");
    delBtn.className = "actBtn danger";
    delBtn.textContent = "Delete";
    delBtn.title = "Delete note from library";
    let armed = false;
    let armTimer = null;
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!armed) {
        armed = true;
        delBtn.classList.add("confirm");
        delBtn.textContent = "Confirm delete?";
        armTimer = setTimeout(() => {
          armed = false;
          delBtn.classList.remove("confirm");
          delBtn.textContent = "Delete";
        }, 2500);
        return;
      }
      clearTimeout(armTimer);
      // delete dari IndexedDB
      await deleteNoteById(n.id);
      // cuba buang file dari disk guna download API kalau ada
      if (n.downloadId !== undefined && n.downloadId !== null) {
        try {
          await chrome.downloads.removeFile(n.downloadId);
        } catch (err) {}
      }
      render(searchInput.value); // refresh list
    });
    acts.appendChild(delBtn);

    div.appendChild(head);
    div.appendChild(txt);
    div.appendChild(meta);
    div.appendChild(acts);
    listEl.appendChild(div);
  }
}

function deleteNoteById(id) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDb();
      const tx = db.transaction("notes", "readwrite");
      tx.objectStore("notes").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) {
      reject(e);
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ── events ──
searchInput.addEventListener("input", () => render(searchInput.value));
snapBtn.addEventListener("click", async () => {
  // minta background snap
  await chrome.runtime.sendMessage({ type: "SNAP" });
  window.close(); // tutup popup, panel akan buka
});
document.addEventListener("DOMContentLoaded", () => render(""));
render("");
