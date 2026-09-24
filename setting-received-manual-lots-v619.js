(function installSettingReceivedManualLotsV619() {
  "use strict";

  function receivedManualCandidates() {
    const api = window.KJM_SETTING_MANUAL_TRANSFER_V618;
    if (!api?.candidate) return [];
    return (state.settingManagerEntries || [])
      .filter((entry) => entry.entryType === "Manual" && entry.status === "Received")
      .map((entry) => api.candidate(entry.id))
      .filter(Boolean)
      .sort((left, right) => String(right.entry.updatedAt || right.entry.receiveDate || "").localeCompare(String(left.entry.updatedAt || left.entry.receiveDate || "")));
  }

  function remainingUnassignedSources(candidates = []) {
    const claimedBySource = candidates.reduce((map, candidate) => {
      map.set(candidate.source.id, Number(weight3((map.get(candidate.source.id) || 0) + candidate.available.gross)));
      return map;
    }, new Map());
    return settingManualProductionSources()
      .map((source) => ({
        source,
        extraGw: Number(weight3(Math.max(Number(source.availableGw || 0) - Number(claimedBySource.get(source.id) || 0), 0))),
      }))
      .filter((item) => item.extraGw > 0.0005);
  }

  function receivedManualRow(candidate) {
    const { entry, source, available } = candidate;
    const transferredCount = (entry.departmentTransfers || []).length;
    const transferText = transferredCount
      ? `${transferredCount} earlier transfer${transferredCount === 1 ? "" : "s"} / balance shown`
      : "Not yet transferred";
    return `
      <tr class="setting-received-manual-row">
        <td><strong>${escapeHtml(entry.issueDate || "-")}</strong><br><small>Received ${escapeHtml(entry.receiveDate || "-")}</small></td>
        <td><strong>${escapeHtml(entry.materialDescription || source.itemDescription || "Manual Production Item")}</strong><br><small>${escapeHtml(entry.materialType || source.itemKind || "Manual Item")}</small></td>
        <td><strong>${escapeHtml(entry.setterName || "Setter")}</strong><br><small>No Job Card / No PR</small></td>
        <td>${escapeHtml(transferPurityLabel(entry.purity || source.purity || source.locker || "-"))}</td>
        <td><strong>${gram(available.gross)}</strong><br><small>Issue ${gram(entry.issueGw || 0)} / Received ${gram(entry.receiveGw || 0)}</small></td>
        <td><strong>${gram(available.nonGold)}</strong><br><small>Manual Hand Stone</small></td>
        <td><strong>${gram(available.net)}</strong><br><small>Received Net</small></td>
        <td>${escapeHtml(source.process || source.departmentName || "Setting")}<br><small>${escapeHtml(transferText)}</small></td>
        <td><button type="button" onclick="openSettingManualEntryDepartmentTransfer('${entry.id}')">Transfer This Receipt</button></td>
      </tr>
    `;
  }

  function unassignedManualRow(item) {
    const { source, extraGw } = item;
    const issue = safeDepartmentIssuesInHand().find((entry) => entry.id === source.id) || {};
    const ratio = Number(source.availableGw || 0) > 0 ? extraGw / Number(source.availableGw || 1) : 0;
    const nonGold = Number(weight3(Number(issue.nonGoldWeight || 0) * ratio));
    const net = Number(weight3(Math.max(extraGw - nonGold, 0)));
    return `
      <tr>
        <td>${escapeHtml(source.date || "-")}</td>
        <td><strong>${escapeHtml(source.materialDescription || "Manual Production Item")}</strong><br><small>${escapeHtml(source.materialType || "Production Item")}</small></td>
        <td><strong>Unassigned Manual Stock</strong><br><small>No Job Card / No PR</small></td>
        <td>${escapeHtml(transferPurityLabel(source.purity || "-"))}</td>
        <td><strong>${gram(extraGw)}</strong></td>
        <td>${gram(nonGold)}</td>
        <td><strong>${gram(net)}</strong></td>
        <td>${escapeHtml(source.departmentName || "Setting")}<br><small>${escapeHtml(source.remarks || "Available")}</small></td>
        <td><div class="row-actions"><button type="button" onclick="openSettingManualProductionSource('${source.id}')">Issue To Setter</button><button class="ghost-button" type="button" onclick="openSettingManualDepartmentTransfer('${source.id}')">Transfer Stock</button></div></td>
      </tr>
    `;
  }

  function renderReceivedManualLots() {
    const table = document.getElementById("setting-manager-manual-table");
    if (!table) return;
    const candidates = receivedManualCandidates();
    const unassigned = remainingUnassignedSources(candidates);
    table.innerHTML = [
      ...candidates.map(receivedManualRow),
      ...unassigned.map(unassignedManualRow),
    ].join("") || tableEmpty(9, "No received Manual Production Item / No Job Card is currently available in Setting Department.");
    const tileCount = document.getElementById("setting-tile-manual-count");
    if (tileCount) {
      const receiptText = `${candidates.length} received manual lot${candidates.length === 1 ? "" : "s"}`;
      const stockText = unassigned.length ? ` / ${unassigned.length} unassigned stock item${unassigned.length === 1 ? "" : "s"}` : "";
      tileCount.textContent = `${receiptText}${stockText} ready`;
    }
  }

  const previousRenderSettingManager = renderSettingManager;
  renderSettingManager = function renderSettingManagerReceivedLotsV619() {
    previousRenderSettingManager.call(this);
    renderReceivedManualLots();
  };

  renderReceivedManualLots();

  window.KJM_SETTING_RECEIVED_MANUAL_LOTS_V619 = {
    render: renderReceivedManualLots,
    candidates: receivedManualCandidates,
  };
})();
