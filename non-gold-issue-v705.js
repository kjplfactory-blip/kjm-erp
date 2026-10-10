(function attachNonGoldIssueV705(root) {
  "use strict";

  const number = (value) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const weight3 = (value) => Number(number(value).toFixed(3));

  const textKey = (value) => String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const purityKey = (value) => {
    const text = String(value || "").trim().toUpperCase();
    if (/\b22\s*K\b/.test(text)) return "22K";
    if (/\b18\s*K\b/.test(text)) return "18K";
    if (/\b14\s*K\b/.test(text)) return "14K";
    if (/\b9\s*K\b/.test(text)) return "9K";
    const numeric = Number(text.match(/\d+(?:\.\d+)?/)?.[0] || NaN);
    if (numeric >= 90 && numeric <= 92.5) return "22K";
    if (numeric >= 74 && numeric <= 76) return "18K";
    if (numeric >= 57 && numeric <= 60) return "14K";
    if (numeric >= 36 && numeric <= 39.5) return "9K";
    return text.replace(/\s+/g, "") || "18K";
  };

  function itemBreakdown(item = {}) {
    const result = {};
    Object.entries(item.nonGoldBreakdown || {}).forEach(([key, value]) => {
      const normalizedKey = textKey(key || "other") || "other";
      const componentWeight = weight3(Math.max(number(value), 0));
      if (componentWeight > 0) result[normalizedKey] = componentWeight;
    });
    if (!Object.keys(result).length) {
      const materialType = textKey(item.nonGoldCategory || item.materialType || "other") || "other";
      const fallbackWeight = weight3(Math.max(number(item.nonGoldWeight ?? item.grossWeight), 0));
      if (fallbackWeight > 0) result[materialType] = fallbackWeight;
    }
    return result;
  }

  function isAvailableNonGoldItem(item = {}) {
    const kind = textKey(item.safeKind || item.kind || "");
    return String(item.status || "").toLowerCase() !== "out"
      && (kind === "non-gold" || kind === "nongold")
      && number(item.grossWeight ?? item.nonGoldWeight) > 0.0005;
  }

  function candidateRows(items = [], options = {}) {
    const materialType = textKey(options.materialType || "other") || "other";
    const destinationPurity = purityKey(options.destinationPurity || "18K");
    const preferredItemId = String(options.preferredItemId || "");
    return (items || [])
      .filter(isAvailableNonGoldItem)
      .map((item) => {
        const breakdown = itemBreakdown(item);
        return {
          item,
          itemId: String(item.id || ""),
          materialType,
          availableWeight: weight3(Math.min(
            number(breakdown[materialType] || 0),
            number(item.grossWeight ?? item.nonGoldWeight),
          )),
          sourcePurity: purityKey(item.locker || item.purity || "18K"),
          destinationPurity,
          preferred: preferredItemId && String(item.id || "") === preferredItemId,
          createdAt: String(item.createdAt || item.date || ""),
        };
      })
      .filter((row) => row.itemId && row.availableWeight > 0.0005)
      .sort((left, right) => {
        if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
        const leftExact = left.sourcePurity === destinationPurity;
        const rightExact = right.sourcePurity === destinationPurity;
        if (leftExact !== rightExact) return leftExact ? -1 : 1;
        const dateOrder = left.createdAt.localeCompare(right.createdAt);
        return dateOrder || left.itemId.localeCompare(right.itemId);
      });
  }

  function planShelfIssue(items = [], options = {}) {
    const requestedWeight = weight3(Math.max(number(options.weight), 0));
    const rows = candidateRows(items, options);
    const totalAvailable = weight3(rows.reduce((total, row) => total + row.availableWeight, 0));
    const destinationPurity = purityKey(options.destinationPurity || "18K");
    const exactPurityAvailable = weight3(rows
      .filter((row) => row.sourcePurity === destinationPurity)
      .reduce((total, row) => total + row.availableWeight, 0));
    let remaining = requestedWeight;
    const allocations = [];
    rows.forEach((row) => {
      if (remaining <= 0.0005) return;
      const take = weight3(Math.min(row.availableWeight, remaining));
      if (take <= 0) return;
      allocations.push({
        itemId: row.itemId,
        weight: take,
        materialType: row.materialType,
        sourcePurity: row.sourcePurity,
        destinationPurity,
      });
      remaining = weight3(Math.max(remaining - take, 0));
    });
    return {
      requestedWeight,
      totalAvailable,
      exactPurityAvailable,
      allocations,
      remaining: weight3(remaining),
      sufficient: requestedWeight > 0 && remaining <= 0.0005,
    };
  }

  root.KJMNonGoldIssueV705 = Object.freeze({
    candidateRows,
    itemBreakdown,
    planShelfIssue,
    purityKey,
  });
}(globalThis));
