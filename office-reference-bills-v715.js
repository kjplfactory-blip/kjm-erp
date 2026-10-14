(() => {
  "use strict";

  const baseAllOfficeBillItemEntries = allOfficeBillItemEntries;
  const baseOfficeDialogConfig = officeDialogConfig;
  const baseOfficeReturnEntryIsEligible = officeReturnEntryIsEligible;
  const baseReturnBillItemToProductionShelf = returnBillItemToProductionShelf;
  const baseFinalizeProductionShelfReturnLot = finalizeProductionShelfReturnLot;
  const baseSyncProductionReturnAfterSafeIssue = syncProductionReturnAfterSafeIssue;

  function isReferenceEntry(entry = {}) {
    return Boolean(
      entry.referenceOnly
      || isReferenceOnlyBillLot(entry.lot || {})
      || isReferenceOnlyBill(entry.bill || {})
    );
  }

  function referenceOrder(lot = {}, bill = {}, item = {}) {
    const linked = findById("orders", item.orderId) || {};
    return {
      ...linked,
      id: linked.id || item.orderId || "",
      productionNo: linked.productionNo || item.productionNo || "",
      number: linked.number || item.productionNo || "",
      jobNumber: linked.jobNumber || bill.jobNumber || lot.orderNumber || "",
      customer: linked.customer || item.customer || bill.customerName || bill.customer || lot.customerName || lot.customer || "Reference Bill",
      designNo: linked.designNo || item.designNo || item.itemName || "",
      category: linked.category || item.category || "",
      item: linked.item || item.item || item.itemName || "",
      ringType: linked.ringType || item.ringType || "",
      cmItemType: linked.cmItemType || item.cmItemType || "",
      color: linked.color || item.color || "",
      size: linked.size || item.size || "",
      purity: linked.purity || item.purity || lot.metalPurity || "18K",
      remarks: linked.remarks || item.remarks || item.remark || "",
    };
  }

  function referenceItems() {
    return (state.lots || []).flatMap((lot) => {
      const bill = billForLotRecord(lot);
      if (!bill?.items?.length || (!isReferenceOnlyBillLot(lot) && !isReferenceOnlyBill(bill))) return [];
      return bill.items.map((item) => ({
        lot,
        bill,
        item,
        order: referenceOrder(lot, bill, item),
        referenceOnly: true,
      }));
    });
  }

  function traceableOfficeItems() {
    return [...officeItems(), ...referenceItems()];
  }

  function normalizedSearch(value = "") {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function searchableValues({ lot = {}, bill = {}, item = {}, order = {} } = {}) {
    return [
      item.productionNo,
      order.productionNo,
      item.designNo,
      order.designNo,
      item.itemName,
      item.category,
      order.category,
      bill.billNo,
      bill.jobNumber,
      lot.orderNumber,
      lot.number,
      order.customer,
      item.huid1,
      item.huid2,
      item.officeReturnLotNumber,
    ];
  }

  function referenceSearch(query = "") {
    const normalized = normalizedSearch(query);
    const entries = referenceItems();
    if (!normalized) return entries;
    return entries.filter((entry) => searchableValues(entry).some((value) => normalizedSearch(value).includes(normalized)));
  }

  function referenceStatus(item = {}) {
    return item.productionReturnSafeItemId ? "Returned To Factory" : "Reference Bill Item";
  }

  function referenceCard(entry = {}) {
    const { lot, bill, item, order } = entry;
    const key = officeItemKey(lot.id, item);
    const nonGold = billItemNonGoldBreakup(item, order);
    const eligible = baseOfficeReturnEntryIsEligible(entry);
    const itemType = item.item || item.cmItemType || item.ringType || order.item || order.cmItemType || order.ringType || "-";
    return `
      <article class="office-library-item reference">
        <div class="office-library-row">
          <div>
            <strong>${escapeHtml(item.productionNo || order.productionNo || "-")}</strong>
            <small>${escapeHtml(referenceStatus(item))}</small>
          </div>
          <div class="row-actions">
            <button type="button" class="ghost-button" data-reference-office-view="${escapeHtml(key)}">View Full Details</button>
            ${eligible && canReceiveRepairFactoryIn() ? `<button type="button" data-return-office-item="${escapeHtml(key)}">Return For Repair</button>` : ""}
          </div>
        </div>
        <span>${escapeHtml(order.customer || "-")} / ${escapeHtml(order.designNo || item.designNo || "-")}</span>
        <div class="office-batch-item-details">
          <span><b>Job Card</b>${escapeHtml(lot.orderNumber || bill.jobNumber || "-")}</span>
          <span><b>Bill No</b>${escapeHtml(bill.billNo || "-")}</span>
          <span><b>Bill Date</b>${escapeHtml(bill.billDate || item.billDate || "-")}</span>
          <span><b>Item</b>${escapeHtml(itemType)}</span>
          <span><b>Category</b>${escapeHtml(item.category || order.category || "-")}</span>
          <span><b>Purity</b>${escapeHtml(item.purity || order.purity || "-")}</span>
          <span><b>Colour</b>${escapeHtml(item.color || order.color || "-")}</span>
          <span><b>Size</b>${escapeHtml(billItemSizeText(item, order) || "-")}</span>
          <span><b>GW</b>${gram(item.finalGw)}</span>
          <span><b>Stone</b>${gram(nonGold.stoneWeight)}</span>
          <span><b>Black Beads</b>${gram(nonGold.blackBeadsWeight)}</span>
          <span><b>Moti</b>${gram(nonGold.motiWeight)}</span>
          <span><b>Spring</b>${gram(nonGold.springWeight)}</span>
          <span><b>Other</b>${gram(nonGold.otherNonGoldWeight)}</span>
          <span><b>Total Non-Gold</b>${gram(nonGold.total)}</span>
          <span class="office-batch-net"><b>Net Wt</b>${gram(item.netWeight)}</span>
        </div>
        <small class="reference-office-note">Reference Bill Archive / No current stock effect${item.officeReturnLotNumber ? ` / Factory Return ${escapeHtml(item.officeReturnLotNumber)}` : ""}</small>
      </article>
    `;
  }

  function renderReferenceArchive(query = "") {
    const entries = referenceSearch(query);
    return `
      <section class="office-reference-archive">
        <div class="panel-heading office-reference-heading">
          <div>
            <h3>Reference Bill Item Register</h3>
            <small>${entries.length} matching item${entries.length === 1 ? "" : "s"}. Archived records remain outside current Office stock until returned to Factory.</small>
          </div>
          <input id="office-reference-search" class="search" value="${escapeHtml(query)}" placeholder="Search PR, Bill, Job, design or customer" autocomplete="off">
        </div>
        <div class="office-reference-grid">
          ${entries.length ? entries.map(referenceCard).join("") : '<div class="empty">No matching Reference Bill item.</div>'}
        </div>
      </section>
    `;
  }

  function refreshReferenceArchive() {
    const dialog = document.getElementById("office-details-dialog");
    if (dialog?.dataset.page !== "reference-bills") return;
    const input = document.getElementById("office-reference-search");
    const query = input?.value || dialog.dataset.referenceBillSearch || "";
    dialog.dataset.referenceBillSearch = query;
    const content = document.getElementById("office-dialog-content");
    if (content) content.innerHTML = renderReferenceArchive(query);
    const refreshed = document.getElementById("office-reference-search");
    if (refreshed) {
      refreshed.focus();
      refreshed.setSelectionRange(refreshed.value.length, refreshed.value.length);
    }
  }

  async function openReferenceItem(key = "") {
    const found = findOfficeBillItem(key);
    if (!found || !isReferenceEntry(found)) {
      alert("Reference Bill item details were not found.");
      return;
    }
    const { lot, bill, item } = found;
    const order = referenceOrder(lot, bill, item);
    const design = findById("designs", order.designId) || {};
    const nonGold = billItemNonGoldBreakup(item, order);
    const details = [
      ["Record Type", "Reference Bill Archive / No Current Stock Effect"],
      ["Status", referenceStatus(item)],
      ["Job Card", lot.orderNumber || bill.jobNumber || lot.number],
      ["Lot", lot.number],
      ["Bill No", bill.billNo],
      ["Bill Date", bill.billDate || item.billDate],
      ["Customer", order.customer],
      ["PR No", item.productionNo || order.productionNo],
      ["Design", order.designNo || item.designNo],
      ["Item", item.itemName || item.item || order.item],
      ["Category", item.category || order.category],
      ["Size", billItemSizeText(item, order)],
      ["Colour", item.color || order.color],
      ["Purity", item.purity || order.purity],
      ["GW", gram(item.finalGw)],
      ["Stone", gram(nonGold.stoneWeight)],
      ["Black Beads", gram(nonGold.blackBeadsWeight)],
      ["Moti", gram(nonGold.motiWeight)],
      ["Spring", gram(nonGold.springWeight)],
      ["Other Non-Gold", gram(nonGold.otherNonGoldWeight)],
      ["Total Non-Gold", gram(nonGold.total)],
      ["Net Weight", gram(item.netWeight)],
      ["HUID", [item.huid1, item.huid2].filter(Boolean).join(" / ")],
      ["Remark", order.remarks || item.remarks || item.remark],
      ["Factory Return Lot", item.officeReturnLotNumber],
    ];
    let imageData = "";
    if (design.id) imageData = await getDesignImage(design.id).catch(() => design.imageData || "");
    const dialog = document.getElementById("office-details-dialog");
    if (dialog) {
      dialog.dataset.backPage = "reference-bills";
      dialog.dataset.page = "reference-product-view";
    }
    const title = document.querySelector("#office-details-dialog h2");
    const note = document.querySelector("#office-details-dialog .dialog-note");
    const actions = document.getElementById("office-dialog-actions");
    const content = document.getElementById("office-dialog-content");
    const panel = document.querySelector("#office-details-dialog .table-panel");
    if (title) title.textContent = `Reference Item - ${item.productionNo || order.productionNo || "-"}`;
    if (note) note.textContent = `${bill.billNo || "Reference Bill"} / ${item.productionReturnSafeItemId ? "Already returned to Factory" : "Available for repair return"}`;
    if (actions) actions.innerHTML = `
      <button type="button" id="office-reference-back" class="ghost-button">Back To Reference Bills</button>
      ${baseOfficeReturnEntryIsEligible({ lot, bill, item, order, referenceOnly: true }) && canReceiveRepairFactoryIn()
        ? `<button type="button" data-return-office-item="${escapeHtml(key)}">Return Reference Item For Repair</button>`
        : ""}
    `;
    if (panel) panel.classList.add("hidden");
    if (content) content.innerHTML = `
      <div class="sold-view-layout">
        <div class="sold-design-panel">
          ${imageData ? `<img class="sold-design-image" src="${imageData}" alt="${escapeHtml(order.designNo || "Design image")}">` : '<div class="empty sold-image-empty">No linked design image found.</div>'}
          <strong>${escapeHtml(order.designNo || item.designNo || "-")}</strong>
          <span>${escapeHtml(item.category || order.category || "-")}</span>
          ${item.productionNo || order.productionNo ? barcodeSvg(item.productionNo || order.productionNo) : ""}
        </div>
        <div class="sold-detail-panel">
          <div class="panel-heading"><h3>${escapeHtml(item.productionNo || order.productionNo || "-")}</h3><span class="status pending">${escapeHtml(referenceStatus(item))}</span></div>
          <div class="sold-detail-grid">${details.map(([label, value]) => soldDetailCell(label, value)).join("")}</div>
        </div>
      </div>
    `;
    if (dialog && !dialog.open) dialog.showModal();
  }

  function updateReferenceTileCount() {
    const count = referenceItems().length;
    const target = document.getElementById("office-reference-bill-count");
    if (target) target.textContent = `${count} archived item${count === 1 ? "" : "s"} / searchable and repair-ready`;
  }

  allOfficeBillItemEntries = function allOfficeBillItemEntriesV715() {
    const entries = baseAllOfficeBillItemEntries();
    const seen = new Set(entries.map(({ lot, item }) => officeItemKey(lot.id, item)));
    referenceItems().forEach((entry) => {
      const key = officeItemKey(entry.lot.id, entry.item);
      if (!seen.has(key)) entries.push(entry);
    });
    return entries;
  };

  officeDialogConfig = function officeDialogConfigV715(page) {
    if (page !== "reference-bills") return baseOfficeDialogConfig(page);
    const dialog = document.getElementById("office-details-dialog");
    const query = dialog?.dataset.referenceBillSearch || "";
    return {
      title: "Reference Bill Items",
      note: "Trace archived Bill items and return products to Factory for repair, rework or melting.",
      actions: '<button type="button" id="office-reference-open-return" class="ghost-button">Create Factory Return Lot</button>',
      content: renderReferenceArchive(query),
    };
  };

  officeReturnEligibleItems = function officeReturnEligibleItemsV715() {
    return traceableOfficeItems().filter(baseOfficeReturnEntryIsEligible);
  };

  officeReturnSearchMatches = function officeReturnSearchMatchesV715(query = "") {
    const normalized = normalizedSearch(query);
    if (!normalized) return [];
    return officeReturnEligibleItems()
      .filter((entry) => searchableValues(entry).some((value) => normalizedSearch(value).includes(normalized)))
      .sort((left, right) => {
        const leftPr = normalizedSearch(left.item.productionNo || left.order.productionNo);
        const rightPr = normalizedSearch(right.item.productionNo || right.order.productionNo);
        return (leftPr === normalized ? 0 : 1) - (rightPr === normalized ? 0 : 1)
          || leftPr.localeCompare(rightPr, undefined, { numeric: true });
      })
      .slice(0, 50);
  };

  officeReturnSelectedEntries = function officeReturnSelectedEntriesV715() {
    const entries = [];
    Array.from(officeReturnLotSelection).forEach((key) => {
      const found = findOfficeBillItem(key);
      if (!found) {
        officeReturnLotSelection.delete(key);
        officeReturnLotDraftWeights.delete(key);
        return;
      }
      const order = isReferenceEntry(found)
        ? referenceOrder(found.lot, found.bill, found.item)
        : (findById("orders", found.item.orderId) || {});
      const entry = { ...found, order, key, referenceOnly: isReferenceEntry(found) };
      if (!baseOfficeReturnEntryIsEligible(entry)) {
        officeReturnLotSelection.delete(key);
        officeReturnLotDraftWeights.delete(key);
        return;
      }
      entries.push(entry);
    });
    return entries;
  };

  renderOfficeReturnSearchResults = function renderOfficeReturnSearchResultsV715() {
    const container = document.getElementById("office-return-search-results");
    if (!container) return;
    const query = document.getElementById("office-return-pr-search")?.value || "";
    if (!normalizedSearch(query)) {
      container.innerHTML = '<div class="empty office-return-search-empty">Enter a PR, Bill, Job Card or design number to find a live Office item or archived Reference Bill item.</div>';
      return;
    }
    const matches = officeReturnSearchMatches(query);
    container.innerHTML = matches.length ? matches.map((entry) => {
      const { lot, bill, item, order } = entry;
      const key = officeItemKey(lot.id, item);
      const selected = officeReturnLotSelection.has(key);
      const weights = productionReturnWeightSummary(item);
      const referenceOnly = isReferenceEntry(entry);
      return `
        <article class="office-return-search-result ${selected ? "selected" : ""} ${referenceOnly ? "reference" : ""}">
          <div>
            <strong>${escapeHtml(item.productionNo || order.productionNo || "-")}</strong>
            <span>${escapeHtml(order.designNo || item.designNo || "-")} / ${escapeHtml(jobItemDisplayName(order) || item.itemName || order.category || "-")}</span>
            <small>${escapeHtml(lot.orderNumber || lot.number || "-")} / Bill ${escapeHtml(bill.billNo || "-")} / ${escapeHtml(referenceOnly ? "Reference Bill Archive" : officeItemLocation(item))}</small>
            ${referenceOnly ? '<small class="reference-office-note">Returning this item creates a new live Factory In record.</small>' : ""}
          </div>
          <div class="office-return-result-weight"><b>GW ${gram(weights.grossWeight)}</b><small>Non-Gold ${gram(weights.nonGoldWeight)} / Net ${gram(weights.netWeight)}</small></div>
          <button type="button" data-office-return-add="${escapeHtml(key)}" ${selected ? "disabled" : ""}>${selected ? "Added" : "Add PR"}</button>
        </article>
      `;
    }).join("") : '<div class="empty office-return-search-empty">No eligible Office or Reference Bill item matches this search.</div>';
  };

  returnBillItemToProductionShelf = function returnBillItemToProductionShelfV715(args = {}) {
    if (!isReferenceEntry(args)) return baseReturnBillItemToProductionShelf(args);
    const syntheticOrder = referenceOrder(args.lot, args.bill, args.item);
    const syntheticItem = {
      ...args.item,
      officeStatus: args.item.officeStatus || "Office",
      factoryStatus: args.item.factoryStatus || "Factory Out",
    };
    const result = baseReturnBillItemToProductionShelf({ ...args, item: syntheticItem, order: syntheticOrder });
    if (result?.billItem) {
      result.billItem.referenceBillRepairReturn = true;
      result.billItem.referenceOnlyAfterReset = true;
    }
    return result;
  };

  finalizeProductionShelfReturnLot = function finalizeProductionShelfReturnLotV715(lot = {}, bill = {}) {
    if (!isReferenceOnlyBillLot(lot) && !isReferenceOnlyBill(bill)) return baseFinalizeProductionShelfReturnLot(lot, bill);
    lot.bill = bill;
    updateSavedBill(bill);
  };

  syncProductionReturnAfterSafeIssue = function syncProductionReturnAfterSafeIssueV715(safeItem = {}, issue = {}, reworkLot = null) {
    const sourceLot = safeItem.returnSourceLotId ? findById("lots", safeItem.returnSourceLotId) : null;
    const preserveArchive = sourceLot && isReferenceOnlyBillLot(sourceLot)
      ? {
          status: sourceLot.status,
          currentDepartment: sourceLot.currentDepartment,
          karigarName: sourceLot.karigarName,
          billingStage: sourceLot.billingStage,
          productionStockWeight: sourceLot.productionStockWeight,
        }
      : null;
    const result = baseSyncProductionReturnAfterSafeIssue(safeItem, issue, reworkLot);
    if (sourceLot && preserveArchive) Object.assign(sourceLot, preserveArchive);
    return result;
  };

  document.getElementById("office-details-dialog")?.addEventListener("click", (event) => {
    const view = event.target.closest("[data-reference-office-view]");
    if (view) {
      openReferenceItem(view.dataset.referenceOfficeView || "");
      return;
    }
    if (event.target.id === "office-reference-back") {
      openOfficeDialogPage("reference-bills");
      return;
    }
    if (event.target.id === "office-reference-open-return") openOfficeReturnLotWorkspace();
  });

  document.getElementById("office-details-dialog")?.addEventListener("input", (event) => {
    if (event.target.id !== "office-reference-search") return;
    const dialog = document.getElementById("office-details-dialog");
    if (dialog) dialog.dataset.referenceBillSearch = event.target.value;
    window.clearTimeout(window.officeReferenceSearchTimerV715);
    window.officeReferenceSearchTimerV715 = window.setTimeout(refreshReferenceArchive, 120);
  });

  document.getElementById("office")?.addEventListener("click", () => window.setTimeout(updateReferenceTileCount, 0));
  window.setTimeout(updateReferenceTileCount, 0);

  window.KJM_OFFICE_REFERENCE_V715 = {
    referenceItems,
    referenceSearch,
    isReferenceEntry,
    version: "v715",
  };
})();
