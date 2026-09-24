(function installSettingSplitJobCardsV611() {
  "use strict";

  const MIGRATION_VERSION = "v611";

  function settingSplitJobRootV611(lot = {}, currentState = state) {
    const parentLot = lot.settingSplitFromLotId
      ? (currentState.lots || []).find((entry) => entry.id === lot.settingSplitFromLotId)
      : null;
    return String(
      lot.settingSplitRootJobNumber
      || parentLot?.settingSplitRootJobNumber
      || parentLot?.orderNumber
      || lot.orderNumber
      || "JOB"
    ).trim();
  }

  function nextSettingSplitJobIdentityV611(lot = {}, currentState = state) {
    const root = settingSplitJobRootV611(lot, currentState);
    const existing = new Set([
      ...(currentState.orders || []).map((order) => order.jobNumber),
      ...(currentState.lots || []).map((entry) => entry.orderNumber),
    ].filter(Boolean).map(String));
    let sequence = 1;
    let jobNumber = `${root}-${sequence}`;
    while (existing.has(jobNumber)) {
      sequence += 1;
      jobNumber = `${root}-${sequence}`;
    }
    return { root, sequence, jobNumber };
  }

  function migrateSettingSplitJobCardsV611(currentState) {
    const splitLots = (currentState.lots || [])
      .filter((lot) => lot.settingSplit && lot.settingSplitFromLotId)
      .sort((left, right) => String(left.createdAt || left.issueDate || left.number || "").localeCompare(
        String(right.createdAt || right.issueDate || right.number || ""),
        undefined,
        { numeric: true, sensitivity: "base" },
      ));
    if (!splitLots.length) {
      currentState.settingSplitJobCardMigrationVersion = MIGRATION_VERSION;
      return 0;
    }

    const usedJobNumbers = new Set([
      ...(currentState.orders || []).map((order) => order.jobNumber),
      ...(currentState.lots || []).map((lot) => lot.orderNumber),
    ].filter(Boolean).map(String));
    const nextSequenceByRoot = new Map();
    let updated = 0;

    splitLots.forEach((splitLot) => {
      const root = settingSplitJobRootV611(splitLot, currentState);
      let sequence = Number(splitLot.settingSplitSequence || 0);
      let splitJobNumber = String(splitLot.orderNumber || "");
      const expectedSavedNumber = sequence > 0 ? `${root}-${sequence}` : "";
      const alreadyNumbered = splitLot.settingSplitJobNumberVersion === MIGRATION_VERSION
        && expectedSavedNumber
        && splitJobNumber === expectedSavedNumber;

      if (!alreadyNumbered) {
        sequence = Math.max(Number(nextSequenceByRoot.get(root) || 1), 1);
        splitJobNumber = `${root}-${sequence}`;
        while (usedJobNumbers.has(splitJobNumber)) {
          sequence += 1;
          splitJobNumber = `${root}-${sequence}`;
        }
        updated += 1;
      }

      usedJobNumbers.add(splitJobNumber);
      nextSequenceByRoot.set(root, Math.max(Number(nextSequenceByRoot.get(root) || 1), sequence + 1));
      splitLot.orderNumber = splitJobNumber;
      splitLot.settingSplitRootJobNumber = root;
      splitLot.settingSplitSequence = sequence;
      splitLot.settingSplitJobNumberVersion = MIGRATION_VERSION;

      (splitLot.orderIds || [splitLot.orderId].filter(Boolean)).forEach((orderId) => {
        const order = (currentState.orders || []).find((item) => item.id === orderId);
        if (!order) return;
        order.jobNumber = splitJobNumber;
        order.splitFromJobNumber = root;
        order.settingSplitFromJobNumber = root;
        order.settingSplitSequence = sequence;
      });

      (currentState.settingManagerEntries || []).forEach((entry) => {
        if (entry.lotId !== splitLot.id) return;
        entry.jobNumber = splitJobNumber;
        entry.splitFromJobNumber = root;
        entry.settingSplitSequence = sequence;
      });
    });

    currentState.settingSplitJobCardMigrationVersion = MIGRATION_VERSION;
    return updated;
  }

  const coreSplitSettingLotForSetter = splitSettingLotForSetter;
  splitSettingLotForSetter = function splitSettingLotForSetterV611(lot, selectedOrderIds = [], splitGw = 0) {
    const lotOrderIds = getLotOrderIds(lot);
    const selectedIdSet = new Set(selectedOrderIds);
    const selectedIds = lotOrderIds.filter((orderId) => selectedIdSet.has(orderId));
    const splitIdentity = nextSettingSplitJobIdentityV611(lot);
    const splitLot = coreSplitSettingLotForSetter.call(this, lot, selectedIds, splitGw);
    if (!splitLot) return splitLot;

    lot.settingSplitRootJobNumber = splitIdentity.root;
    splitLot.orderNumber = splitIdentity.jobNumber;
    splitLot.settingSplitRootJobNumber = splitIdentity.root;
    splitLot.settingSplitSequence = splitIdentity.sequence;
    splitLot.settingSplitJobNumberVersion = MIGRATION_VERSION;

    selectedIds.forEach((orderId) => {
      const order = findById("orders", orderId);
      if (!order) return;
      order.jobNumber = splitIdentity.jobNumber;
      order.splitFromJobNumber = splitIdentity.root;
      order.settingSplitFromJobNumber = splitIdentity.root;
      order.settingSplitSequence = splitIdentity.sequence;
    });

    const ledgerEntry = (state.ledger || []).find((entry) => entry.type === "Setting Split"
      && String(entry.reference || "").includes(splitLot.number));
    if (ledgerEntry) {
      ledgerEntry.reference = `${splitLot.number} / ${splitIdentity.jobNumber} created from ${lot.number} / ${splitIdentity.root}; ${selectedIds.length} PR item(s), ${gram(splitGw)} GW. No stock movement booked.`;
    }
    return splitLot;
  };

  const coreUpdateSettingIssueSummary = updateSettingIssueSummary;
  updateSettingIssueSummary = function updateSettingIssueSummaryV611(event) {
    coreUpdateSettingIssueSummary.call(this, event);
    const form = document.getElementById("setting-issue-form");
    const issueType = form?.issueType?.value || "lot";
    const isPartial = ["lot", "repair"].includes(issueType) && form?.issueScope?.value === "part";
    if (!isPartial) return;
    const lot = findById("lots", form.lotId.value);
    const summary = document.getElementById("setting-issue-summary");
    if (!lot || !summary) return;
    const orders = getLotOrders(lot);
    if (orders.length <= 1) {
      summary.textContent = `${lot.number} has only one PR item. Choose Full Job Lot.`;
      return;
    }
    const selectedIds = settingSplitSelectedOrderIds(form);
    const selectedIdSet = new Set(selectedIds);
    const selectedOrders = orders.filter((order) => selectedIdSet.has(order.id));
    const plannedHandStoneWeight = Number(weight3(productionStoneTotalsForOrders(selectedOrders, "hand").weight));
    const nextSplitJob = nextSettingSplitJobIdentityV611(lot).jobNumber;
    summary.textContent = `${lot.number} / ${lot.orderNumber} has ${orders.length} PR items and ${gram(currentTransferIssueWeight(lot))} GW. Selected PR items will move to ${nextSplitJob} and disappear from the main Job Card. Enter the exact GW for this part. ${selectedOrders.length ? `${selectedOrders.length} selected / planned hand stone ${gram(plannedHandStoneWeight)}.` : "No PR item selected yet."}`;
  };

  const coreNormalizeState = normalizeState;
  normalizeState = function normalizeStateWithSettingSplitsV611(currentState) {
    const normalized = coreNormalizeState.call(this, currentState);
    migrateSettingSplitJobCardsV611(normalized);
    return normalized;
  };

  jobOrderFamilyRoot = function jobOrderFamilyRootV611(job = {}) {
    const jobNumber = job.jobNumber || job.orders?.[0]?.jobNumber || "";
    const explicitParent = job.orders?.find((order) => order.splitFromJobNumber)?.splitFromJobNumber || "";
    if (explicitParent) return splitJobRootNumber(explicitParent) || explicitParent;
    return splitJobRootNumber(jobNumber) || jobNumber;
  };

  jobOrderFamilyRole = function jobOrderFamilyRoleV611(job = {}) {
    const root = jobOrderFamilyRoot(job);
    if (job.jobNumber === root) return "Main Job";
    const standardSplit = String(job.jobNumber || "").match(/-(S\d+)$/i)?.[1];
    if (standardSplit) return `Split ${standardSplit.toUpperCase()}`;
    const settingSplit = String(job.jobNumber || "").match(/-(\d+)$/)?.[1];
    return settingSplit ? `Setting Split ${settingSplit}` : "Split Job";
  };

  mergeEligibleJobFamilies = function mergeEligibleJobFamiliesV611() {
    const families = new Map();
    groupedJobOrders().forEach((job) => {
      const root = jobOrderFamilyRoot(job);
      if (!root) return;
      if (!families.has(root)) families.set(root, []);
      families.get(root).push(job);
    });
    return [...families.entries()]
      .map(([root, jobs]) => ({
        root,
        jobs: jobs.sort((left, right) => {
          if (left.jobNumber === root) return -1;
          if (right.jobNumber === root) return 1;
          return left.jobNumber.localeCompare(right.jobNumber, undefined, { numeric: true });
        }),
      }))
      .filter((family) => family.jobs.length > 1)
      .sort((left, right) => left.root.localeCompare(right.root, undefined, { numeric: true }));
  };

  mergeJobFamily = function mergeJobFamilyV611(primaryJobNumber = "") {
    return mergeEligibleJobFamilies().find((family) => (
      family.root === splitJobRootNumber(primaryJobNumber)
      || family.jobs.some((job) => job.jobNumber === primaryJobNumber)
    )) || null;
  };

  const coreRunPostCloudMigrations = runPostCloudMigrations;
  runPostCloudMigrations = function runPostCloudMigrationsV611() {
    const updated = migrateSettingSplitJobCardsV611(state);
    if (updated) {
      saveState({ context: "Setting split Job Card numbering migration v611" });
      render();
    }
    return coreRunPostCloudMigrations.call(this);
  };

  const initialUpdates = migrateSettingSplitJobCardsV611(state);
  if (initialUpdates) {
    render();
    if (!supabaseSettings.url || !supabaseSettings.anonKey) {
      saveState({ context: "Local Setting split Job Card numbering migration v611" });
    }
  }

  window.KJM_SETTING_SPLIT_V611 = {
    migrate: migrateSettingSplitJobCardsV611,
    nextIdentity: nextSettingSplitJobIdentityV611,
    root: settingSplitJobRootV611,
  };
})();
