(function attachCentralNonGoldShelfV688(global) {
  "use strict";

  const SETTING_TEXT = "setting";

  function number(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function weight3(value) {
    return Number(number(value).toFixed(3));
  }

  function isSettingDepartment(value = "") {
    return String(value || "").trim().toLowerCase().includes(SETTING_TEXT);
  }

  function departmentBalance(input = {}) {
    const issueGw = number(input.issueGw ?? input.transferWeight);
    const receiveGw = number(input.receiveGw ?? input.grossReceivedWeight);
    const handStone = Math.max(number(input.handStoneWeight ?? input.stoneWeight), 0);
    if (input.splitAdjustment) {
      return {
        mode: "split-adjustment",
        setting: false,
        issueGw: weight3(issueGw),
        receiveGw: weight3(receiveGw),
        handStone: 0,
        receiveNet: weight3(receiveGw),
        balance: 0,
      };
    }
    const setting = isSettingDepartment(input.fromDepartment || input.department || input.fromKarigarName);
    const receiveNet = setting ? weight3(receiveGw - handStone) : receiveGw;
    return {
      mode: setting ? "setting-net-receive" : "gross-weight",
      setting,
      issueGw: weight3(issueGw),
      receiveGw: weight3(receiveGw),
      handStone: weight3(setting ? handStone : 0),
      receiveNet: weight3(receiveNet),
      balance: weight3(issueGw - receiveNet),
    };
  }

  function centralShelfRows(rows = []) {
    const grouped = new Map();
    (rows || []).forEach((row) => {
      const purity = String(row.purity || "18K").trim() || "18K";
      const key = purity.toUpperCase();
      const current = grouped.get(key) || { purity, weight: 0, byMaterial: {} };
      const materialType = String(row.materialType || "other").trim() || "other";
      const weight = Math.max(number(row.totalFactory ?? row.weight), 0);
      current.weight = weight3(current.weight + weight);
      current.byMaterial[materialType] = weight3(number(current.byMaterial[materialType]) + weight);
      grouped.set(key, current);
    });
    return [...grouped.values()].filter((row) => row.weight > 0.0005);
  }

  function reconcileTransferBalances(state = {}, options = {}) {
    const changedAt = options.changedAt || new Date().toISOString();
    const rows = [];
    (state.lots || []).forEach((lot) => {
      (lot.transfers || []).forEach((transfer) => {
        const calculation = departmentBalance({
          fromDepartment: transfer.fromDepartment || transfer.balanceDepartment || transfer.fromKarigarName,
          issueGw: transfer.transferWeight,
          receiveGw: transfer.grossReceivedWeight ?? transfer.receivedWeight,
          handStoneWeight: transfer.handStoneWeight ?? transfer.stoneWeight,
          splitAdjustment: Boolean(transfer.splitAdjustment),
        });
        const previous = number(transfer.departmentBalance);
        const alreadyCurrent = transfer.departmentBalanceMode === calculation.mode
          && Math.abs(previous - calculation.balance) <= 0.0005;
        if (alreadyCurrent) return;
        transfer.departmentBalance = calculation.balance;
        transfer.departmentBalanceMode = calculation.mode;
        transfer.receiveNetForBalance = calculation.receiveNet;
        transfer.balanceReconciledAt = changedAt;
        transfer.balanceReconciledVersion = options.version || "v688";
        rows.push({
          lotId: lot.id || "",
          lotNumber: lot.number || "",
          jobNumber: lot.orderNumber || "",
          transferId: transfer.id || "",
          department: transfer.fromDepartment || transfer.balanceDepartment || transfer.fromKarigarName || "",
          issueGw: calculation.issueGw,
          receiveGw: calculation.receiveGw,
          handStone: calculation.handStone,
          previousBalance: weight3(previous),
          balance: calculation.balance,
          mode: calculation.mode,
        });
      });
    });
    return {
      count: rows.length,
      rows,
      balanceDelta: weight3(rows.reduce((total, row) => total + row.balance - row.previousBalance, 0)),
    };
  }

  global.KJMCentralNonGoldShelfV688 = Object.freeze({
    centralShelfRows,
    departmentBalance,
    isSettingDepartment,
    reconcileTransferBalances,
    weight3,
  });
})(typeof window !== "undefined" ? window : globalThis);
