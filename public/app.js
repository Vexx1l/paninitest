// ============================================================================
// Álbum Mundial 2026 — control de figuritas
// Todo corre en el navegador. Los datos se guardan en localStorage, y
// opcionalmente se sincronizan entre dispositivos vía Firebase (ver
// firebase-config.js y el README).
// ============================================================================

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const STORAGE_KEY = "figuritas-album-v1";
// Precio automático por tipo de figurita: las comunes valen PRICE_COMMON y
// los escudos (#1 de cada equipo), formaciones (#13 de cada equipo) y las
// especiales (sección "FWC*") valen PRICE_PREMIUM. Ambos son editables desde
// la barra de herramientas; esto es solo el valor por defecto.
const PRICE_COMMON_KEY = "figuritas-price-common-v1";
const PRICE_PREMIUM_KEY = "figuritas-price-premium-v1";

/** @type {Array<{id:string, code:string, emoji:string, label:string, stickers:string[]}>} */
let SECTIONS = [];

/** state[stickerKey] = { owned: boolean, price: number|null } */
let state = {};

let openSections = new Set(); // ids of expanded team sections
let searchQuery = "";
let onlyMissing = false;
let onlyRepeats = false;

// ----------------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("No se pudo leer el álbum guardado", e);
    state = {};
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("No se pudo guardar el álbum", e);
    showToast("No se pudo guardar (¿modo privado?)");
  }
  scheduleCloudPush();
}

function stickerKey(sectionId, num) {
  return `${sectionId}#${num}`;
}

function getEntry(key) {
  const entry = state[key] || { owned: false, price: null, qty: 1 };
  if (entry.qty === undefined || entry.qty === null) entry.qty = 1;
  return entry;
}

function setOwned(key, owned) {
  const entry = getEntry(key);
  entry.owned = owned;
  if (owned && (entry.price === null || entry.price === undefined)) {
    const { section, num } = sectionAndNumFromKey(key);
    entry.price = section ? defaultPriceFor(section, num) : getCommonPrice();
  }
  if (owned && !entry.qty) entry.qty = 1;
  state[key] = entry;
}

function setPrice(key, price) {
  const entry = getEntry(key);
  entry.price = price;
  state[key] = entry;
}

function setQty(key, qty) {
  const entry = getEntry(key);
  const clamped = Math.max(1, Math.min(999, Math.round(qty) || 1));
  entry.qty = clamped;
  state[key] = entry;
}

// ----------------------------------------------------------------------------
// Precios automáticos por tipo de figurita
// ----------------------------------------------------------------------------
function getCommonPrice() {
  const v = Number(localStorage.getItem(PRICE_COMMON_KEY));
  return Number.isFinite(v) && v >= 0 ? v : 1000;
}

function getPremiumPrice() {
  const v = Number(localStorage.getItem(PRICE_PREMIUM_KEY));
  return Number.isFinite(v) && v >= 0 ? v : 2000;
}

/**
 * "escudo" = figurita #1 de un equipo, "formacion" = figurita #13 de un
 * equipo, "especial" = cualquier figurita de una sección "FWC*" (trofeo,
 * sedes, historia), "comun" = todo el resto.
 */
function stickerKind(section, num) {
  if (!section) return "comun";
  if (section.id.startsWith("FWC")) return "especial";
  if (num === "1") return "escudo";
  if (num === "13") return "formacion";
  return "comun";
}

function kindLabel(kind) {
  switch (kind) {
    case "escudo":
      return "Escudo";
    case "formacion":
      return "Formación";
    case "especial":
      return "Especial";
    default:
      return "";
  }
}

function defaultPriceFor(section, num) {
  return stickerKind(section, num) === "comun" ? getCommonPrice() : getPremiumPrice();
}

function refreshPriceLegend() {
  const legendCommon = document.getElementById("price-legend-common");
  const legendPremium = document.getElementById("price-legend-premium");
  if (legendCommon) legendCommon.textContent = getCommonPrice().toLocaleString("es-AR");
  if (legendPremium) legendPremium.textContent = getPremiumPrice().toLocaleString("es-AR");
}

function sectionAndNumFromKey(key) {
  const idx = key.lastIndexOf("#");
  const sectionId = key.slice(0, idx);
  const num = key.slice(idx + 1);
  const section = SECTIONS.find((s) => s.id === sectionId);
  return { section, num };
}

/**
 * Reaplica el precio automático (según el tipo de figurita) a todas las
 * figuritas marcadas como tuyas. Si `onlyEmpty` es true, solo completa las
 * que no tienen precio cargado; si es false, pisa también las que ya tenían
 * un precio puesto a mano.
 */
function recalcAllPrices(onlyEmpty) {
  let changed = 0;
  for (const section of SECTIONS) {
    for (const num of section.stickers) {
      const key = stickerKey(section.id, num);
      const entry = getEntry(key);
      if (!entry.owned) continue;
      const hasPrice = typeof entry.price === "number";
      if (onlyEmpty && hasPrice) continue;
      const price = defaultPriceFor(section, num);
      if (entry.price !== price) {
        entry.price = price;
        state[key] = entry;
        changed++;
      }
    }
  }
  return changed;
}

// ----------------------------------------------------------------------------
// Load checklist data
// ----------------------------------------------------------------------------
async function loadSections() {
  const res = await fetch("./sections.json");
  SECTIONS = await res.json();
}

function totalStickerCount() {
  return SECTIONS.reduce((sum, s) => sum + s.stickers.length, 0);
}

// ----------------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------------
const el = {
  sections: document.getElementById("sections"),
  scoreOwned: document.getElementById("score-owned"),
  scoreTotal: document.getElementById("score-total-stickers"),
  scorePercent: document.getElementById("score-percent"),
  scoreMoney: document.getElementById("score-money"),
  search: document.getElementById("search"),
  priceCommon: document.getElementById("price-common"),
  pricePremium: document.getElementById("price-premium"),
  btnMissing: document.getElementById("btn-missing"),
  btnOnlyRepeats: document.getElementById("btn-onlyrepeats"),
  btnReset: document.getElementById("btn-reset"),
  repeatsBadge: document.getElementById("repeats-badge"),
  syncBadge: document.getElementById("sync-badge"),
};

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matchesSearch(section) {
  if (!searchQuery) return true;
  const q = normalize(searchQuery);
  return (
    normalize(section.label).includes(q) || normalize(section.code).includes(q)
  );
}

function renderScoreboard() {
  const total = totalStickerCount();
  let owned = 0;
  let money = 0;
  for (const section of SECTIONS) {
    for (const num of section.stickers) {
      const entry = getEntry(stickerKey(section.id, num));
      if (entry.owned) {
        owned += 1;
        if (typeof entry.price === "number") money += entry.price;
      }
    }
  }
  el.scoreOwned.textContent = owned.toLocaleString("es-AR");
  el.scoreTotal.textContent = `/ ${total}`;
  el.scorePercent.textContent = `${Math.round((owned / total) * 100)}%`;
  el.scoreMoney.textContent = money.toLocaleString("es-AR", {
    maximumFractionDigits: 0,
  });
}

function renderSections() {
  el.sections.innerHTML = "";

  const visible = SECTIONS.filter(matchesSearch);

  if (visible.length === 0) {
    el.sections.innerHTML = `<div class="empty-state">No encontré ningún equipo con “${escapeHtml(
      searchQuery
    )}”.</div>`;
    return;
  }

  for (const section of visible) {
    el.sections.appendChild(renderTeam(section));
  }
}

function renderTeam(section) {
  const wrap = document.createElement("div");
  wrap.className = "team" + (openSections.has(section.id) ? " open" : "");
  wrap.dataset.sectionId = section.id;

  const ownedCount = section.stickers.filter(
    (n) => getEntry(stickerKey(section.id, n)).owned
  ).length;
  const total = section.stickers.length;
  const pct = Math.round((ownedCount / total) * 100);
  const repeatExtra = section.stickers.reduce((sum, n) => {
    const e = getEntry(stickerKey(section.id, n));
    return e.owned && e.qty > 1 ? sum + (e.qty - 1) : sum;
  }, 0);

  const head = document.createElement("button");
  head.className = "team-head";
  head.innerHTML = `
    <span class="team-flag">${section.emoji}</span>
    <span class="team-name">${escapeHtml(section.label)}</span>
    <span class="team-repeat-badge${repeatExtra > 0 ? "" : " hidden"}">🔁 ${repeatExtra}</span>
    <span class="team-progress-wrap">
      <span class="team-progress-track"><span class="team-progress-fill" style="width:${pct}%"></span></span>
      <span class="team-count">${ownedCount}/${total}</span>
    </span>
    <svg class="team-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
  `;
  head.addEventListener("click", () => {
    if (openSections.has(section.id)) openSections.delete(section.id);
    else openSections.add(section.id);
    wrap.classList.toggle("open");
  });

  const body = document.createElement("div");
  body.className = "team-body";
  const grid = document.createElement("div");
  grid.className = "chip-grid";

  let stickers = section.stickers;
  if (onlyMissing) {
    stickers = stickers.filter(
      (n) => !getEntry(stickerKey(section.id, n)).owned
    );
  } else if (onlyRepeats) {
    stickers = stickers.filter((n) => {
      const e = getEntry(stickerKey(section.id, n));
      return e.owned && e.qty > 1;
    });
  }

  if (stickers.length === 0) {
    const msg = onlyRepeats
      ? "No tenés repetidas en este equipo."
      : "¡Completo! No te falta ninguna.";
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:16px 0;">${msg}</div>`;
  } else {
    for (const num of stickers) {
      grid.appendChild(renderChip(section, num));
    }
  }

  body.appendChild(grid);
  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

function renderChip(section, num) {
  const key = stickerKey(section.id, num);
  const entry = getEntry(key);

  const chip = document.createElement("div");
  chip.className = "chip" + (entry.owned ? " owned" : "");
  chip.tabIndex = 0;

  const qtyBadge = document.createElement("div");
  qtyBadge.className = "chip-qty-badge" + (entry.owned && entry.qty > 1 ? "" : " hidden");
  qtyBadge.textContent = `x${entry.qty}`;
  chip.appendChild(qtyBadge);

  const numEl = document.createElement("div");
  numEl.className = "chip-num";
  numEl.textContent = num;
  chip.appendChild(numEl);

  const kind = stickerKind(section, num);
  if (kind !== "comun") {
    const kindEl = document.createElement("div");
    kindEl.className = `chip-kind chip-kind-${kind}`;
    kindEl.textContent = kindLabel(kind);
    chip.appendChild(kindEl);
  }

  const priceInput = document.createElement("input");
  priceInput.className = "chip-price";
  priceInput.type = "number";
  priceInput.min = "0";
  priceInput.inputMode = "decimal";
  priceInput.placeholder = "$";
  priceInput.value =
    entry.owned && typeof entry.price === "number" ? entry.price : "";
  priceInput.style.display = entry.owned ? "block" : "none";
  priceInput.addEventListener("click", (e) => e.stopPropagation());
  priceInput.addEventListener("change", () => {
    const v = priceInput.value === "" ? null : Number(priceInput.value);
    setPrice(key, Number.isFinite(v) ? v : null);
    saveState();
    renderScoreboard();
  });
  chip.appendChild(priceInput);

  // Quantity stepper: lets you register duplicates you own, so they show up
  // as "repetidas para vender" without touching the QR-scanned owned state.
  const stepper = document.createElement("div");
  stepper.className = "chip-qty-stepper" + (entry.owned ? "" : " hidden");

  const minusBtn = document.createElement("button");
  minusBtn.type = "button";
  minusBtn.className = "chip-qty-btn";
  minusBtn.textContent = "–";
  minusBtn.setAttribute("aria-label", "Restar repetida");

  const qtyValue = document.createElement("span");
  qtyValue.className = "chip-qty-value";
  qtyValue.textContent = entry.qty;

  const plusBtn = document.createElement("button");
  plusBtn.type = "button";
  plusBtn.className = "chip-qty-btn";
  plusBtn.textContent = "+";
  plusBtn.setAttribute("aria-label", "Sumar repetida");

  function refreshQtyUI() {
    const e = getEntry(key);
    qtyValue.textContent = e.qty;
    qtyBadge.textContent = `x${e.qty}`;
    qtyBadge.classList.toggle("hidden", !(e.owned && e.qty > 1));
  }

  minusBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const cur = getEntry(key);
    setQty(key, cur.qty - 1);
    saveState();
    refreshQtyUI();
    renderTeamHeaderCounts(section.id);
    updateRepeatsBadge();
    if (onlyRepeats) renderSections();
  });
  plusBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const cur = getEntry(key);
    setQty(key, cur.qty + 1);
    saveState();
    refreshQtyUI();
    renderTeamHeaderCounts(section.id);
    updateRepeatsBadge();
    if (onlyRepeats) renderSections();
  });

  stepper.appendChild(minusBtn);
  stepper.appendChild(qtyValue);
  stepper.appendChild(plusBtn);
  chip.appendChild(stepper);

  function toggle() {
    const nowOwned = !getEntry(key).owned;
    setOwned(key, nowOwned);
    saveState();
    chip.classList.toggle("owned", nowOwned);
    priceInput.style.display = nowOwned ? "block" : "none";
    stepper.classList.toggle("hidden", !nowOwned);
    const updated = getEntry(key);
    priceInput.value =
      nowOwned && typeof updated.price === "number" ? updated.price : "";
    refreshQtyUI();
    renderScoreboard();
    renderTeamHeaderCounts(section.id);
    updateRepeatsBadge();
    if (onlyMissing || onlyRepeats) renderSections(); // sticker may need to disappear from filtered view
  }

  chip.addEventListener("click", toggle);
  chip.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });

  return chip;
}

function renderTeamHeaderCounts(sectionId) {
  const section = SECTIONS.find((s) => s.id === sectionId);
  if (!section) return;
  const wrap = el.sections.querySelector(`[data-section-id="${sectionId}"]`);
  if (!wrap) return;
  const ownedCount = section.stickers.filter(
    (n) => getEntry(stickerKey(section.id, n)).owned
  ).length;
  const total = section.stickers.length;
  const pct = Math.round((ownedCount / total) * 100);
  const repeatExtra = section.stickers.reduce((sum, n) => {
    const e = getEntry(stickerKey(section.id, n));
    return e.owned && e.qty > 1 ? sum + (e.qty - 1) : sum;
  }, 0);
  wrap.querySelector(".team-count").textContent = `${ownedCount}/${total}`;
  wrap.querySelector(".team-progress-fill").style.width = `${pct}%`;
  const badge = wrap.querySelector(".team-repeat-badge");
  if (badge) {
    badge.textContent = `🔁 ${repeatExtra}`;
    badge.classList.toggle("hidden", repeatExtra === 0);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderAll() {
  renderScoreboard();
  renderSections();
  updateRepeatsBadge();
}

// ----------------------------------------------------------------------------
// Toolbar wiring
// ----------------------------------------------------------------------------
function setupToolbar() {
  el.search.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderSections();
  });

  el.priceCommon.value = getCommonPrice();
  el.pricePremium.value = getPremiumPrice();
  refreshPriceLegend();
  el.priceCommon.addEventListener("change", () => {
    const v = Number(el.priceCommon.value);
    localStorage.setItem(PRICE_COMMON_KEY, Number.isFinite(v) && v >= 0 ? v : 1000);
    refreshPriceLegend();
  });
  el.pricePremium.addEventListener("change", () => {
    const v = Number(el.pricePremium.value);
    localStorage.setItem(PRICE_PREMIUM_KEY, Number.isFinite(v) && v >= 0 ? v : 2000);
    refreshPriceLegend();
  });

  document.getElementById("btn-recalc-prices").addEventListener("click", () => {
    const ok = confirm(
      "Esto va a volver a poner el precio automático (común/premium) en TODAS tus figuritas marcadas, incluso las que ya tenían un precio distinto puesto a mano. ¿Seguir?"
    );
    if (!ok) return;
    const changed = recalcAllPrices(false);
    saveState();
    renderAll();
    showToast(changed > 0 ? `Precios actualizados en ${changed} figuritas` : "No había nada para actualizar");
  });

  el.btnMissing.addEventListener("click", () => {
    onlyMissing = !onlyMissing;
    if (onlyMissing) {
      onlyRepeats = false;
      el.btnOnlyRepeats.dataset.state = "off";
      el.btnOnlyRepeats.textContent = "Solo repetidas";
    }
    el.btnMissing.dataset.state = onlyMissing ? "on" : "off";
    el.btnMissing.textContent = onlyMissing ? "Mostrando faltantes" : "Solo faltantes";
    renderSections();
  });

  el.btnOnlyRepeats.addEventListener("click", () => {
    onlyRepeats = !onlyRepeats;
    if (onlyRepeats) {
      onlyMissing = false;
      el.btnMissing.dataset.state = "off";
      el.btnMissing.textContent = "Solo faltantes";
    }
    el.btnOnlyRepeats.dataset.state = onlyRepeats ? "on" : "off";
    el.btnOnlyRepeats.textContent = onlyRepeats ? "Mostrando repetidas" : "Solo repetidas";
    renderSections();
  });

  el.btnReset.addEventListener("click", () => {
    if (
      confirm(
        "¿Seguro que querés reiniciar el álbum? Se van a borrar todas las figuritas marcadas y los precios."
      )
    ) {
      state = {};
      saveState();
      renderAll();
      showToast("Álbum reiniciado");
    }
  });
}

// ----------------------------------------------------------------------------
// Repetidas para vender
// ----------------------------------------------------------------------------
function computeRepeats() {
  const bySection = [];
  let totalExtra = 0;
  let totalValue = 0;
  let hasAnyPrice = false;

  for (const section of SECTIONS) {
    const rows = [];
    for (const num of section.stickers) {
      const entry = getEntry(stickerKey(section.id, num));
      if (entry.owned && entry.qty > 1) {
        const extra = entry.qty - 1;
        totalExtra += extra;
        if (typeof entry.price === "number") {
          totalValue += extra * entry.price;
          hasAnyPrice = true;
        }
        rows.push({ num, qty: entry.qty, extra, price: entry.price });
      }
    }
    if (rows.length > 0) {
      bySection.push({ section, rows });
    }
  }

  return { bySection, totalExtra, totalValue, hasAnyPrice };
}

/**
 * Given the list of stickers a CLIENT owns (decoded from their QR), returns
 * which of YOUR repeated stickers you could sell/separate for them: things
 * you have more than one of, that they don't have at all yet.
 */
function computeSellToClient(clientOwnedList) {
  const clientSet = new Set(clientOwnedList.map((i) => i.key));
  const bySection = [];
  let totalItems = 0;
  let totalValue = 0;

  for (const section of SECTIONS) {
    const rows = [];
    for (const num of section.stickers) {
      const key = stickerKey(section.id, num);
      const entry = getEntry(key);
      if (entry.owned && entry.qty > 1 && !clientSet.has(key)) {
        const price =
          typeof entry.price === "number" ? entry.price : defaultPriceFor(section, num);
        const kind = stickerKind(section, num);
        rows.push({ key, num, price, kind, availableExtra: entry.qty - 1 });
        totalItems++;
        totalValue += price;
      }
    }
    if (rows.length > 0) bySection.push({ section, rows });
  }

  return { bySection, totalItems, totalValue };
}

function updateRepeatsBadge() {
  const { totalExtra } = computeRepeats();
  el.repeatsBadge.textContent = totalExtra;
  el.repeatsBadge.classList.toggle("hidden", totalExtra === 0);
}

const repeatsModal = document.getElementById("repeats-modal");
const repeatsSummary = document.getElementById("repeats-summary");
const repeatsList = document.getElementById("repeats-list");

function openRepeatsModal() {
  const { bySection, totalExtra, totalValue, hasAnyPrice } = computeRepeats();

  if (bySection.length === 0) {
    repeatsSummary.innerHTML = "";
    repeatsList.innerHTML = `<div class="repeats-empty">Todavía no marcaste ninguna repetida.<br/>Tocá el <b>+</b> debajo del precio de una figurita que ya tenés para indicar que tenés más de una y así aparezca acá lista para vender.</div>`;
  } else {
    repeatsSummary.innerHTML = `
      <div class="result-stat"><b>${totalExtra}</b><span>FIGUS PARA VENDER</span></div>
      <div class="result-stat"><b>${hasAnyPrice ? "$" + totalValue.toLocaleString("es-AR", { maximumFractionDigits: 0 }) : "—"}</b><span>VALOR ESTIMADO</span></div>
    `;
    repeatsList.innerHTML = "";
    for (const { section, rows } of bySection) {
      const teamBlock = document.createElement("div");
      teamBlock.className = "repeats-team";
      const rowsHtml = rows
        .map(
          (r) => `
        <div class="repeats-row">
          <span class="repeats-row-num">#${escapeHtml(r.num)}</span>
          <span class="repeats-row-extra">tenés ${r.qty} · ${r.extra} para vender${
            typeof r.price === "number" ? ` · $${r.price}` : ""
          }</span>
        </div>`
        )
        .join("");
      teamBlock.innerHTML = `<div class="repeats-team-name">${section.emoji} ${escapeHtml(section.label)}</div>${rowsHtml}`;
      repeatsList.appendChild(teamBlock);
    }
  }

  repeatsModal.classList.remove("hidden");
}

function buildRepeatsShareText() {
  const { bySection, totalExtra } = computeRepeats();
  if (bySection.length === 0) return "";

  const lines = [
    "🔁 Tengo estas figuritas repetidas del Álbum Mundial 2026 para vender/cambiar:",
    "",
  ];
  for (const { section, rows } of bySection) {
    lines.push(`${section.emoji} ${section.label}`);
    for (const r of rows) {
      const priceTxt = typeof r.price === "number" ? ` - $${r.price} c/u` : "";
      lines.push(`  #${r.num} x${r.extra} disponibles${priceTxt}`);
    }
    lines.push("");
  }
  lines.push(`Total: ${totalExtra} figuritas repetidas disponibles.`);
  return lines.join("\n");
}

async function copyRepeatsList() {
  const text = buildRepeatsShareText();
  if (!text) {
    showToast("Todavía no tenés repetidas para compartir");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("Lista copiada — pegala en WhatsApp o donde quieras");
  } catch (e) {
    // Fallback for browsers/contexts without Clipboard API permission
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast("Lista copiada — pegala en WhatsApp o donde quieras");
    } catch (e2) {
      showToast("No pude copiar. Mantené presionado el texto para copiarlo a mano.");
    }
    document.body.removeChild(ta);
  }
}

function setupRepeatsModal() {
  document.getElementById("btn-repeats").addEventListener("click", openRepeatsModal);
  document.getElementById("repeats-close").addEventListener("click", () => {
    repeatsModal.classList.add("hidden");
  });
  repeatsModal.addEventListener("click", (e) => {
    if (e.target === repeatsModal) repeatsModal.classList.add("hidden");
  });
  document.getElementById("repeats-copy").addEventListener("click", copyRepeatsList);
}

// ----------------------------------------------------------------------------
// Vender a un cliente (leyendo SU QR)
//
// Al leer el QR de otra persona, comparamos lo que ella tiene contra
// nuestras propias repetidas: cualquier figurita que nosotros tengamos de
// más (qty > 1) y que ella no tenga ninguna, se la podemos separar/vender.
// Esto NUNCA modifica nuestro álbum hasta que se confirma la venta (y ahí
// solo resta 1 a la cantidad de las figuritas tildadas).
// ----------------------------------------------------------------------------
let sellRows = []; // flat list of {key, num, sectionLabel, sectionEmoji, kind, price, checkbox}

function showSellPreview(clientOwnedList) {
  const { bySection } = computeSellToClient(clientOwnedList);
  sellRows = [];
  sellList.innerHTML = "";

  if (bySection.length === 0) {
    sellList.innerHTML = `<div class="repeats-empty">No tenés ninguna repetida que a este cliente le falte. Nada para venderle por ahora — ¡probá con otro código!</div>`;
  } else {
    for (const { section, rows } of bySection) {
      const teamBlock = document.createElement("div");
      teamBlock.className = "repeats-team";
      const nameEl = document.createElement("div");
      nameEl.className = "repeats-team-name";
      nameEl.textContent = `${section.emoji} ${section.label}`;
      teamBlock.appendChild(nameEl);

      for (const r of rows) {
        const row = document.createElement("label");
        row.className = "sell-row";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "sell-row-check";
        checkbox.checked = true;
        checkbox.addEventListener("change", updateSellTotal);
        row.appendChild(checkbox);

        const info = document.createElement("span");
        info.className = "sell-row-info";
        info.innerHTML = `<span class="repeats-row-num">#${escapeHtml(r.num)}</span>${
          r.kind !== "comun" ? ` <span class="chip-kind chip-kind-${r.kind}">${kindLabel(r.kind)}</span>` : ""
        } <span class="repeats-row-extra">te sobran ${r.availableExtra}</span>`;
        row.appendChild(info);

        const priceEl = document.createElement("span");
        priceEl.className = "sell-row-price";
        priceEl.textContent = `$${r.price.toLocaleString("es-AR")}`;
        row.appendChild(priceEl);

        teamBlock.appendChild(row);
        sellRows.push({
          key: r.key,
          num: r.num,
          sectionLabel: section.label,
          sectionEmoji: section.emoji,
          kind: r.kind,
          price: r.price,
          checkbox,
        });
      }
      sellList.appendChild(teamBlock);
    }
  }

  updateSellTotal();
  sellModal.classList.remove("hidden");
}

function updateSellTotal() {
  let count = 0;
  let total = 0;
  for (const r of sellRows) {
    if (r.checkbox.checked) {
      count++;
      total += r.price;
    }
  }
  sellSummary.innerHTML = sellRows.length
    ? `
    <div class="result-stat"><b>${count}</b><span>SELECCIONADAS</span></div>
    <div class="result-stat"><b>$${total.toLocaleString("es-AR")}</b><span>TOTAL A COBRAR</span></div>
  `
    : "";
  if (sellConfirmBtn) sellConfirmBtn.disabled = count === 0;
}

function buildSellShareText() {
  const selected = sellRows.filter((r) => r.checkbox.checked);
  if (selected.length === 0) return "";

  const lines = ["🔁 Te separo estas figuritas del Álbum Mundial 2026:", ""];
  let total = 0;
  let lastTeam = null;
  for (const r of selected) {
    if (r.sectionLabel !== lastTeam) {
      lines.push(`${r.sectionEmoji} ${r.sectionLabel}`);
      lastTeam = r.sectionLabel;
    }
    const kindTxt = r.kind !== "comun" ? ` (${kindLabel(r.kind)})` : "";
    lines.push(`  #${r.num}${kindTxt} - $${r.price.toLocaleString("es-AR")}`);
    total += r.price;
  }
  lines.push("");
  lines.push(`Total: $${total.toLocaleString("es-AR")} (${selected.length} figuritas)`);
  return lines.join("\n");
}

async function copySellList() {
  const text = buildSellShareText();
  if (!text) {
    showToast("Marcá al menos una figurita primero");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("Lista copiada — pegala en WhatsApp o donde quieras");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast("Lista copiada — pegala en WhatsApp o donde quieras");
    } catch (e2) {
      showToast("No pude copiar. Mantené presionado el texto para copiarlo a mano.");
    }
    document.body.removeChild(ta);
  }
}

function confirmSale() {
  const selected = sellRows.filter((r) => r.checkbox.checked);
  if (selected.length === 0) return;
  let total = 0;
  for (const r of selected) {
    const entry = getEntry(r.key);
    setQty(r.key, entry.qty - 1); // resta 1 copia: la que se separó/vendió
    total += r.price;
  }
  saveState();
  renderAll();
  sellModal.classList.add("hidden");
  showToast(`Venta registrada: ${selected.length} figuritas · $${total.toLocaleString("es-AR")}`);
  sellRows = [];
}

function setupSellModal() {
  document.getElementById("btn-scan-client").addEventListener("click", () => openScanner("client"));
  document.getElementById("sell-close").addEventListener("click", () => {
    sellModal.classList.add("hidden");
    sellRows = [];
  });
  sellModal.addEventListener("click", (e) => {
    if (e.target === sellModal) {
      sellModal.classList.add("hidden");
      sellRows = [];
    }
  });
  document.getElementById("sell-copy").addEventListener("click", copySellList);
  document.getElementById("sell-confirm").addEventListener("click", confirmSale);
}

// ----------------------------------------------------------------------------
// Sincronización entre dispositivos (Firebase Firestore, opcional)
// ----------------------------------------------------------------------------
const SYNC_CODE_KEY = "figuritas-sync-code-v1";
const AUTOSYNC_KEY = "figuritas-autosync-v1";
const CLOUD_PUSH_DEBOUNCE_MS = 1200;

const FIREBASE_READY = !!(
  firebaseConfig &&
  firebaseConfig.apiKey &&
  !String(firebaseConfig.apiKey).startsWith("PEGA_ACA")
);

let db = null;
if (FIREBASE_READY) {
  try {
    const fbApp = initializeApp(firebaseConfig);
    db = getFirestore(fbApp);
  } catch (e) {
    console.error("No se pudo inicializar Firebase, la sincronización queda desactivada:", e);
    db = null;
  }
}

let cloudUnsubscribe = null;
let cloudPushTimer = null;
let applyingRemoteChange = false;
let lastPushedAt = 0;

function getSyncCode() {
  return (localStorage.getItem(SYNC_CODE_KEY) || "").trim();
}
function saveSyncCode(code) {
  localStorage.setItem(SYNC_CODE_KEY, code.trim());
}
function isAutoSyncOn() {
  return localStorage.getItem(AUTOSYNC_KEY) === "1";
}
function setAutoSyncFlag(on) {
  localStorage.setItem(AUTOSYNC_KEY, on ? "1" : "0");
}

function albumDocRef(code) {
  return doc(db, "albums", code);
}

// Called from saveState() on every local change. Debounced so rapid taps
// (marking many stickers in a row) become a single write instead of one
// write per tap.
function scheduleCloudPush() {
  if (!db || !isAutoSyncOn() || applyingRemoteChange) return;
  const code = getSyncCode();
  if (!code) return;
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(() => {
    pushToCloud(code).catch((e) => {
      console.error(e);
      updateSyncStatus("No se pudo subir a la nube (revisá tu conexión).");
    });
  }, CLOUD_PUSH_DEBOUNCE_MS);
}

async function pushToCloud(code) {
  if (!db) throw new Error("Firebase no está configurado todavía.");
  const now = Date.now();
  lastPushedAt = now;
  await setDoc(albumDocRef(code), {
    state: JSON.stringify(state),
    priceCommon: getCommonPrice(),
    pricePremium: getPremiumPrice(),
    updatedAt: now,
  });
  updateSyncStatus(`Subido a la nube · ${new Date(now).toLocaleTimeString("es-AR")}`);
}

async function pullFromCloud(code, { confirmFirst = true } = {}) {
  if (!db) throw new Error("Firebase no está configurado todavía.");
  const snap = await getDoc(albumDocRef(code));
  if (!snap.exists()) {
    showToast("Todavía no hay nada guardado en la nube con ese código");
    return;
  }
  if (confirmFirst) {
    const ok = confirm(
      "Esto va a reemplazar el álbum de este dispositivo con lo que está guardado en la nube. ¿Seguir?"
    );
    if (!ok) return;
  }
  applyRemoteData(snap.data());
  updateSyncStatus(`Traído de la nube · ${new Date().toLocaleTimeString("es-AR")}`);
}

function applyRemoteData(data) {
  if (!data) return;
  applyingRemoteChange = true;
  try {
    state = JSON.parse(data.state || "{}");
    if (typeof data.priceCommon === "number") {
      localStorage.setItem(PRICE_COMMON_KEY, data.priceCommon);
      el.priceCommon.value = data.priceCommon;
    }
    if (typeof data.pricePremium === "number") {
      localStorage.setItem(PRICE_PREMIUM_KEY, data.pricePremium);
      el.pricePremium.value = data.pricePremium;
    }
    refreshPriceLegend();
    saveState();
    renderAll();
  } finally {
    applyingRemoteChange = false;
  }
}

function startRealtimeSync(code) {
  stopRealtimeSync();
  if (!db || !code) return;
  cloudUnsubscribe = onSnapshot(
    albumDocRef(code),
    (snap) => {
      if (snap.metadata.hasPendingWrites) return; // this is the echo of our own write
      if (!snap.exists()) return;
      const data = snap.data();
      if (!data.updatedAt || data.updatedAt <= lastPushedAt) return; // stale or our own
      applyRemoteData(data);
      showToast("Álbum actualizado desde otro dispositivo");
      updateSyncStatus(`Recibido de otro dispositivo · ${new Date().toLocaleTimeString("es-AR")}`);
    },
    (err) => {
      console.error(err);
      updateSyncStatus("Se cortó la conexión con la nube. Reintentando…");
    }
  );
}

function stopRealtimeSync() {
  if (cloudUnsubscribe) {
    cloudUnsubscribe();
    cloudUnsubscribe = null;
  }
}

function updateSyncStatus(text) {
  const statusEl = document.getElementById("sync-status");
  if (statusEl) statusEl.textContent = text;
  el.syncBadge.classList.toggle("hidden", !(FIREBASE_READY && isAutoSyncOn() && getSyncCode()));
}

function initSyncOnBoot() {
  if (!FIREBASE_READY) return;
  const code = getSyncCode();
  if (code && isAutoSyncOn()) {
    startRealtimeSync(code);
  }
  updateSyncStatus("");
}

function setupSyncModal() {
  const modal = document.getElementById("sync-modal");
  const notConfigured = document.getElementById("sync-not-configured");
  const controls = document.getElementById("sync-controls");
  const codeInput = document.getElementById("sync-code-input");
  const autoToggle = document.getElementById("sync-auto-toggle");

  document.getElementById("btn-sync").addEventListener("click", () => {
    notConfigured.classList.toggle("hidden", FIREBASE_READY);
    controls.classList.toggle("hidden", !FIREBASE_READY);
    codeInput.value = getSyncCode();
    autoToggle.checked = isAutoSyncOn();
    modal.classList.remove("hidden");
  });
  document.getElementById("sync-close").addEventListener("click", () => {
    modal.classList.add("hidden");
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });

  document.getElementById("sync-save-code").addEventListener("click", () => {
    const code = codeInput.value.trim();
    if (!code) {
      showToast("Escribí un código primero");
      return;
    }
    saveSyncCode(code);
    showToast("Código guardado");
    if (isAutoSyncOn()) startRealtimeSync(code);
  });

  autoToggle.addEventListener("change", () => {
    setAutoSyncFlag(autoToggle.checked);
    const code = getSyncCode();
    if (autoToggle.checked) {
      if (!code) {
        showToast("Guardá un código de álbum primero");
        autoToggle.checked = false;
        setAutoSyncFlag(false);
        return;
      }
      startRealtimeSync(code);
      pushToCloud(code).catch((e) => console.error(e));
    } else {
      stopRealtimeSync();
    }
    updateSyncStatus(autoToggle.checked ? "Sincronización automática activada" : "Sincronización automática desactivada");
  });

  document.getElementById("sync-push").addEventListener("click", () => {
    const code = getSyncCode() || codeInput.value.trim();
    if (!code) {
      showToast("Escribí y guardá un código de álbum primero");
      return;
    }
    saveSyncCode(code);
    pushToCloud(code)
      .then(() => showToast("Datos subidos a la nube"))
      .catch((e) => {
        console.error(e);
        showToast("No se pudo subir. Revisá tu conexión o las reglas de Firestore.");
      });
  });

  document.getElementById("sync-pull").addEventListener("click", () => {
    const code = getSyncCode() || codeInput.value.trim();
    if (!code) {
      showToast("Escribí y guardá un código de álbum primero");
      return;
    }
    saveSyncCode(code);
    pullFromCloud(code).catch((e) => {
      console.error(e);
      showToast("No se pudo traer de la nube. Revisá tu conexión o las reglas de Firestore.");
    });
  });
}

// ----------------------------------------------------------------------------
// Backup (export / import) — protects data since it only lives in this browser
// ----------------------------------------------------------------------------
function exportBackup() {
  const payload = {
    app: "figuritas-album-mundial-2026",
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
    priceCommon: getCommonPrice(),
    pricePremium: getPremiumPrice(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `album-mundial-2026-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Backup descargado");
}

function importBackupFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      showToast("Ese archivo no es un backup válido (JSON inválido)");
      return;
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.state !== "object") {
      showToast("Ese archivo no tiene el formato de backup esperado");
      return;
    }
    const count = Object.keys(parsed.state).length;
    const ok = confirm(
      `Este backup tiene ${count} figuritas cargadas. ¿Reemplazar todo tu álbum actual con este backup? Esta acción no se puede deshacer.`
    );
    if (!ok) return;
    state = parsed.state;
    if (typeof parsed.priceCommon === "number") {
      localStorage.setItem(PRICE_COMMON_KEY, parsed.priceCommon);
      el.priceCommon.value = parsed.priceCommon;
    }
    if (typeof parsed.pricePremium === "number") {
      localStorage.setItem(PRICE_PREMIUM_KEY, parsed.pricePremium);
      el.pricePremium.value = parsed.pricePremium;
    }
    refreshPriceLegend();
    saveState();
    renderAll();
    document.getElementById("backup-modal").classList.add("hidden");
    showToast("Backup restaurado");
  };
  reader.onerror = () => showToast("No pude leer ese archivo");
  reader.readAsText(file);
}

function setupBackupModal() {
  const backupModal = document.getElementById("backup-modal");
  document.getElementById("btn-backup").addEventListener("click", () => {
    backupModal.classList.remove("hidden");
  });
  document.getElementById("backup-close").addEventListener("click", () => {
    backupModal.classList.add("hidden");
  });
  backupModal.addEventListener("click", (e) => {
    if (e.target === backupModal) backupModal.classList.add("hidden");
  });
  document.getElementById("backup-export").addEventListener("click", exportBackup);
  document.getElementById("backup-import").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importBackupFile(file);
    e.target.value = "";
  });
}

// ----------------------------------------------------------------------------
// Toast helper
// ----------------------------------------------------------------------------
let toastTimer = null;
function showToast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

// ============================================================================
// QR decoding — Figuritas app format
//
// Verified format (reverse-engineered from real exports):
//   raw text = [a few opaque header bytes] + one or more ";"-separated
//   segments, each "H4sI...base64gzip...".
//   - The NUMBER of segments varies (2 or 3) — it is NOT fixed at 2. A naive
//     split on the first ";" breaks as soon as a 3rd segment shows up, so we
//     split on every ";" and decode each piece independently.
//   - Segment 0: 123-byte bitmap, unused here (observed all-zero on real exports).
//   - Segment 1: 123-byte (984-bit) bitmap of OWNED stickers.
//     Bit i (0-indexed, LSB-first within each byte) corresponds to the i-th
//     sticker in canonical album order (see sections.json), i.e.
//     bit = (byte[i >> 3] >> (i & 7)) & 1
//   - Segment 2 (OPTIONAL — only present when the account has repeated
//     stickers): one byte per OWNED sticker (in the same bit order as
//     segment 1), giving how many copies of that sticker the account has.
//     This is what powers the "figuritas repetidas" / trade-matching QR.
// ============================================================================

function decodeFiguritasPayload(rawText) {
  const rawParts = rawText.split(";");
  const segments = [];
  for (const raw of rawParts) {
    const h = raw.indexOf("H4sI");
    if (h === -1) continue; // header junk before the first segment, or a stray empty piece
    segments.push(inflateBase64(raw.slice(h).trim()));
  }

  if (segments.length < 2) {
    throw new Error("Este QR no parece ser de la app Figuritas.");
  }

  // Segment 0 is header/unused padding, segment 1 is the owned-stickers
  // bitmap, and an optional segment 2 carries per-sticker repeat counts.
  const ownedBytes = segments[1];
  const repeatBytes = segments.length >= 3 ? segments[2] : null;
  return { ownedBytes, repeatBytes };
}

function inflateBase64(b64) {
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return pako.ungzip(bytes);
}

function bitAt(bytes, index) {
  const byte = bytes[index >> 3];
  if (byte === undefined) return 0;
  return (byte >> (index & 7)) & 1;
}

/**
 * Returns array of {sectionId, num, key, qty} for owned stickers per the
 * scanned bitmap. When repeatBytes is provided, qty is how many copies the
 * scanned account has of that sticker (1 = no repeats); otherwise qty is
 * always 1, since older/simpler QR codes don't carry repeat info.
 */
function ownedListFromBitmap(bytes, repeatBytes) {
  const owned = [];
  let i = 0;
  let ownedIndex = 0; // position among owned stickers only, matches repeatBytes order
  for (const section of SECTIONS) {
    for (const num of section.stickers) {
      if (bitAt(bytes, i) === 1) {
        const qty = repeatBytes && repeatBytes[ownedIndex] ? repeatBytes[ownedIndex] : 1;
        owned.push({ sectionId: section.id, num, key: stickerKey(section.id, num), qty });
        ownedIndex++;
      }
      i++;
    }
  }
  return owned;
}

// ----------------------------------------------------------------------------
// Scanner UI (camera + file fallback)
// ----------------------------------------------------------------------------
let mediaStream = null;
let scanRAF = null;
let scanTimer = null;
let pendingOwnedList = null;
// "own" = leyendo mi propio QR para actualizar mi álbum (comportamiento de
// siempre); "client" = leyendo el QR de OTRA persona para ver qué de mis
// repetidas le puedo vender, sin tocar mi álbum para nada.
let scanMode = "own";
let videoDevices = [];
let currentDeviceIndex = 0;
let torchOn = false;
let scannerOpen = false;
const SCAN_INTERVAL_MS = 180; // throttle: don't decode every animation frame, saves battery/CPU and avoids hangs on low-end phones

const scannerModal = document.getElementById("scanner-modal");
const scannerVideo = document.getElementById("scanner-video");
const scannerStatus = document.getElementById("scanner-status");
const scannerControls = document.getElementById("scanner-controls");
const scannerTorchBtn = document.getElementById("scanner-torch");
const scannerSwitchBtn = document.getElementById("scanner-switch");
const resultModal = document.getElementById("result-modal");
const resultBody = document.getElementById("result-body");
const sellModal = document.getElementById("sell-modal");
const sellSummary = document.getElementById("sell-summary");
const sellList = document.getElementById("sell-list");
const sellConfirmBtn = document.getElementById("sell-confirm");

function openScanner(mode = "own") {
  scanMode = mode;
  const title = document.getElementById("scanner-title");
  if (mode === "client") {
    title.textContent = "Escanear QR de un cliente";
    scannerStatus.textContent =
      "Apuntá la cámara al código QR del cliente para ver qué de tus repetidas le podés vender. Esto NO modifica tu álbum.";
  } else {
    title.textContent = "Actualizar mi álbum";
    scannerStatus.textContent = "Apuntá la cámara a TU PROPIO código QR de la app Figuritas.";
  }
  scannerModal.classList.remove("hidden");
  if (typeof jsQR === "undefined" || typeof pako === "undefined") {
    scannerStatus.textContent =
      "No se pudieron cargar los archivos necesarios para leer QR (jsQR/pako). Recargá la página; si sigue fallando, puede ser un problema de conexión.";
    scannerOpen = true;
    return;
  }
  scannerOpen = true;
  startCamera();
}

function closeScanner() {
  scannerModal.classList.add("hidden");
  scannerOpen = false;
  stopCamera();
}

function cameraErrorMessage(e) {
  switch (e && e.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Le negaste el permiso de cámara a esta página. Habilitalo en los ajustes del navegador o subí una foto del QR más abajo.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No encontré ninguna cámara en este dispositivo. Podés subir una foto del QR más abajo.";
    case "NotReadableError":
    case "TrackStartError":
      return "La cámara está siendo usada por otra app. Cerrala e intentá de nuevo, o subí una foto del QR.";
    case "OverconstrainedError":
      return "No pude configurar la cámara trasera. Probando con la cámara disponible…";
    case "SecurityError":
      return "El navegador bloqueó la cámara en esta conexión (necesita HTTPS). Podés subir una foto del QR más abajo.";
    default: {
      // Surface the real error instead of a dead-end generic message — this
      // is what let a missing jsQR/pako (e.g. blocked CDN) fail silently
      // with no actionable info before.
      const detail = e && (e.message || e.name) ? ` (${e.name || "error"}: ${e.message || "sin detalle"})` : "";
      return `No pude acceder a la cámara${detail}. Podés subir una foto del QR más abajo.`;
    }
  }
}

async function startCamera() {
  // Try the ideal back camera first; fall back progressively so a single
  // constraint mismatch doesn't leave the user stuck without a working scanner.
  const attempts = [
    { video: { facingMode: { ideal: "environment" } }, audio: false },
    { video: true, audio: false },
  ];

  let lastError = null;
  for (const constraints of attempts) {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
    }
  }

  if (!mediaStream) {
    console.error(lastError);
    scannerStatus.textContent = cameraErrorMessage(lastError);
    return;
  }

  try {
    scannerVideo.srcObject = mediaStream;
    await scannerVideo.play();
    scannerStatus.textContent = scanInstructionText();
    await refreshDeviceList();
    setupTrackControls();
    scanLoop();
  } catch (e) {
    console.error(e);
    scannerStatus.textContent = cameraErrorMessage(e);
  }
}

function scanInstructionText() {
  return scanMode === "client"
    ? "Apuntá la cámara al QR del cliente."
    : "Apuntá la cámara a tu propio QR de Figuritas.";
}

async function refreshDeviceList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoDevices = devices.filter((d) => d.kind === "videoinput");
    scannerControls.classList.toggle("hidden", videoDevices.length === 0);
    scannerSwitchBtn.classList.toggle("hidden", videoDevices.length < 2);
  } catch (e) {
    // enumerateDevices can fail silently on some browsers; scanning still works
    videoDevices = [];
  }
}

function setupTrackControls() {
  torchOn = false;
  scannerTorchBtn.textContent = "💡 Linterna";
  scannerTorchBtn.classList.add("hidden");
  const track = mediaStream && mediaStream.getVideoTracks()[0];
  if (!track) return;
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if (caps.torch) {
    scannerTorchBtn.classList.remove("hidden");
  }
  scannerControls.classList.remove("hidden");
}

async function toggleTorch() {
  const track = mediaStream && mediaStream.getVideoTracks()[0];
  if (!track) return;
  try {
    torchOn = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    scannerTorchBtn.textContent = torchOn ? "💡 Apagar linterna" : "💡 Linterna";
  } catch (e) {
    console.error(e);
    torchOn = !torchOn; // revert, this device doesn't support it after all
    showToast("Este celular no permite controlar la linterna desde el navegador");
  }
}

async function switchCamera() {
  if (videoDevices.length < 2) return;
  currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
  const deviceId = videoDevices[currentDeviceIndex].deviceId;
  stopCamera(false);
  scannerStatus.textContent = "Cambiando de cámara…";
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: false,
    });
    scannerVideo.srcObject = mediaStream;
    await scannerVideo.play();
    scannerStatus.textContent = scanInstructionText();
    setupTrackControls();
    scanLoop();
  } catch (e) {
    console.error(e);
    scannerStatus.textContent = cameraErrorMessage(e);
  }
}

function stopCamera(clearOpenFlag = true) {
  if (scanRAF) cancelAnimationFrame(scanRAF);
  scanRAF = null;
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = null;
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (clearOpenFlag) scannerOpen = false;
}

// Stop the camera whenever the tab/app goes to the background, so it doesn't
// stay locked (draining battery, or blocking other apps from using it) if the
// person switches away without explicitly closing the scanner modal.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && mediaStream) stopCamera(false);
  else if (!document.hidden && scannerOpen && !mediaStream) startCamera();
});
window.addEventListener("pagehide", () => stopCamera());

const scanCanvas = document.createElement("canvas");
const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });

function scanLoop() {
  if (!mediaStream) return;
  if (scannerVideo.readyState === scannerVideo.HAVE_ENOUGH_DATA) {
    try {
      scanCanvas.width = scannerVideo.videoWidth;
      scanCanvas.height = scannerVideo.videoHeight;
      scanCtx.drawImage(scannerVideo, 0, 0, scanCanvas.width, scanCanvas.height);
      const imageData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
      // attemptBoth also decodes QR codes with inverted (light-on-dark) contrast,
      // which noticeably improves reliability under glare or on glossy screens.
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });
      if (code && code.data) {
        handleScannedText(code.data);
        return;
      }
    } catch (e) {
      // Never let a bad frame (or a missing jsQR/pako dependency) die
      // silently — surface it so it's actionable instead of the scanner
      // just looking frozen with no explanation.
      console.error(e);
      scannerStatus.textContent = `No pude leer ese frame (${e.name || "error"}: ${e.message || "sin detalle"}). Reintentando…`;
    }
  }
  // Throttled via setTimeout+rAF instead of scanning every single frame:
  // decoding a full-resolution frame is expensive, and doing it 60x/second
  // was needless battery drain and could stutter the whole UI on older phones.
  scanTimer = setTimeout(() => {
    scanRAF = requestAnimationFrame(scanLoop);
  }, SCAN_INTERVAL_MS);
}

function handleScannedFile(file) {
  if (!file.type || !file.type.startsWith("image/")) {
    scannerStatus.textContent = "Ese archivo no es una imagen. Probá con una foto del QR.";
    return;
  }
  const img = new Image();
  const reader = new FileReader();
  reader.onerror = () => {
    scannerStatus.textContent = "No pude leer ese archivo. Probá con otra foto.";
  };
  reader.onload = () => {
    img.onerror = () => {
      scannerStatus.textContent = "No pude abrir esa imagen. Probá con otra foto.";
    };
    img.onload = () => {
      try {
        scanCanvas.width = img.width;
        scanCanvas.height = img.height;
        scanCtx.drawImage(img, 0, 0);
        const imageData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "attemptBoth",
        });
        if (code && code.data) {
          handleScannedText(code.data);
        } else {
          scannerStatus.textContent = "No pude leer un QR en esa imagen. Probá con otra foto, con más luz y sin recortar los bordes del código.";
        }
      } catch (e) {
        // Previously an error here (e.g. jsQR/pako missing) failed
        // completely silently — nothing updated and no message showed.
        console.error(e);
        scannerStatus.textContent = `No pude procesar esa imagen (${e.name || "error"}: ${e.message || "sin detalle"}).`;
      }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function handleScannedText(text) {
  try {
    const { ownedBytes, repeatBytes } = decodeFiguritasPayload(text);
    if (scanMode === "client") {
      // A client's QR only tells us which stickers THEY own — we compare
      // that against OUR repeats. We never touch our own album here.
      const clientOwnedList = ownedListFromBitmap(ownedBytes, null);
      if (navigator.vibrate) navigator.vibrate(60);
      stopCamera();
      scannerModal.classList.add("hidden");
      showSellPreview(clientOwnedList);
    } else {
      pendingOwnedList = ownedListFromBitmap(ownedBytes, repeatBytes);
      showResultPreview(pendingOwnedList); // build & show the preview first
      if (navigator.vibrate) navigator.vibrate(60); // quick haptic confirmation of a successful read
      stopCamera();
      scannerModal.classList.add("hidden");
    }
  } catch (e) {
    console.error(e);
    scannerStatus.textContent = e.message ? `${e.message} (${e.name || "error"})` : "No pude leer ese código.";
    // Keep scanning instead of dying silently — a misread or a QR from another
    // app shouldn't strand the user in a broken state.
    if (mediaStream) {
      scanTimer = setTimeout(() => {
        scanRAF = requestAnimationFrame(scanLoop);
      }, SCAN_INTERVAL_MS);
    }
  }
}

function showResultPreview(ownedList) {
  let newOnes = 0;
  let totalRepeatUnits = 0; // extra copies beyond the 1st, per sticker (from the QR's repeat data, if any)
  for (const item of ownedList) {
    if (!getEntry(item.key).owned) newOnes++;
    if (item.qty > 1) totalRepeatUnits += item.qty - 1;
  }

  resultBody.innerHTML = `
    <p class="import-warn">Vamos a <strong>agregar</strong> las figuritas nuevas de este código a tu álbum. Nada de lo que ya tenías cargado a mano — precios, cantidades ni repetidas — se borra ni se pisa.</p>
    <p class="import-stats-caption">El código trae</p>
    <div class="import-stats-card">
      <div class="import-stat-cell">
        <div class="import-stat-value">${ownedList.length.toLocaleString("es-AR")}</div>
        <div class="import-stat-label">Pegadas</div>
      </div>
      <div class="import-stat-divider" aria-hidden="true"></div>
      <div class="import-stat-cell">
        <div class="import-stat-value">${totalRepeatUnits.toLocaleString("es-AR")}</div>
        <div class="import-stat-label">Repetidas</div>
      </div>
    </div>
    <p class="import-note">${
      newOnes > 0
        ? `<strong>${newOnes}</strong> son nuevas para vos.`
        : "Ya tenías cargadas todas las que trae este código."
    }</p>
  `;
  resultModal.classList.remove("hidden");
}

function applyScannedResult() {
  if (!pendingOwnedList) return;
  for (const item of pendingOwnedList) {
    setOwned(item.key, true);
    if (item.qty > 1) {
      const entry = getEntry(item.key);
      if (item.qty > entry.qty) setQty(item.key, item.qty);
    }
  }
  saveState();
  renderAll();
  resultModal.classList.add("hidden");
  showToast(`Álbum actualizado: ${pendingOwnedList.length} figuritas`);
  pendingOwnedList = null;
}

function setupScanner() {
  document.getElementById("btn-scan").addEventListener("click", () => openScanner("own"));
  document.getElementById("scanner-close").addEventListener("click", closeScanner);
  scannerModal.addEventListener("click", (e) => {
    if (e.target === scannerModal) closeScanner();
  });

  scannerTorchBtn.addEventListener("click", toggleTorch);
  scannerSwitchBtn.addEventListener("click", switchCamera);

  document.getElementById("scanner-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleScannedFile(file);
    e.target.value = "";
  });

  resultModal.addEventListener("click", (e) => {
    if (e.target === resultModal) {
      resultModal.classList.add("hidden");
      pendingOwnedList = null;
    }
  });
  document.getElementById("result-cancel").addEventListener("click", () => {
    resultModal.classList.add("hidden");
    pendingOwnedList = null;
  });
  document.getElementById("result-apply").addEventListener("click", applyScannedResult);
}

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
async function init() {
  loadState();
  await loadSections();
  setupToolbar();
  setupScanner();
  setupSellModal();
  setupRepeatsModal();
  setupBackupModal();
  setupSyncModal();
  initSyncOnBoot();
  renderAll();
}

init();
