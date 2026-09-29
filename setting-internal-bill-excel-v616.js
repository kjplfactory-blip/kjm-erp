(function installSettingInternalAndBillExcelV616() {
  "use strict";

  const coreOnlineTransferHistoryEntries = onlineTransferHistoryEntries;
  const coreRenderLotHistoryTable = renderLotHistoryTable;
  const coreBillLotTraceEntries = billLotTraceEntries;
  const coreRenderBills = renderBills;

  function isInternalSettingSplitLot(lot = {}) {
    return Boolean(lot.settingSplit && lot.settingSplitFromLotId);
  }

  function isInternalSplitTransfer(transfer = {}) {
    return Boolean(transfer.splitAdjustment);
  }

  function normalizeInternalSettingSplit(lot = {}) {
    if (!isInternalSettingSplitLot(lot)) return false;
    const settingDepartment = mergedProductionDepartmentName(
      lot.currentDepartment || lot.karigarName || "Setting",
      lot.karigarName || "Setting",
    ) || "SETTING";
    const setterManagerName = lot.karigarName || settingDepartment;
    const nextValues = {
      internalDepartmentAllocation: true,
      issueSourceName: "SETTING MANAGER",
      issueSourceLocker: "",
      issueSourceDetail: `Internal setter allocation from ${lot.settingSplitFromLotNumber || "original Setting lot"}; no Safe Locker or department stock movement`,
      issueDepartment: settingDepartment,
      issueKarigarId: lot.karigarId || "",
      issueKarigarName: setterManagerName,
    };
    let changed = false;
    Object.entries(nextValues).forEach(([key, value]) => {
      if (lot[key] === value) return;
      lot[key] = value;
      changed = true;
    });
    (lot.transfers || []).filter(isInternalSplitTransfer).forEach((transfer) => {
      transfer.internalDepartmentAllocation = true;
      transfer.reason = `Internal setter allocation from ${lot.settingSplitFromLotNumber || "original Setting lot"}; no stock movement`;
    });
    return changed;
  }

  function migrateInternalSettingSplits(currentState = state) {
    return (currentState.lots || []).reduce((count, lot) => count + (normalizeInternalSettingSplit(lot) ? 1 : 0), 0);
  }

  const coreSplitSettingLotForSetterV616 = splitSettingLotForSetter;
  splitSettingLotForSetter = function splitSettingLotForSetterInternalV616(...args) {
    const splitLot = coreSplitSettingLotForSetterV616.apply(this, args);
    if (splitLot) normalizeInternalSettingSplit(splitLot);
    return splitLot;
  };

  const coreNormalizeStateV616 = normalizeState;
  normalizeState = function normalizeStateWithInternalSettingV616(currentState) {
    const normalized = coreNormalizeStateV616.call(this, currentState);
    migrateInternalSettingSplits(normalized);
    return normalized;
  };

  const coreRunPostCloudMigrationsV616 = runPostCloudMigrations;
  runPostCloudMigrations = function runPostCloudMigrationsInternalSettingV616() {
    migrateInternalSettingSplits(state);
    return coreRunPostCloudMigrationsV616.call(this);
  };

  function settingAllocationEntry(lot = {}) {
    const setterEntry = (state.settingManagerEntries || [])
      .filter((entry) => entry.lotId === lot.id && entry.entryType !== "Accessory")
      .sort((left, right) => transferHistoryTime(right.createdAt, right.issueDate) - transferHistoryTime(left.createdAt, left.issueDate))[0];
    return {
      step: "Internal",
      type: "Internal Setting Allocation",
      date: lot.settingSplitDate || lot.issueDate || setterEntry?.issueDate || "-",
      createdAt: lot.createdAt || setterEntry?.createdAt || "",
      from: "Setting Manager",
      to: setterEntry?.setterName ? `Setter: ${setterEntry.setterName}` : "Setting Sub-Lot",
      issueGw: Number(lot.grossIssuedWeight || lot.issuedWeight || 0),
      receiveGw: Number(lot.grossIssuedWeight || lot.issuedWeight || 0),
      netWeight: Number(lot.issuedWeight || 0),
      difference: 0,
    };
  }

  function productionMovementTrace(lot = {}) {
    const entries = [];
    if (isInternalSettingSplitLot(lot)) {
      entries.push(settingAllocationEntry(lot));
    } else {
      const issueGw = Number(lot.grossIssuedWeight || (Number(lot.issuedWeight || 0) + transferWaxStoneWeight(lot)));
      const firstDepartment = lot.issueDepartment || lot.currentDepartment || lot.karigarName || "-";
      entries.push({
        step: 1,
        type: lot.manualWipLot ? "Non-Job-Card WIP" : lot.fittingAccessoriesJobCard ? "Fitting Accessories Card" : "Gold Issue",
        date: lot.issueDate || "-",
        createdAt: lot.createdAt || "",
        from: lotIssueSourceName(lot),
        to: departmentTransferDetail(lot.issueKarigarName || lot.karigarName || firstDepartment, firstDepartment),
        issueGw,
        receiveGw: issueGw,
        netWeight: Number(lot.issuedWeight || 0),
        difference: 0,
      });
    }
    (lot.transfers || []).filter((transfer) => !isInternalSplitTransfer(transfer)).forEach((transfer, index) => {
      entries.push({
        step: index + 2,
        type: isBillTransferDestination({ toDepartment: transfer.toDepartment }, { name: transfer.toKarigarName }) ? "To Bill" : "Transfer",
        date: transfer.date || "-",
        createdAt: transfer.createdAt || "",
        from: departmentTransferDetail(transfer.fromKarigarName || transfer.fromDepartment || "-", transfer.fromDepartment || transfer.fromKarigarName || ""),
        to: departmentTransferDetail(transfer.toKarigarName || transfer.toDepartment || "-", transfer.toDepartment || transfer.toKarigarName || ""),
        issueGw: Number(transfer.transferWeight || 0),
        receiveGw: Number(transfer.grossReceivedWeight || 0),
        netWeight: Number(transfer.receivedWeight || 0),
        difference: Number(transfer.departmentBalance || 0),
      });
    });
    return entries.sort((left, right) => (
      transferHistoryTime(right.createdAt, right.date) - transferHistoryTime(left.createdAt, left.date)
    ));
  }

  onlineTransferHistoryEntries = function onlineTransferHistoryEntriesV616() {
    return coreOnlineTransferHistoryEntries.call(this).filter((entry) => {
      if (entry.type === "transfer" && isInternalSplitTransfer(entry.transfer)) return false;
      if (entry.type === "issue" && isInternalSettingSplitLot(entry.lot)) return false;
      return true;
    });
  };

  renderLotHistoryTable = function renderLotHistoryTableV616(lot = {}) {
    if (!isInternalSettingSplitLot(lot) && !(lot.transfers || []).some(isInternalSplitTransfer)) {
      return coreRenderLotHistoryTable.call(this, lot);
    }
    const realTransfers = (lot.transfers || [])
      .map((transfer, index) => ({ transfer, step: index + 2 }))
      .filter(({ transfer }) => !isInternalSplitTransfer(transfer))
      .sort((left, right) => transferHistoryTime(right.transfer.createdAt, right.transfer.date) - transferHistoryTime(left.transfer.createdAt, left.transfer.date))
      .map(({ transfer, step }) => renderHistoryTableRow(transfer, step, lot.id));
    const rows = [...realTransfers];
    if (isInternalSettingSplitLot(lot)) {
      const allocation = settingAllocationEntry(lot);
      const splitTransfer = (lot.transfers || []).find(isInternalSplitTransfer);
      const restoreButton = splitTransfer ? onlineTransferUndoButtonHtml({ type: "transfer", lot, transfer: splitTransfer }) : "";
      rows.push(`
        <tr class="lot-transfer-history-row internal-setting-allocation-row">
          <td>Internal</td>
          <td>${escapeHtml(transferHistoryDateTime(allocation.date, allocation.createdAt))}</td>
          <td class="department-oneline-cell">${transferDirectionCell(allocation.from, "from")}</td>
          <td class="department-oneline-cell">${transferDirectionCell(allocation.to, "to")}</td>
          <td>${gram(allocation.issueGw)}</td><td>${gram(allocation.receiveGw)}</td>
          <td>${gram(lot.waxStoneWeight || 0)}</td><td>${gram(lot.initialHandStoneWeight || 0)}</td>
          <td>-</td><td>${gram(allocation.netWeight)}</td><td>-</td>
          <td>${escapeHtml(transferPurityLabel(lot.metalPurity || "-"))}</td><td>-</td>
          <td class="remark-cell">${transferRemarkCell(`Internal Setting Manager split from ${lot.settingSplitFromLotNumber || "original lot"}. No shelf issue and no department stock movement.`)}</td>
          <td><div class="row-actions">${restoreButton || "-"}</div></td>
        </tr>
      `);
    } else {
      rows.push(renderGoldIssueHistoryRow(lot));
    }
    return `<div class="table-wrap lot-history-table"><table><thead><tr><th>Step</th><th>Date</th><th>From</th><th>To</th><th>Issue GW</th><th>Receive GW</th><th>Wax Stone</th><th>Hand Stone</th><th>Reduced</th><th>Net Wt</th><th>Difference</th><th>Purity</th><th>Fine Gold</th><th>Remarks</th><th>Action</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  };

  billLotTraceEntries = function billLotTraceEntriesV616(lot = {}) {
    if (!isInternalSettingSplitLot(lot) && !(lot.transfers || []).some(isInternalSplitTransfer)) {
      return coreBillLotTraceEntries.call(this, lot);
    }
    return productionMovementTrace(lot);
  };

  function excelEscape(value = "") {
    return String(value ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function excelCell(value, style = "", type = "String") {
    const safeType = type === "Number" && Number.isFinite(Number(value)) ? "Number" : "String";
    const safeValue = safeType === "Number" ? Number(value) : value;
    return `<Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="${safeType}">${excelEscape(safeValue)}</Data></Cell>`;
  }

  function excelRow(values = [], style = "") {
    return `<Row>${values.map((value) => {
      if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
        return excelCell(value.value, value.style || style, value.type || "String");
      }
      return excelCell(value, style);
    }).join("")}</Row>`;
  }

  function billExcelColumns() {
    return [
      "Bill No", "Bill Date", "Lot", "Job Card", "Customer", "Order Type", "PR No", "Design Name", "Category / Item", "Size", "Item Colour", "Purity",
      "Final GW (g)", "BB No", "BB Type", "BB Weight (g)", "Moti Weight (g)", "Stone Weight (g)", "Spring Weight (g)", "Other Weight (g)",
      "Total Non-Gold (g)", "Net Weight (g)", "Wastage %", "Base Fine (g)", "Wastage Fine (g)", "Total Fine (g)", "QC Status", "Office Status", "Remarks",
    ];
  }

  function billExcelDesignName(item = {}, order = {}) {
    const exportOrder = {
      ...order,
      itemName: order.itemName || item.itemName || "",
      designNumber: order.designNumber || item.designNo || "",
      category: order.category || item.category || "",
      cmItemType: order.cmItemType || item.cmItemType || "",
      ringType: order.ringType || item.ringType || "",
      designSubItemType: order.designSubItemType || item.designSubItemType || "",
      item: order.item || item.item || "",
      subItem: order.subItem || item.subItem || "",
      subCategory: order.subCategory || item.subCategory || "",
    };
    const design = exportOrder.designId ? findById("designs", exportOrder.designId) : null;
    const normalizedName = normalizedJobItemName(exportOrder, design);
    return normalizedName && normalizedName !== "Job item"
      ? normalizedName
      : (item.itemName || item.designNo || billOrderDesignCode(order) || "");
  }

  function billExcelItemColour(item = {}, order = {}, lot = {}, bill = {}) {
    return String(
      item.color
      || item.colour
      || item.jobColor
      || order.color
      || order.colour
      || order.jobColor
      || bill.itemColor
      || bill.color
      || bill.colour
      || bill.jobColor
      || lot.color
      || lot.colour
      || lot.jobColor
      || ""
    ).trim();
  }

  function billExcelRows(lot = {}, bill = {}) {
    return (bill.items || []).map((item) => {
      const order = findById("orders", item.orderId) || {};
      const fine = billItemFineBreakup(item);
      const linkedItemCode = order.id ? jobItemSubcategoryLabel(order) : "";
      const itemName = linkedItemCode && linkedItemCode !== "-"
        ? linkedItemCode
        : (item.cmItemType || item.ringType || item.subItem || item.subCategory || item.category || order.category || "");
      return [
        bill.billNo || "", bill.billDate || "", lot.number || "", lot.orderNumber || bill.jobNumber || "", order.customer || bill.customer || "",
        manufacturingOrderTypeLabel(order.customer || ""), item.productionNo || order.productionNo || "", billExcelDesignName(item, order),
        itemName, billItemSizeText(item, order), billExcelItemColour(item, order, lot, bill), item.purity || order.purity || "",
        { value: billNumber(item.finalGw), type: "Number", style: "Weight" }, item.bbNo || "", item.bbType || "",
        { value: billNumber(item.blackBeadsWeight || item.bbWeight), type: "Number", style: "Weight" },
        { value: billNumber(item.motiWeight || item.mmWeight), type: "Number", style: "Weight" },
        { value: billNumber(item.stoneWeight || item.stWeight), type: "Number", style: "Weight" },
        { value: billNumber(item.springWeight), type: "Number", style: "Weight" },
        { value: billNumber(item.otherNonGoldWeight || item.otherWeight), type: "Number", style: "Weight" },
        { value: billNumber(item.reducedWeight), type: "Number", style: "Weight" },
        { value: billNumber(item.netWeight), type: "Number", style: "Weight" },
        { value: factoryWstgPercent(item.wastagePercent ?? item.wstgPercent ?? bill.billWastagePercent ?? 0), type: "Number", style: "Percent" },
        { value: fine.baseFineWeight, type: "Number", style: "Weight" },
        { value: fine.wastageFineWeight, type: "Number", style: "Weight" },
        { value: fine.fineWeight, type: "Number", style: "Weight" },
        item.qcStatus || "", item.officeStatus || item.factoryStatus || "", bill.remarks || item.remarks || "",
      ];
    });
  }

  function savedBillForLot(lot = {}) {
    return lot.bill || (state.bills || []).find((bill) => bill.lotId === lot.id) || null;
  }

  function currentBillExport(lotId = "") {
    const form = document.getElementById("bill-form");
    const dialogOpen = Boolean(document.getElementById("bill-dialog")?.open);
    const formLotId = form?.lotId?.value || "";
    const lot = findById("lots", lotId || formLotId);
    if (!lot) return null;
    const saved = savedBillForLot(lot) || {};
    if (dialogOpen && formLotId === lot.id) {
      return {
        lot,
        bill: {
          ...saved,
          lotId: lot.id,
          billNo: form.billNo.value || saved.billNo || "",
          billDate: form.billDate.value || saved.billDate || "",
          billWastagePercent: factoryWstgPercent(form.elements.billWastagePercent?.value || saved.billWastagePercent || 0),
          remarks: form.remarks.value || "",
          items: billItemRows(saved.items || []),
        },
      };
    }
    return saved?.items?.length ? { lot, bill: saved } : null;
  }

  function excelWorksheet(name, rows = []) {
    return `<Worksheet ss:Name="${excelEscape(String(name || "Bill Details").slice(0, 31))}"><Table>${rows.join("")}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><Selected/></WorksheetOptions></Worksheet>`;
  }

  function downloadExcelWorkbook(fileName, worksheets = []) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10"/></Style><Style ss:ID="Title"><Font ss:Bold="1" ss:Size="14"/><Interior ss:Color="#DFF5ED" ss:Pattern="Solid"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#08766A" ss:Pattern="Solid"/><Alignment ss:WrapText="1"/></Style><Style ss:ID="Weight"><NumberFormat ss:Format="0.000"/></Style><Style ss:ID="Percent"><NumberFormat ss:Format="0.00"/></Style><Style ss:ID="Total"><Font ss:Bold="1"/><Interior ss:Color="#FFF1B8" ss:Pattern="Solid"/><NumberFormat ss:Format="0.000"/></Style></Styles>${worksheets.join("")}</Workbook>`;
    const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${String(fileName || "BILL-DETAILS").replace(/[^A-Z0-9_-]+/gi, "-")}.xls`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  }

  function billWorksheetRows(lot = {}, bill = {}) {
    const itemRows = billExcelRows(lot, bill);
    const totals = billTotals(bill.items || []);
    return [
      excelRow(["KHUSHALI JEWELLS MANUFACTURING - BILL DETAILS"], "Title"),
      excelRow(["Bill No", bill.billNo || "", "Bill Date", bill.billDate || "", "Lot", lot.number || "", "Job Card", lot.orderNumber || bill.jobNumber || ""]),
      excelRow(billExcelColumns(), "Header"),
      ...itemRows.map((row) => excelRow(row)),
      excelRow([
        "TOTAL", "", "", "", "", "", "", "", "", "", "", "",
        { value: totals.finalGw, type: "Number", style: "Total" }, "", "",
        { value: totals.bbWeight, type: "Number", style: "Total" },
        { value: totals.motiWeight, type: "Number", style: "Total" },
        { value: totals.stoneWeight, type: "Number", style: "Total" },
        { value: totals.springWeight, type: "Number", style: "Total" },
        { value: totals.otherNonGoldWeight, type: "Number", style: "Total" },
        { value: totals.reducedWeight, type: "Number", style: "Total" },
        { value: totals.netWeight, type: "Number", style: "Total" }, "",
        { value: totals.baseFineWeight, type: "Number", style: "Total" },
        { value: totals.wastageFineWeight, type: "Number", style: "Total" },
        { value: totals.fineWeight, type: "Number", style: "Total" }, "", "", "",
      ]),
    ];
  }

  window.exportBillExcel = function exportBillExcel(lotId = "") {
    const payload = currentBillExport(lotId);
    if (!payload) {
      alert("Generate or open the Bill first, then export Excel.");
      return;
    }
    const name = payload.bill.billNo || payload.lot.orderNumber || payload.lot.number || "BILL-DETAILS";
    downloadExcelWorkbook(`${name}-DETAILS`, [excelWorksheet("Bill Details", billWorksheetRows(payload.lot, payload.bill))]);
  };

  window.exportAllBillsExcel = function exportAllBillsExcel() {
    const bills = (state.lots || []).map((lot) => ({ lot, bill: savedBillForLot(lot) })).filter(({ bill }) => bill?.items?.length);
    if (!bills.length) {
      alert("No generated Bill is available for Excel export.");
      return;
    }
    const rows = [excelRow(billExcelColumns(), "Header")];
    bills.forEach(({ lot, bill }) => billExcelRows(lot, bill).forEach((row) => rows.push(excelRow(row))));
    downloadExcelWorkbook(`ALL-BILL-DETAILS-${isoToday()}`, [excelWorksheet("All Bill Details", rows)]);
  };

  const multiBillExcelSelection = new Set();

  function generatedBillExcelEntries() {
    return (state.lots || [])
      .map((lot) => ({ lot, bill: savedBillForLot(lot) }))
      .filter(({ bill }) => bill?.items?.length)
      .sort((left, right) => String(right.bill.billNo || "").localeCompare(String(left.bill.billNo || ""), undefined, { numeric: true }));
  }

  function multiBillExcelEntryKey(entry = {}) {
    return String(entry.bill?.id || entry.lot?.id || "");
  }

  function multiBillExcelCustomers(lot = {}, bill = {}) {
    const names = [...new Set((bill.items || []).map((item) => {
      const order = findById("orders", item.orderId) || {};
      return order.customer || item.customer || "";
    }).filter(Boolean))];
    return names.join(", ") || bill.customer || lot.customer || "-";
  }

  function multiBillExcelSearchText(entry = {}) {
    const { lot = {}, bill = {} } = entry;
    const itemReferences = (bill.items || []).flatMap((item) => [item.productionNo, item.designNo, item.category]).filter(Boolean);
    return [bill.billNo, bill.billDate, lot.number, lot.orderNumber, multiBillExcelCustomers(lot, bill), ...itemReferences]
      .join(" ")
      .toLowerCase();
  }

  function visibleMultiBillExcelEntries() {
    const query = String(document.getElementById("multi-bill-excel-search")?.value || "").trim().toLowerCase();
    const entries = generatedBillExcelEntries();
    return query ? entries.filter((entry) => multiBillExcelSearchText(entry).includes(query)) : entries;
  }

  function selectedMultiBillExcelEntries() {
    return generatedBillExcelEntries().filter((entry) => multiBillExcelSelection.has(multiBillExcelEntryKey(entry)));
  }

  function renderMultiBillExcelDialog() {
    const list = document.getElementById("multi-bill-excel-list");
    const summary = document.getElementById("multi-bill-excel-summary");
    const footer = document.getElementById("multi-bill-excel-footer");
    const exportButton = document.getElementById("export-selected-bills-excel");
    if (!list || !summary || !footer || !exportButton) return;
    const allEntries = generatedBillExcelEntries();
    const validKeys = new Set(allEntries.map(multiBillExcelEntryKey));
    [...multiBillExcelSelection].forEach((key) => {
      if (!validKeys.has(key)) multiBillExcelSelection.delete(key);
    });
    const visibleEntries = visibleMultiBillExcelEntries();
    list.innerHTML = visibleEntries.length ? visibleEntries.map(({ lot, bill }) => {
      const key = multiBillExcelEntryKey({ lot, bill });
      const totals = billTotals(bill.items || []);
      const customers = multiBillExcelCustomers(lot, bill);
      const selected = multiBillExcelSelection.has(key);
      return `
        <label class="multi-bill-excel-option ${selected ? "selected" : ""}">
          <input type="checkbox" data-multi-bill-excel-key="${excelEscape(key)}" ${selected ? "checked" : ""}>
          <span>
            <strong>${excelEscape(bill.billNo || "Bill Not Numbered")} / ${excelEscape(lot.orderNumber || lot.number || "-")}</strong>
            <small>${excelEscape(customers)} / ${excelEscape(bill.billDate || "-")} / Lot ${excelEscape(lot.number || "-")}</small>
          </span>
          <b>${totals.pieces} item${totals.pieces === 1 ? "" : "s"} / Net ${weight3(totals.netWeight)} g</b>
        </label>
      `;
    }).join("") : '<div class="empty-state">No generated bills match this search.</div>';

    const selectedEntries = selectedMultiBillExcelEntries();
    const selectedItems = selectedEntries.flatMap(({ bill }) => bill.items || []);
    const totals = billTotals(selectedItems);
    summary.innerHTML = `
      <span><small>AVAILABLE BILLS</small><b>${allEntries.length}</b></span>
      <span><small>SELECTED BILLS</small><b>${selectedEntries.length}</b></span>
      <span><small>SELECTED ITEMS</small><b>${totals.pieces}</b></span>
      <span><small>TOTAL GW</small><b>${weight3(totals.finalGw)} g</b></span>
      <span><small>TOTAL NET WT</small><b>${weight3(totals.netWeight)} g</b></span>
    `;
    footer.textContent = selectedEntries.length
      ? `${selectedEntries.length} bill${selectedEntries.length === 1 ? "" : "s"} selected. They will be merged into one Excel file.`
      : "No bills selected.";
    exportButton.disabled = selectedEntries.length === 0;
  }

  function openMultiBillExcelDialog() {
    const dialog = document.getElementById("multi-bill-excel-dialog");
    const search = document.getElementById("multi-bill-excel-search");
    if (!dialog) return;
    if (search) search.value = "";
    renderMultiBillExcelDialog();
    if (!dialog.open) dialog.showModal();
  }

  function closeMultiBillExcelDialog() {
    document.getElementById("multi-bill-excel-dialog")?.close();
  }

  function selectMultiBillExcelEntries(mode = "visible") {
    const entries = mode === "all" ? generatedBillExcelEntries() : visibleMultiBillExcelEntries();
    entries.forEach((entry) => multiBillExcelSelection.add(multiBillExcelEntryKey(entry)));
    renderMultiBillExcelDialog();
  }

  function handleMultiBillExcelSelection(event) {
    const checkbox = event.target.closest?.("[data-multi-bill-excel-key]");
    if (!checkbox) return;
    const key = checkbox.dataset.multiBillExcelKey || "";
    if (checkbox.checked) multiBillExcelSelection.add(key);
    else multiBillExcelSelection.delete(key);
    renderMultiBillExcelDialog();
  }

  function combinedBillSummaryRows(entries = []) {
    const rows = [
      excelRow(["KHUSHALI JEWELLS MANUFACTURING - COMBINED BILL SUMMARY"], "Title"),
      excelRow(["Generated On", new Date().toLocaleString("en-IN"), "Selected Bills", entries.length]),
      excelRow(["Sr.", "Bill No", "Bill Date", "Lot", "Job Card", "Customer", "Items", "GW (g)", "Stone (g)", "BB (g)", "Moti (g)", "Spring (g)", "Other (g)", "Non-Gold (g)", "Net Weight (g)", "Wastage Fine (g)", "Fine Weight (g)"], "Header"),
    ];
    entries.forEach(({ lot, bill }, index) => {
      const totals = billTotals(bill.items || []);
      rows.push(excelRow([
        index + 1, bill.billNo || "", bill.billDate || "", lot.number || "", lot.orderNumber || bill.jobNumber || "", multiBillExcelCustomers(lot, bill),
        { value: totals.pieces, type: "Number" },
        { value: totals.finalGw, type: "Number", style: "Weight" },
        { value: totals.stoneWeight, type: "Number", style: "Weight" },
        { value: totals.bbWeight, type: "Number", style: "Weight" },
        { value: totals.motiWeight, type: "Number", style: "Weight" },
        { value: totals.springWeight, type: "Number", style: "Weight" },
        { value: totals.otherNonGoldWeight, type: "Number", style: "Weight" },
        { value: totals.reducedWeight, type: "Number", style: "Weight" },
        { value: totals.netWeight, type: "Number", style: "Weight" },
        { value: totals.wastageFineWeight, type: "Number", style: "Weight" },
        { value: totals.fineWeight, type: "Number", style: "Weight" },
      ]));
    });
    const grand = billTotals(entries.flatMap(({ bill }) => bill.items || []));
    rows.push(excelRow([
      "GRAND TOTAL", "", "", "", "", "",
      { value: grand.pieces, type: "Number", style: "Total" },
      { value: grand.finalGw, type: "Number", style: "Total" },
      { value: grand.stoneWeight, type: "Number", style: "Total" },
      { value: grand.bbWeight, type: "Number", style: "Total" },
      { value: grand.motiWeight, type: "Number", style: "Total" },
      { value: grand.springWeight, type: "Number", style: "Total" },
      { value: grand.otherNonGoldWeight, type: "Number", style: "Total" },
      { value: grand.reducedWeight, type: "Number", style: "Total" },
      { value: grand.netWeight, type: "Number", style: "Total" },
      { value: grand.wastageFineWeight, type: "Number", style: "Total" },
      { value: grand.fineWeight, type: "Number", style: "Total" },
    ]));
    return rows;
  }

  function combinedBillItemRows(entries = []) {
    const rows = [
      excelRow(["KHUSHALI JEWELLS MANUFACTURING - INDIVIDUAL ITEM DETAILS"], "Title"),
      excelRow(["Generated On", new Date().toLocaleString("en-IN"), "Selected Bills", entries.length]),
      excelRow(["Item Sr.", "Bill Item Sr.", ...billExcelColumns()], "Header"),
    ];
    let itemSerial = 0;
    entries.forEach(({ lot, bill }) => billExcelRows(lot, bill).forEach((row, billItemIndex) => {
      itemSerial += 1;
      rows.push(excelRow([itemSerial, billItemIndex + 1, ...row]));
    }));
    const grand = billTotals(entries.flatMap(({ bill }) => bill.items || []));
    rows.push(excelRow([
      "GRAND TOTAL", "", "", "", "", "", "", "", "", "", "", "", "", "",
      { value: grand.finalGw, type: "Number", style: "Total" }, "", "",
      { value: grand.bbWeight, type: "Number", style: "Total" },
      { value: grand.motiWeight, type: "Number", style: "Total" },
      { value: grand.stoneWeight, type: "Number", style: "Total" },
      { value: grand.springWeight, type: "Number", style: "Total" },
      { value: grand.otherNonGoldWeight, type: "Number", style: "Total" },
      { value: grand.reducedWeight, type: "Number", style: "Total" },
      { value: grand.netWeight, type: "Number", style: "Total" }, "",
      { value: grand.baseFineWeight, type: "Number", style: "Total" },
      { value: grand.wastageFineWeight, type: "Number", style: "Total" },
      { value: grand.fineWeight, type: "Number", style: "Total" }, "", "", "",
    ]));
    return rows;
  }

  function exportSelectedBillsExcel() {
    const entries = selectedMultiBillExcelEntries();
    if (!entries.length) {
      alert("Select at least one generated Bill to combine into Excel.");
      return;
    }
    downloadExcelWorkbook(`COMBINED-${entries.length}-BILLS-INDIVIDUAL-ITEMS-${isoToday()}`, [
      excelWorksheet("Individual Item Details", combinedBillItemRows(entries)),
      excelWorksheet("Bill Summary", combinedBillSummaryRows(entries)),
    ]);
  }

  renderBills = function renderBillsV616() {
    coreRenderBills.call(this);
    document.querySelectorAll("#bill-table tr").forEach((row) => {
      const openButton = row.querySelector('button[onclick^="openBill("]');
      const actions = row.querySelector(".row-actions");
      const lotId = openButton?.getAttribute("onclick")?.match(/openBill\('([^']+)'\)/)?.[1] || "";
      if (!lotId || !actions || actions.querySelector("[data-export-bill-excel]")) return;
      const lot = findById("lots", lotId);
      if (!savedBillForLot(lot || {})) return;
      actions.insertAdjacentHTML("beforeend", `<button type="button" class="ghost-button" data-export-bill-excel="${escapeHtml(lotId)}" onclick="exportBillExcel('${escapeHtml(lotId)}')">Excel</button>`);
    });
  };

  document.getElementById("export-bill-excel")?.addEventListener("click", () => window.exportBillExcel());
  document.getElementById("export-all-bills-excel")?.addEventListener("click", window.exportAllBillsExcel);
  document.getElementById("open-multi-bill-excel")?.addEventListener("click", openMultiBillExcelDialog);
  document.getElementById("close-multi-bill-excel")?.addEventListener("click", closeMultiBillExcelDialog);
  document.getElementById("multi-bill-excel-search")?.addEventListener("input", renderMultiBillExcelDialog);
  document.getElementById("multi-bill-excel-list")?.addEventListener("change", handleMultiBillExcelSelection);
  document.getElementById("multi-bill-excel-select-visible")?.addEventListener("click", () => selectMultiBillExcelEntries("visible"));
  document.getElementById("multi-bill-excel-select-all")?.addEventListener("click", () => selectMultiBillExcelEntries("all"));
  document.getElementById("multi-bill-excel-clear")?.addEventListener("click", () => {
    multiBillExcelSelection.clear();
    renderMultiBillExcelDialog();
  });
  document.getElementById("export-selected-bills-excel")?.addEventListener("click", exportSelectedBillsExcel);
  renderBills();

  window.KJM_SETTING_INTERNAL_BILL_EXCEL_V616 = {
    isInternalSettingSplitLot,
    migrateInternalSettingSplits,
    productionMovementTrace,
    billExcelRows,
    generatedBillExcelEntries,
    combinedBillSummaryRows,
    combinedBillItemRows,
  };

  if (migrateInternalSettingSplits(state)) render();
})();
