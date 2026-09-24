(function installSettingManagerTilesV617() {
  "use strict";

  const pageTitles = {
    lots: "Lots Currently In Setting",
    pending: "Pending With Setters",
    receive: "Receive From Setter / Direct Transfer",
    issue: "Issue To Setter",
    manual: "Manual Production Items - No Job Card",
    setters: "Setter Master",
    history: "Setter Issue / Account History",
  };
  let activeSettingPage = "";

  function settingDetail(pageId = "") {
    return document.querySelector(`[data-setting-manager-detail="${pageId}"]`);
  }

  function ensureSettingPageToolbar(detail, pageId) {
    if (!detail || detail.querySelector(":scope > .setting-page-toolbar")) return;
    detail.insertAdjacentHTML("afterbegin", `
      <div class="setting-page-toolbar">
        <strong>${escapeHtml(pageTitles[pageId] || "Setting Manager")}</strong>
        <button class="ghost-button" type="button" data-setting-manager-back>Back To Setting Tiles</button>
      </div>
    `);
  }

  function closeSettingManagerPage() {
    document.querySelectorAll("[data-setting-manager-detail]").forEach((detail) => {
      detail.classList.remove("setting-manager-detail-open");
    });
    document.querySelectorAll("[data-setting-manager-page]").forEach((tile) => tile.classList.remove("active"));
    document.body.classList.remove("setting-manager-detail-active");
    activeSettingPage = "";
    document.getElementById("setting-manager-tile-menu")?.scrollIntoView({ block: "start" });
  }

  function openSettingManagerPage(pageId = "") {
    const detail = settingDetail(pageId);
    if (!detail) return false;
    document.querySelectorAll("[data-setting-manager-detail]").forEach((item) => {
      item.classList.toggle("setting-manager-detail-open", item === detail);
    });
    document.querySelectorAll("[data-setting-manager-page]").forEach((tile) => {
      tile.classList.toggle("active", tile.dataset.settingManagerPage === pageId);
    });
    ensureSettingPageToolbar(detail, pageId);
    document.body.classList.add("setting-manager-detail-active");
    activeSettingPage = pageId;
    detail.scrollTop = 0;
    detail.querySelector("select:not([disabled]), input:not([type='hidden']):not([readonly]), button:not([data-setting-manager-back])")?.focus();
    return true;
  }

  function setSettingTileCount(id, text) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  }

  function refreshSettingTileCounts() {
    const lots = settingManagerLots();
    const pending = settingPendingEntries();
    const manual = settingManualProductionSources();
    const setters = state.settingSetters || [];
    const history = state.settingManagerEntries || [];
    const pendingGw = Number(weight3(pending.reduce((total, entry) => total + Number(entry.issueGw || 0), 0)));
    setSettingTileCount("setting-tile-lots-count", `${lots.length} lot${lots.length === 1 ? "" : "s"} currently in Setting`);
    setSettingTileCount("setting-tile-pending-count", `${pending.length} lot${pending.length === 1 ? "" : "s"} / ${gram(pendingGw)} with setters`);
    setSettingTileCount("setting-tile-manual-count", `${manual.length} no-Job-Card item${manual.length === 1 ? "" : "s"} available`);
    setSettingTileCount("setting-tile-setters-count", `${setters.length} registered setter${setters.length === 1 ? "" : "s"}`);
    setSettingTileCount("setting-tile-history-count", `${history.length} issue / receive entr${history.length === 1 ? "y" : "ies"}`);
    if (activeSettingPage) openSettingManagerPage(activeSettingPage);
  }

  function settingDirectTransferEntry(form) {
    const entry = (state.settingManagerEntries || []).find((item) => item.id === form?.entryId?.value);
    if (!entry || ["Accessory", "Manual"].includes(entry.entryType) || !entry.lotId) return null;
    return entry;
  }

  function settingDirectTransferLot(form) {
    const entry = settingDirectTransferEntry(form);
    return entry ? findById("lots", entry.lotId) : null;
  }

  function renderSettingDirectProcessOptions(departmentId = "", selectedProcess = "") {
    const form = document.getElementById("setting-receive-form");
    const select = form?.directProcess;
    if (!select) return;
    const department = findById("karigars", departmentId);
    const processes = department ? departmentProcesses(department) : [];
    const selected = String(selectedProcess || "").trim();
    const values = selected && !processes.includes(selected) ? [...processes, selected] : processes;
    select.innerHTML = values.length
      ? `<option value="">Select process</option>${values.map((process) => `<option value="${escapeHtml(process)}">${escapeHtml(process)}</option>`).join("")}`
      : '<option value="">Select department first</option>';
    select.value = selected && values.includes(selected) ? selected : (values.length === 1 ? values[0] : "");
  }

  function renderSettingDirectDepartmentOptions(lot, selectedDepartmentId = "") {
    const form = document.getElementById("setting-receive-form");
    const select = form?.directDepartmentId;
    if (!select) return;
    const options = (state.karigars || [])
      .filter((department) => department.id !== lot?.karigarId)
      .map((department) => `<option value="${escapeHtml(department.id)}">${escapeHtml(department.name)} - ${escapeHtml(departmentProcessText(department))}</option>`)
      .join("");
    select.innerHTML = options ? `<option value="">Select next department</option>${options}` : '<option value="">No other department available</option>';
    select.value = (state.karigars || []).some((department) => department.id === selectedDepartmentId) ? selectedDepartmentId : "";
  }

  function applySettingDirectTransferDefault(form, lot) {
    if (!form || !lot) return;
    const nextStep = nextProductionFlowStep(lot);
    const target = nextStep ? findFlowDepartment(nextStep, lot.karigarId) : null;
    renderSettingDirectDepartmentOptions(lot, target?.id || "");
    const process = target
      ? departmentProcesses(target).find((item) => mergedProductionDepartmentName(item, target.name) === nextStep?.label)
        || departmentProcesses(target)[0]
        || nextStep?.label
        || ""
      : "";
    renderSettingDirectProcessOptions(target?.id || "", process);
    form.directRemarks.value = nextStep?.label ? `Received from setter / Next process: ${nextStep.label}` : "Received from setter and transferred directly";
  }

  function syncSettingDirectTransferFields(event) {
    const form = document.getElementById("setting-receive-form");
    if (!form) return;
    const entry = settingDirectTransferEntry(form);
    const lot = settingDirectTransferLot(form);
    const settlementType = form.settlementType.value;
    const eligible = Boolean(entry && lot && settlementType === "close" && entry.status === "Issued");
    const actionField = document.getElementById("setting-direct-action-field");
    actionField?.classList.toggle("hidden", !eligible);
    if (!eligible) form.nextAction.value = "keep";

    const selectedEntryChanged = form.dataset.directTransferEntryId !== (entry?.id || "");
    if (eligible && selectedEntryChanged) {
      form.dataset.directTransferEntryId = entry.id;
      form.nextAction.value = "keep";
      applySettingDirectTransferDefault(form, lot);
    }
    if (!eligible) form.dataset.directTransferEntryId = "";

    if (eligible && event?.target?.name === "directDepartmentId") {
      renderSettingDirectProcessOptions(form.directDepartmentId.value, "");
      const department = findById("karigars", form.directDepartmentId.value);
      const process = form.directProcess.value || departmentProcesses(department || {})[0] || "";
      if (process) renderSettingDirectProcessOptions(form.directDepartmentId.value, process);
    }
    const direct = eligible && form.nextAction.value === "transfer";
    ["setting-direct-department-field", "setting-direct-process-field", "setting-direct-remarks-field"].forEach((id) => {
      document.getElementById(id)?.classList.toggle("hidden", !direct);
    });
    form.directDepartmentId.required = direct;
    form.directProcess.required = direct;
    form.classList.toggle("setting-direct-transfer-selected", direct);
    const submit = document.getElementById("setting-receive-submit");
    if (submit && direct) submit.textContent = "Receive From Setter & Transfer";
  }

  function directTransferRequest(form, entry) {
    if (!entry || form.nextAction.value !== "transfer") return null;
    const lot = findById("lots", entry.lotId);
    if (!lot || form.settlementType.value !== "close") return null;
    const department = findById("karigars", form.directDepartmentId.value);
    const process = String(form.directProcess.value || "").trim();
    if (!department || !process) return { invalid: true };
    return {
      entryId: entry.id,
      lotId: lot.id,
      departmentId: department.id,
      departmentName: department.name,
      process,
      receiveGw: Number(weight3(form.receiveGw.value || 0)),
      handStoneWeight: Number(weight3(form.handStoneWeight.value || entry.handStoneWeight || 0)),
      remarks: String(form.directRemarks.value || "").trim() || `Received from ${entry.setterName || "setter"} / Next process: ${process}`,
      setterName: entry.setterName || "Setter",
    };
  }

  function executeSettingDirectTransfer(request) {
    const lot = findById("lots", request.lotId);
    const destination = findById("karigars", request.departmentId);
    if (!lot || !destination) return false;
    openTransferLot(lot.id);
    const transferForm = document.getElementById("transfer-form");
    if (!transferForm) return false;
    transferForm.karigarId.value = destination.id;
    renderTransferProcessOptions(destination.id, request.process);
    transferForm.toDepartment.value = request.process;
    transferForm.grossReceivedWeight.value = weight3(request.receiveGw);
    transferForm.stoneWeight.value = weight3(request.handStoneWeight);
    transferForm.reason.value = request.remarks;
    updateTransferBalance();
    transferForm.requestSubmit();
    const moved = lot.karigarId === destination.id
      && mergedProductionDepartmentName(lot.currentDepartment, lot.karigarName) === mergedProductionDepartmentName(request.process, destination.name);
    if (moved) {
      closeSettingManagerPage();
      alert(`${lot.number} received from ${request.setterName} and transferred to ${destination.name} / ${request.process}.\nReceive GW: ${gram(request.receiveGw)}\nHand Stone: ${gram(request.handStoneWeight)}`);
    }
    return moved;
  }

  const receiveForm = document.getElementById("setting-receive-form");
  const coreReceiveSettingLotFromSetter = receiveSettingLotFromSetter;
  if (receiveForm) {
    receiveForm.removeEventListener("submit", coreReceiveSettingLotFromSetter);
    receiveForm.addEventListener("submit", (event) => {
      const entry = settingDirectTransferEntry(receiveForm);
      const request = directTransferRequest(receiveForm, entry);
      if (request?.invalid) {
        event.preventDefault();
        alert("Select the next department and its registered process before receiving the lot.");
        return;
      }
      const previousStatus = entry?.status || "";
      const previousUpdatedAt = entry?.updatedAt || "";
      coreReceiveSettingLotFromSetter(event);
      const savedEntry = request ? (state.settingManagerEntries || []).find((item) => item.id === request.entryId) : null;
      const receiptSaved = savedEntry?.status === "Received"
        && (previousStatus !== savedEntry.status || previousUpdatedAt !== savedEntry.updatedAt);
      if (request && receiptSaved) executeSettingDirectTransfer(request);
    });
    receiveForm.addEventListener("input", syncSettingDirectTransferFields);
    receiveForm.addEventListener("change", syncSettingDirectTransferFields);
  }

  const coreRenderSettingManager = renderSettingManager;
  renderSettingManager = function renderSettingManagerTilesV617() {
    coreRenderSettingManager.call(this);
    refreshSettingTileCounts();
    syncSettingDirectTransferFields();
  };

  const coreOpenSettingIssueForLot = openSettingIssueForLot;
  openSettingIssueForLot = function openSettingIssueForLotTileV617(lotId) {
    coreOpenSettingIssueForLot.call(this, lotId);
    openSettingManagerPage("issue");
  };

  const coreOpenSettingManualProductionSource = openSettingManualProductionSource;
  openSettingManualProductionSource = function openSettingManualProductionSourceTileV617(sourceId) {
    coreOpenSettingManualProductionSource.call(this, sourceId);
    openSettingManagerPage("issue");
  };

  const coreOpenSettingReceive = openSettingReceive;
  openSettingReceive = function openSettingReceiveTileV617(entryId) {
    coreOpenSettingReceive.call(this, entryId);
    openSettingManagerPage("receive");
    syncSettingDirectTransferFields();
  };

  const coreEditSettingSetter = editSettingSetter;
  editSettingSetter = function editSettingSetterTileV617(setterId) {
    coreEditSettingSetter.call(this, setterId);
    openSettingManagerPage("setters");
  };

  const coreSwitchProductionPageV617 = switchProductionPage;
  switchProductionPage = function switchProductionPageSettingTilesV617(pageId) {
    if (pageId !== "setting") closeSettingManagerPage();
    return coreSwitchProductionPageV617.call(this, pageId);
  };

  const coreSwitchViewV617 = switchView;
  switchView = function switchViewSettingTilesV617(viewId) {
    if (viewId !== "production") closeSettingManagerPage();
    return coreSwitchViewV617.call(this, viewId);
  };

  document.getElementById("production-page-setting")?.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-setting-manager-page]");
    if (tile) openSettingManagerPage(tile.dataset.settingManagerPage || "");
    if (event.target.closest("[data-setting-manager-back]")) closeSettingManagerPage();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !activeSettingPage) return;
    if (document.querySelector("dialog[open]")) return;
    event.preventDefault();
    closeSettingManagerPage();
  });

  refreshSettingTileCounts();
  syncSettingDirectTransferFields();

  window.KJM_SETTING_MASTER_TILES_V617 = {
    open: openSettingManagerPage,
    close: closeSettingManagerPage,
    refresh: refreshSettingTileCounts,
    syncDirectTransfer: syncSettingDirectTransferFields,
  };
})();
