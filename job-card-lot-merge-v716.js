(() => {
  "use strict";

  function uniqueLots(lots = []) {
    return [...new Map((lots || []).filter((lot) => lot?.id).map((lot) => [lot.id, lot])).values()];
  }

  function liveLotsForOrders(orders = []) {
    const orderIds = new Set((orders || []).map((order) => order?.id).filter(Boolean));
    if (!orderIds.size) return [];
    return uniqueLots((state.lots || []).filter((lot) => (
      !lot.mergedIntoLotId
      && lot.status !== "Merged"
      && lot.status !== "Completed"
      && !lot.manualResetHistoricalAt
      && !lot.inventoryResetArchivedAt
      && getLotOrderIds(lot).some((orderId) => orderIds.has(orderId))
    )));
  }

  function lotDepartment(lot = {}) {
    return mergedProductionDepartmentName(
      lot.currentDepartment || lot.karigarName || "",
      lot.karigarName || lot.currentDepartment || "",
    ) || "Production";
  }

  function lotDepartmentKey(lot = {}) {
    return departmentTextKey(lotDepartment(lot));
  }

  function lotPurityKey(lot = {}) {
    const linkedPurity = getLotOrders(lot).map((order) => order.purity).find(Boolean) || "";
    return karatPurityKey(lot.metalPurity || linkedPurity) || String(lot.metalPurity || linkedPurity).trim().toUpperCase();
  }

  function hasMergeHistory(orders = [], lots = []) {
    return (orders || []).some((order) => (
      order.lastJobCardMergeAt
      || (order.mergedFromJobNumbers || []).length
      || (order.mergedJobNumbers || []).length
      || order.jobCardMergeWeightMode
    )) || (lots || []).some((lot) => (
      lot.jobCardMergedAt
      || (lot.mergedFromJobNumbers || []).length
      || lot.jobCardWeightMergeUpdatedAt
    ));
  }

  function consolidationBlockReason(lots = [], allowedOrderIds = new Set()) {
    if (lots.length < 2) return "";
    const foreignItems = lots.flatMap((lot) => getLotOrderIds(lot).filter((orderId) => !allowedOrderIds.has(orderId)));
    if (foreignItems.length) {
      return "A production lot also contains PR items from another Job Card. Split that physical lot first.";
    }
    const departments = [...new Set(lots.map(lotDepartmentKey).filter(Boolean))];
    if (departments.length > 1) {
      const details = lots.map((lot) => `${lot.number || "Lot"}: ${lotDepartment(lot)}`).join(" / ");
      return `The production lots are in different departments (${details}). Bring them to one department before merging.`;
    }
    const purities = [...new Set(lots.map(lotPurityKey).filter(Boolean))];
    if (purities.length > 1) {
      return "The production lots have different karat purities and cannot be combined into one lot.";
    }
    const billed = lots.find((lot) => billForLotRecord(lot));
    if (billed) return `${billed.number || "A production lot"} is already linked to a Bill and cannot be physically consolidated.`;
    const pendingSetter = lots.find((lot) => settingLotHasPendingSetter(lot));
    if (pendingSetter) return `${pendingSetter.number || "A Setting lot"} is still with a setter. Receive it before merging the Job Cards.`;
    return "";
  }

  function plan(orders = [], targetJobNumber = "", options = {}) {
    const linkedOrders = (orders || []).filter((order) => order?.id);
    const allowedOrderIds = new Set(linkedOrders.map((order) => order.id));
    const lots = liveLotsForOrders(linkedOrders);
    const preferredOrderIds = options.preferredOrderIds instanceof Set
      ? options.preferredOrderIds
      : new Set(options.preferredOrderIds || []);
    const sortedLots = [...lots].sort((left, right) => {
      const leftPreferred = getLotOrderIds(left).some((orderId) => preferredOrderIds.has(orderId)) ? 0 : 1;
      const rightPreferred = getLotOrderIds(right).some((orderId) => preferredOrderIds.has(orderId)) ? 0 : 1;
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
      return String(left.createdAt || left.issueDate || "").localeCompare(String(right.createdAt || right.issueDate || ""));
    });
    const blockedReason = consolidationBlockReason(sortedLots, allowedOrderIds);
    const grossWeight = Number(weight3(sortedLots.reduce((total, lot) => total + Number(currentTransferIssueWeight(lot) || 0), 0)));
    return {
      orders: linkedOrders,
      allowedOrderIds,
      lots: sortedLots,
      targetLot: sortedLots[0] || null,
      targetJobNumber,
      grossWeight,
      blockedReason,
      previouslyMerged: hasMergeHistory(linkedOrders, sortedLots),
      canConsolidate: sortedLots.length > 1 && !blockedReason,
    };
  }

  function relinkCurrentLotRecords(sourceLot = {}, targetLot = {}, targetJobNumber = "", mergedAt = "") {
    const relink = (record = {}) => {
      let changed = false;
      if (record.lotId === sourceLot.id) {
        record.mergedFromLotId = record.mergedFromLotId || sourceLot.id;
        record.mergedFromLotNumber = record.mergedFromLotNumber || sourceLot.number || "";
        record.lotId = targetLot.id;
        if (Object.prototype.hasOwnProperty.call(record, "lotNumber")) record.lotNumber = targetLot.number || record.lotNumber || "";
        changed = true;
      }
      if (record.productionLotId === sourceLot.id) {
        record.mergedFromProductionLotId = record.mergedFromProductionLotId || sourceLot.id;
        record.productionLotId = targetLot.id;
        changed = true;
      }
      if (!changed) return false;
      if (Object.prototype.hasOwnProperty.call(record, "jobNumber")) record.jobNumber = targetJobNumber || record.jobNumber || "";
      if (Object.prototype.hasOwnProperty.call(record, "orderNumber")) record.orderNumber = targetJobNumber || record.orderNumber || "";
      record.productionLotConsolidatedAt = mergedAt;
      return true;
    };
    let updated = 0;
    [
      state.settingManagerEntries,
      state.productionNonGoldIssues,
      state.safeDepartmentIssues,
      state.safeDepartmentReturns,
      state.safeItems,
    ].forEach((records) => (records || []).forEach((record) => {
      if (relink(record)) updated += 1;
    }));
    return updated;
  }

  function currentPlanSnapshot(lots = []) {
    const breakdown = lots.reduce(
      (combined, lot) => addNonGoldBreakdowns(combined, currentTransferProvisionalNonGoldBreakdown(lot)),
      {},
    );
    return {
      grossWeight: Number(weight3(lots.reduce((total, lot) => total + Number(currentTransferIssueWeight(lot) || 0), 0))),
      grossIssuedWeight: Number(weight3(lots.reduce((total, lot) => total + Number(lot.grossIssuedWeight || currentTransferIssueWeight(lot) || 0), 0))),
      issuedWeight: Number(weight3(lots.reduce((total, lot) => total + Number(lot.issuedWeight || 0), 0))),
      waxStoneWeight: Number(weight3(lots.reduce((total, lot) => total + Number(transferWaxStoneWeight(lot) || 0), 0))),
      handStoneWeight: Number(weight3(lots.reduce((total, lot) => total + Number(currentHandStoneWeight(lot) || 0), 0))),
      provisionalNonGoldWeight: Number(weight3(lots.reduce((total, lot) => total + Number(currentTransferProvisionalNonGold(lot) || 0), 0))),
      provisionalNonGoldBreakdown: normalizeNonGoldControlBreakdown(breakdown),
      issueOtherNonGoldWeight: Number(weight3(lots.reduce((total, lot) => total + Number(lot.issueOtherNonGoldWeight || 0), 0))),
    };
  }

  function consolidate(inputPlan = {}, targetJobNumber = "", mergedAt = new Date().toISOString(), reason = "Job Card merge") {
    const lots = uniqueLots((inputPlan.lots || []).filter((lot) => !lot.mergedIntoLotId && lot.status !== "Merged" && lot.status !== "Completed"));
    if (lots.length < 2) return { ok: true, count: 0, targetLot: lots[0] || inputPlan.targetLot || null, sourceLots: [], relinkedRecords: 0 };
    const allowedOrderIds = inputPlan.allowedOrderIds instanceof Set
      ? inputPlan.allowedOrderIds
      : new Set((inputPlan.orders || []).map((order) => order.id).filter(Boolean));
    const blockedReason = consolidationBlockReason(lots, allowedOrderIds);
    if (blockedReason) return { ok: false, count: 0, blockedReason, targetLot: null, sourceLots: [] };
    const targetLot = lots.find((lot) => lot.id === inputPlan.targetLot?.id) || lots[0];
    const sourceLots = lots.filter((lot) => lot.id !== targetLot.id);
    const snapshot = currentPlanSnapshot(lots);
    const combinedOrderIds = [...new Set(lots.flatMap((lot) => getLotOrderIds(lot)).filter(Boolean))];
    const embeddedSources = lots.flatMap((lot) => lot.embeddedNonGoldSources || []);
    const historyRows = sourceLots.map((sourceLot) => ({
      id: crypto.randomUUID(),
      date: today(),
      createdAt: mergedAt,
      sourceLotId: sourceLot.id,
      sourceLotNumber: sourceLot.number || "",
      sourceOrderIds: getLotOrderIds(sourceLot),
      sourceDepartment: lotDepartment(sourceLot),
      grossWeight: Number(weight3(currentTransferIssueWeight(sourceLot))),
      waxStoneWeight: Number(weight3(transferWaxStoneWeight(sourceLot))),
      handStoneWeight: Number(weight3(currentHandStoneWeight(sourceLot))),
      reason,
    }));

    targetLot.orderIds = combinedOrderIds;
    targetLot.orderId = combinedOrderIds[0] || targetLot.orderId || "";
    targetLot.orderNumber = targetJobNumber || targetLot.orderNumber || "";
    targetLot.grossIssuedWeight = snapshot.grossIssuedWeight;
    targetLot.issuedWeight = snapshot.issuedWeight;
    targetLot.waxStoneWeight = snapshot.waxStoneWeight;
    targetLot.physicalWaxStoneWeight = snapshot.waxStoneWeight;
    targetLot.initialHandStoneWeight = snapshot.handStoneWeight;
    targetLot.manualHandStoneWeight = snapshot.handStoneWeight;
    if (lots.some((lot) => Object.prototype.hasOwnProperty.call(lot, "settingHandStoneWeightOverride"))) {
      targetLot.settingHandStoneWeightOverride = snapshot.handStoneWeight;
    }
    targetLot.issueOtherNonGoldWeight = snapshot.issueOtherNonGoldWeight;
    targetLot.settingMergedCurrentGw = snapshot.grossWeight;
    targetLot.settingMergedHandStoneWeight = snapshot.handStoneWeight;
    targetLot.settingMergedProvisionalNonGoldWeight = snapshot.provisionalNonGoldWeight;
    targetLot.settingMergedProvisionalNonGoldBreakdown = snapshot.provisionalNonGoldBreakdown;
    targetLot.settingMergedBaseTransferCount = (targetLot.transfers || []).length;
    targetLot.settingMergedCurrentAt = mergedAt;
    targetLot.jobCardWeightOwner = targetJobNumber || targetLot.jobCardWeightOwner || "";
    targetLot.jobCardWeightMergeMode = "add";
    targetLot.jobCardWeightMergeUpdatedAt = mergedAt;
    targetLot.jobCardMergedAt = mergedAt;
    targetLot.productionLotConsolidatedAt = mergedAt;
    targetLot.productionLotConsolidatedReason = reason;
    targetLot.mergedFromLotIds = [...new Set([...(targetLot.mergedFromLotIds || []), ...sourceLots.map((lot) => lot.id)])];
    targetLot.mergedFromLotNumbers = [...new Set([...(targetLot.mergedFromLotNumbers || []), ...sourceLots.map((lot) => lot.number).filter(Boolean)])];
    targetLot.mergedJobCardLotHistory = [...(targetLot.mergedJobCardLotHistory || []), ...historyRows];
    targetLot.embeddedNonGoldSources = [...new Map(embeddedSources.map((entry) => [
      entry.id || `${entry.sourceType || "embedded"}:${entry.sourceId || ""}:${entry.orderId || ""}:${entry.materialType || "other"}`,
      entry,
    ])).values()];

    let relinkedRecords = 0;
    sourceLots.forEach((sourceLot) => {
      relinkedRecords += relinkCurrentLotRecords(sourceLot, targetLot, targetJobNumber, mergedAt);
      sourceLot.embeddedNonGoldSources = [];
      sourceLot.status = "Merged";
      sourceLot.mergedIntoLotId = targetLot.id;
      sourceLot.mergedIntoLotNumber = targetLot.number || "";
      sourceLot.productionLotConsolidatedAt = mergedAt;
      sourceLot.productionLotConsolidatedReason = reason;
      sourceLot.productionLotConsolidatedJobNumber = targetJobNumber;
      sourceLot.productionLotConsolidatedBy = currentUser?.name || currentUser?.id || "ERP User";
      sourceLot.jobCardWeightOwner = targetJobNumber || sourceLot.jobCardWeightOwner || "";
      sourceLot.jobCardWeightMergeMode = "add";
    });

    return {
      ok: true,
      count: sourceLots.length,
      targetLot,
      sourceLots,
      relinkedRecords,
      ...snapshot,
    };
  }

  function lotSummary(inputPlan = {}) {
    const numbers = (inputPlan.lots || []).map((lot) => lot.number || lot.id).filter(Boolean);
    return `${numbers.length} live lots (${numbers.join(", ")}) / Combined GW ${gram(inputPlan.grossWeight || 0)}`;
  }

  function mergedJobGroups() {
    const groups = new Map();
    (state.orders || []).forEach((order) => {
      const jobNumber = String(order?.jobNumber || order?.productionNo || order?.number || "").trim();
      if (!jobNumber || !order?.id) return;
      if (!groups.has(jobNumber)) groups.set(jobNumber, []);
      groups.get(jobNumber).push(order);
    });
    return [...groups.entries()]
      .map(([jobNumber, orders]) => ({
        jobNumber,
        orders,
        lots: liveLotsForOrders(orders),
      }))
      .filter((group) => group.lots.length > 1 && hasMergeHistory(group.orders, group.lots));
  }

  function repairAllOldMerges(options = {}) {
    const checkedAt = options.checkedAt || new Date().toISOString();
    const result = {
      checkedAt,
      repairedJobs: [],
      blockedJobs: [],
      consolidatedLots: 0,
      relinkedRecords: 0,
      upgraded: !state.jobCardLotMergeRepairV716At,
    };

    mergedJobGroups().forEach(({ jobNumber, orders }) => {
      const repairPlan = plan(orders, jobNumber, {
        preferredOrderIds: new Set(orders.map((order) => order.id)),
      });
      if (repairPlan.blockedReason) {
        result.blockedJobs.push({
          jobNumber,
          lotNumbers: repairPlan.lots.map((lot) => lot.number || lot.id).filter(Boolean),
          reason: repairPlan.blockedReason,
        });
        return;
      }
      const repaired = consolidate(
        repairPlan,
        jobNumber,
        checkedAt,
        `App v716 repair of production lots left separate by an earlier Job Card merge`,
      );
      if (!repaired.ok || !repaired.count) {
        if (!repaired.ok) {
          result.blockedJobs.push({
            jobNumber,
            lotNumbers: repairPlan.lots.map((lot) => lot.number || lot.id).filter(Boolean),
            reason: repaired.blockedReason || "The live lots could not be safely consolidated.",
          });
        }
        return;
      }
      result.consolidatedLots += repaired.count;
      result.relinkedRecords += repaired.relinkedRecords || 0;
      result.repairedJobs.push({
        jobNumber,
        keptLotId: repaired.targetLot?.id || "",
        keptLotNumber: repaired.targetLot?.number || "",
        mergedLotIds: repaired.sourceLots.map((lot) => lot.id),
        mergedLotNumbers: repaired.sourceLots.map((lot) => lot.number || lot.id).filter(Boolean),
        grossWeight: repaired.grossWeight || 0,
        waxStoneWeight: repaired.waxStoneWeight || 0,
        handStoneWeight: repaired.handStoneWeight || 0,
        provisionalNonGoldWeight: repaired.provisionalNonGoldWeight || 0,
      });
    });

    state.jobCardLotMergeRepairV716At = checkedAt;
    state.jobCardLotMergeRepairV716 = {
      version: "v716",
      checkedAt,
      repairedJobs: result.repairedJobs,
      blockedJobs: result.blockedJobs,
      consolidatedLots: result.consolidatedLots,
      relinkedRecords: result.relinkedRecords,
    };
    if (result.repairedJobs.length) {
      state.ledger = state.ledger || [];
      state.ledger.unshift({
        id: crypto.randomUUID(),
        date: today(),
        createdAt: checkedAt,
        type: "Old Merged Job Production Lot Repair",
        purity: "-",
        weight: 0,
        repairedJobs: result.repairedJobs.map((entry) => entry.jobNumber),
        productionLotsConsolidated: result.consolidatedLots,
        productionLotRecordsRelinked: result.relinkedRecords,
        blockedJobs: result.blockedJobs,
        reference: `${result.repairedJobs.length} previously merged Job Card(s) repaired; ${result.consolidatedLots} extra live lot(s) consolidated into their surviving production lots. GW, stone, non-gold, PR items and histories were preserved without a stock movement.${result.blockedJobs.length ? ` ${result.blockedJobs.length} exceptional Job Card(s) require manual review.` : ""}`,
      });
    }
    return result;
  }

  window.KJM_JOB_CARD_LOT_MERGE_V716 = {
    version: "v716",
    plan,
    consolidate,
    lotSummary,
    repairAllOldMerges,
  };
})();
