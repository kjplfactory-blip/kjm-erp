(function installDepartmentHoldingFixV615() {
  "use strict";

  const coreEvents = departmentTransferEvents;
  const coreSummaries = departmentTransferSummaries;
  const coreSummaryFromEvents = departmentTransferSummaryFromEvents;
  const corePurityRows = departmentTransferPurityRows;

  function splitParentId(lot = {}) {
    return lot.settingSplitFromLotId || lot.splitFromLotId || "";
  }

  function splitRoot(lot = {}) {
    let current = lot;
    const visited = new Set();
    while (current && splitParentId(current) && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = (state.lots || []).find((entry) => entry.id === splitParentId(current));
      if (!parent) break;
      current = parent;
    }
    return current || lot;
  }

  function splitFamily(root = {}) {
    return (state.lots || []).filter((lot) => splitRoot(lot).id === root.id);
  }

  function firstRealTransfer(lot = {}) {
    return (lot.transfers || [])
      .filter((transfer) => !transfer.splitAdjustment)
      .sort((left, right) => transferHistoryTime(left.createdAt, left.date) - transferHistoryTime(right.createdAt, right.date))[0] || null;
  }

  function linkedOriginalSafeIssue(lot = {}) {
    const raw = (state.safeDepartmentIssues || []).find((issue) => (
      (lot.safeDepartmentIssueId && issue.id === lot.safeDepartmentIssueId)
      || issue.goldIssueLotId === lot.id
      || (issue.lotId === lot.id && safeIssueLinksJobCard(issue.destinationMode))
    ));
    if (!raw) return null;
    const item = raw.safeItemId ? findById("safeItems", raw.safeItemId) || {} : {};
    return normalizeSafeDepartmentIssue(raw, item);
  }

  function originalSplitIssue(root = {}) {
    const family = splitFamily(root);
    const firstTransfer = firstRealTransfer(root);
    const safeIssue = linkedOriginalSafeIssue(root);
    let grossWeight = Number(weight3(family.reduce((sum, lot) => sum + Number(lot.grossIssuedWeight || lot.issuedWeight || 0), 0)));
    let netWeight = Number(weight3(family.reduce((sum, lot) => sum + Number(lot.issuedWeight || 0), 0)));

    if (safeIssue && Number(safeIssue.issuedGrossWeight || 0) > 0) {
      grossWeight = Number(weight3(safeIssue.issuedGrossWeight));
      netWeight = Number(weight3(safeIssue.issuedNetWeight));
    }
    if (firstTransfer && Number(firstTransfer.transferWeight || 0) > 0) {
      grossWeight = Number(weight3(firstTransfer.transferWeight));
      const nonGold = Number(weight3(
        Number(firstTransfer.waxStoneWeight || 0)
        + Number(firstTransfer.handStoneWeight ?? firstTransfer.stoneWeight ?? 0)
        + Number(firstTransfer.provisionalNonGoldWeight || 0)
      ));
      netWeight = Number(weight3(Math.max(grossWeight - nonGold, 0)));
    }
    return { grossWeight, netWeight };
  }

  departmentTransferEvents = function departmentTransferEventsV615() {
    const lots = state.lots || [];
    const lotById = new Map(lots.map((lot) => [lot.id, lot]));
    const childIssues = new Set();
    const splitTransfers = new Set();
    const correctedRoots = new Map();

    lots.forEach((lot) => {
      if (splitParentId(lot) && lotById.has(splitParentId(lot))) childIssues.add(`${lot.id}-issue-in`);
      (lot.transfers || []).forEach((transfer) => {
        if (transfer.splitAdjustment && transfer.id) splitTransfers.add(transfer.id);
      });
    });
    lots.forEach((lot) => {
      if (!splitParentId(lot) && splitFamily(lot).length > 1) {
        correctedRoots.set(`${lot.id}-issue-in`, originalSplitIssue(lot));
      }
    });

    return coreEvents.call(this)
      .filter((event) => {
        if (childIssues.has(event.id)) return false;
        return !splitTransfers.has(String(event.id || "").replace(/-in$/, ""));
      })
      .map((event) => {
        const corrected = correctedRoots.get(event.id);
        if (!corrected) return event;
        return {
          ...event,
          issueGw: corrected.grossWeight,
          receiveGw: corrected.grossWeight,
          netWeight: corrected.netWeight,
          remarks: `${event.remarks || "Gold Issue"}; split family counted once: GW ${gram(corrected.grossWeight)} / Net ${gram(corrected.netWeight)}`,
        };
      });
  };

  function holdingParts(events = []) {
    const purityGroups = new Map();
    events.forEach((event) => {
      const purity = transferPurityLabel(event.purity || "");
      const current = purityGroups.get(purity) || { gw: 0, net: 0 };
      const sign = event.direction === "in" ? 1 : -1;
      current.gw = Number(weight3(current.gw + sign * Number(event.receiveGw || 0)));
      current.net = Number(weight3(current.net + sign * Number(event.netWeight || 0)));
      purityGroups.set(purity, current);
    });
    return [...purityGroups.entries()].reduce((totals, [purity, values]) => {
      const nonGold = Number(weight3(Math.max(values.gw - values.net, 0)));
      const net = Number(weight3(values.gw - nonGold));
      return {
        gw: Number(weight3(totals.gw + values.gw)),
        net: Number(weight3(totals.net + net)),
        nonGold: Number(weight3(totals.nonGold + nonGold)),
        fine: Number(weight3(totals.fine + fineGoldWeight(net, purity))),
      };
    }, { gw: 0, net: 0, nonGold: 0, fine: 0 });
  }

  function enrichSummary(summary = {}, events = []) {
    const holding = holdingParts(events);
    const gwDifference = Number(weight3(Number(summary.inGw || 0) - Number(summary.outGw || 0)));
    return {
      ...summary,
      balanceGw: gwDifference,
      issueReceiveDifference: gwDifference,
      gwDifference,
      rawNetWeightDifference: Number(weight3(Number(summary.inNet || 0) - Number(summary.outNet || 0))),
      netWeightDifference: holding.net,
      nonGoldHolding: holding.nonGold,
      fineGoldHolding: holding.fine,
    };
  }

  departmentTransferSummaries = function departmentTransferSummariesV615() {
    const events = departmentTransferEvents();
    const grouped = new Map();
    events.forEach((event) => {
      if (!grouped.has(event.department)) grouped.set(event.department, []);
      grouped.get(event.department).push(event);
    });
    return coreSummaries.call(this).map((summary) => enrichSummary(summary, grouped.get(summary.name) || []));
  };

  departmentTransferSummaryFromEvents = function departmentTransferSummaryFromEventsV615(name, events = []) {
    return enrichSummary(coreSummaryFromEvents.call(this, name, events), events);
  };

  departmentTransferPurityRows = function departmentTransferPurityRowsV615(events = []) {
    const grouped = new Map();
    events.forEach((event) => {
      const purity = transferPurityLabel(event.purity || "");
      if (!grouped.has(purity)) grouped.set(purity, []);
      grouped.get(purity).push(event);
    });
    return corePurityRows.call(this, events).map((row) => {
      const holding = holdingParts(grouped.get(row.purity) || []);
      return {
        ...row,
        gwDifference: Number(weight3(row.balanceGw || 0)),
        netWeightDifference: holding.net,
        nonGoldHolding: holding.nonGold,
        fineGoldHolding: holding.fine,
      };
    });
  };

  function physicalMetrics(totals = {}) {
    return {
      gwDifference: Number(weight3(totals.gross || 0)),
      netWeightDifference: Number(weight3(totals.gold || 0)),
      nonGoldHolding: Number(weight3(Number(totals.waxStone || 0) + Number(totals.handStone || 0) + Number(totals.nonGold || 0))),
      fineGoldHolding: Number(weight3(Number(totals.fineGold || 0) + Number(totals.lossFineGold || 0))),
    };
  }

  function dashboardMetrics(totals = {}, summary = {}) {
    const hasHistory = Number(summary.inCount || 0) > 0 || Number(summary.outCount || 0) > 0;
    return hasHistory ? {
      gwDifference: Number(weight3(summary.gwDifference || 0)),
      netWeightDifference: Number(weight3(summary.netWeightDifference || 0)),
      nonGoldHolding: Number(weight3(summary.nonGoldHolding || 0)),
      fineGoldHolding: Number(weight3(summary.fineGoldHolding || 0)),
    } : physicalMetrics(totals);
  }

  renderDepartmentMetal = function renderDepartmentMetalV615() {
    const departments = departmentMetalInHand();
    const summaryMap = new Map(departmentTransferSummaries().map((summary) => [departmentTextKey(summary.name), summary]));
    renderDepartmentReconciliationAlerts([]);
    const rows = Object.entries(departments)
      .map(([department, totals]) => {
        const summary = summaryMap.get(departmentTextKey(department)) || {};
        return { department, totals, summary, metrics: dashboardMetrics(totals, summary) };
      })
      .sort((left, right) => Math.abs(right.metrics.gwDifference) - Math.abs(left.metrics.gwDifference) || left.department.localeCompare(right.department))
      .map(({ department, totals, summary, metrics }) => `
        <article class="department-card ${Math.abs(metrics.gwDifference) > 0.0005 ? "" : "empty-department-card"}" tabindex="0">
          <span>${escapeHtml(department)}</span>
          <small class="department-holding-label">GW Difference</small>
          <strong>${gram(metrics.gwDifference)}</strong>
          <div class="department-card-summary department-card-summary-v615">
            <small><b>Net Wt Difference</b>${gram(metrics.netWeightDifference)}</small>
            <small><b>Non-Gold Holding</b>${gram(metrics.nonGoldHolding)}</small>
            <small class="department-fine-holding"><b>Fine Gold Holding</b>${gram(metrics.fineGoldHolding)}</small>
          </div>
          <div class="department-hover-popup" role="tooltip">
            <div class="department-popup-heading"><strong>${escapeHtml(department)}</strong><small>Corrected department holding</small></div>
            ${renderDepartmentHoldingDetail(totals, summary)}
          </div>
          <div class="department-card-actions">
            <button class="dashboard-open-button" type="button" onclick="openDashboardDepartment(decodeURIComponent('${encodeURIComponent(department)}'))">Open</button>
            <button class="dashboard-open-button department-issue-button" type="button" onclick="openSafeIssueToDepartment('', decodeURIComponent('${encodeURIComponent(department)}'))">Issue Accessory</button>
            <button class="dashboard-open-button department-receive-button" type="button" onclick="openSafeDepartmentReceiveByName('${encodeURIComponent(department)}')">Receive / Book Loss</button>
          </div>
        </article>
      `).join("");
    const container = document.getElementById("department-metal-list");
    if (container) container.innerHTML = rows || '<div class="empty">No department holding recorded.</div>';
  };

  renderDepartmentHoldingDetail = function renderDepartmentHoldingDetailV615(totals = {}, summary = {}) {
    const metrics = dashboardMetrics(totals, summary);
    return `
      <div class="department-breakup department-breakup-v615">
        <small><b>GW Difference</b>${gram(metrics.gwDifference)}</small>
        <small><b>Net Wt Difference</b>${gram(metrics.netWeightDifference)}</small>
        <small><b>Non-Gold Holding</b>${gram(metrics.nonGoldHolding)}</small>
        <small><b>Fine Gold Holding</b>${gram(metrics.fineGoldHolding)}</small>
        <small><b>IN Receive GW</b>${gram(summary.inGw || 0)}</small>
        <small><b>OUT Receive GW</b>${gram(summary.outGw || 0)}</small>
      </div>
      ${renderDepartmentPuritySplit(totals)}
      ${renderDepartmentSplit(totals)}
    `;
  };

  departmentHoldingReconciliations = function departmentHoldingReconciliationsV615(departments = departmentMetalInHand(), summaries = departmentTransferSummaries()) {
    const summaryMap = new Map(summaries.map((summary) => [departmentTextKey(summary.name), summary]));
    return Object.entries(departments).map(([name, totals]) => {
      const metrics = dashboardMetrics(totals, summaryMap.get(departmentTextKey(name)) || {});
      return { name, actualGw: metrics.gwDifference, ledgerGw: metrics.gwDifference, variance: 0, hasTransfer: true, needsCheck: false, counterpart: "", reason: "" };
    });
  };

  renderDepartmentReconciliationAlerts = function renderDepartmentReconciliationAlertsV615() {
    const container = document.getElementById("department-reconciliation-alerts");
    if (!container) return;
    container.classList.add("hidden");
    container.innerHTML = "";
  };

  renderDepartmentTransferTile = function renderDepartmentTransferTileV615(department = {}) {
    return `
      <button class="department-transfer-tile department-transfer-tile-v615" type="button" onclick="openDepartmentTransferHistory(decodeURIComponent('${encodeURIComponent(department.name)}'))">
        <span>${escapeHtml(department.name)}</span>
        <strong>${gram(department.gwDifference)}</strong>
        <div>
          <small><b>GW Difference</b>${gram(department.gwDifference)}</small>
          <small><b>Net Wt Difference</b>${gram(department.netWeightDifference)}</small>
          <small><b>Non-Gold Holding</b>${gram(department.nonGoldHolding)}</small>
          <small><b>Fine Gold Holding</b>${gram(department.fineGoldHolding)}</small>
        </div>
      </button>
    `;
  };

  renderDepartmentTransferTotals = function renderDepartmentTransferTotalsV615(summary = {}) {
    return [
      factorySummaryCard("GW Difference", gram(summary.gwDifference), "IN receive GW - OUT receive GW", summary.gwDifference ? "receivable" : ""),
      factorySummaryCard("Net Wt Difference", gram(summary.netWeightDifference), "IN net weight - OUT net weight"),
      factorySummaryCard("Non-Gold Holding", gram(summary.nonGoldHolding), "GW difference - net weight difference"),
      factorySummaryCard("Fine Gold Holding", gram(summary.fineGoldHolding), "Karat-wise fine gold of net holding"),
      factorySummaryCard("Total IN Receive GW", gram(summary.inGw), `${summary.inCount} inward entries`),
      factorySummaryCard("Total OUT Receive GW", gram(summary.outGw), `${summary.outCount} outward entries`),
    ].join("");
  };

  renderDepartmentTransferPurityBreakup = function renderDepartmentTransferPurityBreakupV615(events = []) {
    const rows = departmentTransferPurityRows(events);
    if (!rows.length) return '<div class="empty">No karat-wise transfer weight recorded for this department.</div>';
    return `
      <div class="panel-heading compact-heading"><h2>Karat Wise Holding</h2></div>
      <div class="department-transfer-purity-table department-transfer-purity-v615">
        <div class="department-transfer-purity-head"><span>Karat / Purity</span><span>GW Difference</span><span>Net Wt Difference</span><span>Non-Gold</span><span>Fine Gold</span></div>
        ${rows.map((row) => `<div class="department-transfer-purity-row"><span>${escapeHtml(row.purity)}</span><span>${gram(row.gwDifference)}</span><span>${gram(row.netWeightDifference)}</span><span>${gram(row.nonGoldHolding)}</span><span>${gram(row.fineGoldHolding)}</span></div>`).join("")}
      </div>
    `;
  };

  renderDepartmentMetal();
  renderDepartmentTransferHistoryBoard();
  window.KJM_DEPARTMENT_HOLDINGS_V615 = { splitRoot, originalSplitIssue, dashboardMetrics };
})();
