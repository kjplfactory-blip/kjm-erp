(function attachCentralNonGoldFlowV699(global) {
  "use strict";

  const MATERIALS = ["stone", "black-beads", "moti", "spring", "other"];

  function number(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function weight3(value) {
    return Number(number(value).toFixed(3));
  }

  function textKey(value = "") {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function purityKey(value = "") {
    const text = String(value || "").trim().toUpperCase();
    const karat = text.match(/\b(9|14|18|22)\s*K\b/);
    if (karat) return `${karat[1]}K`;
    const percent = number(text.replace(/[^0-9.]/g, ""));
    if (percent >= 90) return "22K";
    if (percent >= 68) return "18K";
    if (percent >= 48) return "14K";
    if (percent > 0) return "9K";
    return text;
  }

  function materialKey(value = "") {
    const text = textKey(value);
    if (["stone", "stones", "st"].includes(text)) return "stone";
    if (["black beads", "blackbeads", "bb"].includes(text)) return "black-beads";
    if (["moti", "mm"].includes(text)) return "moti";
    if (["spring", "springs"].includes(text)) return "spring";
    return "other";
  }

  function breakdown(value = {}) {
    const result = {};
    Object.entries(value || {}).forEach(([material, amount]) => {
      const key = materialKey(material);
      const cleanWeight = weight3(Math.max(number(amount), 0));
      if (cleanWeight > 0.0005) result[key] = weight3(number(result[key]) + cleanWeight);
    });
    return result;
  }

  function total(value = {}) {
    return weight3(Object.values(breakdown(value)).reduce((sum, amount) => sum + number(amount), 0));
  }

  function matchesIssue(issue = {}, options = {}) {
    if (["returned", "closed"].includes(textKey(issue.status))) return false;
    if (options.departmentKey && textKey(issue.departmentKey || issue.department || issue.process) !== textKey(options.departmentKey)) return false;
    if (options.purityKey && purityKey(issue.purityKey || issue.purity) !== purityKey(options.purityKey)) return false;
    return total(issue.breakdown) > 0.0005;
  }

  function allocatedByIssue(allocations = [], excludeTransferId = "") {
    const used = new Map();
    (allocations || []).forEach((allocation) => {
      if (!allocation?.posted || (excludeTransferId && allocation.transferId === excludeTransferId)) return;
      (allocation.lines || []).forEach((line) => {
        const issueId = String(line.safeDepartmentIssueId || "");
        if (!issueId) return;
        const current = used.get(issueId) || {};
        const material = materialKey(line.materialType);
        current[material] = weight3(number(current[material]) + number(line.weight));
        used.set(issueId, current);
      });
    });
    return used;
  }

  function availableDepartmentBreakdown(issues = [], allocations = [], options = {}) {
    const used = allocatedByIssue(allocations, options.excludeTransferId);
    return (issues || [])
      .filter((issue) => matchesIssue(issue, options))
      .reduce((result, issue) => {
        const source = breakdown(issue.breakdown);
        const consumed = used.get(String(issue.id || "")) || {};
        MATERIALS.forEach((material) => {
          const remaining = weight3(Math.max(number(source[material]) - number(consumed[material]), 0));
          if (remaining > 0.0005) result[material] = weight3(number(result[material]) + remaining);
        });
        return result;
      }, {});
  }

  function allocateDepartmentNonGold(input = {}) {
    const demand = breakdown(input.demand);
    const issues = (input.issues || []).filter((issue) => matchesIssue(issue, input));
    const used = allocatedByIssue(input.allocations, input.transferId);
    const available = availableDepartmentBreakdown(input.issues, input.allocations, {
      ...input,
      excludeTransferId: input.transferId,
    });
    const shortages = MATERIALS
      .map((materialType) => ({
        materialType,
        required: number(demand[materialType]),
        available: number(available[materialType]),
      }))
      .filter((line) => line.required > line.available + 0.0005);
    if (shortages.length) return { posted: false, demand, available, shortages, lines: [], total: 0 };

    const lines = [];
    MATERIALS.forEach((materialType) => {
      let remaining = number(demand[materialType]);
      if (remaining <= 0.0005) return;
      [...issues]
        .sort((left, right) => {
          const leftLot = String(left.lotId || "") === String(input.lotId || "") ? 0 : 1;
          const rightLot = String(right.lotId || "") === String(input.lotId || "") ? 0 : 1;
          return leftLot - rightLot || String(left.createdAt || left.date || "").localeCompare(String(right.createdAt || right.date || ""));
        })
        .forEach((issue) => {
          if (remaining <= 0.0005) return;
          const issueBreakdown = breakdown(issue.breakdown);
          const issueUsed = used.get(String(issue.id || "")) || {};
          const issueAvailable = weight3(Math.max(number(issueBreakdown[materialType]) - number(issueUsed[materialType]), 0));
          const taken = weight3(Math.min(issueAvailable, remaining));
          if (taken <= 0.0005) return;
          lines.push({
            safeDepartmentIssueId: issue.id,
            materialType,
            weight: taken,
            sourceLotId: issue.lotId || "",
            sourceReference: issue.reference || issue.itemDescription || "Department non-gold issue",
          });
          issueUsed[materialType] = weight3(number(issueUsed[materialType]) + taken);
          used.set(String(issue.id || ""), issueUsed);
          remaining = weight3(remaining - taken);
        });
    });

    return {
      posted: true,
      sourceMode: "department",
      transferId: input.transferId || "",
      lotId: input.lotId || "",
      departmentKey: input.departmentKey || "",
      purityKey: purityKey(input.purityKey || ""),
      demandLines: Object.entries(demand).map(([materialType, amount]) => ({ materialType, weight: amount })),
      available,
      shortages: [],
      lines,
      total: weight3(lines.reduce((sum, line) => sum + number(line.weight), 0)),
    };
  }

  function completedIssueAllocation(allocations = [], issueId = "") {
    return (allocations || [])
      .filter((allocation) => allocation?.posted && allocation.factoryOutPosted)
      .flatMap((allocation) => allocation.lines || [])
      .filter((line) => String(line.safeDepartmentIssueId || "") === String(issueId || ""))
      .reduce((result, line) => {
        const material = materialKey(line.materialType);
        result[material] = weight3(number(result[material]) + number(line.weight));
        return result;
      }, {});
  }

  function settingHoldingBridge(input = {}) {
    const issueGw = weight3(input.issueGw);
    const receiveGw = weight3(input.receiveGw);
    return {
      posted: true,
      holdingName: "Production Holding Shelf",
      firstLeg: {
        from: input.from || "Setting Department",
        to: "Production Holding Shelf",
        issueGw,
        receiveGw,
      },
      secondLeg: {
        from: "Production Holding Shelf",
        to: input.to || "Next Department",
        issueGw: receiveGw,
        receiveGw,
      },
    };
  }

  global.KJMCentralNonGoldFlowV699 = Object.freeze({
    MATERIALS,
    allocateDepartmentNonGold,
    availableDepartmentBreakdown,
    breakdown,
    completedIssueAllocation,
    materialKey,
    purityKey,
    settingHoldingBridge,
    textKey,
    total,
    weight3,
  });
})(typeof window !== "undefined" ? window : globalThis);
