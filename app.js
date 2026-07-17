if (!globalThis.structuredClone) {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}
if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function replaceAll(search, replacement) {
    return this.split(search).join(replacement);
  };
}
if (!globalThis.crypto) globalThis.crypto = {};
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto.randomUUID = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = globalThis.crypto.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint8Array(1))[0] & 15
      : Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 3) | 8;
    return value.toString(16);
  });
}

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const weight3 = (value) => Number(value || 0).toFixed(3);
const gram = (value) => `${weight3(value)} g`;
const optionalGram = (value) => Number(value || 0) > 0 ? gram(value) : "-";
const today = () => new Date().toLocaleDateString("en-IN");
const isoToday = () => new Date().toISOString().slice(0, 10);
const supabaseSettings = window.KJM_SUPABASE || {};
const supabaseStateId = supabaseSettings.stateId || "khushali-jewells-main";
const MAX_PRODUCTION_DAYS = 10;
const SUPABASE_POLL_INTERVAL_MS = 10000;
const LOCAL_STATE_KEY = "gold-jewellery-erp-state";
const LOCAL_PENDING_STATE_KEY = "gold-jewellery-erp-pending-state-v2";
let supabaseClient = null;
let supabaseLibraryPromise = null;
let supabaseClientPromise = null;
let supabaseAuthSubscription = null;
let supabaseSaveTimer = null;
let supabaseRetryTimer = null;
let supabasePollTimer = null;
let supabaseRealtimeChannel = null;
let deferredRemoteRenderTimer = null;
let pendingRemoteRecord = null;
let localSavePending = false;
let localSaveRevision = 0;
let lastSupabaseUpdatedAt = "";
let serverState = null;
let serverRevision = -1;
let saveInFlight = false;
let mergeConflictCount = 0;
let cloudStateReady = false;
let lastSyncFailure = null;
const dirtyForms = new WeakSet();

const users = {
  owner: { name: "Owner", role: "owner", pages: "all" },
  order: { name: "Order Dept", role: "order", pages: ["customers", "designs", "stone-library", "orders"] },
  manager: { name: "Manager Dept", role: "manager", pages: ["dashboard", "customers", "designs", "stone-library", "orders", "production", "billing"] },
  bill: { name: "Bill Dept", role: "bill", pages: ["billing"] },
  officeMain: { name: "Office Main Dept", role: "office-main", pages: ["orders", "office"], canEditOfficeWeights: true },
  officeOps: { name: "Office Operations", role: "office-ops", pages: ["orders", "office"], canEditOfficeWeights: false },
  sales1: { name: "Sales Team 1", role: "sales", pages: ["office"], salesTeam: "Sales Team 1" },
  sales2: { name: "Sales Team 2", role: "sales", pages: ["office"], salesTeam: "Sales Team 2" },
  sales3: { name: "Sales Team 3", role: "sales", pages: ["office"], salesTeam: "Sales Team 3" },
  sales4: { name: "Sales Team 4", role: "sales", pages: ["office"], salesTeam: "Sales Team 4" },
};

const demoState = {
  nextOrder: 1004,
  nextLot: 204,
  customers: [
    { id: crypto.randomUUID(), name: "Shree Jewellers", phone: "", city: "", gst: "", address: "" },
    { id: crypto.randomUUID(), name: "Mehta Gold", phone: "", city: "", gst: "", address: "" },
    { id: crypto.randomUUID(), name: "Retail Counter", phone: "", city: "", gst: "", address: "" },
  ],
  officeCustomers: [],
  designs: [],
  stones: [],
  bills: [],
  stoneOptions: { stoneType: [], shape: [], size: [] },
  stoneLibrarySeeded: false,
  orders: [
    { id: crypto.randomUUID(), number: "JO-1001", customer: "Shree Jewellers", item: "22K Chain", purity: "22K", targetWeight: 45, dueDate: "2026-07-20", status: "In Production" },
    { id: crypto.randomUUID(), number: "JO-1002", customer: "Mehta Gold", item: "Bangle Pair", purity: "22K", targetWeight: 62, dueDate: "2026-07-24", status: "Pending" },
    { id: crypto.randomUUID(), number: "JO-1003", customer: "Retail Counter", item: "18K Ring", purity: "18K", targetWeight: 8.5, dueDate: "2026-07-18", status: "Pending" },
  ],
  lots: [],
  melting: [],
  karigars: [
    { id: crypto.randomUUID(), name: "Casting Department", speciality: "Casting", rate: 720 },
    { id: crypto.randomUUID(), name: "Setting Department", speciality: "Stone setting", rate: 650 },
    { id: crypto.randomUUID(), name: "Polishing Department", speciality: "Polishing", rate: 280 },
  ],
  ledger: [
    { id: crypto.randomUUID(), date: today(), type: "In", purity: "24K", weight: 500, reference: "Opening stock" },
    { id: crypto.randomUUID(), date: today(), type: "In", purity: "22K", weight: 250, reference: "Customer gold" },
  ],
};

let state = loadState();
let currentUser = null;
let stoneLibraryPage = 1;
const stoneLibraryPageSize = 100;

const pageInfo = {
  dashboard: ["Dashboard", "Track raw gold, production stock, office stock, orders, wastage, and finished jewellery separately."],
  customers: ["Customers", "Add, edit, and manage customer details."],
  designs: ["Designs", "Upload and manage jewellery designs for stock and customer orders."],
  "stone-library": ["Stone Library", "Master list of stone type, size, weight per pc, and price per pc."],
  orders: ["Job Orders", "Create and monitor customer jewellery manufacturing orders."],
  production: ["Production", "Issue gold to departments and complete finished lots."],
  billing: ["Bill", "Create bills for completed job cards."],
  office: ["Office", "View QC OK items received from Sales Office for further process."],
  stock: ["Raw Gold Stock", "Maintain only raw gold movement ledger. Production stock and office stock are separate."],
  melting: ["Melting", "Convert source gold into desired purity and colour."],
  karigars: ["Departments", "Manage department master data and process rates."],
  "transfer-history": ["Transfer History", "Online one-line history for every lot transfer."],
  reports: ["Reports", "Review wastage, making charges, and completed orders."],
};

const productionFlow = [
  { label: "Filing / Fitting", matches: ["filer", "filing", "fitting", "back to filer"], departmentMatches: ["filer", "filing", "fitting", "vinod"] },
  { label: "Paper", matches: ["paper"], departmentMatches: ["paper"] },
  { label: "EP", matches: ["ep", "electro", "electro polishing"], departmentMatches: ["ep", "electro", "electro polish", "electro polishing"] },
  { label: "PP", matches: ["pp", "pre polish", "pre polishing"], departmentMatches: ["pp", "pre polish", "pre polishing"] },
  { label: "Setting", matches: ["setting"], departmentMatches: ["setting"] },
  { label: "Filing / Fitting", matches: ["fitting", "filer", "filing", "back to filer"], departmentMatches: ["fitting", "vinod", "filer", "filing"] },
  { label: "Final Polish", matches: ["final polish", "final polishing"], departmentMatches: ["final polish", "final polishing", "polishing department", "polishing dept", "polishing", "polish"] },
];

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll("[data-order-page]").forEach((button) => {
  button.addEventListener("click", () => switchOrderPage(button.dataset.orderPage));
});

document.querySelectorAll("[data-design-page]").forEach((button) => {
  button.addEventListener("click", () => switchDesignPage(button.dataset.designPage));
});

document.querySelectorAll("[data-stone-page]").forEach((button) => {
  button.addEventListener("click", () => switchStonePage(button.dataset.stonePage));
});

document.querySelectorAll("[data-production-page]").forEach((button) => {
  button.addEventListener("click", () => switchProductionPage(button.dataset.productionPage));
});

document.querySelectorAll("[data-office-page]").forEach((button) => {
  button.addEventListener("click", () => switchOfficePage(button.dataset.officePage));
});

document.getElementById("close-office-details").addEventListener("click", () => {
  document.getElementById("office-details-dialog").close();
});

document.getElementById("open-stone-entry").addEventListener("click", openStoneEntryDialog);
document.getElementById("close-stone-entry").addEventListener("click", () => {
  document.getElementById("stone-entry-dialog").close();
});

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const errorElement = document.getElementById("login-error");
  errorElement.textContent = "Signing in...";
  try {
    await ensureSupabaseClient();
    const loginId = normalizeLoginId(data.loginId);
    if (!users[loginId]) throw new Error("Unknown Staff ID.");
    const { data: authData, error } = await supabaseClient.auth.signInWithPassword({
      email: authEmailForLoginId(loginId),
      password: data.password,
    });
    if (error) throw error;
    await setCurrentUserFromAuth(authData.user);
    await loadSupabaseState();
    startBackgroundSync();
    migrateLegacyDesignImages().catch((migrationError) => {
      console.warn("Legacy design images are waiting for cloud migration.", migrationError);
    });
    errorElement.textContent = "";
    event.target.reset();
    applyLoginState();
  } catch (error) {
    currentUser = null;
    await supabaseClient?.auth.signOut();
    applyLoginState();
    errorElement.textContent = friendlyLoginError(error);
  }
});

document.getElementById("logout").addEventListener("click", async () => {
  await flushPendingStateBeforeLogout();
  if (localSavePending && !confirm("Some changes are still waiting for cloud sync. Log out anyway?")) return;
  stopBackgroundSync(true);
  await supabaseClient?.auth.signOut();
  currentUser = null;
  applyLoginState();
});

window.addEventListener("focus", () => {
  if (currentUser) refreshSupabaseState();
});

document.addEventListener("visibilitychange", () => {
  if (currentUser && document.visibilityState === "visible") refreshSupabaseState();
});

window.addEventListener("online", () => {
  if (currentUser) refreshSupabaseState();
});

window.addEventListener("beforeunload", (event) => {
  if (!localSavePending) return;
  event.preventDefault();
  event.returnValue = "";
});

document.addEventListener("input", trackDirtyForm, true);
document.addEventListener("change", trackDirtyForm, true);
document.addEventListener("reset", (event) => clearFormDirty(event.target), true);
document.addEventListener("close", (event) => {
  if (event.target instanceof HTMLDialogElement) {
    event.target.querySelectorAll("form").forEach(clearFormDirty);
  }
}, true);

document.getElementById("sync-now").addEventListener("click", async () => {
  if (!currentUser) return;
  if (deferredRemoteRenderTimer) {
    if (isUserActivelyEditing() && !confirm("Show the latest cloud data now? Unsaved text in an open form will be cleared.")) return;
    document.querySelectorAll("form").forEach((form) => {
      if (!dirtyForms.has(form)) return;
      form.reset();
      clearFormDirty(form);
    });
    renderSyncedState(true);
    setSyncStatus(syncedStatusText(), "live");
  }
  if (localSavePending) await syncStateToSupabase();
  await refreshSupabaseState();
});

document.getElementById("reset-demo").addEventListener("click", () => {
  if (!isOwner()) {
    alert("Only Owner can reset data.");
    return;
  }
  if (!confirm("Remove only job cards and production history? Departments and stock will remain.")) return;
  clearJobCards();
  saveState();
  render();
});

document.getElementById("order-form").addEventListener("submit", (event) => {
  event.preventDefault();
  updateOrderDueDate(event.target);
  const data = getFormData(event.target);
  const customer = findById("customers", data.customerId);
  if (!customer) {
    alert("Add or select a customer first.");
    return;
  }
  const items = getOrderFormItems(event.target);
  if (!items.length) {
    alert("Press Add Item first. Only added items will be saved in the job card.");
    return;
  }
  const jobNumber = `JOB-${state.nextOrder}`;
  items.forEach((item) => {
    const productionNo = `PR-${state.nextOrder++}`;
    state.orders.push({
      id: crypto.randomUUID(),
      number: productionNo,
      jobNumber,
      productionNo,
      barcode: productionNo,
      customerId: customer.id,
      customer: customer.name,
      designId: item.designId,
      designNumber: designLabel(item.designId),
      category: item.category,
      item: item.item || designLabel(item.designId) || item.category || item.remarks,
      size: item.size,
      ringType: item.ringType,
      clSize: item.clSize,
      cgSize: item.cgSize,
      color: item.color,
      purity: item.purity,
      targetWeight: 0,
      remarks: item.remarks,
      orderDate: data.orderDate,
      productionDays: Number(data.productionDays),
      dueDate: data.dueDate,
      urgent: data.urgent === "on",
      status: "Pending",
    });
  });
  event.target.reset();
  setDefaultOrderDates(event.target);
  resetOrderItemRows();
  saveState();
  render();
  switchOrderPage("active");
});

document.getElementById("design-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = getFormData(form);
  const existing = data.designId ? findById("designs", data.designId) : null;
  const imageFiles = [...form.image.files];
  const stoneChartFile = form.stoneChart.files[0];
  const status = document.getElementById("design-upload-status");
  const submitButton = document.getElementById("design-submit");
  if (!existing && imageFiles.length > 500) {
    alert("Please select maximum 500 design images at one time.");
    return;
  }
  submitButton.disabled = true;
  const previousDesigns = [...state.designs];
  try {
    if (existing) {
      const imageFile = imageFiles[0];
      const designName = designNameFromFile(imageFile?.name) || existing.number;
      if (imageFile) await saveDesignImage(existing.id, await compressImageFile(imageFile));
      if (stoneChartFile) await saveStoneChartImage(existing.id, await compressStoneChartImage(stoneChartFile));
      const design = {
        id: existing.id,
        number: data.number || designName,
        name: data.name || data.number || designName,
        category: data.category,
        stoneDetails: existing.stoneDetails || "",
        stoneItems: existing.stoneItems || [],
        hasStoneChart: existing.hasStoneChart || Boolean(stoneChartFile),
      };
      Object.assign(existing, design);
      updateDesignReferences(existing);
    } else {
      if (!imageFiles.length) {
        alert("Select one or more design images.");
        return;
      }
      const designs = [];
      const stoneChartData = stoneChartFile ? await compressStoneChartImage(stoneChartFile) : "";
      for (const [index, file] of imageFiles.entries()) {
        const designName = designNameFromFile(file.name);
        const id = crypto.randomUUID();
        status.textContent = `Uploading ${index + 1} of ${imageFiles.length}: ${designName}`;
        await saveDesignImage(id, await compressImageFile(file));
        if (stoneChartData) await saveStoneChartImage(id, stoneChartData);
        designs.push({
          id,
          number: designName,
          name: designName,
          category: data.category,
          stoneDetails: "",
          stoneItems: [],
          hasStoneChart: Boolean(stoneChartData),
        });
      }
      state.designs.push(...designs);
    }
    form.reset();
    resetDesignForm();
    saveState();
    render();
    status.textContent = existing ? "Design updated." : `${imageFiles.length} design image(s) uploaded.`;
  } catch (error) {
    state.designs = previousDesigns;
    alert("Upload could not be saved. Try fewer images or smaller image files.");
    status.textContent = "Upload could not be saved. Please try a smaller batch.";
  } finally {
    submitButton.disabled = false;
  }
});

document.getElementById("cancel-design-edit").addEventListener("click", resetDesignForm);

document.getElementById("design-search").addEventListener("input", renderDesigns);

document.getElementById("stone-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const existing = data.stoneId ? findById("stones", data.stoneId) : null;
  const stone = {
    id: existing?.id || crypto.randomUUID(),
    stoneType: data.stoneType,
    shape: data.shape,
    size: data.size,
    code: stoneLookupCode(data),
    weightPerPc: formatStoneWeight(data.weightPerPc),
    pricePerPc: data.pricePerPc,
    remarks: data.remarks,
  };
  if (existing) {
    Object.assign(existing, stone);
  } else {
    state.stones.unshift(stone);
  }
  resetStoneForm();
  saveState();
  render();
});

document.getElementById("cancel-stone-edit").addEventListener("click", resetStoneForm);

document.getElementById("stone-form").addEventListener("change", (event) => {
  if (["stoneType", "shape", "size"].includes(event.target.name)) {
    handleStoneFormChange(event.target.name);
  }
});

document.querySelectorAll("[data-add-stone-option]").forEach((button) => {
  button.addEventListener("click", () => addStoneDropdownOption(button.dataset.addStoneOption));
});

document.getElementById("stone-search").addEventListener("input", () => {
  stoneLibraryPage = 1;
  renderStoneLibrary();
});

["stone-lookup-type", "stone-lookup-shape", "stone-lookup-size"].forEach((id) => {
  document.getElementById(id).addEventListener("change", handleStoneLookupChange);
});

document.querySelector('#stone-entry-form [name="stoneDesignId"]').addEventListener("change", (event) => {
  loadStoneEntry(event.target.value);
});

document.querySelector('#stone-entry-form [name="stoneDesignSearch"]').addEventListener("input", () => {
  const matches = updateStoneDesignOptions("", true);
  const searchValue = document.querySelector('#stone-entry-form [name="stoneDesignSearch"]').value.trim().toLowerCase();
  const exactMatch = matches.find((design) => designText(design).toLowerCase() === searchValue);
  if (exactMatch) loadStoneEntry(exactMatch.id);
  else if (matches.length === 1) loadStoneEntry(matches[0].id);
});

document.getElementById("stone-entry-form").addEventListener("change", (event) => {
  if (event.target.name === "stoneDesignCategory") {
    updateStoneDesignOptions("", true);
    loadStoneEntry("");
  }
  if (["entryStoneType", "entryStoneShape", "entryStoneSize"].includes(event.target.name)) {
    handleDesignStoneEntryChange(event.target.name);
  }
});

document.getElementById("add-design-stone").addEventListener("click", addDesignStoneItem);

document.getElementById("read-stone-chart").addEventListener("click", readStoneChartImage);

document.querySelector('#stone-entry-form [name="stoneChart"]').addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.getElementById("stone-entry-preview");
  await showStoneChartQuality(file);
  preview.classList.remove("empty");
  preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Selected stone chart preview">`;
});

document.getElementById("stone-entry-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const design = findById("designs", form.stoneDesignId.value);
  if (!design) {
    alert("Select design first.");
    return;
  }
  const file = form.stoneChart.files[0];
  if (file) {
    await showStoneChartQuality(file);
    await saveStoneChartImage(design.id, await compressStoneChartImage(file));
    design.hasStoneChart = true;
  }
  form.stoneChart.value = "";
  saveState();
  render();
  await loadStoneEntry(design.id);
  document.getElementById("stone-entry-summary").textContent = "Stone entry saved.";
});

document.getElementById("add-order-item").addEventListener("click", commitCurrentOrderItem);

document.getElementById("order-item-list").addEventListener("change", (event) => {
  const row = event.target.closest(".order-item-row");
  if (event.target.name === "category") {
    updateOrderItemDesignOptions(row);
    updateOrderItemCategoryFields(row);
  }
  if (event.target.name === "ringType") updateOrderItemCategoryFields(row);
  if (event.target.name === "designId") {
    syncOrderDesignSearch(row, event.target.value);
    applyDesignToOrderItem(row, event.target.value);
  }
  renderOrderEntrySummary();
});

document.getElementById("order-item-list").addEventListener("input", (event) => {
  if (event.target.name === "designSearch") {
    const row = event.target.closest(".order-item-row");
    updateOrderItemDesignOptions(row, row.querySelector('[name="designId"]').value, true);
  }
  renderOrderEntrySummary();
});

document.getElementById("barcode-scan").addEventListener("change", (event) => {
  openOrderByBarcode(event.target.value);
  event.target.value = "";
});

document.getElementById("barcode-scan").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    openOrderByBarcode(event.target.value);
    event.target.value = "";
  }
});

document.querySelectorAll('form select[name="designId"]').forEach((select) => {
  select.addEventListener("change", (event) => applyDesignToForm(event.target.form, event.target.value));
});

document.getElementById("order-form").addEventListener("input", (event) => {
  if (["orderDate", "productionDays"].includes(event.target.name)) {
    updateOrderDueDate(event.currentTarget);
  }
  renderOrderEntrySummary();
});

document.getElementById("customer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const existing = data.customerId ? findById("customers", data.customerId) : null;
  if (existing) {
    existing.name = data.name;
    existing.phone = data.phone;
    existing.city = data.city;
    existing.gst = data.gst;
    existing.address = data.address;
    updateCustomerReferences(existing);
  } else {
    state.customers.push({
      id: crypto.randomUUID(),
      name: data.name,
      phone: data.phone,
      city: data.city,
      gst: data.gst,
      address: data.address,
    });
  }
  resetCustomerForm();
  saveState();
  render();
});

document.getElementById("cancel-customer-edit").addEventListener("click", () => {
  resetCustomerForm();
});

document.getElementById("customer-search").addEventListener("input", renderCustomers);

document.getElementById("production-form").addEventListener("input", updateIssueMetalSummary);
document.getElementById("production-form").addEventListener("change", (event) => {
  if (event.target.name === "jobNumber") applyIssuePurityFromJob();
  updateIssueMetalSummary();
});

document.getElementById("production-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const karigar = findById("karigars", data.karigarId);
  const selectedOrders = state.orders.filter((order) =>
    (order.jobNumber || order.productionNo || order.number) === data.jobNumber && order.status === "Pending"
  );
  const metalPurity = data.metalPurity || selectedOrders[0]?.purity || "18K";
  const issuedWeight = Number(data.issuedWeight);
  const waxStoneWeight = productionStoneTotalsForOrders(selectedOrders, "wax").weight;
  const netMetalIssuedWeight = Number(weight3(issuedWeight - waxStoneWeight));
  if (!selectedOrders.length) {
    alert("Select one open job card to issue metal.");
    return;
  }
  if (!karigar) return;
  if (netMetalIssuedWeight <= 0) {
    alert("Metal issued weight must be more than wax-set stone weight.");
    return;
  }

  const available = rawGoldStock();
  if (netMetalIssuedWeight > available) {
    alert(`Only ${gram(available)} raw gold is available.`);
    return;
  }

  selectedOrders.forEach((order) => {
    order.status = "In Production";
  });
  const lotNumber = `LOT-${state.nextLot++}`;
  state.lots.unshift({
    id: crypto.randomUUID(),
    number: lotNumber,
    issueDate: today(),
    orderId: selectedOrders[0].id,
    orderIds: selectedOrders.map((order) => order.id),
    orderNumber: data.jobNumber,
    karigarId: karigar.id,
    karigarName: karigar.name,
    issueKarigarId: karigar.id,
    issueKarigarName: karigar.name,
    issueDepartment: karigar.speciality,
    currentDepartment: karigar.speciality,
    metalPurity,
    grossIssuedWeight: issuedWeight,
    waxStoneWeight,
    issuedWeight: netMetalIssuedWeight,
    expectedWastage: Number(data.wastagePercent || 0),
    finishedWeight: 0,
    actualWastage: 0,
    status: "Issued",
    transfers: [],
  });
  state.ledger.unshift({ id: crypto.randomUUID(), date: today(), type: "Out", purity: metalPurity, weight: netMetalIssuedWeight, reference: `${lotNumber} for ${data.jobNumber} issued to ${karigar.name}; Gold Issue ${gram(issuedWeight)} - Wax Stone ${gram(waxStoneWeight)} = Net Wt ${gram(netMetalIssuedWeight)}` });
  event.target.reset();
  saveState();
  render();
});

document.getElementById("stock-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const designText = designLabel(data.designId);
  state.ledger.unshift({
    id: crypto.randomUUID(),
    date: today(),
    type: "In",
    purity: data.purity,
    weight: Number(data.weight),
    designId: data.designId || "",
    reference: designText ? `${data.source} / ${designText}` : data.source,
  });
  event.target.reset();
  saveState();
  render();
});

document.getElementById("add-melting-source").addEventListener("click", () => {
  addMeltingSourceRow("", "", "top", true);
  updateMeltingCalculation();
});

document.getElementById("melting-form").addEventListener("input", (event) => {
  if (["sourcePurity", "sourceWeightLine", "targetPurity"].includes(event.target.name)) {
    updateMeltingCalculation();
  }
});

document.getElementById("melting-form").addEventListener("submit", (event) => {
  event.preventDefault();
  updateMeltingCalculation();
  const data = getFormData(event.target);
  const sourceMetals = getMeltingSourceMetals();
  const sourceWeight = Number(data.sourceWeight);
  const targetPurity = Number(data.targetPurity);
  const finalWeight = Number(data.finalWeight);
  const department = meltingDepartment(data.meltingDepartmentId);
  if (!sourceMetals.length || !sourceWeight || !finalWeight || !targetPurity) {
    alert("Add at least one source metal with weight and purity.");
    return;
  }
  if (!department) {
    alert("Select department / caster for melting issue.");
    return;
  }
  const meltingId = crypto.randomUUID();
  state.melting.unshift({
    id: meltingId,
    date: today(),
    sourceMetals,
    sourcePurity: Number(data.averagePurity),
    sourceWeight,
    targetPurity,
    colour: data.colour,
    pureGold: Number(data.pureGold),
    finalWeight,
    alloyWeight: Number(data.alloyWeight),
    departmentId: department.id,
    departmentName: department.name,
    status: "Issued",
    receivedWeight: 0,
    meltingLoss: 0,
  });
  state.ledger.unshift({
    id: crypto.randomUUID(),
    meltingId,
    date: today(),
    type: "Melt Issue",
    purity: `${targetPurity}%`,
    weight: finalWeight,
    reference: `${sourceMetals.length} source metals ${gram(sourceWeight)} to ${targetPurity}% ${data.colour}, issued to ${department.name}`,
  });
  event.target.reset();
  resetMeltingSources();
  updateMeltingCalculation();
  saveState();
  render();
});

document.getElementById("melting-receive-form").addEventListener("input", (event) => {
  if (meltingReceiveWeightFields().includes(event.target.name)) updateMeltingReceiveLoss();
});

document.getElementById("melting-receive-form").addEventListener("submit", (event) => {
  event.preventDefault();
  updateMeltingReceiveLoss();
  const data = getFormData(event.target);
  const melting = findById("melting", data.meltingId);
  if (!melting) return;
  const receivedWeight = Number(data.receivedWeight || 0);
  const meltingLoss = Number(data.meltingLoss || 0);
  const receiveBreakup = getMeltingReceiveBreakup(data);
  melting.receivedDate = today();
  melting.receivedWeight = receivedWeight;
  melting.meltingLoss = meltingLoss;
  melting.receiveBreakup = receiveBreakup;
  melting.status = "Received";
  state.ledger = state.ledger.filter((entry) => entry.meltingId !== melting.id || entry.type === "Melt Issue");
  state.ledger.unshift({
    id: crypto.randomUUID(),
    meltingId: melting.id,
    date: today(),
    type: "Melt Received",
    purity: `${formatPurity(melting.targetPurity)}`,
    weight: receivedWeight,
    reference: `${melting.colour} melting received from ${melting.departmentName || "department"} (${meltingReceiveBreakupText(receiveBreakup)}), loss ${gram(meltingLoss)}`,
  });
  if (meltingLoss > 0) {
    state.ledger.unshift({
      id: crypto.randomUUID(),
      meltingId: melting.id,
      date: today(),
      type: "Melt Loss",
      purity: `${formatPurity(melting.targetPurity)}`,
      weight: meltingLoss,
      reference: `${melting.colour} melting loss booked for ${melting.departmentName || "department"}`,
    });
  }
  document.getElementById("melting-receive-dialog").close();
  saveState();
  render();
});

document.getElementById("karigar-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isOwner()) {
    alert("Only Owner can add departments.");
    return;
  }
  const data = getFormData(event.target);
  const existing = data.departmentId ? findById("karigars", data.departmentId) : null;
  if (existing) {
    existing.name = data.name;
    existing.speciality = data.speciality;
    existing.rate = Number(data.rate);
    updateDepartmentReferences(existing);
  } else {
    state.karigars.push({
      id: crypto.randomUUID(),
      name: data.name,
      speciality: data.speciality,
      rate: Number(data.rate),
    });
  }
  event.target.reset();
  resetDepartmentForm();
  saveState();
  render();
});

document.getElementById("cancel-department-edit").addEventListener("click", () => {
  resetDepartmentForm();
});

document.getElementById("complete-form").addEventListener("submit", (event) => {
  event.preventDefault();
  updateCompleteFineGold();
  const data = getFormData(event.target);
  const lot = findById("lots", data.lotId);
  if (!lot) return;
  const linkedOrders = getLotOrders(lot);
  lot.finishedWeight = Number(data.finishedWeight);
  lot.actualWastage = Number(data.actualWastage);
  lot.wastagePurity = data.wastagePurity;
  lot.wastageFineGold = Number(data.wastageFineGold || fineGoldWeight(lot.actualWastage, lot.wastagePurity));
  lot.status = "Completed";
  linkedOrders.forEach((order) => {
    order.status = "Completed";
  });
  state.ledger.unshift({
    id: crypto.randomUUID(),
    date: today(),
    type: "Finished",
    purity: linkedOrders[0]?.purity || "-",
    weight: lot.finishedWeight,
    reference: `${lot.number} completed`,
  });
  document.getElementById("complete-dialog").close();
  event.target.reset();
  saveState();
  render();
});

document.getElementById("complete-form").addEventListener("input", updateCompleteFineGold);

document.getElementById("cancel-complete").addEventListener("click", () => {
  document.getElementById("complete-dialog").close();
});

document.getElementById("bill-search").addEventListener("input", renderBills);
document.getElementById("office-search").addEventListener("input", renderOffice);
document.getElementById("office").addEventListener("change", saveOfficeHuidFromTable);
document.getElementById("office-table").addEventListener("change", saveOfficeHuidFromTable);
document.getElementById("office-tile-board").addEventListener("change", saveOfficeHuidFromTable);
document.getElementById("office-details-dialog").addEventListener("change", saveOfficeHuidFromTable);
document.getElementById("office-select-all").addEventListener("change", (event) => {
  document.querySelectorAll(".office-item-check").forEach((input) => {
    input.checked = event.target.checked;
  });
});
document.getElementById("office-details-dialog").addEventListener("click", (event) => {
  const editOfficeCustomerButton = event.target.closest("[data-edit-office-customer]");
  if (editOfficeCustomerButton) {
    editOfficeCustomer(editOfficeCustomerButton.dataset.editOfficeCustomer);
    return;
  }
  const deleteOfficeCustomerButton = event.target.closest("[data-delete-office-customer]");
  if (deleteOfficeCustomerButton) {
    deleteOfficeCustomer(deleteOfficeCustomerButton.dataset.deleteOfficeCustomer);
    return;
  }
  if (event.target.id === "cancel-office-customer-edit") {
    resetOfficeCustomerForm();
    return;
  }
  const officeViewButton = event.target.closest("[data-office-view-key]");
  if (officeViewButton) {
    openOfficeItemView(officeViewButton.dataset.officeViewKey);
    return;
  }
  const soldViewButton = event.target.closest("[data-sold-view-key]");
  if (soldViewButton) {
    openOfficeItemView(soldViewButton.dataset.soldViewKey);
    return;
  }
  const salesTile = event.target.closest("[data-sales-team]");
  if (salesTile) {
    openSalesTeamHolding(salesTile.dataset.salesTeam);
    return;
  }
  if (event.target.id === "office-back-sold") {
    const backPage = document.getElementById("office-details-dialog")?.dataset.backPage || "all";
    openOfficeDialogPage(backPage);
    return;
  }
  if (event.target.id === "office-back-sales") {
    openOfficeDialogPage("sales");
    return;
  }
  const discardButton = event.target.closest("[data-discard-office-item]");
  if (discardButton) {
    discardOfficeItem(discardButton.dataset.discardOfficeItem);
    return;
  }
  if (["office-issue-hallmark", "office-receive-hallmark", "office-issue-sales", "office-mark-sold"].includes(event.target.id) && !canEditOfficeWeights()) {
    alert("This login can view Office but cannot edit weights or move items.");
    return;
  }
  if (event.target.id === "office-issue-hallmark") updateSelectedOfficeItems("hallmarkIssue");
  if (event.target.id === "office-receive-hallmark") updateSelectedOfficeItems("hallmarkReceive");
  if (event.target.id === "office-issue-sales") updateSelectedOfficeItems("salesIssue");
  if (event.target.id === "office-mark-sold") updateSelectedOfficeItems("sold");
});

document.getElementById("office-details-dialog").addEventListener("input", (event) => {
  if (event.target.id === "office-customer-search") {
    renderOfficeCustomerList();
  }
});

document.getElementById("office-details-dialog").addEventListener("submit", (event) => {
  if (event.target.id !== "office-customer-form") return;
  event.preventDefault();
  saveOfficeCustomer(event.target);
});

document.getElementById("bill-form").addEventListener("input", updateBillAmount);

document.getElementById("bill-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveBillFromForm(true);
});

document.getElementById("bill-qc-ok").addEventListener("click", () => {
  saveBillFromForm(false);
  transferQcOkItemsToOffice();
});

document.getElementById("bill-qc-failed").addEventListener("click", () => {
  saveBillFromForm(false);
  returnQcFailedItemsToProduction();
});

function saveBillFromForm(closeDialog = false) {
  const form = document.getElementById("bill-form");
  updateBillAmount();
  const data = getFormData(form);
  const lot = findById("lots", data.lotId);
  if (!lot) return null;
  const existingBill = lot.bill || state.bills?.find((item) => item.lotId === lot.id) || {};
  const items = billItemRows(existingBill.items || []);
  const netWeight = items.reduce((total, item) => total + Number(item.netWeight || 0), 0);
  const manufacturingMakingGold = items.reduce((total, item) => total + Number(item.manufacturingMakingGold || item.makingGold || 0), 0);
  const officeMakingGold = items.reduce((total, item) => total + Number(item.officeMakingGold || 0), 0);
  const bill = {
    id: lot.bill?.id || crypto.randomUUID(),
    lotId: lot.id,
    jobNumber: lot.orderNumber,
    billNo: data.billNo,
    billDate: data.billDate,
    makingRate: Number(data.makingRate || 0),
    officeMakingRate: Number(data.officeMakingRate || 0),
    otherCharges: Number(data.otherCharges || 0),
    manufacturingBillAmount: Number(data.manufacturingBillAmount || 0),
    billAmount: Number(data.billAmount || 0),
    items,
    netWeight,
    makingGold: manufacturingMakingGold,
    manufacturingMakingGold,
    officeMakingGold,
    remarks: data.remarks || "",
  };
  state.bills = state.bills || [];
  const existingIndex = state.bills.findIndex((item) => item.lotId === lot.id);
  if (existingIndex >= 0) state.bills[existingIndex] = bill;
  else state.bills.unshift(bill);
  lot.bill = bill;
  lot.billingStage = lot.billingStage || "Sales Office QC";
  lot.salesDepartment = lot.salesDepartment || "Sales Office";
  lot.currentDepartment = "Sales Office";
  lot.karigarName = "Sales Office Department";
  if (closeDialog) {
    document.getElementById("bill-dialog").close();
  }
  saveState();
  render();
  return { lot, bill };
}

document.getElementById("cancel-bill").addEventListener("click", () => {
  document.getElementById("bill-dialog").close();
});

document.getElementById("cancel-melting-receive").addEventListener("click", () => {
  document.getElementById("melting-receive-dialog").close();
});

document.getElementById("close-melting-view").addEventListener("click", () => {
  document.getElementById("melting-view-dialog").close();
});

document.getElementById("close-design-image").addEventListener("click", () => {
  document.getElementById("design-image-dialog").close();
});

document.getElementById("close-design-category").addEventListener("click", () => {
  document.getElementById("design-category-dialog").close();
});

document.getElementById("close-order").addEventListener("click", () => {
  document.getElementById("order-dialog").close();
});

document.getElementById("print-order").addEventListener("click", () => {
  printOpenJobOrder();
});

document.getElementById("edit-order-details").addEventListener("click", () => {
  document.getElementById("update-order-form").classList.toggle("hidden");
});

document.getElementById("update-order-form").addEventListener("submit", (event) => {
  event.preventDefault();
  updateOrderDueDate(event.target);
  const data = getFormData(event.target);
  const order = findById("orders", data.orderId);
  const customer = findById("customers", data.customerId);
  if (!order) return;
  getJobOrders(order).forEach((jobItem) => {
    if (customer) {
      jobItem.customerId = customer.id;
      jobItem.customer = customer.name;
    }
    jobItem.orderDate = data.orderDate;
    jobItem.productionDays = Number(data.productionDays);
    jobItem.dueDate = data.dueDate;
  });
  saveState();
  render();
  openOrderDetail(order.id);
  document.getElementById("update-order-form").classList.add("hidden");
});

document.getElementById("update-order-form").addEventListener("input", (event) => {
  if (["orderDate", "productionDays"].includes(event.target.name)) {
    updateOrderDueDate(event.currentTarget);
  }
});

document.getElementById("cancel-item-edit").addEventListener("click", () => {
  document.getElementById("item-edit-dialog").close();
});

document.getElementById("item-edit-form").addEventListener("change", (event) => {
  const form = event.currentTarget;
  if (event.target.name === "category") {
    updateItemEditDesignOptions(form);
    updateItemEditCategoryFields(form);
  }
  if (event.target.name === "ringType") updateItemEditCategoryFields(form);
  if (event.target.name === "designId") applyDesignToItemEdit(form, event.target.value);
});

document.getElementById("item-edit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const order = findById("orders", data.orderId);
  if (!order) return;
  const design = findById("designs", data.designId);
  order.designId = data.designId || "";
  order.designNumber = design ? designText(design) : "";
  order.category = data.category || "";
  order.ringType = data.ringType || "";
  order.clSize = data.clSize || "";
  order.cgSize = data.cgSize || "";
  order.size = data.size || "";
  order.color = data.color || "";
  order.purity = data.purity || "18K";
  order.remarks = data.remarks || "";
  order.item = order.designNumber || order.category || order.remarks || order.item || "Job item";
  cleanItemSizeFields(order);
  saveState();
  render();
  document.getElementById("item-edit-dialog").close();
  openOrderDetail(order.id);
});

document.getElementById("close-production-stone").addEventListener("click", () => {
  document.getElementById("production-stone-dialog").close();
});

document.getElementById("close-production-stone-bottom").addEventListener("click", () => {
  document.getElementById("production-stone-dialog").close();
});

document.getElementById("production-stone-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const order = findById("orders", event.target.orderId.value);
  if (!order) return;
  const rows = [...document.querySelectorAll("#production-stone-details tr[data-design-stone-id]")];
  if (!rows.length) {
    alert("No Design Master stone data found for this item.");
    return;
  }
  order.productionStoneItems = rows.map((row) => ({
    id: row.dataset.productionStoneId || crypto.randomUUID(),
    sourceDesignStoneId: row.dataset.designStoneId,
    date: today(),
    settingType: row.querySelector('[name="productionSettingType"]').value,
    manufacturingStage: row.querySelector('[name="manufacturingStage"]').value,
    stoneType: row.dataset.stoneType || "",
    shape: row.dataset.shape || "",
    size: row.dataset.size || "",
    code: row.dataset.code || "",
    pcs: Number(row.dataset.pcs || 0),
    weightPerPc: formatStoneWeight(row.dataset.weightPerPc),
    totalWeight: row.dataset.totalWeight || totalStoneWeight(row.dataset.weightPerPc, row.dataset.pcs),
  }));
  saveState();
  renderProductionStoneItems(order);
  renderJobItemsDetail(getJobOrders(order));
  alert("Production stone plan saved.");
});

document.getElementById("issue-from-order").addEventListener("click", () => {
  const orderId = document.getElementById("update-order-form").orderId.value;
  document.getElementById("order-dialog").close();
  switchView("production");
  switchProductionPage("issue");
  renderSelects();
  const order = findById("orders", orderId);
  const jobSelect = document.querySelector('#production-form select[name="jobNumber"]');
  if (order && jobSelect) jobSelect.value = order.jobNumber || order.productionNo || order.number;
  applyIssuePurityFromJob();
  updateIssueMetalSummary();
});

document.getElementById("transfer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  updateTransferBalance();
  const data = getFormData(event.target);
  const lot = findById("lots", data.lotId);
  const newKarigar = findById("karigars", data.karigarId);
  if (!lot || !newKarigar) return;

  const editingTransfer = data.transferId ? (lot.transfers || []).find((transfer) => transfer.id === data.transferId) : null;
  if (!editingTransfer && lot.karigarId === newKarigar.id) {
    alert("Please select a different department for transfer.");
    return;
  }

  const availableIssueWeight = editingTransfer ? Number(editingTransfer.transferWeight || currentTransferIssueWeight(lot) || 0) : currentTransferIssueWeight(lot);
  const transferWeight = Number(data.transferWeight);
  if (transferWeight <= 0 || (!editingTransfer && transferWeight > availableIssueWeight)) {
    alert(`Issue weight must be between 0 and ${gram(availableIssueWeight)}.`);
    return;
  }

  const grossReceivedWeight = Number(data.grossReceivedWeight);
  const stoneWeight = Number(data.stoneWeight || 0);
  const waxStoneWeight = Number(data.waxStoneWeight || transferWaxStoneWeight(lot));
  const reducedWeight = Number(weight3(waxStoneWeight + stoneWeight));
  if (stoneWeight < 0 || waxStoneWeight < 0 || stoneWeight + waxStoneWeight > grossReceivedWeight) {
    alert("Wax stone plus hand stone cannot be more than receive gross weight.");
    return;
  }

  const issuedNetWeight = Number(weight3(transferWeight - waxStoneWeight - currentHandStoneWeight(lot, data.transferId)));
  const receivedWeight = Number(weight3(grossReceivedWeight - waxStoneWeight - stoneWeight));
  if (receivedWeight < 0) {
    alert("Net Wt cannot be less than 0.");
    return;
  }

  const departmentBalance = Number(weight3(issuedNetWeight - receivedWeight));
  const differencePurity = lot.metalPurity || getLotOrders(lot)[0]?.purity || "";
  const differenceFineGold = fineGoldWeight(departmentBalance, differencePurity);
  lot.transfers = lot.transfers || [];
  const transferData = {
    id: data.transferId || crypto.randomUUID(),
    date: today(),
    fromKarigarId: lot.karigarId,
    fromKarigarName: lot.karigarName,
    toKarigarId: newKarigar.id,
    toKarigarName: newKarigar.name,
    transferWeight,
    grossReceivedWeight,
    waxStoneWeight,
    stoneWeight,
    handStoneWeight: stoneWeight,
    reducedWeight,
    receivedWeight,
    departmentBalance,
    differencePurity,
    differenceFineGold,
    balanceDepartment: mergedProductionDepartmentName(data.fromDepartment),
    fromDepartment: mergedProductionDepartmentName(data.fromDepartment),
    toDepartment: mergedProductionDepartmentName(data.toDepartment),
    reason: data.reason,
  };
  if (editingTransfer) {
    Object.assign(editingTransfer, {
      ...transferData,
      fromKarigarId: editingTransfer.fromKarigarId,
      fromKarigarName: editingTransfer.fromKarigarName,
    });
  } else {
    lot.transfers.push(transferData);
  }
  recalculateLotAfterTransferChange(lot);
  state.ledger.unshift({
    id: crypto.randomUUID(),
    date: today(),
    type: editingTransfer ? "Transfer Edit" : "Transfer",
    purity: "-",
    weight: receivedWeight,
    reference: `${lot.number} ${editingTransfer ? "edited" : "issued"} GW ${gram(transferWeight)}, receive GW ${gram(grossReceivedWeight)}, wax stone ${gram(waxStoneWeight)}, hand stone ${gram(stoneWeight)}, reduced ${gram(reducedWeight)}, net wt ${gram(receivedWeight)}, difference ${gram(departmentBalance)} @ ${displayPurity(differencePurity)}, fine ${gram(differenceFineGold)} in ${data.fromDepartment}`,
  });
  document.getElementById("transfer-dialog").close();
  event.target.reset();
  saveState();
  render();
});

document.getElementById("cancel-transfer").addEventListener("click", () => {
  document.getElementById("transfer-dialog").close();
});

document.getElementById("transfer-form").addEventListener("input", (event) => {
  if (event.target.name === "fromDepartment") {
    applyProductionStoneWeightToTransfer();
  }
  if (["transferWeight", "grossReceivedWeight", "stoneWeight"].includes(event.target.name)) {
    updateTransferBalance();
  }
});

document.getElementById("transfer-form").addEventListener("change", (event) => {
  if (event.target.name !== "karigarId") return;
  const form = event.currentTarget;
  const department = findById("karigars", form.karigarId.value);
  if (!department) return;
  form.toDepartment.value = department.speciality || department.name || form.toDepartment.value;
});

document.getElementById("close-history").addEventListener("click", () => {
  document.getElementById("history-dialog").close();
});

document.getElementById("transfer-history-search").addEventListener("input", renderOnlineTransferHistory);
document.getElementById("production-transfer-search").addEventListener("input", renderOnlineTransferHistory);

function loadState() {
  try {
    const saved = localStorage.getItem(LOCAL_STATE_KEY);
    const normalized = normalizeState(saved ? JSON.parse(saved) : structuredClone(demoState));
    cacheStateLocally(normalized);
    return normalized;
  } catch (error) {
    console.warn("Saved ERP data could not be read. Starting with safe demo data.", error);
    const normalized = normalizeState(structuredClone(demoState));
    cacheStateLocally(normalized);
    return normalized;
  }
}

function cacheStateLocally(value = state) {
  try {
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn("Browser cache is unavailable; cloud sync remains active.", error);
    return false;
  }
}

function cachePendingState() {
  if (!currentUser || !cloudStateReady) return;
  try {
    localStorage.setItem(LOCAL_PENDING_STATE_KEY, JSON.stringify({
      state,
      base: serverState,
      revision: serverRevision,
      savedAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.warn("Pending cloud save could not be cached in this browser.", error);
  }
}

function readPendingState() {
  try {
    const pending = JSON.parse(localStorage.getItem(LOCAL_PENDING_STATE_KEY) || "null");
    return pending?.state && Number.isFinite(Number(pending.revision)) ? pending : null;
  } catch (error) {
    console.warn("Pending cloud save cache could not be read.", error);
    return null;
  }
}

function clearPendingStateCache() {
  try {
    localStorage.removeItem(LOCAL_PENDING_STATE_KEY);
  } catch (error) {
    console.warn("Pending cloud save cache could not be cleared.", error);
  }
}

function applyLoginState() {
  const isLoggedIn = Boolean(currentUser);
  document.body.classList.toggle("logged-out", !isLoggedIn);
  document.body.classList.toggle("is-owner", isOwner());
  document.getElementById("active-user").textContent = isLoggedIn ? currentUser.name : "Not logged in";
  if (!isLoggedIn) setSyncStatus("Offline", "offline");
  applyAccessControl();
  renderLoginUsers();
}

function currentUserConfig() {
  return currentUser ? users[currentUser.id] : null;
}

function allowedPages() {
  const config = currentUserConfig();
  if (!config) return [];
  if (config.pages === "all") return Object.keys(pageInfo);
  return config.pages || [];
}

function canAccessPage(view) {
  return allowedPages().includes(view);
}

function defaultAllowedPage() {
  return allowedPages()[0] || "dashboard";
}

function canEditOfficeWeights() {
  return Boolean(currentUserConfig()?.canEditOfficeWeights || isOwner());
}

function isSalesUser() {
  return currentUserConfig()?.role === "sales";
}

function currentSalesTeam() {
  return currentUserConfig()?.salesTeam || "";
}

function applyAccessControl() {
  const pages = allowedPages();
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("hidden", !pages.includes(button.dataset.view));
  });
  document.querySelectorAll("[data-office-page]").forEach((button) => {
    button.classList.toggle("hidden", isSalesUser() && button.dataset.officePage !== "sales");
  });
  document.body.classList.toggle("office-readonly", currentUserConfig()?.role === "office-ops" || isSalesUser());
  if (currentUser && !canAccessPage(document.querySelector(".view.active-view")?.id || "dashboard")) {
    switchView(defaultAllowedPage());
  }
}

function saveState() {
  cacheStateLocally(state);
  clearFormDirty(document.activeElement?.closest?.("form"));
  if (supabaseClient && currentUser && cloudStateReady) {
    localSaveRevision += 1;
    localSavePending = true;
    cachePendingState();
    setSyncStatus("Saving...", "saving");
    queueSupabaseSave();
  }
}

function userAccessText(user = {}) {
  if (user.pages === "all") return "Full software";
  return (user.pages || []).map((page) => pageInfo[page]?.[0] || page).join(", ");
}

function loadSupabaseLibrary() {
  if (window.supabase) return Promise.resolve(window.supabase);
  if (supabaseLibraryPromise) return supabaseLibraryPromise;
  supabaseLibraryPromise = new Promise((resolve, reject) => {
    if (window.supabase) {
      resolve(window.supabase);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8";
    script.onload = () => resolve(window.supabase);
    script.onerror = () => {
      supabaseLibraryPromise = null;
      reject(new Error("Supabase library could not load."));
    };
    document.head.appendChild(script);
  });
  return supabaseLibraryPromise;
}

async function ensureSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (!supabaseSettings.url || !supabaseSettings.anonKey) {
    throw new Error("Supabase connection details are missing.");
  }
  if (!supabaseClientPromise) {
    supabaseClientPromise = loadSupabaseLibrary()
      .then((supabaseLibrary) => {
        supabaseClient = supabaseLibrary.createClient(supabaseSettings.url, supabaseSettings.anonKey);
        if (!supabaseAuthSubscription) {
          const { data } = supabaseClient.auth.onAuthStateChange((event) => {
            if (event !== "SIGNED_OUT" || !currentUser) return;
            stopBackgroundSync(true);
            currentUser = null;
            applyLoginState();
            const errorElement = document.getElementById("login-error");
            if (errorElement) errorElement.textContent = "Your session ended. Please log in again.";
          });
          supabaseAuthSubscription = data.subscription;
        }
        return supabaseClient;
      })
      .catch((error) => {
        supabaseClientPromise = null;
        throw error;
      });
  }
  return supabaseClientPromise;
}

async function setCurrentUserFromAuth(authUser) {
  if (!authUser) throw new Error("No authenticated user was returned.");
  const { data, error } = await supabaseClient
    .from("erp_users")
    .select("erp_user_id")
    .eq("user_id", authUser.id)
    .maybeSingle();
  if (error) throw error;
  const userId = data?.erp_user_id;
  const user = users[userId];
  if (!user) throw new Error("This account has not been assigned an ERP role.");
  currentUser = {
    id: userId,
    name: user.name,
    role: user.role,
    salesTeam: user.salesTeam || "",
    email: authUser.email || "",
  };
}

function friendlyLoginError(error) {
  const message = String(error?.message || "Login failed.");
  if (error?.userMessage) return error.userMessage;
  if (message.includes("Invalid login credentials")) return "Wrong Staff ID or password.";
  if (message.includes("Unknown Staff ID")) return message;
  if (message.includes("ERP role")) return message;
  if (message.includes("connection details")) return message;
  return "Login failed. Check the account and internet connection.";
}

function isSyncSetupError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error?.details || "").toLowerCase();
  return ["PGRST202", "42703", "42883"].includes(code)
    || message.includes("get_erp_state")
    || message.includes("save_erp_state")
    || message.includes("revision");
}

function cloudLoadError(error) {
  const wrapped = new Error(String(error?.message || "Cloud ERP data could not be loaded."));
  wrapped.cause = error;
  wrapped.code = error?.code;
  wrapped.userMessage = isSyncSetupError(error)
    ? "Cloud sync setup is incomplete. Run ENABLE-LIVE-SYNC.sql in Supabase, then log in again."
    : "Cloud ERP data could not be loaded. Check the internet connection and try again.";
  return wrapped;
}

function normalizeLoginId(value = "") {
  const normalized = String(value).trim().replace(/\s+/g, "").toLowerCase();
  return Object.keys(users).find((id) => id.toLowerCase() === normalized) || normalized;
}

function authEmailForLoginId(loginId) {
  const domain = supabaseSettings.authEmailDomain || "kjm-erp.example.com";
  return `${loginId.toLowerCase()}@${domain}`;
}

async function initializeSupabase() {
  try {
    await ensureSupabaseClient();
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (data.session?.user) {
      await setCurrentUserFromAuth(data.session.user);
      await loadSupabaseState();
      startBackgroundSync();
      migrateLegacyDesignImages().catch((migrationError) => {
        console.warn("Legacy design images are waiting for cloud migration.", migrationError);
      });
    }
    applyLoginState();
  } catch (error) {
    stopBackgroundSync(true);
    currentUser = null;
    applyLoginState();
    const errorElement = document.getElementById("login-error");
    if (errorElement) errorElement.textContent = friendlyLoginError(error);
    await supabaseClient?.auth.signOut().catch(() => {});
    console.warn("Supabase authentication is not available.", error);
  }
}

function queueSupabaseSave(delay = 250) {
  if (!supabaseClient || !currentUser || !cloudStateReady) return;
  clearTimeout(supabaseSaveTimer);
  supabaseSaveTimer = setTimeout(syncStateToSupabase, delay);
}

function handleSyncFailure(error, label) {
  lastSyncFailure = error;
  const setupError = isSyncSetupError(error);
  if (setupError) blockForSyncSetup(error);
  setSyncStatus(setupError ? "Database update required" : "Sync retrying", "error");
  if (!setupError) supabaseRetryTimer = setTimeout(() => queueSupabaseSave(0), 5000);
  console.warn(label, error);
}

function blockForSyncSetup(error) {
  cloudStateReady = false;
  stopBackgroundSync(false);
  currentUser = null;
  applyLoginState();
  const errorElement = document.getElementById("login-error");
  if (errorElement) errorElement.textContent = error?.userMessage || cloudLoadError(error).userMessage;
  supabaseClient?.auth.signOut().catch(() => {});
}

async function syncStateToSupabase() {
  if (!supabaseClient || !currentUser || !cloudStateReady || saveInFlight) return false;
  if (!localSavePending) return true;
  saveInFlight = true;
  clearTimeout(supabaseRetryTimer);
  const saveRevision = localSaveRevision;
  const stateSnapshot = structuredClone(state);
  const expectedRevision = serverRevision;
  let response;
  try {
    response = await supabaseClient.rpc("save_erp_state", {
      p_id: supabaseStateId,
      p_data: stateSnapshot,
      p_expected_revision: expectedRevision,
    }).maybeSingle();
  } catch (requestError) {
    saveInFlight = false;
    localSavePending = true;
    handleSyncFailure(requestError, "Supabase save request failed");
    return false;
  }
  const { data, error } = response;

  if (error) {
    saveInFlight = false;
    localSavePending = true;
    handleSyncFailure(error, "Supabase save failed");
    return false;
  }

  if (!data) {
    await rebaseFromSupabase();
    saveInFlight = false;
    return !localSavePending;
  }

  saveInFlight = false;
  lastSyncFailure = null;
  serverState = structuredClone(data.data || stateSnapshot);
  serverRevision = Number(data.revision ?? expectedRevision + 1);
  lastSupabaseUpdatedAt = data.updated_at || lastSupabaseUpdatedAt;
  if (saveRevision === localSaveRevision) {
    localSavePending = false;
    clearPendingStateCache();
    setSyncStatus(mergeConflictCount ? "Concurrent edits merged" : syncedStatusText(), mergeConflictCount ? "pending" : "live");
    mergeConflictCount = 0;
  } else {
    localSavePending = true;
    cachePendingState();
    queueSupabaseSave(0);
  }

  if (pendingRemoteRecord && !localSavePending) {
    const pending = pendingRemoteRecord;
    pendingRemoteRecord = null;
    if (Number(pending.revision) > serverRevision) applyRemoteStateRecord(pending);
  }
  return true;
}

async function fetchSupabaseStateRecord() {
  const { data, error } = await supabaseClient
    .rpc("get_erp_state", { p_id: supabaseStateId })
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadSupabaseState() {
  if (!supabaseClient || !currentUser) return false;
  cloudStateReady = false;
  let data;
  try {
    data = await fetchSupabaseStateRecord();
  } catch (error) {
    setSyncStatus("Sync unavailable", "error");
    console.warn("Supabase load failed", error);
    throw cloudLoadError(error);
  }
  if (!data?.data) {
    const error = new Error("The shared ERP database row is missing.");
    error.userMessage = "Shared ERP data is not initialized. Run ENABLE-LIVE-SYNC.sql in Supabase, then log in again.";
    throw error;
  }

  const remoteState = normalizeState(structuredClone(data.data));
  serverState = structuredClone(remoteState);
  serverRevision = Number(data.revision || 0);
  lastSupabaseUpdatedAt = data.updated_at || "";
  const pending = readPendingState();
  localSavePending = false;

  if (pending?.base && Number(pending.revision) <= serverRevision) {
    const conflicts = [];
    state = normalizeState(mergeJsonChanges(pending.base, pending.state, remoteState, conflicts));
    mergeConflictCount += conflicts.length;
    localSavePending = !jsonEqual(state, remoteState);
  } else {
    state = remoteState;
    clearPendingStateCache();
  }

  cloudStateReady = true;
  lastSyncFailure = null;
  cacheStateLocally(state);
  renderSyncedState(true);
  if (localSavePending) {
    localSaveRevision += 1;
    cachePendingState();
    setSyncStatus("Restoring unsaved work...", "saving");
    queueSupabaseSave(0);
  } else {
    setSyncStatus(syncedStatusText(), "live");
  }
  return true;
}

async function rebaseFromSupabase() {
  let data;
  try {
    data = await fetchSupabaseStateRecord();
  } catch (error) {
    localSavePending = true;
    handleSyncFailure(error, "Supabase conflict refresh failed");
    return;
  }

  if (!data?.data) {
    localSavePending = true;
    const error = new Error("The shared ERP database row is missing.");
    error.userMessage = "Shared ERP data is not initialized. Run ENABLE-LIVE-SYNC.sql in Supabase, then log in again.";
    lastSyncFailure = error;
    blockForSyncSetup(error);
    return;
  }

  const remoteState = normalizeState(structuredClone(data.data));
  const conflicts = [];
  state = normalizeState(mergeJsonChanges(serverState || {}, state, remoteState, conflicts));
  serverState = structuredClone(remoteState);
  serverRevision = Number(data.revision || 0);
  cloudStateReady = true;
  lastSupabaseUpdatedAt = data.updated_at || lastSupabaseUpdatedAt;
  pendingRemoteRecord = null;
  mergeConflictCount += conflicts.length;
  localSaveRevision += 1;
  localSavePending = !jsonEqual(state, serverState);
  cacheStateLocally(state);
  if (localSavePending) cachePendingState();

  if (isUserActivelyEditing()) {
    setSyncStatus("Concurrent update merged", "pending");
    queueDeferredRemoteRender();
  } else {
    renderSyncedState();
  }

  if (localSavePending) {
    setSyncStatus("Saving merged data...", "saving");
    queueSupabaseSave(0);
  } else {
    setSyncStatus(syncedStatusText(), "live");
  }
}

async function flushPendingStateBeforeLogout() {
  clearTimeout(supabaseSaveTimer);
  const deadline = Date.now() + 8000;
  while (localSavePending && currentUser && Date.now() < deadline) {
    await syncStateToSupabase();
    if (localSavePending) await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function mergeJsonChanges(base, local, remote, conflicts = [], path = "") {
  if (jsonEqual(local, base)) return cloneJson(remote);
  if (jsonEqual(remote, base)) return cloneJson(local);
  if (jsonEqual(local, remote)) return cloneJson(local);

  if ((path === "nextOrder" || path === "nextLot") && [base, local, remote].every((value) => Number.isFinite(Number(value)))) {
    return Math.max(Number(base), Number(local), Number(remote));
  }

  if (local === undefined && remote !== undefined) {
    conflicts.push(path || "root");
    return cloneJson(remote);
  }
  if (remote === undefined && local !== undefined) {
    conflicts.push(path || "root");
    return cloneJson(local);
  }

  if (Array.isArray(local) && Array.isArray(remote)) {
    const baseArray = Array.isArray(base) ? base : [];
    const combinedItems = [...baseArray, ...local, ...remote];
    if (combinedItems.length && combinedItems.every((item) => isPlainObject(item) && item.id !== undefined)) {
      return mergeArraysById(baseArray, local, remote, conflicts, path);
    }
    if (combinedItems.every((item) => !isPlainObject(item))) {
      return mergePrimitiveArrays(baseArray, local, remote);
    }
    conflicts.push(path || "root");
    return cloneJson(local);
  }

  if (isPlainObject(local) && isPlainObject(remote)) {
    const baseObject = isPlainObject(base) ? base : {};
    const merged = {};
    const keys = new Set([...Object.keys(baseObject), ...Object.keys(local), ...Object.keys(remote)]);
    keys.forEach((key) => {
      const childPath = path ? `${path}.${key}` : key;
      const value = mergeJsonChanges(baseObject[key], local[key], remote[key], conflicts, childPath);
      if (value !== undefined) merged[key] = value;
    });
    return merged;
  }

  conflicts.push(path || "root");
  return cloneJson(local);
}

function mergeArraysById(base, local, remote, conflicts, path) {
  const toMap = (items) => new Map(items.map((item) => [String(item.id), item]));
  const baseMap = toMap(base);
  const localMap = toMap(local);
  const remoteMap = toMap(remote);
  const ids = [];
  [...remote, ...local, ...base].forEach((item) => {
    const id = String(item.id);
    if (!ids.includes(id)) ids.push(id);
  });
  return ids.flatMap((id) => {
    const merged = mergeJsonChanges(
      baseMap.get(id),
      localMap.get(id),
      remoteMap.get(id),
      conflicts,
      `${path || "items"}[${id}]`
    );
    return merged === undefined ? [] : [merged];
  });
}

function mergePrimitiveArrays(base, local, remote) {
  const key = (value) => JSON.stringify(value);
  const baseKeys = new Set(base.map(key));
  const localKeys = new Set(local.map(key));
  const locallyRemoved = new Set([...baseKeys].filter((itemKey) => !localKeys.has(itemKey)));
  const merged = remote.filter((item) => !locallyRemoved.has(key(item)));
  local.forEach((item) => {
    if (!baseKeys.has(key(item)) && !merged.some((existing) => jsonEqual(existing, item))) merged.push(cloneJson(item));
  });
  return merged;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonEqual(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isPlainObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalJson(value[key]);
    return result;
  }, {});
}

function cloneJson(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stableRecordId(prefix, ...parts) {
  const textValue = parts.map((part) => String(part ?? "")).join("|");
  let hash = 2166136261;
  for (let index = 0; index < textValue.length; index += 1) {
    hash ^= textValue.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function startBackgroundSync() {
  if (!supabaseClient || !currentUser) return;
  stopBackgroundSync(false);
  setSyncStatus("Connecting...", "connecting");

  supabaseRealtimeChannel = supabaseClient
    .channel(`erp-state-live-${supabaseStateId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "erp_state",
        filter: `id=eq.${supabaseStateId}`,
      },
      (payload) => applyRemoteStateRecord(payload.new)
    )
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        if (!localSavePending) setSyncStatus(syncedStatusText(), "live");
        refreshSupabaseState();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setSyncStatus("Live retrying", "error");
        console.warn("Supabase live sync connection issue", status, error);
      }
    });

  supabasePollTimer = setInterval(refreshSupabaseState, SUPABASE_POLL_INTERVAL_MS);
}

function stopBackgroundSync(resetTracking = false) {
  clearInterval(supabasePollTimer);
  clearTimeout(supabaseRetryTimer);
  clearTimeout(deferredRemoteRenderTimer);
  supabasePollTimer = null;
  supabaseRetryTimer = null;
  deferredRemoteRenderTimer = null;
  if (supabaseRealtimeChannel && supabaseClient) {
    const channel = supabaseRealtimeChannel;
    supabaseRealtimeChannel = null;
    supabaseClient.removeChannel(channel).catch(() => {});
  }
  if (resetTracking) {
    clearTimeout(supabaseSaveTimer);
    supabaseSaveTimer = null;
    pendingRemoteRecord = null;
    localSavePending = false;
    lastSupabaseUpdatedAt = "";
    serverState = null;
    serverRevision = -1;
    saveInFlight = false;
    mergeConflictCount = 0;
    cloudStateReady = false;
    lastSyncFailure = null;
  }
}

async function refreshSupabaseState() {
  if (!supabaseClient || !currentUser) return;
  const { data: revisionData, error: revisionError } = await supabaseClient
    .rpc("get_erp_state_revision", { p_id: supabaseStateId })
    .maybeSingle();
  if (revisionError) {
    if (!localSavePending) setSyncStatus("Sync retrying", "error");
    if (isSyncSetupError(revisionError)) blockForSyncSetup(revisionError);
    console.warn("Supabase background revision check failed", revisionError);
    return;
  }
  if (!revisionData || Number(revisionData.revision) <= serverRevision) return;
  try {
    const data = await fetchSupabaseStateRecord();
    if (data?.data) applyRemoteStateRecord(data);
  } catch (error) {
    if (!localSavePending) setSyncStatus("Sync retrying", "error");
    console.warn("Supabase background refresh failed", error);
  }
}

function applyRemoteStateRecord(record) {
  if (!record?.data || !currentUser) return;
  const remoteRevision = Number(record.revision ?? -1);
  if (remoteRevision <= serverRevision) return;

  if (localSavePending || saveInFlight) {
    if (!pendingRemoteRecord || remoteRevision > Number(pendingRemoteRecord.revision)) {
      pendingRemoteRecord = structuredClone(record);
    }
    return;
  }

  state = normalizeState(record.data);
  serverState = structuredClone(state);
  serverRevision = remoteRevision;
  cacheStateLocally(state);
  lastSupabaseUpdatedAt = record.updated_at || lastSupabaseUpdatedAt;
  if (isUserActivelyEditing()) {
    setSyncStatus("New data received", "pending");
    queueDeferredRemoteRender();
  } else {
    renderSyncedState();
    setSyncStatus(syncedStatusText(), "live");
  }
}

function isUserActivelyEditing() {
  return [...document.querySelectorAll("form")].some((form) => dirtyForms.has(form) && form.id !== "login-form");
}

function trackDirtyForm(event) {
  const field = event.target;
  const form = field?.closest?.("form");
  if (!form || form.id === "login-form" || field.matches("[readonly], [disabled]")) return;
  dirtyForms.add(form);
}

function clearFormDirty(form) {
  if (form instanceof HTMLFormElement) dirtyForms.delete(form);
}

function queueDeferredRemoteRender() {
  clearTimeout(deferredRemoteRenderTimer);
  deferredRemoteRenderTimer = setTimeout(() => {
    if (!currentUser) return;
    if (isUserActivelyEditing()) {
      queueDeferredRemoteRender();
      return;
    }
    renderSyncedState();
    setSyncStatus(syncedStatusText(), "live");
  }, 1000);
}

function renderSyncedState(resetEntryForms = false) {
  clearTimeout(deferredRemoteRenderTimer);
  deferredRemoteRenderTimer = null;
  render();
  if (!resetEntryForms) return;
  setDefaultOrderDates(document.getElementById("order-form"));
  resetOrderItemRows();
  resetMeltingSources();
  updateMeltingCalculation();
}

function syncedStatusText() {
  return `Live ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

function setSyncStatus(message, status) {
  const element = document.getElementById("sync-status");
  if (!element) return;
  element.textContent = message;
  element.className = `sync-pill sync-${status}`;
}

function switchView(view) {
  if (currentUser && !canAccessPage(view)) {
    alert("This login does not have access to this page.");
    view = defaultAllowedPage();
  }
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active-view", section.id === view));
  document.getElementById("page-title").textContent = pageInfo[view][0];
  document.getElementById("page-subtitle").textContent = pageInfo[view][1];
  if (view === "office") clearOfficePages();
}

function switchOrderPage(page) {
  document.querySelectorAll("[data-order-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.orderPage === page);
  });
  document.querySelectorAll(".order-page").forEach((section) => {
    section.classList.toggle("active-order-page", section.id === `order-page-${page}`);
  });
}

function switchDesignPage(page) {
  document.querySelectorAll("[data-design-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.designPage === page);
  });
  document.querySelectorAll(".design-page").forEach((section) => {
    section.classList.toggle("active-design-page", section.id === `design-page-${page}`);
  });
  if (page === "stone") openStoneEntryDialog();
}

function switchStonePage(page) {
  document.querySelectorAll("[data-stone-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.stonePage === page);
  });
  document.querySelectorAll(".stone-page").forEach((section) => {
    section.classList.toggle("active-stone-page", section.id === `stone-page-${page}`);
  });
}

function switchProductionPage(page) {
  document.querySelectorAll("[data-production-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.productionPage === page);
  });
  document.querySelectorAll(".production-page").forEach((section) => {
    section.classList.toggle("active-production-page", section.id === `production-page-${page}`);
  });
}

function switchOfficePage(page) {
  if (isSalesUser() && page !== "sales") {
    alert("Sales team login can access only its own holding.");
    page = "sales";
  }
  document.querySelectorAll("[data-office-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.officePage === page);
  });
  document.querySelectorAll(".office-page").forEach((section) => {
    section.classList.remove("active-office-page");
  });
  openOfficeDialogPage(page);
  document.querySelectorAll(".office-item-check").forEach((input) => {
    input.checked = false;
  });
  if (page !== "sales") {
    document.querySelectorAll("[data-sales-team]").forEach((button) => button.classList.remove("active"));
  }
  if (page === "sales" && isSalesUser()) {
    setTimeout(() => openSalesTeamHolding(currentSalesTeam()), 0);
  }
  const selectAll = document.getElementById("office-select-all");
  if (selectAll) selectAll.checked = false;
}

function clearOfficePages() {
  document.querySelectorAll("[data-office-page]").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".office-page").forEach((section) => section.classList.remove("active-office-page"));
  document.querySelectorAll(".office-item-check").forEach((input) => {
    input.checked = false;
  });
  const selectAll = document.getElementById("office-select-all");
  if (selectAll) selectAll.checked = false;
}

function openStoneEntryDialog() {
  const dialog = document.getElementById("stone-entry-dialog");
  if (!dialog.open) dialog.showModal();
}

function getFormData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function calculateDueDate(orderDate, productionDays) {
  if (!orderDate) return "";
  const date = new Date(`${orderDate}T00:00:00`);
  date.setDate(date.getDate() + normalizeProductionDays(productionDays));
  return date.toISOString().slice(0, 10);
}

function normalizeProductionDays(value) {
  const days = Math.floor(Number(value || 0));
  if (!Number.isFinite(days)) return 0;
  return Math.max(0, Math.min(MAX_PRODUCTION_DAYS, days));
}

function daysBetween(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return Math.max(Math.round((end - start) / 86400000), 0);
}

function updateOrderDueDate(form) {
  const productionDays = normalizeProductionDays(form.productionDays.value);
  form.productionDays.value = productionDays;
  form.dueDate.value = calculateDueDate(form.orderDate.value, productionDays);
}

function setDefaultOrderDates(form) {
  if (!form.orderDate.value) form.orderDate.value = isoToday();
  if (!form.productionDays.value) form.productionDays.value = MAX_PRODUCTION_DAYS;
  updateOrderDueDate(form);
}

function addOrderItemRow(item = {}, mode = "entry") {
  const row = document.createElement("div");
  row.className = `order-item-row ${mode}`;
  row.dataset.mode = mode;
  const isSaved = mode === "saved";
  row.innerHTML = isSaved ? savedOrderItemRowHtml(item) : entryOrderItemRowHtml(item);
  if (!isSaved) {
    updateOrderItemDesignOptions(row, item.designId || "");
    updateOrderItemCategoryFields(row);
  }
  row.querySelector("button").addEventListener("click", () => {
    if (isSaved) {
      row.remove();
    } else {
      clearOrderEntryRow(row);
    }
    if (!document.querySelector('#order-item-list .order-item-row[data-mode="entry"]')) addOrderItemRow();
    renderOrderEntrySummary();
  });
  document.getElementById("order-item-list").appendChild(row);
  renderOrderEntrySummary();
}

function entryOrderItemRowHtml(item = {}) {
  return `
    <label>Category <select name="category">${renderCategoryOptions(item.category)}</select></label>
    <label>Search Design <input name="designSearch" value="${escapeHtml(item.designSearch || "")}" placeholder="Type design no/name"></label>
    <label>Design <select name="designId"></select></label>
    <label class="cb-field">CB Ring
      <select name="ringType">
        ${renderRingTypeOptions(item.ringType)}
      </select>
    </label>
    <label class="normal-size-field">Size <input name="size" value="${escapeHtml(item.size || "")}" placeholder="Size"></label>
    <label class="cb-field cl-size-field">CL Size <input name="clSize" value="${escapeHtml(item.clSize || "")}" placeholder="Ladies size"></label>
    <label class="cb-field cg-size-field">CG Size <input name="cgSize" value="${escapeHtml(item.cgSize || "")}" placeholder="Gents size"></label>
    <label>Color
      <select name="color">
        <option value="">Select color</option>
        ${renderColorOptions(item.color)}
      </select>
    </label>
    <label>Purity
      <select name="purity">
        <option ${item.purity === "18K" ? "selected" : ""}>18K</option>
        <option ${item.purity === "22K" ? "selected" : ""}>22K</option>
        <option ${item.purity === "14K" ? "selected" : ""}>14K</option>
      </select>
    </label>
    <label>Remark <input name="remarks" value="${escapeHtml(item.remarks || "")}" placeholder="Remark"></label>
    <button class="delete-btn" type="button">Clear Entry</button>
  `;
}

function savedOrderItemRowHtml(item = {}) {
  const design = designLabel(item.designId) || "-";
  const cbDetails = isCbCategory(item.category)
    ? `
    <span class="saved-item-cell"><b>Ring</b>${escapeHtml(ringTypeLabel(item.ringType))}</span>
    ${["CL", "CL+CG"].includes(item.ringType) ? `<span class="saved-item-cell"><b>CL Size</b>${escapeHtml(item.clSize || item.size || "-")}</span>` : ""}
    ${["CG", "CL+CG"].includes(item.ringType) ? `<span class="saved-item-cell"><b>CG Size</b>${escapeHtml(item.cgSize || item.size || "-")}</span>` : ""}
  `
    : "";
  const normalSize = needsNormalSize(item.category)
    ? `<span class="saved-item-cell"><b>Size</b>${escapeHtml(item.size || "-")}</span>`
    : "";
  return `
    <input type="hidden" name="designId" value="${escapeHtml(item.designId || "")}">
    <input type="hidden" name="category" value="${escapeHtml(item.category || "")}">
    <input type="hidden" name="item" value="${escapeHtml(item.item || "")}">
    <input type="hidden" name="size" value="${escapeHtml(item.size || "")}">
    <input type="hidden" name="ringType" value="${escapeHtml(item.ringType || "")}">
    <input type="hidden" name="clSize" value="${escapeHtml(item.clSize || "")}">
    <input type="hidden" name="cgSize" value="${escapeHtml(item.cgSize || "")}">
    <input type="hidden" name="color" value="${escapeHtml(item.color || "")}">
    <input type="hidden" name="purity" value="${escapeHtml(item.purity || "18K")}">
    <input type="hidden" name="targetWeight" value="0">
    <input type="hidden" name="remarks" value="${escapeHtml(item.remarks || "")}">
    <span class="saved-item-cell"><b>Category</b>${escapeHtml(item.category || "-")}</span>
    <span class="saved-item-cell"><b>Design</b>${escapeHtml(design)}</span>
    ${cbDetails}
    ${normalSize}
    <span class="saved-item-cell"><b>Color</b>${escapeHtml(item.color || "-")}</span>
    <span class="saved-item-cell"><b>Purity</b>${escapeHtml(item.purity || "18K")}</span>
    <span class="saved-item-cell"><b>Remark</b>${escapeHtml(item.remarks || "-")}</span>
    <button class="delete-btn" type="button">Remove</button>
  `;
}

function renderColorOptions(selected = "") {
  return ["Pink", "Yellow", "White", "2 Tone", "3 Tone"].map((color) =>
    `<option value="${color}" ${color === selected ? "selected" : ""}>${color}</option>`
  ).join("");
}

function renderRingTypeOptions(selected = "") {
  return [
    ["", "Select"],
    ["CL", "CL - Ladies Ring"],
    ["CG", "CG - Gents Ring"],
    ["CL+CG", "Both CL + CG"],
  ].map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function ringTypeLabel(value = "") {
  return {
    CL: "CL - Ladies Ring",
    CG: "CG - Gents Ring",
    "CL+CG": "Both CL + CG",
  }[value] || "-";
}

function categoryCode(value = "") {
  return String(value).trim().toUpperCase();
}

function isCbCategory(value = "") {
  return categoryCode(value) === "CB";
}

function needsNormalSize(value = "") {
  return ["BR", "LR", "GR"].includes(categoryCode(value));
}

function updateOrderItemCategoryFields(row) {
  if (!row || row.dataset.mode === "saved") return;
  const category = row.querySelector('[name="category"]').value;
  const ringType = row.querySelector('[name="ringType"]').value;
  const showCb = isCbCategory(category);
  const showNormalSize = needsNormalSize(category);
  row.querySelectorAll(".cb-field").forEach((field) => field.classList.toggle("hidden", !showCb));
  row.querySelectorAll(".cl-size-field").forEach((field) => field.classList.toggle("hidden", !showCb || !["CL", "CL+CG"].includes(ringType)));
  row.querySelectorAll(".cg-size-field").forEach((field) => field.classList.toggle("hidden", !showCb || !["CG", "CL+CG"].includes(ringType)));
  row.querySelectorAll(".normal-size-field").forEach((field) => field.classList.toggle("hidden", !showNormalSize));
  if (!showCb) {
    row.querySelector('[name="ringType"]').value = "";
    row.querySelector('[name="clSize"]').value = "";
    row.querySelector('[name="cgSize"]').value = "";
  } else {
    if (!["CL", "CL+CG"].includes(ringType)) row.querySelector('[name="clSize"]').value = "";
    if (!["CG", "CL+CG"].includes(ringType)) row.querySelector('[name="cgSize"]').value = "";
  }
  if (!showNormalSize) row.querySelector('[name="size"]').value = "";
}

function resetOrderItemRows() {
  document.getElementById("order-item-list").innerHTML = "";
  addOrderItemRow();
  renderOrderEntrySummary();
}

function commitCurrentOrderItem() {
  const entryRow = document.querySelector('#order-item-list .order-item-row[data-mode="entry"]');
  const item = getOrderItemFromRow(entryRow);
  if (!hasOrderItemDetails(item)) {
    alert("Enter item details first.");
    return;
  }
  expandCbBothRingItem(item).forEach((orderItem) => addOrderItemRow(orderItem, "saved"));
  clearOrderEntryRow(entryRow);
  renderOrderEntrySummary();
}

function clearOrderEntryRow(row) {
  if (!row) return;
  row.querySelector('[name="designId"]').value = "";
  row.querySelector('[name="designSearch"]').value = "";
  row.querySelector('[name="category"]').value = "";
  row.querySelector('[name="ringType"]').value = "";
  row.querySelector('[name="clSize"]').value = "";
  row.querySelector('[name="cgSize"]').value = "";
  row.querySelector('[name="color"]').value = "";
  row.querySelector('[name="purity"]').value = "18K";
  row.querySelector('[name="remarks"]').value = "";
  updateOrderItemDesignOptions(row);
  updateOrderItemCategoryFields(row);
}

function getOrderFormItems(form) {
  return [...form.querySelectorAll(".order-item-row")]
    .filter((row) => row.dataset.mode === "saved")
    .map(getOrderItemFromRow)
    .flatMap(expandCbBothRingItem)
    .filter(hasOrderItemDetails);
}

function expandCbBothRingItem(item) {
  if (!item || !isCbCategory(item.category) || item.ringType !== "CL+CG") return [item].filter(Boolean);
  return [
    {
      ...item,
      ringType: "CL",
      size: item.clSize || item.size || "",
      cgSize: "",
    },
    {
      ...item,
      ringType: "CG",
      size: item.cgSize || item.size || "",
      clSize: "",
    },
  ];
}

function getOrderItemFromRow(row) {
  if (!row) return null;
  return {
    designId: row.querySelector('[name="designId"]').value,
    category: row.querySelector('[name="category"]').value,
    item: row.querySelector('[name="item"]')?.value || "",
    ringType: row.querySelector('[name="ringType"]')?.value || "",
    clSize: row.querySelector('[name="clSize"]')?.value || "",
    cgSize: row.querySelector('[name="cgSize"]')?.value || "",
    size: row.querySelector('[name="size"]')?.value || "",
    color: row.querySelector('[name="color"]').value,
    purity: row.querySelector('[name="purity"]').value,
    targetWeight: Number(row.querySelector('[name="targetWeight"]')?.value || 0),
    remarks: row.querySelector('[name="remarks"]').value,
  };
}

function hasOrderItemDetails(item) {
  return Boolean(item?.designId || item?.category || item?.ringType || item?.clSize || item?.cgSize || item?.size || item?.color || item?.remarks);
}

function renderOrderEntrySummary() {
  const summary = document.getElementById("order-entry-summary");
  if (!summary) return;
  const form = document.getElementById("order-form");
  const itemRows = [...form.querySelectorAll(".order-item-row")]
    .filter((row) => row.dataset.mode === "saved" && hasOrderItemDetails(getOrderItemFromRow(row)));
  if (!itemRows.length) {
    summary.innerHTML = '<div class="empty">No saved item yet. Fill New Item Entry and press Add Item.</div>';
    return;
  }
  summary.innerHTML = `<strong>${itemRows.length} item${itemRows.length > 1 ? "s" : ""} added. Review above before Save Order.</strong>`;
}

function applyDesignToOrderItem(row, designId) {
  const design = findById("designs", designId);
  if (!row || !design) return;
  row.querySelector('[name="category"]').value = design.category || "";
  renderOrderEntrySummary();
}

function updateOrderItemDesignOptions(row, selectedDesignId = "") {
  if (!row) return;
  const category = row.querySelector('[name="category"]').value;
  const query = String(row.querySelector('[name="designSearch"]')?.value || "").trim();
  const select = row.querySelector('[name="designId"]');
  const categoryDesigns = category
    ? sortedDesigns().filter((design) => (design.category || "Uncategorised") === category)
    : sortedDesigns();
  const designs = query ? categoryDesigns.filter((design) => designMatchesOrderSearch(design, query)) : categoryDesigns;
  const placeholder = query && !designs.length ? "No matching design" : category ? "Select design" : "Type design or select category";
  const previousValue = selectedDesignId || select.value;
  const exactMatch = query ? exactOrderDesignMatch(categoryDesigns, query) : null;
  select.innerHTML = `<option value="">${placeholder}</option>` + designs.map((design) =>
    `<option value="${design.id}">${escapeHtml(designText(design))}</option>`
  ).join("");
  if (exactMatch) {
    select.value = exactMatch.id;
    applyDesignToOrderItem(row, exactMatch.id);
    return;
  }
  select.value = designs.some((design) => design.id === previousValue) ? previousValue : "";
}

function designMatchesOrderSearch(design, query = "") {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  return [
    design.number,
    design.name,
    design.category,
    designText(design),
  ].some((value) => normalizeSearchText(value).includes(normalizedQuery));
}

function exactOrderDesignMatch(designs = [], query = "") {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return null;
  const matches = designs.filter((design) => designMatchesOrderSearch(design, query));
  return matches.find((design) =>
    [design.number, design.name, designText(design)].some((value) => normalizeSearchText(value) === normalizedQuery)
  ) || (matches.length === 1 ? matches[0] : null);
}

function syncOrderDesignSearch(row, designId) {
  const input = row?.querySelector('[name="designSearch"]');
  if (!input) return;
  input.value = designId ? designLabel(designId) : input.value;
}

function normalizeSearchText(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function renderCategoryOptions(selected = "") {
  const categories = designCategoryGroups().map((group) => group.category);
  return [
    '<option value="">Select category</option>',
    ...categories.map((category) => `<option value="${escapeHtml(category)}" ${category === selected ? "selected" : ""}>${escapeHtml(category)}</option>`),
  ].join("");
}

function renderDesignOptions() {
  const groups = sortedDesigns().reduce((acc, design) => {
    const category = design.category || "Uncategorised";
    if (!acc[category]) acc[category] = [];
    acc[category].push(design);
    return acc;
  }, {});
  const grouped = Object.entries(groups).map(([category, designs]) => `
    <optgroup label="${escapeHtml(category)}">
      ${uniqueDesigns(designs).map((design) => `<option value="${design.id}">${escapeHtml(designText(design))}</option>`).join("")}
    </optgroup>
  `).join("");
  return `<option value="">No design selected</option>${grouped}`;
}

function sortedDesigns() {
  return [...state.designs].sort((a, b) =>
    `${a.category || "Uncategorised"} ${a.number || ""}`.localeCompare(`${b.category || "Uncategorised"} ${b.number || ""}`)
  );
}

function openOrderByBarcode(value) {
  const query = String(value || "").trim().toUpperCase();
  const order = state.orders.find((item) =>
    [item.barcode, item.productionNo, item.number].some((code) => String(code || "").toUpperCase() === query)
  );
  if (!order) {
    alert("No product found for this barcode.");
    return;
  }
  openOrderDetail(order.id);
}

function barcodeSvg(value) {
  const code = `*${String(value || "").toUpperCase()}*`;
  const patterns = {
    "0": "101001101101", "1": "110100101011", "2": "101100101011", "3": "110110010101",
    "4": "101001101011", "5": "110100110101", "6": "101100110101", "7": "101001011011",
    "8": "110100101101", "9": "101100101101", "A": "110101001011", "B": "101101001011",
    "C": "110110100101", "D": "101011001011", "E": "110101100101", "F": "101101100101",
    "G": "101010011011", "H": "110101001101", "I": "101101001101", "J": "101011001101",
    "K": "110101010011", "L": "101101010011", "M": "110110101001", "N": "101011010011",
    "O": "110101101001", "P": "101101101001", "Q": "101010110011", "R": "110101011001",
    "S": "101101011001", "T": "101011011001", "U": "110010101011", "V": "100110101011",
    "W": "110011010101", "X": "100101101011", "Y": "110010110101", "Z": "100110110101",
    "-": "100101011011", ".": "110010101101", " ": "100110101101", "*": "100101101101",
  };
  let x = 0;
  const bars = [];
  [...code].forEach((char) => {
    const pattern = patterns[char] || patterns["-"];
    [...pattern].forEach((bar, index) => {
      const width = bar === "1" ? 2 : 1;
      if (index % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="34"></rect>`);
      x += width;
    });
    x += 1;
  });
  return `<div class="barcode-wrap"><svg class="barcode" viewBox="0 0 ${x} 34" preserveAspectRatio="none">${bars.join("")}</svg><small>${escapeHtml(value)}</small></div>`;
}

function findById(collection, id) {
  return state[collection].find((item) => item.id === id);
}

function getLotOrderIds(lot) {
  return lot.orderIds?.length ? lot.orderIds : [lot.orderId].filter(Boolean);
}

function getLotOrders(lot) {
  return getLotOrderIds(lot).map((id) => findById("orders", id)).filter(Boolean);
}

function rawGoldStock() {
  return state.ledger.reduce((total, item) => {
    if (item.type === "In") return total + item.weight;
    if (item.type === "Out") return total - item.weight;
    return total;
  }, 0);
}

function finishedStock() {
  return state.lots.reduce((total, lot) => {
    if (lot.productionStockWeight !== undefined) return total + Number(lot.productionStockWeight || 0);
    return total + Number(lot.finishedWeight || 0);
  }, 0);
}

function officeStockWeight() {
  return officeItems().reduce((total, { item }) => {
    if (item.saleStatus === "Sold") return total;
    return total + Number(item.netWeight || item.finalGw || 0);
  }, 0);
}

function workInProgress() {
  return state.lots
    .filter((lot) => lot.status !== "Completed")
    .reduce((total, lot) => total + lot.issuedWeight, 0);
}

async function removeItem(collection, id) {
  if (collection === "karigars" && !isOwner()) {
    alert("Only Owner can remove departments.");
    return;
  }
  if (collection === "customers" && state.orders.some((order) => order.customerId === id)) {
    alert("This customer has job orders. Edit the customer instead of deleting.");
    return;
  }
  if (collection === "designs" && state.orders.some((order) => order.designId === id)) {
    alert("This design is used in job orders. Edit the design instead of deleting.");
    return;
  }
  if (collection === "designs") {
    await deleteDesignImage(id);
    await deleteStoneChartImage(id);
  }
  state[collection] = state[collection].filter((item) => item.id !== id);
  saveState();
  render();
}

function clearJobCards() {
  state.orders = [];
  state.lots = [];
  state.bills = [];
  state.nextOrder = 1001;
  state.nextLot = 201;
  state.ledger = state.ledger.filter((item) => !["Out", "Transfer", "Finished"].includes(item.type));
  closeOpenDialogs();
}

function closeOpenDialogs() {
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
}

function openOrderDetail(orderId, editMode = false) {
  const order = findById("orders", orderId);
  if (!order) return;
  const form = document.getElementById("update-order-form");
  form.orderId.value = order.id;
  form.customerId.value = order.customerId || "";
  form.orderDate.value = order.orderDate;
  form.productionDays.value = order.productionDays;
  form.dueDate.value = order.dueDate;
  const jobOrders = getJobOrders(order);
  document.getElementById("order-dialog-summary").textContent = `${order.jobNumber || order.number} / ${jobOrders.length} item${jobOrders.length > 1 ? "s" : ""} / ${jobCurrentStage(jobOrders)} / ${daysRemainingText(order.dueDate)}`;
  renderJobItemsDetail(jobOrders);
  renderOrderLots(order);
  document.getElementById("update-order-form").classList.toggle("hidden", !editMode);
  document.getElementById("order-dialog").showModal();
}

function getJobOrders(order) {
  const jobNumber = order.jobNumber || order.productionNo || order.number;
  return state.orders.filter((item) => (item.jobNumber || item.productionNo || item.number) === jobNumber);
}

function renderJobItemsDetail(orders) {
  document.getElementById("order-items-detail").innerHTML = orders.map((order) => `
    <article class="job-item-row">
      <strong>${escapeHtml(order.productionNo || order.number)}</strong>
      <span>${barcodeSvg(order.barcode || order.productionNo || order.number)}</span>
      <span><b>Current Stage</b>${escapeHtml(orderCurrentStage(order))}</span>
      <span><b>Delivery</b>${escapeHtml(daysRemainingText(order.dueDate))}</span>
      ${order.urgent ? '<span class="job-urgent-cell"><b>Tag</b>Urgent</span>' : ""}
      <span><b>Category</b>${escapeHtml(order.category || "-")}</span>
      <span><b>Design</b>${escapeHtml(order.designNumber || designLabel(order.designId) || "-")}</span>
      ${orderSizeDetailHtml(order)}
      <span><b>Color</b>${escapeHtml(order.color || "-")}</span>
      <span><b>Purity</b>${escapeHtml(order.purity || "-")}</span>
      <span><b>Remark</b>${escapeHtml(order.remarks || "-")}</span>
      <span><b>Status</b>${escapeHtml(order.status || "-")}</span>
      <span><b>Production Stone</b>${escapeHtml(productionStoneSummaryText(productionStoneItemsForOrder(order)))}</span>
      <div class="row-actions">
        <button type="button" onclick="printSingleJobItem('${escapeHtml(order.id)}')">Print</button>
        <button type="button" onclick="openProductionStoneEntry('${escapeHtml(order.id)}')">Stone Entry</button>
        <button type="button" onclick="openItemEdit('${escapeHtml(order.id)}')">Edit Item</button>
      </div>
    </article>
  `).join("");
}

function openProductionStoneEntry(orderId) {
  const order = findById("orders", orderId);
  if (!order) return;
  const form = document.getElementById("production-stone-form");
  form.orderId.value = order.id;
  const design = findById("designs", order.designId);
  document.getElementById("production-stone-summary").textContent = `${order.productionNo || order.number} / ${order.designNumber || designLabel(order.designId) || order.category || ""} / ${design?.stoneItems?.length || 0} design stone row${design?.stoneItems?.length === 1 ? "" : "s"}`;
  renderProductionStoneItems(order);
  document.getElementById("production-stone-dialog").showModal();
}

function renderProductionStoneItems(order) {
  const container = document.getElementById("production-stone-details");
  const design = findById("designs", order.designId);
  const designItems = design?.stoneItems || [];
  const savedItems = order.productionStoneItems || [];
  container.classList.toggle("empty", !designItems.length);
  if (!designItems.length) {
    container.innerHTML = "No stone data found in Design Master for this design.";
    return;
  }
  const plannedItems = designItems.map((item) => {
    const saved = savedItems.find((savedItem) => savedItem.sourceDesignStoneId === item.id) || {};
    const automaticSetting = automaticProductionStoneSetting(item);
    return {
      ...item,
      productionStoneId: saved.id || "",
      settingType: saved.settingType || automaticSetting.settingType,
      manufacturingStage: saved.manufacturingStage || automaticSetting.manufacturingStage,
    };
  });
  container.innerHTML = `
    <div class="stone-total-summary">${productionStoneSummaryText(savedItems.length ? savedItems : plannedItems)}</div>
    <table>
      <thead><tr><th>Code</th><th>Type</th><th>Shape</th><th>Size</th><th>No. Pcs</th><th>Wt/Pc (g)</th><th>Total Wt (g)</th><th>Setting Type</th><th>Manufacturing Stage</th></tr></thead>
      <tbody>${plannedItems.map((item) => `
        <tr
          data-design-stone-id="${escapeHtml(item.id)}"
          data-production-stone-id="${escapeHtml(item.productionStoneId)}"
          data-stone-type="${escapeHtml(item.stoneType || "")}"
          data-shape="${escapeHtml(item.shape || "")}"
          data-size="${escapeHtml(item.size || "")}"
          data-code="${escapeHtml(item.code || stoneLookupCode(item))}"
          data-pcs="${escapeHtml(item.pcs || 0)}"
          data-weight-per-pc="${escapeHtml(item.weightPerPc || "")}"
          data-total-weight="${escapeHtml(item.totalWeight || totalStoneWeight(item.weightPerPc, item.pcs))}"
        >
          <td>${escapeHtml(item.code || stoneLookupCode(item))}</td>
          <td>${escapeHtml(item.stoneType || "-")}</td>
          <td>${escapeHtml(item.shape || "-")}</td>
          <td>${escapeHtml(item.size || "-")}</td>
          <td>${escapeHtml(item.pcs || "-")}</td>
          <td>${escapeHtml(formatStoneWeight(item.weightPerPc) || "-")}</td>
          <td>${escapeHtml(item.totalWeight || totalStoneWeight(item.weightPerPc, item.pcs) || "-")}</td>
          <td><select name="productionSettingType">${productionSettingOptions(item.settingType)}</select></td>
          <td><select name="manufacturingStage">${manufacturingStageOptions(item.manufacturingStage)}</select></td>
        </tr>
      `).join("")}</tbody>
    </table>`;
}

function removeProductionStoneItem(orderId, stoneItemId) {
  const order = findById("orders", orderId);
  if (!order) return;
  order.productionStoneItems = (order.productionStoneItems || []).filter((item) => item.id !== stoneItemId);
  saveState();
  renderProductionStoneItems(order);
  renderJobItemsDetail(getJobOrders(order));
}

function productionStoneSummaryText(items = []) {
  const wax = productionStoneTotals(items, "wax");
  const hand = productionStoneTotals(items, "hand");
  const totalPcs = wax.pcs + hand.pcs;
  const totalWeight = wax.weight + hand.weight;
  if (!totalPcs && !totalWeight) return "No stone";
  return `Wax ${wax.pcs} pcs / ${weight3(wax.weight)}g, Hand ${hand.pcs} pcs / ${weight3(hand.weight)}g, Total ${totalPcs} pcs / ${weight3(totalWeight)}g`;
}

function productionStoneTotals(items = [], settingType = "") {
  return items
    .filter((item) => !settingType || item.settingType === settingType)
    .reduce((total, item) => {
      total.pcs += Number(item.pcs || 0);
      total.weight += Number(item.totalWeight || 0);
      return total;
    }, { pcs: 0, weight: 0 });
}

function productionStoneSettingLabel(value) {
  return value === "hand" ? "Hand Stone Setting" : "Wax Stone Setting";
}

function automaticProductionStoneSetting(item = {}) {
  return stoneMaxMm(item.size) <= 2
    ? { settingType: "wax", manufacturingStage: "Wax" }
    : { settingType: "hand", manufacturingStage: "Setting" };
}

function stoneMaxMm(size = "") {
  const numbers = normalizeSizeText(size)
    .split("*")
    .map((part) => Number(part))
    .filter((number) => Number.isFinite(number));
  return numbers.length ? Math.max(...numbers) : Infinity;
}

function productionSettingOptions(selected = "wax") {
  return [
    ["wax", "Wax Stone Setting"],
    ["hand", "Hand Stone Setting"],
  ].map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function manufacturingStageOptions(selected = "") {
  const defaults = ["Wax", "Casting", "Filing / Fitting", "Setting", "Polishing", "QC", "Bill"];
  const departmentStages = state.karigars.flatMap((karigar) => [karigar.name, karigar.speciality]).filter(Boolean);
  const stages = [...new Set([...defaults, ...departmentStages])];
  return [
    `<option value="" ${!selected ? "selected" : ""}>Select stage</option>`,
    ...stages.map((stage) => `<option value="${escapeHtml(stage)}" ${stage === selected ? "selected" : ""}>${escapeHtml(stage)}</option>`),
  ].join("");
}

function openItemEdit(orderId) {
  const order = findById("orders", orderId);
  if (!order) return;
  const form = document.getElementById("item-edit-form");
  form.orderId.value = order.id;
  form.category.innerHTML = renderCategoryOptions(order.category || "");
  form.designId.innerHTML = renderDesignOptions();
  form.category.value = order.category || "";
  updateItemEditDesignOptions(form, order.designId || "");
  form.ringType.value = order.ringType || "";
  form.size.value = order.size || "";
  form.clSize.value = order.clSize || "";
  form.cgSize.value = order.cgSize || "";
  form.color.value = order.color || "Pink";
  form.purity.value = order.purity || "18K";
  form.remarks.value = order.remarks || "";
  updateItemEditCategoryFields(form);
  document.getElementById("item-edit-summary").textContent = `${order.productionNo || order.number} / ${order.customer || ""}`;
  document.getElementById("item-edit-dialog").showModal();
}

function updateItemEditDesignOptions(form, selectedDesignId = "") {
  const category = form.category.value;
  const designs = category
    ? sortedDesigns().filter((design) => (design.category || "Uncategorised") === category)
    : sortedDesigns();
  const placeholder = category ? "Select design" : "Select design or category";
  form.designId.innerHTML = `<option value="">${placeholder}</option>` + designs.map((design) =>
    `<option value="${design.id}">${escapeHtml(designText(design))}</option>`
  ).join("");
  form.designId.value = designs.some((design) => design.id === selectedDesignId) ? selectedDesignId : "";
}

function applyDesignToItemEdit(form, designId) {
  const design = findById("designs", designId);
  if (!design) return;
  form.category.value = design.category || "";
  updateItemEditDesignOptions(form, designId);
  updateItemEditCategoryFields(form);
}

function updateItemEditCategoryFields(form) {
  const category = form.category.value;
  const ringType = form.ringType.value;
  const showCb = isCbCategory(category);
  const showNormalSize = needsNormalSize(category);
  form.querySelectorAll(".cb-field").forEach((field) => field.classList.toggle("hidden", !showCb));
  form.querySelectorAll(".cl-size-field").forEach((field) => field.classList.toggle("hidden", !showCb || !["CL", "CL+CG"].includes(ringType)));
  form.querySelectorAll(".cg-size-field").forEach((field) => field.classList.toggle("hidden", !showCb || !["CG", "CL+CG"].includes(ringType)));
  form.querySelectorAll(".normal-size-field").forEach((field) => field.classList.toggle("hidden", !showNormalSize));
  if (!showCb) {
    form.ringType.value = "";
    form.clSize.value = "";
    form.cgSize.value = "";
  } else {
    if (!["CL", "CL+CG"].includes(ringType)) form.clSize.value = "";
    if (!["CG", "CL+CG"].includes(ringType)) form.cgSize.value = "";
  }
  if (!showNormalSize) form.size.value = "";
}

function cleanItemSizeFields(order) {
  if (!isCbCategory(order.category)) {
    order.ringType = "";
    order.clSize = "";
    order.cgSize = "";
  } else {
    if (!["CL", "CL+CG"].includes(order.ringType)) order.clSize = "";
    if (!["CG", "CL+CG"].includes(order.ringType)) order.cgSize = "";
  }
  if (!needsNormalSize(order.category)) order.size = "";
}

function orderSizeDetailHtml(order) {
  if (isCbCategory(order.category)) {
    return `
      <span><b>Ring</b>${escapeHtml(ringTypeLabel(order.ringType))}</span>
      <span><b>CL Size</b>${escapeHtml(order.clSize || "-")}</span>
      <span><b>CG Size</b>${escapeHtml(order.cgSize || "-")}</span>
    `;
  }
  if (needsNormalSize(order.category)) {
    return `<span><b>Size</b>${escapeHtml(order.size || "-")}</span>`;
  }
  return "";
}

function printSizeDetailHtml(order) {
  if (isCbCategory(order.category)) {
    return `
      <span><b>Ring</b>${escapeHtml(ringTypeLabel(order.ringType))}</span>
      <span><b>CL Size</b>${escapeHtml(order.clSize || "-")}</span>
      <span><b>CG Size</b>${escapeHtml(order.cgSize || "-")}</span>
    `;
  }
  if (needsNormalSize(order.category)) {
    return `<span><b>Size</b>${escapeHtml(order.size || "-")}</span>`;
  }
  return "";
}

async function printOpenJobOrder() {
  const orderId = document.getElementById("update-order-form").orderId.value;
  const order = findById("orders", orderId);
  if (!order) return;
  const jobOrders = getJobOrders(order);
  startJobPrint(await jobOrderPrintHtml(order, jobOrders));
}

async function printSingleJobItem(orderId) {
  const order = findById("orders", orderId);
  if (!order) return;
  startJobPrint(await jobOrderPrintHtml(order, [order]), "single");
}

function startJobPrint(html, mode = "job") {
  const printArea = getGlobalPrintArea();
  printArea.innerHTML = html;
  setPrintPageSize(mode);
  document.body.classList.add("printing-order");
  document.body.classList.toggle("printing-single-item", mode === "single");
  const cleanup = () => {
    document.body.classList.remove("printing-order");
    document.body.classList.remove("printing-single-item");
    printArea.innerHTML = "";
    setPrintPageSize("job");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  setTimeout(() => window.print(), 100);
}

function setPrintPageSize(mode = "job") {
  let style = document.getElementById("dynamic-print-page-size");
  if (!style) {
    style = document.createElement("style");
    style.id = "dynamic-print-page-size";
    document.head.appendChild(style);
  }
  style.textContent = mode === "single"
    ? "@media print { @page { size: 105mm 148.5mm; margin: 0; } }"
    : "@media print { @page { size: A4 portrait; margin: 0; } }";
}

function getGlobalPrintArea() {
  let printArea = document.getElementById("global-print-area");
  if (!printArea) {
    printArea = document.createElement("section");
    printArea.id = "global-print-area";
    printArea.className = "order-print-area global-print-area";
    document.body.appendChild(printArea);
  }
  return printArea;
}

async function jobOrderPrintHtml(order, orders) {
  const printableItems = await Promise.all(orders.map(async (item) => {
    const design = findById("designs", item.designId);
    let imageData = "";
    if (design) {
      imageData = await getDesignImage(design.id).catch(() => design.imageData || "");
    }
    return { item, design, imageData };
  }));
  const printableGroups = groupCbPrintItems(printableItems);
  return `
    <div class="print-items">
      ${chunkPrintItems(printableGroups).map((pageItems) => `
        <section class="print-page">
          ${pageItems.map((entry) => printJobItemHtml(order, entry)).join("")}
        </section>
      `).join("")}
    </div>
  `;
}

function chunkPrintItems(items, size = 4) {
  const pages = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

function groupCbPrintItems(printableItems) {
  const groups = [];
  const used = new Set();
  printableItems.forEach((entry, index) => {
    if (used.has(index)) return;
    const item = entry.item;
    if (!isCbCategory(item.category) || item.ringType !== "CL") {
      groups.push({ ...entry, items: [item] });
      used.add(index);
      return;
    }
    const pairIndex = printableItems.findIndex((candidate, candidateIndex) =>
      !used.has(candidateIndex) &&
      candidateIndex !== index &&
      isMatchingCbPrintPair(item, candidate.item)
    );
    if (pairIndex >= 0) {
      groups.push({ ...entry, items: [item, printableItems[pairIndex].item] });
      used.add(index);
      used.add(pairIndex);
    } else {
      groups.push({ ...entry, items: [item] });
      used.add(index);
    }
  });
  return groups;
}

function isMatchingCbPrintPair(left, right) {
  if (!left || !right || !isCbCategory(right.category) || right.ringType !== "CG") return false;
  if (right.cbSplitFrom && right.cbSplitFrom === left.id) return true;
  return ["jobNumber", "customerId", "designId", "category", "color", "purity", "remarks", "orderDate", "dueDate"]
    .every((field) => String(left[field] || "") === String(right[field] || ""));
}

function combinedCbPrintItem(items) {
  if (!items?.length || items.length === 1) return items?.[0];
  const cl = items.find((item) => item.ringType === "CL") || items[0];
  const cg = items.find((item) => item.ringType === "CG") || items[1];
  return {
    ...cl,
    ringType: "CL+CG",
    clSize: cl.clSize || cl.size || "",
    cgSize: cg.cgSize || cg.size || "",
    productionNo: items.map((item) => item.productionNo || item.number).filter(Boolean).join(" / "),
    number: items.map((item) => item.number || item.productionNo).filter(Boolean).join(" / "),
    barcodeValues: [
      { label: "CL", value: cl.barcode || cl.productionNo || cl.number },
      { label: "CG", value: cg.barcode || cg.productionNo || cg.number },
    ].filter((item) => item.value),
  };
}

function printJobItemHtml(job, entry) {
  const order = combinedCbPrintItem(entry.items || [entry.item]);
  const { design, imageData } = entry;
  const designName = order.designNumber || (design ? designText(design) : "") || "-";
  const jobNumber = job.jobNumber || job.productionNo || job.number;
  const isCustomerOrder = (order.customer || job.customer || "").trim().toUpperCase() !== "KJPL-STOCK";
  const productionLabel = order.productionNo || order.number;
  const barcodeValues = order.barcodeValues?.length
    ? order.barcodeValues
    : [{ label: "", value: order.barcode || order.productionNo || order.number }];
  return `
    <article class="print-job-item ${isCustomerOrder ? "customer-order-print" : ""}">
      <div class="print-card-head">
        <div>
          <strong>KHUSHALI JEWELLS</strong>
          <span>Job: ${escapeHtml(jobNumber || "-")}</span>
        </div>
        <div>
          <strong>${escapeHtml(productionLabel || "-")}</strong>
          <span>Due: ${escapeHtml(order.dueDate || job.dueDate || "-")}</span>
        </div>
      </div>
      <div class="print-card-body">
        <div class="print-design-image">
          ${imageData ? `<img src="${imageData}" alt="${escapeHtml(designName)}">` : "<span>No Image</span>"}
        </div>
        <div class="print-job-details">
          <div class="print-detail-grid">
            <span class="print-wide print-customer-box"><b>Customer</b>${escapeHtml(order.customer || job.customer || "-")}</span>
            <span class="print-wide"><b>Design</b>${escapeHtml(designName)}</span>
            <span><b>Category</b>${escapeHtml(order.category || "-")}</span>
            ${printSizeDetailHtml(order)}
            <span><b>Color</b>${escapeHtml(order.color || "-")}</span>
            <span><b>Purity</b>${escapeHtml(order.purity || "-")}</span>
            <span class="print-wide"><b>Remark</b>${escapeHtml(order.remarks || "-")}</span>
          </div>
        </div>
      </div>
      <div class="print-stone-section">
        ${printStoneDetailsHtml(design)}
      </div>
      <div class="print-barcode ${barcodeValues.length > 1 ? "combined" : ""}">
        ${barcodeValues.map((barcode) => `
          <div class="barcode-box">
            ${barcode.label ? `<b>${escapeHtml(barcode.label)}</b>` : ""}
            ${barcodeSvg(barcode.value)}
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function printStoneDetailsHtml(design) {
  const totals = designStoneTotals(design?.stoneItems || []);
  const stoneRows = (design?.stoneItems || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.stoneType || "")}</td>
      <td>${escapeHtml([item.shape, item.size].filter(Boolean).join(" "))}</td>
      <td>${escapeHtml(item.pcs || "")}</td>
      <td>${escapeHtml(formatStoneWeight(item.weightPerPc) || "")}</td>
      <td>${escapeHtml(item.totalWeight || "")}</td>
    </tr>
  `).join("");
  const totalRow = `
    <tr class="stone-total-row">
      <td colspan="2">Total</td>
      <td>${escapeHtml(totals.pcs || "")}</td>
      <td></td>
      <td>${escapeHtml(totals.weight ? weight3(totals.weight) : "")}</td>
    </tr>
  `;
  const blankRows = Array.from({ length: 5 }, () => `
    <tr class="manual-stone-row"><td></td><td></td><td></td><td></td><td></td></tr>
  `).join("");
  return `
    <div class="print-stone-details">
      <b>Stone Details</b>
      <table>
        <thead><tr><th>Type</th><th>Shape</th><th>No of Pcs</th><th>Wt/Pc</th><th>Total Weight</th></tr></thead>
        <tbody>${stoneRows}${totalRow}${blankRows}</tbody>
      </table>
    </div>
  `;
}

function renderOrderLots(order) {
  const lots = state.lots.filter((lot) => getLotOrderIds(lot).includes(order.id));
  document.getElementById("order-lots-list").innerHTML = lots.length
    ? lots.map(renderOrderLotCard).join("")
    : '<div class="empty">No gold issued for this order yet. Use Issue Gold to start production.</div>';
}

function renderOrderLotCard(lot) {
  const stoneTotals = productionStoneTotalsForOrders(getLotOrders(lot));
  const waxStoneTotals = productionStoneTotalsForOrders(getLotOrders(lot), "wax");
  const handStoneTotals = productionStoneTotalsForOrders(getLotOrders(lot), "hand");
  const actions = lot.status === "Completed"
    ? `<button class="ghost-button" type="button" onclick="openHistoryFromOrder('${lot.id}')">History</button>`
    : `<button type="button" onclick="openTransferFromOrder('${lot.id}')">Transfer</button><button type="button" onclick="openCompleteFromOrder('${lot.id}')">Complete</button><button class="ghost-button" type="button" onclick="openHistoryFromOrder('${lot.id}')">History</button>`;
  return `
    <article class="order-lot-card">
      <div>
        <strong>${lot.number}</strong>
        <span>${escapeHtml(lot.karigarName)} / ${escapeHtml(lot.currentDepartment || "-")} / ${escapeHtml(lot.status)}</span>
      </div>
      <div class="order-lot-meta">
        <span><b>Issued</b>${gram(lot.issuedWeight)}</span>
        <span><b>Current</b>${gram(currentTransferIssueWeight(lot))}</span>
        <span><b>Prod. Stone</b>${stoneTotals.pcs} pcs / ${weight3(stoneTotals.weight)}g</span>
        <span><b>Wax Stone</b>${waxStoneTotals.pcs} pcs / ${weight3(waxStoneTotals.weight)}g</span>
        <span><b>Hand Stone</b>${handStoneTotals.pcs} pcs / ${weight3(handStoneTotals.weight)}g</span>
        <span><b>Transfers</b>${(lot.transfers || []).length}</span>
      </div>
      <div class="row-actions">${actions}</div>
    </article>
  `;
}

function productionStoneTotalsForOrders(orders = [], settingType = "") {
  return productionStoneTotals(orders.flatMap(productionStoneItemsForOrder), settingType);
}

function productionStoneItemsForOrder(order) {
  if (order.productionStoneItems?.length) return order.productionStoneItems;
  const design = findById("designs", order.designId);
  return (design?.stoneItems || []).map((item) => {
    const automaticSetting = automaticProductionStoneSetting(item);
    return {
      id: crypto.randomUUID(),
      sourceDesignStoneId: item.id || "",
      date: today(),
      settingType: automaticSetting.settingType,
      manufacturingStage: automaticSetting.manufacturingStage,
      stoneType: item.stoneType || "",
      shape: item.shape || "",
      size: item.size || "",
      code: item.code || stoneLookupCode(item),
      pcs: Number(item.pcs || 0),
      weightPerPc: formatStoneWeight(item.weightPerPc),
      totalWeight: item.totalWeight || totalStoneWeight(item.weightPerPc, item.pcs),
    };
  });
}

function updateIssueMetalSummary() {
  const form = document.getElementById("production-form");
  const summary = document.getElementById("issue-metal-summary");
  if (!form || !summary) return;
  const jobNumber = form.jobNumber.value;
  const grossIssue = Number(form.issuedWeight.value || 0);
  const selectedOrders = state.orders.filter((order) =>
    (order.jobNumber || order.productionNo || order.number) === jobNumber && order.status === "Pending"
  );
  const waxStoneWeight = productionStoneTotalsForOrders(selectedOrders, "wax").weight;
  const netMetal = Number(weight3(grossIssue - waxStoneWeight));
  const purities = [...new Set(selectedOrders.map((order) => order.purity).filter(Boolean))];
  if (!jobNumber) {
    summary.textContent = "Select job card and enter Gold Issue weight to see: Gold Issue - Wax Stone = Net Wt.";
    return;
  }
  const purityNote = purities.length > 1 ? ` Multiple purities in job: ${purities.join(", ")}.` : ` Purity: ${purities[0] || form.metalPurity.value || "-"}.`;
  summary.textContent = `Gold Issue ${gram(grossIssue)} - Wax Stone ${gram(waxStoneWeight)} = Net Wt ${gram(Math.max(netMetal, 0))}.${purityNote}`;
  summary.classList.toggle("warn", grossIssue > 0 && netMetal <= 0);
}

function applyIssuePurityFromJob() {
  const form = document.getElementById("production-form");
  if (!form?.jobNumber?.value) return;
  const selectedOrders = state.orders.filter((order) =>
    (order.jobNumber || order.productionNo || order.number) === form.jobNumber.value && order.status === "Pending"
  );
  const purities = [...new Set(selectedOrders.map((order) => order.purity).filter(Boolean))];
  if (purities.length) form.metalPurity.value = purities[0];
}

function openTransferFromOrder(lotId) {
  document.getElementById("order-dialog").close();
  openTransferLot(lotId);
}

function openCompleteFromOrder(lotId) {
  document.getElementById("order-dialog").close();
  openCompleteLot(lotId);
}

function openHistoryFromOrder(lotId) {
  document.getElementById("order-dialog").close();
  openLotHistory(lotId);
}

function openCompleteLot(lotId) {
  const lot = findById("lots", lotId);
  if (!lot) return;
  const form = document.getElementById("complete-form");
  form.lotId.value = lot.id;
  form.finishedWeight.value = weight3(Math.max(lot.issuedWeight - (lot.issuedWeight * lot.expectedWastage) / 100, 0));
  form.actualWastage.value = weight3((lot.issuedWeight * lot.expectedWastage) / 100);
  form.wastagePurity.value = lot.wastagePurity || lot.metalPurity || getLotOrders(lot)[0]?.purity || "18K";
  updateCompleteFineGold();
  document.getElementById("complete-dialog").showModal();
}

function updateCompleteFineGold() {
  const form = document.getElementById("complete-form");
  if (!form) return;
  form.wastageFineGold.value = weight3(fineGoldWeight(form.actualWastage.value, form.wastagePurity.value));
}

function openTransferLot(lotId) {
  const lot = findById("lots", lotId);
  if (!lot) return;
  const form = document.getElementById("transfer-form");
  const issueWeight = currentTransferIssueWeight(lot);
  const waxStoneWeight = transferWaxStoneWeight(lot);
  const existingHandStoneWeight = currentHandStoneWeight(lot);
  const handStoneWeight = productionStoneWeightForTransfer(lot) || existingHandStoneWeight;
  const handStoneAddedNow = Math.max(handStoneWeight - existingHandStoneWeight, 0);
  form.lotId.value = lot.id;
  form.transferId.value = "";
  document.getElementById("transfer-form-title").textContent = "Transfer Job To Another Department";
  form.transferWeight.value = weight3(issueWeight);
  form.grossReceivedWeight.value = weight3(issueWeight + handStoneAddedNow);
  form.waxStoneWeight.value = weight3(waxStoneWeight);
  form.stoneWeight.value = weight3(handStoneWeight);
  form.reducedWeight.value = weight3(waxStoneWeight + handStoneWeight);
  form.receivedWeight.value = weight3(Math.max(issueWeight + handStoneAddedNow - waxStoneWeight - handStoneWeight, 0));
  form.departmentBalance.value = weight3(0);
  form.fromDepartment.value = lot.currentDepartment || lot.karigarName;
  form.toDepartment.value = "";
  form.reason.value = "";
  const settingStoneNote = handStoneWeight > 0
    ? ` Hand-setting stone caught from job card: ${gram(handStoneWeight)}.`
    : "";
  document.getElementById("transfer-current").textContent = `${lot.number} is currently with ${lot.karigarName} in ${lot.currentDepartment || "current department"}. GW includes wax stone ${gram(waxStoneWeight)}.${settingStoneNote}`;
  renderTransferOptions(lot);
  applyProductionFlowDefaults(lot);
  applyProductionStoneWeightToTransfer();
  document.getElementById("transfer-dialog").showModal();
}

function openTransferEdit(lotId, transferId) {
  const lot = findById("lots", lotId);
  const transfer = lot?.transfers?.find((item) => item.id === transferId);
  if (!lot || !transfer) return;
  const historyDialog = document.getElementById("history-dialog");
  if (historyDialog.open) historyDialog.close();
  const form = document.getElementById("transfer-form");
  form.lotId.value = lot.id;
  form.transferId.value = transfer.id;
  document.getElementById("transfer-form-title").textContent = `Edit Transfer - ${lot.number}`;
  renderTransferOptions({ karigarId: transfer.fromKarigarId });
  form.karigarId.value = transfer.toKarigarId || "";
  form.transferWeight.value = weight3(transfer.transferWeight);
  form.grossReceivedWeight.value = weight3(transfer.grossReceivedWeight);
  form.waxStoneWeight.value = weight3(transfer.waxStoneWeight);
  form.stoneWeight.value = weight3(transfer.stoneWeight);
  form.reducedWeight.value = weight3(transfer.reducedWeight ?? Number(transfer.waxStoneWeight || 0) + Number(transfer.stoneWeight || 0));
  form.receivedWeight.value = weight3(transfer.receivedWeight);
  form.departmentBalance.value = weight3(transfer.departmentBalance);
  form.fromDepartment.value = transfer.fromDepartment || "";
  form.toDepartment.value = transfer.toDepartment || "";
  form.reason.value = transfer.reason || "";
  document.getElementById("transfer-current").textContent = `Editing transfer for ${lot.number}.`;
  document.getElementById("transfer-dialog").showModal();
}

function deleteTransfer(lotId, transferId) {
  const lot = findById("lots", lotId);
  const transfer = lot?.transfers?.find((item) => item.id === transferId);
  if (!lot || !transfer) return;
  const transferLabel = `${transfer.fromDepartment || transfer.fromKarigarName || "-"} to ${transfer.toDepartment || transfer.toKarigarName || "-"}`;
  if (!confirm(`Delete this transfer?\n${lot.number}: ${transferLabel}`)) return;
  lot.transfers = (lot.transfers || []).filter((item) => item.id !== transferId);
  recalculateLotAfterTransferChange(lot);
  state.ledger.unshift({
    id: crypto.randomUUID(),
    date: today(),
    type: "Transfer Deleted",
    purity: "-",
    weight: 0,
    reference: `${lot.number} deleted transfer ${transferLabel}, issued ${gram(transfer.transferWeight)}, net ${gram(transfer.receivedWeight)}`,
  });
  saveState();
  render();
  const historyDialog = document.getElementById("history-dialog");
  if (historyDialog.open) openLotHistory(lot.id);
}

function recalculateLotAfterTransferChange(lot) {
  const linkedOrders = getLotOrders(lot);
  const latest = lot.transfers?.at(-1);
  lot.karigarId = lot.issueKarigarId || lot.karigarId;
  lot.karigarName = lot.issueKarigarName || lot.karigarName;
  lot.currentDepartment = mergedProductionDepartmentName(lot.issueDepartment || lot.currentDepartment || lot.karigarName);
  lot.status = "Issued";
  lot.finishedWeight = 0;
  lot.actualWastage = 0;
  linkedOrders.forEach((order) => {
    order.status = "In Production";
  });
  if (!latest) return;
  lot.karigarId = latest.toKarigarId;
  lot.karigarName = latest.toKarigarName;
  lot.currentDepartment = mergedProductionDepartmentName(latest.toDepartment);
  if (isBillTransferDestination({ toDepartment: latest.toDepartment }, { name: latest.toKarigarName })) {
    lot.finishedWeight = Number(latest.receivedWeight || 0);
    lot.actualWastage = Number(latest.departmentBalance || 0);
    lot.status = "Completed";
    linkedOrders.forEach((order) => {
      order.status = "Completed";
    });
  }
}

function isBillTransferDestination(data, karigar) {
  return [data.toDepartment, karigar?.name, karigar?.speciality]
    .some((value) => String(value || "").trim().toLowerCase().includes("bill"));
}

function productionStoneWeightForTransfer(lot) {
  if (!isSettingDepartment(lot.currentDepartment) && !isSettingDepartment(lot.karigarName)) return 0;
  return productionStoneTotalsForOrders(getLotOrders(lot), "hand").weight;
}

function transferWaxStoneWeight(lot) {
  return Number(lot.waxStoneWeight || productionStoneTotalsForOrders(getLotOrders(lot), "wax").weight || 0);
}

function currentHandStoneWeight(lot, beforeTransferId = "") {
  if (!lot) return 0;
  const allTransfers = lot.transfers || [];
  const transferIndex = beforeTransferId ? allTransfers.findIndex((transfer) => transfer.id === beforeTransferId) : -1;
  const transfers = transferIndex >= 0 ? allTransfers.slice(0, transferIndex) : allTransfers;
  const latestWithHandStone = [...transfers].reverse().find((transfer) => Number(transfer.handStoneWeight ?? transfer.stoneWeight ?? 0) > 0);
  return Number(latestWithHandStone?.handStoneWeight ?? latestWithHandStone?.stoneWeight ?? 0);
}

function isSettingDepartment(value = "") {
  return String(value || "").trim().toLowerCase().includes("setting");
}

function currentTransferIssueWeight(lot) {
  const transfers = lot.transfers || [];
  if (!transfers.length) return Number(lot.grossIssuedWeight || (Number(lot.issuedWeight || 0) + transferWaxStoneWeight(lot)));
  const latest = transfers.at(-1);
  return Number(latest.grossReceivedWeight ?? latest.receivedWeight ?? latest.transferWeight ?? lot.grossIssuedWeight ?? lot.issuedWeight ?? 0);
}

function renderTransferOptions(lot) {
  const options = state.karigars
    .filter((karigar) => karigar.id !== lot.karigarId)
    .map((karigar) => `<option value="${karigar.id}">${escapeHtml(karigar.name)} - ${escapeHtml(karigar.speciality)}</option>`)
    .join("");
  document.querySelector('#transfer-form select[name="karigarId"]').innerHTML = options || '<option value="">No other department available</option>';
}

function applyProductionFlowDefaults(lot) {
  const form = document.getElementById("transfer-form");
  const nextStep = nextProductionFlowStep(lot);
  if (!nextStep) return;
  const targetDepartment = findFlowDepartment(nextStep, lot.karigarId);
  if (targetDepartment) form.karigarId.value = targetDepartment.id;
  form.toDepartment.value = nextStep.label;
  form.reason.value = `Next process: ${nextStep.label}`;
}

function nextProductionFlowStep(lot) {
  const latestTransfer = (lot.transfers || []).at(-1);
  if (latestTransfer) {
    const latestIndex = productionFlow.findIndex((step, index) =>
      index > 0 && step.label === latestTransfer.toDepartment
    );
    if (latestIndex >= 0) return productionFlow[latestIndex + 1] || null;
  }
  const currentText = `${lot.currentDepartment || ""} ${lot.karigarName || ""}`;
  const currentIndex = productionFlow.findIndex((step) => textMatchesAny(currentText, step.matches));
  if (currentIndex < 0) return productionFlow[0];
  return productionFlow[currentIndex + 1] || null;
}

function findFlowDepartment(step, currentDepartmentId = "") {
  return state.karigars.find((karigar) =>
    karigar.id !== currentDepartmentId &&
    textMatchesAny(`${karigar.name || ""} ${karigar.speciality || ""}`, step.departmentMatches)
  );
}

function mergedProductionDepartmentName(value = "") {
  const text = String(value || "").trim();
  return textMatchesAny(text, ["filer", "filing", "fitting", "back to filer"]) ? "Filing / Fitting" : text;
}

function departmentDashboardHeader(value = "") {
  const mergedName = mergedProductionDepartmentName(value || "Unassigned");
  if (isPrePolishDepartment(mergedName) || isPolishDepartment(mergedName)) return "Pre Polish / Polish";
  return mergedName;
}

function departmentDashboardSplitLabel(value = "") {
  const mergedName = mergedProductionDepartmentName(value || "Unassigned");
  if (isPrePolishDepartment(mergedName)) return "Pre Polish";
  if (isPolishDepartment(mergedName)) return "Polish";
  return mergedName;
}

function isPrePolishDepartment(value = "") {
  return textMatchesAny(value, ["pp", "pre polish", "pre polishing"]);
}

function isPolishDepartment(value = "") {
  return textMatchesAny(value, ["final polish", "final polishing", "polishing department", "polishing dept", "polishing", "polish"]);
}

function textMatchesAny(text = "", matches = []) {
  const normalized = String(text || "").toLowerCase();
  return matches.some((match) => textMatchesKeyword(normalized, match));
}

function textMatchesKeyword(normalizedText = "", match = "") {
  const keyword = String(match || "").toLowerCase().trim();
  if (!keyword) return false;
  if (keyword.length <= 2) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`).test(normalizedText);
  }
  return normalizedText.includes(keyword);
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function render() {
  renderSelects();
  renderDashboard();
  renderCustomers();
  renderDesigns();
  renderStoneLibrary();
  renderOrders();
  renderProduction();
  renderBills();
  renderOffice();
  renderLedger();
  renderMelting();
  renderKarigars();
  renderOnlineTransferHistory();
  renderReports();
  renderLoginUsers();
}

function renderLoginUsers() {
  const table = document.getElementById("login-users-table");
  if (!table) return;
  const rows = Object.entries(users).map(([id, user]) => `
    <tr>
      <td><strong>${escapeHtml(id)}</strong></td>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(userAccessText(user))}</td>
    </tr>
  `).join("");
  table.innerHTML = isOwner() ? rows : tableEmpty(3, "Only Owner can view login roles.");
}

function renderStoneLibrary() {
  const query = document.getElementById("stone-search").value.trim().toLowerCase();
  const matches = state.stones.filter((stone) =>
    `${stone.stoneType} ${stone.shape} ${stone.size} ${stone.code} ${stone.weightPerPc} ${stone.pricePerPc} ${stone.remarks}`.toLowerCase().includes(query)
  );
  const totalPages = Math.max(Math.ceil(matches.length / stoneLibraryPageSize), 1);
  stoneLibraryPage = Math.min(Math.max(stoneLibraryPage, 1), totalPages);
  const start = (stoneLibraryPage - 1) * stoneLibraryPageSize;
  const visible = matches.slice(start, start + stoneLibraryPageSize);
  document.getElementById("stone-library-summary").textContent =
    `${state.stones.length} stones in library${query ? ` / ${matches.length} match search` : ""} / showing ${visible.length ? start + 1 : 0}-${start + visible.length} of ${matches.length}`;
  document.getElementById("stone-table").innerHTML = visible.length
    ? visible.map((stone) => `
      <tr>
        <td>${escapeHtml(stone.stoneType || "-")}</td>
        <td>${escapeHtml(stone.shape || "-")}</td>
        <td>${escapeHtml(stone.size || "-")}</td>
        <td>${escapeHtml(stone.code || "-")}</td>
        <td>${escapeHtml(formatStoneWeight(stone.weightPerPc) || "-")}</td>
        <td>${escapeHtml(stone.pricePerPc || "-")}</td>
        <td>${escapeHtml(stone.remarks || "-")}</td>
        <td><div class="row-actions"><button onclick="editStone('${stone.id}')">Edit</button><button class="delete-btn" onclick="removeStone('${stone.id}')">Delete</button></div></td>
      </tr>
    `).join("")
    : tableEmpty(8, "No stones found.");
  document.getElementById("stone-pagination").innerHTML = matches.length
    ? `
      <button class="ghost-button" type="button" onclick="changeStonePage(-1)" ${stoneLibraryPage <= 1 ? "disabled" : ""}>Previous</button>
      <span>Page ${stoneLibraryPage} of ${totalPages}</span>
      <button class="ghost-button" type="button" onclick="changeStonePage(1)" ${stoneLibraryPage >= totalPages ? "disabled" : ""}>Next</button>
    `
    : "";
  renderStoneFormOptions();
  renderStoneLookupOptions();
  renderStoneLookup();
}

function changeStonePage(direction) {
  stoneLibraryPage += Number(direction || 0);
  renderStoneLibrary();
}

function handleStoneFormChange(changedField) {
  const form = document.getElementById("stone-form");
  if (changedField === "stoneType") {
    form.shape.value = "";
    form.size.value = "";
  }
  if (changedField === "shape") {
    form.size.value = "";
  }
  renderStoneFormOptions();
  updateStoneFormFromSelection();
}

function renderStoneFormOptions() {
  const form = document.getElementById("stone-form");
  const selectedType = form.stoneType.value;
  const selectedShape = form.shape.value;
  const selectedSize = form.size.value;
  setSelectOptions(form.stoneType, stoneOptionValues("stoneType", state.stones), "Select Type", selectedType);
  const shapeSource = form.stoneType.value
    ? state.stones.filter((stone) => stone.stoneType === form.stoneType.value)
    : state.stones;
  setSelectOptions(form.shape, stoneOptionValues("shape", shapeSource), "Select Shape", selectedShape);
  const sizeSource = shapeSource.filter((stone) => !form.shape.value || stone.shape === form.shape.value);
  setSelectOptions(form.size, stoneOptionValues("size", sizeSource), "Select Size", selectedSize);
}

function addStoneDropdownOption(field) {
  const labels = { stoneType: "Stone Type", shape: "Shape", size: "Size" };
  const value = prompt(`Enter new ${labels[field] || "option"}`);
  const cleanValue = String(value || "").trim();
  if (!cleanValue) return;
  state.stoneOptions[field] = state.stoneOptions[field] || [];
  if (!state.stoneOptions[field].some((item) => item.toLowerCase() === cleanValue.toLowerCase())) {
    state.stoneOptions[field].push(cleanValue);
  }
  const form = document.getElementById("stone-form");
  renderStoneFormOptions();
  form[field].value = cleanValue;
  if (field === "stoneType") {
    form.shape.value = "";
    form.size.value = "";
  }
  if (field === "shape") form.size.value = "";
  updateStoneFormFromSelection();
  saveState();
  renderStoneLookupOptions();
  renderStoneLookup();
}

function updateStoneFormFromSelection() {
  const form = document.getElementById("stone-form");
  const data = getFormData(form);
  form.code.value = stoneLookupCode(data);
  const match = state.stones.find((stone) =>
    stone.stoneType === data.stoneType &&
    stone.shape === data.shape &&
    stone.size === data.size
  );
  if (match && !form.stoneId.value) {
    form.weightPerPc.value = formatStoneWeight(match.weightPerPc) || "";
    form.pricePerPc.value = match.pricePerPc || "";
    form.remarks.value = match.remarks || "";
  }
}

function handleStoneLookupChange(event) {
  if (event.target.id === "stone-lookup-type") {
    document.getElementById("stone-lookup-shape").value = "";
    document.getElementById("stone-lookup-size").value = "";
  }
  if (event.target.id === "stone-lookup-shape") {
    document.getElementById("stone-lookup-size").value = "";
  }
  renderStoneLookupOptions();
  renderStoneLookup();
}

function renderStoneLookupOptions() {
  const typeSelect = document.getElementById("stone-lookup-type");
  const shapeSelect = document.getElementById("stone-lookup-shape");
  const sizeSelect = document.getElementById("stone-lookup-size");
  const typeValues = stoneOptionValues("stoneType", state.stones);
  const selectedType = typeSelect.value || (typeValues.includes("SW") ? "SW" : "");
  const selectedShape = shapeSelect.value;
  const selectedSize = sizeSelect.value;
  setSelectOptions(typeSelect, typeValues, "All Type", selectedType);
  const shapeSource = selectedType
    ? state.stones.filter((stone) => stone.stoneType === selectedType)
    : state.stones;
  setSelectOptions(shapeSelect, stoneOptionValues("shape", shapeSource), "All Shape", selectedShape);
  const sizeSource = shapeSource.filter((stone) => !shapeSelect.value || stone.shape === shapeSelect.value);
  setSelectOptions(sizeSelect, stoneOptionValues("size", sizeSource), "All Size", selectedSize);
}

function setSelectOptions(select, values, label, selected) {
  const optionValues = selected && !values.includes(selected) ? [...values, selected] : values;
  select.innerHTML = `<option value="">${label}</option>` + values
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("");
  if (optionValues.length !== values.length) {
    select.innerHTML = `<option value="">${label}</option>` + optionValues
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
      .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
      .join("");
  }
  select.value = optionValues.includes(selected) ? selected : "";
}

function uniqueStoneValues(field, stones) {
  return [...new Set(stones.map((stone) => String(stone[field] || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function stoneOptionValues(field, stones) {
  return [...new Set([...uniqueStoneValues(field, stones), ...(state.stoneOptions[field] || [])].map((item) => String(item || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function renderStoneLookup() {
  const type = document.getElementById("stone-lookup-type").value;
  const shape = document.getElementById("stone-lookup-shape").value;
  const size = document.getElementById("stone-lookup-size").value;
  const result = document.getElementById("stone-lookup-result");
  if (!type && !shape && !size) {
    result.classList.add("empty");
    result.textContent = "Select type, shape and size to show stone details.";
    return;
  }
  const matches = state.stones.filter((stone) =>
    (!type || stone.stoneType === type) &&
    (!shape || stone.shape === shape) &&
    (!size || stone.size === size)
  ).slice(0, 20);
  result.classList.toggle("empty", !matches.length);
  result.innerHTML = matches.length
    ? matches.map((stone) => `
      <article class="stone-lookup-card">
        <strong>${escapeHtml(stone.code || stoneLookupCode(stone))}</strong>
        <span><b>Type</b>${escapeHtml(stone.stoneType || "-")}</span>
        <span><b>Shape</b>${escapeHtml(stone.shape || "-")}</span>
        <span><b>Size</b>${escapeHtml(stone.size || "-")}</span>
        <span><b>Weight/Pc (g)</b>${escapeHtml(formatStoneWeight(stone.weightPerPc) || "-")}</span>
        <span><b>Price/Pc</b>${escapeHtml(stone.pricePerPc || "-")}</span>
        <button type="button" onclick="editStone('${stone.id}')">Edit</button>
      </article>
    `).join("")
    : "No stone found for this type, shape and size.";
}

function editStone(id) {
  const stone = findById("stones", id);
  if (!stone) return;
  switchStonePage("add");
  const form = document.getElementById("stone-form");
  form.stoneId.value = stone.id;
  renderStoneFormOptions();
  form.stoneType.value = stone.stoneType || "";
  renderStoneFormOptions();
  form.shape.value = stone.shape || "";
  renderStoneFormOptions();
  form.size.value = stone.size || "";
  form.code.value = stone.code || "";
  form.weightPerPc.value = formatStoneWeight(stone.weightPerPc) || "";
  form.pricePerPc.value = stone.pricePerPc || "";
  form.remarks.value = stone.remarks || "";
  document.getElementById("stone-form-title").textContent = "Edit Stone";
  document.getElementById("stone-submit").textContent = "Update Stone";
  document.getElementById("cancel-stone-edit").classList.remove("hidden");
}

function removeStone(id) {
  if (!confirm("Delete this stone from library?")) return;
  state.stones = state.stones.filter((stone) => stone.id !== id);
  saveState();
  render();
}

function resetStoneForm() {
  const form = document.getElementById("stone-form");
  form.reset();
  form.stoneId.value = "";
  renderStoneFormOptions();
  if ([...form.stoneType.options].some((option) => option.value === "SW")) {
    form.stoneType.value = "SW";
    renderStoneFormOptions();
  }
  form.code.value = "";
  document.getElementById("stone-form-title").textContent = "Add Stone";
  document.getElementById("stone-submit").textContent = "Save Stone";
  document.getElementById("cancel-stone-edit").classList.add("hidden");
}

function stoneLookupCode(stone) {
  return `${stone.stoneType || ""}${stone.shape || ""}${stone.size || ""}`.replace(/\s+/g, "").toUpperCase();
}

function formatStoneWeight(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const number = Number(text);
  if (!Number.isFinite(number)) return text;
  return number.toFixed(5);
}

function renderSelects() {
  const customerOptions = state.customers
    .map((customer) => `<option value="${customer.id}">${escapeHtml(customer.name)}</option>`)
    .join("");
  const designOptions = renderDesignOptions();
  const orderOptions = groupedJobOrders()
    .filter((job) => job.status === "Pending")
    .map((job) => {
      const details = `${job.jobNumber} - ${job.customer || "-"} - ${job.orders.length} item${job.orders.length > 1 ? "s" : ""} - ${job.categories}`;
      return `<option value="${escapeHtml(job.jobNumber)}">${escapeHtml(details)}</option>`;
    })
    .join("");
  const karigarOptions = state.karigars
    .map((karigar) => `<option value="${karigar.id}">${escapeHtml(karigar.name)} - ${escapeHtml(karigar.speciality)}</option>`)
    .join("");
  document.querySelectorAll('#production-form select[name="jobNumber"]').forEach((select) => {
    const selected = select.value;
    select.innerHTML = orderOptions ? `<option value="">Select job card</option>${orderOptions}` : '<option value="">No open job cards</option>';
    select.value = groupedJobOrders().some((job) => job.jobNumber === selected && job.status === "Pending") ? selected : "";
  });
  applyIssuePurityFromJob();
  updateIssueMetalSummary();
  document.querySelectorAll('select[name="karigarId"]').forEach((select) => {
    select.innerHTML = karigarOptions || '<option value="">Add a department first</option>';
  });
  document.querySelectorAll('select[name="meltingDepartmentId"]').forEach((select) => {
    select.innerHTML = `
      <option value="Casting Department">Casting Department</option>
      <option value="Melting Department">Melting Department</option>
    `;
  });
  document.querySelectorAll('select[name="customerId"]').forEach((select) => {
    select.innerHTML = customerOptions || '<option value="">Add a customer first</option>';
  });
  document.querySelectorAll('select[name="designId"]').forEach((select) => {
    const selected = select.value;
    select.innerHTML = designOptions;
    select.value = state.designs.some((design) => design.id === selected) ? selected : "";
  });
  document.querySelectorAll('select[name="stoneDesignCategory"]').forEach((select) => {
    const selected = select.value;
    select.innerHTML = renderCategoryOptions(selected);
    select.value = designCategoryGroups().some((group) => group.category === selected) ? selected : "";
  });
  updateStoneDesignOptions(document.querySelector('#stone-entry-form [name="stoneDesignId"]')?.value || "");
}

function updateStoneDesignOptions(selectedDesignId = "", keepCategory = false) {
  const form = document.getElementById("stone-entry-form");
  if (!form) return [];
  const selectedDesign = findById("designs", selectedDesignId);
  if (selectedDesign && !keepCategory) form.stoneDesignCategory.value = selectedDesign.category || "";
  const category = form.stoneDesignCategory.value;
  const query = String(form.stoneDesignSearch?.value || "").trim().toLowerCase();
  const sourceDesigns = query || !category
    ? sortedDesigns()
    : sortedDesigns().filter((design) => (design.category || "Uncategorised") === category);
  const designs = sourceDesigns.filter((design) => {
    if (category && query && (design.category || "Uncategorised") !== category) return false;
    if (!query) return category ? true : false;
    const haystack = [
      design.number,
      design.name,
      design.category,
      designText(design),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
  const placeholder = query
    ? `${designs.length} design match${designs.length === 1 ? "" : "es"}`
    : category ? "Select design" : "Type design name or select category";
  const dataList = document.getElementById("stone-design-search-list");
  if (dataList) {
    dataList.innerHTML = designs.slice(0, 50)
      .map((design) => `<option value="${escapeHtml(designText(design))}"></option>`)
      .join("");
  }
  form.stoneDesignId.innerHTML = `<option value="">${placeholder}</option>` + designs
    .map((design) => `<option value="${design.id}">${escapeHtml(designText(design))}</option>`)
    .join("");
  form.stoneDesignId.value = designs.some((design) => design.id === selectedDesignId) ? selectedDesignId : "";
  return designs;
}

async function loadStoneEntry(designId) {
  const form = document.getElementById("stone-entry-form");
  const summary = document.getElementById("stone-entry-summary");
  const preview = document.getElementById("stone-entry-preview");
  const design = findById("designs", designId);
  if (!design) {
    form.stoneChart.value = "";
    resetDesignStoneEntryFields();
    renderDesignStoneItems([]);
    summary.textContent = "Select design to view stone data.";
    preview.classList.add("empty");
    preview.textContent = "No stone chart selected.";
    return;
  }
  updateStoneDesignOptions(design.id);
  form.stoneDesignId.value = design.id;
  if (form.stoneDesignSearch) form.stoneDesignSearch.value = designText(design);
  form.stoneChart.value = "";
  renderDesignStoneEntryOptions();
  resetDesignStoneEntryFields();
  renderDesignStoneItems(design.stoneItems || []);
  summary.textContent = `${design.number || "Design"} / ${design.category || "Uncategorised"} / ${design.hasStoneChart ? "Stone chart available" : "No stone chart"}`;
  const imageData = design.hasStoneChart ? await getStoneChartImage(design.id).catch(() => "") : "";
  preview.classList.toggle("empty", !imageData);
  preview.innerHTML = imageData
    ? `<img src="${imageData}" alt="Stone chart for ${escapeHtml(designText(design))}">`
    : "No stone chart uploaded.";
}

function handleDesignStoneEntryChange(changedField) {
  const form = document.getElementById("stone-entry-form");
  if (changedField === "entryStoneType") {
    form.entryStoneShape.value = "";
    form.entryStoneSize.value = "";
  }
  if (changedField === "entryStoneShape") form.entryStoneSize.value = "";
  renderDesignStoneEntryOptions();
}

function renderDesignStoneEntryOptions() {
  const form = document.getElementById("stone-entry-form");
  const selectedType = form.entryStoneType.value;
  const selectedShape = form.entryStoneShape.value;
  const selectedSize = form.entryStoneSize.value;
  setSelectOptions(form.entryStoneType, stoneOptionValues("stoneType", state.stones), "Select Type", selectedType);
  const shapeSource = form.entryStoneType.value
    ? state.stones.filter((stone) => stone.stoneType === form.entryStoneType.value)
    : state.stones;
  setSelectOptions(form.entryStoneShape, stoneOptionValues("shape", shapeSource), "Select Shape", selectedShape);
  const sizeSource = shapeSource.filter((stone) => !form.entryStoneShape.value || stone.shape === form.entryStoneShape.value);
  setSelectOptions(form.entryStoneSize, stoneOptionValues("size", sizeSource), "Select Size", selectedSize);
}

function addDesignStoneItem() {
  const form = document.getElementById("stone-entry-form");
  const design = findById("designs", form.stoneDesignId.value);
  if (!design) {
    alert("Select design first.");
    return;
  }
  const pcs = Number(form.entryStonePcs.value || 0);
  if (!form.entryStoneType.value || !form.entryStoneShape.value || !form.entryStoneSize.value || pcs <= 0) {
    alert("Select stone type, shape, size and enter No. Pcs.");
    return;
  }
  const stone = findStoneByLibraryFields(form.entryStoneType.value, form.entryStoneShape.value, form.entryStoneSize.value);
  const weightPerPc = stone?.weightPerPc || "";
  const item = {
    id: crypto.randomUUID(),
    stoneType: form.entryStoneType.value,
    shape: form.entryStoneShape.value,
    size: form.entryStoneSize.value,
    code: stone?.code || stoneLookupCode({ stoneType: form.entryStoneType.value, shape: form.entryStoneShape.value, size: form.entryStoneSize.value }),
    pcs,
    weightPerPc: formatStoneWeight(weightPerPc),
    totalWeight: totalStoneWeight(weightPerPc, pcs),
  };
  design.stoneItems = [...(design.stoneItems || []), item];
  design.stoneDetails = designStoneDetailsText(design.stoneItems);
  renderDesignStoneItems(design.stoneItems);
  resetDesignStoneEntryFields();
  saveState();
  renderDesigns();
}

async function readStoneChartImage() {
  const form = document.getElementById("stone-entry-form");
  const design = findById("designs", form.stoneDesignId.value);
  const summary = document.getElementById("stone-entry-summary");
  if (!design) {
    alert("Select design first.");
    return;
  }
  if (!window.Tesseract) {
    alert("OCR library is not loaded. Connect internet and refresh once, then try again.");
    return;
  }
  let imageData = "";
  const file = form.stoneChart.files[0];
  if (file) {
    await showStoneChartQuality(file);
    imageData = await compressStoneChartImage(file);
    await saveStoneChartImage(design.id, imageData);
    design.hasStoneChart = true;
    form.stoneChart.value = "";
  } else {
    imageData = await getStoneChartImage(design.id).catch(() => "");
  }
  if (!imageData) {
    alert("Upload or save a stone chart image first.");
    return;
  }
  summary.textContent = "Reading stone chart image...";
  try {
    const result = await Tesseract.recognize(imageData, "eng", {
      logger: (progress) => {
        if (progress.status === "recognizing text") {
          summary.textContent = `Reading stone chart image... ${Math.round((progress.progress || 0) * 100)}%`;
        }
      },
    });
    const rows = parseStoneChartText(result.data.text);
    if (!rows.length) {
      summary.textContent = "Could not read stone rows. Crop the chart table and try again.";
      alert("No stone rows detected. Use a clear crop of the stone table.");
      return;
    }
    if ((design.stoneItems || []).length && !confirm("Replace existing stone rows for this design with OCR result?")) return;
    design.stoneItems = rows;
    design.stoneDetails = designStoneDetailsText(rows);
    saveState();
    renderDesignStoneItems(design.stoneItems);
    renderDesigns();
    await loadStoneEntry(design.id);
    summary.textContent = `${rows.length} stone row(s) read and saved from image.`;
  } catch (error) {
    console.error(error);
    summary.textContent = "OCR failed. Try a clearer cropped chart image.";
    alert("OCR failed. Try a clearer cropped chart image.");
  }
}

function removeDesignStoneItem(stoneItemId) {
  const form = document.getElementById("stone-entry-form");
  const design = findById("designs", form.stoneDesignId.value);
  if (!design) return;
  design.stoneItems = (design.stoneItems || []).filter((item) => item.id !== stoneItemId);
  design.stoneDetails = designStoneDetailsText(design.stoneItems);
  renderDesignStoneItems(design.stoneItems);
  saveState();
  renderDesigns();
}

function renderDesignStoneItems(items = []) {
  const container = document.getElementById("design-stone-details");
  container.classList.toggle("empty", !items.length);
  container.innerHTML = items.length
    ? `<div class="stone-total-summary">${designStoneSummaryText(items)}</div><table><thead><tr><th>Code</th><th>Type</th><th>Shape</th><th>Size</th><th>No. Pcs</th><th>Wt/Pc (g)</th><th>Total Wt (g)</th><th></th></tr></thead><tbody>${items.map((item) => `
      <tr>
        <td>${escapeHtml(item.code || "-")}</td>
        <td>${escapeHtml(item.stoneType || "-")}</td>
        <td>${escapeHtml(item.shape || "-")}</td>
        <td>${escapeHtml(item.size || "-")}</td>
        <td>${escapeHtml(item.pcs || "-")}</td>
        <td>${escapeHtml(formatStoneWeight(item.weightPerPc) || "-")}</td>
        <td>${escapeHtml(item.totalWeight || "-")}</td>
        <td><button class="delete-btn" type="button" onclick="removeDesignStoneItem('${item.id}')">Remove</button></td>
      </tr>
    `).join("")}</tbody></table>`
    : "No stone added for this design.";
}

function resetDesignStoneEntryFields() {
  const form = document.getElementById("stone-entry-form");
  form.entryStoneType.value = "";
  form.entryStoneShape.value = "";
  form.entryStoneSize.value = "";
  form.entryStonePcs.value = "";
  renderDesignStoneEntryOptions();
  if ([...form.entryStoneType.options].some((option) => option.value === "SW")) {
    form.entryStoneType.value = "SW";
    renderDesignStoneEntryOptions();
  }
}

function findStoneByLibraryFields(type, shape, size) {
  return state.stones.find((stone) => stone.stoneType === type && stone.shape === shape && stone.size === size);
}

function findStoneByOcrFields(type, shape, size) {
  const shapeValue = normalizeOcrShape(shape);
  const sizeValues = ocrSizeCandidates(size);
  return state.stones.find((stone) =>
    stone.stoneType === type &&
    normalizeOcrShape(stone.shape) === shapeValue &&
    sizeValues.includes(normalizeSizeText(stone.size))
  );
}

function parseStoneChartText(text) {
  const rows = [];
  let currentShape = "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/[|_]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  lines.forEach((line) => {
    const shape = detectOcrShape(line);
    if (shape) currentShape = shape;
    const rowMatch = line.match(/(\d+(?:[.,]\d+)?)\s*[xX×*]\s*(\d+(?:[.,]\d+)?)\s+(\d{1,4})(?:\s+(\d+(?:[.,]\d+)?))?/);
    if (!rowMatch || !currentShape) return;
    const left = cleanOcrNumber(rowMatch[1]);
    const right = cleanOcrNumber(rowMatch[2]);
    const pcs = Number(rowMatch[3]);
    const ocrTotalWeight = cleanOcrNumber(rowMatch[4] || "");
    if (!pcs) return;
    const rawSize = `${left}*${right}`;
    const libraryStone = findStoneByOcrFields("SW", currentShape, rawSize);
    const weightPerPc = libraryStone?.weightPerPc || (ocrTotalWeight ? formatStoneWeight(Number(ocrTotalWeight) / pcs) : "");
    rows.push({
      id: crypto.randomUUID(),
      stoneType: "SW",
      shape: libraryStone?.shape || normalizeOcrShape(currentShape),
      size: libraryStone?.size || normalizeDisplaySize(rawSize),
      code: libraryStone?.code || stoneLookupCode({ stoneType: "SW", shape: normalizeOcrShape(currentShape), size: normalizeDisplaySize(rawSize) }),
      pcs,
      weightPerPc: formatStoneWeight(weightPerPc),
      totalWeight: libraryStone ? totalStoneWeight(weightPerPc, pcs) : formatStoneWeight(ocrTotalWeight) || totalStoneWeight(weightPerPc, pcs),
    });
  });
  return rows;
}

function detectOcrShape(line) {
  const upper = line.toUpperCase();
  if (upper.includes("ROUND")) return "ROUND";
  if (upper.includes("PEAR")) return "PEAR";
  if (upper.includes("OCTO")) return "OCTO";
  if (upper.includes("EMERALD") || upper.includes("EMER")) return "OCTO";
  if (upper.includes("BAGUETTE") || upper.includes("BUGGET")) return "BUGGET";
  if (upper.includes("MARQUISE")) return "MARQUISE";
  if (upper.includes("OVAL")) return "OVAL";
  if (upper.includes("PRINCESS")) return "PRINCESS";
  return "";
}

function normalizeOcrShape(value = "") {
  const shape = detectOcrShape(value) || String(value || "").trim().toUpperCase();
  if (shape === "BAGUETTE") return "BUGGET";
  if (shape === "EMERALD") return "OCTO";
  return shape;
}

function cleanOcrNumber(value = "") {
  return String(value || "").replace(",", ".").replace(/[^\d.]/g, "");
}

function normalizeDisplaySize(value = "") {
  return normalizeSizeText(value).replace("*", " X ");
}

function normalizeSizeText(value = "") {
  return String(value || "")
    .replace(/[×xX]/g, "*")
    .split("*")
    .map((part) => {
      const num = Number(cleanOcrNumber(part));
      return Number.isFinite(num) ? String(Number(num.toFixed(2))) : part.trim();
    })
    .join("*");
}

function ocrSizeCandidates(value = "") {
  const normalized = normalizeSizeText(value);
  const parts = normalized.split("*");
  const candidates = new Set([normalized]);
  if (parts.length === 2) {
    candidates.add(`${parts[1]}*${parts[0]}`);
    if (parts[0] === parts[1]) candidates.add(parts[0]);
  }
  return [...candidates];
}

function totalStoneWeight(weightPerPc, pcs) {
  const total = Number(weightPerPc || 0) * Number(pcs || 0);
  return Number.isFinite(total) && total > 0 ? weight3(total) : "";
}

function designStoneDetailsText(items = []) {
  const details = items.map(stoneDetailLine).join("\n");
  return items.length ? `${designStoneSummaryText(items)}\n${details}` : "";
}

function stoneDetailLine(item) {
  const stoneName = [item.stoneType, item.shape, item.size]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ") || item.code || stoneLookupCode(item);
  const pcs = `${item.pcs || 0} PCS`;
  const weightPerPc = formatStoneWeight(item.weightPerPc) || "-";
  const totalWeight = item.totalWeight || "-";
  return `${stoneName.padEnd(18)} ${pcs.padEnd(8)} ${weightPerPc.padStart(9)} ${String(totalWeight).padStart(9)}`;
}

function designStoneTotals(items = []) {
  return items.reduce((total, item) => ({
    pcs: total.pcs + Number(item.pcs || 0),
    weight: total.weight + Number(item.totalWeight || 0),
  }), { pcs: 0, weight: 0 });
}

function designStoneSummaryText(items = []) {
  const totals = designStoneTotals(items);
  return `Total Stone: ${totals.pcs} pcs / ${weight3(totals.weight)} g`;
}

function renderDashboard() {
  document.getElementById("metric-raw").textContent = gram(rawGoldStock());
  document.getElementById("metric-wip").textContent = gram(workInProgress());
  document.getElementById("metric-production-stock").textContent = gram(finishedStock());
  document.getElementById("metric-office-stock").textContent = gram(officeStockWeight());
  document.getElementById("metric-orders").textContent = state.orders.filter((order) => order.status !== "Completed").length;
  document.getElementById("metric-customers").textContent = state.customers.length;

  const pendingOrders = state.orders.filter((order) => order.status !== "Completed");
  document.getElementById("pending-orders-list").innerHTML = pendingOrders.length
    ? pendingOrders.map((order) => stackItem(`${order.number} - ${order.item || order.designNumber || order.category || order.remarks || "-"}`, `Due ${order.dueDate}`)).join("")
    : '<div class="empty">No pending job orders.</div>';

  document.getElementById("activity-list").innerHTML = state.lots.length
    ? state.lots.slice(0, 6).map((lot) => stackItem(`${lot.number} - ${lot.karigarName}`, `${gram(lot.issuedWeight)} ${lot.status}`)).join("")
    : '<div class="empty">No production lots issued yet.</div>';

  renderDepartmentMetal();
}

function renderDepartmentMetal() {
  const departments = departmentMetalInHand();
  const rows = Object.entries(departments)
    .sort((a, b) => b[1].gross - a[1].gross)
    .map(([department, totals]) => `
      <article class="department-card">
        <span>${escapeHtml(department)}</span>
        <strong>${gram(totals.gold)}</strong>
        <div class="department-breakup">
          <small><b>GW</b>${gram(totals.gross)}</small>
          <small><b>Wax Stone</b>${gram(totals.waxStone)}</small>
          <small><b>Hand Stone</b>${gram(totals.handStone)}</small>
          <small><b>Total Stone</b>${gram(totals.waxStone + totals.handStone)}</small>
        </div>
        ${renderDepartmentPuritySplit(totals)}
        ${renderDepartmentSplit(totals)}
      </article>
    `)
    .join("");
  document.getElementById("department-metal-list").innerHTML = rows || '<div class="empty">No department gold or stone in hand yet.</div>';
}

function renderDepartmentPuritySplit(totals) {
  const purities = Object.entries(totals.purities || {}).filter(([, purity]) =>
    purity.gross !== 0 || purity.gold !== 0 || purity.waxStone !== 0 || purity.handStone !== 0
  );
  if (!purities.length) return "";
  return `
    <div class="department-purity-split">
      <div class="department-purity-head"><span>Purity</span><span>Gold</span><span>Stone</span><span>Fine</span></div>
      ${purities.map(([purity, item]) => `
        <div class="department-purity-row">
          <span>${escapeHtml(purity)}</span>
          <span>${gram(item.gold)}</span>
          <span>${gram(item.waxStone + item.handStone)}</span>
          <span>${gram(item.fineGold)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderDepartmentSplit(totals) {
  const sections = Object.entries(totals.sections || {}).filter(([, section]) =>
    section.gross !== 0 || section.gold !== 0 || section.waxStone !== 0 || section.handStone !== 0
  );
  if (sections.length <= 1) return "";
  return `
    <div class="department-split">
      ${sections.map(([label, section]) => `
        <small><b>${escapeHtml(label)}</b><span>Gold ${gram(section.gold)} / GW ${gram(section.gross)}</span></small>
      `).join("")}
    </div>
  `;
}

function departmentMetalInHand() {
  const departments = {};
  state.lots.forEach((lot) => {
    (lot.transfers || []).forEach((transfer) => {
      addDepartmentWeight(departments, transfer.balanceDepartment || transfer.fromDepartment || "Unassigned", {
        gold: Number(transfer.departmentBalance || 0),
        gross: Number(transfer.departmentBalance || 0),
        purity: transfer.differencePurity || lot.metalPurity || getLotOrders(lot)[0]?.purity || "",
      });
    });

    if (lot.status !== "Completed") {
      addDepartmentWeight(departments, lot.currentDepartment || lot.karigarName || "Unassigned", departmentCurrentLotTotals(lot));
    }
  });
  return Object.fromEntries(Object.entries(departments).filter(([, totals]) => totals.gross !== 0 || totals.gold !== 0 || totals.waxStone !== 0 || totals.handStone !== 0));
}

function departmentCurrentLotTotals(lot) {
  const grossBase = Number(currentTransferIssueWeight(lot) || 0);
  const waxStone = Number(transferWaxStoneWeight(lot) || 0);
  const existingHandStone = Number(currentHandStoneWeight(lot) || 0);
  const plannedHandStone = isSettingDepartment(lot.currentDepartment) || isSettingDepartment(lot.karigarName)
    ? productionStoneTotalsForOrders(getLotOrders(lot), "hand").weight
    : 0;
  const handStone = Math.max(existingHandStone, Number(plannedHandStone || 0));
  const gross = Number(weight3(Math.max(grossBase, Math.max(grossBase - existingHandStone, 0) + handStone)));
  const gold = Number(weight3(Math.max(gross - waxStone - handStone, 0)));
  return { gross, gold, waxStone, handStone, purity: lot.metalPurity || getLotOrders(lot)[0]?.purity || "" };
}

function addDepartmentWeight(departments, department, totals = {}) {
  const rawDepartment = department || "Unassigned";
  const key = departmentDashboardHeader(rawDepartment);
  const splitKey = departmentDashboardSplitLabel(rawDepartment);
  const current = departments[key] || { gross: 0, gold: 0, waxStone: 0, handStone: 0, fineGold: 0, sections: {}, purities: {} };
  const currentSection = current.sections[splitKey] || { gross: 0, gold: 0, waxStone: 0, handStone: 0 };
  const purityKey = displayPurity(totals.purity);
  const currentPurity = current.purities[purityKey] || { gross: 0, gold: 0, waxStone: 0, handStone: 0, fineGold: 0 };
  const added = {
    gross: Number(totals.gross || 0),
    gold: Number(totals.gold || 0),
    waxStone: Number(totals.waxStone || 0),
    handStone: Number(totals.handStone || 0),
    fineGold: Number(totals.fineGold ?? fineGoldWeight(totals.gold || 0, totals.purity || 0)),
  };
  departments[key] = {
    gross: Number(weight3(current.gross + added.gross)),
    gold: Number(weight3(current.gold + added.gold)),
    waxStone: Number(weight3(current.waxStone + added.waxStone)),
    handStone: Number(weight3(current.handStone + added.handStone)),
    fineGold: Number(weight3(current.fineGold + added.fineGold)),
    sections: {
      ...current.sections,
      [splitKey]: {
        gross: Number(weight3(currentSection.gross + added.gross)),
        gold: Number(weight3(currentSection.gold + added.gold)),
        waxStone: Number(weight3(currentSection.waxStone + added.waxStone)),
        handStone: Number(weight3(currentSection.handStone + added.handStone)),
      },
    },
    purities: {
      ...current.purities,
      [purityKey]: {
        gross: Number(weight3(currentPurity.gross + added.gross)),
        gold: Number(weight3(currentPurity.gold + added.gold)),
        waxStone: Number(weight3(currentPurity.waxStone + added.waxStone)),
        handStone: Number(weight3(currentPurity.handStone + added.handStone)),
        fineGold: Number(weight3(currentPurity.fineGold + added.fineGold)),
      },
    },
  };
}

function renderOrders() {
  const activeRows = groupedJobOrders()
    .filter((job) => job.status !== "Completed")
    .map(orderTableRow)
    .join("");
  const completedRows = groupedJobOrders()
    .filter((job) => job.status === "Completed")
    .map(orderTableRow)
    .join("");
  document.getElementById("orders-table").innerHTML = activeRows || tableEmpty(3, "No active job orders recorded.");
  document.getElementById("completed-orders-table").innerHTML = completedRows || tableEmpty(3, "No completed job orders recorded.");
}

function orderTableRow(job) {
  const urgency = job.urgent ? '<span class="job-badge urgent">Urgent</span>' : "";
  const delivery = deliveryBadgeHtml(job.dueDate);
  return `
    <tr>
      <td>${escapeHtml(job.customer)}</td>
      <td>
        <div class="job-order-summary-line">
          <strong>${escapeHtml(jobDetailsText(job))}</strong>
          <div class="job-badge-row">
            ${urgency}
            <span class="job-badge stage">${escapeHtml(job.currentStage)}</span>
            ${delivery}
          </div>
        </div>
      </td>
      <td><div class="row-actions"><button onclick="openJobOrder('${job.jobNumber}')">Open</button><button class="ghost-button" onclick="editJobOrder('${job.jobNumber}')">Edit</button><button class="delete-btn" onclick="removeJobOrder('${job.jobNumber}')">Delete</button></div></td>
    </tr>
  `;
}

function jobDetailsText(job) {
  return `${job.jobNumber} / ${job.orders.length} item${job.orders.length > 1 ? "s" : ""} / ${job.categories} / Due ${job.dueDate} / ${job.status}`;
}

function groupedJobOrders() {
  const groups = state.orders.reduce((acc, order) => {
    const key = order.jobNumber || order.productionNo || order.number;
    if (!acc[key]) acc[key] = [];
    acc[key].push(order);
    return acc;
  }, {});
  return Object.entries(groups).map(([jobNumber, orders]) => {
    const first = orders[0];
    const categories = [...new Set(orders.map((order) => order.category || "-"))].join(", ");
    const statuses = [...new Set(orders.map((order) => order.status))];
    return {
      jobNumber,
      orders,
      customer: first.customer,
      categories,
      dueDate: first.dueDate,
      urgent: orders.some((order) => order.urgent),
      currentStage: jobCurrentStage(orders),
      status: statuses.length === 1 ? statuses[0] : "Mixed",
    };
  }).sort((a, b) => a.jobNumber.localeCompare(b.jobNumber));
}

function deliveryBadgeHtml(dueDate) {
  const days = daysRemaining(dueDate);
  if (days === null) return '<span class="job-badge neutral">No Due Date</span>';
  if (days < 0) return `<span class="job-badge overdue">${Math.abs(days)} day overdue</span>`;
  if (days === 0) return '<span class="job-badge due-today">Due today</span>';
  return `<span class="job-badge days">${days} day${days === 1 ? "" : "s"} left</span>`;
}

function daysRemaining(dueDate) {
  if (!dueDate) return null;
  const todayDate = new Date(`${isoToday()}T00:00:00`);
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  return Math.ceil((due - todayDate) / 86400000);
}

function daysRemainingText(dueDate) {
  const days = daysRemaining(dueDate);
  if (days === null) return "No due date";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}

function jobCurrentStage(orders = []) {
  const stages = [...new Set(orders.map(orderCurrentStage).filter(Boolean))];
  if (!stages.length) return "Pending";
  return stages.length === 1 ? stages[0] : `Mixed: ${stages.join(", ")}`;
}

function orderCurrentStage(order = {}) {
  const officeEntry = officeItems().find(({ item }) => item.orderId === order.id || item.productionNo === order.productionNo);
  if (officeEntry) return officeItemLocation(officeEntry.item);
  const lot = state.lots.find((item) => getLotOrderIds(item).includes(order.id));
  if (lot?.bill) return lot.billingStage || "Bill / QC";
  if (lot) return lot.currentDepartment || lot.karigarName || "Production";
  return order.status || "Pending";
}

function openJobOrder(jobNumber) {
  const first = state.orders.find((order) => (order.jobNumber || order.productionNo || order.number) === jobNumber);
  if (first) openOrderDetail(first.id);
}

function editJobOrder(jobNumber) {
  const first = state.orders.find((order) => (order.jobNumber || order.productionNo || order.number) === jobNumber);
  if (first) openOrderDetail(first.id, true);
}

function removeJobOrder(jobNumber) {
  if (!confirm(`Delete full job card ${jobNumber}?`)) return;
  state.orders = state.orders.filter((order) => (order.jobNumber || order.productionNo || order.number) !== jobNumber);
  saveState();
  render();
}

function renderDesigns() {
  const query = document.getElementById("design-search").value.trim().toLowerCase();
  const searchResults = document.getElementById("design-search-results");
  if (query) {
    const matches = sortedDesigns().filter((design) =>
      `${design.number} ${design.name} ${design.category}`.toLowerCase().includes(query)
    );
    searchResults.classList.remove("hidden");
    searchResults.innerHTML = matches.length
      ? matches.map(renderDesignCard).join("")
      : '<div class="empty">No matching designs found.</div>';
    document.getElementById("designs-table").innerHTML = "";
    loadDesignThumbnails();
    return;
  }
  searchResults.classList.add("hidden");
  searchResults.innerHTML = "";
  const rows = designCategoryGroups().map((group) => {
    const categoryKey = encodeURIComponent(group.category);
    return `
    <tr>
      <td>${escapeHtml(group.category)}</td>
      <td>${group.designs.length}</td>
      <td><div class="row-actions"><button onclick="openDesignCategory('${categoryKey}')">Open</button></div></td>
    </tr>
  `;
  }).join("");
  document.getElementById("designs-table").innerHTML = rows || tableEmpty(3, "No designs uploaded yet.");
}

function renderDesignCard(design) {
  const stoneSummary = design.stoneItems?.length ? ` / ${designStoneSummaryText(design.stoneItems)}` : design.stoneDetails ? " / Stone details added" : "";
  return `
    <article class="design-category-item">
      <img class="design-thumb" data-design-image="${design.id}" alt="${escapeHtml(design.name)}">
      <strong>${escapeHtml(designText(design))}</strong>
      <span>${escapeHtml(design.category || "Uncategorised")}</span>
      <span class="dialog-note">${design.hasStoneChart ? "Stone chart added" : "No stone chart"}${escapeHtml(stoneSummary)}</span>
      <div class="row-actions">
        <button class="ghost-button" onclick="openDesignImage('${design.id}')">View</button>
        ${design.hasStoneChart ? `<button class="ghost-button" onclick="openStoneChart('${design.id}')">Stone Chart</button>` : ""}
        <button onclick="editDesign('${design.id}')">Edit</button>
        <button class="delete-btn" onclick="removeItem('designs', '${design.id}')">Delete</button>
      </div>
    </article>
  `;
}

function designCategoryGroups() {
  const groups = sortedDesigns().reduce((acc, design) => {
    const category = design.category || "Uncategorised";
    if (!acc[category]) acc[category] = [];
    acc[category].push(design);
    return acc;
  }, {});
  return Object.entries(groups).map(([category, designs]) => ({ category, designs }));
}

function openDesignCategory(categoryKey) {
  const category = decodeURIComponent(categoryKey);
  const group = designCategoryGroups().find((item) => item.category === category);
  if (!group) return;
  document.getElementById("design-category-title").textContent = category;
  document.getElementById("design-category-summary").textContent = `${group.designs.length} design${group.designs.length > 1 ? "s" : ""}`;
  document.getElementById("design-category-list").innerHTML = group.designs.map((design) =>
    renderDesignCard(design).replace(`editDesign('${design.id}')`, `editDesign('${design.id}'); document.getElementById('design-category-dialog').close()`)
  ).join("");
  document.getElementById("design-category-dialog").showModal();
  loadDesignThumbnails();
}

async function openDesignImage(designId) {
  const design = findById("designs", designId);
  if (!design) return;
  const imageData = await getDesignImage(design.id).catch(() => "");
  const image = document.getElementById("design-image-full");
  image.src = imageData || design.imageData || "";
  document.getElementById("design-image-title").textContent = design.number || "Design Image";
  document.getElementById("design-image-summary").textContent = design.name || "";
  document.getElementById("design-image-dialog").showModal();
}

async function openStoneChart(designId) {
  const design = findById("designs", designId);
  if (!design) return;
  const imageData = await getStoneChartImage(design.id).catch(() => "");
  if (!imageData) {
    alert("No stone chart uploaded for this design.");
    return;
  }
  const image = document.getElementById("design-image-full");
  image.src = imageData;
  document.getElementById("design-image-title").textContent = `Stone Chart - ${design.number || "Design"}`;
  document.getElementById("design-image-summary").textContent = design.name || "";
  document.getElementById("design-image-dialog").showModal();
}

function renderCustomers() {
  const query = document.getElementById("customer-search").value.toLowerCase();
  const rows = state.customers
    .filter((customer) => `${customer.name} ${customer.phone} ${customer.city} ${customer.gst} ${customer.address}`.toLowerCase().includes(query))
    .map((customer) => `
      <tr>
        <td>${escapeHtml(customer.name)}</td>
        <td>${escapeHtml(customer.phone || "-")}</td>
        <td>${escapeHtml(customer.city || "-")}</td>
        <td>${escapeHtml(customer.gst || "-")}</td>
        <td>${escapeHtml(customer.address || "-")}</td>
        <td><div class="row-actions"><button onclick="editCustomer('${customer.id}')">Edit</button><button class="delete-btn" onclick="removeItem('customers', '${customer.id}')">Delete</button></div></td>
      </tr>
    `)
    .join("");
  document.getElementById("customers-table").innerHTML = rows || tableEmpty(6, "No customers recorded.");
}

function editDesign(id) {
  const design = findById("designs", id);
  if (!design) return;
  switchDesignPage("add");
  const form = document.getElementById("design-form");
  form.designId.value = design.id;
  form.number.value = design.number;
  form.name.value = design.name;
  form.category.value = design.category || "";
  form.image.value = "";
  form.stoneChart.value = "";
  document.getElementById("design-form-title").textContent = "Edit Design / Add Stone Chart";
  document.getElementById("design-submit").textContent = "Update Design";
  document.getElementById("design-upload-status").textContent = design.hasStoneChart
    ? "Stone chart already added. Upload a new stone chart to replace it."
    : "Upload a stone chart here to add stone details to this design.";
  document.getElementById("cancel-design-edit").classList.remove("hidden");
}

function resetDesignForm() {
  const form = document.getElementById("design-form");
  form.reset();
  form.designId.value = "";
  document.getElementById("design-form-title").textContent = "Add Design";
  document.getElementById("design-submit").textContent = "Upload Design(s)";
  document.getElementById("design-upload-status").textContent = "You can upload up to 500 images at one time.";
  document.getElementById("cancel-design-edit").classList.add("hidden");
}

function editCustomer(id) {
  const customer = findById("customers", id);
  if (!customer) return;
  const form = document.getElementById("customer-form");
  form.customerId.value = customer.id;
  form.name.value = customer.name;
  form.phone.value = customer.phone || "";
  form.city.value = customer.city || "";
  form.gst.value = customer.gst || "";
  form.address.value = customer.address || "";
  document.getElementById("customer-form-title").textContent = "Edit Customer";
  document.getElementById("customer-submit").textContent = "Update Customer";
  document.getElementById("cancel-customer-edit").classList.remove("hidden");
}

function resetCustomerForm() {
  const form = document.getElementById("customer-form");
  form.reset();
  form.customerId.value = "";
  document.getElementById("customer-form-title").textContent = "Add Customer";
  document.getElementById("customer-submit").textContent = "Save Customer";
  document.getElementById("cancel-customer-edit").classList.add("hidden");
}

function updateCustomerReferences(customer) {
  state.orders.forEach((order) => {
    if (order.customerId === customer.id) {
      order.customer = customer.name;
    }
  });
}

function updateDesignReferences(design) {
  state.orders.forEach((order) => {
    if (order.designId === design.id) {
      order.designNumber = designLabel(design.id);
      order.category = design.category || order.category || "";
    }
  });
}

function applyDesignToForm(form, designId) {
  const design = findById("designs", designId);
  if (!form || !design) return;
  if (form.item) form.item.value = design.name;
  if (form.category) form.category.value = design.category || "";
  if (form.source && designLabel(design.id)) form.source.value = `Design ${designLabel(design.id)}`;
}

function designLabel(designId) {
  const design = findById("designs", designId);
  return design ? designText(design) : "";
}

function designText(design) {
  const number = String(design.number || "").trim();
  const name = String(design.name || "").trim();
  if (!name || name.toLowerCase() === number.toLowerCase()) return number;
  return `${number} - ${name}`;
}

function uniqueDesigns(designs) {
  const seen = new Set();
  return designs.filter((design) => {
    const key = String(design.number || design.name || design.id).trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openDesignImageDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("khushali-design-images", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("images");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDesignImage(id, imageData) {
  if (!supabaseClient || !currentUser || !cloudStateReady) {
    throw new Error("Sign in and wait for cloud sync before uploading images.");
  }
  const blob = dataUrlToBlob(imageData);
  const { error } = await supabaseClient.storage
    .from("design-images")
    .upload(`${id}.jpg`, blob, { contentType: blob.type || "image/jpeg", upsert: true });
  if (error) throw new Error(`Cloud image upload failed: ${error.message || "storage permission error"}`);
  try {
    await cacheDesignImageLocally(id, imageData);
  } catch (cacheError) {
    console.warn("The image is in cloud storage, but this browser could not cache it.", cacheError);
  }
}

async function cacheDesignImageLocally(id, imageData) {
  const db = await openDesignImageDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("images", "readwrite");
    transaction.objectStore("images").put(imageData, id);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function stoneChartKey(id) {
  return `stone-chart-${id}`;
}

async function saveStoneChartImage(id, imageData) {
  return saveDesignImage(stoneChartKey(id), imageData);
}

async function getStoneChartImage(id) {
  return getDesignImage(stoneChartKey(id));
}

async function deleteStoneChartImage(id) {
  return deleteDesignImage(stoneChartKey(id));
}

async function getDesignImage(id) {
  if (supabaseClient && currentUser) {
    const { data, error } = await supabaseClient.storage
      .from("design-images")
      .download(`${id}.jpg`);
    if (!error && data) return blobToDataUrl(data);
  }
  let localImage = "";
  try {
    const db = await openDesignImageDb();
    localImage = await new Promise((resolve, reject) => {
    const transaction = db.transaction("images", "readonly");
    const request = transaction.objectStore("images").get(id);
    request.onsuccess = () => resolve(request.result || "");
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    });
  } catch (cacheError) {
    console.warn("This browser could not read its image cache.", cacheError);
  }
  if (localImage && currentUser && cloudStateReady) {
    saveDesignImage(id, localImage).catch((uploadError) => {
      console.warn("A browser-only image could not yet be repaired in cloud storage.", uploadError);
    });
  }
  return localImage;
}

async function deleteDesignImage(id) {
  if (!supabaseClient || !currentUser || !cloudStateReady) {
    throw new Error("Sign in and wait for cloud sync before deleting images.");
  }
  const { error } = await supabaseClient.storage.from("design-images").remove([`${id}.jpg`]);
  if (error) throw new Error(`Cloud image delete failed: ${error.message || "storage permission error"}`);
  try {
    const db = await openDesignImageDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("images", "readwrite");
      transaction.objectStore("images").delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch (cacheError) {
    console.warn("Cloud image was deleted, but the browser cache could not be cleared.", cacheError);
  }
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function loadDesignThumbnails() {
  const images = [...document.querySelectorAll("[data-design-image]")];
  for (const image of images) {
    const design = findById("designs", image.dataset.designImage);
    try {
      const imageData = await getDesignImage(image.dataset.designImage);
      image.src = imageData || design?.imageData || "";
    } catch (error) {
      image.src = design?.imageData || "";
    }
  }
}

async function migrateLegacyDesignImages() {
  const legacyDesigns = state.designs.filter((design) => design.imageData);
  if (!legacyDesigns.length) return;
  for (const design of legacyDesigns) {
    await saveDesignImage(design.id, design.imageData);
    delete design.imageData;
  }
  saveState();
  render();
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 900;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      image.onerror = () => resolve(reader.result);
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressStoneChartImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 1800;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      };
      image.onerror = () => resolve(reader.result);
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function imageInfo(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve({ width: image.width, height: image.height, size: file.size });
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function showStoneChartQuality(file) {
  const note = document.getElementById("stone-chart-quality");
  if (!note) return;
  try {
    const info = await imageInfo(file);
    const shortest = Math.min(info.width, info.height);
    const longest = Math.max(info.width, info.height);
    let status = "good";
    let message = `Good for OCR: ${info.width} x ${info.height}px. Keep chart cropped and straight.`;
    if (longest < 900 || shortest < 450) {
      status = "bad";
      message = `Low quality for OCR: ${info.width} x ${info.height}px. Use clearer crop, minimum 900px wide, best 1200px+.`;
    } else if (longest < 1200 || shortest < 600) {
      status = "warn";
      message = `Usable but improve if possible: ${info.width} x ${info.height}px. Best OCR needs 1200px+ and sharp text.`;
    }
    note.className = `dialog-note ocr-quality-note ${status}`;
    note.textContent = message;
  } catch (error) {
    note.className = "dialog-note ocr-quality-note warn";
    note.textContent = "Could not check image quality. Use clear cropped chart, minimum 900px wide.";
  }
}

function designNameFromFile(fileName = "") {
  return fileName.replace(/\.[^/.]+$/, "").trim();
}

function renderProduction() {
  const rows = state.lots.map((lot) => `
    <tr>
      <td>${lot.number}</td>
      <td>${escapeHtml(lot.orderNumber)}</td>
      <td>${escapeHtml(lot.karigarName)}<br><small>${escapeHtml(lot.currentDepartment || "-")}</small></td>
      <td>${escapeHtml(lot.metalPurity || getLotOrders(lot)[0]?.purity || "-")}</td>
      <td>${issueWeightDetailHtml(lot)}</td>
      <td>${lot.finishedWeight ? gram(lot.finishedWeight) : "-"}</td>
      <td>${wastageDetailHtml(lot)}</td>
      <td><span class="status ${statusClass(lot.status)}">${lot.status}</span></td>
      <td>${renderTransferHistory(lot)}</td>
      <td><div class="row-actions">${lot.status === "Completed" ? "" : `<button onclick="openTransferLot('${lot.id}')">Transfer</button><button onclick="openCompleteLot('${lot.id}')">Complete</button>`}<button class="ghost-button" onclick="openLotHistory('${lot.id}')">History</button></div></td>
    </tr>
  `).join("");
  document.getElementById("production-table").innerHTML = rows || tableEmpty(10, "No production lots recorded.");
}

function issueWeightDetailHtml(lot) {
  const waxStoneWeight = Number(lot.waxStoneWeight || 0);
  if (!waxStoneWeight) return gram(lot.issuedWeight);
  return `${gram(lot.issuedWeight)}<br><small>Gold Issue ${gram(lot.grossIssuedWeight || lot.issuedWeight + waxStoneWeight)} - Wax Stone ${gram(waxStoneWeight)} = Net Wt ${gram(lot.issuedWeight)}</small>`;
}

function renderBills() {
  const query = (document.getElementById("bill-search")?.value || "").toLowerCase();
  const rows = state.lots
    .filter((lot) => lot.status === "Completed" || lot.bill || state.bills?.some((item) => item.lotId === lot.id))
    .filter((lot) => {
      const orders = getLotOrders(lot);
      const text = `${lot.number} ${lot.orderNumber} ${orders.map((order) => order.customer).join(" ")} ${lot.bill?.billNo || ""}`.toLowerCase();
      return text.includes(query);
    })
    .map((lot) => {
      const orders = getLotOrders(lot);
      const customer = orders[0]?.customer || "-";
      const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
      const mfgAmount = bill ? gram(Number(bill.manufacturingMakingGold || bill.makingGold || 0)) : "-";
      const officeAmount = bill ? gram(Number(bill.officeMakingGold || bill.billAmount || 0)) : "-";
      const billWeight = bill?.netWeight ? `<br><small>Net ${gram(bill.netWeight)}</small>` : "";
      return `
        <tr>
          <td>${escapeHtml(lot.number)}</td>
          <td>${escapeHtml(lot.orderNumber || "-")}</td>
          <td>${escapeHtml(customer)}</td>
          <td>${gram(lot.finishedWeight)}</td>
          <td>${wastageDetailHtml(lot)}</td>
          <td>${escapeHtml(bill?.billNo || "-")}</td>
          <td>${mfgAmount}${billWeight}</td>
          <td>${officeAmount}</td>
          <td><span class="status ${bill ? "completed" : "pending"}">${bill ? escapeHtml(lot.billingStage || "Sales Office QC") : "Pending Bill"}</span></td>
          <td><button type="button" onclick="openBill('${lot.id}')">${bill ? "View / Edit Bill" : "Make Bill"}</button></td>
        </tr>
      `;
    })
    .join("");
  document.getElementById("bill-table").innerHTML = rows || tableEmpty(10, "No completed job cards available for billing.");
}

function renderOffice() {
  const query = (document.getElementById("office-search")?.value || "").toLowerCase();
  const items = officeItems();
  renderOfficeStockLibraries(items);
  const filteredItems = items.filter((entry) => {
      const text = [
        entry.lot.number,
        entry.lot.orderNumber,
        entry.order.customer,
        entry.order.designNo,
        entry.order.productionNo,
        entry.item.productionNo,
        entry.bill.billNo,
        entry.item.huid1,
        entry.item.huid2,
        entry.item.salesTeam,
        entry.item.soldCustomer,
        officeItemLocation(entry.item),
        officeItemStatus(entry.item),
      ].join(" ").toLowerCase();
      return text.includes(query);
    });
  renderOfficeItemTiles(filteredItems);
  const rows = filteredItems
    .map(({ lot, bill, item, order }) => {
      const key = officeItemKey(lot.id, item);
      return `
      <tr>
        <td><input class="office-item-check" type="checkbox" value="${escapeHtml(key)}" aria-label="Select ${escapeHtml(item.productionNo || order.productionNo || "item")}"></td>
        <td>${escapeHtml(lot.orderNumber || lot.number || "-")}<br><small>${escapeHtml(lot.number || "-")}</small></td>
        <td>${escapeHtml(item.productionNo || order.productionNo || "-")}</td>
        <td>${escapeHtml(order.customer || "-")}</td>
        <td>${escapeHtml(order.designNo || designLabel(order.designId) || "-")}</td>
        <td>${gram(item.finalGw)}</td>
        <td>${gram(item.netWeight)}</td>
        <td>${gram(item.manufacturingMakingGold || item.makingGold)}</td>
        <td>${gram(item.officeMakingGold)}</td>
        <td>${escapeHtml(bill.billNo || "-")}</td>
        <td>${escapeHtml(officeHuidText(item))}</td>
        <td>${escapeHtml(officeItemLocation(item))}</td>
        <td><span class="status ${officeItemStatusClass(item)}">${escapeHtml(officeItemStatus(item))}</span><br><small>${escapeHtml(officeItemDate(item))}</small></td>
        <td><button type="button" class="ghost-button office-view-button" data-office-view-key="${escapeHtml(key)}">View</button></td>
      </tr>
    `;
    })
    .join("");
  document.getElementById("office-table").innerHTML = rows || tableEmpty(14, "No QC OK items received in Office.");
  const selectAll = document.getElementById("office-select-all");
  if (selectAll) selectAll.checked = false;
}

function openOfficeDialogPage(page) {
  if (isSalesUser() && page !== "sales") page = "sales";
  renderOffice();
  const dialog = document.getElementById("office-details-dialog");
  const title = document.querySelector("#office-details-dialog h2");
  const note = document.querySelector("#office-details-dialog .dialog-note");
  const actions = document.getElementById("office-dialog-actions");
  const content = document.getElementById("office-dialog-content");
  const detailsPanel = document.querySelector("#office-details-dialog .table-panel");
  const config = officeDialogConfig(page);
  if (dialog) dialog.dataset.page = page;
  if (title) title.textContent = config.title;
  if (note) note.textContent = config.note;
  if (actions) actions.innerHTML = `${officeAccessNote()}${config.actions}`;
  if (content) content.innerHTML = config.content;
  if (detailsPanel) detailsPanel.classList.toggle("hidden", page !== "all");
  if (!dialog.open) dialog.showModal();
}

function officeAccessNote() {
  if (isOwner()) return '<span class="access-note edit">Owner: Full Office Access</span>';
  if (canEditOfficeWeights()) return '<span class="access-note edit">Edit Access</span>';
  if (isSalesUser()) return `<span class="access-note readonly">${escapeHtml(currentSalesTeam())}: Own Holding Only</span>`;
  return '<span class="access-note readonly">View Only</span>';
}

function officeDialogConfig(page) {
  const items = officeItems();
  const groups = {
    "non-hallmarked": items.filter((entry) => officeDepartment(entry.item) === "non-hallmarked"),
    hallmarked: items.filter((entry) => officeDepartment(entry.item) === "hallmarked"),
    hallmarking: items.filter((entry) => officeDepartment(entry.item) === "hallmarking"),
    sales: items.filter((entry) => officeDepartment(entry.item) === "sales"),
    sold: items.filter((entry) => officeDepartment(entry.item) === "sold"),
  };
  if (page === "non-hallmarked") {
    return {
      title: "Non Hallmarked Item",
      note: "Select item and transfer to Hallmarking.",
      actions: '<button type="button" id="office-issue-hallmark">Transfer To Hallmarking</button>',
      content: renderOfficeLibraryItems(groups["non-hallmarked"], "No non hallmarked stock."),
    };
  }
  if (page === "hallmarking") {
    return {
      title: "Hallmarking Dept",
      note: "Enter HUID, then receive item to Hallmarked Item.",
      actions: '<button type="button" id="office-receive-hallmark" class="ghost-button">Receive To Hallmarked Item</button>',
      content: renderOfficeLibraryItems(groups.hallmarking, "No item issued to Hallmarking."),
    };
  }
  if (page === "hallmarked") {
    return {
      title: "Hallmarked Item",
      note: "Select item and transfer to Sales Team.",
      actions: `
        <select id="office-sales-team">
          <option value="">Select sales team</option>
          <option>Sales Team 1</option>
          <option>Sales Team 2</option>
          <option>Sales Team 3</option>
          <option>Sales Team 4</option>
          <option>Sales Team 5</option>
        </select>
        <button type="button" id="office-issue-sales" class="ghost-button">Transfer To Sales Team</button>
      `,
      content: renderOfficeLibraryItems(groups.hallmarked, "No hallmarked stock."),
    };
  }
  if (page === "sales") {
    const salesEntries = isSalesUser() ? groups.sales.filter(({ item }) => item.salesTeam === currentSalesTeam()) : groups.sales;
    return {
      title: "Sales Team Holding",
      note: isSalesUser() ? `Showing only ${currentSalesTeam()} holding.` : "Open a team tile to view individual item holding.",
      actions: isSalesUser() ? "" : '<button type="button" id="office-mark-sold" class="ghost-button">Mark Sold</button>',
      content: `<div id="office-sales-team-tiles" class="tile-grid office-sales-team-grid">${salesTeamTilesHtml(salesEntries)}</div><div id="office-sales-library"><div class="empty">Open a sales team tile to view holding.</div></div>`,
    };
  }
  if (page === "office-customers") {
    return {
      title: "Office Customers",
      note: "Separate customer list for office and sales. These customers are not mixed with manufacturing job-order customers.",
      actions: "",
      content: renderOfficeCustomersPage(),
    };
  }
  if (page === "sold") {
    return {
      title: "Sold Item",
      note: "Items already marked sold.",
      actions: "",
      content: renderOfficeLibraryItems(groups.sold, "No sold item."),
    };
  }
  return {
    title: "All Office Details",
    note: "Search and full movement view for office stock.",
    actions: "",
    content: "",
  };
}

function renderOfficeItemTiles(entries) {
  const board = document.getElementById("office-tile-board");
  if (!board) return;
  board.innerHTML = entries.length ? entries.map(renderOfficeItemTile).join("") : '<div class="empty">No matching office item.</div>';
}

function renderOfficeItemTile({ lot, bill, item, order }) {
  const key = officeItemKey(lot.id, item);
  const huidText = [item.huid1, item.huid2].filter(Boolean).join(" / ") || "No HUID";
  return `
    <article class="office-item-tile ${isHallmarkedItem(item) ? "hallmarked" : "non-hallmarked"}">
      <label class="office-tile-select">
        <input class="office-item-check" type="checkbox" value="${escapeHtml(key)}">
        <span>${isHallmarkedItem(item) ? "Hallmarked" : "Non Hallmarked"}</span>
      </label>
      <strong>${escapeHtml(item.productionNo || order.productionNo || "-")}</strong>
      <span>${escapeHtml(order.customer || "-")}</span>
      <span>${escapeHtml(order.designNo || designLabel(order.designId) || "-")}</span>
      <div class="office-tile-metrics">
        <b>Net ${gram(item.netWeight)}</b>
        <b>Mfg ${gram(item.manufacturingMakingGold || item.makingGold)}</b>
        <b>Office ${gram(item.officeMakingGold)}</b>
      </div>
      <div class="office-tile-huid">
        ${officeHuidHtml(lot, item, order)}
        <small>${escapeHtml(huidText)}</small>
      </div>
      <div class="office-tile-footer">
        <span>${escapeHtml(officeItemLocation(item))}</span>
        <span class="status ${officeItemStatusClass(item)}">${escapeHtml(officeItemStatus(item))}</span>
      </div>
      <small>${escapeHtml(lot.orderNumber || "-")} / ${escapeHtml(bill.billNo || "-")}</small>
    </article>
  `;
}

function renderOfficeStockLibraries(items = officeItems()) {
  const nonHallmarked = items.filter((entry) => officeDepartment(entry.item) === "non-hallmarked");
  const hallmarked = items.filter((entry) => officeDepartment(entry.item) === "hallmarked");
  const hallmarking = items.filter((entry) => officeDepartment(entry.item) === "hallmarking");
  const sales = items.filter((entry) => officeDepartment(entry.item) === "sales");
  const sold = items.filter((entry) => officeDepartment(entry.item) === "sold");
  const nonContainer = document.getElementById("office-non-hallmarked-library");
  const hallmarkedContainer = document.getElementById("office-hallmarked-library");
  const hallmarkingContainer = document.getElementById("office-hallmarking-library");
  const salesContainer = document.getElementById("office-sales-library");
  const soldContainer = document.getElementById("office-sold-library");
  renderSalesTeamTiles(sales);
  if (nonContainer) nonContainer.innerHTML = renderOfficeLibraryItems(nonHallmarked, "No non hallmarked stock.");
  if (hallmarkedContainer) hallmarkedContainer.innerHTML = renderOfficeLibraryItems(hallmarked, "No hallmarked stock.");
  if (hallmarkingContainer) hallmarkingContainer.innerHTML = renderOfficeLibraryItems(hallmarking, "No item issued to Hallmarking.");
  if (salesContainer) salesContainer.innerHTML = '<div class="empty">Open a sales team tile to view holding.</div>';
  if (soldContainer) soldContainer.innerHTML = renderOfficeLibraryItems(sold, "No sold item.");
}

function renderSalesTeamTiles(salesEntries = []) {
  const container = document.getElementById("office-sales-team-tiles");
  if (!container) return;
  container.innerHTML = salesTeamTilesHtml(salesEntries);
}

function salesTeamTilesHtml(salesEntries = []) {
  const teams = isSalesUser() ? [currentSalesTeam()] : ["Sales Team 1", "Sales Team 2", "Sales Team 3", "Sales Team 4", "Sales Team 5"];
  return teams.map((team) => {
    const entries = salesEntries.filter(({ item }) => item.salesTeam === team);
    const totalWeight = entries.reduce((total, { item }) => total + Number(item.netWeight || 0), 0);
    return `
      <button class="action-tile sales-team-tile" type="button" data-sales-team="${escapeHtml(team)}">
        <strong>${escapeHtml(team)}</strong>
        <span>${entries.length} pcs / ${gram(totalWeight)}</span>
      </button>
    `;
  }).join("");
}

function customerOptionsHtml(selected = "") {
  return state.customers.map((customer) =>
    `<option value="${escapeHtml(customer.id)}" ${customer.id === selected ? "selected" : ""}>${escapeHtml(customer.name)}</option>`
  ).join("");
}

function officeCustomerOptionsHtml(selected = "") {
  return (state.officeCustomers || []).map((customer) =>
    `<option value="${escapeHtml(customer.id)}" ${customer.id === selected ? "selected" : ""}>${escapeHtml(customer.name)}</option>`
  ).join("");
}

function openSalesTeamHolding(team) {
  if (isSalesUser() && team !== currentSalesTeam()) {
    alert("This login can view only its own sales team holding.");
    team = currentSalesTeam();
  }
  const title = document.querySelector("#office-details-dialog h2");
  const note = document.querySelector("#office-details-dialog .dialog-note");
  const actions = document.getElementById("office-dialog-actions");
  const content = document.getElementById("office-dialog-content");
  const detailsPanel = document.querySelector("#office-details-dialog .table-panel");
  const entries = officeItems().filter(({ item }) => item.salesTeam === team && item.saleStatus !== "Sold");
  if (title) title.textContent = `${team} Holding`;
  if (note) note.textContent = "Full item details for this sales team.";
  if (actions) actions.innerHTML = isSalesUser()
    ? `${officeAccessNote()}<button type="button" id="office-back-sales" class="ghost-button">Back To Sales Teams</button>`
    : `
      ${officeAccessNote()}
      <button type="button" id="office-back-sales" class="ghost-button">Back To Sales Teams</button>
      <select id="office-sold-customer">
        <option value="">Select sold customer</option>
        ${officeCustomerOptionsHtml()}
      </select>
      <button type="button" id="office-mark-sold" class="ghost-button">Mark Sold</button>
    `;
  if (detailsPanel) detailsPanel.classList.add("hidden");
  if (content) content.innerHTML = `
    <div class="panel-heading office-sales-heading">
      <h3>${escapeHtml(team)} Holding</h3>
      <span>${entries.length} item${entries.length === 1 ? "" : "s"}</span>
    </div>
    ${renderSalesTeamItemDetails(entries, `No holding in ${team}.`)}
  `;
  const dialog = document.getElementById("office-details-dialog");
  if (!dialog.open) dialog.showModal();
}

function renderSalesTeamItemDetails(entries, emptyText) {
  if (!entries.length) return `<div class="empty">${emptyText}</div>`;
  return entries.map(({ lot, bill, item, order }) => {
    const key = officeItemKey(lot.id, item);
    const detailReadonly = canEditOfficeWeights() ? "" : "readonly";
    return `
      <div class="office-library-item hallmarked sales-detail-card">
        <label class="office-tile-select">
          <input class="office-item-check" type="checkbox" value="${escapeHtml(key)}">
          <span>${escapeHtml(item.salesTeam || "Sales Team")}</span>
        </label>
        <strong>${escapeHtml(item.productionNo || order.productionNo || "-")}</strong>
        <span>${escapeHtml(order.customer || "-")} / ${escapeHtml(order.designNo || designLabel(order.designId) || "-")}</span>
        <div class="sales-detail-grid">
          <span><b>GW</b>${gram(item.finalGw)}</span>
          <span><b>Net Wt</b>${gram(item.netWeight)}</span>
          <span><b>Stone Wt</b>${gram(item.reducedWeight)}</span>
          <span><b>Mfg Making</b>${gram(item.manufacturingMakingGold || item.makingGold)}</span>
          <span><b>Office Making</b>${gram(item.officeMakingGold)}</span>
          <span><b>Bill No</b>${escapeHtml(bill.billNo || "-")}</span>
          <span><b>HUID</b>${escapeHtml([item.huid1, item.huid2].filter(Boolean).join(" / ") || "-")}</span>
        </div>
        <div class="sales-extra-grid">
          <label>Black Beads <input class="office-detail-input" data-key="${escapeHtml(key)}" data-field="blackBeads" value="${escapeHtml(item.blackBeads || "")}" placeholder="Black beads" ${detailReadonly}></label>
          <label>Moti <input class="office-detail-input" data-key="${escapeHtml(key)}" data-field="moti" value="${escapeHtml(item.moti || "")}" placeholder="Moti" ${detailReadonly}></label>
          <label>Spring <input class="office-detail-input" data-key="${escapeHtml(key)}" data-field="spring" value="${escapeHtml(item.spring || "")}" placeholder="Spring" ${detailReadonly}></label>
          <label>Other Details <input class="office-detail-input" data-key="${escapeHtml(key)}" data-field="otherDetails" value="${escapeHtml(item.otherDetails || "")}" placeholder="Other item details" ${detailReadonly}></label>
        </div>
        <small>${escapeHtml(lot.orderNumber || "-")} / Location: ${escapeHtml(officeItemLocation(item))}</small>
      </div>
    `;
  }).join("");
}

function renderOfficeLibraryItems(entries, emptyText) {
  if (!entries.length) return `<div class="empty">${emptyText}</div>`;
  return entries.map(({ lot, bill, item, order }) => {
    const key = officeItemKey(lot.id, item);
    const soldAction = item.saleStatus === "Sold"
      ? `<button type="button" class="ghost-button office-view-button" data-sold-view-key="${escapeHtml(key)}">View</button>`
      : "";
    return `
      <div class="office-library-item ${isHallmarkedItem(item) ? "hallmarked" : "non-hallmarked"}">
        <label class="office-tile-select">
          <input class="office-item-check" type="checkbox" value="${escapeHtml(key)}">
          <span>${escapeHtml(officeItemStatus(item))}</span>
        </label>
        <div class="office-library-row">
          <strong>${escapeHtml(item.productionNo || order.productionNo || "-")}</strong>
          ${soldAction}
        </div>
        <span>${escapeHtml(order.customer || "-")} / ${escapeHtml(order.designNo || designLabel(order.designId) || "-")}</span>
        <small>${escapeHtml(lot.orderNumber || "-")} / ${escapeHtml(bill.billNo || "-")} / ${gram(item.netWeight)}</small>
        <small>Location: ${escapeHtml(officeItemLocation(item))}</small>
        ${item.soldCustomer ? `<small>Sold To: ${escapeHtml(item.soldCustomer)}</small>` : ""}
        ${item.hallmarkStatus === "Issued" ? officeHuidHtml(lot, item, order) : ""}
        ${isHallmarkedItem(item) ? `<small>HUID: ${escapeHtml([item.huid1, item.huid2].filter(Boolean).join(" / "))}</small>` : ""}
      </div>
    `;
  }).join("");
}

function renderOfficeCustomersPage() {
  return `
    <div class="office-customer-layout">
      <form id="office-customer-form" class="form-panel office-customer-form">
        <h3 id="office-customer-form-title">Add Office Customer</h3>
        <input type="hidden" name="customerId">
        <label>Customer Name <input name="name" required></label>
        <label>Phone <input name="phone"></label>
        <label>City <input name="city"></label>
        <label>GST / Tax No <input name="gst"></label>
        <label class="office-customer-wide">Address <input name="address"></label>
        <div class="dialog-actions">
          <button id="office-customer-submit" type="submit">Save Office Customer</button>
          <button id="cancel-office-customer-edit" class="ghost-button hidden" type="button">Cancel Edit</button>
        </div>
      </form>
      <section class="panel table-panel office-customer-list-panel">
        <div class="panel-heading">
          <h3>Office Customer Master</h3>
          <input id="office-customer-search" class="search" placeholder="Search office customers">
        </div>
        <div class="table-wrap office-customer-table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>City</th><th>GST</th><th>Address</th><th></th></tr></thead>
            <tbody id="office-customers-table">${officeCustomersRowsHtml()}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function officeCustomersRowsHtml() {
  const query = (document.getElementById("office-customer-search")?.value || "").toLowerCase();
  const rows = (state.officeCustomers || [])
    .filter((customer) => `${customer.name} ${customer.phone} ${customer.city} ${customer.gst} ${customer.address}`.toLowerCase().includes(query))
    .map((customer) => `
      <tr>
        <td>${escapeHtml(customer.name)}</td>
        <td>${escapeHtml(customer.phone || "-")}</td>
        <td>${escapeHtml(customer.city || "-")}</td>
        <td>${escapeHtml(customer.gst || "-")}</td>
        <td>${escapeHtml(customer.address || "-")}</td>
        <td><div class="row-actions"><button type="button" data-edit-office-customer="${escapeHtml(customer.id)}">Edit</button><button type="button" class="delete-btn" data-delete-office-customer="${escapeHtml(customer.id)}">Delete</button></div></td>
      </tr>
    `)
    .join("");
  return rows || tableEmpty(6, "No office customers recorded.");
}

function renderOfficeCustomerList() {
  const table = document.getElementById("office-customers-table");
  if (table) table.innerHTML = officeCustomersRowsHtml();
}

function saveOfficeCustomer(form) {
  const data = getFormData(form);
  const existing = data.customerId ? (state.officeCustomers || []).find((customer) => customer.id === data.customerId) : null;
  if (existing) {
    existing.name = data.name;
    existing.phone = data.phone;
    existing.city = data.city;
    existing.gst = data.gst;
    existing.address = data.address;
    updateOfficeCustomerReferences(existing);
  } else {
    state.officeCustomers.push({
      id: crypto.randomUUID(),
      name: data.name,
      phone: data.phone,
      city: data.city,
      gst: data.gst,
      address: data.address,
    });
  }
  resetOfficeCustomerForm();
  saveState();
  renderOfficeCustomerList();
}

function editOfficeCustomer(id) {
  const customer = (state.officeCustomers || []).find((item) => item.id === id);
  if (!customer) return;
  const form = document.getElementById("office-customer-form");
  if (!form) return;
  form.customerId.value = customer.id;
  form.name.value = customer.name || "";
  form.phone.value = customer.phone || "";
  form.city.value = customer.city || "";
  form.gst.value = customer.gst || "";
  form.address.value = customer.address || "";
  document.getElementById("office-customer-form-title").textContent = "Edit Office Customer";
  document.getElementById("office-customer-submit").textContent = "Update Office Customer";
  document.getElementById("cancel-office-customer-edit").classList.remove("hidden");
}

function resetOfficeCustomerForm() {
  const form = document.getElementById("office-customer-form");
  if (!form) return;
  form.reset();
  form.customerId.value = "";
  document.getElementById("office-customer-form-title").textContent = "Add Office Customer";
  document.getElementById("office-customer-submit").textContent = "Save Office Customer";
  document.getElementById("cancel-office-customer-edit").classList.add("hidden");
}

function deleteOfficeCustomer(id) {
  if (state.lots.some((lot) => {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    return (bill?.items || []).some((item) => item.soldCustomerId === id);
  })) {
    alert("This office customer is used in sold items. Edit the customer instead of deleting.");
    return;
  }
  state.officeCustomers = (state.officeCustomers || []).filter((customer) => customer.id !== id);
  saveState();
  renderOfficeCustomerList();
}

function updateOfficeCustomerReferences(customer) {
  state.lots.forEach((lot) => {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    if (!bill?.items?.length) return;
    bill.items = bill.items.map((item) =>
      item.soldCustomerId === customer.id ? { ...item, soldCustomer: customer.name } : item
    );
    lot.bill = bill;
    updateSavedBill(bill);
  });
}

async function openOfficeItemView(key) {
  const found = findOfficeBillItem(key);
  if (!found) {
    alert("Product details not found.");
    return;
  }
  const { lot, bill, item } = found;
  const order = findById("orders", item.orderId) || {};
  const design = findById("designs", order.designId) || {};
  const title = document.querySelector("#office-details-dialog h2");
  const note = document.querySelector("#office-details-dialog .dialog-note");
  const actions = document.getElementById("office-dialog-actions");
  const content = document.getElementById("office-dialog-content");
  const detailsPanel = document.querySelector("#office-details-dialog .table-panel");
  const dialog = document.getElementById("office-details-dialog");
  if (dialog) {
    dialog.dataset.backPage = dialog.dataset.page || "all";
    dialog.dataset.page = "product-view";
  }
  let imageData = "";
  if (design.id) {
    imageData = await getDesignImage(design.id).catch(() => design.imageData || "");
  }
  if (title) title.textContent = `Product Details - ${item.productionNo || order.productionNo || "-"}`;
  if (note) note.textContent = `${officeItemLocation(item)} / ${officeItemStatus(item)}`;
  const discardAction = canEditOfficeWeights() && !isDiscardedItem(item)
    ? `<button type="button" class="danger-button" data-discard-office-item="${escapeHtml(key)}">Discard / Send To Melting</button>`
    : "";
  if (actions) actions.innerHTML = `<button type="button" id="office-back-sold" class="ghost-button">Back To Office Details</button>${discardAction}`;
  if (detailsPanel) detailsPanel.classList.add("hidden");
  if (content) {
    content.innerHTML = `
      <div class="sold-view-layout">
        <div class="sold-design-panel">
          ${imageData
            ? `<img class="sold-design-image" src="${imageData}" alt="${escapeHtml(designText(design) || order.designNo || "Design image")}">`
            : '<div class="empty sold-image-empty">No design image found for this item.</div>'}
          <strong>${escapeHtml(designText(design) || order.designNo || "-")}</strong>
          <span>${escapeHtml(order.category || design.category || "-")}</span>
          ${item.productionNo || order.productionNo ? barcodeSvg(item.productionNo || order.productionNo) : ""}
        </div>
        <div class="sold-detail-panel">
          <div class="panel-heading">
            <h3>${escapeHtml(item.productionNo || order.productionNo || "-")}</h3>
            <span class="status ${officeItemStatusClass(item)}">${escapeHtml(officeItemStatus(item))}</span>
          </div>
          <div class="sold-detail-grid">
            ${soldDetailCell("Current Location", officeItemLocation(item))}
            ${soldDetailCell("Current Status", officeItemStatus(item))}
            ${isDiscardedItem(item) ? soldDetailCell("Discard Reason", item.discardReason) : ""}
            ${isDiscardedItem(item) ? soldDetailCell("Discard Date", item.discardDate) : ""}
            ${soldDetailCell("Job Card", lot.orderNumber || lot.number)}
            ${soldDetailCell("Lot", lot.number)}
            ${soldDetailCell("Bill No", bill.billNo)}
            ${soldDetailCell("Original Customer", order.customer)}
            ${soldDetailCell("Sold To", item.soldCustomer)}
            ${soldDetailCell("Sale Date", item.saleDate)}
            ${soldDetailCell("Sales Team", item.salesTeam)}
            ${soldDetailCell("Design", order.designNo || designLabel(order.designId))}
            ${soldDetailCell("Category", order.category || design.category)}
            ${soldDetailCell("Ring Type", ringTypeLabel(order.ringType))}
            ${soldDetailCell("Size", soldItemSizeText(order))}
            ${soldDetailCell("Colour", order.color)}
            ${soldDetailCell("Purity", item.purity || order.purity)}
            ${soldDetailCell("GW", gram(item.finalGw))}
            ${soldDetailCell("Stone Wt", gram(item.reducedWeight))}
            ${soldDetailCell("Net Wt", gram(item.netWeight))}
            ${soldDetailCell("Mfg Making %", item.manufacturingMakingPercent || item.makingPercent || "")}
            ${soldDetailCell("Mfg Making Gold", gram(item.manufacturingMakingGold || item.makingGold))}
            ${soldDetailCell("Office Making %", item.officeMakingPercent || "")}
            ${soldDetailCell("Office Making Gold", gram(item.officeMakingGold))}
            ${soldDetailCell("HUID", [item.huid1, item.huid2].filter(Boolean).join(" / "))}
            ${soldDetailCell("Black Beads", item.blackBeads)}
            ${soldDetailCell("Moti", item.moti)}
            ${soldDetailCell("Spring", item.spring)}
            ${soldDetailCell("Other Details", item.otherDetails)}
            ${soldDetailCell("Remark", order.remarks)}
          </div>
        </div>
      </div>
    `;
  }
  if (!dialog.open) dialog.showModal();
}

function soldDetailCell(label, value) {
  return `
    <span>
      <b>${escapeHtml(label)}</b>
      ${escapeHtml(value || "-")}
    </span>
  `;
}

function soldItemSizeText(order = {}) {
  if (isCbCategory(order.category)) {
    return [
      order.clSize ? `CL ${order.clSize}` : "",
      order.cgSize ? `CG ${order.cgSize}` : "",
    ].filter(Boolean).join(" / ") || order.size || "";
  }
  return order.size || "";
}

function renderOfficeTeamSummary(items = officeItems()) {
  const summary = document.getElementById("office-team-summary");
  if (!summary) return;
  const buckets = items.reduce((acc, { item }) => {
    const holder = officeItemLocation(item);
    const current = acc[holder] || { pcs: 0, net: 0, sold: 0 };
    current.pcs += 1;
    current.net += Number(item.netWeight || 0);
    if (item.saleStatus === "Sold") current.sold += 1;
    acc[holder] = current;
    return acc;
  }, {});
  summary.innerHTML = Object.entries(buckets).map(([holder, total]) => `
    <div class="office-summary-card">
      <span>${escapeHtml(holder)}</span>
      <strong>${total.pcs} pcs / ${gram(total.net)}</strong>
      ${total.sold ? `<small>Sold ${total.sold} pcs</small>` : ""}
    </div>
  `).join("") || '<div class="empty">No office item holding yet.</div>';
}

function officeItems() {
  return state.lots.flatMap((lot) => {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    if (!bill?.items?.length) return [];
    return bill.items
      .filter((item) => item.qcStatus === "QC OK" && item.officeStatus === "Office" && !isDiscardedItem(item))
      .map((item) => ({
        lot,
        bill,
        item,
        order: findById("orders", item.orderId) || {},
      }));
  });
}

function officeDepartment(item = {}) {
  if (isDiscardedItem(item)) return "discarded";
  if (item.saleStatus === "Sold") return "sold";
  if (item.salesTeam) return "sales";
  if (item.hallmarkStatus === "Issued") return "hallmarking";
  if (isHallmarkedItem(item)) return "hallmarked";
  return "non-hallmarked";
}

function officeItemKey(lotId, item) {
  return `${lotId}::${item.orderId || item.productionNo || ""}`;
}

function isHallmarkedItem(item = {}) {
  return Boolean(normalizeHuid(item.huid1) || normalizeHuid(item.huid2) || item.hallmarkStatus === "Received");
}

function officeHuidHtml(lot, item, order = {}) {
  const key = officeItemKey(lot.id, item);
  const first = `
    <input class="office-huid-input" data-key="${escapeHtml(key)}" data-field="huid1" value="${escapeHtml(item.huid1 || "")}" placeholder="HUID" ${canEditOfficeWeights() ? "" : "readonly"}>
  `;
  if (!isEarringItem(order, item)) return first;
  return `
    <div class="office-huid-pair">
      ${first}
      <input class="office-huid-input" data-key="${escapeHtml(key)}" data-field="huid2" value="${escapeHtml(item.huid2 || "")}" placeholder="HUID 2" ${canEditOfficeWeights() ? "" : "readonly"}>
    </div>
  `;
}

function officeHuidText(item = {}) {
  return [item.huid1, item.huid2].filter(Boolean).join(" / ") || "-";
}

function isEarringItem(order = {}, item = {}) {
  const text = [
    order.category,
    order.item,
    order.designNo,
    order.remarks,
    order.ringType,
    item.productionNo,
  ].join(" ");
  return textMatchesAny(text, ["earring", "ear ring", "earrings", "er"]);
}

function saveOfficeHuidFromTable(event) {
  const input = event.target;
  if (!input.classList?.contains("office-huid-input") && !input.classList?.contains("office-detail-input")) return;
  if (!canEditOfficeWeights()) {
    alert("This login can view Office but cannot edit weights or item details.");
    input.blur();
    renderOffice();
    return;
  }
  const found = findOfficeBillItem(input.dataset.key);
  if (!found) return;
  if (input.classList.contains("office-detail-input")) {
    const allowedFields = ["blackBeads", "moti", "spring", "otherDetails"];
    const field = allowedFields.includes(input.dataset.field) ? input.dataset.field : "";
    if (!field) return;
    found.bill.items[found.index] = {
      ...found.item,
      [field]: input.value.trim(),
      officeDetailUpdatedDate: today(),
    };
    found.lot.bill = found.bill;
    updateSavedBill(found.bill);
    saveState();
    return;
  }
  const field = input.dataset.field === "huid2" ? "huid2" : "huid1";
  const huid = normalizeHuid(input.value);
  if (huid && isDuplicateHuid(huid, input.dataset.key, field)) {
    alert(`HUID ${huid} is already used. Same HUID cannot be used twice.`);
    input.value = "";
    found.bill.items[found.index] = {
      ...found.item,
      [field]: "",
      huidUpdatedDate: today(),
    };
    found.lot.bill = found.bill;
    updateSavedBill(found.bill);
    saveState();
    return;
  }
  found.bill.items[found.index] = {
    ...found.item,
    [field]: huid,
    huidUpdatedDate: today(),
  };
  found.lot.bill = found.bill;
  updateSavedBill(found.bill);
  saveState();
}

function normalizeHuid(value = "") {
  return String(value || "").trim().toUpperCase();
}

function isDuplicateHuid(huid, currentKey = "", currentField = "") {
  const normalized = normalizeHuid(huid);
  if (!normalized) return false;
  return state.lots.some((lot) => {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    if (!bill?.items?.length) return false;
    return bill.items.some((item) => {
      const key = officeItemKey(lot.id, item);
      return ["huid1", "huid2"].some((field) =>
        !(key === currentKey && field === currentField)
        && normalizeHuid(item[field]) === normalized
      );
    });
  });
}

function hasAnyDuplicateHuid() {
  const seen = new Set();
  for (const lot of state.lots) {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    if (!bill?.items?.length) continue;
    for (const item of bill.items) {
      for (const field of ["huid1", "huid2"]) {
        const huid = normalizeHuid(item[field]);
        if (!huid) continue;
        if (seen.has(huid)) return true;
        seen.add(huid);
      }
    }
  }
  return false;
}

function findOfficeBillItem(key) {
  for (const lot of state.lots) {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    if (!bill?.items?.length) continue;
    const index = bill.items.findIndex((item) => officeItemKey(lot.id, item) === key);
    if (index >= 0) return { lot, bill, item: bill.items[index], index };
  }
  return null;
}

function discardOfficeItem(key) {
  if (!canEditOfficeWeights()) {
    alert("This login can view Office but cannot discard items.");
    return;
  }
  const found = findOfficeBillItem(key);
  if (!found) {
    alert("Product details not found.");
    return;
  }
  const { lot, bill, item, index } = found;
  if (isDiscardedItem(item)) {
    alert("This product is already discarded.");
    return;
  }
  const productionNo = item.productionNo || findById("orders", item.orderId)?.productionNo || "this item";
  const reason = prompt(`Reason for discarding ${productionNo}:`, "Damaged beyond repair");
  if (reason === null) return;
  if (!confirm(`Discard ${productionNo} and send gold to melting? This item will be removed from office/sales holding.`)) return;
  const order = findById("orders", item.orderId) || {};
  const goldWeight = Number(weight3(item.netWeight || Math.max(Number(item.finalGw || 0) - Number(item.reducedWeight || 0), 0)));
  if (goldWeight <= 0) {
    alert("Net gold weight is zero. Please correct item weight before discarding.");
    return;
  }
  const purity = purityPercent(item.purity || order.purity || "18K");
  const meltingId = createDiscardMeltingRecord({
    item,
    order,
    lot,
    reason: reason.trim() || "Damaged beyond repair",
    goldWeight,
    purity,
  });
  bill.items[index] = {
    ...item,
    discardStatus: "Discarded",
    discardDate: today(),
    discardReason: reason.trim() || "Damaged beyond repair",
    discardMeltingId: meltingId,
    holder: "Melting",
    officeStatus: "Discarded",
    salesTeam: "",
    salesIssueDate: "",
    saleStatus: "",
  };
  lot.bill = bill;
  updateSavedBill(bill);
  if (order.id) order.status = "Discarded / Melting";
  saveState();
  render();
  document.getElementById("office-details-dialog").close();
  alert(`${productionNo} discarded and sent to Melting.`);
}

function createDiscardMeltingRecord({ item, order, lot, reason, goldWeight, purity }) {
  const meltingId = crypto.randomUUID();
  const department = meltingDepartment("Melting Department");
  const productionNo = item.productionNo || order.productionNo || "";
  state.melting = state.melting || [];
  state.ledger = state.ledger || [];
  state.melting.unshift({
    id: meltingId,
    date: today(),
    sourceMetals: [{ weight: goldWeight, purity }],
    sourcePurity: purity,
    sourceWeight: goldWeight,
    targetPurity: purity,
    colour: order.color || "Discard Melt",
    pureGold: fineGoldWeight(goldWeight, purity),
    finalWeight: goldWeight,
    alloyWeight: 0,
    departmentId: department.id,
    departmentName: department.name,
    status: "Issued",
    receivedWeight: 0,
    meltingLoss: 0,
    sourceType: "Discarded Product",
    sourceLotId: lot.id,
    sourceJobNumber: lot.orderNumber || order.jobNumber || "",
    sourceProductionNo: productionNo,
    discardReason: reason,
  });
  state.ledger.unshift({
    id: crypto.randomUUID(),
    meltingId,
    date: today(),
    type: "Melt Issue",
    purity: formatPurity(purity),
    weight: goldWeight,
    reference: `Discarded ${productionNo || "product"} from ${lot.orderNumber || lot.number}; ${reason}`,
  });
  return meltingId;
}

function officeItemHolder(item) {
  if (item.saleStatus === "Sold") return item.salesTeam || "Sold";
  if (item.salesTeam) return item.salesTeam;
  if (item.hallmarkStatus === "Issued") return "Hallmarking Department";
  if (isHallmarkedItem(item)) return "Hallmarked Item";
  return "Non Hallmarked Item";
}

function officeItemLocation(item) {
  if (isDiscardedItem(item)) return "Discarded / Melting";
  if (item.saleStatus === "Sold") return item.soldCustomer ? `Sold to ${item.soldCustomer}` : "Sold Item";
  if (item.salesTeam) return `Sales Team - ${item.salesTeam}`;
  if (item.hallmarkStatus === "Issued") return "Hallmarking Department";
  if (isHallmarkedItem(item)) return "Office - Hallmarked Item Stock";
  return "Office - Non Hallmarked Item Stock";
}

function officeItemStatus(item) {
  if (isDiscardedItem(item)) return "Discarded for Melting";
  if (item.saleStatus === "Sold") return "Sold";
  if (item.salesTeam) return "With Sales Team";
  if (item.hallmarkStatus === "Issued") return "Hallmarking Issued";
  if (isHallmarkedItem(item)) return "Hallmarked";
  return "Non Hallmarked";
}

function officeItemStatusClass(item) {
  if (isDiscardedItem(item)) return "cancelled";
  if (item.saleStatus === "Sold") return "completed";
  if (item.salesTeam) return "pending";
  if (item.hallmarkStatus === "Issued") return "transfer";
  return "completed";
}

function officeItemDate(item) {
  if (isDiscardedItem(item)) return item.discardDate || "";
  return item.saleDate || item.salesIssueDate || item.hallmarkReceiveDate || item.hallmarkIssueDate || item.qcDate || "";
}

function isDiscardedItem(item = {}) {
  return item.discardStatus === "Discarded";
}

function selectedOfficeKeys() {
  return Array.from(document.querySelectorAll(".office-item-check:checked")).map((input) => input.value);
}

function updateSelectedOfficeItems(action) {
  const keys = selectedOfficeKeys();
  if (!keys.length) {
    alert("Select at least one item.");
    return;
  }
  if (action === "hallmarkReceive") {
    const missingHuid = selectedOfficeEntries(keys).filter(({ item, order }) => !hasRequiredHuid(item, order));
    if (missingHuid.length) {
      alert("Enter HUID for every selected item before receiving from Hallmarking. Earrings require 2 HUID.");
      return;
    }
    if (hasAnyDuplicateHuid()) {
      alert("Duplicate HUID found. Please correct duplicate HUID before receiving from Hallmarking.");
      return;
    }
  }
  const salesTeam = document.getElementById("office-sales-team")?.value || "";
  if (action === "salesIssue" && !salesTeam) {
    alert("Select sales team.");
    return;
  }
  const soldCustomerId = document.getElementById("office-sold-customer")?.value || "";
  const soldCustomer = soldCustomerId ? (state.officeCustomers || []).find((customer) => customer.id === soldCustomerId) : null;
  if (action === "sold" && !soldCustomer) {
    alert("Select sold customer.");
    return;
  }
  if (action === "hallmarkIssue") {
    const alreadyHallmarked = selectedOfficeEntries(keys).filter(({ item }) => isHallmarkedItem(item));
    if (alreadyHallmarked.length) {
      alert("HUID already generated for selected item. Hallmarked item cannot be issued back to Hallmarking.");
      return;
    }
  }
  let updated = 0;
  state.lots.forEach((lot) => {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    if (!bill?.items?.length) return;
    bill.items = bill.items.map((item) => {
      if (!keys.includes(officeItemKey(lot.id, item))) return item;
      updated += 1;
      if (action === "hallmarkIssue") {
        return { ...item, hallmarkStatus: "Issued", hallmarkIssueDate: today(), holder: "Hallmarking Department", salesTeam: "", salesIssueDate: "", saleStatus: "" };
      }
      if (action === "hallmarkReceive") {
        return { ...item, hallmarkStatus: "Received", hallmarkReceiveDate: today(), holder: "Hallmarked Item" };
      }
      if (action === "salesIssue") {
        return { ...item, salesTeam, salesIssueDate: today(), holder: salesTeam, saleStatus: "With Sales Team" };
      }
      if (action === "sold") {
        return { ...item, saleStatus: "Sold", saleDate: today(), soldCustomerId: soldCustomer.id, soldCustomer: soldCustomer.name };
      }
      return item;
    });
    lot.bill = bill;
    updateSavedBill(bill);
  });
  if (!updated) {
    alert("Selected item was not found.");
    return;
  }
  saveState();
  render();
}

function selectedOfficeEntries(keys) {
  const selected = [];
  state.lots.forEach((lot) => {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    if (!bill?.items?.length) return;
    bill.items.forEach((item) => {
      if (!keys.includes(officeItemKey(lot.id, item))) return;
      selected.push({ lot, bill, item, order: findById("orders", item.orderId) || {} });
    });
  });
  return selected;
}

function hasRequiredHuid(item, order = {}) {
  if (!String(item.huid1 || "").trim()) return false;
  if (isEarringItem(order, item) && !String(item.huid2 || "").trim()) return false;
  return true;
}

function openBill(lotId) {
  const lot = findById("lots", lotId);
  if (!lot) return;
  const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id) || {};
  const form = document.getElementById("bill-form");
  const customer = getLotOrders(lot)[0]?.customer || "-";
  form.lotId.value = lot.id;
  form.billNo.value = bill.billNo || nextBillNumber();
  form.billDate.value = bill.billDate || isoToday();
  form.makingRate.value = bill.makingRate ?? defaultMakingPercentForLot(lot);
  form.officeMakingRate.value = bill.officeMakingRate ?? defaultMakingPercentForLot(lot);
  form.otherCharges.value = bill.otherCharges ?? 0;
  form.remarks.value = bill.remarks || "";
  document.getElementById("bill-form-title").textContent = bill.billNo ? "View / Edit Bill" : "Make Bill";
  document.getElementById("bill-summary").textContent = `${lot.number} / ${lot.orderNumber || "-"} / ${customer} / Finished ${gram(lot.finishedWeight)}`;
  renderBillItems(lot, bill);
  updateBillAmount();
  document.getElementById("bill-dialog").showModal();
}

function updateBillAmount() {
  const form = document.getElementById("bill-form");
  if (!form) return;
  const lot = findById("lots", form.lotId.value);
  const itemRows = billItemRows();
  const itemNetWeight = itemRows.reduce((total, item) => total + Number(item.netWeight || 0), 0);
  const itemManufacturingMakingGold = itemRows.reduce((total, item) => total + Number(item.manufacturingMakingGold || item.makingGold || 0), 0);
  const itemOfficeMakingGold = itemRows.reduce((total, item) => total + Number(item.officeMakingGold || 0), 0);
  const hasItemWeight = itemRows.some((item) => Number(item.finalGw || 0) > 0);
  const billWeight = hasItemWeight ? itemNetWeight : Number(lot?.finishedWeight || 0);
  const fallbackManufacturingMaking = billWeight * Number(form.makingRate.value || 0) / 100;
  const fallbackOfficeMaking = billWeight * Number(form.officeMakingRate.value || 0) / 100;
  const manufacturingAmount = hasItemWeight ? itemManufacturingMakingGold : fallbackManufacturingMaking;
  const officeAmount = hasItemWeight ? itemOfficeMakingGold : fallbackOfficeMaking;
  if (form.manufacturingBillAmount) form.manufacturingBillAmount.value = weight3(manufacturingAmount);
  form.billAmount.value = weight3(officeAmount);
}

function renderBillItems(lot, bill = {}) {
  const body = document.getElementById("bill-item-table");
  if (!body) return;
  const savedItems = Array.isArray(bill.items) ? bill.items : [];
  const rows = getLotOrders(lot).map((order, index) => {
    const saved = savedItems.find((item) => item.orderId === order.id || item.productionNo === order.productionNo) || {};
    const stoneWeight = Number(saved.reducedWeight ?? productionStoneTotalsForOrders([order]).weight ?? 0);
    const finalGwValue = saved.finalGw ?? "";
    const finalGw = Number(finalGwValue || 0);
    const netWeight = finalGwValue === "" ? 0 : Math.max(finalGw - stoneWeight, 0);
    const purity = saved.purity || order.purity || "18K";
    const manufacturingMakingPercent = saved.manufacturingMakingPercent ?? saved.makingPercent ?? defaultMakingPercentForPurity(purity);
    const officeMakingPercent = saved.officeMakingPercent ?? bill.officeMakingRate ?? saved.makingPercent ?? defaultMakingPercentForPurity(purity);
    const manufacturingMakingGold = netWeight * Number(manufacturingMakingPercent || 0) / 100;
    const officeMakingGold = netWeight * Number(officeMakingPercent || 0) / 100;
    const qcStatus = saved.qcStatus || "Pending QC";
    const qcNote = saved.reworkLotNumber ? `Returned: ${saved.reworkLotNumber}` : (saved.officeStatus ? saved.officeStatus : "");
    const itemLabel = [
      `Item ${index + 1}`,
      order.productionNo || order.number || "",
      order.designNo ? `Design ${order.designNo}` : "",
      order.ringType || "",
    ].filter(Boolean).join(" / ");
    return `
      <tr data-order-id="${escapeHtml(order.id)}" data-production-no="${escapeHtml(order.productionNo || "")}" data-reduced-weight="${weight3(stoneWeight)}" data-purity="${escapeHtml(purity)}" data-office-status="${escapeHtml(saved.officeStatus || "")}" data-rework-lot-id="${escapeHtml(saved.reworkLotId || "")}" data-rework-lot-number="${escapeHtml(saved.reworkLotNumber || "")}">
        <td>
          <strong>${escapeHtml(itemLabel)}</strong>
          <small>${escapeHtml(order.customer || "")}${order.color ? ` / ${escapeHtml(order.color)}` : ""}${order.size ? ` / Size ${escapeHtml(order.size)}` : ""}</small>
        </td>
        <td><input name="billItemFinalGw" type="number" min="0" step="0.001" value="${escapeHtml(finalGwValue)}" placeholder="Final GW"></td>
        <td>${gram(stoneWeight)}</td>
        <td><input name="billItemNetWeight" type="number" readonly value="${weight3(netWeight)}"></td>
        <td>${escapeHtml(purity)}</td>
        <td><input name="billItemManufacturingMakingPercent" type="number" min="0" step="0.01" value="${escapeHtml(manufacturingMakingPercent)}"></td>
        <td><input name="billItemManufacturingMakingGold" type="number" readonly value="${weight3(manufacturingMakingGold)}"></td>
        <td><input name="billItemOfficeMakingPercent" type="number" min="0" step="0.01" value="${escapeHtml(officeMakingPercent)}"></td>
        <td><input name="billItemOfficeMakingGold" type="number" readonly value="${weight3(officeMakingGold)}"></td>
        <td>
          <select name="billItemQcStatus">
            <option value="Pending QC" ${qcStatus === "Pending QC" ? "selected" : ""}>Pending QC</option>
            <option value="QC OK" ${qcStatus === "QC OK" ? "selected" : ""}>QC OK</option>
            <option value="QC Failed" ${qcStatus === "QC Failed" ? "selected" : ""}>QC Failed</option>
          </select>
          <small>${escapeHtml(qcNote)}</small>
        </td>
      </tr>
    `;
  }).join("");
  body.innerHTML = rows || tableEmpty(10, "No item details found for this job card.");
}

function billItemRows(existingItems = []) {
  return Array.from(document.querySelectorAll("#bill-item-table tr[data-order-id]")).map((row) => {
    const existing = existingItems.find((item) => item.orderId === row.dataset.orderId || item.productionNo === row.dataset.productionNo) || {};
    const finalGwInput = row.querySelector('[name="billItemFinalGw"]');
    const netInput = row.querySelector('[name="billItemNetWeight"]');
    const manufacturingMakingPercentInput = row.querySelector('[name="billItemManufacturingMakingPercent"]');
    const manufacturingMakingGoldInput = row.querySelector('[name="billItemManufacturingMakingGold"]');
    const officeMakingPercentInput = row.querySelector('[name="billItemOfficeMakingPercent"]');
    const officeMakingGoldInput = row.querySelector('[name="billItemOfficeMakingGold"]');
    const qcStatusInput = row.querySelector('[name="billItemQcStatus"]');
    const finalGw = Number(finalGwInput?.value || 0);
    const reducedWeight = Number(row.dataset.reducedWeight || 0);
    const netWeight = Math.max(finalGw - reducedWeight, 0);
    const manufacturingMakingPercent = Number(manufacturingMakingPercentInput?.value || 0);
    const officeMakingPercent = Number(officeMakingPercentInput?.value || 0);
    const manufacturingMakingGold = netWeight * manufacturingMakingPercent / 100;
    const officeMakingGold = netWeight * officeMakingPercent / 100;
    if (netInput) netInput.value = weight3(netWeight);
    if (manufacturingMakingGoldInput) manufacturingMakingGoldInput.value = weight3(manufacturingMakingGold);
    if (officeMakingGoldInput) officeMakingGoldInput.value = weight3(officeMakingGold);
    return {
      ...existing,
      id: existing.id || stableRecordId("bill-item", row.dataset.orderId, row.dataset.productionNo),
      orderId: row.dataset.orderId || "",
      productionNo: row.dataset.productionNo || "",
      purity: row.dataset.purity || "",
      finalGw: Number(weight3(finalGw)),
      reducedWeight: Number(weight3(reducedWeight)),
      netWeight: Number(weight3(netWeight)),
      makingPercent: manufacturingMakingPercent,
      makingGold: Number(weight3(manufacturingMakingGold)),
      manufacturingMakingPercent,
      manufacturingMakingGold: Number(weight3(manufacturingMakingGold)),
      officeMakingPercent,
      officeMakingGold: Number(weight3(officeMakingGold)),
      qcStatus: qcStatusInput?.value || "Pending QC",
      officeStatus: row.dataset.officeStatus || "",
      reworkLotId: row.dataset.reworkLotId || "",
      reworkLotNumber: row.dataset.reworkLotNumber || "",
    };
  });
}

function transferQcOkItemsToOffice() {
  const saved = saveBillFromForm(false);
  if (!saved) return;
  const { lot, bill } = saved;
  let moved = 0;
  bill.items = (bill.items || []).map((item) => {
    if (isDiscardedItem(item)) return item;
    if (item.qcStatus !== "QC OK") return item;
    moved += 1;
    return { ...item, officeStatus: "Office", qcDate: today() };
  });
  if (!moved) {
    alert("Select QC OK for at least one item.");
    return;
  }
  lot.bill = bill;
  lot.billingStage = bill.items.some((item) => item.qcStatus === "QC Failed") ? "QC Failed / Office OK" : "Office";
  lot.productionStockWeight = Number(weight3((bill.items || [])
    .filter((item) => item.qcStatus !== "QC OK")
    .reduce((total, item) => total + Number(item.netWeight || item.finalGw || 0), 0)));
  lot.currentDepartment = "Office";
  lot.karigarName = "Office Department";
  updateSavedBill(bill);
  saveState();
  render();
  openBill(lot.id);
}

function returnQcFailedItemsToProduction() {
  const saved = saveBillFromForm(false);
  if (!saved) return;
  const { lot, bill } = saved;
  const failedItems = (bill.items || []).filter((item) => item.qcStatus === "QC Failed" && !item.reworkLotId);
  if (!failedItems.length) {
    alert("Select QC Failed for item not already returned.");
    return;
  }
  const failedOrderIds = failedItems.map((item) => item.orderId).filter(Boolean);
  const failedOrders = failedOrderIds.map((id) => findById("orders", id)).filter(Boolean);
  if (!failedOrders.length) {
    alert("No failed job item found to return.");
    return;
  }
  const reworkLot = createQcFailedReworkLot(lot, failedOrders, failedItems);
  failedOrders.forEach((order) => {
    order.status = "QC Failed - Production";
  });
  bill.items = (bill.items || []).map((item) => {
    if (!failedOrderIds.includes(item.orderId)) return item;
    return { ...item, reworkLotId: reworkLot.id, reworkLotNumber: reworkLot.number, qcDate: today() };
  });
  lot.bill = bill;
  lot.billingStage = "QC Failed Returned";
  lot.currentDepartment = "Bill";
  lot.karigarName = "Bill Department";
  updateSavedBill(bill);
  saveState();
  render();
  openBill(lot.id);
}

function createQcFailedReworkLot(sourceLot, orders, failedItems) {
  const lotNumber = `LOT-${state.nextLot++}`;
  const issueWeight = failedItems.reduce((total, item) => total + Number(item.netWeight || item.finalGw || 0), 0);
  const lot = {
    id: crypto.randomUUID(),
    number: lotNumber,
    issueDate: today(),
    orderId: orders[0]?.id || "",
    orderIds: orders.map((order) => order.id),
    orderNumber: sourceLot.orderNumber,
    karigarId: "",
    karigarName: "Bill Department",
    issueKarigarId: "",
    issueKarigarName: "Bill Department",
    issueDepartment: "Bill",
    currentDepartment: "Bill",
    metalPurity: sourceLot.metalPurity || orders[0]?.purity || "18K",
    grossIssuedWeight: Number(weight3(issueWeight)),
    waxStoneWeight: 0,
    issuedWeight: Number(weight3(issueWeight)),
    expectedWastage: Number(sourceLot.expectedWastage || 0),
    finishedWeight: 0,
    actualWastage: 0,
    status: "Issued",
    parentLotId: sourceLot.id,
    qcReturn: true,
    qcReturnReason: "QC Failed from Sales Office",
    transfers: [],
  };
  state.lots.unshift(lot);
  return lot;
}

function updateSavedBill(bill) {
  state.bills = state.bills || [];
  const existingIndex = state.bills.findIndex((item) => item.lotId === bill.lotId);
  if (existingIndex >= 0) state.bills[existingIndex] = bill;
  else state.bills.unshift(bill);
}

function defaultMakingPercentForLot(lot) {
  const order = getLotOrders(lot)[0];
  return defaultMakingPercentForPurity(order?.purity || lot?.metalPurity || "18K");
}

function defaultMakingPercentForPurity(purity) {
  const label = String(purity || "").toLowerCase().replace(/\s+/g, "");
  if (label.includes("14")) return 3.5;
  if (label.includes("18")) return 2;
  return 2;
}

function nextBillNumber() {
  const next = (state.bills || []).length + 1;
  return `BILL-${String(next).padStart(4, "0")}`;
}

function wastageDetailHtml(lot) {
  if (!Number(lot.actualWastage || 0)) return `${lot.expectedWastage}% est.`;
  const purity = lot.wastagePurity || lot.metalPurity || getLotOrders(lot)[0]?.purity || "";
  const fine = Number(lot.wastageFineGold ?? fineGoldWeight(lot.actualWastage, purity));
  return `${gram(lot.actualWastage)}<br><small>${displayPurity(purity)} / Fine ${gram(fine)}</small>`;
}

function renderLedger() {
  const rows = state.ledger.map((item) => `
    <tr>
      <td>${item.date}</td>
      <td><span class="status ${item.type.toLowerCase()}">${item.type}</span></td>
      <td>${item.purity}</td>
      <td>${gram(item.weight)}</td>
      <td>${escapeHtml(item.reference)}</td>
    </tr>
  `).join("");
  document.getElementById("stock-table").innerHTML = rows || tableEmpty(5, "No stock movements recorded.");
}

function updateMeltingCalculation() {
  const form = document.getElementById("melting-form");
  const sourceMetals = getMeltingSourceMetals();
  const sourceWeight = sourceMetals.reduce((total, metal) => total + metal.weight, 0);
  const pureGold = sourceMetals.reduce((total, metal) => total + metal.weight * (metal.purity / 100), 0);
  const averagePurity = sourceWeight ? (pureGold / sourceWeight) * 100 : 0;
  const targetPurity = Number(form.targetPurity.value || 0);
  const finalWeight = targetPurity ? pureGold / (targetPurity / 100) : 0;
  form.averagePurity.value = averagePurity.toFixed(2);
  form.sourceWeight.value = weight3(sourceWeight);
  form.pureGold.value = weight3(pureGold);
  form.finalWeight.value = weight3(finalWeight);
  form.alloyWeight.value = weight3(Math.max(finalWeight - sourceWeight, 0));
}

function addMeltingSourceRow(weight = "", purity = "", position = "bottom", shouldFocus = false) {
  const row = document.createElement("div");
  row.className = "source-row";
  row.innerHTML = `
    <label>Weight (g) <input name="sourceWeightLine" type="number" min="0.001" step="0.001" value="${escapeHtml(weight)}" required></label>
    <label>Purity (%) <input name="sourcePurity" type="number" min="0.01" max="100" step="0.01" value="${escapeHtml(purity)}" required></label>
    <button class="delete-btn" type="button">Remove</button>
  `;
  row.querySelector("button").addEventListener("click", () => {
    row.remove();
    if (!document.querySelectorAll("#melting-sources .source-row").length) {
      addMeltingSourceRow("", "", "top", true);
    }
    updateMeltingCalculation();
  });
  const list = document.getElementById("melting-sources");
  if (position === "top" && list.firstChild) {
    list.insertBefore(row, list.firstChild);
  } else {
    list.appendChild(row);
  }
  if (shouldFocus) row.querySelector('[name="sourceWeightLine"]').focus();
}

function resetMeltingSources() {
  document.getElementById("melting-sources").innerHTML = "";
  addMeltingSourceRow();
}

function getMeltingSourceMetals() {
  return [...document.querySelectorAll("#melting-sources .source-row")]
    .map((row) => ({
      id: crypto.randomUUID(),
      weight: Number(row.querySelector('[name="sourceWeightLine"]').value || 0),
      purity: Number(row.querySelector('[name="sourcePurity"]').value || 0),
    }))
    .filter((metal) => metal.weight > 0 && metal.purity > 0);
}

function renderMelting() {
  const rows = state.melting.map((item) => `
    <tr>
      <td>${item.date}</td>
      <td>${renderMeltingSources(item)}</td>
      <td>${formatPurity(item.targetPurity)}</td>
      <td>${escapeHtml(item.colour)}</td>
      <td>${escapeHtml(item.departmentName || "-")}</td>
      <td><span class="status ${statusClass(item.status || "Issued")}">${escapeHtml(item.status || "Issued")}</span></td>
      <td>${gram(item.pureGold)}</td>
      <td>${gram(item.finalWeight)}</td>
      <td>${item.status === "Received" ? meltingReceivedCell(item) : "-"}</td>
      <td>${item.status === "Received" ? gram(item.meltingLoss) : "-"}</td>
      <td><div class="row-actions"><button class="ghost-button" onclick="openMeltingView('${item.id}')">View</button><button onclick="openMeltingReceive('${item.id}')">${item.status === "Received" ? "Edit" : "Receive"}</button></div></td>
    </tr>
  `).join("");
  document.getElementById("melting-table").innerHTML = rows || tableEmpty(11, "No melting records yet.");
}

function renderMeltingSources(item) {
  const metals = item.sourceMetals?.length
    ? item.sourceMetals
    : [{ weight: item.sourceWeight, purity: item.sourcePurity }];
  return metals.map((metal) => `${gram(metal.weight)} @ ${formatPurity(metal.purity)}`).join("<br>");
}

function meltingReceivedCell(item) {
  const breakup = item.receiveBreakup || {};
  const title = item.receiveBreakup ? meltingReceiveBreakupText(breakup) : "";
  return `<span title="${escapeHtml(title)}">${gram(item.receivedWeight)}</span>`;
}

function formatPurity(value) {
  return `${purityPercent(value).toFixed(2)}%`;
}

function displayPurity(value) {
  const percent = purityPercent(value);
  return Number.isFinite(percent) && percent > 0 ? `${percent.toFixed(2)}%` : "-";
}

function fineGoldWeight(weight, purity) {
  return Number(weight3(Number(weight || 0) * (purityPercent(purity) / 100)));
}

function purityPercent(value) {
  if (typeof value === "string" && value.includes("K")) {
    return (Number(value.replace("K", "")) / 24) * 100;
  }
  return Number(value || 0);
}

function renderKarigars() {
  const actionColumn = isOwner() ? "<th></th>" : "";
  const rows = state.karigars.map((karigar) => {
    const inHand = state.lots
      .filter((lot) => lot.karigarId === karigar.id && lot.status !== "Completed")
      .reduce((total, lot) => total + lot.issuedWeight, 0);
    return `
      <tr>
        <td>${escapeHtml(karigar.name)}</td>
        <td>${escapeHtml(karigar.speciality)}</td>
        <td>${currency.format(karigar.rate)}</td>
        <td>${gram(inHand)}</td>
        ${isOwner() ? `<td><div class="row-actions"><button onclick="editDepartment('${karigar.id}')">Edit</button><button class="delete-btn" onclick="removeItem('karigars', '${karigar.id}')">Delete</button></div></td>` : ""}
      </tr>
    `;
  }).join("");
  document.querySelector("#karigars thead tr").innerHTML = `<th>Department</th><th>Process</th><th>Rate / g</th><th>Metal In Hand</th>${actionColumn}`;
  document.getElementById("karigars-table").innerHTML = rows || tableEmpty(isOwner() ? 5 : 4, "No departments recorded.");
}

function editDepartment(id) {
  if (!isOwner()) {
    alert("Only Owner can edit departments.");
    return;
  }
  const department = findById("karigars", id);
  if (!department) return;
  const form = document.getElementById("karigar-form");
  form.departmentId.value = department.id;
  form.name.value = department.name;
  form.speciality.value = department.speciality;
  form.rate.value = department.rate;
  document.getElementById("department-form-title").textContent = "Edit Department";
  document.getElementById("department-submit").textContent = "Update Department";
  document.getElementById("cancel-department-edit").classList.remove("hidden");
}

function resetDepartmentForm() {
  const form = document.getElementById("karigar-form");
  form.reset();
  form.departmentId.value = "";
  document.getElementById("department-form-title").textContent = "Add Department";
  document.getElementById("department-submit").textContent = "Save Department";
  document.getElementById("cancel-department-edit").classList.add("hidden");
}

function updateDepartmentReferences(department) {
  state.lots.forEach((lot) => {
    if (lot.karigarId === department.id) {
      lot.karigarName = department.name;
      lot.currentDepartment = department.speciality;
    }
    (lot.transfers || []).forEach((transfer) => {
      if (transfer.fromKarigarId === department.id) transfer.fromKarigarName = department.name;
      if (transfer.toKarigarId === department.id) transfer.toKarigarName = department.name;
    });
  });
  state.melting.forEach((item) => {
    if (item.departmentId === department.id) {
      item.departmentName = department.name;
    }
  });
}

function renderReports() {
  const wastage = state.lots.reduce((total, lot) => total + Number(lot.actualWastage || 0), 0);
  const wastageFineGold = state.lots.reduce((total, lot) => total + Number(lot.wastageFineGold ?? fineGoldWeight(lot.actualWastage, lot.wastagePurity || lot.metalPurity || getLotOrders(lot)[0]?.purity || 0)), 0);
  const departmentBalance = state.lots.reduce((total, lot) => {
    return total + (lot.transfers || []).reduce((sum, transfer) => sum + Number(transfer.departmentBalance || 0), 0);
  }, 0);
  const making = state.lots.reduce((total, lot) => {
    const karigar = findById("karigars", lot.karigarId);
    return total + Number(lot.finishedWeight || 0) * Number(karigar?.rate || 0);
  }, 0);
  document.getElementById("report-wastage").textContent = `${gram(wastage)} / Fine ${gram(wastageFineGold)}`;
  document.getElementById("report-department-balance").textContent = gram(departmentBalance);
  document.getElementById("report-making").textContent = currency.format(making);
  document.getElementById("report-completed").textContent = state.orders.filter((order) => order.status === "Completed").length;
}

function renderOnlineTransferHistory() {
  const productionViewActive = document.getElementById("production")?.classList.contains("active-view");
  const query = (productionViewActive
    ? document.getElementById("production-transfer-search")?.value || ""
    : document.getElementById("transfer-history-search")?.value || "").toLowerCase();
  const rows = state.lots.flatMap((lot) => {
    return [goldIssueHistoryEntry(lot), ...(lot.transfers || []).map((transfer) => ({ type: "transfer", lot, transfer }))];
  })
    .filter(({ lot, transfer, type }) => {
      const text = type === "issue"
        ? `${lot.number} gold issue ${lot.karigarName || ""} ${lot.currentDepartment || ""}`.toLowerCase()
        : `${lot.number} ${transfer.fromDepartment || ""} ${transfer.toDepartment || ""} ${transfer.fromKarigarName || ""} ${transfer.toKarigarName || ""} ${transfer.reason || ""}`.toLowerCase();
      return text.includes(query);
    })
    .map(renderTransferHistoryRow)
    .join("");
  const content = rows || tableEmpty(14, "No transfer history recorded.");
  document.getElementById("transfer-history-table").innerHTML = content;
  document.getElementById("production-transfer-table").innerHTML = content;
}

function transferReducedWeight(transfer) {
  return Number(transfer.reducedWeight ?? (Number(transfer.waxStoneWeight || 0) + Number(transfer.stoneWeight || 0)));
}

function transferFineGold(transfer, lot = null) {
  const lotPurity = lot ? (lot.metalPurity || getLotOrders(lot)[0]?.purity || 0) : 0;
  return Number(transfer.differenceFineGold ?? fineGoldWeight(transfer.departmentBalance, transfer.differencePurity || lotPurity));
}

function renderTransferHistoryRow(entry) {
  const { lot, transfer, type } = entry;
  if (type === "issue") {
    return `
      <tr>
        <td>${escapeHtml(transfer.date || "-")}</td>
        <td>${escapeHtml(lot.number)}</td>
        <td>Gold Issue</td>
        <td>- to ${escapeHtml(transfer.toKarigarName || "-")}</td>
        <td>${gram(transfer.transferWeight)}</td>
        <td>${gram(transfer.grossReceivedWeight)}</td>
        <td>${gram(transfer.waxStoneWeight)}</td>
        <td>${gram(transfer.stoneWeight)}</td>
        <td>${gram(transferReducedWeight(transfer))}</td>
        <td>${gram(transfer.receivedWeight)}</td>
        <td>-</td>
        <td>${escapeHtml(displayPurity(transfer.differencePurity || lot.metalPurity || "-"))}</td>
        <td>${gram(transferFineGold(transfer, lot))}</td>
        <td>${escapeHtml(transfer.reason || "-")}</td>
      </tr>
    `;
  }
  return `
    <tr>
      <td>${escapeHtml(transfer.date || "-")}</td>
      <td>${escapeHtml(lot.number)}</td>
      <td>${escapeHtml(transfer.fromDepartment || "-")} to ${escapeHtml(transfer.toDepartment || "-")}</td>
      <td>${escapeHtml(transfer.fromKarigarName || "-")} to ${escapeHtml(transfer.toKarigarName || "-")}</td>
      <td>${gram(transfer.transferWeight)}</td>
      <td>${gram(transfer.grossReceivedWeight)}</td>
      <td>${gram(transfer.waxStoneWeight)}</td>
      <td>${gram(transfer.stoneWeight)}</td>
      <td>${gram(transferReducedWeight(transfer))}</td>
      <td>${gram(transfer.receivedWeight)}</td>
      <td>${gram(transfer.departmentBalance)}</td>
      <td>${escapeHtml(displayPurity(transfer.differencePurity || lot.metalPurity || "-"))}</td>
      <td>${gram(transferFineGold(transfer, lot))}</td>
      <td>${escapeHtml(transfer.reason || "-")}<br><div class="row-actions"><button class="ghost-button" type="button" onclick="openTransferEdit('${lot.id}', '${transfer.id}')">Edit</button><button class="ghost-button danger-button" type="button" onclick="deleteTransfer('${lot.id}', '${transfer.id}')">Delete</button></div></td>
    </tr>
  `;
}

function goldIssueHistoryEntry(lot) {
  return {
    type: "issue",
    lot,
    transfer: {
      date: lot.issueDate || "-",
      toKarigarName: lot.karigarName,
      transferWeight: lot.grossIssuedWeight || (Number(lot.issuedWeight || 0) + transferWaxStoneWeight(lot)),
      grossReceivedWeight: lot.grossIssuedWeight || (Number(lot.issuedWeight || 0) + transferWaxStoneWeight(lot)),
      waxStoneWeight: lot.waxStoneWeight || 0,
      stoneWeight: 0,
      reducedWeight: lot.waxStoneWeight || 0,
      receivedWeight: lot.issuedWeight,
      differencePurity: lot.metalPurity || getLotOrders(lot)[0]?.purity || "",
      differenceFineGold: 0,
      reason: `Gold issued to ${lot.currentDepartment || lot.karigarName || "-"}${Number(lot.waxStoneWeight || 0) ? `; Gold Issue - Wax Stone = Net Wt, Wax Stone ${gram(lot.waxStoneWeight)}` : ""}`,
    },
  };
}

function stackItem(title, value) {
  return `<div class="stack-item"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function tableEmpty(colspan, message) {
  return `<tr><td colspan="${colspan}" class="empty">${message}</td></tr>`;
}

function statusClass(status) {
  return String(status).toLowerCase().replaceAll(" ", "-");
}

function isOwner() {
  return currentUser?.id === "owner";
}

function renderTransferHistory(lot) {
  const transfers = lot.transfers || [];
  if (!transfers.length) return "-";
  const latest = transfers.at(-1);
  return `<span title="${escapeHtml(transferTitle(transfers))}">${transfers.length} transfer${transfers.length > 1 ? "s" : ""}<br><small>Issue GW ${gram(latest.transferWeight)}, Receive GW ${gram(latest.grossReceivedWeight)}, Net ${gram(latest.receivedWeight)}</small></span>`;
}

function openLotHistory(lotId) {
  const lot = findById("lots", lotId);
  if (!lot) return;
  document.getElementById("history-summary").textContent = `${lot.number} / ${lot.orderNumber} / ${lot.karigarName} / ${lot.currentDepartment || "-"}`;
  document.getElementById("history-list").innerHTML = renderLotHistoryTable(lot);
  const historyDialog = document.getElementById("history-dialog");
  if (!historyDialog.open) historyDialog.showModal();
}

function renderLotHistoryTable(lot) {
  const rows = [
    renderGoldIssueHistoryRow(lot),
    ...(lot.transfers || []).map((transfer, index) => renderHistoryTableRow(transfer, index + 2, lot.id)),
  ].join("");
  return `
    <div class="table-wrap lot-history-table">
      <table>
        <thead><tr><th>Step</th><th>Date</th><th>Department</th><th>Moved From / To</th><th>Issue GW</th><th>Receive GW</th><th>Wax Stone</th><th>Hand Stone</th><th>Reduced</th><th>Net Wt</th><th>Difference</th><th>Purity</th><th>Fine Gold</th><th>Remarks</th><th>Action</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderGoldIssueHistoryRow(lot) {
  const issueGw = Number(lot.grossIssuedWeight || lot.issuedWeight || 0);
  const waxStone = Number(lot.waxStoneWeight || 0);
  return `
    <tr>
      <td>1</td>
      <td>${escapeHtml(lot.issueDate || "-")}</td>
      <td>Gold Issue</td>
      <td>- to ${escapeHtml(lot.karigarName || "-")}</td>
      <td>${gram(issueGw)}</td>
      <td>${gram(issueGw)}</td>
      <td>${gram(waxStone)}</td>
      <td>${gram(0)}</td>
      <td>${gram(waxStone)}</td>
      <td>${gram(lot.issuedWeight)}</td>
      <td>-</td>
      <td>${escapeHtml(displayPurity(lot.metalPurity || "-"))}</td>
      <td>${gram(0)}</td>
      <td>${escapeHtml(`Purity ${lot.metalPurity || "-"}; Gold Issue - Wax Stone = Net Wt`)}</td>
      <td>-</td>
    </tr>
  `;
}

function renderHistoryTableRow(transfer, step, lotId) {
  return `
    <tr>
      <td>${step}</td>
      <td>${escapeHtml(transfer.date || "-")}</td>
      <td>${escapeHtml(transfer.fromDepartment || "-")} to ${escapeHtml(transfer.toDepartment || "-")}</td>
      <td>${escapeHtml(transfer.fromKarigarName || "-")} to ${escapeHtml(transfer.toKarigarName || "-")}</td>
      <td>${gram(transfer.transferWeight)}</td>
      <td>${gram(transfer.grossReceivedWeight)}</td>
      <td>${gram(transfer.waxStoneWeight)}</td>
      <td>${gram(transfer.stoneWeight)}</td>
      <td>${gram(transferReducedWeight(transfer))}</td>
      <td>${gram(transfer.receivedWeight)}</td>
      <td>${gram(transfer.departmentBalance)}</td>
      <td>${escapeHtml(displayPurity(transfer.differencePurity || findById("lots", lotId)?.metalPurity || ""))}</td>
      <td>${gram(transferFineGold(transfer, findById("lots", lotId)))}</td>
      <td>${escapeHtml(transfer.reason || "-")}</td>
      <td><div class="row-actions"><button class="ghost-button" type="button" onclick="openTransferEdit('${lotId}', '${transfer.id}')">Edit</button><button class="ghost-button danger-button" type="button" onclick="deleteTransfer('${lotId}', '${transfer.id}')">Delete</button></div></td>
    </tr>
  `;
}

function transferTitle(transfers) {
  return transfers
    .map((transfer) => `${transfer.date}: issue GW ${gram(transfer.transferWeight)}, receive GW ${gram(transfer.grossReceivedWeight)}, wax stone ${gram(transfer.waxStoneWeight)}, hand stone ${gram(transfer.stoneWeight)}, reduced ${gram(transferReducedWeight(transfer))}, net wt ${gram(transfer.receivedWeight)}, difference ${gram(transfer.departmentBalance)} in ${transfer.balanceDepartment || transfer.fromDepartment || "-"}; ${transfer.fromKarigarName} (${transfer.fromDepartment || "-"}) to ${transfer.toKarigarName} (${transfer.toDepartment || "-"}) - ${transfer.reason}`)
    .join("\n");
}

function updateTransferBalance() {
  const form = document.getElementById("transfer-form");
  const issued = Number(form.transferWeight.value || 0);
  const grossReceived = Number(form.grossReceivedWeight.value || 0);
  const waxStone = Number(form.waxStoneWeight.value || 0);
  const handStone = Number(form.stoneWeight.value || 0);
  const lot = findById("lots", form.lotId.value);
  const issuedNet = Math.max(issued - waxStone - currentHandStoneWeight(lot, form.transferId.value), 0);
  const reducedWeight = waxStone + handStone;
  const netReceived = Math.max(grossReceived - reducedWeight, 0);
  form.reducedWeight.value = weight3(reducedWeight);
  form.receivedWeight.value = weight3(netReceived);
  form.departmentBalance.value = weight3(issuedNet - netReceived);
}

function applyProductionStoneWeightToTransfer() {
  const form = document.getElementById("transfer-form");
  const lot = findById("lots", form.lotId.value);
  if (!lot) return;
  const issueWeight = Number(form.transferWeight.value || currentTransferIssueWeight(lot));
  const waxStoneWeight = transferWaxStoneWeight(lot);
  const existingHandStoneWeight = currentHandStoneWeight(lot, form.transferId.value);
  const handStoneWeight = isSettingDepartment(form.fromDepartment.value)
    ? productionStoneTotalsForOrders(getLotOrders(lot), "hand").weight
    : existingHandStoneWeight;
  const handStoneAddedNow = Math.max(handStoneWeight - existingHandStoneWeight, 0);
  form.waxStoneWeight.value = weight3(waxStoneWeight);
  form.stoneWeight.value = weight3(handStoneWeight);
  form.grossReceivedWeight.value = weight3(issueWeight + handStoneAddedNow);
  updateTransferBalance();
}

function openMeltingReceive(meltingId) {
  const melting = findById("melting", meltingId);
  if (!melting) return;
  const form = document.getElementById("melting-receive-form");
  const breakup = melting.receiveBreakup || {};
  const defaultItemWeight = Number(melting.receivedWeight || melting.finalWeight || 0);
  document.getElementById("melting-receive-title").textContent = melting.status === "Received" ? "Edit Melting Receive" : "Receive Melting";
  form.meltingId.value = melting.id;
  form.finalWeight.value = weight3(melting.finalWeight);
  form.castingItemWeight.value = weight3(breakup.castingItemWeight ?? defaultItemWeight);
  form.treeCutWeight.value = weight3(breakup.treeCutWeight);
  form.wastageWeight.value = weight3(breakup.wastageWeight);
  form.scrapDustWeight.value = weight3(breakup.scrapDustWeight);
  form.otherReceivedWeight.value = weight3(breakup.otherReceivedWeight);
  document.getElementById("melting-receive-summary").textContent =
    `${melting.date} / ${melting.departmentName || "Department"} / ${formatPurity(melting.targetPurity)} ${melting.colour}`;
  updateMeltingReceiveLoss();
  document.getElementById("melting-receive-dialog").showModal();
}

function openMeltingView(meltingId) {
  const melting = findById("melting", meltingId);
  if (!melting) return;
  const breakup = melting.receiveBreakup || {};
  document.getElementById("melting-view-summary").textContent =
    `${melting.date} / ${melting.departmentName || "Department"} / ${formatPurity(melting.targetPurity)} ${melting.colour}`;
  document.getElementById("melting-view-body").innerHTML = `
    <article class="history-item">
      <div class="history-step">1</div>
      <div class="history-body">
        <div class="history-title"><strong>Source & Issue</strong><span>${escapeHtml(melting.status || "Issued")}</span></div>
        <div class="history-grid">
          <span><b>Source Metals</b>${renderMeltingSources(melting)}</span>
          <span><b>Target Purity</b>${formatPurity(melting.targetPurity)}</span>
          <span><b>Colour</b>${escapeHtml(melting.colour || "-")}</span>
          <span><b>Department</b>${escapeHtml(melting.departmentName || "-")}</span>
          <span><b>Pure Gold</b>${gram(melting.pureGold)}</span>
          <span><b>Final Issued</b>${gram(melting.finalWeight)}</span>
        </div>
      </div>
    </article>
    <article class="history-item">
      <div class="history-step">2</div>
      <div class="history-body">
        <div class="history-title"><strong>Receive & Loss</strong><span>${escapeHtml(melting.receivedDate || "-")}</span></div>
        <div class="history-grid">
          <span><b>Casting Item</b>${gram(breakup.castingItemWeight)}</span>
          <span><b>Tree Cut</b>${gram(breakup.treeCutWeight)}</span>
          <span><b>Wastage Received</b>${gram(breakup.wastageWeight)}</span>
          <span><b>Scrap / Dust</b>${gram(breakup.scrapDustWeight)}</span>
          <span><b>Other Received</b>${gram(breakup.otherReceivedWeight)}</span>
          <span><b>Total Received</b>${gram(melting.receivedWeight)}</span>
          <span><b>Loss Booked</b>${gram(melting.meltingLoss)}</span>
        </div>
      </div>
    </article>
  `;
  document.getElementById("melting-view-dialog").showModal();
}

function updateMeltingReceiveLoss() {
  const form = document.getElementById("melting-receive-form");
  const finalWeight = Number(form.finalWeight.value || 0);
  const receivedWeight = meltingReceiveWeightFields()
    .reduce((total, field) => total + Number(form[field].value || 0), 0);
  form.receivedWeight.value = weight3(receivedWeight);
  form.meltingLoss.value = weight3(Math.max(finalWeight - receivedWeight, 0));
}

function meltingReceiveWeightFields() {
  return ["castingItemWeight", "treeCutWeight", "wastageWeight", "scrapDustWeight", "otherReceivedWeight"];
}

function getMeltingReceiveBreakup(data) {
  return {
    castingItemWeight: Number(data.castingItemWeight || 0),
    treeCutWeight: Number(data.treeCutWeight || 0),
    wastageWeight: Number(data.wastageWeight || 0),
    scrapDustWeight: Number(data.scrapDustWeight || 0),
    otherReceivedWeight: Number(data.otherReceivedWeight || 0),
  };
}

function meltingReceiveBreakupText(breakup) {
  return [
    `item ${gram(breakup.castingItemWeight)}`,
    `tree ${gram(breakup.treeCutWeight)}`,
    `wastage ${gram(breakup.wastageWeight)}`,
    `scrap/dust ${gram(breakup.scrapDustWeight)}`,
    `other ${gram(breakup.otherReceivedWeight)}`,
  ].join(", ");
}

function meltingDepartment(name) {
  const selectedName = name || "Casting Department";
  const existing = state.karigars.find((department) =>
    department.name.toLowerCase() === selectedName.toLowerCase()
    || department.speciality.toLowerCase() === selectedName.replace(" Department", "").toLowerCase()
  );
  return existing || { id: selectedName, name: selectedName };
}

function normalizeState(currentState) {
  currentState.schemaVersion = Math.max(Number(currentState.schemaVersion || 0), 2);
  currentState.nextOrder = currentState.nextOrder || 1004;
  currentState.nextLot = currentState.nextLot || 204;
  delete currentState.userPasswords;
  currentState.customers = currentState.customers || [];
  currentState.officeCustomers = currentState.officeCustomers || [];
  currentState.bills = (currentState.bills || []).map((bill, billIndex) => ({
    ...bill,
    id: bill.id || stableRecordId("bill", bill.lotId, bill.billNo, bill.jobNumber, billIndex),
    lotId: bill.lotId || "",
    jobNumber: bill.jobNumber || "",
    billNo: bill.billNo || "",
    billDate: bill.billDate || "",
    makingRate: Number(bill.makingRate || 0),
    officeMakingRate: Number(bill.officeMakingRate ?? bill.makingRate ?? 0),
    otherCharges: Number(bill.otherCharges || 0),
    manufacturingBillAmount: Number(bill.manufacturingBillAmount || bill.makingGold || 0),
    billAmount: Number(bill.billAmount || 0),
    netWeight: Number(bill.netWeight || 0),
    makingGold: Number(bill.makingGold || bill.billAmount || 0),
    manufacturingMakingGold: Number(bill.manufacturingMakingGold || bill.makingGold || 0),
    officeMakingGold: Number(bill.officeMakingGold || bill.billAmount || 0),
    items: (bill.items || []).map((item) => ({
      ...item,
      id: item.id || stableRecordId("bill-item", bill.id, bill.lotId, bill.billNo, bill.jobNumber, billIndex, item.orderId, item.productionNo),
      orderId: item.orderId || "",
      productionNo: item.productionNo || "",
      purity: item.purity || "",
      finalGw: Number(item.finalGw || 0),
      reducedWeight: Number(item.reducedWeight || 0),
      netWeight: Number(item.netWeight || 0),
      makingPercent: Number(item.makingPercent || 0),
      makingGold: Number(item.makingGold || 0),
      manufacturingMakingPercent: Number(item.manufacturingMakingPercent ?? item.makingPercent ?? 0),
      manufacturingMakingGold: Number(item.manufacturingMakingGold ?? item.makingGold ?? 0),
      officeMakingPercent: Number(item.officeMakingPercent ?? item.makingPercent ?? 0),
      officeMakingGold: Number(item.officeMakingGold ?? item.makingGold ?? 0),
      qcStatus: item.qcStatus || "Pending QC",
      qcDate: item.qcDate || "",
      officeStatus: item.officeStatus || "",
      hallmarkStatus: item.hallmarkStatus || "",
      hallmarkIssueDate: item.hallmarkIssueDate || "",
      hallmarkReceiveDate: item.hallmarkReceiveDate || "",
      holder: item.holder || "",
      salesTeam: item.salesTeam || "",
      salesIssueDate: item.salesIssueDate || "",
      saleStatus: item.saleStatus || "",
      saleDate: item.saleDate || "",
      soldCustomerId: item.soldCustomerId || "",
      soldCustomer: item.soldCustomer || "",
      huid1: item.huid1 || "",
      huid2: item.huid2 || "",
      huidUpdatedDate: item.huidUpdatedDate || "",
      blackBeads: item.blackBeads || "",
      moti: item.moti || "",
      spring: item.spring || "",
      otherDetails: item.otherDetails || "",
      officeDetailUpdatedDate: item.officeDetailUpdatedDate || "",
      reworkLotId: item.reworkLotId || "",
      reworkLotNumber: item.reworkLotNumber || "",
      discardStatus: item.discardStatus || "",
      discardDate: item.discardDate || "",
      discardReason: item.discardReason || "",
      discardMeltingId: item.discardMeltingId || "",
    })),
    remarks: bill.remarks || "",
  }));
  currentState.designs = (currentState.designs || []).map((design, designIndex) => {
    const designId = design.id || stableRecordId("design", design.number, design.name, design.category, designIndex);
    const stoneItems = (design.stoneItems || []).map((item, stoneIndex) => ({
      ...item,
      id: item.id || stableRecordId("design-stone", designId, item.code, item.stoneType, item.shape, item.size, stoneIndex),
      stoneType: item.stoneType || "",
      shape: item.shape || "",
      size: item.size || "",
      code: item.code || stoneLookupCode(item),
      pcs: Number(item.pcs || 0),
      weightPerPc: formatStoneWeight(item.weightPerPc),
      totalWeight: item.totalWeight || totalStoneWeight(item.weightPerPc, item.pcs),
    }));
    return {
      ...design,
      id: designId,
      number: design.number || "",
      name: design.name || "",
      category: design.category || "",
      imageData: design.imageData || "",
      stoneDetails: stoneItems.length ? designStoneDetailsText(stoneItems) : design.stoneDetails || "",
      stoneItems,
      hasStoneChart: Boolean(design.hasStoneChart),
    };
  });
  if (!Array.isArray(currentState.stones) || (!currentState.stones.length && !currentState.stoneLibrarySeeded)) {
    currentState.stones = defaultStoneLibrary();
    currentState.stoneLibrarySeeded = true;
  } else {
    currentState.stones = currentState.stones.map(normalizeStone);
    currentState.stoneLibrarySeeded = Boolean(currentState.stoneLibrarySeeded);
  }
  currentState.stoneOptions = {
    stoneType: currentState.stoneOptions?.stoneType || [],
    shape: currentState.stoneOptions?.shape || [],
    size: currentState.stoneOptions?.size || [],
  };
  currentState.melting = (currentState.melting || []).map((item) => ({
    ...item,
    sourcePurity: purityPercent(item.sourcePurity),
    targetPurity: purityPercent(item.targetPurity),
    departmentId: item.departmentId || "",
    departmentName: item.departmentName || "",
    status: item.status || "Issued",
    receivedWeight: Number(item.receivedWeight || 0),
    meltingLoss: Number(item.meltingLoss || 0),
    receiveBreakup: item.receiveBreakup || null,
    sourceType: item.sourceType || "",
    sourceLotId: item.sourceLotId || "",
    sourceJobNumber: item.sourceJobNumber || "",
    sourceProductionNo: item.sourceProductionNo || "",
    discardReason: item.discardReason || "",
    sourceMetals: item.sourceMetals?.length
      ? item.sourceMetals.map((metal, index) => ({
        ...metal,
        id: metal.id || stableRecordId("source-metal", item.id, index, metal.weight, metal.purity),
        weight: Number(metal.weight || 0),
        purity: purityPercent(metal.purity),
      }))
      : [{
        id: stableRecordId("source-metal", item.id, 0, item.sourceWeight, item.sourcePurity),
        weight: Number(item.sourceWeight || 0),
        purity: purityPercent(item.sourcePurity),
      }],
  }));
  currentState.orders = currentState.orders || [];
  currentState.orders.forEach((order, orderIndex) => {
    order.id = order.id || stableRecordId("order", order.productionNo, order.number, order.jobNumber, orderIndex);
    order.designId = order.designId || "";
    const design = currentState.designs.find((item) => item.id === order.designId);
    order.designNumber = design ? designText(design) : order.designNumber || "";
    order.category = order.category || design?.category || "";
    order.size = order.size || "";
    order.ringType = order.ringType || "";
    order.clSize = order.clSize || order.size || "";
    order.cgSize = order.cgSize || "";
    order.color = order.color || "";
    order.remarks = order.remarks || "";
    order.productionNo = order.productionNo || order.number || `PR-${currentState.nextOrder++}`;
    order.barcode = order.barcode || order.productionNo;
    order.jobNumber = order.jobNumber || order.productionNo;
    order.orderDate = order.orderDate || isoToday();
    const savedProductionDays = Number(order.productionDays ?? daysBetween(order.orderDate, order.dueDate));
    order.productionDays = normalizeProductionDays(savedProductionDays);
    order.dueDate = (!order.dueDate || savedProductionDays !== order.productionDays)
      ? calculateDueDate(order.orderDate, order.productionDays)
      : order.dueDate;
    order.urgent = Boolean(order.urgent);
    order.productionStoneItems = (order.productionStoneItems || []).map((item, stoneIndex) => {
      const matchedDesignStone = design?.stoneItems?.find((stoneItem) =>
        item.sourceDesignStoneId === stoneItem.id ||
        (item.code && item.code === stoneItem.code) ||
        (item.stoneType === stoneItem.stoneType && item.shape === stoneItem.shape && item.size === stoneItem.size)
      );
      const automaticSetting = automaticProductionStoneSetting(matchedDesignStone || item);
      return {
        ...item,
        id: item.id || stableRecordId("production-stone", order.id, item.code, item.sourceDesignStoneId, stoneIndex),
        sourceDesignStoneId: item.sourceDesignStoneId || matchedDesignStone?.id || "",
        date: item.date || today(),
        settingType: item.settingType || automaticSetting.settingType,
        manufacturingStage: item.manufacturingStage || automaticSetting.manufacturingStage,
        stoneType: item.stoneType || matchedDesignStone?.stoneType || "",
        shape: item.shape || matchedDesignStone?.shape || "",
        size: item.size || matchedDesignStone?.size || "",
        code: item.code || matchedDesignStone?.code || stoneLookupCode(item),
        pcs: Number(item.pcs || matchedDesignStone?.pcs || 0),
        weightPerPc: formatStoneWeight(item.weightPerPc || matchedDesignStone?.weightPerPc),
        totalWeight: item.totalWeight || matchedDesignStone?.totalWeight || totalStoneWeight(item.weightPerPc, item.pcs),
      };
    });
    if (!order.customerId && order.customer) {
      let customer = currentState.customers.find((item) => item.name.toLowerCase() === order.customer.toLowerCase());
      if (!customer) {
        customer = { id: stableRecordId("customer", order.customer), name: order.customer, phone: "", city: "", gst: "", address: "" };
        currentState.customers.push(customer);
      }
      order.customerId = customer.id;
    }
  });
  migrateCbBothRingOrders(currentState);
  currentState.lots = (currentState.lots || []).map((lot, lotIndex) => normalizeLotIssueWeights(currentState, lot, lotIndex));
  currentState.lots.forEach((lot) => {
    const bill = currentState.bills.find((item) => item.lotId === lot.id);
    if (bill) lot.bill = bill;
  });
  currentState.karigars = currentState.karigars || [];
  currentState.ledger = currentState.ledger || [];
  applyWaxStoneIssueLedgerMigration(currentState);
  return currentState;
}

function normalizeLotIssueWeights(currentState, lot, lotIndex) {
  const orderIds = lot.orderIds?.length ? lot.orderIds : [lot.orderId].filter(Boolean);
  const transfers = lot.transfers || [];
  const firstTransfer = transfers[0] || {};
  const bill = lot.bill || (currentState.bills || []).find((item) => item.lotId === lot.id);
  const productionStockWeight = lot.productionStockWeight !== undefined
    ? Number(lot.productionStockWeight || 0)
    : bill?.items?.length
      ? Number(weight3(bill.items
        .filter((item) => item.qcStatus !== "QC OK")
        .reduce((total, item) => total + Number(item.netWeight || item.finalGw || 0), 0)))
      : Number(lot.finishedWeight || 0);
  const waxStoneWeight = Number(lot.waxStoneWeight || lotWaxStoneWeight(currentState, orderIds));
  const hasGrossIssue = lot.grossIssuedWeight !== undefined && lot.grossIssuedWeight !== null;
  const grossIssuedWeight = Number(hasGrossIssue ? lot.grossIssuedWeight : Number(lot.issuedWeight || 0));
  const issuedWeight = hasGrossIssue
    ? Number(lot.issuedWeight || 0)
    : Number(weight3(Math.max(grossIssuedWeight - waxStoneWeight, 0)));
  return {
    transfers: [],
    ...lot,
    id: lot.id || stableRecordId("lot", lot.number, lot.orderId, lot.issueDate, lotIndex),
    orderIds,
    issueKarigarId: lot.issueKarigarId || firstTransfer.fromKarigarId || lot.karigarId || "",
    issueKarigarName: lot.issueKarigarName || firstTransfer.fromKarigarName || lot.karigarName || "",
    issueDepartment: mergedProductionDepartmentName(lot.issueDepartment || firstTransfer.fromDepartment || lot.currentDepartment || lot.karigarName || ""),
    transfers: transfers.map((transfer, transferIndex) => ({
      ...transfer,
      id: transfer.id || stableRecordId("transfer", lot.id || lot.number, transfer.date, transfer.fromDepartment, transfer.toDepartment, transferIndex),
      grossReceivedWeight: transfer.grossReceivedWeight ?? transfer.receivedWeight ?? transfer.transferWeight ?? 0,
      waxStoneWeight: transfer.waxStoneWeight ?? waxStoneWeight,
      stoneWeight: transfer.stoneWeight ?? 0,
      handStoneWeight: transfer.handStoneWeight ?? transfer.stoneWeight ?? 0,
      reducedWeight: transfer.reducedWeight ?? Number(transfer.waxStoneWeight ?? waxStoneWeight) + Number(transfer.stoneWeight ?? 0),
      receivedWeight: transfer.receivedWeight ?? transfer.transferWeight ?? 0,
      departmentBalance: transfer.departmentBalance ?? 0,
      differencePurity: transfer.differencePurity || lot.metalPurity || currentState.orders.find((order) => orderIds.includes(order.id))?.purity || "",
      differenceFineGold: transfer.differenceFineGold ?? fineGoldWeight(transfer.departmentBalance ?? 0, transfer.differencePurity || lot.metalPurity || currentState.orders.find((order) => orderIds.includes(order.id))?.purity || 0),
      balanceDepartment: mergedProductionDepartmentName(transfer.balanceDepartment || transfer.fromDepartment || ""),
      fromDepartment: mergedProductionDepartmentName(transfer.fromDepartment || ""),
      toDepartment: mergedProductionDepartmentName(transfer.toDepartment || ""),
    })),
    currentDepartment: mergedProductionDepartmentName(lot.currentDepartment || lot.karigarName || ""),
    issueDate: lot.issueDate || "",
    grossIssuedWeight,
    waxStoneWeight,
    issuedWeight,
    productionStockWeight,
  };
}

function lotWaxStoneWeight(currentState, orderIds = []) {
  const orders = orderIds.map((id) => currentState.orders.find((order) => order.id === id)).filter(Boolean);
  return productionStoneTotalsForOrderList(currentState, orders, "wax").weight;
}

function productionStoneTotalsForOrderList(currentState, orders = [], settingType = "") {
  return productionStoneTotals(orders.flatMap((order) => productionStoneItemsForStateOrder(currentState, order)), settingType);
}

function productionStoneItemsForStateOrder(currentState, order) {
  if (order.productionStoneItems?.length) return order.productionStoneItems;
  const design = currentState.designs.find((item) => item.id === order.designId);
  return (design?.stoneItems || []).map((item) => {
    const automaticSetting = automaticProductionStoneSetting(item);
    return {
      settingType: automaticSetting.settingType,
      pcs: Number(item.pcs || 0),
      totalWeight: item.totalWeight || totalStoneWeight(item.weightPerPc, item.pcs),
    };
  });
}

function applyWaxStoneIssueLedgerMigration(currentState) {
  currentState.ledger = (currentState.ledger || []).map((entry) => {
    if (entry.type !== "Out") return entry;
    const lot = currentState.lots.find((item) =>
      item.number && String(entry.reference || "").includes(item.number)
    );
    if (!lot || !Number(lot.waxStoneWeight || 0)) return entry;
    const cleanReference = String(entry.reference || lot.number)
      .split("; Gold Issue")[0]
      .split("; gross")[0];
    return {
      ...entry,
      weight: Number(lot.issuedWeight || entry.weight || 0),
      waxStoneAdjusted: true,
      reference: `${cleanReference}; Gold Issue ${gram(lot.grossIssuedWeight || lot.issuedWeight)} - Wax Stone ${gram(lot.waxStoneWeight)} = Net Wt ${gram(lot.issuedWeight)}`,
    };
  });
}

function migrateCbBothRingOrders(currentState) {
  const usedCodes = new Set(currentState.orders.flatMap((order) => [order.number, order.productionNo, order.barcode]).filter(Boolean));
  const splitOrders = [];
  const splitPairs = [];
  currentState.orders.forEach((order) => {
    if (!isCbCategory(order.category) || order.ringType !== "CL+CG") return;
    const cgProductionNo = nextProductionNumber(currentState, usedCodes);
    const cgOrder = {
      ...order,
      id: stableRecordId("cb-split", order.id, cgProductionNo),
      number: cgProductionNo,
      productionNo: cgProductionNo,
      barcode: cgProductionNo,
      ringType: "CG",
      size: order.cgSize || order.size || "",
      clSize: "",
      cgSize: order.cgSize || order.size || "",
      cbSplitFrom: order.id,
    };
    order.ringType = "CL";
    order.size = order.clSize || order.size || "";
    order.clSize = order.clSize || order.size || "";
    order.cgSize = "";
    order.cbSplitFrom = order.cbSplitFrom || "";
    splitOrders.push(cgOrder);
    splitPairs.push({ fromId: order.id, toId: cgOrder.id });
  });
  if (!splitOrders.length) return;
  currentState.orders.push(...splitOrders);
  (currentState.lots || []).forEach((lot) => {
    const ids = lot.orderIds?.length ? [...lot.orderIds] : [lot.orderId].filter(Boolean);
    splitPairs.forEach(({ fromId, toId }) => {
      if (ids.includes(fromId) && !ids.includes(toId)) ids.push(toId);
    });
    lot.orderIds = ids;
    const lotOrders = currentState.orders.filter((order) => ids.includes(order.id));
    if (lotOrders.length) lot.orderNumber = lotOrders.map((order) => order.number).join(", ");
  });
}

function nextProductionNumber(currentState, usedCodes) {
  let productionNo = "";
  do {
    productionNo = `PR-${currentState.nextOrder++}`;
  } while (usedCodes.has(productionNo));
  usedCodes.add(productionNo);
  return productionNo;
}

function defaultStoneLibrary() {
  return (window.KJM_STONE_LIBRARY || []).map((stone, index) => normalizeStone({
    ...stone,
    id: stone.id || stableRecordId("stone", stone.code, stone.stoneType, stone.shape, stone.size, index),
  }));
}

function normalizeStone(stone, index = 0) {
  return {
    ...stone,
    id: stone.id || stableRecordId("stone", stone.code, stone.stoneType, stone.shape, stone.size, index),
    stoneType: stone.stoneType || "",
    shape: stone.shape || "",
    size: stone.size || "",
    code: stone.code || stoneLookupCode(stone),
    weightPerPc: formatStoneWeight(stone.weightPerPc),
    pricePerPc: stone.pricePerPc || "",
    remarks: stone.remarks || "",
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

applyLoginState();
render();
setDefaultOrderDates(document.getElementById("order-form"));
resetOrderItemRows();
resetMeltingSources();
updateMeltingCalculation();
initializeSupabase();
