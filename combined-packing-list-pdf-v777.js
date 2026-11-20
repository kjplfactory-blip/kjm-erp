(function installCombinedPackingListPdfV777() {
  "use strict";

  const PAGE_WIDTH = 841.89;
  const PAGE_HEIGHT = 595.28;
  const PAGE_MARGIN = 28;
  const PAGE_BOTTOM = 26;
  const CONTENT_WIDTH = PAGE_WIDTH - (PAGE_MARGIN * 2);
  const CARD_GAP = 7;
  const CARD_WIDTH = (CONTENT_WIDTH - CARD_GAP) / 2;
  let pdfLibLoadPromise = null;

  function loadPdfScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve(src);
      script.onerror = () => {
        script.remove();
        reject(new Error(`Could not load ${src}`));
      };
      document.head.appendChild(script);
    });
  }

  async function ensurePdfLib() {
    if (globalThis.PDFLib?.PDFDocument) return globalThis.PDFLib;
    if (!pdfLibLoadPromise) {
      pdfLibLoadPromise = (async () => {
        const sources = [
          "pdf-lib.min.js?v=777",
          "vendor/pdf-lib.min.js?v=775",
        ];
        for (const src of sources) {
          try {
            await loadPdfScript(src);
            if (globalThis.PDFLib?.PDFDocument) return globalThis.PDFLib;
          } catch (error) {
            console.warn("PDF dependency retry failed", src, error);
          }
        }
        throw new Error("PDF component could not be loaded. Upload pdf-lib.min.js with App v777.");
      })().catch((error) => {
        pdfLibLoadPromise = null;
        throw error;
      });
    }
    return pdfLibLoadPromise;
  }

  function pdfSafeText(value = "") {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pdfWeight(value = 0) {
    return Number(value || 0).toFixed(3);
  }

  function fitPdfText(text, font, size, width) {
    const value = pdfSafeText(text) || "-";
    if (font.widthOfTextAtSize(value, size) <= width) return value;
    let result = value;
    while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > width) {
      result = result.slice(0, -1);
    }
    return `${result}...`;
  }

  function drawPdfText(context, text, x, y, options = {}) {
    const font = options.bold ? context.bold : context.regular;
    const size = options.size || 7;
    const value = options.maxWidth
      ? fitPdfText(text, font, size, options.maxWidth)
      : (pdfSafeText(text) || "-");
    let drawX = x;
    if (options.align === "right" && options.maxWidth) {
      drawX = x + options.maxWidth - font.widthOfTextAtSize(value, size);
    }
    context.page.drawText(value, {
      x: drawX,
      y,
      size,
      font,
      color: options.color || context.colors.ink,
    });
  }

  function drawPdfSectionTitle(context, title, x = PAGE_MARGIN, width = CONTENT_WIDTH) {
    const height = 16;
    context.page.drawRectangle({
      x,
      y: context.y - height,
      width,
      height,
      color: context.colors.sectionFill,
      borderWidth: 0.6,
      borderColor: context.colors.line,
    });
    drawPdfText(context, title, x + 5, context.y - 11.5, {
      bold: true,
      size: 7.5,
      color: context.colors.blue,
      maxWidth: width - 10,
    });
    context.y -= height + 3;
  }

  function selectedBillCustomer(items = [], bill = {}, lot = {}) {
    const names = [...new Set(items.map((item) => item.customer).filter(Boolean))];
    return names.join(", ") || bill.customer || lot.customer || "-";
  }

  function addPackingPdfPage(context, entry, continued = false) {
    const { lot = {}, bill = {} } = entry;
    context.page = context.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    context.pages.push(context.page);
    context.pageRefs.push({
      page: context.page,
      billIndex: context.billIndex,
      billNo: bill.billNo || "-",
    });
    context.page.drawRectangle({
      x: PAGE_MARGIN,
      y: PAGE_HEIGHT - PAGE_MARGIN - 38,
      width: CONTENT_WIDTH,
      height: 38,
      borderWidth: 1,
      borderColor: context.colors.blue,
      color: context.colors.titleFill,
    });
    drawPdfText(context, "KHUSHALI JEWELLS MANUFACTURING", PAGE_MARGIN + 7, PAGE_HEIGHT - PAGE_MARGIN - 15, {
      bold: true,
      size: 13,
      color: context.colors.blue,
      maxWidth: 335,
    });
    drawPdfText(context, continued ? "PACKING LIST - CONTINUED" : "PACKING LIST", PAGE_MARGIN + 7, PAGE_HEIGHT - PAGE_MARGIN - 29, {
      bold: true,
      size: 8,
      maxWidth: 335,
    });
    const rightX = PAGE_WIDTH - PAGE_MARGIN - 356;
    drawPdfText(context, `BILL NO  ${bill.billNo || "-"}`, rightX, PAGE_HEIGHT - PAGE_MARGIN - 13, { bold: true, size: 7.2, maxWidth: 112 });
    drawPdfText(context, `BILL DATE  ${bill.billDate || "-"}`, rightX + 118, PAGE_HEIGHT - PAGE_MARGIN - 13, { bold: true, size: 7.2, maxWidth: 112 });
    drawPdfText(context, `JOB CARD  ${lot.orderNumber || bill.jobNumber || "-"}`, rightX + 236, PAGE_HEIGHT - PAGE_MARGIN - 13, { bold: true, size: 7.2, maxWidth: 118 });
    drawPdfText(context, `LOT  ${lot.number || "-"}`, rightX, PAGE_HEIGHT - PAGE_MARGIN - 28, { size: 7, maxWidth: 112 });
    drawPdfText(context, `SELECTED BILL ${context.billIndex + 1} OF ${context.billCount}`, rightX + 118, PAGE_HEIGHT - PAGE_MARGIN - 28, { size: 7, maxWidth: 236 });
    context.y = PAGE_HEIGHT - PAGE_MARGIN - 47;
  }

  function drawFieldGrid(context, fields, columns = 4, rowHeight = 22) {
    const rows = Math.ceil(fields.length / columns);
    const cellWidth = CONTENT_WIDTH / columns;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const field = fields[(row * columns) + column];
        const x = PAGE_MARGIN + (column * cellWidth);
        const top = context.y - (row * rowHeight);
        context.page.drawRectangle({
          x,
          y: top - rowHeight,
          width: cellWidth,
          height: rowHeight,
          borderWidth: 0.5,
          borderColor: context.colors.line,
          color: context.colors.white,
        });
        if (!field) continue;
        drawPdfText(context, field.label, x + 4, top - 7.5, {
          bold: true,
          size: 5.3,
          color: context.colors.muted,
          maxWidth: cellWidth - 8,
        });
        drawPdfText(context, field.value, x + 4, top - 17, {
          bold: Boolean(field.highlight),
          size: field.highlight ? 8.3 : 7,
          color: field.highlight ? context.colors.blue : context.colors.ink,
          maxWidth: cellWidth - 8,
        });
      }
    }
    context.y -= rows * rowHeight;
  }

  function packingCustomerFields(orders = [], items = [], bill = {}, lot = {}) {
    const customerIds = [...new Set(orders.map((order) => order.customerId).filter(Boolean))];
    const customers = customerIds.map((id) => findById("customers", id)).filter(Boolean);
    const customer = customers[0] || {};
    const name = selectedBillCustomer(items, bill, lot);
    return [
      { label: "NAME", value: name },
      { label: "PHONE", value: customer.phone || "-" },
      { label: "ORDER TYPE", value: manufacturingOrderTypeLabel(name) },
      { label: "OFFICE", value: manufacturingOfficeDestinationLabel(name) },
      { label: "CITY", value: customer.city || "-" },
      { label: "GST", value: customer.gst || "-" },
      { label: "ADDRESS", value: customer.address || "-" },
      { label: "ITEMS", value: String(items.length), highlight: true },
    ];
  }

  function drawPackingPdfIntro(context, entry, orders, items, totals) {
    drawPdfSectionTitle(context, "CUSTOMER DETAILS");
    drawFieldGrid(context, packingCustomerFields(orders, items, entry.bill || {}, entry.lot || {}), 4, 19);
    context.y -= 5;
    drawPdfSectionTitle(context, "TOTAL WEIGHT SUMMARY");
    drawFieldGrid(context, [
      { label: "ITEMS", value: String(totals.pieces), highlight: true },
      { label: "TOTAL GW", value: pdfWeight(totals.finalGw) },
      { label: "BB WT", value: pdfWeight(totals.bbWeight) },
      { label: "MOTI WT", value: pdfWeight(totals.motiWeight) },
      { label: "MOP WT", value: pdfWeight(totals.mopWeight) },
      { label: "SW STONE", value: pdfWeight(totals.swStoneWeight) },
      { label: "COLOUR STONE", value: pdfWeight(totals.colourStoneWeight) },
      { label: "TOTAL STONE", value: pdfWeight(totals.stoneWeight) },
      { label: "SPRING WT", value: pdfWeight(totals.springWeight) },
      { label: "OTHER WT", value: pdfWeight(totals.otherNonGoldWeight) },
      { label: "TOTAL NON-GOLD", value: pdfWeight(totals.reducedWeight) },
      { label: "NET WT", value: pdfWeight(totals.netWeight), highlight: true },
      { label: "WASTAGE FINE", value: pdfWeight(totals.wastageFineWeight) },
      { label: "FINE WT", value: pdfWeight(totals.fineWeight), highlight: true },
    ], 7, 21);
    context.y -= 6;
    if (entry.bill?.remarks) {
      drawPdfSectionTitle(context, "REMARKS");
      context.page.drawRectangle({
        x: PAGE_MARGIN,
        y: context.y - 20,
        width: CONTENT_WIDTH,
        height: 20,
        borderWidth: 0.6,
        borderColor: context.colors.line,
        color: context.colors.white,
      });
      drawPdfText(context, entry.bill.remarks, PAGE_MARGIN + 5, context.y - 13, {
        size: 7,
        maxWidth: CONTENT_WIDTH - 10,
      });
      context.y -= 25;
    }
    drawPdfSectionTitle(context, "ITEM AND STONE DETAILS BY PR");
  }

  function packingCardRows(item = {}) {
    const rows = Array.isArray(item.stoneDetailRows) ? item.stoneDetailRows.filter(Boolean) : [];
    return rows.length ? rows : [{
      stoneGroup: "Stone",
      stoneType: "No stone details saved for this item",
      shape: "-",
      size: "-",
      pcs: 0,
      totalWeight: 0,
    }];
  }

  function packingCardLayout(item, maximumHeight = Infinity) {
    const rows = packingCardRows(item);
    const standardHeight = 105 + (rows.length * 12);
    const scale = Math.min(1, Number.isFinite(maximumHeight) ? maximumHeight / standardHeight : 1);
    return {
      rows,
      scale,
      height: standardHeight * scale,
      padding: 5 * scale,
      headerHeight: 23 * scale,
      metaHeight: 18 * scale,
      stoneHeaderHeight: 13 * scale,
      stoneRowHeight: 12 * scale,
      footerHeight: 21 * scale,
      gap: 4 * scale,
    };
  }

  function drawCardMetaCell(context, x, top, width, height, label, value, scale, highlight = false) {
    context.page.drawRectangle({
      x,
      y: top - height,
      width,
      height,
      borderWidth: 0.35,
      borderColor: context.colors.softLine,
      color: context.colors.white,
    });
    drawPdfText(context, label, x + (3 * scale), top - (6.2 * scale), {
      bold: true,
      size: 4.6 * scale,
      color: context.colors.muted,
      maxWidth: width - (6 * scale),
    });
    drawPdfText(context, value, x + (3 * scale), top - (14.2 * scale), {
      bold: highlight,
      size: (highlight ? 7.2 : 6.2) * scale,
      color: highlight ? context.colors.blue : context.colors.ink,
      maxWidth: width - (6 * scale),
    });
  }

  function drawPackingItemCard(context, item, x, top, layout) {
    const { scale, height, padding, headerHeight, metaHeight, stoneHeaderHeight, stoneRowHeight, footerHeight, gap, rows } = layout;
    context.page.drawRectangle({
      x,
      y: top - height,
      width: CARD_WIDTH,
      height,
      borderWidth: 0.9,
      borderColor: context.colors.cardLine,
      color: context.colors.white,
    });
    let cursor = top - padding;
    const innerX = x + padding;
    const innerWidth = CARD_WIDTH - (padding * 2);

    context.page.drawRectangle({
      x: innerX,
      y: cursor - headerHeight,
      width: innerWidth,
      height: headerHeight,
      color: context.colors.cardHeaderFill,
      borderWidth: 0.45,
      borderColor: context.colors.cardLine,
    });
    drawPdfText(context, item.productionNo || "-", innerX + (5 * scale), cursor - (9 * scale), {
      bold: true,
      size: 8.5 * scale,
      color: context.colors.blue,
      maxWidth: innerWidth * 0.27,
    });
    drawPdfText(context, item.design || item.itemName || "-", innerX + (innerWidth * 0.29), cursor - (9 * scale), {
      bold: true,
      size: 7.5 * scale,
      maxWidth: innerWidth * 0.34,
    });
    drawPdfText(context, `${item.category || "-"} / ${item.size || "-"}`, innerX + (innerWidth * 0.66), cursor - (8 * scale), {
      size: 6.2 * scale,
      align: "right",
      maxWidth: innerWidth * 0.32,
    });
    drawPdfText(context, String(item.diamondType || "american").toLowerCase() === "real" ? "REAL DIAMOND" : "AMERICAN DIAMOND", innerX + (innerWidth * 0.66), cursor - (17 * scale), {
      size: 5.4 * scale,
      color: context.colors.muted,
      align: "right",
      maxWidth: innerWidth * 0.32,
    });
    cursor -= headerHeight;

    const meta = [
      ["CUSTOMER", item.customer || "-"],
      ["PURITY", item.purity || "-"],
      ["COLOUR", item.color || "-"],
      ["GW", pdfWeight(item.finalGw), true],
      ["NET WT", pdfWeight(item.netWeight), true],
      ["NON-GOLD", pdfWeight(item.reducedWeight)],
      ["BB", pdfWeight(item.blackBeadsWeight)],
      ["MOTI", pdfWeight(item.motiWeight)],
      ["MOP", pdfWeight(item.mopWeight)],
      ["SPRING", pdfWeight(item.springWeight)],
      ["OTHER", pdfWeight(item.otherNonGoldWeight)],
      ["TOTAL STONE", pdfWeight(item.stoneWeight), true],
    ];
    const metaColumns = 6;
    const metaWidth = innerWidth / metaColumns;
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < metaColumns; column += 1) {
        const field = meta[(row * metaColumns) + column];
        drawCardMetaCell(
          context,
          innerX + (column * metaWidth),
          cursor - (row * metaHeight),
          metaWidth,
          metaHeight,
          field[0],
          field[1],
          scale,
          Boolean(field[2]),
        );
      }
    }
    cursor -= metaHeight * 2;
    cursor -= gap;

    const columns = [
      { label: "GROUP", ratio: 0.16 },
      { label: "TYPE", ratio: 0.25 },
      { label: "SHAPE", ratio: 0.14 },
      { label: "SIZE", ratio: 0.17 },
      { label: "PCS", ratio: 0.1 },
      { label: "TOTAL WT", ratio: 0.18 },
    ];
    let columnX = innerX;
    columns.forEach((column) => {
      const width = innerWidth * column.ratio;
      context.page.drawRectangle({
        x: columnX,
        y: cursor - stoneHeaderHeight,
        width,
        height: stoneHeaderHeight,
        borderWidth: 0.4,
        borderColor: context.colors.line,
        color: context.colors.headerFill,
      });
      drawPdfText(context, column.label, columnX + (2.5 * scale), cursor - (8.7 * scale), {
        bold: true,
        size: 5.2 * scale,
        color: context.colors.blue,
        maxWidth: width - (5 * scale),
      });
      columnX += width;
    });
    cursor -= stoneHeaderHeight;

    rows.forEach((row, rowIndex) => {
      const values = [
        row.stoneGroup || "Stone",
        row.stoneType || "Stone",
        row.shape || "-",
        row.size || "-",
        Number(row.pcs || 0) || "-",
        pdfWeight(row.totalWeight),
      ];
      let rowX = innerX;
      columns.forEach((column, columnIndex) => {
        const width = innerWidth * column.ratio;
        context.page.drawRectangle({
          x: rowX,
          y: cursor - stoneRowHeight,
          width,
          height: stoneRowHeight,
          borderWidth: 0.35,
          borderColor: context.colors.softLine,
          color: rowIndex % 2 ? context.colors.rowFill : context.colors.white,
        });
        drawPdfText(context, values[columnIndex], rowX + (2.5 * scale), cursor - (8.1 * scale), {
          size: 5.5 * scale,
          maxWidth: width - (5 * scale),
        });
        rowX += width;
      });
      cursor -= stoneRowHeight;
    });
    cursor -= gap;

    const totalPieces = Number(item.billStonePieceCount || rows.reduce((total, row) => total + Number(row.pcs || 0), 0));
    const totals = [
      ["TOTAL PCS", String(totalPieces)],
      ["SW STONE", pdfWeight(item.swStoneWeight)],
      ["COLOUR STONE", pdfWeight(item.colourStoneWeight)],
      ["TOTAL STONE", pdfWeight(item.stoneWeight)],
    ];
    const totalWidth = innerWidth / totals.length;
    totals.forEach((total, index) => {
      const totalX = innerX + (index * totalWidth);
      context.page.drawRectangle({
        x: totalX,
        y: cursor - footerHeight,
        width: totalWidth,
        height: footerHeight,
        borderWidth: 0.4,
        borderColor: context.colors.cardLine,
        color: context.colors.totalFill,
      });
      drawPdfText(context, total[0], totalX + (3 * scale), cursor - (7 * scale), {
        bold: true,
        size: 4.8 * scale,
        color: context.colors.muted,
        maxWidth: totalWidth - (6 * scale),
      });
      drawPdfText(context, total[1], totalX + (3 * scale), cursor - (16 * scale), {
        bold: true,
        size: 7 * scale,
        color: context.colors.ink,
        maxWidth: totalWidth - (6 * scale),
      });
    });
  }

  function addPackingContinuationPage(context, entry) {
    addPackingPdfPage(context, entry, true);
    drawPdfSectionTitle(context, "ITEM AND STONE DETAILS BY PR");
  }

  function renderPackingPdfCards(context, entry, items) {
    if (!items.length) {
      context.page.drawRectangle({
        x: PAGE_MARGIN,
        y: context.y - 28,
        width: CONTENT_WIDTH,
        height: 28,
        borderWidth: 0.8,
        borderColor: context.colors.cardLine,
        color: context.colors.white,
      });
      drawPdfText(context, "NO PRINTABLE QC OK ITEMS", PAGE_MARGIN + 8, context.y - 18, { bold: true, size: 8, color: context.colors.muted });
      context.y -= 34;
      return;
    }

    for (let index = 0; index < items.length; index += 2) {
      const pair = items.slice(index, index + 2);
      let available = context.y - PAGE_BOTTOM;
      let layouts = pair.map((item) => packingCardLayout(item));
      let rowHeight = Math.max(...layouts.map((layout) => layout.height));
      if (rowHeight > available) {
        addPackingContinuationPage(context, entry);
        available = context.y - PAGE_BOTTOM;
      }
      layouts = pair.map((item) => packingCardLayout(item, available));
      rowHeight = Math.max(...layouts.map((layout) => layout.height));
      pair.forEach((item, pairIndex) => {
        const x = PAGE_MARGIN + (pairIndex * (CARD_WIDTH + CARD_GAP));
        drawPackingItemCard(context, item, x, context.y, layouts[pairIndex]);
      });
      context.y -= rowHeight + CARD_GAP;
    }
  }

  function renderPackingPdfBill(context, entry) {
    const { lot = {}, bill = {} } = entry;
    const orders = billPrintOrders(lot, bill);
    const items = billPrintItems(lot, bill, orders);
    const totals = billTotals(items);
    addPackingPdfPage(context, entry, false);
    drawPackingPdfIntro(context, entry, orders, items, totals);
    renderPackingPdfCards(context, entry, items);
  }

  async function buildCombinedPackingListPdf(entries = []) {
    const pdfLib = await ensurePdfLib();
    const { PDFDocument, StandardFonts, rgb } = pdfLib;
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const context = {
      pdf,
      regular,
      bold,
      page: null,
      pages: [],
      pageRefs: [],
      y: 0,
      billIndex: 0,
      billCount: entries.length,
      colors: {
        ink: rgb(0.07, 0.12, 0.18),
        muted: rgb(0.29, 0.34, 0.39),
        blue: rgb(0.02, 0.35, 0.58),
        line: rgb(0.65, 0.75, 0.82),
        softLine: rgb(0.76, 0.84, 0.89),
        cardLine: rgb(0.49, 0.66, 0.84),
        white: rgb(1, 1, 1),
        titleFill: rgb(0.92, 0.97, 1),
        headerFill: rgb(0.85, 0.94, 0.98),
        sectionFill: rgb(0.94, 0.98, 1),
        totalFill: rgb(0.9, 0.96, 1),
        cardHeaderFill: rgb(0.93, 0.97, 1),
        rowFill: rgb(0.98, 0.99, 1),
      },
    };
    entries.forEach((entry, index) => {
      context.billIndex = index;
      renderPackingPdfBill(context, entry);
    });
    context.pageRefs.forEach(({ page, billIndex, billNo }, pageIndex) => {
      page.drawText(`COMBINED PACKING LIST  |  BILL ${billNo}  |  SELECTED ${billIndex + 1} OF ${context.billCount}  |  PAGE ${pageIndex + 1} OF ${context.pages.length}`, {
        x: PAGE_MARGIN,
        y: 11,
        size: 6.2,
        font: regular,
        color: context.colors.blue,
      });
    });
    pdf.setTitle("Khushali Jewells Combined Packing List");
    pdf.setAuthor("Khushali Jewells Manufacturing ERP");
    pdf.setCreator("Khushali Jewells ERP v777");
    return pdf.save();
  }

  function combinedPackingPdfFileName(entries = []) {
    const numbers = entries.map(({ lot = {}, bill = {} }) => String(bill.billNo || lot.orderNumber || lot.number || "BILL")
      .replace(/^BILL[\s/_-]*/i, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-"));
    const joined = numbers.join("-");
    const reference = joined.length <= 100
      ? joined
      : `${numbers.slice(0, 3).join("-")}-TO-${numbers.slice(-2).join("-")}-${numbers.length}-BILLS`;
    return `COMBINED-PACKING-LIST-BILL-${reference || "SELECTED"}.pdf`;
  }

  async function downloadCombinedPackingListPdf(entries = []) {
    const bytes = await buildCombinedPackingListPdf(entries);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = combinedPackingPdfFileName(entries);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { bytes, fileName: link.download };
  }

  window.KJM_COMBINED_PACKING_PDF_V777 = {
    buildCombinedPackingListPdf,
    combinedPackingPdfFileName,
    downloadCombinedPackingListPdf,
    ensurePdfLib,
  };
})();
