(function installFittingAccessoryQuantityV620() {
  "use strict";

  const MAX_QUANTITY = 500;

  function quantity(value, fallback = 1) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, MAX_QUANTITY);
  }

  function rowWeight(row = {}) {
    const savedTotal = Number(row.totalWeight || 0);
    if (Number.isFinite(savedTotal) && savedTotal > 0) return savedTotal;
    const calculated = Number(row.weightPerPc || 0) * Number(row.pcs || 0);
    return Number.isFinite(calculated) && calculated > 0 ? calculated : 0;
  }

  function scaleRow(row = {}, requestedQuantity = 1) {
    const fittingQuantity = quantity(requestedQuantity);
    const pcs = Number(row.pcs || 0) * fittingQuantity;
    const totalWeight = rowWeight(row) * fittingQuantity;
    return {
      ...row,
      pcs,
      totalWeight: totalWeight > 0 ? Number(totalWeight.toFixed(5)) : "",
      fittingAccessoryQuantity: fittingQuantity,
    };
  }

  function totals(rows = [], requestedQuantity = 1) {
    return rows.reduce((total, row) => {
      const scaled = scaleRow(row, requestedQuantity);
      total.pcs += Number(scaled.pcs || 0);
      total.weight += Number(scaled.totalWeight || 0);
      return total;
    }, { pcs: 0, weight: 0 });
  }

  window.KJM_FITTING_ACCESSORY_QUANTITY_V620 = {
    MAX_QUANTITY,
    quantity,
    rowWeight,
    scaleRow,
    totals,
  };
})();
