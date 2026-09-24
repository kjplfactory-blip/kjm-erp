(function installSettingManualTransferV618() {
  "use strict";

  function ensureManualTransferDialog() {
    let dialog = document.getElementById("setting-manual-transfer-dialog");
    if (dialog) return dialog;
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="setting-manual-transfer-dialog">
        <form id="setting-manual-transfer-form" class="dialog-card setting-manual-transfer-card">
          <div class="dialog-header">
            <div>
              <h2>Transfer Manual Item To Department</h2>
              <p class="dialog-note">No Job Card is created. The same tracked item moves OUT from Setting and IN to the selected department.</p>
            </div>
            <button class="ghost-button" type="button" data-setting-manual-transfer-close>Close</button>
          </div>
          <input type="hidden" name="sourceIssueId">
          <input type="hidden" name="settingEntryId">
          <section class="setting-manual-transfer-source">
            <article><span>Item / Reference</span><strong data-manual-transfer-item>-</strong></article>
            <article><span>Setter Source</span><strong data-manual-transfer-setter>-</strong></article>
            <article><span>Karat</span><strong data-manual-transfer-purity>-</strong></article>
            <article><span>Available GW</span><strong data-manual-transfer-available-gw>0.000 g</strong></article>
            <article><span>Available Non-Gold</span><strong data-manual-transfer-available-non-gold>0.000 g</strong></article>
          </section>
          <section class="setting-manual-transfer-fields">
            <label>Transfer GW (g)<input name="grossWeight" type="number" min="0.001" step="0.001" required></label>
            <label>Wax Stone (g)<input name="waxStoneWeight" type="number" min="0" step="0.001" required></label>
            <label>Hand Stone / Other Non-Gold (g)<input name="nonGoldWeight" type="number" min="0" step="0.001" required></label>
            <label>Transfer To Department<select name="departmentId" required></select></label>
            <label>Department Process<select name="process" required></select></label>
            <label>Net Gold (g)<input name="netWeight" type="number" step="0.001" readonly></label>
            <label class="full-row">Remarks<input name="remarks" required placeholder="Example: S6 returned manual item transferred to Filing"></label>
          </section>
          <section class="setting-manual-transfer-calculation" aria-live="polite">
            <article><span>GW Moving</span><strong data-manual-transfer-gw>0.000 g</strong></article>
            <article><span>Wax Stone</span><strong data-manual-transfer-wax>0.000 g</strong></article>
            <article><span>Hand / Other</span><strong data-manual-transfer-other>0.000 g</strong></article>
            <article><span>Net Gold</span><strong data-manual-transfer-net>0.000 g</strong></article>
          </section>
          <p class="setting-manual-transfer-note" data-manual-transfer-note>Full available balance is prefilled. Change GW for a partial transfer; stone and non-gold are proposed in the same ratio and can be corrected before saving.</p>
          <div class="dialog-actions">
            <button class="ghost-button" type="button" data-setting-manual-transfer-full>Use Full Available Balance</button>
            <button class="ghost-button" type="button" data-setting-manual-transfer-close>Cancel</button>
            <button type="submit">Save Department Transfer</button>
          </div>
        </form>
      </dialog>
    `);
    dialog = document.getElementById("setting-manual-transfer-dialog");
    const form = document.getElementById("setting-manual-transfer-form");
    dialog.querySelectorAll("[data-setting-manual-transfer-close]").forEach((button) => {
      button.addEventListener("click", () => dialog.close());
    });
    dialog.querySelector("[data-setting-manual-transfer-full]")?.addEventListener("click", () => {
      fillManualTransferWeights(form, true);
    });
    form.departmentId.addEventListener("change", () => renderManualTransferProcesses(form));
    form.grossWeight.addEventListener("input", () => {
      if (form.dataset.componentWeightsEdited !== "true") fillManualTransferWeights(form, false);
      updateManualTransferCalculation(form);
    });
    [form.waxStoneWeight, form.nonGoldWeight].forEach((input) => {
      input.addEventListener("input", () => {
        form.dataset.componentWeightsEdited = "true";
        updateManualTransferCalculation(form);
      });
    });
    form.addEventListener("submit", saveManualDepartmentTransfer);
    return dialog;
  }

  function manualTransferSource(sourceIssueId = "") {
    const issue = safeDepartmentIssuesInHand().find((item) => item.id === sourceIssueId);
    const listedSource = settingManualProductionSource(sourceIssueId);
    if (!issue || !listedSource) return null;
    return {
      ...issue,
      availableGrossWeight: Number(weight3(Math.min(Number(issue.grossWeight || 0), Number(listedSource.availableGw || 0)))),
      listedSource,
    };
  }

  function manualTransferEntry(source = {}) {
    return (state.settingManagerEntries || []).find((entry) =>
      entry.id === source.sourceLine
      || entry.receiptSourceIssueId === source.id
      || entry.sourceIssueId === source.id
    ) || null;
  }

  function manualEntryTransferTotals(entry = {}) {
    return (entry.departmentTransfers || []).reduce((totals, transfer) => ({
      gross: Number(weight3(totals.gross + Number(transfer.grossWeight || 0))),
      wax: Number(weight3(totals.wax + Number(transfer.waxStoneWeight || 0))),
      nonGold: Number(weight3(totals.nonGold + Number(transfer.nonGoldWeight || 0))),
      net: Number(weight3(totals.net + Number(transfer.netWeight || 0))),
    }), { gross: 0, wax: 0, nonGold: 0, net: 0 });
  }

  function manualReceivedTransferCandidate(entryId = "") {
    const entry = (state.settingManagerEntries || []).find((item) =>
      item.id === entryId && item.entryType === "Manual" && item.status === "Received"
    );
    if (!entry) return null;
    const sourceIssueId = entry.receiptSourceIssueId || entry.sourceIssueId || "";
    const source = manualTransferSource(sourceIssueId);
    if (!source) return null;
    const transferred = manualEntryTransferTotals(entry);
    const receivedGross = Number(weight3(entry.receiveGw || 0));
    const receivedWax = Number(weight3(entry.receiveWaxStoneWeight || 0));
    const receivedNonGold = Number(weight3(entry.handStoneWeight || entry.sourceHandStoneAddedWeight || 0));
    const receivedNet = Number(weight3(entry.receiveNetWeight ?? Math.max(receivedGross - receivedWax - receivedNonGold, 0)));
    const available = {
      gross: Number(weight3(Math.max(receivedGross - transferred.gross, 0))),
      wax: Number(weight3(Math.max(receivedWax - transferred.wax, 0))),
      nonGold: Number(weight3(Math.max(receivedNonGold - transferred.nonGold, 0))),
      net: Number(weight3(Math.max(receivedNet - transferred.net, 0))),
    };
    available.gross = Number(weight3(Math.min(available.gross, source.availableGrossWeight)));
    if (available.gross <= 0.0005) return null;
    return { entry, source, available, transferred };
  }

  function manualTransferAvailableParts(source = {}) {
    const fullGross = Math.max(Number(source.grossWeight || 0), 0);
    const availableGross = Math.max(Number(source.availableGrossWeight || 0), 0);
    const ratio = fullGross > 0 ? Math.min(availableGross / fullGross, 1) : 0;
    return {
      gross: Number(weight3(availableGross)),
      wax: Number(weight3(Number(source.waxStoneWeight || 0) * ratio)),
      nonGold: Number(weight3(Number(source.nonGoldWeight || 0) * ratio)),
      net: Number(weight3(Number(source.netWeight || 0) * ratio)),
      ratio,
    };
  }

  function manualTransferSelection(form) {
    const candidate = form?.settingEntryId?.value
      ? manualReceivedTransferCandidate(form.settingEntryId.value)
      : null;
    if (candidate) return { ...candidate, isReceivedEntry: true };
    const source = manualTransferSource(form?.sourceIssueId?.value || "");
    return source
      ? { source, entry: manualTransferEntry(source), available: manualTransferAvailableParts(source), isReceivedEntry: false }
      : null;
  }

  function renderManualTransferDepartments(form, source = {}) {
    const sourceGroup = departmentTransferHistoryGroupName(source.departmentName || source.process || "Setting");
    const departments = (state.karigars || []).filter((department) =>
      departmentTransferMasterGroupName(department.name, primaryDepartmentProcess(department)) !== sourceGroup
    );
    form.departmentId.innerHTML = departments.length
      ? `<option value="">Select department</option>${departments.map((department) => `<option value="${escapeHtml(department.id)}">${escapeHtml(department.name)} - ${escapeHtml(departmentProcessText(department))}</option>`).join("")}`
      : '<option value="">No other department available</option>';
    form.departmentId.value = "";
    renderManualTransferProcesses(form);
  }

  function renderManualTransferProcesses(form, selectedProcess = "") {
    const department = findById("karigars", form.departmentId.value);
    const processes = department ? departmentProcesses(department) : [];
    form.process.innerHTML = processes.length
      ? `<option value="">Select process</option>${processes.map((process) => `<option value="${escapeHtml(process)}">${escapeHtml(process)}</option>`).join("")}`
      : '<option value="">Select department first</option>';
    if (selectedProcess && processes.includes(selectedProcess)) form.process.value = selectedProcess;
    else if (processes.length === 1) form.process.value = processes[0];
  }

  function fillManualTransferWeights(form, useFullBalance) {
    const selection = manualTransferSelection(form);
    if (!selection) return;
    const { available } = selection;
    if (useFullBalance) form.grossWeight.value = weight3(available.gross);
    const requestedGross = Math.max(Number(form.grossWeight.value || 0), 0);
    const ratio = available.gross > 0 ? Math.min(requestedGross / available.gross, 1) : 0;
    form.waxStoneWeight.value = weight3(available.wax * ratio);
    form.nonGoldWeight.value = weight3(available.nonGold * ratio);
    form.dataset.componentWeightsEdited = "false";
    updateManualTransferCalculation(form);
  }

  function updateManualTransferCalculation(form = document.getElementById("setting-manual-transfer-form")) {
    if (!form) return;
    const gross = Math.max(Number(form.grossWeight.value || 0), 0);
    const wax = Math.max(Number(form.waxStoneWeight.value || 0), 0);
    const nonGold = Math.max(Number(form.nonGoldWeight.value || 0), 0);
    const net = Number(weight3(gross - wax - nonGold));
    form.netWeight.value = weight3(Math.max(net, 0));
    const dialog = form.closest("dialog");
    const values = { gw: gross, wax, other: nonGold, net: Math.max(net, 0) };
    Object.entries(values).forEach(([key, value]) => {
      const node = dialog?.querySelector(`[data-manual-transfer-${key}]`);
      if (node) node.textContent = gram(value);
    });
    const note = dialog?.querySelector("[data-manual-transfer-note]");
    const selection = manualTransferSelection(form);
    if (note && selection) {
      const { available } = selection;
      note.textContent = gross < available.gross - 0.0005
        ? `Partial transfer selected. After save, approximately ${gram(available.gross - gross)} remains in Setting. Verify the stone / non-gold contained in this part before saving.`
        : selection.isReceivedEntry
          ? `Full balance of this ${selection.entry.setterName || "setter"} receipt is selected. Other STUD BR receipts remain separate.`
          : "Full available balance is selected. The item will leave Setting and appear in the selected department with the same tracked composition.";
    }
  }

  function allocateManualTransferBreakdown(source = {}, requestedWeight = 0) {
    const requested = Number(weight3(Math.max(Number(requestedWeight || 0), 0)));
    if (requested <= 0) return {};
    const sourceBreakdown = normalizeNonGoldBreakdown(source.nonGoldBreakdown, source.nonGoldCategory, source.nonGoldWeight);
    const entries = Object.entries(sourceBreakdown)
      .map(([key, value]) => [key, Math.max(Number(value || 0), 0)])
      .filter(([, value]) => value > 0.000001);
    const sourceTotal = entries.reduce((total, [, value]) => total + value, 0);
    if (!entries.length || sourceTotal <= 0) return normalizeNonGoldBreakdown({}, source.nonGoldCategory || "stone", requested);
    const allocated = {};
    let allocatedTotal = 0;
    entries.forEach(([key, value], index) => {
      const weight = index === entries.length - 1
        ? Number(weight3(Math.max(requested - allocatedTotal, 0)))
        : Number(weight3(requested * value / sourceTotal));
      if (weight > 0) allocated[key] = weight;
      allocatedTotal = Number(weight3(allocatedTotal + weight));
    });
    return normalizeNonGoldBreakdown(allocated);
  }

  function manualTransferValidation(form, selection, destination) {
    if (!selection?.source) return "This manual item is no longer available in Setting Department.";
    const { source, available } = selection;
    if (!destination) return "Select the department where this item will be transferred.";
    const process = String(form.process.value || "").trim();
    if (!process) return "Select the registered process for the destination department.";
    const sourceGroup = departmentTransferHistoryGroupName(source.departmentName || source.process || "Setting");
    const destinationGroup = departmentTransferMasterGroupName(destination.name, process);
    if (sourceGroup === destinationGroup) return "Select a department different from the current Setting Department.";
    const gross = Number(weight3(form.grossWeight.value || 0));
    const wax = Number(weight3(form.waxStoneWeight.value || 0));
    const nonGold = Number(weight3(form.nonGoldWeight.value || 0));
    const net = Number(weight3(gross - wax - nonGold));
    if (!Number.isFinite(gross) || gross <= 0) return "Enter transfer GW greater than zero.";
    if (gross > available.gross + 0.0005) return `Transfer GW cannot exceed the available Setting balance of ${gram(available.gross)}.`;
    if (wax < 0 || wax > available.wax + 0.0005) return `Wax stone cannot exceed the available ${gram(available.wax)}.`;
    if (nonGold < 0 || nonGold > available.nonGold + 0.0005) return `Hand stone / other non-gold cannot exceed the available ${gram(available.nonGold)}.`;
    if (net < -0.0005) return "Wax stone plus non-gold cannot exceed transfer GW.";
    if (net > available.net + 0.0005) return `Net gold cannot exceed the available ${gram(available.net)}.`;
    if (wax > Number(source.waxStoneWeight || 0) + 0.0005) return "The shared Setting source does not contain enough wax stone for this transfer.";
    if (nonGold > Number(source.nonGoldWeight || 0) + 0.0005) return "The shared Setting source does not contain enough hand stone / non-gold for this transfer.";
    if (net > Number(source.netWeight || 0) + 0.0005) return "The shared Setting source does not contain enough net gold for this transfer.";
    if (!String(form.remarks.value || "").trim()) return "Enter transfer remarks for this manual movement.";
    return "";
  }

  function saveManualDepartmentTransfer(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const selection = manualTransferSelection(form);
    const source = selection?.source || null;
    const destination = findById("karigars", form.departmentId.value);
    const error = manualTransferValidation(form, selection, destination);
    if (error) {
      alert(error);
      return;
    }
    const createdAt = new Date().toISOString();
    const directTransferId = crypto.randomUUID();
    const returnId = crypto.randomUUID();
    const destinationIssueId = crypto.randomUUID();
    const grossWeight = Number(weight3(form.grossWeight.value || 0));
    const waxStoneWeight = Number(weight3(form.waxStoneWeight.value || 0));
    const nonGoldWeight = Number(weight3(form.nonGoldWeight.value || 0));
    const netWeight = Number(weight3(grossWeight - waxStoneWeight - nonGoldWeight));
    const process = String(form.process.value || "").trim();
    const remarks = String(form.remarks.value || "").trim();
    const nonGoldBreakdown = allocateManualTransferBreakdown(source, nonGoldWeight);
    const entry = selection.entry || manualTransferEntry(source);
    const reference = entry
      ? `${settingEntryReference(entry)} / ${entry.setterName || "Setter"}`
      : source.itemDescription || "Manual Production Item";
    const sourceDepartmentName = source.departmentName || "Setting Department";
    const sourceProcess = source.process || sourceDepartmentName;
    const returnEntry = normalizeSafeDepartmentReturn({
      id: returnId,
      issueId: source.id,
      receiptGroupId: directTransferId,
      date: today(),
      createdAt,
      departmentId: source.departmentId || "",
      departmentName: sourceDepartmentName,
      process: sourceProcess,
      sourceItemDescription: source.itemDescription || "Manual Production Item",
      returnedItemDescription: source.itemDescription || "Manual Production Item",
      returnType: "other",
      locker: source.locker,
      purity: source.purity,
      grossWeight,
      waxStoneWeight,
      nonGoldWeight,
      nonGoldCategory: nonGoldBreakdownCategory(nonGoldBreakdown, source.nonGoldCategory || ""),
      nonGoldBreakdown,
      nonGoldWeightKnown: true,
      netWeight,
      lossWeight: 0,
      directTransferId,
      destinationDepartmentId: destination.id,
      destinationDepartmentName: destination.name,
      destinationProcess: process,
      remarks: `${remarks}; Manual TR without Job Card; ${reference}`,
    });
    const destinationIssue = normalizeSafeDepartmentIssue({
      id: destinationIssueId,
      date: today(),
      createdAt,
      updatedAt: createdAt,
      safeItemId: "",
      itemDescription: source.itemDescription || "Manual Production Item",
      itemKind: source.itemKind || "Manual Production Item",
      colour: source.colour || "",
      source: `Manual production transfer from ${sourceDepartmentName} / ${reference}`,
      sourceLine: source.sourceLine || source.id,
      locker: source.locker,
      purity: source.purity,
      departmentId: destination.id,
      departmentName: destination.name,
      process,
      issuedGrossWeight: grossWeight,
      issuedWaxStoneWeight: waxStoneWeight,
      issuedNonGoldWeight: nonGoldWeight,
      issuedNonGoldBreakdown: nonGoldBreakdown,
      nonGoldBreakdown,
      nonGoldCategory: nonGoldBreakdownCategory(nonGoldBreakdown, source.nonGoldCategory || ""),
      nonGoldWeightKnown: true,
      issuedNetWeight: netWeight,
      grossWeight,
      waxStoneWeight,
      nonGoldWeight,
      netWeight,
      destinationMode: "department",
      directDepartmentTransfer: true,
      directTransferId,
      sourceDepartmentId: source.departmentId || "",
      sourceDepartmentName,
      sourceProcess,
      sourceReturnId: returnId,
      remarks: returnEntry.remarks,
    }, {}, state);
    state.safeDepartmentReturns = state.safeDepartmentReturns || [];
    state.safeDepartmentIssues = state.safeDepartmentIssues || [];
    state.safeDepartmentReturns.unshift(returnEntry);
    state.safeDepartmentIssues.unshift(destinationIssue);
    if (entry) {
      entry.departmentTransfers = Array.isArray(entry.departmentTransfers) ? entry.departmentTransfers : [];
      entry.departmentTransfers.unshift({
        id: directTransferId,
        date: today(),
        createdAt,
        sourceIssueId: source.id,
        destinationIssueId,
        returnId,
        departmentId: destination.id,
        departmentName: destination.name,
        process,
        grossWeight,
        waxStoneWeight,
        nonGoldWeight,
        netWeight,
        remarks,
      });
      entry.lastTransferDepartmentId = destination.id;
      entry.lastTransferDepartmentName = destination.name;
      entry.lastTransferProcess = process;
      entry.lastTransferredAt = createdAt;
      entry.updatedAt = createdAt;
    }
    state.ledger = state.ledger || [];
    state.ledger.unshift({
      id: crypto.randomUUID(),
      date: today(),
      createdAt,
      type: "Manual Production Department Transfer",
      purity: source.purity || source.locker || "-",
      weight: 0,
      reference: `${reference} / ${sourceDepartmentName} to ${destination.name} / ${process} / GW ${gram(grossWeight)} / Non-Gold ${gram(nonGoldWeight)} / Net Gold ${gram(netWeight)} / ${remarks}`,
    });
    document.getElementById("setting-manual-transfer-dialog")?.close();
    form.reset();
    saveState();
    render();
    refreshOpenDepartmentTransferHistory();
    window.KJM_SETTING_MASTER_TILES_V617?.open("manual");
    alert(`MANUAL ITEM TRANSFER SAVED.\n${reference}\nFROM: ${sourceDepartmentName}\nTO: ${destination.name} / ${process}\nGW: ${gram(grossWeight)}\nNON-GOLD: ${gram(nonGoldWeight)}\nNET GOLD: ${gram(netWeight)}\nNo Job Card was created.`);
  }

  function openSettingManualDepartmentTransfer(sourceIssueId = "") {
    if (hasValidatedLoginSession() && !canAccessProductionPage("setting")) {
      alert("This login can access only its allowed production work.");
      return;
    }
    const source = manualTransferSource(sourceIssueId);
    if (!source) {
      alert("This manual item is no longer available in Setting Department. Refresh the page and check its latest holding.");
      return;
    }
    const dialog = ensureManualTransferDialog();
    const form = document.getElementById("setting-manual-transfer-form");
    const entry = manualTransferEntry(source);
    const available = manualTransferAvailableParts(source);
    form.reset();
    form.sourceIssueId.value = source.id;
    form.settingEntryId.value = "";
    form.dataset.componentWeightsEdited = "false";
    dialog.querySelector("[data-manual-transfer-item]").textContent = source.itemDescription || "Manual Production Item";
    dialog.querySelector("[data-manual-transfer-setter]").textContent = entry
      ? `${entry.setterName || "Setter"} / ${settingEntryReference(entry)}`
      : source.source || "Manual receipt";
    dialog.querySelector("[data-manual-transfer-purity]").textContent = transferPurityLabel(source.purity || source.locker || "-");
    dialog.querySelector("[data-manual-transfer-available-gw]").textContent = gram(available.gross);
    dialog.querySelector("[data-manual-transfer-available-non-gold]").textContent = `${gram(available.nonGold)} / ${nonGoldBreakdownText(source.nonGoldBreakdown || {}, source.nonGoldCategory || "", available.nonGold) || "No non-gold"}`;
    form.grossWeight.value = weight3(available.gross);
    form.waxStoneWeight.value = weight3(available.wax);
    form.nonGoldWeight.value = weight3(available.nonGold);
    form.remarks.value = entry
      ? `${entry.setterName || "Setter"} returned manual item / Transfer without Job Card`
      : "Manual item transfer without Job Card";
    renderManualTransferDepartments(form, source);
    updateManualTransferCalculation(form);
    dialog.showModal();
    form.departmentId.focus();
  }

  function openSettingManualEntryDepartmentTransfer(entryId = "") {
    if (hasValidatedLoginSession() && !canAccessProductionPage("setting")) {
      alert("This login can access only its allowed production work.");
      return;
    }
    const candidate = manualReceivedTransferCandidate(entryId);
    if (!candidate) {
      alert("This received manual lot is no longer available in Setting Department. Refresh and check its latest transfer history.");
      return;
    }
    const { entry, source, available } = candidate;
    const dialog = ensureManualTransferDialog();
    const form = document.getElementById("setting-manual-transfer-form");
    form.reset();
    form.sourceIssueId.value = source.id;
    form.settingEntryId.value = entry.id;
    form.dataset.componentWeightsEdited = "false";
    dialog.querySelector("[data-manual-transfer-item]").textContent = `${entry.materialDescription || source.itemDescription || "Manual Production Item"} / Received ${entry.receiveDate || "-"}`;
    dialog.querySelector("[data-manual-transfer-setter]").textContent = `${entry.setterName || "Setter"} / Issue ${gram(entry.issueGw || 0)}`;
    dialog.querySelector("[data-manual-transfer-purity]").textContent = transferPurityLabel(entry.purity || source.purity || source.locker || "-");
    dialog.querySelector("[data-manual-transfer-available-gw]").textContent = gram(available.gross);
    dialog.querySelector("[data-manual-transfer-available-non-gold]").textContent = `${gram(available.nonGold)} / Manual Hand Stone`;
    form.grossWeight.value = weight3(available.gross);
    form.waxStoneWeight.value = weight3(available.wax);
    form.nonGoldWeight.value = weight3(available.nonGold);
    form.remarks.value = `${entry.setterName || "Setter"} / ${entry.materialDescription || "Manual item"} received ${entry.receiveDate || today()} / Transfer without Job Card`;
    renderManualTransferDepartments(form, source);
    updateManualTransferCalculation(form);
    dialog.showModal();
    form.departmentId.focus();
  }

  window.openSettingManualDepartmentTransfer = openSettingManualDepartmentTransfer;
  window.openSettingManualEntryDepartmentTransfer = openSettingManualEntryDepartmentTransfer;
  window.KJM_SETTING_MANUAL_TRANSFER_V618 = {
    open: openSettingManualDepartmentTransfer,
    openEntry: openSettingManualEntryDepartmentTransfer,
    source: manualTransferSource,
    candidate: manualReceivedTransferCandidate,
    calculate: manualTransferAvailableParts,
    allocateNonGold: allocateManualTransferBreakdown,
    save: saveManualDepartmentTransfer,
  };
})();
