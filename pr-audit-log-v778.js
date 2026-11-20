(function initPrAuditLogV778() {
  "use strict";

  const MODULE_VERSION = "v778";
  const DAILY_REPORT_HOUR = 18;
  const DAILY_REPORT_MINUTE = 30;
  let activeOrderId = "";
  let activeFilter = "all";
  let autoReportInProgress = false;

  const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const rounded = (value, places = 3) => Number(numeric(value).toFixed(places));
  const grams = (value) => `${rounded(value).toFixed(3)} g`;
  const safeText = (value, fallback = "-") => String(value ?? "").replace(/\s+/g, " ").trim() || fallback;
  const html = (value) => typeof escapeHtml === "function" ? escapeHtml(String(value ?? "")) : String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  function dateValue(value, fallback = "") {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    const raw = String(value || fallback || "").trim();
    if (!raw) return null;
    const direct = new Date(raw);
    if (Number.isFinite(direct.getTime())) return direct;
    const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (!match) return null;
    const parsed = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12, 0, 0);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  function eventIso(value, fallback = "") {
    return dateValue(value, fallback)?.toISOString() || "";
  }

  function eventTime(value) {
    const date = dateValue(value);
    if (!date) return "Date not recorded";
    return date.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }

  function localDateKey(value = new Date()) {
    const date = value instanceof Date ? value : dateValue(value);
    if (!date) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function reportDateLabel(key) {
    const date = dateValue(`${key}T12:00:00`);
    return date ? date.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : key;
  }

  function roleForLogin(loginId = "", fallback = "ERP User") {
    try {
      const user = typeof allUsers === "function" ? allUsers()[loginId] : null;
      return safeText(user?.role || fallback).replace(/-/g, " ").toUpperCase();
    } catch (error) {
      return safeText(fallback).replace(/-/g, " ").toUpperCase();
    }
  }

  function normalizeStoneRows(rows = []) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      itemKey: safeText(row.itemKey || row.subItem || row.item || "GENERAL", "GENERAL"),
      stoneType: safeText(row.stoneType || row.type || row.stoneGroup || "STONE", "STONE"),
      shape: safeText(row.shape),
      size: safeText(row.size),
      pcs: Math.max(numeric(row.pcs ?? row.noOfPcs), 0),
      settingType: safeText(row.settingType || row.setting || row.manufacturingStage),
      totalWeight: Math.max(numeric(row.totalWeight ?? row.weight), 0),
      isAdditionalStone: Boolean(row.isAdditionalStone),
    }));
  }

  function stoneTotals(rows = []) {
    return rows.reduce((total, row) => {
      const setting = String(row.settingType || "").toLowerCase();
      total.pcs += numeric(row.pcs);
      total.weight += numeric(row.totalWeight);
      if (setting.includes("hand") || row.isAdditionalStone) total.hand += numeric(row.totalWeight);
      else if (setting.includes("wax")) total.wax += numeric(row.totalWeight);
      return total;
    }, { pcs: 0, weight: 0, wax: 0, hand: 0 });
  }

  function totals(value = {}) {
    return {
      pcs: numeric(value.pcs ?? value.totalPcs),
      weight: numeric(value.weight ?? value.totalWeight),
      wax: numeric(value.wax ?? value.waxWeight),
      hand: numeric(value.hand ?? value.handWeight),
      issueGw: numeric(value.issueGw),
      receiveGw: numeric(value.receiveGw),
      receiveNet: numeric(value.receiveNet ?? value.receiveNetWeight),
      setterBalance: numeric(value.setterBalance ?? value.balanceWeight),
      finalGw: numeric(value.finalGw ?? value.grossWeight),
      netWeight: numeric(value.netWeight),
      nonGold: numeric(value.nonGold ?? value.reducedWeight),
    };
  }

  function categoryForStoneSource(source = "") {
    const text = String(source).toLowerCase();
    if (text.includes("bill")) return "bill";
    if (text.includes("fitting")) return "accessory";
    if (text.includes("setting") || text.includes("hand stone verification")) return "setting";
    return "stone";
  }

  function titleForStoneSource(source = "") {
    const category = categoryForStoneSource(source);
    if (category === "bill") return "Bill Stage Stone Change";
    if (category === "accessory") return "Fitting Accessory / Stone Change";
    if (category === "setting") return "Hand Stone / Setting Change";
    if (/wax to hand/i.test(source)) return "Wax Stone Changed To Hand Stone";
    if (/removed/i.test(source)) return "Stone Row Removed";
    if (/master data loaded/i.test(source)) return "Stone Data Loaded";
    return "Production Stone Entry Updated";
  }

  function designText(order = {}) {
    try {
      const design = typeof findById === "function" ? findById("designs", order.designId) : null;
      return typeof jobItemDisplayName === "function" ? jobItemDisplayName(order, design) : safeText(order.designNumber || order.itemName || design?.number);
    } catch (error) {
      return safeText(order.designNumber || order.itemName || order.category);
    }
  }

  function lotsForPr(order = {}) {
    try {
      return typeof lotsForOrder === "function" ? lotsForOrder(order) : (state.lots || []).filter((lot) => (lot.orderIds || []).includes(order.id));
    } catch (error) {
      return [];
    }
  }

  function productionRows(order = {}) {
    try {
      return normalizeStoneRows(typeof productionStoneItemsForOrder === "function" ? productionStoneItemsForOrder(order) : order.productionStoneItems || []);
    } catch (error) {
      return normalizeStoneRows(order.productionStoneItems || []);
    }
  }

  function jobCreatedEvent(order = {}) {
    return {
      id: `job-${order.id}`, category: "job", time: eventIso(order.createdAt, order.orderDate),
      title: "Job Card Item Created", source: safeText(order.jobNumber || order.number, "Job Card"),
      actor: safeText(order.createdBy || order.operatorName, "Order Department"),
      account: safeText(order.createdByAccount, "ERP Login"), role: safeText(order.createdByRole, "ORDER").toUpperCase(),
      reference: safeText(order.productionNo || order.number), remarks: safeText(order.remarks || order.remark, ""),
      before: totals(), after: totals(), rows: [],
    };
  }

  function stoneHistoryEvents(order = {}) {
    let history = [];
    try {
      history = typeof normalizedProductionStoneEditHistory === "function" ? normalizedProductionStoneEditHistory(order) : (order.productionStoneEditHistory || []);
    } catch (error) {
      history = order.productionStoneEditHistory || [];
    }
    let previous = totals();
    return [...history].sort((a, b) => String(a.editedAt || "").localeCompare(String(b.editedAt || ""))).map((entry, index) => {
      const rows = normalizeStoneRows(entry.rows || []);
      const calculated = stoneTotals(rows);
      const after = totals({
        pcs: entry.totalPcs ?? calculated.pcs, weight: entry.totalWeight ?? calculated.weight,
        wax: entry.waxWeight ?? calculated.wax, hand: entry.handWeight ?? calculated.hand,
      });
      const before = totals(previous);
      previous = after;
      const source = safeText(entry.source, "Manual Stone Entry");
      return {
        id: `stone-${entry.id || index}`, category: categoryForStoneSource(source), time: eventIso(entry.editedAt, order.orderDate),
        title: titleForStoneSource(source), source, actor: safeText(entry.editorName || entry.accountName, "ERP User"),
        account: safeText(entry.accountName || entry.loginId, "ERP Login"), role: roleForLogin(entry.loginId),
        reference: safeText(order.productionNo || order.number), remarks: "", before, after, rows,
      };
    });
  }

  function settingEvents(order = {}) {
    return (state.settingManagerEntries || []).flatMap((rawEntry) => {
      let entry = rawEntry;
      try { entry = typeof normalizeSettingManagerEntry === "function" ? normalizeSettingManagerEntry(rawEntry) : rawEntry; } catch (error) { entry = rawEntry; }
      if (!(entry.selectedOrderIds || []).includes(order.id)) return [];
      const rows = productionRows(order).filter((row) => String(row.settingType).toLowerCase().includes("hand") || row.isAdditionalStone);
      const after = totals({
        pcs: rows.reduce((sum, row) => sum + numeric(row.pcs), 0), weight: entry.handStoneWeight,
        hand: entry.handStoneWeight, issueGw: entry.issueGw, receiveGw: entry.receiveGw,
        receiveNet: entry.receiveNetWeight, setterBalance: entry.balanceWeight,
      });
      const received = entry.status === "Received" || entry.receiveGw !== "";
      return [{
        id: `setting-${entry.id}`, category: "setting", time: eventIso(entry.updatedAt || entry.createdAt, entry.receiveDate || entry.issueDate),
        title: received ? "Setting Return / Hand Stone Recorded" : "Issued To Setter", source: safeText(entry.workType, "Stone Setting"),
        actor: safeText(entry.updatedBy || entry.createdBy, "Setting Manager / Legacy Record"),
        account: safeText(entry.updatedByAccount || entry.createdByAccount, "Setting Manager"),
        role: safeText(entry.updatedByRole || entry.createdByRole, "SETTING MANAGER").toUpperCase(),
        reference: [entry.lotNumber, entry.setterName].filter(Boolean).join(" / ") || "Setting",
        remarks: safeText(entry.receiveRemarks || entry.remarks, ""), before: totals({ issueGw: entry.issueGw }), after, rows,
      }];
    });
  }

  function transferEvents(order = {}) {
    return lotsForPr(order).flatMap((lot) => (lot.transfers || []).map((transfer, index) => ({
      id: `transfer-${lot.id}-${transfer.id || index}`, category: "transfer", time: eventIso(transfer.editedAt || transfer.createdAt, transfer.date),
      title: "Department Transfer", source: `${safeText(transfer.fromDepartment || transfer.fromKarigarName, "SOURCE")} TO ${safeText(transfer.toDepartment || transfer.toKarigarName, "DESTINATION")}`,
      actor: safeText(transfer.editedBy || transfer.createdBy || transfer.operatorName, "ERP Transfer"),
      account: safeText(transfer.editedByAccount || transfer.createdByAccount, "ERP Login"),
      role: safeText(transfer.editedByRole || transfer.createdByRole, "PRODUCTION").toUpperCase(),
      reference: `${safeText(lot.number)} / ${safeText(order.productionNo || order.number)}`, remarks: safeText(transfer.remarks, ""),
      before: totals({ issueGw: transfer.issuedWeight ?? transfer.issueWeight }),
      after: totals({ receiveGw: transfer.grossReceivedWeight ?? transfer.receiveGw ?? transfer.receivedWeight, receiveNet: transfer.receivedWeight, hand: transfer.handStoneWeight, wax: transfer.waxStoneWeight }),
      rows: [],
    })));
  }

  function billEvents(order = {}) {
    let entry = null;
    try { entry = typeof findBillItemForOrder === "function" ? findBillItemForOrder(order) : null; } catch (error) { entry = null; }
    if (!entry?.bill || !entry?.item) return [];
    const { bill, item } = entry;
    let breakdown = {};
    try { breakdown = typeof billItemStoneWeightBreakdown === "function" ? billItemStoneWeightBreakdown(item) : {}; } catch (error) { breakdown = {}; }
    let rows = [];
    try {
      rows = normalizeStoneRows(typeof billStoneDetailRowsForPackingList === "function" ? billStoneDetailRowsForPackingList(item, breakdown, order) : item.billStoneDetailRows || []);
    } catch (error) { rows = normalizeStoneRows(item.billStoneDetailRows || []); }
    const after = totals({
      pcs: item.billStonePieceCount ?? rows.reduce((sum, row) => sum + numeric(row.pcs), 0), weight: item.stoneWeight ?? item.stWeight,
      finalGw: item.grossWeight ?? item.finalGw ?? item.gw, netWeight: item.netWeight, nonGold: item.reducedWeight,
    });
    const common = {
      category: "bill", source: safeText(bill.billNo, "Final Bill"), actor: safeText(bill.updatedBy || bill.createdBy, "Bill User"),
      account: safeText(bill.updatedByAccount || bill.createdByAccount, "ERP Login"), role: safeText(bill.updatedByRole || bill.createdByRole, "BILL").toUpperCase(),
      reference: `${safeText(bill.billNo, "BILL")} / ${safeText(order.productionNo || order.number)}`, remarks: safeText(bill.remarks, ""), rows, after,
    };
    const events = [{
      ...common,
      id: `bill-created-${bill.id}-${order.id}`,
      time: eventIso(bill.createdAt, bill.billDate),
      title: "Bill Created",
      actor: safeText(bill.createdBy, "Bill User / Legacy Record"),
      account: safeText(bill.createdByAccount || bill.createdByLoginId, "ERP Login"),
      role: safeText(bill.createdByRole, "BILL").toUpperCase(),
      before: totals(),
    }];
    const created = dateValue(bill.createdAt)?.getTime() || 0;
    const updated = dateValue(bill.updatedAt)?.getTime() || 0;
    if (updated && Math.abs(updated - created) > 1000) events.push({ ...common, id: `bill-final-${bill.id}-${order.id}`, time: eventIso(bill.updatedAt, bill.billDate), title: "Final Bill Snapshot", before: totals() });
    return events;
  }

  function prAuditEvents(order = {}) {
    return [jobCreatedEvent(order), ...stoneHistoryEvents(order), ...settingEvents(order), ...transferEvents(order), ...billEvents(order)]
      .filter((event) => event?.time).sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }

  function metricRows(event = {}) {
    const before = event.before || {};
    const after = event.after || {};
    const rows = [];
    const add = (label, key, formatter = grams) => {
      const beforeValue = numeric(before[key]);
      const afterValue = numeric(after[key]);
      if (!beforeValue && !afterValue) return;
      rows.push({ label, before: formatter(beforeValue), after: formatter(afterValue), delta: formatter(afterValue - beforeValue) });
    };
    add("Stone Pcs", "pcs", (value) => String(Math.round(value)));
    add("Total Stone", "weight"); add("Wax Stone", "wax"); add("Hand Stone", "hand");
    add("Issue GW", "issueGw"); add("Receive GW", "receiveGw"); add("Receive Net", "receiveNet");
    add("Setter Balance", "setterBalance"); add("Final GW", "finalGw"); add("Net Weight", "netWeight"); add("Non-Gold", "nonGold");
    return rows;
  }

  function metricsHtml(event) {
    const rows = metricRows(event);
    if (!rows.length) return "";
    return `<div class="pr-audit-metric-grid">${rows.map((row) => `<div><span>${html(row.label)}</span><b>${html(row.after)}</b><small>Before ${html(row.before)} / Change ${html(row.delta)}</small></div>`).join("")}</div>`;
  }

  function stoneTableHtml(rows = []) {
    if (!rows.length) return "";
    return `<div class="pr-audit-table-wrap"><table class="pr-audit-stone-table"><thead><tr><th>Item</th><th>Type</th><th>Shape</th><th>Size</th><th>Pcs</th><th>Setting</th><th>Total Wt</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${html(row.itemKey)}</td><td>${html(row.stoneType)}</td><td>${html(row.shape)}</td><td>${html(row.size)}</td><td>${Math.round(numeric(row.pcs))}</td><td>${html(safeText(row.settingType).toUpperCase())}</td><td>${html(grams(row.totalWeight))}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function eventHtml(event, index) {
    return `<article class="pr-audit-event"><div class="pr-audit-rail"><span>${index + 1}</span></div><div class="pr-audit-event-body">
      <header><div><span class="pr-audit-category ${html(event.category)}">${html(event.category)}</span><h3>${html(event.title)}</h3></div><time>${html(eventTime(event.time))}</time></header>
      <div class="pr-audit-byline"><b>${html(event.actor)}</b><span>${html(event.account)}</span><span>${html(event.role)}</span><span>${html(event.reference)}</span></div>
      <p class="pr-audit-source">${html(event.source)}</p>${event.remarks ? `<p class="pr-audit-remarks"><b>Remarks:</b> ${html(event.remarks)}</p>` : ""}
      ${metricsHtml(event)}${event.rows?.length ? `<details><summary>View ${event.rows.length} stone row${event.rows.length === 1 ? "" : "s"}</summary>${stoneTableHtml(event.rows)}</details>` : ""}
    </div></article>`;
  }

  function ensureDialog() {
    if (document.getElementById("pr-audit-log-dialog")) return;
    const dialog = document.createElement("dialog");
    dialog.id = "pr-audit-log-dialog";
    dialog.innerHTML = `<div class="pr-audit-shell">
      <header class="pr-audit-header"><div><span>PR ITEM AUDIT</span><h2 id="pr-audit-title">PR Log</h2><p id="pr-audit-subtitle"></p></div>
        <div class="pr-audit-header-actions"><button type="button" class="ghost-button" id="pr-audit-daily-pdf">Daily Hand Stone PDF</button><button type="button" id="pr-audit-pdf">Print / Download PR Log</button><button type="button" class="ghost-button" id="pr-audit-close">Close</button></div></header>
      <section id="pr-audit-summary" class="pr-audit-summary"></section>
      <nav id="pr-audit-filters" class="pr-audit-filters"><button data-audit-filter="all" class="active">All</button><button data-audit-filter="stone">Stone</button><button data-audit-filter="setting">Setting</button><button data-audit-filter="accessory">Fitting</button><button data-audit-filter="transfer">Transfers</button><button data-audit-filter="bill">Bill</button></nav>
      <main id="pr-audit-timeline" class="pr-audit-timeline"></main></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector("#pr-audit-close").addEventListener("click", () => dialog.close());
    dialog.querySelector("#pr-audit-pdf").addEventListener("click", () => downloadPrAuditPdf(activeOrderId));
    dialog.querySelector("#pr-audit-daily-pdf").addEventListener("click", () => downloadDailyHandStoneLogPdf(localDateKey(), { markClosed: false }));
    dialog.querySelector("#pr-audit-filters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-audit-filter]");
      if (!button) return;
      activeFilter = button.dataset.auditFilter || "all";
      renderPrAudit(activeOrderId);
    });
  }

  function renderPrAudit(orderId = "") {
    const order = typeof findById === "function" ? findById("orders", orderId) : (state.orders || []).find((item) => item.id === orderId);
    if (!order) return false;
    ensureDialog();
    const events = prAuditEvents(order);
    const visible = activeFilter === "all" ? events : events.filter((event) => event.category === activeFilter);
    const rows = productionRows(order);
    const current = stoneTotals(rows);
    const lot = lotsForPr(order)[0] || {};
    document.getElementById("pr-audit-title").textContent = `${order.productionNo || order.number || "PR"} / ${designText(order)}`;
    document.getElementById("pr-audit-subtitle").textContent = `${order.jobNumber || order.number || "Job Card"} / ${order.customer || "-"} / ${safeText(lot.number, "No Lot")}`;
    document.getElementById("pr-audit-summary").innerHTML = `<article><span>Current Stage</span><b>${html(typeof orderCurrentStage === "function" ? orderCurrentStage(order) : order.status || "-")}</b></article><article><span>Total Events</span><b>${events.length}</b></article><article><span>Stone Rows</span><b>${rows.length}</b></article><article><span>Total Stone</span><b>${Math.round(current.pcs)} pcs / ${html(grams(current.weight))}</b></article><article><span>Wax / Hand</span><b>${html(grams(current.wax))} / ${html(grams(current.hand))}</b></article>`;
    document.querySelectorAll("#pr-audit-filters [data-audit-filter]").forEach((button) => button.classList.toggle("active", button.dataset.auditFilter === activeFilter));
    document.getElementById("pr-audit-timeline").innerHTML = visible.length ? visible.map(eventHtml).join("") : `<div class="pr-audit-empty">No ${html(activeFilter)} activity is recorded for this PR item.</div>`;
    return true;
  }

  function openPrAuditLog(orderId = "") {
    activeOrderId = orderId;
    activeFilter = "all";
    if (!renderPrAudit(orderId)) { alert("This PR item could not be found."); return false; }
    const dialog = document.getElementById("pr-audit-log-dialog");
    if (!dialog.open) dialog.showModal();
    dialog.querySelector(".pr-audit-shell")?.scrollTo({ top: 0 });
    return true;
  }

  function dailyEvents(key = localDateKey()) {
    const events = [];
    (state.orders || []).forEach((order) => {
      stoneHistoryEvents(order).forEach((event) => {
        if (localDateKey(event.time) !== key) return;
        const handChanged = Math.abs(numeric(event.after?.hand) - numeric(event.before?.hand)) > 0.0000001;
        if (!handChanged && !["setting", "bill", "accessory"].includes(event.category)) return;
        events.push({ ...event, order });
      });
      settingEvents(order).forEach((event) => { if (localDateKey(event.time) === key) events.push({ ...event, order }); });
      billEvents(order).forEach((event) => { if (localDateKey(event.time) === key && event.title === "Final Bill Snapshot") events.push({ ...event, order }); });
    });
    const unique = new Map();
    events.forEach((event) => unique.set(`${event.id}|${event.order?.id || ""}`, event));
    return [...unique.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }

  async function ensurePdfLib() {
    if (globalThis.PDFLib?.PDFDocument) return globalThis.PDFLib;
    if (globalThis.KJM_COMBINED_PACKING_PDF_V777?.ensurePdfLib) return globalThis.KJM_COMBINED_PACKING_PDF_V777.ensurePdfLib();
    throw new Error("PDF component is not loaded.");
  }

  function splitLines(value, font, size, width) {
    const words = safeText(value, "").split(" ").filter(Boolean);
    if (!words.length) return [""];
    const lines = [];
    let current = words.shift();
    words.forEach((word) => {
      const candidate = `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= width) current = candidate;
      else { lines.push(current); current = word; }
    });
    lines.push(current);
    return lines;
  }

  function downloadBytes(bytes, fileName) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function createPdf(title, subtitle, events) {
    const { PDFDocument, StandardFonts, rgb } = await ensurePdfLib();
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const size = [595.28, 841.89];
    const margin = 36;
    const blue = rgb(0.02, 0.28, 0.52);
    const pale = rgb(0.9, 0.96, 1);
    const ink = rgb(0.08, 0.14, 0.2);
    const muted = rgb(0.35, 0.42, 0.48);
    let page;
    let y;
    let pageNo = 0;
    const addPage = () => {
      page = pdf.addPage(size); pageNo += 1;
      page.drawRectangle({ x: 0, y: size[1] - 78, width: size[0], height: 78, color: blue });
      page.drawText("KHUSHALI JEWELLS MANUFACTURING", { x: margin, y: size[1] - 28, size: 14, font: bold, color: rgb(1, 1, 1) });
      page.drawText(title, { x: margin, y: size[1] - 49, size: 11, font: bold, color: rgb(1, 0.9, 0.25) });
      splitLines(subtitle, regular, 8, size[0] - margin * 2).slice(0, 2).forEach((line, index) => page.drawText(line, { x: margin, y: size[1] - 64 - index * 9, size: 8, font: regular, color: rgb(0.92, 0.96, 1) }));
      page.drawText(`Page ${pageNo}`, { x: size[0] - margin - 38, y: 18, size: 7, font: regular, color: muted });
      page.drawText(`${MODULE_VERSION} / Generated ${eventTime(new Date())}`, { x: margin, y: 18, size: 7, font: regular, color: muted });
      y = size[1] - 96;
    };
    const need = (height) => { if (!page || y - height < 34) addPage(); };
    addPage();
    if (!events.length) {
      page.drawRectangle({ x: margin, y: y - 42, width: size[0] - margin * 2, height: 42, color: pale });
      page.drawText("No matching hand-stone or PR audit activity was recorded.", { x: margin + 12, y: y - 25, size: 9, font: bold, color: ink });
    }
    events.forEach((event, index) => {
      const rows = event.rows || [];
      const metrics = metricRows(event);
      need(82 + rows.length * 13 + metrics.length * 9);
      page.drawRectangle({ x: margin, y: y - 20, width: size[0] - margin * 2, height: 20, color: pale });
      page.drawText(`${index + 1}. ${event.title}`, { x: margin + 8, y: y - 14, size: 9, font: bold, color: blue });
      const time = eventTime(event.time);
      page.drawText(time, { x: size[0] - margin - bold.widthOfTextAtSize(time, 7) - 8, y: y - 13, size: 7, font: bold, color: blue });
      y -= 31;
      const order = event.order || {};
      const identity = [order.productionNo || order.number, order.jobNumber, designText(order)].filter(Boolean).join(" / ") || event.reference;
      splitLines(identity, bold, 8, size[0] - margin * 2 - 16).forEach((line) => { need(10); page.drawText(line, { x: margin + 8, y, size: 8, font: bold, color: ink }); y -= 10; });
      const byline = `Source: ${event.source} | Staff: ${event.actor} | Login: ${event.account} | Role: ${event.role}`;
      splitLines(byline, regular, 6.7, size[0] - margin * 2 - 16).forEach((line) => { need(9); page.drawText(line, { x: margin + 8, y, size: 6.7, font: regular, color: muted }); y -= 9; });
      metrics.forEach((metric) => { need(10); page.drawText(`${metric.label}: Before ${metric.before} | After ${metric.after} | Change ${metric.delta}`, { x: margin + 8, y, size: 7, font: regular, color: ink }); y -= 9; });
      if (rows.length) {
        need(30); y -= 2;
        page.drawRectangle({ x: margin + 8, y: y - 13, width: size[0] - margin * 2 - 16, height: 13, color: blue });
        const xs = [margin + 12, margin + 83, margin + 166, margin + 236, margin + 296, margin + 338, margin + 425];
        ["ITEM", "TYPE", "SHAPE", "SIZE", "PCS", "SETTING", "TOTAL WT"].forEach((label, i) => page.drawText(label, { x: xs[i], y: y - 9, size: 6, font: bold, color: rgb(1, 1, 1) }));
        y -= 15;
        rows.forEach((row) => {
          need(14);
          const values = [row.itemKey, row.stoneType, row.shape, row.size, String(Math.round(numeric(row.pcs))), safeText(row.settingType).toUpperCase(), grams(row.totalWeight)];
          const widths = [65, 76, 62, 54, 36, 80, 58];
          values.forEach((value, i) => page.drawText(splitLines(value, regular, 6.2, widths[i])[0] || "-", { x: xs[i], y: y - 8, size: 6.2, font: regular, color: ink }));
          page.drawLine({ start: { x: margin + 8, y: y - 11 }, end: { x: size[0] - margin - 8, y: y - 11 }, thickness: 0.35, color: rgb(0.75, 0.82, 0.88) });
          y -= 13;
        });
      }
      y -= 13;
    });
    pdf.setTitle(title); pdf.setAuthor("Khushali Jewells Manufacturing ERP"); pdf.setCreator(`KJM ERP ${MODULE_VERSION}`);
    return pdf.save();
  }

  async function downloadPrAuditPdf(orderId = "") {
    const order = typeof findById === "function" ? findById("orders", orderId) : (state.orders || []).find((item) => item.id === orderId);
    if (!order) return false;
    try {
      const events = prAuditEvents(order).map((event) => ({ ...event, order }));
      const bytes = await createPdf(`PR ITEM AUDIT LOG - ${order.productionNo || order.number || "PR"}`, `${order.jobNumber || order.number || "Job Card"} / ${order.customer || "-"} / ${designText(order)}`, events);
      downloadBytes(bytes, `PR-AUDIT-${safeText(order.productionNo || order.number, "PR").replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`);
      return true;
    } catch (error) {
      console.error("PR audit PDF failed", error); alert(`PR Log PDF could not be created. ${error.message || "PDF component is unavailable."}`); return false;
    }
  }

  async function downloadDailyHandStoneLogPdf(key = localDateKey(), options = {}) {
    try {
      const events = dailyEvents(key);
      const bytes = await createPdf(`DAILY HAND STONE ENTRY LOG - ${reportDateLabel(key).toUpperCase()}`, `${events.length} recorded event${events.length === 1 ? "" : "s"} / Setting returns, production edits and Bill-stage snapshots are identified by source.`, events);
      const fileName = `KJM-HAND-STONE-DAILY-LOG-${key}.pdf`;
      downloadBytes(bytes, fileName);
      if (options.markClosed) {
        state.handStoneDailyReports = Array.isArray(state.handStoneDailyReports) ? state.handStoneDailyReports : [];
        const record = {
          id: `hand-stone-daily-${key}`, dateKey: key, generatedAt: new Date().toISOString(),
          generatedBy: typeof currentOperatorName === "function" ? currentOperatorName() : safeText(currentUser?.name, "ERP User"),
          loginAccount: typeof currentLoginAccountName === "function" ? currentLoginAccountName() : safeText(currentUser?.accountName, "ERP Login"),
          role: roleForLogin(currentUser?.id, currentUser?.role || "ERP User"), trigger: options.triggeredBy || "Scheduled 6:30 PM",
          eventCount: events.length, fileName, appVersion: MODULE_VERSION,
        };
        state.handStoneDailyReports = [record, ...state.handStoneDailyReports.filter((item) => item.dateKey !== key)].slice(0, 120);
        if (typeof saveState === "function") saveState({ alertOnFailure: false, context: `${key} Hand Stone Daily Log` });
      }
      return true;
    } catch (error) {
      console.error("Daily hand stone PDF failed", error);
      if (!options.silent) alert(`Daily Hand Stone PDF could not be created. ${error.message || "PDF component is unavailable."}`);
      return false;
    }
  }

  function canRunAutomaticReport() {
    try { return Boolean(currentUserConfig?.()) && (isOwner?.() || isManagerUser?.()); } catch (error) { return false; }
  }

  async function maybeRunScheduledReport() {
    if (autoReportInProgress || !canRunAutomaticReport()) return;
    const now = new Date();
    if (now.getHours() < DAILY_REPORT_HOUR || (now.getHours() === DAILY_REPORT_HOUR && now.getMinutes() < DAILY_REPORT_MINUTE)) return;
    const key = localDateKey(now);
    if ((state.handStoneDailyReports || []).some((entry) => entry.dateKey === key)) return;
    autoReportInProgress = true;
    try { await downloadDailyHandStoneLogPdf(key, { markClosed: true, triggeredBy: "Scheduled 6:30 PM", silent: true }); }
    finally { autoReportInProgress = false; }
  }

  ensureDialog();
  document.getElementById("download-hand-stone-log")?.addEventListener("click", () => downloadDailyHandStoneLogPdf(localDateKey(), { markClosed: false }));
  setTimeout(maybeRunScheduledReport, 5000);
  setInterval(maybeRunScheduledReport, 60000);

  window.openPrAuditLog = openPrAuditLog;
  window.downloadPrAuditPdf = downloadPrAuditPdf;
  window.downloadDailyHandStoneLogPdf = downloadDailyHandStoneLogPdf;
  window.KJM_PR_AUDIT_V778 = { openPrAuditLog, prAuditEvents, dailyEvents, downloadPrAuditPdf, downloadDailyHandStoneLogPdf, maybeRunScheduledReport };
})();
