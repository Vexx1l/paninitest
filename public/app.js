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
let currentView = "album"; // "album" | "venta" | "stats" | "settings"
let ventaFilterKind = "all"; // "all" | "escudo" | "formacion" | "especial"
const KIND_LABEL = { escudo: "🛡️", formacion: "📋", especial: "⭐", comun: "" };

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
  ventaBadge: document.getElementById("venta-badge"),
  syncBadge: document.getElementById("sync-badge"),
  tabButtons: document.querySelectorAll(".tab-btn"),
  views: {
    album: document.getElementById("view-album"),
    venta: document.getElementById("view-venta"),
    stats: document.getElementById("view-stats"),
    extras: document.getElementById("view-extras"),
    settings: document.getElementById("view-settings"),
  },
  ventaFilters: document.querySelectorAll(".chip-filter"),
  ventaSummary: document.getElementById("venta-summary"),
  ventaList: document.getElementById("venta-list"),
  ventaCopy: document.getElementById("venta-copy"),
  statsCards: document.getElementById("stats-cards"),
  statsTeams: document.getElementById("stats-teams"),
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

function sectionHasMissing(section) {
  return section.stickers.some((n) => !getEntry(stickerKey(section.id, n)).owned);
}

function sectionHasRepeats(section) {
  return section.stickers.some((n) => {
    const e = getEntry(stickerKey(section.id, n));
    return e.owned && e.qty > 1;
  });
}

function renderSections() {
  el.sections.innerHTML = "";

  let visible = SECTIONS.filter(matchesSearch);
  if (onlyMissing) {
    visible = visible.filter(sectionHasMissing);
  } else if (onlyRepeats) {
    visible = visible.filter(sectionHasRepeats);
  }

  if (visible.length === 0) {
    let msg;
    if (searchQuery) {
      msg = `No encontré ningún equipo con “${escapeHtml(searchQuery)}”.`;
    } else if (onlyMissing) {
      msg = "🎉 ¡Completaste todo tu álbum! No te falta ninguna figurita.";
    } else if (onlyRepeats) {
      msg = "No tenés repetidas en ningún equipo por ahora.";
    } else {
      msg = "No hay figuritas para mostrar.";
    }
    el.sections.innerHTML = `<div class="empty-state">${msg}</div>`;
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
    updateVentaBadge();
    if (onlyRepeats) renderSections();
    if (currentView === "venta") renderVenta();
  });
  plusBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const cur = getEntry(key);
    setQty(key, cur.qty + 1);
    saveState();
    refreshQtyUI();
    renderTeamHeaderCounts(section.id);
    updateVentaBadge();
    if (onlyRepeats) renderSections();
    if (currentView === "venta") renderVenta();
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
    updateVentaBadge();
    if (onlyMissing || onlyRepeats) renderSections(); // sticker may need to disappear from filtered view
    if (currentView === "venta") renderVenta();
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
  updateVentaBadge();
  if (currentView === "venta") renderVenta();
  if (currentView === "stats") renderStats();
  if (currentView === "extras") renderExtras();
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
// Repetidas para vender (pestaña "Venta")
// ----------------------------------------------------------------------------
/**
 * `filterKind`: "all" | "escudo" | "formacion" | "especial" — limita el
 * listado a un tipo de figurita en particular (usado por los chips de
 * filtro de la pestaña Venta). El precio usa el que tiene guardada la
 * figurita, o el automático por tipo si por algún motivo no tiene uno.
 */
function computeRepeats(filterKind = "all") {
  const bySection = [];
  let totalExtra = 0;
  let totalValue = 0;
  let hasAnyPrice = false;

  for (const section of SECTIONS) {
    const rows = [];
    for (const num of section.stickers) {
      const kind = stickerKind(section, num);
      if (filterKind !== "all" && kind !== filterKind) continue;
      const entry = getEntry(stickerKey(section.id, num));
      if (entry.owned && entry.qty > 1) {
        const extra = entry.qty - 1;
        const price = typeof entry.price === "number" ? entry.price : defaultPriceFor(section, num);
        totalExtra += extra;
        totalValue += extra * price;
        hasAnyPrice = true;
        rows.push({ num, qty: entry.qty, extra, price, kind });
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

function updateVentaBadge() {
  const { totalExtra } = computeRepeats("all");
  el.ventaBadge.textContent = totalExtra;
  el.ventaBadge.classList.toggle("hidden", totalExtra === 0);
}

function renderVenta() {
  const { bySection, totalExtra, totalValue, hasAnyPrice } = computeRepeats(ventaFilterKind);

  if (bySection.length === 0) {
    el.ventaSummary.innerHTML = "";
    el.ventaList.innerHTML = `<div class="repeats-empty">${
      ventaFilterKind === "all"
        ? "Todavía no marcaste ninguna repetida.<br/>Tocá el <b>+</b> debajo del precio de una figurita que ya tenés (en \u201cMi Álbum\u201d) para indicar que tenés más de una y así aparezca acá lista para vender."
        : "No tenés repetidas de este tipo todavía."
    }</div>`;
    return;
  }

  el.ventaSummary.innerHTML = `
    <div class="result-stat"><b>${totalExtra}</b><span>FIGUS PARA VENDER</span></div>
    <div class="result-stat"><b>${hasAnyPrice ? "$" + totalValue.toLocaleString("es-AR", { maximumFractionDigits: 0 }) : "—"}</b><span>VALOR ESTIMADO</span></div>
  `;
  el.ventaList.innerHTML = "";
  for (const { section, rows } of bySection) {
    const teamBlock = document.createElement("div");
    teamBlock.className = "repeats-team";
    const rowsHtml = rows
      .map(
        (r) => `
      <div class="repeats-row">
        <span class="repeats-row-num">${KIND_LABEL[r.kind] || ""} #${escapeHtml(r.num)}</span>
        <span class="repeats-row-extra">Tenés ${r.extra} para vender${
          typeof r.price === "number" ? ` · $${r.price.toLocaleString("es-AR")}` : ""
        }</span>
      </div>`
      )
      .join("");
    teamBlock.innerHTML = `<div class="repeats-team-name">${section.emoji} ${escapeHtml(section.label)}</div>${rowsHtml}`;
    el.ventaList.appendChild(teamBlock);
  }
}

function buildRepeatsShareText() {
  const { bySection, totalExtra } = computeRepeats(ventaFilterKind);
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

function setupVenta() {
  el.ventaFilters.forEach((btn) => {
    btn.addEventListener("click", () => {
      ventaFilterKind = btn.dataset.kind;
      el.ventaFilters.forEach((b) => (b.dataset.state = b === btn ? "on" : "off"));
      renderVenta();
    });
  });
  el.ventaCopy.addEventListener("click", copyRepeatsList);
}

// ----------------------------------------------------------------------------
// Estadísticas
// ----------------------------------------------------------------------------
function renderStats() {
  let escudosOwned = 0,
    escudosTotal = 0,
    formacionesOwned = 0,
    formacionesTotal = 0,
    especialesOwned = 0,
    especialesTotal = 0;

  const teamRows = [];

  for (const section of SECTIONS) {
    let ownedInSection = 0;
    for (const num of section.stickers) {
      const kind = stickerKind(section, num);
      const owned = getEntry(stickerKey(section.id, num)).owned;
      if (owned) ownedInSection++;
      if (kind === "escudo") {
        escudosTotal++;
        if (owned) escudosOwned++;
      } else if (kind === "formacion") {
        formacionesTotal++;
        if (owned) formacionesOwned++;
      } else if (kind === "especial") {
        especialesTotal++;
        if (owned) especialesOwned++;
      }
    }
    if (!section.id.startsWith("FWC")) {
      teamRows.push({
        section,
        owned: ownedInSection,
        total: section.stickers.length,
        pct: Math.round((ownedInSection / section.stickers.length) * 100),
      });
    }
  }
  teamRows.sort((a, b) => a.pct - b.pct); // los más incompletos primero

  const { totalExtra, totalValue } = computeRepeats("all");

  el.statsCards.innerHTML = `
    <div class="result-stat"><b>${escudosOwned}/${escudosTotal}</b><span>ESCUDOS</span></div>
    <div class="result-stat"><b>${formacionesOwned}/${formacionesTotal}</b><span>FORMACIONES</span></div>
    <div class="result-stat"><b>${especialesOwned}/${especialesTotal}</b><span>ESPECIALES</span></div>
    <div class="result-stat"><b>${totalExtra}</b><span>REPETIDAS ($${totalValue.toLocaleString("es-AR")})</span></div>
  `;

  el.statsTeams.innerHTML = `
    <p class="stats-teams-title">Equipos — de menos a más completo</p>
    ${teamRows
      .map(
        (r) => `
      <div class="stats-team-row">
        <span class="stats-team-name">${r.section.emoji} ${escapeHtml(r.section.label)}</span>
        <span class="stats-team-track"><span class="stats-team-fill" style="width:${r.pct}%"></span></span>
        <span class="stats-team-count">${r.owned}/${r.total}</span>
      </div>`
      )
      .join("")}
  `;
}

// ----------------------------------------------------------------------------
// Extra Stickers — set especial de 20 jugadores x 4 categorías (Base, Bronce,
// Plata, Oro). Los datos base (roster + tus valores originales) vienen de
// extras-data.json, que se generó a partir del Excel que subiste. Una vez
// cargado acá, lo que edites vive en localStorage (y se sincroniza entre
// dispositivos junto con el resto del álbum, si tenés Sincronizar activado).
// ----------------------------------------------------------------------------
const EXTRAS_STORAGE_KEY = "figuritas-extras-v1";
const EXTRAS_CATS = [
  { key: "base", label: "Base", short: "BASE" },
  { key: "bronce", label: "Bronce", short: "BRONCE" },
  { key: "plata", label: "Plata", short: "PLATA" },
  { key: "oro", label: "Oro", short: "ORO" },
];

/** @type {Array<{code:string, country:string, player:string, categories:Object}>} */
let EXTRAS_PLAYERS = [];

/** extrasState[code][catKey] = { qty:number, target:number, note:string } */
let extrasState = {};

async function loadExtrasData() {
  try {
    const res = await fetch("./extras-data.json");
    EXTRAS_PLAYERS = await res.json();
  } catch (e) {
    console.error("No se pudo cargar extras-data.json", e);
    EXTRAS_PLAYERS = [];
  }
}

function loadExtrasState() {
  try {
    const raw = localStorage.getItem(EXTRAS_STORAGE_KEY);
    extrasState = raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("No se pudo leer el set de Extra Stickers guardado", e);
    extrasState = {};
  }
  ensureExtrasSeeded();
}

// La primera vez (o si aparece un jugador/categoría nuevo que todavía no
// está guardado), lo sembramos con los valores originales del Excel que
// subiste — así no perdés lo que ya tenías cargado ahí.
function ensureExtrasSeeded() {
  for (const p of EXTRAS_PLAYERS) {
    if (!extrasState[p.code]) extrasState[p.code] = {};
    for (const cat of EXTRAS_CATS) {
      if (!extrasState[p.code][cat.key]) {
        const src = p.categories?.[cat.key] || {};
        extrasState[p.code][cat.key] = {
          qty: Number.isFinite(src.qty) ? src.qty : 0,
          target: Number.isFinite(src.target) && src.target > 0 ? src.target : 1,
          note: src.note || "",
        };
      }
    }
  }
}

function saveExtrasState() {
  try {
    localStorage.setItem(EXTRAS_STORAGE_KEY, JSON.stringify(extrasState));
  } catch (e) {
    console.error("No se pudo guardar el set de Extra Stickers", e);
    showToast("No se pudo guardar (¿modo privado?)");
  }
  scheduleCloudPush();
}

function getExtrasEntry(code, catKey) {
  if (!extrasState[code]) extrasState[code] = {};
  if (!extrasState[code][catKey]) extrasState[code][catKey] = { qty: 0, target: 1, note: "" };
  return extrasState[code][catKey];
}

function setExtrasQty(code, catKey, qty) {
  const entry = getExtrasEntry(code, catKey);
  entry.qty = Math.max(0, Math.min(999, Math.round(qty) || 0));
}

function setExtrasTarget(code, catKey, target) {
  const entry = getExtrasEntry(code, catKey);
  entry.target = Math.max(1, Math.min(999, Math.round(target) || 1));
}

function setExtrasNote(code, catKey, note) {
  const entry = getExtrasEntry(code, catKey);
  entry.note = note;
}

function computeExtrasSummary() {
  const byCat = {};
  for (const cat of EXTRAS_CATS) byCat[cat.key] = { total: 0, target: 0 };
  let grandTotal = 0,
    grandTarget = 0,
    playersComplete = 0;

  for (const p of EXTRAS_PLAYERS) {
    let complete = true;
    for (const cat of EXTRAS_CATS) {
      const e = getExtrasEntry(p.code, cat.key);
      byCat[cat.key].total += e.qty;
      byCat[cat.key].target += e.target;
      grandTotal += e.qty;
      grandTarget += e.target;
      if (e.qty < e.target) complete = false;
    }
    if (complete) playersComplete++;
  }
  return { byCat, grandTotal, grandTarget, playersComplete, playersTotal: EXTRAS_PLAYERS.length };
}

function renderExtras() {
  const listEl = document.getElementById("extras-list");
  const summaryEl = document.getElementById("extras-summary");
  if (!listEl || !summaryEl) return;

  const { byCat, playersComplete, playersTotal } = computeExtrasSummary();

  summaryEl.innerHTML =
    EXTRAS_CATS.map((cat) => {
      const c = byCat[cat.key];
      const faltan = Math.max(0, c.target - c.total);
      return `<div class="result-stat extras-cat-summary extras-cat-summary-${cat.key}">
        <b>${c.total}/${c.target}</b><span>${cat.short}${faltan ? ` · FALTAN ${faltan}` : " ✓"}</span>
      </div>`;
    }).join("") +
    `<div class="result-stat extras-cat-summary-players"><b>${playersComplete}/${playersTotal}</b><span>JUGADORES COMPLETOS</span></div>`;

  listEl.innerHTML = EXTRAS_PLAYERS.map((p) => {
    const allComplete = EXTRAS_CATS.every((cat) => {
      const e = getExtrasEntry(p.code, cat.key);
      return e.qty >= e.target;
    });
    return `
    <div class="extras-player" data-code="${p.code}">
      <div class="extras-player-head">
        <span class="extras-player-flag">${escapeHtml(p.code)}</span>
        <div class="extras-player-id">
          <div class="extras-player-name">${escapeHtml(p.player)}</div>
          <div class="extras-player-country">${escapeHtml(p.country)}</div>
        </div>
        ${allComplete ? `<span class="extras-player-status">✓ Completo</span>` : ""}
      </div>
      <div class="extras-cats">
        ${EXTRAS_CATS.map((cat) => {
          const e = getExtrasEntry(p.code, cat.key);
          const done = e.qty >= e.target;
          return `
          <div class="extras-cat extras-cat-${cat.key}${done ? " extras-cat-done" : ""}" data-cat="${cat.key}">
            <span class="extras-cat-label">${cat.label}</span>
            <div class="extras-stepper">
              <button type="button" class="extras-qty-btn" data-action="dec" aria-label="Restar ${cat.label}">–</button>
              <span class="extras-qty-value">${e.qty}</span>
              <button type="button" class="extras-qty-btn" data-action="inc" aria-label="Sumar ${cat.label}">+</button>
            </div>
            <span class="extras-target">
              / <input type="number" class="extras-target-input" min="1" max="999" value="${e.target}" aria-label="Objetivo de ${cat.label}" />
            </span>
          </div>`;
        }).join("")}
      </div>
      <input type="text" class="extras-note" placeholder="Nota (opcional)" value="${escapeHtml(
        // una sola nota visible por jugador: guardamos la primera no vacía, o vacío
        Object.values(extrasState[p.code] || {}).find((e) => e.note)?.note || ""
      )}" />
    </div>`;
  }).join("");

  // Delegación de eventos: un solo listener por gesto en vez de 20×(4+extras) listeners.
  listEl.querySelectorAll(".extras-player").forEach((playerEl) => {
    const code = playerEl.dataset.code;

    playerEl.querySelectorAll(".extras-cat").forEach((catEl) => {
      const catKey = catEl.dataset.cat;
      const valueEl = catEl.querySelector(".extras-qty-value");
      const targetInput = catEl.querySelector(".extras-target-input");

      function refreshDoneStyle() {
        const e = getExtrasEntry(code, catKey);
        catEl.classList.toggle("extras-cat-done", e.qty >= e.target);
      }

      catEl.querySelector('[data-action="dec"]').addEventListener("click", () => {
        const e = getExtrasEntry(code, catKey);
        setExtrasQty(code, catKey, e.qty - 1);
        valueEl.textContent = getExtrasEntry(code, catKey).qty;
        refreshDoneStyle();
        saveExtrasState();
        renderExtrasSummaryOnly();
        refreshExtrasPlayerStatus(playerEl, code);
      });
      catEl.querySelector('[data-action="inc"]').addEventListener("click", () => {
        const e = getExtrasEntry(code, catKey);
        setExtrasQty(code, catKey, e.qty + 1);
        valueEl.textContent = getExtrasEntry(code, catKey).qty;
        refreshDoneStyle();
        saveExtrasState();
        renderExtrasSummaryOnly();
        refreshExtrasPlayerStatus(playerEl, code);
      });
      targetInput.addEventListener("change", () => {
        setExtrasTarget(code, catKey, Number(targetInput.value));
        targetInput.value = getExtrasEntry(code, catKey).target;
        refreshDoneStyle();
        saveExtrasState();
        renderExtrasSummaryOnly();
        refreshExtrasPlayerStatus(playerEl, code);
      });
    });

    const noteInput = playerEl.querySelector(".extras-note");
    noteInput.addEventListener("change", () => {
      // Guardamos la misma nota en las 4 categorías del jugador (es una nota
      // por jugador, no por categoría — más simple de usar).
      for (const cat of EXTRAS_CATS) setExtrasNote(code, cat.key, noteInput.value);
      saveExtrasState();
    });
  });
}

// Solo redibuja las tarjetas de resumen de arriba (mucho más liviano que
// renderExtras() completo) — se usa después de cada +/-/objetivo tocado.
function renderExtrasSummaryOnly() {
  const summaryEl = document.getElementById("extras-summary");
  if (!summaryEl) return;
  const { byCat, playersComplete, playersTotal } = computeExtrasSummary();
  summaryEl.innerHTML =
    EXTRAS_CATS.map((cat) => {
      const c = byCat[cat.key];
      const faltan = Math.max(0, c.target - c.total);
      return `<div class="result-stat extras-cat-summary extras-cat-summary-${cat.key}">
        <b>${c.total}/${c.target}</b><span>${cat.short}${faltan ? ` · FALTAN ${faltan}` : " ✓"}</span>
      </div>`;
    }).join("") +
    `<div class="result-stat extras-cat-summary-players"><b>${playersComplete}/${playersTotal}</b><span>JUGADORES COMPLETOS</span></div>`;
}

function refreshExtrasPlayerStatus(playerEl, code) {
  const allComplete = EXTRAS_CATS.every((cat) => {
    const e = getExtrasEntry(code, cat.key);
    return e.qty >= e.target;
  });
  let statusEl = playerEl.querySelector(".extras-player-status");
  if (allComplete && !statusEl) {
    statusEl = document.createElement("span");
    statusEl.className = "extras-player-status";
    statusEl.textContent = "✓ Completo";
    playerEl.querySelector(".extras-player-head").appendChild(statusEl);
  } else if (!allComplete && statusEl) {
    statusEl.remove();
  }
}

function resetExtrasToOriginal() {
  const ok = confirm(
    "Esto va a reemplazar lo que cargaste en Extras por los valores originales del Excel que subiste (Cantidad, Objetivo y Notas). ¿Seguir?"
  );
  if (!ok) return;
  extrasState = {};
  ensureExtrasSeeded();
  saveExtrasState();
  renderExtras();
  showToast("Extras restaurado a los valores del Excel");
}

// Exporta el estado actual a un .xlsx con la misma estructura que el Excel
// original (Conteo / Resumen / Faltantes / Guía), para tener un respaldo o
// compartirlo. Carga SheetJS recién al tocar el botón, para no pesar el
// arranque de la app con una librería de ~440kb que la mayoría de las
// visitas no va a usar.
let xlsxLibPromise = null;
function ensureXlsxLib() {
  if (window.XLSX) return Promise.resolve();
  if (!xlsxLibPromise) {
    xlsxLibPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "./vendor/xlsx.core.min.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("No se pudo cargar la librería de Excel"));
      document.head.appendChild(script);
    });
  }
  return xlsxLibPromise;
}

async function exportExtrasToExcel() {
  try {
    await ensureXlsxLib();
  } catch (e) {
    showToast("No se pudo cargar el exportador de Excel (revisá tu conexión)");
    return;
  }

  const catLabel = { base: "Base (Purple)", bronce: "Bronce", plata: "Plata", oro: "Oro" };

  // Hoja "Conteo"
  const conteoRows = [
    ["EXTRA STICKERS · PANINI MUNDIAL 2026"],
    ["Conteo de figuritas extra por jugador y categoría — edita la columna 'Cantidad'"],
    [],
    ["Sel.", "País", "Jugador", "Categoría", "Cantidad", "Objetivo\n(set completo)", "Faltan", "Notas"],
  ];
  let totalQty = 0,
    totalTarget = 0,
    totalFaltan = 0;
  for (const p of EXTRAS_PLAYERS) {
    for (const cat of EXTRAS_CATS) {
      const e = getExtrasEntry(p.code, cat.key);
      const faltan = Math.max(0, e.target - e.qty);
      totalQty += e.qty;
      totalTarget += e.target;
      totalFaltan += faltan;
      conteoRows.push([p.code, p.country, p.player, catLabel[cat.key], e.qty, e.target, faltan, e.note || ""]);
    }
  }
  conteoRows.push(["TOTAL GENERAL", "", "", "", totalQty, totalTarget, totalFaltan, ""]);

  // Hoja "Resumen"
  const { byCat } = computeExtrasSummary();
  const resumenRows = [
    ["RESUMEN POR CATEGORÍA"],
    [],
    ["Categoría", "Total acumulado", "Objetivo", "Faltan"],
    ...EXTRAS_CATS.map((cat) => [
      catLabel[cat.key],
      byCat[cat.key].total,
      byCat[cat.key].target,
      Math.max(0, byCat[cat.key].target - byCat[cat.key].total),
    ]),
    [],
    ["RESUMEN POR JUGADOR"],
    ["País", "Jugador", "Base", "Bronce", "Plata", "Oro", "Total jugador"],
  ];
  for (const p of EXTRAS_PLAYERS) {
    const qtys = EXTRAS_CATS.map((cat) => getExtrasEntry(p.code, cat.key).qty);
    resumenRows.push([p.country, p.player, ...qtys, qtys.reduce((a, b) => a + b, 0)]);
  }
  resumenRows.push([
    "TOTAL GENERAL",
    "",
    ...EXTRAS_CATS.map((cat) => byCat[cat.key].total),
    EXTRAS_CATS.reduce((sum, cat) => sum + byCat[cat.key].total, 0),
  ]);

  // Hoja "Faltantes"
  const faltantesRows = [
    ["FALTANTES POR JUGADOR"],
    ["Categorías que le faltan a cada jugador para completar el set (según lo cargado en la app)"],
    ["País", "Jugador", "Faltan (categorías)"],
  ];
  for (const p of EXTRAS_PLAYERS) {
    const missing = EXTRAS_CATS.filter((cat) => {
      const e = getExtrasEntry(p.code, cat.key);
      return e.qty < e.target;
    }).map((cat) => cat.label);
    faltantesRows.push([p.country, p.player, missing.length ? missing.join(", ") : "Completo ✓"]);
  }

  // Hoja "Guía" (igual a la del Excel original)
  const guiaRows = [
    ["GUÍA RÁPIDA"],
    [],
    ["Hoja 'Conteo'", "Registrás cuántas figuritas tenés de cada jugador y categoría desde la app, pestaña Extras."],
    ["Columna 'Objetivo'", "Por defecto está en 1 (una de cada). Se puede cambiar para acumular más de una por categoría/jugador."],
    ["Columna 'Faltan'", "Se calcula sola."],
    ["Hoja 'Resumen'", "Totales automáticos por categoría (Base/Bronce/Plata/Oro) y por jugador."],
    ["4 categorías", "Base (Purple) = la menos rara · Bronce · Plata · Oro = la más rara."],
    ["20 jugadores", "Uno por selección, según el listado oficial de Extra Stickers del Mundial 2026."],
    [],
    ["Exportado desde", "Álbum Mundial 2026 (app), " + new Date().toLocaleString("es-AR")],
  ];

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(conteoRows), "Conteo");
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(resumenRows), "Resumen");
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(faltantesRows), "Faltantes");
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(guiaRows), "Guía");

  const stamp = new Date().toISOString().slice(0, 10);
  window.XLSX.writeFile(wb, `extra-stickers-mundial-2026-${stamp}.xlsx`);
  showToast("Excel descargado");
}

function setupExtrasTab() {
  document.getElementById("btn-extras-export").addEventListener("click", exportExtrasToExcel);
  document.getElementById("btn-extras-reset").addEventListener("click", resetExtrasToOriginal);
}

// ----------------------------------------------------------------------------
// Navegación por pestañas
// ----------------------------------------------------------------------------
function switchView(name) {
  currentView = name;
  for (const [key, section] of Object.entries(el.views)) {
    section.classList.toggle("hidden", key !== name);
  }
  el.tabButtons.forEach((btn) => {
    const active = btn.dataset.view === name;
    btn.classList.toggle("active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  if (name === "venta") renderVenta();
  if (name === "stats") renderStats();
  if (name === "extras") renderExtras();
}

function setupTabs() {
  el.tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
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
    extrasState: JSON.stringify(extrasState),
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
    if (typeof data.extrasState === "string") {
      try {
        extrasState = JSON.parse(data.extrasState);
        ensureExtrasSeeded();
      } catch (e) {
        console.error("No se pudo aplicar el Extras recibido de la nube", e);
      }
    }
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
    saveExtrasState();
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
    extrasState,
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
    if (parsed.extrasState && typeof parsed.extrasState === "object") {
      extrasState = parsed.extrasState;
      ensureExtrasSeeded();
      saveExtrasState();
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
// Export QR — build a Figuritas-compatible QR from this app's own state
// ----------------------------------------------------------------------------

/**
 * Mirrors decodeFiguritasPayload()/ownedListFromBitmap() in reverse: walks
 * SECTIONS in the same fixed order used everywhere else, builds the missing
 * bitmap, the repeated bitmap, and the repeatCounts byte array (TOTAL qty
 * per repeated sticker, matching the corrected decode logic above), then
 * gzips + base64s each one and joins them with ";" — the same shape read by
 * decodeFiguritasPayload (and, as best as this format could be reverse
 * engineered, by the Figuritas app itself).
 */
// Builds the missing/repeated bitmaps + repeat-count segments shared by both
// QR flavors this app can generate (the Figuritas-compatible export and the
// lighter "trade" QR aimed at other collectors using this same app).
function buildOwnedBitmapSegments() {
  const totalStickers = SECTIONS.reduce((sum, s) => sum + s.stickers.length, 0);
  const byteLen = Math.ceil(totalStickers / 8);
  const missingBytes = new Uint8Array(byteLen);
  const repeatedBytes = new Uint8Array(byteLen);
  const repeatCounts = [];

  let i = 0;
  let pegadas = 0;
  let repetidas = 0;
  for (const section of SECTIONS) {
    for (const num of section.stickers) {
      const entry = getEntry(stickerKey(section.id, num));
      if (!entry.owned) {
        setBitAt(missingBytes, i);
      } else {
        pegadas++;
        if (entry.qty > 1) {
          setBitAt(repeatedBytes, i);
          repeatCounts.push(Math.max(2, Math.min(255, entry.qty)));
          repetidas += entry.qty - 1;
        }
      }
      i++;
    }
  }

  const segments = [
    deflateToBase64(missingBytes),
    deflateToBase64(repeatedBytes),
  ];
  if (repeatCounts.length > 0) {
    segments.push(deflateToBase64(new Uint8Array(repeatCounts)));
  }

  return { segments, pegadas, repetidas };
}

function buildFiguritasExportPayload() {
  const { segments, pegadas, repetidas } = buildOwnedBitmapSegments();

  // The album header bytes go raw, directly in front of the first segment's
  // base64 text (no ";" between them) — matching exactly how they appear in
  // a real Figuritas QR. qrcode.js's default byte encoder does a plain
  // charCode&0xff per character, so String.fromCharCode(byte) round-trips
  // these exact byte values into the QR untouched.
  const headerStr = FIGURITAS_ALBUM_HEADER.map((b) => String.fromCharCode(b)).join("");
  const text = headerStr + segments.join(";");

  return { text, pegadas, repetidas };
}

// "Mi QR para intercambiar" — a QR that is NOT meant for the official
// Figuritas app. It reuses the same bitmap/segment encoding (so we can reuse
// the same gzip+base64 helpers and the same decoder), but swaps the official
// album header for our own short marker, so this app can tell the two
// formats apart if it ever needs to (e.g. to show a clearer error message).
const TRADE_QR_MARKER = "PANINITRADE1";
function buildTradeQrPayload() {
  const { segments, pegadas, repetidas } = buildOwnedBitmapSegments();
  const text = TRADE_QR_MARKER + ";" + segments.join(";");
  return { text, pegadas, repetidas };
}

function setupExportQrModal() {
  const modal = document.getElementById("export-qr-modal");
  const codeBox = document.getElementById("export-qr-code");
  const summary = document.getElementById("export-qr-summary");
  let lastSvgDataUrl = null;

  function openExportQr() {
    codeBox.innerHTML = "";
    summary.textContent = "";
    if (typeof qrcode === "undefined" || typeof pako === "undefined") {
      showToast("No se pudo generar el QR (falta un archivo necesario). Recargá la página e intentá de nuevo.");
      return;
    }
    try {
      const { text, pegadas, repetidas } = buildFiguritasExportPayload();
      const qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      const svg = qr.createSvgTag({ cellSize: 4, margin: 4 });
      codeBox.innerHTML = svg;
      lastSvgDataUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
      summary.textContent = `Este QR contiene: ${pegadas} pegadas, ${repetidas} repetidas.`;
      modal.classList.remove("hidden");
    } catch (e) {
      console.error(e);
      showToast("No se pudo generar el QR de exportación.");
    }
  }

  document.getElementById("btn-export-qr").addEventListener("click", openExportQr);
  document.getElementById("export-qr-close").addEventListener("click", () => {
    modal.classList.add("hidden");
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
  document.getElementById("export-qr-download").addEventListener("click", () => {
    if (!lastSvgDataUrl) return;
    const a = document.createElement("a");
    a.href = lastSvgDataUrl;
    a.download = "album-mundial-2026-qr.svg";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

function setupTradeQrModal() {
  const modal = document.getElementById("trade-qr-modal");
  const codeBox = document.getElementById("trade-qr-code");
  const summary = document.getElementById("trade-qr-summary");
  let lastSvgDataUrl = null;

  function openTradeQr() {
    codeBox.innerHTML = "";
    summary.textContent = "";
    if (typeof qrcode === "undefined" || typeof pako === "undefined") {
      showToast("No se pudo generar el QR (falta un archivo necesario). Recargá la página e intentá de nuevo.");
      return;
    }
    try {
      const { text, pegadas, repetidas } = buildTradeQrPayload();
      const faltantes = totalStickerCount() - pegadas;
      const qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      const svg = qr.createSvgTag({ cellSize: 4, margin: 4 });
      codeBox.innerHTML = svg;
      lastSvgDataUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
      summary.textContent = `Este código incluye tus ${repetidas} repetidas para ofrecer y tus ${faltantes} figuritas que te faltan.`;
      modal.classList.remove("hidden");
    } catch (e) {
      console.error(e);
      showToast("No se pudo generar el QR de intercambio.");
    }
  }

  document.getElementById("btn-share-trade-qr").addEventListener("click", openTradeQr);
  document.getElementById("trade-qr-close").addEventListener("click", () => {
    modal.classList.add("hidden");
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
  document.getElementById("trade-qr-download").addEventListener("click", () => {
    if (!lastSvgDataUrl) return;
    const a = document.createElement("a");
    a.href = lastSvgDataUrl;
    a.download = "mi-qr-intercambio-mundial-2026.svg";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

// ----------------------------------------------------------------------------
// Resultado de intercambio (dos direcciones) — al leer el QR de otro
// coleccionista con "Leer QR de otro coleccionista".
// ----------------------------------------------------------------------------
let lastTradeMatch = null;

function computeTradeMatch(otherOwnedList) {
  // Lo que YO le puedo dar a él/ella: mis repetidas que no tiene (reusa la
  // misma lógica que "Vender a un cliente").
  const sell = computeSellToClient(otherOwnedList);

  // Lo que ÉL/ELLA me puede dar a MÍ: sus repetidas (qty > 1 en su propio
  // álbum) que a mí me faltan.
  const otherRepeatsByKey = new Map();
  for (const item of otherOwnedList) {
    if (item.qty > 1) otherRepeatsByKey.set(item.key, item.qty);
  }

  const theyCanGive = [];
  let theyCanGiveCount = 0;
  for (const section of SECTIONS) {
    const rows = [];
    for (const num of section.stickers) {
      const key = stickerKey(section.id, num);
      if (!otherRepeatsByKey.has(key)) continue;
      if (getEntry(key).owned) continue; // ya la tengo, no me sirve
      rows.push({
        key,
        num,
        kind: stickerKind(section, num),
        availableExtra: otherRepeatsByKey.get(key) - 1,
      });
      theyCanGiveCount++;
    }
    if (rows.length > 0) theyCanGive.push({ section, rows });
  }

  return {
    iCanGive: sell.bySection,
    iCanGiveCount: sell.totalItems,
    iCanGiveValue: sell.totalValue,
    theyCanGive,
    theyCanGiveCount,
  };
}

function renderTradeSide(title, bySection, emptyMsg, showPrice) {
  let html = `<h3 class="trade-result-heading">${title}</h3>`;
  if (bySection.length === 0) {
    html += `<div class="repeats-empty">${emptyMsg}</div>`;
    return html;
  }
  for (const { section, rows } of bySection) {
    html += `<div class="repeats-team"><div class="repeats-team-name">${section.emoji} ${escapeHtml(section.label)}</div>`;
    for (const r of rows) {
      const kindTag = r.kind !== "comun" ? `<span class="chip-kind chip-kind-${r.kind}">${kindLabel(r.kind)}</span> ` : "";
      const rightTxt = showPrice
        ? `te sobran ${r.availableExtra} · $${r.price.toLocaleString("es-AR")}`
        : `tiene ${r.availableExtra} de sobra para vos`;
      html += `<div class="repeats-row">
        <span class="repeats-row-num">${kindTag}#${escapeHtml(r.num)}</span>
        <span class="repeats-row-extra">${rightTxt}</span>
      </div>`;
    }
    html += `</div>`;
  }
  return html;
}

function showTradeResult(otherOwnedList) {
  const m = computeTradeMatch(otherOwnedList);
  lastTradeMatch = m;

  const body = document.getElementById("trade-result-body");
  body.innerHTML = `
    <div class="result-stat-grid">
      <div class="result-stat"><b>${m.iCanGiveCount}</b><span>VOS LE PODÉS DAR</span></div>
      <div class="result-stat"><b>${m.theyCanGiveCount}</b><span>TE PUEDE DAR A VOS</span></div>
    </div>
    ${renderTradeSide(
      "🎁 Tus repetidas que a él/ella le faltan",
      m.iCanGive,
      "No tenés ninguna repetida que a esta persona le falte.",
      true
    )}
    ${renderTradeSide(
      "🙌 Sus repetidas que a vos te faltan",
      m.theyCanGive,
      "Esta persona no tiene ninguna repetida de lo que a vos te falta.",
      false
    )}
  `;
  document.getElementById("trade-result-modal").classList.remove("hidden");
}

function buildTradeShareText() {
  if (!lastTradeMatch || (lastTradeMatch.iCanGiveCount === 0 && lastTradeMatch.theyCanGiveCount === 0)) {
    return "";
  }
  const lines = ["🔄 Posible intercambio de figuritas — Álbum Mundial 2026", ""];
  if (lastTradeMatch.iCanGiveCount > 0) {
    lines.push("Yo te puedo dar (mis repetidas que a vos te faltan):");
    for (const { section, rows } of lastTradeMatch.iCanGive) {
      for (const r of rows) {
        lines.push(`  ${section.emoji} #${r.num} - $${r.price.toLocaleString("es-AR")}`);
      }
    }
    lines.push("");
  }
  if (lastTradeMatch.theyCanGiveCount > 0) {
    lines.push("Vos me podés dar (tus repetidas que a mí me faltan):");
    for (const { section, rows } of lastTradeMatch.theyCanGive) {
      for (const r of rows) {
        lines.push(`  ${section.emoji} #${r.num}`);
      }
    }
  }
  return lines.join("\n");
}

async function copyTradeResult() {
  const text = buildTradeShareText();
  if (!text) {
    showToast("No hay ningún intercambio posible para copiar");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("Resumen copiado — pegalo en WhatsApp o donde quieras");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast("Resumen copiado — pegalo en WhatsApp o donde quieras");
    } catch (e2) {
      showToast("No pude copiar. Mantené presionado el texto para copiarlo a mano.");
    }
    document.body.removeChild(ta);
  }
}

function setupTradeResultModal() {
  document.getElementById("btn-scan-trade").addEventListener("click", () => openScanner("trade"));
  const modal = document.getElementById("trade-result-modal");
  document.getElementById("trade-result-close").addEventListener("click", () => {
    modal.classList.add("hidden");
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
  document.getElementById("trade-result-copy").addEventListener("click", copyTradeResult);
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
// Verified format (reverse-engineered from a real export, decoded byte-for-
// byte with this app's own jsQR/pako to confirm against the official app's
// numbers):
//   raw text = [a few opaque header bytes] + one or more ";"-separated
//   segments, each "H4sI...base64gzip...".
//   - The NUMBER of segments varies (2 or 3) — it is NOT fixed at 2. A naive
//     split on the first ";" breaks as soon as a 3rd segment shows up, so we
//     split on every ";" and decode each piece independently.
//   - Segment 0: 123-byte (984-bit) bitmap of MISSING stickers — bit=1 means
//     you DON'T have it. "Pegadas" = total stickers in the album minus the
//     number of 1-bits here. (On a real export: 3 missing bits → 980-3=977
//     pegadas, exactly matching the official app.)
//   - Segment 1: 123-byte (984-bit) bitmap of REPEATED stickers — bit=1 means
//     you own MORE THAN ONE of it. Same bit order as segment 0:
//     bit = (byte[i >> 3] >> (i & 7)) & 1, i-th sticker in canonical album
//     order (see sections.json).
//   - Segment 2 (OPTIONAL — only present when segment 1 has at least one bit
//     set): one byte per REPEATED sticker (in the same bit order as
//     segment 1, i.e. indexed by position among the 1-bits of segment 1, NOT
//     by overall sticker index), giving the TOTAL number of copies (not
//     "extra beyond the first") you have of that sticker. Verified against a
//     real export: these bytes are always >= 2 and never 0 or 1, and using
//     them directly as the total (instead of adding 1) is what reproduces
//     the official app's own "Repetidas" count exactly.
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

  const missingBytes = segments[0];
  const repeatedBytes = segments[1];
  const repeatCounts = segments.length >= 3 ? segments[2] : null;
  return { missingBytes, repeatedBytes, repeatCounts };
}

function inflateBase64(b64) {
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return pako.ungzip(bytes);
}

// Inverse of inflateBase64: gzip a byte array and base64-encode it, producing
// one "H4sI..." segment in the same shape the Figuritas app itself emits
// (pako.gzip with default settings reproduces the same "H4sIAAAAAAAAA" gzip
// header seen in real exports, since that header just encodes "no filename,
// no mtime" — standard defaults, not a proprietary marker).
function deflateToBase64(bytes) {
  const gzipped = pako.gzip(bytes);
  let binary = "";
  for (let i = 0; i < gzipped.length; i++) binary += String.fromCharCode(gzipped[i]);
  return btoa(binary);
}

function setBitAt(bytes, index) {
  const byteIndex = index >> 3;
  if (byteIndex >= bytes.length) return;
  bytes[byteIndex] |= 1 << (index & 7);
}

// Raw (non-base64, non-gzipped) bytes that appear BEFORE the first "H4sI"
// segment in every real Figuritas QR for this album ("Usa Méx Can 26" /
// Álbum Mundial 2026). Confirmed byte-for-byte from a real export (read with
// a raw-byte-accurate QR decoder, not a text-mode one — text-mode decoders
// mangle these bytes because they don't form valid UTF-8 on their own).
// Figuritas apparently uses this to identify which album the QR belongs to:
// omitting it produced the "este código pertenece a un álbum diferente"
// error when importing an app.js-generated QR back into Figuritas. It's
// treated here as a fixed per-album constant, not something derived from
// the user's collected stickers.
const FIGURITAS_ALBUM_HEADER = [0xe2, 0x8b, 0x8b, 0x5e];

function bitAt(bytes, index) {
  const byte = bytes[index >> 3];
  if (byte === undefined) return 0;
  return (byte >> (index & 7)) & 1;
}

/**
 * Returns array of {sectionId, num, key, qty} for every sticker the scanned
 * account OWNS — i.e. every sticker NOT flagged in the missing bitmap. qty
 * is the TOTAL copies (1 = no repeats); for stickers flagged in the repeated
 * bitmap, qty = the matching byte from repeatCounts AS-IS (that byte is
 * already the total copy count, not "extra copies beyond the first" — see
 * note below), or 2 as a conservative fallback if that segment is absent.
 *
 * Verified against a real export: repeatCounts bytes for actually-repeated
 * stickers range from 2 upward and never contain 0 or 1 — the minimum
 * possible value for a TOTAL count of a "repeated" sticker is 2, which is
 * exactly what's observed. Treating the byte as "extra beyond first" (i.e.
 * qty = byte + 1) inflates every repeated sticker's count by one extra unit,
 * which on a real album (85 repeated stickers) summed to 653 total surplus
 * units instead of the official app's 568 — an inflation of exactly 85 (one
 * per repeated sticker), confirming the byte already includes the first
 * copy and should be used directly.
 */
function ownedListFromBitmap(missingBytes, repeatedBytes, repeatCounts) {
  const owned = [];
  let i = 0;
  let repeatedIndex = 0; // position among repeated stickers only, matches repeatCounts order
  for (const section of SECTIONS) {
    for (const num of section.stickers) {
      const isMissing = bitAt(missingBytes, i) === 1;
      const isRepeated = repeatedBytes ? bitAt(repeatedBytes, i) === 1 : false;
      if (!isMissing) {
        let qty = 1;
        if (isRepeated) {
          qty = repeatCounts && repeatCounts[repeatedIndex] != null ? repeatCounts[repeatedIndex] : 2;
        }
        owned.push({ sectionId: section.id, num, key: stickerKey(section.id, num), qty });
      }
      if (isRepeated) repeatedIndex++;
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
  } else if (mode === "trade") {
    title.textContent = "Leer QR de otro coleccionista";
    scannerStatus.textContent =
      "Apuntá la cámara al \"QR para intercambiar\" de la otra persona. Esto NO modifica tu álbum.";
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
  if (scanMode === "client") return "Apuntá la cámara al QR del cliente.";
  if (scanMode === "trade") return "Apuntá la cámara al QR de intercambio de la otra persona.";
  return "Apuntá la cámara a tu propio QR de Figuritas.";
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
    const { missingBytes, repeatedBytes, repeatCounts } = decodeFiguritasPayload(text);
    if (scanMode === "client") {
      // A client's QR only tells us which stickers THEY own — we compare
      // that against OUR repeats. We never touch our own album here.
      const clientOwnedList = ownedListFromBitmap(missingBytes, repeatedBytes, repeatCounts);
      if (navigator.vibrate) navigator.vibrate(60);
      stopCamera();
      scannerModal.classList.add("hidden");
      showSellPreview(clientOwnedList);
    } else if (scanMode === "trade") {
      // Same underlying decode as above, but shows a two-way comparison
      // (what I can give them + what they can give me) instead of a one-way
      // sale, and never touches our own album either.
      const otherOwnedList = ownedListFromBitmap(missingBytes, repeatedBytes, repeatCounts);
      if (navigator.vibrate) navigator.vibrate(60);
      stopCamera();
      scannerModal.classList.add("hidden");
      showTradeResult(otherOwnedList);
    } else {
      pendingOwnedList = ownedListFromBitmap(missingBytes, repeatedBytes, repeatCounts);
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
  let totalRepeatUnits = 0; // extra copies beyond the 1st, per sticker (from the QR's repeat data, if any)
  for (const item of ownedList) {
    if (item.qty > 1) totalRepeatUnits += item.qty - 1;
  }

  resultBody.innerHTML = `
    <p class="import-warn">Importar este álbum <strong>reemplazará el actual</strong>. Ten cuidado.</p>
    <p class="import-stats-caption">El álbum importado contiene</p>
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
  `;
  resultModal.classList.remove("hidden");
}

function applyScannedResult() {
  if (!pendingOwnedList) return;

  // Full replace: the imported album takes over completely, so we start
  // from a clean slate instead of merging with whatever was there before.
  state = {};
  let totalRepeatUnits = 0;
  for (const item of pendingOwnedList) {
    setOwned(item.key, true);
    if (item.qty > 1) {
      setQty(item.key, item.qty);
      totalRepeatUnits += item.qty - 1;
    }
  }

  // Auto-price every owned sticker (including the freshly-marked repeats) so
  // the estimated value is driven by the repetidas we just marked, right away
  // — not left blank until the user prices each one by hand.
  recalcAllPrices(true);

  saveState();
  renderAll();
  resultModal.classList.add("hidden");
  showToast(`Álbum importado: ${pendingOwnedList.length} pegadas, ${totalRepeatUnits} repetidas`);
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
// PWA install support
// ----------------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((e) => {
      // Non-fatal: the app still works as a normal page, just without the
      // "add to home screen" install prompt / offline shell.
      console.warn("No se pudo registrar el service worker:", e);
    });
  });
}

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
async function init() {
  loadState();
  await loadSections();
  await loadExtrasData();
  loadExtrasState();
  setupToolbar();
  setupTabs();
  setupVenta();
  setupScanner();
  setupSellModal();
  setupBackupModal();
  setupExportQrModal();
  setupTradeQrModal();
  setupTradeResultModal();
  setupExtrasTab();
  setupSyncModal();
  initSyncOnBoot();
  renderAll();
}

init();
