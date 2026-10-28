(() => {
  "use strict";

  const AMERICAN_DIAMOND = "american";
  const REAL_DIAMOND = "real";
  const AMERICAN_FACTOR = 0.96;
  const REAL_FACTOR = 1;
  let billRefreshOrder = null;

  const normalizeDiamondType = (value = "") => {
    const text = String(value || "").trim().toLowerCase();
    return text === "real" || text === "rd" || text.includes("real diamond") ? REAL_DIAMOND : AMERICAN_DIAMOND;
  };

  const orderDiamondType = (order = {}) => normalizeDiamondType(order.diamondType || order.productionDiamondType);
  const diamondLabel = (value = "") => normalizeDiamondType(value) === REAL_DIAMOND ? "Real Diamond" : "American Diamond";
  const diamondFactor = (orderOrType = {}) => {
    const type = typeof orderOrType === "string" ? normalizeDiamondType(orderOrType) : orderDiamondType(orderOrType);
    return type === REAL_DIAMOND ? REAL_FACTOR : AMERICAN_FACTOR;
  };

  const markStoneItem = (item = {}, type = AMERICAN_DIAMOND) => {
    const diamondType = normalizeDiamondType(type);
    const real = diamondType === REAL_DIAMOND;
    return {
      ...item,
      diamondType,
      realDiamondCountOnly: Boolean(real && !item.isAdditionalStone),
      realDiamondManualWeight: Boolean(real && item.isAdditionalStone),
    };
  };

  const effectiveStoneWeight = (item = {}, order = null) => {
    const countOnly = item.realDiamondCountOnly === true
      || (order?.id && orderDiamondType(order) === REAL_DIAMOND && !item.isAdditionalStone);
    return countOnly ? 0 : Number(item.totalWeight || 0);
  };

  const pieceBreakdown = (items = []) => {
    const groups = new Map();
    (items || []).filter((item) => !item.isAdditionalStone && Number(item.pcs || 0) > 0).forEach((item) => {
      const identity = [item.stoneType, normalizeOcrShape(item.shape || ""), item.size]
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join(" ") || "Stone";
      groups.set(identity, Number(groups.get(identity) || 0) + Number(item.pcs || 0));
    });
    return [...groups.entries()].map(([identity, pcs]) => `${identity}: ${pcs} pcs`);
  };

  const pieceBreakdownText = (items = []) => pieceBreakdown(items).join(" | ") || "No diamond pieces recorded";
  const activeDiamondType = (order = {}) => {
    const form = document.getElementById("production-stone-form");
    if (form?.diamondType && !productionStoneFittingEditorContext() && (!order.id || form.orderId?.value === order.id)) {
      return normalizeDiamondType(form.diamondType.value || orderDiamondType(order));
    }
    return orderDiamondType(order);
  };

  const updateDiamondUi = (order = {}) => {
    const form = document.getElementById("production-stone-form");
    if (!form) return;
    const fittingMode = Boolean(productionStoneFittingEditorContext());
    const control = form.querySelector(".production-diamond-type-control");
    control?.classList.toggle("hidden", fittingMode);
    if (fittingMode) return;
    const type = activeDiamondType(order);
    const real = type === REAL_DIAMOND;
    form.classList.toggle("real-diamond-mode", real);
    form.classList.toggle("american-diamond-mode", !real);
    const title = document.getElementById("production-diamond-mode-title");
    const note = document.getElementById("production-diamond-mode-note");
    const label = document.getElementById("production-additional-stone-label");
    const help = document.getElementById("production-additional-stone-help");
    if (title) title.textContent = real ? "Real Diamond / 100% Bill Weight" : "American Diamond / 96% Bill Weight";
    if (note) note.textContent = real
      ? "Type, shape, size and number of pieces remain visible. Row weights are reference-only; only the manually entered actual Real Diamond weight is counted."
      : "Stone Master weights and piece counts are used. Billing uses 96% of the actual stone weight.";
    if (label) label.textContent = real ? "Real Diamond Actual Weight (g)" : "Additional Stone Weight (g)";
    if (help) help.textContent = real
      ? "Enter the total actual Real Diamond weight for this PR. It is counted once at 100%; individual row weights are not counted again."
      : "Enter only the directly added stone weight for the current PR. Leave blank or enter zero when none is added.";
  };

  const originalProductionStoneItemsForOrder = productionStoneItemsForOrder;
  productionStoneItemsForOrder = function diamondProductionStoneItemsForOrder(order = {}) {
    return originalProductionStoneItemsForOrder(order).map((item) => markStoneItem(item, orderDiamondType(order)));
  };

  productionStoneTotals = function diamondProductionStoneTotals(items = [], settingType = "", order = null) {
    return (items || [])
      .filter((item) => !settingType || item.settingType === settingType || (settingType === "hand" && item.isAdditionalStone))
      .reduce((total, item) => {
        total.pcs += Number(item.pcs || 0);
        total.weight += effectiveStoneWeight(item, order);
        return total;
      }, { pcs: 0, weight: 0 });
  };

  productionStoneTotalsForOrders = function diamondProductionStoneTotalsForOrders(orders = [], settingType = "") {
    return (orders || []).reduce((total, order) => {
      const savedItems = Array.isArray(order.productionStoneItems) && order.productionStoneItems.length
        ? order.productionStoneItems
        : null;
      const items = savedItems || productionStoneItemsForOrder(order);
      items.forEach((sourceItem) => {
        if (settingType && sourceItem.settingType !== settingType && !(settingType === "hand" && sourceItem.isAdditionalStone)) return;
        const resolved = Number(sourceItem.totalWeight || 0) || !savedItems
          ? sourceItem
          : productionStoneItemWithMasterData(sourceItem);
        const item = markStoneItem(resolved, orderDiamondType(order));
        total.pcs += Number(item.pcs || 0);
        total.weight += effectiveStoneWeight(item, order);
      });
      return total;
    }, { pcs: 0, weight: 0 });
  };

  designStoneTotals = function diamondDesignStoneTotals(items = []) {
    return (items || []).reduce((total, item) => ({
      pcs: total.pcs + Number(item.pcs || 0),
      weight: total.weight + effectiveStoneWeight(item),
    }), { pcs: 0, weight: 0 });
  };

  productionStoneSummaryText = function diamondProductionStoneSummary(items = []) {
    const type = normalizeDiamondType(items.find((item) => item.diamondType)?.diamondType);
    const wax = productionStoneTotals(items, "wax");
    const hand = productionStoneTotals(items, "hand");
    const additional = productionStoneTotals(items.filter((item) => item.isAdditionalStone));
    const total = productionStoneTotals(items);
    if (!total.pcs && !total.weight) return "No stone";
    if (type === REAL_DIAMOND) {
      return `Real Diamond ${total.pcs} pcs / Manual actual ${weight3(total.weight)}g / Bill 100% / ${pieceBreakdownText(items)}`;
    }
    return `Wax ${wax.pcs} pcs / ${weight3(wax.weight)}g, Hand Total ${hand.pcs} pcs / ${weight3(hand.weight)}g (Additional ${weight3(additional.weight)}g included), Total ${total.pcs} pcs / ${weight3(total.weight)}g`;
  };

  const originalRowsFromDialog = productionStoneRowsFromDialog;
  productionStoneRowsFromDialog = function diamondRowsFromDialog(options = {}) {
    const order = activeProductionStoneEditorOrder() || {};
    const type = activeDiamondType(order);
    return originalRowsFromDialog(options).map((item) => markStoneItem(item, type));
  };

  const originalAdditionalStoneItem = directAdditionalStoneItemForOrder;
  directAdditionalStoneItemForOrder = function diamondAdditionalStoneItem(order = {}, weight = 0) {
    const type = activeDiamondType(order);
    const item = originalAdditionalStoneItem(order, weight);
    return markStoneItem({
      ...item,
      stoneType: type === REAL_DIAMOND ? "REAL DIAMOND WEIGHT" : item.stoneType,
      code: type === REAL_DIAMOND ? "REAL-DIAMOND" : item.code,
    }, type);
  };

  const originalSaveMissingWeights = saveMissingProductionStoneWeightsToMaster;
  saveMissingProductionStoneWeightsToMaster = function diamondSafeMasterWeightSave(items = [], order = {}) {
    if (activeDiamondType(order) === REAL_DIAMOND) return 0;
    return originalSaveMissingWeights(items, order);
  };

  const originalConfigureStoneDialog = configureProductionStoneDialogMode;
  configureProductionStoneDialogMode = function diamondConfigureStoneDialog(mode = "production") {
    const result = originalConfigureStoneDialog(mode);
    const form = document.getElementById("production-stone-form");
    form?.querySelector(".production-diamond-type-control")?.classList.toggle("hidden", mode === "fitting");
    if (mode !== "fitting") updateDiamondUi(activeProductionStoneEditorOrder() || {});
    return result;
  };

  const originalOpenProductionStone = openProductionStoneEntry;
  openProductionStoneEntry = function diamondOpenProductionStone(orderId = "") {
    const result = originalOpenProductionStone(orderId);
    const order = findById("orders", orderId);
    const form = document.getElementById("production-stone-form");
    if (order && form?.diamondType) {
      form.diamondType.value = orderDiamondType(order);
      updateDiamondUi(order);
      renderProductionStoneItems(order);
    }
    return result;
  };

  const originalRenderProductionStoneMeta = renderProductionStoneMeta;
  renderProductionStoneMeta = function diamondRenderProductionStoneMeta(order = {}, items = null) {
    originalRenderProductionStoneMeta(order, items);
    const container = document.getElementById("production-stone-meta");
    if (!container || !order.id) return;
    const type = activeDiamondType(order);
    const existing = container.querySelector("[data-diamond-type-meta]");
    const html = `<article data-diamond-type-meta><span>Diamond Type</span><strong>${escapeHtml(diamondLabel(type))} / ${Math.round(diamondFactor(type) * 100)}%</strong></article>`;
    if (existing) existing.outerHTML = html;
    else container.insertAdjacentHTML("beforeend", html);
  };

  const originalRenderProductionStoneItems = renderProductionStoneItems;
  renderProductionStoneItems = function diamondRenderProductionStoneItems(order = {}, forcedItems = null) {
    const type = activeDiamondType(order);
    const markedItems = Array.isArray(forcedItems)
      ? forcedItems.map((item) => markStoneItem(item, type))
      : forcedItems;
    const result = originalRenderProductionStoneItems(order, markedItems);
    updateDiamondUi(order);
    return result;
  };

  const form = document.getElementById("production-stone-form");
  form?.addEventListener("change", (event) => {
    if (event.target.name !== "diamondType") return;
    const order = activeProductionStoneEditorOrder() || {};
    updateDiamondUi(order);
    renderProductionStoneItems(order, productionStoneRowsFromDialog());
    if (order.id) markProductionStoneDialogEdited(order);
  });

  form?.addEventListener("submit", (event) => {
    if (productionStoneFittingEditorContext()) return;
    const order = findById("orders", form.orderId?.value || "");
    if (!order) return;
    const type = normalizeDiamondType(form.diamondType?.value || orderDiamondType(order));
    const targets = selectedProductionStoneTargetOrders(order);
    const regularRows = productionStoneRowsFromDialog();
    const manualWeight = Number(formatStoneWeight(form.additionalStoneWeight?.value || "") || 0);
    if (type === REAL_DIAMOND && targets.length > 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      alert("Save Real Diamond one production number at a time because each PR item needs its own manually verified actual diamond weight.");
      return;
    }
    if (type === REAL_DIAMOND && (!regularRows.length || manualWeight <= 0)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      alert("Real Diamond needs its type, shape, size and number of pieces, plus the total actual weight in Real Diamond Actual Weight.");
      return;
    }
    targets.forEach((target) => {
      target.diamondType = type;
      target.productionDiamondType = type;
    });
  }, true);

  billStoneWeightFromActual = function diamondBillStoneWeightFromActual(actualWeight = 0, factor = null) {
    const appliedFactor = factor ?? (billRefreshOrder ? diamondFactor(billRefreshOrder) : AMERICAN_FACTOR);
    return Number(weight3(Math.max(Number(actualWeight || 0), 0) * Number(appliedFactor)));
  };

  automaticBillStoneWeight = function diamondAutomaticBillStoneWeight(order = {}) {
    return billStoneWeightFromActual(actualBillStoneWeight(order), diamondFactor(order));
  };

  const originalBillNonGoldBreakup = billItemNonGoldBreakup;
  billItemNonGoldBreakup = function diamondBillNonGoldBreakup(item = {}, order = {}) {
    const result = originalBillNonGoldBreakup(item, order);
    const hasSavedStone = item.billStoneWeightFactor !== undefined
      && item.billStoneWeightFactor !== null
      && (item.stoneWeight !== undefined || item.stWeight !== undefined);
    if (!order.manualWipOrder && order.id && hasSavedStone) {
      result.stoneWeight = billNumber(item.stoneWeight ?? item.stWeight);
      result.total = Number(weight3(
        result.stoneWeight
        + result.blackBeadsWeight
        + result.motiWeight
        + result.springWeight
        + result.otherNonGoldWeight
      ));
    }
    return result;
  };

  const originalBillItemWithLatestStoneEntry = billItemWithLatestStoneEntry;
  billItemWithLatestStoneEntry = function diamondBillItemWithLatestStoneEntry(item = {}, order = {}, source = "Job Card Stone Entry") {
    const result = originalBillItemWithLatestStoneEntry(item, order, source);
    const rows = productionStoneItemsForOrder(order);
    result.diamondType = orderDiamondType(order);
    result.billStoneWeightFactor = diamondFactor(order);
    result.billActualStoneWeight = actualBillStoneWeight(order);
    result.billStonePieceCount = productionStoneTotals(rows).pcs;
    result.billStonePieceBreakdown = pieceBreakdownText(rows);
    return result;
  };

  const decorateBillRows = (lot = {}, bill = {}) => {
    const savedItems = Array.isArray(bill.items) ? bill.items : [];
    document.querySelectorAll("#bill-item-table tr[data-order-id]").forEach((row) => {
      if (row.dataset.manualWip === "true") return;
      const order = findById("orders", row.dataset.orderId);
      if (!order) return;
      const saved = savedItems.find((item) => item.orderId === order.id || item.productionNo === order.productionNo) || {};
      const type = normalizeDiamondType(saved.diamondType || orderDiamondType(order));
      const factor = Number(saved.billStoneWeightFactor ?? diamondFactor(type));
      const rows = productionStoneItemsForOrder(order);
      row.dataset.diamondType = type;
      row.dataset.billStoneWeightFactor = String(factor);
      const status = row.querySelector("[data-bill-stone-status]");
      if (status) status.textContent = `Auto-synced: ${rows.length} stone row${rows.length === 1 ? "" : "s"} / ${productionStoneTotals(rows).pcs} pcs / ${gram(Number(row.dataset.jobStoneWeight || 0))}`;
      let badge = row.querySelector(".bill-diamond-type-badge");
      if (!badge && status) {
        status.insertAdjacentHTML("beforebegin", '<span class="bill-diamond-type-badge"></span>');
        badge = row.querySelector(".bill-diamond-type-badge");
      }
      if (badge) {
        badge.textContent = `${diamondLabel(type)} / ${Math.round(factor * 100)}%`;
        badge.classList.toggle("real", type === REAL_DIAMOND);
      }
      let detail = row.querySelector(".diamond-piece-breakdown");
      if (!detail && status) {
        status.insertAdjacentHTML("afterend", '<small class="diamond-piece-breakdown"></small>');
        detail = row.querySelector(".diamond-piece-breakdown");
      }
      if (detail) {
        detail.textContent = pieceBreakdownText(rows);
        detail.title = detail.textContent;
      }
    });
  };

  const originalRenderBillItems = renderBillItems;
  renderBillItems = function diamondRenderBillItems(lot = {}, bill = {}) {
    const result = originalRenderBillItems(lot, bill);
    decorateBillRows(lot, bill);
    return result;
  };

  const originalRefreshBillItemStoneEntry = refreshBillItemStoneEntry;
  refreshBillItemStoneEntry = function diamondRefreshBillItemStoneEntry(orderId = "") {
    billRefreshOrder = findById("orders", orderId);
    try {
      const result = originalRefreshBillItemStoneEntry(orderId);
      const row = [...document.querySelectorAll("#bill-item-table tr[data-order-id]")]
        .find((entry) => entry.dataset.orderId === orderId);
      if (row && billRefreshOrder) {
        row.dataset.diamondType = orderDiamondType(billRefreshOrder);
        row.dataset.billStoneWeightFactor = String(diamondFactor(billRefreshOrder));
        decorateBillRows(findById("lots", document.getElementById("bill-form")?.lotId?.value || "") || {}, {});
      }
      return result;
    } finally {
      billRefreshOrder = null;
    }
  };

  const originalBillItemRows = billItemRows;
  billItemRows = function diamondBillItemRows(existingItems = [], options = {}) {
    return originalBillItemRows(existingItems, options).map((item) => {
      const row = [...document.querySelectorAll("#bill-item-table tr[data-order-id]")]
        .find((entry) => entry.dataset.orderId === item.orderId);
      const order = findById("orders", item.orderId) || {};
      const rows = order.id ? productionStoneItemsForOrder(order) : [];
      return {
        ...item,
        diamondType: normalizeDiamondType(row?.dataset.diamondType || item.diamondType || orderDiamondType(order)),
        billStoneWeightFactor: Number(row?.dataset.billStoneWeightFactor ?? item.billStoneWeightFactor ?? diamondFactor(order)),
        billStonePieceCount: productionStoneTotals(rows).pcs,
        billStonePieceBreakdown: pieceBreakdownText(rows),
      };
    });
  };

  window.KJPL_DIAMOND_BILLING_V747 = Object.freeze({
    version: "v747",
    americanFactor: AMERICAN_FACTOR,
    realFactor: REAL_FACTOR,
    normalizeDiamondType,
    diamondFactor,
    effectiveStoneWeight,
    pieceBreakdown,
  });
})();
