(function installSettingSplitRestoreV612() {
  "use strict";

  const RESTORE_VERSION = "v612";

  function settingSplitChildrenV612(parentLot = {}, currentState = state) {
    return (currentState.lots || [])
      .filter((lot) => lot.settingSplit && lot.settingSplitFromLotId === parentLot.id)
      .sort((left, right) => {
        const sequenceDifference = Number(left.settingSplitSequence || 0) - Number(right.settingSplitSequence || 0);
        if (sequenceDifference) return sequenceDifference;
        return String(left.createdAt || left.issueDate || left.number || "").localeCompare(
          String(right.createdAt || right.issueDate || right.number || ""),
          undefined,
          { numeric: true, sensitivity: "base" },
        );
      });
  }

  function settingSplitParentAdjustmentV612(childLot = {}, parentLot = {}) {
    return (parentLot.transfers || []).find((transfer) => (
      transfer.splitAdjustment
      && (
        transfer.settingSplitChildLotId === childLot.id
        || transfer.id === childLot.settingSplitParentTransferId
        || String(transfer.reason || "").includes(childLot.number || "__NO_LOT__")
      )
    )) || null;
  }

  function settingSplitChildAdjustmentV612(childLot = {}) {
    return (childLot.transfers || []).find((transfer) => (
      transfer.splitAdjustment
      && (
        transfer.settingSplitChildLotId === childLot.id
        || transfer.id === childLot.settingSplitChildTransferId
        || String(transfer.reason || "").includes(childLot.settingSplitFromLotNumber || "__NO_PARENT__")
      )
    )) || null;
  }

  function settingSplitChildForTransferV612(lot = {}, transfer = {}, currentState = state) {
    if (!transfer?.splitAdjustment) return null;
    if (lot.settingSplit && lot.settingSplitFromLotId) return lot;
    const explicitChildId = transfer.settingSplitChildLotId || "";
    return settingSplitChildrenV612(lot, currentState).find((child) => (
      child.id === explicitChildId
      || child.settingSplitParentTransferId === transfer.id
      || String(transfer.reason || "").includes(child.number || "__NO_LOT__")
    )) || null;
  }

  function settingSplitEntryIsSettledV612(entry = {}) {
    const hasReceive = entry.receiveGw !== undefined
      && entry.receiveGw !== null
      && String(entry.receiveGw) !== "";
    return entry.status === "Received"
      || hasReceive
      || Number(entry.rawaWeight || entry.returnedMaterialWeight || 0) > 0.0005
      || Number(entry.setterLossWeight || 0) > 0.0005
      || (entry.settlementHistory || []).length > 0;
  }

  function settingSplitRestoreBlockReasonV612(childLot = {}, currentState = state) {
    if (!childLot?.id || !childLot.settingSplitFromLotId) return "Setting split lot was not found.";
    const parentLot = (currentState.lots || []).find((lot) => lot.id === childLot.settingSplitFromLotId);
    if (!parentLot) return "The original Setting lot is missing, so this split cannot be restored automatically.";
    const siblings = settingSplitChildrenV612(parentLot, currentState);
    const latestChild = siblings.at(-1);
    if (latestChild?.id !== childLot.id) {
      return `Restore newer Setting split ${latestChild?.number || "lot"} first, then restore ${childLot.number || "this lot"}.`;
    }
    if (billForLotRecord(childLot) || billForLotRecord(parentLot)) {
      return "This split is connected to a Bill and cannot be restored from transfer history.";
    }
    if ((currentState.lots || []).some((lot) => lot.parentLotId === childLot.id || lot.settingSplitFromLotId === childLot.id)) {
      return "This split has a later child lot. Restore or merge that child lot first.";
    }
    if ((childLot.transfers || []).some((transfer) => !transfer.splitAdjustment)) {
      return "This split lot has already moved to another department. Undo its later transfers first.";
    }
    const childCreatedAt = transferHistoryTime(childLot.createdAt || "", childLot.settingSplitDate || childLot.issueDate || "");
    const laterParentTransfer = (parentLot.transfers || []).find((transfer) => (
      !transfer.splitAdjustment
      && childCreatedAt > 0
      && transferHistoryTime(transfer.createdAt || "", transfer.date || "") >= childCreatedAt
    ));
    if (laterParentTransfer) return "The original lot has a later department transfer. Undo that transfer first.";
    const settledEntry = (currentState.settingManagerEntries || [])
      .filter((entry) => entry.lotId === childLot.id)
      .find(settingSplitEntryIsSettledV612);
    if (settledEntry) return "This setter lot has already been received, settled, or booked with loss. Correct those entries first.";
    if ((currentState.productionNonGoldIssues || []).some((entry) => entry.lotId === childLot.id)) {
      return "This split has a production non-gold movement. Undo that movement first.";
    }
    if ((currentState.safeDepartmentIssues || []).some((entry) => entry.lotId === childLot.id || entry.goldIssueLotId === childLot.id)) {
      return "This split has a Safe Locker or department issue. Undo that issue first.";
    }
    const changedOrder = getLotOrders(childLot, currentState).find((order) => isCompletedOrder(order) || order.status === "Discarded");
    if (changedOrder) return "A PR item in this split is completed or discarded and cannot be restored automatically.";
    return "";
  }

  function settingSplitHandStoneFromTransfersV612(lot = {}) {
    const transfer = [...(lot.transfers || [])].reverse().find((entry) => (
      Number(entry.handStoneWeight ?? entry.stoneWeight ?? 0) > 0
    ));
    return Number(weight3(transfer?.handStoneWeight ?? transfer?.stoneWeight ?? lot.initialHandStoneWeight ?? 0));
  }

  function orderedRestoredOrderIdsV612(parentIds = [], childIds = [], currentState = state) {
    const selected = new Set([...parentIds, ...childIds].filter(Boolean));
    const stateOrder = (currentState.orders || []).map((order) => order.id).filter((id) => selected.has(id));
    const known = new Set(stateOrder);
    return [...stateOrder, ...[...selected].filter((id) => !known.has(id))];
  }

  function appendSettingSplitRestoreAuditV612(currentState, childLot, parentLot, restoredGw, automatic = false) {
    const createdAt = new Date().toISOString();
    const detail = `${childLot.number || "Split lot"} restored into ${parentLot.number || "parent lot"}; ${getLotOrderIds(childLot).length} PR item(s); parent GW ${gram(restoredGw)}.`;
    currentState.transferUndoHistory = currentState.transferUndoHistory || [];
    currentState.transferUndoHistory.unshift({
      id: crypto.randomUUID(),
      date: today(),
      createdAt,
      kind: "SETTING SPLIT RESTORE",
      reference: `${childLot.number || "-"} to ${parentLot.number || "-"}`,
      detail: automatic ? `${detail} Automatically repaired after an incomplete split-entry deletion.` : detail,
      userId: currentUser?.id || "",
      userName: currentUser?.name || currentUserConfig()?.name || "",
    });
    currentState.ledger = currentState.ledger || [];
    currentState.ledger.unshift({
      id: crypto.randomUUID(),
      date: today(),
      createdAt,
      type: "Setting Split Restore",
      purity: childLot.metalPurity || parentLot.metalPurity || "-",
      weight: 0,
      reference: automatic ? `${detail} Auto repair v612.` : detail,
      sourceType: "setting-split-restore",
    });
  }

  function applySettingSplitRestoreV612(childLot = {}, currentState = state, options = {}) {
    const parentLot = (currentState.lots || []).find((lot) => lot.id === childLot.settingSplitFromLotId);
    if (!parentLot) return null;
    const snapshot = childLot.settingSplitRestoreSnapshot || {};
    const childOrderIds = getLotOrderIds(childLot);
    const parentAdjustment = settingSplitParentAdjustmentV612(childLot, parentLot);
    const parentTransferId = parentAdjustment?.id || childLot.settingSplitParentTransferId || "";
    parentLot.transfers = (parentLot.transfers || []).filter((transfer) => transfer.id !== parentTransferId);

    const parentOrderIds = getLotOrderIds(parentLot);
    const restoredOrderIds = Array.isArray(snapshot.parentOrderIds) && snapshot.parentOrderIds.length
      ? [...snapshot.parentOrderIds]
      : orderedRestoredOrderIdsV612(parentOrderIds, childOrderIds, currentState);
    parentLot.orderIds = restoredOrderIds;
    parentLot.orderId = restoredOrderIds[0] || "";

    const previousTransfer = (parentLot.transfers || []).at(-1);
    const fallbackGw = Number(weight3(Number(parentLot.grossIssuedWeight || 0) + Number(childLot.grossIssuedWeight || currentTransferIssueWeight(childLot, currentState) || 0)));
    const restoredGw = Number(weight3(
      snapshot.currentGw ?? previousTransfer?.grossReceivedWeight ?? previousTransfer?.receivedWeight ?? fallbackGw
    ));
    const restoredWax = Number(weight3(
      snapshot.currentWax ?? Number(parentLot.waxStoneWeight || 0) + Number(childLot.waxStoneWeight || 0)
    ));
    const restoredHand = Number(weight3(snapshot.currentHand ?? settingSplitHandStoneFromTransfersV612(parentLot)));
    parentLot.grossIssuedWeight = restoredGw;
    parentLot.waxStoneWeight = restoredWax;
    if (Object.prototype.hasOwnProperty.call(parentLot, "physicalWaxStoneWeight")) parentLot.physicalWaxStoneWeight = restoredWax;
    parentLot.issuedWeight = splitLotNetWeight(restoredGw, restoredWax, restoredHand);

    const rootJobNumber = childLot.settingSplitRootJobNumber
      || snapshot.parentOrderNumber
      || parentLot.settingSplitRootJobNumber
      || parentLot.orderNumber;
    const savedOrderJobs = snapshot.orderJobNumbers || {};
    childOrderIds.forEach((orderId) => {
      const order = (currentState.orders || []).find((item) => item.id === orderId);
      if (!order) return;
      order.jobNumber = savedOrderJobs[orderId] || rootJobNumber;
      delete order.settingSplitFromJobNumber;
      delete order.settingSplitSequence;
      if (order.splitFromJobNumber === rootJobNumber) delete order.splitFromJobNumber;
    });

    currentState.settingManagerEntries = (currentState.settingManagerEntries || []).filter((entry) => entry.lotId !== childLot.id);
    currentState.productionNonGoldIssues = (currentState.productionNonGoldIssues || []).filter((entry) => entry.lotId !== childLot.id);
    currentState.ledger = (currentState.ledger || []).filter((entry) => !(
      entry.type === "Setting Split"
      && String(entry.reference || "").includes(childLot.number || "__NO_LOT__")
    ));
    currentState.lots = (currentState.lots || []).filter((lot) => lot.id !== childLot.id);

    const remainingChildren = settingSplitChildrenV612(parentLot, currentState);
    if (!remainingChildren.length) delete parentLot.settingSplitRootJobNumber;
    appendSettingSplitRestoreAuditV612(currentState, childLot, parentLot, restoredGw, Boolean(options.automatic));
    return { parentLot, childLot, restoredGw, restoredOrderIds };
  }

  function restoreSettingSplitLotV612(childLotId = "", options = {}) {
    const childLot = (state.lots || []).find((lot) => lot.id === childLotId);
    if (!childLot) return false;
    const blockReason = settingSplitRestoreBlockReasonV612(childLot, state);
    if (blockReason) {
      if (!options.silent) alert(blockReason);
      return false;
    }
    const parentLot = (state.lots || []).find((lot) => lot.id === childLot.settingSplitFromLotId);
    if (!parentLot) return false;
    if (!options.skipConfirm && !confirm(
      `Restore this Setting split?\n\n${childLot.number} / ${childLot.orderNumber || "-"}\nBack to ${parentLot.number} / ${parentLot.orderNumber || "-"}\n\nPR items, GW, stone weights, setter issue, Job Card number, and split ledger will return to the original lot.`
    )) return false;
    const stateBefore = structuredClone(state);
    const result = applySettingSplitRestoreV612(childLot, state, { automatic: Boolean(options.automatic) });
    if (!result) return false;
    if (!saveOnlineTransferUndo(stateBefore, `Restore Setting split ${childLot.number}`, { lotId: result.parentLot.id })) return false;
    if (!options.silent) {
      alert(`${childLot.number} was restored into ${result.parentLot.number}.\nRestored PR items: ${result.restoredOrderIds.length}\nRestored lot GW: ${gram(result.restoredGw)}.`);
    }
    return true;
  }

  function repairOrphanedSettingSplitsV612(currentState = state) {
    let repaired = 0;
    const candidates = (currentState.lots || [])
      .filter((lot) => lot.settingSplit && lot.settingSplitFromLotId)
      .sort((left, right) => Number(right.settingSplitSequence || 0) - Number(left.settingSplitSequence || 0));
    candidates.forEach((childLot) => {
      if (!(currentState.lots || []).some((lot) => lot.id === childLot.id)) return;
      const parentLot = (currentState.lots || []).find((lot) => lot.id === childLot.settingSplitFromLotId);
      if (!parentLot) return;
      const parentAdjustment = settingSplitParentAdjustmentV612(childLot, parentLot);
      const childAdjustment = settingSplitChildAdjustmentV612(childLot);
      if (parentAdjustment && childAdjustment) return;
      if (settingSplitRestoreBlockReasonV612(childLot, currentState)) return;
      if (applySettingSplitRestoreV612(childLot, currentState, { automatic: true })) repaired += 1;
    });
    if (repaired) {
      currentState.settingSplitRestorePendingSaveAt = new Date().toISOString();
      currentState.settingSplitRestoreMigrationVersion = RESTORE_VERSION;
    }
    return repaired;
  }

  const splitSettingLotForSetterV611 = splitSettingLotForSetter;
  splitSettingLotForSetter = function splitSettingLotForSetterV612(lot, selectedOrderIds = [], splitGw = 0) {
    const parentOrderIds = getLotOrderIds(lot);
    const orderJobNumbers = Object.fromEntries(parentOrderIds.map((orderId) => [
      orderId,
      findById("orders", orderId)?.jobNumber || lot.orderNumber || "",
    ]));
    const parentTransferIds = new Set((lot.transfers || []).map((transfer) => transfer.id));
    const snapshot = {
      parentOrderIds: [...parentOrderIds],
      parentOrderNumber: lot.orderNumber || "",
      orderJobNumbers,
      currentGw: Number(weight3(currentTransferIssueWeight(lot))),
      currentWax: Number(weight3(transferWaxStoneWeight(lot))),
      currentHand: Number(weight3(currentHandStoneWeight(lot))),
    };
    const childLot = splitSettingLotForSetterV611.call(this, lot, selectedOrderIds, splitGw);
    if (!childLot) return childLot;
    const parentAdjustment = (lot.transfers || []).find((transfer) => !parentTransferIds.has(transfer.id) && transfer.splitAdjustment);
    const childAdjustment = settingSplitChildAdjustmentV612(childLot);
    childLot.settingSplitRestoreSnapshot = snapshot;
    childLot.settingSplitParentTransferId = parentAdjustment?.id || "";
    childLot.settingSplitChildTransferId = childAdjustment?.id || "";
    if (parentAdjustment) {
      parentAdjustment.settingSplitChildLotId = childLot.id;
      parentAdjustment.settingSplitRole = "parent";
    }
    if (childAdjustment) {
      childAdjustment.settingSplitChildLotId = childLot.id;
      childAdjustment.settingSplitRole = "child";
    }
    return childLot;
  };

  const lotTransferUndoBlockReasonV611 = lotTransferUndoBlockReason;
  lotTransferUndoBlockReason = function lotTransferUndoBlockReasonV612(lot = {}, transfer = {}) {
    const childLot = settingSplitChildForTransferV612(lot, transfer, state);
    if (childLot) {
      if (!canUndoOnlineTransferHistory()) return "Only Owner or Manager can restore Setting split entries.";
      return settingSplitRestoreBlockReasonV612(childLot, state);
    }
    return lotTransferUndoBlockReasonV611.call(this, lot, transfer);
  };

  const undoOnlineLotTransferV611 = undoOnlineLotTransfer;
  undoOnlineLotTransfer = function undoOnlineLotTransferV612(lotId, transferId) {
    if (!requireOnlineTransferUndoPermission()) return;
    const lot = findById("lots", lotId);
    const transfer = lot?.transfers?.find((entry) => entry.id === transferId);
    const childLot = settingSplitChildForTransferV612(lot || {}, transfer || {}, state);
    if (childLot) {
      restoreSettingSplitLotV612(childLot.id);
      return;
    }
    undoOnlineLotTransferV611.call(this, lotId, transferId);
  };

  const transferHistoryEditButtonHtmlV611 = transferHistoryEditButtonHtml;
  transferHistoryEditButtonHtml = function transferHistoryEditButtonHtmlV612(lot = {}, transfer = {}) {
    if (settingSplitChildForTransferV612(lot, transfer, state)) return "";
    return transferHistoryEditButtonHtmlV611.call(this, lot, transfer);
  };

  const onlineTransferUndoButtonHtmlV611 = onlineTransferUndoButtonHtml;
  onlineTransferUndoButtonHtml = function onlineTransferUndoButtonHtmlV612(entry = {}) {
    const childLot = entry.type === "transfer"
      ? settingSplitChildForTransferV612(entry.lot || {}, entry.transfer || {}, state)
      : null;
    if (!childLot) return onlineTransferUndoButtonHtmlV611.call(this, entry);
    if (!canUndoOnlineTransferHistory()) return "";
    const reason = settingSplitRestoreBlockReasonV612(childLot, state);
    const clickAction = reason
      ? `showOnlineTransferUndoBlocked('${encodeURIComponent(reason)}')`
      : `restoreSettingSplitLotV612('${escapeHtml(childLot.id)}')`;
    return `<button class="ghost-button danger-button${reason ? " disabled-action" : ""}" type="button" onclick="${clickAction}" ${reason ? 'aria-disabled="true"' : ""} title="${escapeHtml(reason || "Restore all PR items and weights to the original Setting lot")}">Restore Split</button>`;
  };

  const normalizeStateV611 = normalizeState;
  normalizeState = function normalizeStateWithSettingSplitRestoreV612(currentState) {
    const normalized = normalizeStateV611.call(this, currentState);
    repairOrphanedSettingSplitsV612(normalized);
    return normalized;
  };

  const runPostCloudMigrationsV611 = runPostCloudMigrations;
  runPostCloudMigrations = function runPostCloudMigrationsV612() {
    if (state.settingSplitRestorePendingSaveAt
      && state.settingSplitRestoreSavedAt !== state.settingSplitRestorePendingSaveAt) {
      state.settingSplitRestoreSavedAt = state.settingSplitRestorePendingSaveAt;
      saveState({ context: "Restore incomplete Setting split entries v612" });
      render();
    }
    return runPostCloudMigrationsV611.call(this);
  };

  const initialRepairs = repairOrphanedSettingSplitsV612(state);
  if (initialRepairs) {
    render();
    if (!supabaseSettings.url || !supabaseSettings.anonKey) {
      state.settingSplitRestoreSavedAt = state.settingSplitRestorePendingSaveAt;
      saveState({ context: "Restore local incomplete Setting split entries v612" });
    }
  }

  window.KJM_SETTING_SPLIT_RESTORE_V612 = {
    apply: applySettingSplitRestoreV612,
    blockReason: settingSplitRestoreBlockReasonV612,
    childForTransfer: settingSplitChildForTransferV612,
    repairOrphans: repairOrphanedSettingSplitsV612,
    restore: restoreSettingSplitLotV612,
  };
  window.restoreSettingSplitLotV612 = restoreSettingSplitLotV612;
})();
