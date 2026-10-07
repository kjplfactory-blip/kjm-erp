(function attachFineIntegrityV695(global) {
  "use strict";

  function number(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function weight3(value) {
    return Number(number(value).toFixed(3));
  }

  function positiveWeight(...values) {
    for (const value of values) {
      const parsed = number(value);
      if (parsed > 0.0005) return weight3(parsed);
    }
    return 0;
  }

  function isBillDestination(transfer = {}) {
    return [transfer.toDepartment, transfer.toKarigarName, transfer.toProcess]
      .some((value) => String(value || "").trim().toLowerCase().includes("bill"));
  }

  function completedLotGrossWeight(lot = {}) {
    const transfers = Array.isArray(lot.transfers) ? lot.transfers : [];
    const billTransfer = [...transfers].reverse().find(isBillDestination);
    return positiveWeight(
      lot.finishedGrossWeight,
      billTransfer?.grossReceivedWeight,
      billTransfer?.transferWeight,
      lot.productionStockGrossWeight,
      lot.manualWipGrossWeight,
      lot.finishedWeight,
      lot.productionStockWeight,
    );
  }

  function transferBalanceWeight(transfer = {}) {
    if (transfer.splitAdjustment) return 0;
    return weight3(transfer.departmentBalance);
  }

  function transferIdentity(transfer = {}) {
    return String(transfer.id || transfer.directTransferId || transfer.returnId || "").trim();
  }

  function manualSettingSourceAllocations(issue = {}, state = {}) {
    const issueId = String(issue.id || "");
    if (!issueId) return [];
    const returns = Array.isArray(state.safeDepartmentReturns) ? state.safeDepartmentReturns : [];
    const explicitAllocations = Array.isArray(issue.manualWipAllocations) ? issue.manualWipAllocations : [];
    const returnedTransferIds = new Set(
      returns
        .filter((entry) => String(entry.issueId || "") === issueId)
        .flatMap((entry) => [entry.directTransferId, entry.receiptGroupId, entry.id])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    );
    const allocatedSettingIds = new Set(
      explicitAllocations
        .flatMap((entry) => [entry.settingEntryId, entry.sourceSettingEntryId])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    );
    const allocations = [];
    (state.settingManagerEntries || []).forEach((entry) => {
      if (entry?.entryType !== "Manual" || String(entry.sourceIssueId || "") !== issueId) return;
      if (allocatedSettingIds.has(String(entry.id || ""))) return;
      const transfers = Array.isArray(entry.departmentTransfers) ? entry.departmentTransfers : [];
      const uncoveredTransfers = transfers.filter((transfer) => {
        const ids = [transferIdentity(transfer), transfer.destinationIssueId, transfer.returnId]
          .map((value) => String(value || "").trim())
          .filter(Boolean);
        return !ids.some((id) => returnedTransferIds.has(id));
      });
      if (uncoveredTransfers.length) {
        uncoveredTransfers.forEach((transfer) => {
          const grossWeight = positiveWeight(transfer.grossWeight);
          if (grossWeight <= 0.0005) return;
          const waxStoneWeight = weight3(Math.max(number(transfer.waxStoneWeight), 0));
          const nonGoldWeight = weight3(Math.max(number(transfer.nonGoldWeight), 0));
          allocations.push({
            settingEntryId: entry.id || "",
            transferId: transferIdentity(transfer),
            grossWeight,
            sourceWaxStoneWeight: waxStoneWeight,
            sourceNonGoldWeight: nonGoldWeight,
            sourceNonGoldBreakdown: nonGoldWeight > 0 ? { stone: nonGoldWeight } : {},
            sourceNetWeight: positiveWeight(transfer.netWeight, grossWeight - waxStoneWeight - nonGoldWeight),
            implicitIntegrityAllocation: true,
          });
        });
        return;
      }
      const hasTransferMarker = Boolean(entry.lastTransferredAt || entry.lastTransferDepartmentId || entry.lastTransferDepartmentName);
      const sourceAlreadyReturned = returns.some((returnEntry) => String(returnEntry.issueId || "") === issueId);
      if (!hasTransferMarker || sourceAlreadyReturned) return;
      const grossWeight = positiveWeight(entry.receiveGw);
      if (grossWeight <= 0.0005) return;
      const waxStoneWeight = weight3(Math.max(number(entry.receiveWaxStoneWeight), 0));
      const nonGoldWeight = weight3(Math.max(number(entry.handStoneWeight ?? entry.sourceHandStoneAddedWeight), 0));
      allocations.push({
        settingEntryId: entry.id || "",
        transferId: "legacy-transfer-marker",
        grossWeight,
        sourceWaxStoneWeight: waxStoneWeight,
        sourceNonGoldWeight: nonGoldWeight,
        sourceNonGoldBreakdown: nonGoldWeight > 0 ? { stone: nonGoldWeight } : {},
        sourceNetWeight: positiveWeight(entry.receiveNetWeight, grossWeight - waxStoneWeight - nonGoldWeight),
        implicitIntegrityAllocation: true,
      });
    });
    return allocations;
  }

  global.KJMFineIntegrityV695 = Object.freeze({
    completedLotGrossWeight,
    isBillDestination,
    manualSettingSourceAllocations,
    transferBalanceWeight,
    weight3,
  });
})(typeof window !== "undefined" ? window : globalThis);
