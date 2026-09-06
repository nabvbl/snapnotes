// panel.js — SnapNotes OCR panel v2
// 1) baca screenshot dari storage.session 2) drag select 3) OCR 4) actions

const img = document.getElementById("shot");
const stage = document.getElementById("stage");
const sel = document.getElementById("sel");
const ocrPreview = document.getElementById("ocrPreview");
const status = document.getElementById("status");
const subjectSel = document.getElementById("subjectSel");

const btnCopy = document.getElementById("btnCopy");
const btnSave = document.getElementById("btnSave");
const btnSaveNote = document.getElementById("btnSaveNote");
const btnTranslate = document.getElementById("btnTranslate");
const btnFormat = document.getElementById("btnFormat");

// ── custom subjects (chrome.storage.local) ──
const DEFAULT_SUBJECTS = [
  "Math", "Programming", "Networking", "Security", "OS", "Business", "Other",
];
let customSubjects = [];

async function loadSubjects() {
  try {
    const s = await chrome.storage.local.get("snapSubjects");
    customSubjects = Array.isArray(s.snapSubjects) ? s.snapSubjects : [];
  } catch (e) {
    customSubjects = [];
  }
  populateSubjectSelect();
}

function populateSubjectSelect() {
  const current = subjectSel.value;
  subjectSel.innerHTML = "";
  const autoOpt = document.createElement("option");
  autoOpt.value = "auto";
  autoOpt.textContent = "Auto-tag subject";
  subjectSel.appendChild(autoOpt);
  for (const subj of [...DEFAULT_SUBJECTS, ...customSubjects]) {
    const opt = document.createElement("option");
    opt.value = subj;
    opt.textContent = subj;
    subjectSel.appendChild(opt);
  }
  // special option untuk add new
  const addOpt = document.createElement("option");
  addOpt.value = "__add__";
  addOpt.textContent = "+ Add subject...";
  subjectSel.appendChild(addOpt);
  // restore kalau masih wujud
  if ([...DEFAULT_SUBJECTS, ...customSubjects].includes(current)) {
    subjectSel.value = current;
  }
}

async function addCustomSubject(name) {
  name = (name || "").trim();
  if (!name || DEFAULT_SUBJECTS.includes(name)) return false;
  if (!customSubjects.includes(name)) {
    customSubjects.push(name);
    await chrome.storage.local.set({ snapSubjects: customSubjects });
  }
  return true;
}

subjectSel.addEventListener("change", async () => {
  if (subjectSel.value === "__add__") {
    const name = await askModal(
      "Add subject",
      "New subject name",
      "Add"
    );
    if (name) {
      await addCustomSubject(name);
      populateSubjectSelect();
      subjectSel.value = name;
      setStatus("Subject added: " + name);
    } else {
      populateSubjectSelect();
    }
  }
});

// ── modal (rename / add subject) ──
const modalWrap = document.getElementById("modalWrap");
const modalTitle = document.getElementById("modalTitle");
const modalSub = document.getElementById("modalSub");
const modalInput = document.getElementById("modalInput");
const modalOk = document.getElementById("modalOk");
const modalCancel = document.getElementById("modalCancel");

function askModal(title, sub, okLabel) {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalSub.textContent = sub;
    modalOk.textContent = okLabel || "Save";
    modalInput.value = "";
    modalWrap.classList.remove("hidden");
    modalInput.focus();
    const finish = (val) => {
      modalWrap.classList.add("hidden");
      modalOk.removeEventListener("click", onOk);
      modalCancel.removeEventListener("click", onCancel);
      modalInput.removeEventListener("keydown", onKey);
      resolve(val);
    };
    const onOk = () => finish(modalInput.value.trim() || null);
    const onCancel = () => finish(null);
    const onKey = (e) => {
      if (e.key === "Enter") onOk();
      if (e.key === "Escape") onCancel();
    };
    modalOk.addEventListener("click", onOk);
    modalCancel.addEventListener("click", onCancel);
    modalInput.addEventListener("keydown", onKey);
  });
}

// sanitize nama fail utk Windows
function sanitizeFilename(name) {
  return (name || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function setStatus(t) {
  status.textContent = t;
  console.log("[SnapNotes]", t);
}

// ── load screenshot from session storage ──
let dataUrl = null;
let scale = 1;

async function loadShot() {
  try {
    const s = await chrome.storage.session.get([
      "snapDataUrl",
      "snapRect",
    ]);
    dataUrl = s.snapDataUrl || null;
    if (!dataUrl) {
      setStatus("No screenshot found. Press Alt+Shift+S first.");
      return;
    }
    pendingRect = s.snapRect || null;
    img.src = dataUrl;
    setStatus("Loading screenshot...");
  } catch (e) {
    setStatus("Failed to read screenshot: " + e.message);
  }
}

let pendingRect = null;

img.onload = () => {
  const stageRect = stage.getBoundingClientRect();
  const maxW = Math.max(stageRect.width - 20, 200);
  scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
  img.style.width = Math.round(img.naturalWidth * scale) + "px";
  img.style.height = Math.round(img.naturalHeight * scale) + "px";
  if (pendingRect) {
    // Mode A: user dah pilih kawasan atas page — auto OCR terus
    rect = pendingRect;
    pendingRect = null;
    drawRectOverlay();
    setStatus(`Selection ${rect.w}x${rect.h}px. OCR running...`);
    runOCR();
  } else {
    // Mode B: user drag dalam panel
    setStatus(
      `Screenshot ready (${img.naturalWidth}x${img.naturalHeight}). Drag to select.`
    );
  }
};

function drawRectOverlay() {
  const ir = img.getBoundingClientRect();
  sel.style.display = "block";
  sel.style.left = rect.x * scale + "px";
  sel.style.top = rect.y * scale + "px";
  sel.style.width = rect.w * scale + "px";
  sel.style.height = rect.h * scale + "px";
}

// ── drag select ──
let dragging = false, sx = 0, sy = 0;
let rect = null; // natural (unscaled) px

stage.addEventListener("mousedown", (e) => {
  if (e.target !== img) return;
  dragging = true;
  const r = img.getBoundingClientRect();
  sx = e.clientX - r.left;
  sy = e.clientY - r.top;
  sel.style.display = "block";
  sel.style.left = sx + "px";
  sel.style.top = sy + "px";
  sel.style.width = "0px";
  sel.style.height = "0px";
  e.preventDefault();
});
stage.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const r = img.getBoundingClientRect();
  const cx = e.clientX - r.left;
  const cy = e.clientY - r.top;
  updateSel(sx, sy, cx - sx, cy - sy);
});
stage.addEventListener("mouseup", () => {
  if (!dragging) return;
  dragging = false;
  const w = parseFloat(sel.style.width) || 0;
  const h = parseFloat(sel.style.height) || 0;
  if (w < 10 || h < 10) {
    sel.style.display = "none";
    setStatus("Selection too small. Drag again.");
    return;
  }
  const sr = sel.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  rect = {
    x: Math.round((sr.left - ir.left) / scale),
    y: Math.round((sr.top - ir.top) / scale),
    w: Math.round(sr.width / scale),
    h: Math.round(sr.height / scale),
  };
  setStatus(
    `Selection: ${rect.w}x${rect.h}px. OCR running... (first time may take a while)`
  );
  runOCR();
});

function updateSel(x, y, w, h) {
  const left = w < 0 ? x + w : x;
  const top = h < 0 ? y + h : y;
  sel.style.left = left + "px";
  sel.style.top = top + "px";
  sel.style.width = Math.abs(w) + "px";
  sel.style.height = Math.abs(h) + "px";
}

// ── crop + OCR ──
let ocrText = "";
async function runOCR() {
  try {
    const crop = await cropImage(dataUrl, rect);
    setStatus("Preprocessing + OCR running...");
    const processed = await preprocessImage(crop);
    ocrText = await tesseractOCR(processed);
    ocrText = postProcessText(ocrText);
    rawOcrText = ocrText; // simpan versi asal untuk toggle format
    displayOcrText(ocrText);
    ocrPreview.classList.remove("hidden");
    btnCopy.disabled = btnSave.disabled = btnSaveNote.disabled = false;
    btnTranslate.disabled = btnFormat.disabled = false;
    setStatus("Done. Choose an action.");
    autoSuggestSubject(ocrText);
  } catch (e) {
    console.error("OCR error:", e);
    const detail = e && e.message ? e.message : JSON.stringify(e);
    setStatus("OCR error: " + detail);
    ocrPreview.textContent = "ERROR: " + detail;
    ocrPreview.classList.add("err");
    ocrPreview.classList.remove("hidden");
    btnCopy.disabled = btnSave.disabled = btnSaveNote.disabled = true;
    btnTranslate.disabled = btnFormat.disabled = true;
  }
}

// clear session data bila panel tutup (elak rect lama)
window.addEventListener("beforeunload", () => {
  try {
    chrome.storage.session.remove(["snapDataUrl", "snapRect"]);
  } catch (e) {}
});

// ── image preprocessing: grayscale + contrast + sharpen ──
function preprocessImage(dataUrlSrc) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      try {
        // upscale text kecil 1.5-2x untuk OCR accuracy
        const targetW = im.width * 2;
        const targetH = im.height * 2;
        const c = document.createElement("canvas");
        c.width = targetW;
        c.height = targetH;
        const ctx = c.getContext("2d");
        // grayscale dulu
        ctx.drawImage(im, 0, 0, targetW, targetH);
        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        const d = imgData.data;

        // histogram untuk contrast stretch (autocontrast)
        let min = 255, max = 0;
        for (let i = 0; i < d.length; i += 4) {
          // grayscale
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          d[i] = d[i + 1] = d[i + 2] = gray;
          if (gray < min) min = gray;
          if (gray > max) max = gray;
        }
        // contrast stretch: (v - min) / (max - min) * 255
        const range = max - min > 1 ? max - min : 1;
        for (let i = 0; i < d.length; i += 4) {
          let v = ((d[i] - min) / range) * 255;
          // mild threshold untuk bersihkan noise: <100 hitam, >180 putih
          if (v < 90) v = 0;
          else if (v > 200) v = 255;
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(c.toDataURL("image/png"));
      } catch (e2) {
        reject(e2);
      }
    };
    im.onerror = () => reject(new Error("preprocess fail"));
    im.src = dataUrlSrc;
  });
}

// ── post-processing: buang emoji/simbol + normalise spacing ──
function postProcessText(raw) {
  if (!raw) return raw;
  let t = raw;
  // buang emoji & pictograph (surrogate pairs & emoji ranges)
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]/gu,
    ""
  );
  // buang garis hiasan & simbol berulang (───, ***, ===, dll)
  t = t.replace(/^[\s─━═*_\-—–·•│|]+$/gm, "");
  // buang aksara kawalan
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  // normalise spacing: pelbagai whitespace -> satu
  t = t.replace(/[ \t]+/g, " ");
  // ruang sebelum tanda baca -> buang ("hello ," -> "hello,")
  t = t.replace(/\s+([,.;:!?%)\]}>])/g, "$1");
  // ruang selepas kurung buka -> buang ("( hello" -> "(hello")
  t = t.replace(/([([{<])\s+/g, "$1");
  // baris kosong berlebihan
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

async function cropImage(dataUrlSrc, r) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = r.w;
        c.height = r.h;
        const ctx = c.getContext("2d");
        ctx.drawImage(im, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        resolve(c.toDataURL("image/png"));
      } catch (e2) {
        reject(e2);
      }
    };
    im.onerror = () => reject(new Error("crop fail: cannot read image"));
    im.src = dataUrlSrc;
  });
}

async function tesseractOCR(canvasDataUrl) {
  if (typeof Tesseract === "undefined") {
    throw new Error("tesseract.min.js tak load — check lib folder");
  }
  const worker = await Tesseract.createWorker("eng", 1, {
    workerPath: chrome.runtime.getURL("lib/tesseract/worker.min.js"),
    corePath: chrome.runtime.getURL("lib/tesseract/"),
    langPath: chrome.runtime.getURL("lib/tessdata/"),
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === "recognizing text" && m.progress) {
        setStatus("OCR " + Math.round(m.progress * 100) + "%");
      }
    },
  });
  try {
    // config: spacing lebih natural + single column text (bukan layout rumit)
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6", // assume single uniform block of text
    });
    const { data } = await worker.recognize(canvasDataUrl);
    return data.text || "";
  } finally {
    await worker.terminate();
  }
}

// ── auto subject tagging (keyword based) ──
const SUBJECT_KEYWORDS = {
  Math: [
    "integral", "derivative", "calculus", "equation", "matrix",
    "function", "formula", "theorem", "graph", "limit", "differential",
    "sin", "cos", "tan", "log", "solve", "vector", "probability",
  ],
  Programming: [
    "python", "javascript", "java", "code", "function()", "class ",
    "variable", "array", "loop", "api", "syntax", "compile", "html",
    "css", "react", "sql", "algorithm", "null", "database",
  ],
  Networking: [
    "tcp", "ip", "http", "dns", "packet", "router", "subnet", "lan",
    "wan", "protocol", "ipv4", "ipv6", "osi", "dhcp", "nat", "port",
    "bandwidth", "latency", "switch", "vlan",
  ],
  Security: [
    "security", "password", "encryption", "firewall", "malware",
    "phishing", "vulnerability", "exploit", "hash", "authentication",
    "cyber", "ransomware", "ddos", "penetration", "ssl", "cipher",
  ],
  OS: [
    "process", "thread", "kernel", "memory", "cpu", "scheduler",
    "deadlock", "file system", "linux", "windows", "virtual memory",
    "paging", "semaphore", "mutex", "boot", "shell",
  ],
  Business: [
    "revenue", "profit", "marketing", "customer", "sales", "management",
    "business", "strategy", "invoice", "order", "budget",
  ],
};

function autoSuggestSubject(text) {
  const lower = text.toLowerCase();
  let best = "Other";
  let bestScore = 0;
  for (const [subj, kws] of Object.entries(SUBJECT_KEYWORDS)) {
    let score = 0;
    for (const kw of kws) {
      if (lower.includes(kw.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = subj;
    }
  }
  subjectSel.value = best;
}

// ── actions ──
let rawOcrText = "";
let formattedActive = false;

function displayOcrText(t) {
  ocrPreview.textContent = (t || "").trim() || "(no text detected)";
}

// Smart Format: susun OCR text jadi label:value bila pattern dikenali
function smartFormat(text) {
  if (!text) return text;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    out.push(smartFormatLine(line));
  }
  return out.join("\n");
}

function smartFormatLine(line) {
  // Pattern: "Label VALUE" di mana Label dikenali (Name, No., Date, dll)
  // Label = perkataan/token yang diikuti value, dipisah ruang besar/kolum
  // Heuristic: cari baris yang ada 2+ kolum berjarak, tukar jadi Label : Value
  const knownLabels = new Set([
    "name", "semester", "enrollment", "no.", "no", "ic", "passport",
    "programme", "code", "subject", "date", "time", "venue", "seat",
    "exam", "duration", "total", "section", "group", "class",
  ]);
  // Pisah kolum guna 2+ spaces (OCR biasanya preserve jarak tu)
  const parts = line.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // Kalau part pertama nampak macam label tunggal -> Label : rest
    const first = parts[0].replace(/[:\s]+$/, "");
    const lowerFirst = first.toLowerCase();
    const singleWordLabel = /^[A-Za-z][A-Za-z .&/-]*$/.test(first);
    const looksLabel = knownLabels.has(lowerFirst) ||
      knownLabels.has(lowerFirst.replace(/\.$/, "")) ||
      (singleWordLabel && parts[0].split(/\s+/).length <= 2 &&
       /^[A-Z]/.test(first) && !first.endsWith(".") &&
       knownLabels.has(first.split(/\s+/)[0].toLowerCase().replace(/\.$/, "")));
    if (looksLabel) {
      // Bina baris label : value (value = baki kolum, kekal berasingan)
      const label = first;
      const vals = parts.slice(1).join(" ");
      return `${label} : ${vals}`;
    }
  }
  // Single kolum — cuba split pada ruang pertama jika label dikenali
  const m = line.match(/^([A-Za-z][A-Za-z .&/-]*?)\s+(\S.*)$/);
  if (m) {
    const label = m[1].replace(/[:\s]+$/, "");
    const lower = label.toLowerCase().replace(/\.$/, "");
    if (knownLabels.has(lower)) {
      return `${label} : ${m[2].trim()}`;
    }
  }
  return line;
}

btnFormat.addEventListener("click", () => {
  if (!formattedActive) {
    const fmt = smartFormat(rawOcrText || ocrText);
    displayOcrText(fmt);
    ocrText = fmt;
    formattedActive = true;
    setStatus("Smart format applied. Click again to revert.");
  } else {
    ocrText = rawOcrText;
    displayOcrText(rawOcrText);
    formattedActive = false;
    setStatus("Reverted to raw OCR.");
  }
});

btnTranslate.addEventListener("click", async () => {
  const text = ocrText || "";
  if (!text.trim()) return;
  // Auto-detect source, target BM default (boleh tukar kat page)
  const url =
    "https://translate.google.com/?sl=auto&tl=ms&op=translate&text=" +
    encodeURIComponent(text);
  const tab = await chrome.tabs.create({ url, active: true });
  setStatus("Opening Google Translate...");
});
function stamp() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

async function getCropDataUrl() {
  return await cropImage(dataUrl, rect);
}

btnCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(ocrText);
    setStatus("Text copied to clipboard!");
  } catch (e) {
    setStatus("Copy fail: " + e.message);
  }
});

function getEffectiveSubject() {
  const v = subjectSel.value;
  if (!v || v === "auto" || v === "__add__") return "Other";
  return v;
}

async function askFilename(kind, subject) {
  // default: subject_tarikh
  const def = `${subject}_${stamp()}`;
  const title = kind === "note" ? "Save note" : "Save image";
  const sub =
    kind === "note"
      ? "File name (saved under subject folder)"
      : "File name (saved in SnapNotes folder)";
  const name = await askModal(title, sub, "Save");
  if (!name) return null;
  return sanitizeFilename(name) || def;
}

btnSave.addEventListener("click", async () => {
  try {
    const subject = getEffectiveSubject();
    const fname = await askFilename("image", subject);
    if (!fname) return; // user cancel
    const crop = await getCropDataUrl();
    const path = `SnapNotes/${fname}.png`;
    await chrome.downloads.download({ url: crop, filename: path });
    setStatus("Image saved: " + fname + ".png");
  } catch (e) {
    setStatus("Save fail: " + e.message);
  }
});

btnSaveNote.addEventListener("click", async () => {
  try {
    const subject = getEffectiveSubject();
    const base = await askFilename("note", subject);
    if (!base) return; // user cancel
    const safeSubj = subject.replace(/[^\w\- ]/g, "_").replace(/\s+/g, "_");
    const crop = await getCropDataUrl();
    const fname = `SnapNotes/${safeSubj}/${base}.png`;
    const dlId = await chrome.downloads.download({ url: crop, filename: fname });
    await saveNoteToDb({
      subject,
      text: ocrText,
      filename: fname,
      downloadId: dlId,
      created: Date.now(),
    });
    setStatus("Note saved & indexed! Search via the SnapNotes icon.");
  } catch (e) {
    setStatus("Save note failed: " + e.message);
  }
});

// IndexedDB helper
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
async function saveNoteToDb(note) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("notes", "readwrite");
    tx.objectStore("notes").add(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// init
loadSubjects();
loadShot();
