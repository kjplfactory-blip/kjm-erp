(function enableSequentialNumberingV714() {
  "use strict";
  document.documentElement.dataset.sequentialNumberingV714 = "loading";

  const RPC_NAME = "reserve_erp_identifiers_v714";
  const START = Object.freeze({ job: 1813, production: 4704, bill: 72 });
  const STATE_FIELD = Object.freeze({
    job: "nextSequentialJobV714",
    production: "nextSequentialProductionV714",
    bill: "nextSequentialBillV714",
  });
  const pools = { job: [], production: [], bill: [] };
  const RESERVATION_TIMEOUT_MS = Math.max(Number(SUPABASE_REVISION_TIMEOUT_MS || 0), 30000);
  let setupMissing = false;
  let reservationPromise = null;

  function serial(value = "", prefix = "") {
    const match = String(value || "").trim().match(new RegExp(`^${prefix}-(\\d+)(?:\\D|$)`, "i"));
    return match ? Number(match[1]) : 0;
  }

  function usedSerials(kind = "", currentState = state) {
    const used = new Set();
    if (kind === "job") {
      (currentState.orders || []).forEach((order) => {
        const value = serial(order.jobNumber, "JOB");
        if (value) used.add(value);
      });
      return used;
    }
    if (kind === "production") {
      (currentState.orders || []).forEach((order) => {
        [order.productionNo, order.number, order.barcode].forEach((code) => {
          const value = serial(code, "PR");
          if (value) used.add(value);
        });
      });
      return used;
    }
    (currentState.bills || []).forEach((bill) => {
      const value = serial(bill.billNo, "BILL");
      if (value) used.add(value);
    });
    (currentState.lots || []).forEach((lot) => {
      const value = serial(lot.bill?.billNo, "BILL");
      if (value) used.add(value);
    });
    return used;
  }

  function nextLocalSerial(kind = "", currentState = state, commit = true) {
    const field = STATE_FIELD[kind];
    const used = usedSerials(kind, currentState);
    let value = Math.max(START[kind] || 1, Number(currentState[field] || 0) || 0);
    while (used.has(value)) value += 1;
    if (commit) currentState[field] = value + 1;
    return value;
  }

  function allocateSerial(kind = "", currentState = state) {
    const configured = Boolean(supabaseSettings.url && supabaseSettings.anonKey);
    const reserved = Number(pools[kind]?.shift() || 0);
    if (configured && !reserved) {
      throw new Error(`${kind.toUpperCase()} number was not reserved. Wait for Sync: Live and save again.`);
    }
    if (reserved && usedSerials(kind, currentState).has(reserved)) {
      throw new Error(`${kind.toUpperCase()}-${reserved} already exists on this laptop. Refresh Live Data before saving.`);
    }
    const value = reserved || nextLocalSerial(kind, currentState, false);
    currentState[STATE_FIELD[kind]] = Math.max(Number(currentState[STATE_FIELD[kind]] || 0), value + 1);
    return value;
  }

  function missingRpc(error) {
    const detail = `${error?.code || ""} ${error?.message || error || ""}`.toLowerCase();
    return detail.includes(RPC_NAME)
      && (detail.includes("schema cache") || detail.includes("does not exist") || detail.includes("permission"));
  }

  async function reserveExact(requests = {}) {
    const needed = Object.fromEntries(Object.keys(pools).map((kind) => [
      kind,
      Math.max(0, Math.min(1000, Number(requests[kind] || 0) - pools[kind].length)),
    ]));
    if (!Object.values(needed).some(Boolean)) return true;
    if (!supabaseSettings.url || !supabaseSettings.anonKey) return true;
    if (!supabaseClient) {
      throw new Error("Cloud numbering is still connecting. Wait for Sync: Live, then save again. No record was created.");
    }
    if (setupMissing) {
      throw new Error("Run SUPABASE-SEQUENTIAL-NUMBERS-v714.sql once in Supabase, then refresh the ERP.");
    }
    while (reservationPromise) await reservationPromise;
    reservationPromise = (async () => {
      const result = await withSupabaseTimeout(
        supabaseClient.rpc(RPC_NAME, {
          p_state_id: supabaseStateId,
          p_job_count: needed.job,
          p_production_count: needed.production,
          p_bill_count: needed.bill,
          p_device_id: loginDeviceId(),
          p_app_version: APP_VERSION,
        }),
        "Sequential number reservation timed out.",
        RESERVATION_TIMEOUT_MS,
      );
      if (result?.error) {
        if (missingRpc(result.error)) setupMissing = true;
        throw new Error(missingRpc(result.error)
          ? "Run SUPABASE-SEQUENTIAL-NUMBERS-v714.sql once in Supabase, then refresh the ERP."
          : `Cloud numbering failed: ${result.error.message || result.error}. No record was created.`);
      }
      const rows = Array.isArray(result?.data) ? result.data : [];
      rows.forEach((row) => {
        const kind = String(row.serial_kind || "").toLowerCase();
        const value = Number(row.serial_value || 0);
        if (pools[kind] && value > 0) pools[kind].push(value);
      });
      const incomplete = Object.keys(needed).find((kind) => pools[kind].length < Number(requests[kind] || 0));
      if (incomplete) throw new Error(`Cloud returned an incomplete ${incomplete.toUpperCase()} sequence. No record was created.`);
      return true;
    })();
    try {
      return await reservationPromise;
    } finally {
      reservationPromise = null;
    }
  }

  nextJobCardNumber = function nextJobCardNumberV714(currentState = state) {
    const value = allocateSerial("job", currentState);
    currentState.nextJob = Math.max(Number(currentState.nextJob || 0), value + 1);
    if (typeof syncLegacyOrderSerial === "function") syncLegacyOrderSerial(currentState);
    return `JOB-${value}`;
  };

  nextProductionNumber = function nextProductionNumberV714(currentState = state, usedCodes = null) {
    const codes = usedCodes || new Set();
    let value = allocateSerial("production", currentState);
    let code = `PR-${String(value).padStart(6, "0")}`;
    if (codes.has(code)) throw new Error(`${code} is already used. Refresh Live Data before saving.`);
    currentState.nextProduction = Math.max(Number(currentState.nextProduction || 0), value + 1);
    if (typeof syncLegacyOrderSerial === "function") syncLegacyOrderSerial(currentState);
    codes.add(code);
    return code;
  };

  nextBillNumber = function peekBillNumberV714() {
    const value = Number(pools.bill[0] || 0) || nextLocalSerial("bill", state, false);
    return `BILL-${String(value).padStart(4, "0")}`;
  };

  function fittingItemCount(form) {
    const data = getFormData(form);
    const baseItem = itemEditDataToOrderItem(data);
    if (!hasOrderItemDetails(baseItem)) return 0;
    return expandOrderItemCombinations(baseItem).filter(hasOrderItemDetails).length;
  }

  function requestsForSubmit(form) {
    if (form.id === "order-form") {
      const items = getOrderFormItems(form);
      return items.length ? { job: 1, production: items.length } : null;
    }
    // Special fitting cards deliberately have no PR item, so reserve only a Job Card number.
    if (form.id === "fitting-accessories-job-form") return { job: 1 };
    if (form.id === "office-return-lot-form") {
      const purpose = String(form.elements?.purpose?.value || "").trim().toLowerCase();
      return purpose === "melting" ? null : { job: 1 };
    }
    if (form.id === "production-return-form") {
      const reason = String(form.elements?.reason?.value || "").trim();
      return /melt|dismant/i.test(reason) ? null : { job: 1 };
    }
    if (form.id === "melting-receive-form") {
      const data = getFormData(form);
      const melting = findById("melting", data.meltingId);
      return melting && fittingItemsCardRequested(data, melting) ? { job: 1, production: 1 } : null;
    }
    if (form.id === "fitting-items-split-form") return { production: 1 };
    if (form.id === "item-edit-form" && form.dataset.mode === "add") {
      const count = fittingItemCount(form);
      return count ? { production: count } : null;
    }
    if (form.id === "manual-wip-billing-form") {
      const action = getFormData(form).action;
      return ["assign-job", "combined-job-bill"].includes(action) ? null : { production: 1 };
    }
    if (form.id === "bill-form") return { bill: 1 };
    return null;
  }

  function requestTotal(requests = {}) {
    return Object.values(requests).reduce((total, value) => total + Number(value || 0), 0);
  }

  async function interceptNumberedSubmit(event) {
    const form = event.target;
    const requests = requestsForSubmit(form);
    if (!requests || !requestTotal(requests)) return;
    if (form.id === "bill-form") {
      const lot = findById("lots", form.lotId?.value || "");
      const existing = lot?.bill || state.bills?.find((bill) => bill.lotId === lot?.id);
      if (existing?.id) return;
      if (form.dataset.v714ReservedBillNo && form.billNo.value === form.dataset.v714ReservedBillNo) return;
    }
    if (form.dataset.v714SequenceReady === "true") {
      delete form.dataset.v714SequenceReady;
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const submitter = event.submitter;
    if (submitter) submitter.disabled = true;
    try {
      await reserveExact(requests);
      if (form.id === "order-form" && typeof confirmJobOrderPrAssignment === "function") {
        const confirmed = confirmJobOrderPrAssignment(form, {
          jobSerial: Number(pools.job[0] || 0),
          productionSerials: pools.production.slice(0, Number(requests.production || 0)),
        });
        if (!confirmed) {
          if (submitter) submitter.disabled = false;
          return;
        }
      }
      if (form.id === "bill-form") {
        const billNo = `BILL-${String(allocateSerial("bill", state)).padStart(4, "0")}`;
        form.billNo.value = billNo;
        form.dataset.v714ReservedBillNo = billNo;
      }
      form.dataset.v714SequenceReady = "true";
      if (submitter) submitter.disabled = false;
      form.requestSubmit(submitter || undefined);
    } catch (error) {
      if (submitter) submitter.disabled = false;
      alert(error?.message || "The next number could not be reserved. No record was created.");
    }
  }

  async function interceptPendingBillPrint(event) {
    const button = event.target.closest?.("#print-bill, #print-packing-list, #print-bill-tags, #print-bill-tags-a6");
    if (!button || button.dataset.v714PrintReady === "true") {
      if (button) delete button.dataset.v714PrintReady;
      return;
    }
    const form = document.getElementById("bill-form");
    const lot = findById("lots", form?.lotId?.value || "");
    const existing = lot?.bill || state.bills?.find((bill) => bill.lotId === lot?.id);
    if (!form || !lot || existing?.id) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      if (!(form.dataset.v714ReservedBillNo && form.billNo.value === form.dataset.v714ReservedBillNo)) {
        await reserveExact({ bill: 1 });
        const billNo = `BILL-${String(allocateSerial("bill", state)).padStart(4, "0")}`;
        form.billNo.value = billNo;
        form.dataset.v714ReservedBillNo = billNo;
      }
      button.dataset.v714PrintReady = "true";
      button.click();
    } catch (error) {
      alert(error?.message || "The Bill number could not be reserved. Nothing was printed or saved.");
    }
  }

  document.addEventListener("submit", interceptNumberedSubmit, true);
  document.addEventListener("click", interceptPendingBillPrint, true);
  document.getElementById("bill-dialog")?.addEventListener("close", () => {
    const form = document.getElementById("bill-form");
    if (!form) return;
    delete form.dataset.v714SequenceReady;
    delete form.dataset.v714ReservedBillNo;
  });

  window.KJM_SEQUENTIAL_NUMBERING_V714 = Object.freeze({
    starts: START,
    reserveExact,
    usedSerials,
    peek(kind) {
      return Number(pools[kind]?.[0] || 0) || nextLocalSerial(kind, state, false);
    },
  });
  document.documentElement.dataset.sequentialNumberingV714 = "ready";
})();
