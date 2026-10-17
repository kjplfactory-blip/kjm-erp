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
    return { value: safeValue ?? "", style, type: safeType };
  }

  function excelRow(values = [], style = "") {
    return values.map((value) => {
      if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
        return excelCell(value.value, value.style || style, value.type || "String");
      }
      return excelCell(value, style);
    });
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
    return {
      name: String(name || "Bill Details").replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31) || "Bill Details",
      rows: Array.isArray(rows) ? rows : [],
    };
  }

  function excelColumnName(index = 0) {
    let value = Number(index) + 1;
    let name = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name || "A";
  }

  function excelStyleIndex(style = "") {
    return { Title: 1, Header: 2, Weight: 3, Percent: 4, Total: 5 }[style] || 0;
  }

  function excelXlsxCellXml(cell = {}, rowNumber = 1, columnIndex = 0) {
    const reference = `${excelColumnName(columnIndex)}${rowNumber}`;
    const style = excelStyleIndex(cell.style);
    const styleAttribute = style ? ` s="${style}"` : "";
    if (cell.type === "Number" && Number.isFinite(Number(cell.value))) {
      return `<c r="${reference}"${styleAttribute}><v>${Number(cell.value)}</v></c>`;
    }
    return `<c r="${reference}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${excelEscape(cell.value)}</t></is></c>`;
  }

  function excelXlsxColumnWidths(rows = []) {
    const columnCount = rows.reduce((largest, row) => Math.max(largest, Array.isArray(row) ? row.length : 0), 0);
    if (!columnCount) return "";
    const widths = Array.from({ length: columnCount }, (_, columnIndex) => {
      const longest = rows.reduce((length, row) => {
        const value = row?.[columnIndex]?.value ?? "";
        return Math.max(length, String(value).length);
      }, 0);
      return Math.min(42, Math.max(10, longest + 2));
    });
    return `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>`;
  }

  function excelXlsxWorksheetXml(worksheet = {}) {
    const rows = Array.isArray(worksheet.rows) ? worksheet.rows : [];
    const sheetRows = rows.map((row, rowIndex) => {
      const cells = (Array.isArray(row) ? row : []).map((cell, columnIndex) => (
        excelXlsxCellXml(cell, rowIndex + 1, columnIndex)
      )).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${excelXlsxColumnWidths(rows)}<sheetData>${sheetRows}</sheetData><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/></worksheet>`;
  }

  function excelXlsxStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.000"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Arial"/><family val="2"/></font><font><b/><sz val="14"/><name val="Arial"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/><family val="2"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCEFFD"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF176D9C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1B8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD8E1E8"/></left><right style="thin"><color rgb="FFD8E1E8"/></right><top style="thin"><color rgb="FFD8E1E8"/></top><bottom style="thin"><color rgb="FFD8E1E8"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="164" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }

  function excelUniqueWorksheets(worksheets = []) {
    const usedNames = new Set();
    return worksheets.map((worksheet, index) => {
      const source = worksheet && typeof worksheet === "object" ? worksheet : excelWorksheet(`Sheet ${index + 1}`, []);
      const baseName = String(source.name || `Sheet ${index + 1}`).slice(0, 31) || `Sheet ${index + 1}`;
      let name = baseName;
      let suffix = 2;
      while (usedNames.has(name.toUpperCase())) {
        const marker = ` ${suffix}`;
        name = `${baseName.slice(0, 31 - marker.length)}${marker}`;
        suffix += 1;
      }
      usedNames.add(name.toUpperCase());
      return { ...source, name };
    });
  }

  let excelZipCrcTable = null;

  function excelZipCrc32(bytes = new Uint8Array()) {
    if (!excelZipCrcTable) {
      excelZipCrcTable = new Uint32Array(256);
      for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
        excelZipCrcTable[index] = value >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    bytes.forEach((byte) => { crc = excelZipCrcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8); });
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function excelZipDosTimestamp(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | Math.floor(date.getSeconds() / 2),
      date: (((year - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F),
    };
  }

  function excelXlsxZipBlob(files = [], mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const encoder = new TextEncoder();
    const timestamp = excelZipDosTimestamp();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    let centralSize = 0;
    files.forEach(([fileName, content]) => {
      const nameBytes = encoder.encode(String(fileName || ""));
      const dataBytes = content instanceof Uint8Array ? content : encoder.encode(String(content ?? ""));
      const crc = excelZipCrc32(dataBytes);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034B50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, timestamp.time, true);
      localView.setUint16(12, timestamp.date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, dataBytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);
      localParts.push(localHeader, dataBytes);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014B50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, timestamp.time, true);
      centralView.setUint16(14, timestamp.date, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, dataBytes.length, true);
      centralView.setUint32(24, dataBytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, localOffset, true);
      centralHeader.set(nameBytes, 46);
      centralParts.push(centralHeader);
      centralSize += centralHeader.length;
      localOffset += localHeader.length + dataBytes.length;
    });
    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);
    endView.setUint32(0, 0x06054B50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, localOffset, true);
    endView.setUint16(20, 0, true);
    return new Blob([...localParts, ...centralParts, endRecord], { type: mimeType });
  }

  async function downloadExcelWorkbook(fileName, worksheets = []) {
    try {
      const sheets = excelUniqueWorksheets(worksheets);
      if (!sheets.length) sheets.push(excelWorksheet("Bill Details", []));
      const files = [];
      const sheetOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
      files.push(["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`]);
      files.push(["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`]);
      files.push(["docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Khushali Jewells Manufacturing ERP</Application></Properties>`]);
      const createdAt = new Date().toISOString();
      files.push(["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Khushali Jewells Manufacturing ERP</dc:creator><cp:lastModifiedBy>Khushali Jewells Manufacturing ERP</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`]);
      const sheetNodes = sheets.map((sheet, index) => `<sheet name="${excelEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
      files.push(["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheetNodes}</sheets></workbook>`]);
      const sheetRelations = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
      files.push(["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRelations}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
      files.push(["xl/styles.xml", excelXlsxStylesXml()]);
      sheets.forEach((sheet, index) => files.push([`xl/worksheets/sheet${index + 1}.xml`, excelXlsxWorksheetXml(sheet)]));
      const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const blob = excelXlsxZipBlob(files, mimeType);
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      const safeFileName = String(fileName || "BILL-DETAILS")
        .replace(/[^A-Z0-9_.-]+/gi, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "");
      anchor.download = `${safeFileName || "BILL-DETAILS"}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
      return true;
    } catch (error) {
      console.error("Excel workbook export failed", error);
      alert(`The Excel .xlsx file could not be created. ${error?.message || "Please refresh and try again."}`);
      return false;
    }
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

  function combinedBillExcelBillNumber(value = "") {
    const text = String(value || "").trim();
    return text.replace(/^BILL[\s/_-]*/i, "") || "UNNUMBERED";
  }

  function combinedBillExcelFileWeight(value = 0) {
    return String(Number(Number(value || 0).toFixed(3)));
  }

  function combinedBillExcelFileName(entries = []) {
    const billNumbers = entries.map(({ lot, bill }) => (
      combinedBillExcelBillNumber(bill.billNo || lot.orderNumber || lot.number || "")
    ));
    const totals = billTotals(entries.flatMap(({ bill }) => bill.items || []));
    return `BILL-${billNumbers.join("-")}-GW-${combinedBillExcelFileWeight(totals.finalGw)}-NON-GOLD-${combinedBillExcelFileWeight(totals.reducedWeight)}-NW-${combinedBillExcelFileWeight(totals.netWeight)}`;
  }

  function exportSelectedBillsExcel() {
    const entries = selectedMultiBillExcelEntries();
    if (!entries.length) {
      alert("Select at least one generated Bill to combine into Excel.");
      return;
    }
    downloadExcelWorkbook(combinedBillExcelFileName(entries), [
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
