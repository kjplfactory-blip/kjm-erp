(function installCombinedPackingListPdfV775() {
  "use strict";

  const PAGE_WIDTH = 841.89;
  const PAGE_HEIGHT = 595.28;
  const PAGE_MARGIN = 28;
  const PAGE_BOTTOM = 28;
  const CONTENT_WIDTH = PAGE_WIDTH - (PAGE_MARGIN * 2);

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
    context.page.drawText(value, {
      x,
      y,
      size,
      font,
      color: options.color || context.colors.ink,
    });
  }

  function drawPdfCell(context, value, x, y, width, height, options = {}) {
    context.page.drawRectangle({
      x,
      y: y - height,
      width,
      height,
      borderWidth: 0.55,
      borderColor: context.colors.line,
      color: options.fill,
    });
    drawPdfText(context, value, x + 3, y - height + ((height - (options.size || 6)) / 2), {
      bold: options.bold,
      size: options.size || 6,
      color: options.color,
      maxWidth: Math.max(width - 6, 4),
    });
  }

  function drawPdfTableHeader(context, columns) {
    const height = 16;
    let x = PAGE_MARGIN;
    columns.forEach((column) => {
      drawPdfCell(context, column.label, x, context.y, column.width, height, {
        bold: true,
        size: 5.5,
        fill: context.colors.headerFill,
        color: context.colors.blue,
      });
      x += column.width;
    });
    context.y -= height;
  }

  function drawPdfTableRow(context, columns, values, options = {}) {
    const height = options.height || 15;
    let x = PAGE_MARGIN;
    columns.forEach((column, index) => {
      drawPdfCell(context, values[index] ?? "-", x, context.y, column.width, height, {
        bold: options.bold,
        size: options.size || 5.8,
        fill: options.fill,
        color: options.color,
      });
      x += column.width;
    });
    context.y -= height;
  }

  function drawPdfSectionTitle(context, title) {
    context.page.drawRectangle({
      x: PAGE_MARGIN,
      y: context.y - 17,
      width: CONTENT_WIDTH,
      height: 17,
      color: context.colors.sectionFill,
      borderWidth: 0.55,
      borderColor: context.colors.line,
    });
    drawPdfText(context, title, PAGE_MARGIN + 5, context.y - 12, {
      bold: true,
      size: 8,
      color: context.colors.blue,
      maxWidth: CONTENT_WIDTH - 10,
    });
    context.y -= 20;
  }

  function selectedBillCustomer(items = [], bill = {}, lot = {}) {
    const names = [...new Set(items.map((item) => item.customer).filter(Boolean))];
    return names.join(", ") || bill.customer || lot.customer || "-";
  }

  function addPackingPdfPage(context, entry, continued = false) {
    const { lot = {}, bill = {} } = entry;
    context.page = context.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    context.pages.push(context.page);
    context.page.drawRectangle({
      x: PAGE_MARGIN,
      y: PAGE_HEIGHT - PAGE_MARGIN - 38,
      width: CONTENT_WIDTH,
      height: 38,
      borderWidth: 1,
      borderColor: context.colors.blue,
      color: context.colors.titleFill,
    });
    drawPdfText(context, "KHUSHALI JEWELLS MANUFACTURING", PAGE_MARGIN + 7, PAGE_HEIGHT - PAGE_MARGIN - 16, {
      bold: true,
      size: 13,
      color: context.colors.blue,
      maxWidth: 330,
    });
    drawPdfText(context, continued ? "PACKING LIST - CONTINUED" : "COMBINED PACKING LIST", PAGE_MARGIN + 7, PAGE_HEIGHT - PAGE_MARGIN - 30, {
      bold: true,
      size: 8,
      maxWidth: 330,
    });
    const rightX = PAGE_WIDTH - PAGE_MARGIN - 360;
    drawPdfText(context, `BILL: ${bill.billNo || "-"}`, rightX, PAGE_HEIGHT - PAGE_MARGIN - 14, { bold: true, size: 7.5, maxWidth: 115 });
    drawPdfText(context, `DATE: ${bill.billDate || "-"}`, rightX + 120, PAGE_HEIGHT - PAGE_MARGIN - 14, { bold: true, size: 7.5, maxWidth: 115 });
    drawPdfText(context, `JOB: ${lot.orderNumber || bill.jobNumber || "-"}`, rightX + 240, PAGE_HEIGHT - PAGE_MARGIN - 14, { bold: true, size: 7.5, maxWidth: 115 });
    drawPdfText(context, `LOT: ${lot.number || "-"}`, rightX, PAGE_HEIGHT - PAGE_MARGIN - 29, { size: 7, maxWidth: 115 });
    drawPdfText(context, `SELECTED BILL ${context.billIndex + 1} OF ${context.billCount}`, rightX + 120, PAGE_HEIGHT - PAGE_MARGIN - 29, { size: 7, maxWidth: 235 });
    context.y = PAGE_HEIGHT - PAGE_MARGIN - 48;
  }

  function ensurePackingPdfSpace(context, entry, requiredHeight, repeatHeader = null) {
    if (context.y - requiredHeight >= PAGE_BOTTOM) return;
    addPackingPdfPage(context, entry, true);
    if (typeof repeatHeader === "function") repeatHeader();
  }

  function renderPackingPdfItems(context, entry, items) {
    const columns = [
      { label: "#", width: 18 },
      { label: "PR NO", width: 58 },
      { label: "CUSTOMER", width: 66 },
      { label: "CAT", width: 32 },
      { label: "DESIGN", width: 54 },
      { label: "SIZE", width: 30 },
      { label: "PURITY", width: 30 },
      { label: "GW", width: 43 },
      { label: "BB", width: 36 },
      { label: "MOTI", width: 36 },
      { label: "MOP", width: 34 },
      { label: "SW ST", width: 40 },
      { label: "CLR ST", width: 40 },
      { label: "ST WT", width: 40 },
      { label: "SPRING", width: 38 },
      { label: "OTHER", width: 38 },
      { label: "NON-GOLD", width: 45 },
      { label: "NW", width: 43 },
    ];
    const repeatHeader = () => {
      drawPdfSectionTitle(context, "ITEM DETAILS");
      drawPdfTableHeader(context, columns);
    };
    repeatHeader();
    if (!items.length) {
      drawPdfTableRow(context, columns, ["-", "No printable QC OK items"], { size: 6 });
      return;
    }
    items.forEach((item, index) => {
      ensurePackingPdfSpace(context, entry, 16, repeatHeader);
      drawPdfTableRow(context, columns, [
        index + 1,
        item.productionNo || "-",
        item.customer || "-",
        item.category || "-",
        item.design || item.itemName || "-",
        item.size || "-",
        item.purity || "-",
        pdfWeight(item.finalGw),
        pdfWeight(item.blackBeadsWeight),
        pdfWeight(item.motiWeight),
        pdfWeight(item.mopWeight),
        pdfWeight(item.swStoneWeight),
        pdfWeight(item.colourStoneWeight),
        pdfWeight(item.stoneWeight),
        pdfWeight(item.springWeight),
        pdfWeight(item.otherNonGoldWeight),
        pdfWeight(item.reducedWeight),
        pdfWeight(item.netWeight),
      ]);
    });
  }

  function renderPackingPdfStones(context, entry, items) {
    const columns = [
      { label: "PR NO", width: 75 },
      { label: "DESIGN", width: 110 },
      { label: "GROUP", width: 90 },
      { label: "TYPE", width: 120 },
      { label: "SHAPE", width: 85 },
      { label: "SIZE", width: 90 },
      { label: "PCS", width: 55 },
      { label: "TOTAL WT", width: 80 },
    ];
    const repeatHeader = () => {
      drawPdfSectionTitle(context, "STONE DETAILS BY ITEM");
      drawPdfTableHeader(context, columns);
    };
    ensurePackingPdfSpace(context, entry, 40, repeatHeader);
    if (context.y < PAGE_HEIGHT - PAGE_MARGIN - 90) {
      drawPdfSectionTitle(context, "STONE DETAILS BY ITEM");
      drawPdfTableHeader(context, columns);
    }
    items.forEach((item) => {
      const rows = Array.isArray(item.stoneDetailRows) ? item.stoneDetailRows : [];
      if (!rows.length) {
        ensurePackingPdfSpace(context, entry, 16, repeatHeader);
        drawPdfTableRow(context, columns, [item.productionNo || "-", item.design || item.itemName || "-", "-", "No stone details", "-", "-", "-", "0.000"]);
      } else {
        rows.forEach((row) => {
          ensurePackingPdfSpace(context, entry, 16, repeatHeader);
          drawPdfTableRow(context, columns, [
            item.productionNo || "-",
            item.design || item.itemName || "-",
            row.stoneGroup || "Stone",
            row.stoneType || "Stone",
            row.shape || "-",
            row.size || "-",
            Number(row.pcs || 0) || "-",
            pdfWeight(row.totalWeight),
          ]);
        });
      }
      const totalPieces = Number(item.billStonePieceCount || rows.reduce((total, row) => total + Number(row.pcs || 0), 0));
      ensurePackingPdfSpace(context, entry, 16, repeatHeader);
      drawPdfTableRow(context, columns, [
        item.productionNo || "-",
        "ITEM TOTAL",
        `SW ${pdfWeight(item.swStoneWeight)}`,
        `CLR ${pdfWeight(item.colourStoneWeight)}`,
        "-",
        "-",
        totalPieces,
        pdfWeight(item.stoneWeight),
      ], { bold: true, fill: context.colors.totalFill, color: context.colors.blue });
    });
  }

  function renderPackingPdfBill(context, entry) {
    const { lot = {}, bill = {} } = entry;
    const orders = billPrintOrders(lot, bill);
    const items = billPrintItems(lot, bill, orders);
    const totals = billTotals(items);
    addPackingPdfPage(context, entry, false);
    drawPdfText(context, `CUSTOMER: ${selectedBillCustomer(items, bill, lot)}`, PAGE_MARGIN, context.y, {
      bold: true,
      size: 8,
      maxWidth: CONTENT_WIDTH,
    });
    context.y -= 14;
    drawPdfText(context,
      `ITEMS ${totals.pieces}   GW ${pdfWeight(totals.finalGw)} g   SW ST ${pdfWeight(totals.swStoneWeight)} g   CLR ST ${pdfWeight(totals.colourStoneWeight)} g   TOTAL ST ${pdfWeight(totals.stoneWeight)} g   BB ${pdfWeight(totals.bbWeight)} g   MOTI ${pdfWeight(totals.motiWeight)} g   MOP ${pdfWeight(totals.mopWeight)} g   SPRING ${pdfWeight(totals.springWeight)} g   OTHER ${pdfWeight(totals.otherNonGoldWeight)} g   NW ${pdfWeight(totals.netWeight)} g`,
      PAGE_MARGIN,
      context.y,
      { size: 6.6, maxWidth: CONTENT_WIDTH },
    );
    context.y -= 15;
    renderPackingPdfItems(context, entry, items);
    context.y -= 10;
    renderPackingPdfStones(context, entry, items);
    if (bill.remarks) {
      ensurePackingPdfSpace(context, entry, 30);
      context.y -= 8;
      drawPdfText(context, `REMARKS: ${bill.remarks}`, PAGE_MARGIN, context.y, { bold: true, size: 7, maxWidth: CONTENT_WIDTH });
      context.y -= 15;
    }
  }

  async function buildCombinedPackingListPdf(entries = []) {
    if (!globalThis.PDFLib?.PDFDocument) throw new Error("PDF component is not loaded");
    const { PDFDocument, StandardFonts, rgb } = globalThis.PDFLib;
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const context = {
      pdf,
      regular,
      bold,
      page: null,
      pages: [],
      y: 0,
      billIndex: 0,
      billCount: entries.length,
      colors: {
        ink: rgb(0.07, 0.12, 0.18),
        blue: rgb(0.02, 0.35, 0.58),
        line: rgb(0.65, 0.75, 0.82),
        titleFill: rgb(0.92, 0.97, 1),
        headerFill: rgb(0.85, 0.94, 0.98),
        sectionFill: rgb(0.94, 0.98, 1),
        totalFill: rgb(0.9, 0.96, 1),
      },
    };
    entries.forEach((entry, index) => {
      context.billIndex = index;
      renderPackingPdfBill(context, entry);
    });
    context.pages.forEach((page, index) => {
      page.drawText(`COMBINED PACKING LIST  |  PAGE ${index + 1} OF ${context.pages.length}`, {
        x: PAGE_MARGIN,
        y: 12,
        size: 6.5,
        font: regular,
        color: context.colors.blue,
      });
    });
    pdf.setTitle("Khushali Jewells Combined Packing List");
    pdf.setAuthor("Khushali Jewells Manufacturing ERP");
    pdf.setCreator("Khushali Jewells ERP v775");
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

  window.KJM_COMBINED_PACKING_PDF_V775 = {
    buildCombinedPackingListPdf,
    combinedPackingPdfFileName,
    downloadCombinedPackingListPdf,
  };
})();
