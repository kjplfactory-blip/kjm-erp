(function attachKjmLedgerRepair(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KJMLedgerRepairV687 = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createKjmLedgerRepair() {
  const tolerance = 0.0005;

  function number(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function weight3(value) {
    return Number(number(value).toFixed(3));
  }

  function recordTime(record = {}) {
    const parsed = Date.parse(record.createdAt || record.updatedAt || record.date || record.issueDate || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function lotSourceIds(lot = {}) {
    return new Set([
      lot.castingSafeItemId,
      ...(Array.isArray(lot.issueSafeItemsBefore) ? lot.issueSafeItemsBefore.map((item) => item?.id) : []),
    ].filter(Boolean).map(String));
  }

  function matchingLotForChild(child = {}, sourceId = "", lots = []) {
    const reference = String(child.sourceId || "");
    const candidates = lots.filter((lot) => {
      if (String(lot.id || "") !== reference && String(lot.number || "") !== reference) return false;
      return lotSourceIds(lot).has(String(sourceId));
    });
    if (!candidates.length) return null;
    const childTime = recordTime(child);
    return candidates.slice().sort((left, right) => {
      const leftDistance = Math.abs(recordTime(left) - childTime);
      const rightDistance = Math.abs(recordTime(right) - childTime);
      return leftDistance - rightDistance || recordTime(left) - recordTime(right);
    })[0];
  }

  function lotMovementWeight(lot = {}, child = {}, sourceId = "") {
    const sources = lotSourceIds(lot);
    const onlyThisSource = sources.size === 1 && sources.has(String(sourceId));
    const lotGross = number(lot.grossIssuedWeight || lot.issueGrossWeight);
    if (onlyThisSource && lotGross > tolerance) return weight3(lotGross);
    return weight3(child.grossWeight || child.initialGrossWeight || child.netWeight);
  }

  function directDepartmentMovementWeight(state = {}, sourceId = "") {
    return weight3((state.safeDepartmentIssues || [])
      .filter((issue) => {
        if (String(issue.safeItemId || "") !== String(sourceId)) return false;
        if (issue.goldIssueLotId || issue.lotId) return false;
        const mode = String(issue.destinationMode || "department").trim().toLowerCase();
        return mode === "department";
      })
      .reduce((total, issue) => total + number(issue.issuedGrossWeight || issue.grossWeight || issue.netWeight), 0));
  }

  function factoryIssueMovement(state = {}, sourceId = "") {
    const lots = state.lots || [];
    const children = (state.safeItems || []).filter((item) =>
      item.sourceType === "factory-issue"
      && String(item.sourceSafeItemId || "") === String(sourceId)
    );
    const matched = new Map();
    const unmatched = [];
    children.forEach((child) => {
      const lot = matchingLotForChild(child, sourceId, lots);
      if (!lot) {
        unmatched.push(child);
        return;
      }
      const key = `${sourceId}|${lot.id}`;
      const movement = lotMovementWeight(lot, child, sourceId);
      const current = matched.get(key);
      if (!current || movement > current.weight) {
        matched.set(key, {
          lotId: lot.id,
          lotNumber: lot.number || "",
          jobNumber: lot.orderNumber || lot.jobNumber || "",
          weight: movement,
        });
      }
    });
    const matchedWeight = [...matched.values()].reduce((total, line) => total + number(line.weight), 0);
    const unmatchedWeight = unmatched.reduce((total, child) => total + number(child.grossWeight || child.initialGrossWeight || child.netWeight), 0);
    return {
      weight: weight3(matchedWeight + unmatchedWeight),
      lots: [...matched.values()],
      unmatchedChildIds: unmatched.map((item) => item.id).filter(Boolean),
      childCount: children.length,
    };
  }

  function applyExpectedBalance(item = {}, expectedGross = 0, metadata = {}) {
    const currentGross = number(item.grossWeight || item.netWeight);
    const remainingGross = weight3(Math.max(expectedGross, 0));
    const ratio = currentGross > tolerance ? Math.min(remainingGross / currentGross, 1) : 0;
    const currentWax = number(item.waxStoneWeight);
    const currentBreakdown = item.nonGoldBreakdown && typeof item.nonGoldBreakdown === "object"
      ? item.nonGoldBreakdown
      : {};
    const nextBreakdown = {};
    Object.entries(currentBreakdown).forEach(([key, value]) => {
      const remaining = weight3(number(value) * ratio);
      if (remaining > tolerance) nextBreakdown[key] = remaining;
    });
    const remainingNonGold = weight3(Object.values(nextBreakdown).reduce((total, value) => total + number(value), 0));
    const remainingWax = weight3(currentWax * ratio);
    item.grossWeight = remainingGross;
    item.waxStoneWeight = remainingWax;
    item.nonGoldBreakdown = nextBreakdown;
    item.nonGoldWeight = remainingNonGold;
    item.netWeight = weight3(Math.max(remainingGross - remainingWax - remainingNonGold, 0));
    item.status = remainingGross <= tolerance ? "Out" : (item.status === "Out" ? "In Safe" : item.status || "In Safe");
    if (remainingGross <= tolerance) item.outDate = item.outDate || metadata.date || "";
    else item.outDate = "";
    item.updatedAt = metadata.correctedAt || new Date().toISOString();
    item.movementLedgerReconciledAt = metadata.correctedAt || item.updatedAt;
    item.movementLedgerReconciledVersion = metadata.version || "v687";
    item.movementLedgerPreviousGrossWeight = weight3(currentGross);
    item.movementLedgerExpectedGrossWeight = remainingGross;
    item.movementLedgerDirectIssueWeight = weight3(metadata.directIssueWeight);
    item.movementLedgerGoldIssueWeight = weight3(metadata.goldIssueWeight);
  }

  function reconcileSafeSourceBalances(state = {}, options = {}) {
    const correctedAt = options.correctedAt || new Date().toISOString();
    const version = options.version || "v687";
    const rows = [];
    (state.safeItems || []).forEach((item) => {
      if (!item?.id || item.sourceType === "factory-issue" || item.nonGoldShelfEntry) return;
      const initialGross = number(item.initialGrossWeight);
      if (initialGross <= tolerance) return;
      const factoryMovement = factoryIssueMovement(state, item.id);
      if (!factoryMovement.childCount) return;
      const directIssueWeight = directDepartmentMovementWeight(state, item.id);
      const expectedGross = weight3(Math.max(initialGross - directIssueWeight - factoryMovement.weight, 0));
      const currentGross = weight3(item.grossWeight || item.netWeight);
      if (currentGross <= expectedGross + tolerance) return;
      const row = {
        safeItemId: item.id,
        description: item.description || item.source || item.id,
        purity: item.desiredPurity || item.purity || item.locker || "",
        initialGrossWeight: weight3(initialGross),
        currentGrossWeight: currentGross,
        directIssueWeight,
        goldIssueWeight: factoryMovement.weight,
        expectedGrossWeight: expectedGross,
        correctionWeight: weight3(currentGross - expectedGross),
        lots: factoryMovement.lots,
        unmatchedChildIds: factoryMovement.unmatchedChildIds,
      };
      rows.push(row);
      if (options.apply !== false) {
        applyExpectedBalance(item, expectedGross, {
          correctedAt,
          version,
          date: options.date || "",
          directIssueWeight,
          goldIssueWeight: factoryMovement.weight,
        });
      }
    });
    return {
      count: rows.length,
      correctedAt,
      grossCorrection: weight3(rows.reduce((total, row) => total + row.correctionWeight, 0)),
      rows,
    };
  }

  return {
    reconcileSafeSourceBalances,
    matchingLotForChild,
    lotMovementWeight,
  };
});
