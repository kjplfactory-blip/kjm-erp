const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const weight3 = (value) => Number(value || 0).toFixed(3);
const weight5 = (value) => Number(value || 0).toFixed(5);
const gram = (value) => `${weight3(value)} g`;
const optionalGram = (value) => Number(value || 0) > 0 ? gram(value) : "-";
const today = () => new Date().toLocaleDateString("en-IN");
const isoToday = () => new Date().toISOString().slice(0, 10);
const APP_VERSION = "v240";
const FACTORY_RESET_STOCK_WEIGHT = 4000;
const FACTORY_RESET_STOCK_PURITY = "99.5%";
const FACTORY_RESET_PROTECTION_MS = 10 * 60 * 1000;
const FACTORY_RESET_LOCK_KEY = "gold-jewellery-erp-reset-lock-until";
const FACTORY_RESET_MARKER_KEY = "gold-jewellery-erp-factory-reset-at";
const FACTORY_RESET_REASON = "Clear job cards + reset factory stock";
const DESIGN_IMAGE_WIDTH = 1200;
const DESIGN_IMAGE_HEIGHT = 1800;
const DESIGN_IMAGE_ASPECT_TEXT = "4x6";
const supabaseSettings = window.KJM_SUPABASE || {};
const supabaseStateId = supabaseSettings.stateId || "khushali-jewells-main";
const AUTO_SYNC_INTERVAL_MS = 3000;
const SUPABASE_RECONNECT_INTERVAL_MS = 15000;
const SUPABASE_SAVE_DELAY_MS = 300;
const SUPABASE_REQUEST_TIMEOUT_MS = 12000;
const MAX_PRODUCTION_DAYS = 10;
const SAFE_LOCKERS = ["9K", "14K", "18K", "22K"];
const DEFAULT_STONE_ITEM_KEY = "GENERAL";
const STONE_ITEM_PRESETS = [
  ["GENERAL", "General"],
  ["LR", "LR - Ladies Ring"],
  ["GR", "GR - Gents Ring"],
  ["CL", "CL - Ladies Ring"],
  ["CG", "CG - Gents Ring"],
  ["CLR", "CLR - CBR Ladies Ring"],
  ["CGR", "CGR - CBR Gents Ring"],
  ["CM", "CM - Chams"],
  ["CMB", "CMB - Chams Bracelet"],
  ["CME", "CME - Chams Ear Rings"],
];
const CM_ITEM_KEYS = ["CM", "CME", "CMB"];
let supabaseClient = null;
let supabaseSaveTimer = null;
let supabaseAutoRefreshTimer = null;
let supabaseReconnectTimer = null;
let supabaseRealtimeChannel = null;
let supabasePendingCloudState = null;
let supabaseIsConnecting = false;
let supabaseIsSaving = false;
let supabaseIsLoading = false;
let supabaseLastCloudUpdatedAt = "";
let supabaseLastLocalChangeAt = 0;
let factoryResetLockUntil = Number(localStorage.getItem(FACTORY_RESET_LOCK_KEY) || 0);
let localFactoryResetAt = localStorage.getItem(FACTORY_RESET_MARKER_KEY) || "";
let selectedDesignIds = new Set();

const users = {
  owner: { name: "Owner", password: "owner123", role: "owner", pages: "all" },
  order: { name: "Order Dept", password: "order123", role: "order", pages: ["customers", "designs", "stone-library", "orders"] },
  manager: { name: "Manager Dept", password: "manager123", role: "manager", pages: ["dashboard", "customers", "designs", "stone-library", "orders", "melting", "production", "billing", "safe", "factory"] },
  bill: { name: "Bill Dept", password: "bill123", role: "bill", pages: ["billing"] },
  qc: { name: "QC Dept", password: "qc123", role: "qc", pages: ["billing"], qcOnly: true },
  officeMain: { name: "Office Main Dept", password: "office123", role: "office-main", pages: ["orders", "billing", "office"], canEditOfficeWeights: true },
  officeOps: { name: "Office Operations", password: "ops123", role: "office-ops", pages: ["orders", "office"], canEditOfficeWeights: false },
  sales1: { name: "Sales Team 1", password: "sales1123", role: "sales", pages: ["office"], salesTeam: "Sales Team 1" },
  sales2: { name: "Sales Team 2", password: "sales2123", role: "sales", pages: ["office"], salesTeam: "Sales Team 2" },
  sales3: { name: "Sales Team 3", password: "sales3123", role: "sales", pages: ["office"], salesTeam: "Sales Team 3" },
  sales4: { name: "Sales Team 4", password: "sales4123", role: "sales", pages: ["office"], salesTeam: "Sales Team 4" },
};

const defaultUserPasswords = Object.fromEntries(Object.entries(users).map(([id, user]) => [id, user.password]));

const loginAccessPages = [
  "dashboard",
  "customers",
  "designs",
  "stone-library",
  "orders",
  "melting",
  "production",
  "billing",
  "office",
  "safe",
  "factory",
  "stock",
  "karigars",
  "transfer-history",
  "reports",
];

const demoState = {
  nextOrder: 1001,
  nextLot: 201,
  userPasswords: defaultUserPasswords,
  customUsers: [],
  userAccessOverrides: {},
  customers: [],
  officeCustomers: [],
  vendors: [],
  factoryLedger: [{
    id: "factory-default-factory-ledger",
    date: today(),
    direction: "in",
    type: "Opening Stock",
    vendorId: "",
    vendorName: "Opening Stock",
    materialType: "raw-metal",
    purity: FACTORY_RESET_STOCK_PURITY,
    weight: FACTORY_RESET_STOCK_WEIGHT,
    wstgPercent: 0,
    wastagePercent: 0,
    baseFineGold: fineGoldWeight(FACTORY_RESET_STOCK_WEIGHT, FACTORY_RESET_STOCK_PURITY),
    wstgFineGold: 0,
    fineGold: fineGoldWeight(FACTORY_RESET_STOCK_WEIGHT, FACTORY_RESET_STOCK_PURITY),
    stockPosting: "Metal Safe",
    reference: "Factory opening stock",
    sourceType: "factory-default",
    sourceId: "factory-default-ledger",
  }],
  designs: [],
  stones: [],
  bills: [],
  safeItems: [],
  metalSafeMovements: [{
    id: "factory-default-metal-safe",
    date: today(),
    type: "Opening Stock",
    direction: "in",
    purity: FACTORY_RESET_STOCK_PURITY,
    weight: FACTORY_RESET_STOCK_WEIGHT,
    reference: "Factory opening stock",
    sourceType: "factory-default",
    sourceId: "factory-default-ledger",
  }],
  metalSafeSeededFromLedger: true,
  stoneOptions: { stoneType: [], shape: [], size: [] },
  stoneLibrarySeeded: false,
  orders: [],
  lots: [],
  melting: [],
  karigars: [
    { id: crypto.randomUUID(), name: "Casting Department", speciality: "Casting", processes: ["Casting"], rate: 720 },
    { id: crypto.randomUUID(), name: "Setting Department", speciality: "Stone setting", processes: ["Stone setting"], rate: 650 },
    { id: crypto.randomUUID(), name: "Polishing Department", speciality: "Polishing", processes: ["Polishing"], rate: 280 },
  ],
  ledger: [
    { id: "factory-default-ledger", date: today(), type: "In", purity: FACTORY_RESET_STOCK_PURITY, weight: FACTORY_RESET_STOCK_WEIGHT, reference: "Factory opening stock" },
  ],
};

let state = loadState();
let currentUser = loadCurrentUser();
let stoneLibraryPage = 1;
const stoneLibraryPageSize = 100;
let selectedStoneChartFiles = [];
let stoneEntryReturnContext = null;
let stoneCropReturnContext = null;
const stoneCropState = {
  files: [],
  sourceIndex: 0,
  image: null,
  imageData: "",
  rect: null,
  dragging: false,
  start: null,
  canvasScale: 1,
};

const pageInfo = {
  dashboard: ["Dashboard", "Track raw gold, production stock, office stock, orders, wastage, and finished jewellery separately."],
  customers: ["Customers", "Add, edit, and manage customer details."],
  designs: ["Designs", "Upload and manage jewellery designs for stock and customer orders."],
  "stone-library": ["Stone Library", "Master list of stone type, size, weight per pc, and price per pc."],
  orders: ["Job Orders", "Create and monitor customer jewellery manufacturing orders."],
  production: ["Production", "Issue gold to departments and complete finished lots."],
  billing: ["Bill", "Create bills for completed job cards."],
  office: ["Office", "Track only QC OK stock, hallmarking, sales holding, and sold items."],
  safe: ["Safe Locker", "Track item lockers by purity and raw metal safe inventory."],
  factory: ["Factory In / Out", "Receive vendor metal, track bill outward, vendor balances, and total factory fine stock."],
  stock: ["Raw Gold Stock", "Maintain only raw gold movement ledger. Production stock and office stock are separate."],
  melting: ["Melting", "Convert source gold into desired purity and colour."],
  karigars: ["Departments", "Manage department master data and process rates."],
  "transfer-history": ["Transfer History", "Online one-line history for every lot transfer."],
  reports: ["Reports", "Review wastage, making charges, and completed orders."],
  users: ["Login Details", "Owner can retrieve and change user passwords."],
};

const operationTileConfigs = {
  customers: [
    { id: "add", title: "Add Customer", description: "Create or edit customer details", selector: "#customer-form" },
    { id: "master", title: "Customer Master", description: "Search and manage customers", selector: "#customers .table-panel" },
  ],
  safe: [
    { id: "items", title: "Item Safe Lockers", description: "View 9K, 14K, 18K, 22K item lockers", selector: ".safe-locker-panel" },
    { id: "metal", title: "Metal Safe / Office In", description: "Receive raw metal and view metal safe ledger", selector: ".metal-safe-panel" },
  ],
  factory: [
    { id: "summary", title: "Factory Summary", description: "Total factory fine stock, factory in/out, and vendor balance", selector: "#factory-summary-grid" },
    { id: "vendor", title: "Vendor Master", description: "Add or edit vendor and party details", selector: "#vendor-form" },
    { id: "in", title: "Factory In", description: "Add vendor metal or other stock into factory", selector: "#factory-in-form" },
    { id: "out", title: "Factory Out", description: "Send bill, metal, rod, wastage, or stock out of factory", selector: "#factory-out-form" },
    { id: "vendors", title: "Vendor Balance", description: "Check current payable or receivable metal by party", selector: ".vendor-balance-panel" },
    { id: "ledger", title: "Factory Ledger", description: "View every factory in and bill factory out entry", selector: ".factory-ledger-panel" },
  ],
  stock: [
    { id: "add", title: "Add Raw Gold", description: "Receive raw gold into metal safe", selector: "#stock-form" },
    { id: "ledger", title: "Raw Gold Ledger", description: "View raw gold stock movements", selector: "#stock .table-panel" },
  ],
  melting: [
    { id: "dashboard", title: "Melting Dashboard", description: "Metal with melting/casting and loss summary", selector: ".melting-dashboard-panel" },
    { id: "conversion", title: "Melting Conversion", description: "Issue metal, rod, or wastage for melting/casting", selector: "#melting-conversion-page" },
    { id: "history", title: "Melting / Casting History", description: "Open history tiles for view, edit, receive, or delete", selector: ".melting-history-panel" },
  ],
  karigars: [
    { id: "add", title: "Add Department", description: "Owner can add or edit department master", selector: "#karigar-form" },
    { id: "master", title: "Department Master", description: "View departments, processes, and metal in hand", selector: "#karigars .table-panel" },
  ],
  reports: [
    { id: "summary", title: "Reports Summary", description: "View wastage, department difference, charges, and completed orders", selector: "#reports .report-grid" },
  ],
  users: [
    { id: "login", title: "Login Details", description: "Owner can add users and change passwords", selector: "#users .login-user-panel" },
  ],
  billing: [
    { id: "bill", title: "Bill / Packing", description: "Open completed job cards for bill, QC, and packing list", selector: "#billing .table-panel" },
  ],
  "transfer-history": [
    { id: "history", title: "Online Transfer History", description: "View all lot movement in one table", selector: "#transfer-history .table-panel" },
    { id: "department", title: "Department Wise History", description: "Open each department to view IN and OUT entries", selector: ".department-transfer-panel" },
  ],
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

function initializeOperationTiles() {
  Object.entries(operationTileConfigs).forEach(([viewId, operations]) => {
    const section = document.getElementById(viewId);
    if (!section || section.querySelector(".operation-tile-grid")) return;
    const tileGrid = document.createElement("div");
    tileGrid.className = `tile-grid operation-tile-grid ${viewId}-operation-tiles`;
    tileGrid.innerHTML = operations.map((operation) => `
      <button class="action-tile" type="button" data-operation-view="${escapeHtml(viewId)}" data-operation-page="${escapeHtml(operation.id)}">
        <strong>${escapeHtml(operation.title)}</strong>
        <span>${escapeHtml(operation.description)}</span>
      </button>
    `).join("");
    const dashboard = section.querySelector(".operation-dashboard");
    section.insertBefore(tileGrid, dashboard ? dashboard.nextSibling : section.firstElementChild);
    operations.forEach((operation) => {
      const target = section.querySelector(operation.selector);
      if (!target) return;
      target.classList.add("operation-page");
      target.dataset.operationPage = operation.id;
    });
  });
  document.querySelectorAll("[data-operation-view][data-operation-page]").forEach((button) => {
    button.addEventListener("click", () => openOperationPage(button.dataset.operationView, button.dataset.operationPage));
  });
}

function openOperationPage(viewId, pageId) {
  const section = document.getElementById(viewId);
  if (!section) return;
  section.classList.add("operation-open");
  section.querySelectorAll("[data-operation-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.operationPage === pageId);
  });
  section.querySelectorAll(".operation-page").forEach((page) => {
    const isActivePage = page.dataset.operationPage === pageId;
    page.classList.toggle("active-operation-page", isActivePage);
    page.hidden = !isActivePage;
  });
  refreshOperationPage(viewId, pageId);
}

function refreshOperationPage(viewId, pageId) {
  if (viewId === "melting") renderMelting();
  if (viewId === "safe") renderSafe();
  if (viewId === "factory") renderFactory();
  if (viewId === "stock" && pageId === "ledger") renderLedger();
  if (viewId === "customers" && pageId === "master") renderCustomers();
  if (viewId === "karigars" && pageId === "master") renderKarigars();
  if (viewId === "billing" && pageId === "bill") renderBills();
  if (viewId === "transfer-history" && pageId === "history") renderOnlineTransferHistory();
  if (viewId === "transfer-history" && pageId === "department") renderDepartmentTransferHistoryBoard();
  if (viewId === "reports" && pageId === "summary") renderReports();
  if (viewId === "users" && pageId === "login") renderLoginUsers();
}

function resetOperationPage(viewId) {
  const section = document.getElementById(viewId);
  if (!section || !operationTileConfigs[viewId]) return;
  section.classList.remove("operation-open");
  section.querySelectorAll("[data-operation-view]").forEach((button) => button.classList.remove("active"));
  section.querySelectorAll(".operation-page").forEach((page) => {
    page.classList.remove("active-operation-page");
    page.hidden = true;
  });
}

function resetBuiltInTilePage(view) {
  if (view === "orders") switchOrderPage("");
  if (view === "designs") switchDesignPage("");
  if (view === "stone-library") switchStonePage("");
  if (view === "production") switchProductionPage("");
  if (view === "office") clearOfficePages();
  resetOperationPage(view);
}

function openDefaultOperationPage(view) {
}

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

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.defaultPrevented) return;
  const target = event.target;
  if (!target || target.closest("button, a, [role='button']")) return;
  if (target.tagName === "TEXTAREA" || target.isContentEditable) return;
  const form = target.closest("form");
  if (!form) return;
  if (["INPUT", "SELECT"].includes(target.tagName)) event.preventDefault();
}, true);

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
document.getElementById("stone-entry-dialog").addEventListener("close", restoreStoneEntryReturnContext);
document.getElementById("crop-stone-chart").addEventListener("click", openStoneCropDialog);
document.getElementById("assign-stone-charts").addEventListener("click", async () => {
  await assignSelectedStoneChartFiles();
});
document.getElementById("close-stone-crop").addEventListener("click", () => {
  document.getElementById("stone-crop-dialog").close();
});
document.getElementById("stone-crop-dialog").addEventListener("close", restoreStoneCropReturnContext);
document.getElementById("stone-crop-source").addEventListener("change", async (event) => {
  await loadStoneCropSource(Number(event.target.value || 0));
});
document.getElementById("stone-crop-design").addEventListener("change", () => {
  updateStoneCropItemOptions();
});
document.getElementById("stone-crop-reupload").addEventListener("change", async (event) => {
  await reuploadStoneCropImage(event.target.files?.[0]);
});
document.getElementById("auto-detect-stone-chart").addEventListener("click", () => {
  autoDetectCurrentStoneCrop(true);
});
document.getElementById("manual-stone-crop").addEventListener("click", () => {
  startManualStoneCrop();
});
document.getElementById("reset-stone-crop").addEventListener("click", () => {
  resetStoneCropSelection();
});
document.getElementById("save-cropped-stone-chart").addEventListener("click", async () => {
  await saveStoneCropToDesign(false);
});
document.getElementById("read-cropped-stone-chart").addEventListener("click", async () => {
  await saveStoneCropToDesign(true);
});
const stoneCropCanvas = document.getElementById("stone-crop-canvas");
stoneCropCanvas.addEventListener("pointerdown", startStoneCropSelection);
stoneCropCanvas.addEventListener("pointermove", moveStoneCropSelection);
stoneCropCanvas.addEventListener("pointerup", finishStoneCropSelection);
stoneCropCanvas.addEventListener("pointerleave", finishStoneCropSelection);
window.addEventListener("resize", () => {
  if (stoneCropState.image) fitStoneCropCanvas();
});

document.getElementById("show-login-details").addEventListener("click", () => {
  const password = prompt("Enter Owner password to view login details:");
  if (password !== userPassword("owner")) {
    alert("Wrong Owner password.");
    return;
  }
  renderLoginDetailsList();
  document.getElementById("login-details-list").classList.toggle("hidden");
});

document.getElementById("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const user = allUsers()[data.user];
  if (!user || userPassword(data.user) !== data.password) {
    document.getElementById("login-error").textContent = "Wrong user or password.";
    return;
  }

  currentUser = {
    id: data.user,
    name: user.name,
    role: user.role,
    salesTeam: user.salesTeam || "",
  };
  localStorage.setItem("gold-jewellery-erp-user", JSON.stringify(currentUser));
  document.getElementById("login-error").textContent = "";
  event.target.reset();
  applyLoginState();
});

document.getElementById("logout").addEventListener("click", () => {
  currentUser = null;
  localStorage.removeItem("gold-jewellery-erp-user");
  applyLoginState();
});

document.getElementById("refresh-live-data").addEventListener("click", refreshLiveData);
document.getElementById("push-live-data")?.addEventListener("click", pushLocalDataToCloud);

document.getElementById("reset-demo").addEventListener("click", async (event) => {
  if (!isOwner()) {
    alert("Only Owner can reset data.");
    return;
  }
  const masterPassword = prompt("Enter master password to clear job cards:");
  if (masterPassword !== "Khushali@9294") {
    alert("Wrong master password. Job cards were not cleared.");
    return;
  }
  if (!confirm("This will clear all job cards, production, bills, melting/casting history, safe locker stock, and old factory stock.\n\nIt will then create fresh factory stock: 4000.000 g of 99.5% gold.\n\nCustomer, design, stone, department, and user masters will remain.")) return;
  event.currentTarget.disabled = true;
  try {
    const cloudSaved = await resetFactoryData();
    if (cloudSaved) {
      alert("Reset done. Job cards and melting/casting are cleared. Factory gold stock is now 4000.000 g of 99.5% gold, and live sync is updated.");
    } else {
      alert("Reset done on this laptop. Live sync could not be updated, so other laptops may still show old data.\n\nRun RESET-JOB-CARDS-AND-FACTORY-STOCK.sql in Supabase, or fix sync and click Upload This Laptop Data.");
    }
  } finally {
    event.currentTarget.disabled = false;
  }
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
      cmItemType: item.cmItemType,
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
  const stoneChartFiles = [...form.stoneChart.files];
  const uploadGroups = groupDesignUploadFiles(imageFiles);
  const status = document.getElementById("design-upload-status");
  const submitButton = document.getElementById("design-submit");
  if (!existing && imageFiles.length > 500) {
    alert("Please select maximum 500 design images at one time.");
    return;
  }
  submitButton.disabled = true;
  const previousDesigns = [...state.designs];
  const uploadCropPermission = createStoneCropUploadPermission();
  try {
    if (existing) {
      const group = uploadGroups.find((item) => designMatchKeys(existing).includes(item.key)) || uploadGroups[0];
      const imageFile = group?.designFile || imageFiles[0];
      const designName = group?.designName || designNameFromFile(imageFile?.name) || existing.number;
      const smartImageResult = imageFile && !isStoneChartUploadFile(imageFile.name)
        ? await saveDesignUploadImageAndAutoChart(existing, imageFile, { saveDesign: true, cropPermission: uploadCropPermission })
        : { chartAttached: false };
      const chartCandidates = [...(group?.chartFiles || []), ...stoneChartFiles];
      const matchingStoneChartFile = matchingStoneChartFileForDesign(chartCandidates, existing) || (stoneChartFiles.length === 1 ? stoneChartFiles[0] : null) || group?.chartFiles?.[0] || null;
      const matchingStoneChartResult = matchingStoneChartFile
        ? await saveStoneChartFileForDesign(existing, matchingStoneChartFile)
        : { itemSaved: false, sourceSaved: false };
      const design = {
        id: existing.id,
        number: data.number || designName,
        name: data.name || data.number || designName,
        category: data.category,
        stoneDetails: existing.stoneDetails || "",
        stoneItems: existing.stoneItems || [],
        stoneChartItems: existing.stoneChartItems || [],
        hasStoneChartSource: existing.hasStoneChartSource || matchingStoneChartResult.sourceSaved,
        stoneChartSourceName: existing.stoneChartSourceName || matchingStoneChartFile?.name || "",
        hasStoneChart: existing.hasStoneChart || matchingStoneChartResult.itemSaved || smartImageResult.chartAttached,
      };
      Object.assign(existing, design);
      updateDesignReferences(existing);
    } else {
      if (!imageFiles.length) {
        alert("Select one or more design images.");
        return;
      }
      let createdCount = 0;
      let updatedCount = 0;
      let matchedStoneCharts = 0;
      const duplicateGroups = [];
      for (const [index, group] of uploadGroups.entries()) {
        const designName = group.designName || designNameFromFile(group.designFile?.name) || `Design ${index + 1}`;
        status.textContent = `Uploading ${index + 1} of ${uploadGroups.length}: ${designName}`;
        const duplicateDesign = findDesignByUploadKey(group.key);
        if (duplicateDesign) {
          duplicateGroups.push({ group, existingDesign: duplicateDesign });
          continue;
        }
        const design = createDesignFromUploadGroup(group, data.category);
        state.designs.push(design);
        createdCount += 1;
        let chartAttachedForDesign = 0;
        if (group.designFile) {
          const smartImageResult = await saveDesignUploadImageAndAutoChart(design, group.designFile, { saveDesign: true, cropPermission: uploadCropPermission });
          chartAttachedForDesign = smartImageResult.chartAttached ? 1 : 0;
        }
        const chartCandidates = [...group.chartFiles, ...stoneChartFiles];
        const matchingStoneChartFile = matchingStoneChartFileForDesign(chartCandidates, design)
          || group.chartFiles[0]
          || (stoneChartFiles.length === 1 && uploadGroups.length === 1 ? stoneChartFiles[0] : null);
        if (matchingStoneChartFile) {
          const matchingStoneChartResult = await saveStoneChartFileForDesign(design, matchingStoneChartFile);
          chartAttachedForDesign = matchingStoneChartResult.sourceSaved || matchingStoneChartResult.itemSaved ? 1 : chartAttachedForDesign;
        }
        matchedStoneCharts += chartAttachedForDesign;
      }
      if (duplicateGroups.length) {
        const duplicateAction = chooseDuplicateDesignUploadAction(duplicateGroups);
        status.textContent = `Applying ${duplicateAction} to ${duplicateGroups.length} duplicate design(s).`;
        for (const { group, existingDesign } of duplicateGroups) {
          const result = await resolveDuplicateDesignUpload(group, existingDesign, data.category, stoneChartFiles, { cropPermission: uploadCropPermission, duplicateAction });
          updatedCount += result.updated;
          createdCount += result.created;
          matchedStoneCharts += result.chartAttached;
        }
      }
      const mergedImageCount = imageFiles.length - uploadGroups.length;
      status.dataset.uploadSummary = `${createdCount} design(s) created, ${updatedCount} existing/duplicate design(s) handled. ${mergedImageCount} extra image(s) merged into matching designs. ${matchedStoneCharts} stone chart(s) attached.`;
    }
    form.reset();
    resetDesignForm();
    saveState();
    render();
    status.textContent = existing
      ? "Design updated. Matching design/chart images were merged."
      : status.dataset.uploadSummary || `${imageFiles.length} design image(s) uploaded. Matching stone sheet names were assigned automatically.`;
    delete status.dataset.uploadSummary;
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
document.getElementById("design-select-all").addEventListener("click", selectAllDesigns);
document.getElementById("design-select-visible").addEventListener("click", selectVisibleDesigns);
document.getElementById("design-clear-selection").addEventListener("click", clearDesignSelection);
document.getElementById("design-auto-crop-existing").addEventListener("click", autoCropExistingDesigns);
document.getElementById("design-resize-clean").addEventListener("click", resizeDesignImagesAndCleanChartCopies);
document.getElementById("design-delete-selected").addEventListener("click", deleteSelectedDesigns);
document.getElementById("designs").addEventListener("change", handleDesignSelectionChange);
document.getElementById("design-category-dialog").addEventListener("change", handleDesignSelectionChange);
document.getElementById("design-select-category").addEventListener("click", selectCurrentDesignCategory);
document.getElementById("design-delete-selected-category").addEventListener("click", deleteSelectedDesigns);

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
  loadStoneEntry(event.target.value, DEFAULT_STONE_ITEM_KEY);
});

document.querySelector('#stone-entry-form [name="stoneItemKey"]').addEventListener("change", () => {
  refreshStoneEntryItemView();
});

document.querySelector('#stone-entry-form [name="stoneItemKey"]').addEventListener("input", () => {
  refreshStoneEntryItemView();
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
  if (event.target.name === "stoneItemKey") {
    refreshStoneEntryItemView();
  }
  if (["entryStoneType", "entryStoneShape", "entryStoneSize"].includes(event.target.name)) {
    handleDesignStoneEntryChange(event.target.name);
  }
  if (event.target.closest("[data-design-stone-row]") && event.target.dataset.stoneEdit) {
    updateDesignStoneEditRowPreview(event.target.closest("[data-design-stone-row]"));
  }
});

document.getElementById("stone-entry-form").addEventListener("input", (event) => {
  if (event.target.name === "entryStonePcs") updateDesignStoneEntryCodePreview();
  if (event.target.closest("[data-design-stone-row]") && event.target.dataset.stoneEdit) {
    updateDesignStoneEditRowPreview(event.target.closest("[data-design-stone-row]"));
  }
});

document.getElementById("add-design-stone").addEventListener("click", addDesignStoneItem);

document.getElementById("read-stone-chart").addEventListener("click", readStoneChartImage);

document.querySelector('#stone-entry-form [name="stoneChart"]').addEventListener("change", async (event) => {
  const files = [...event.target.files];
  selectedStoneChartFiles = files;
  if (!files.length) return;
  const form = document.getElementById("stone-entry-form");
  const preview = document.getElementById("stone-entry-preview");
  const file = files[0];
  const matchedDesign = findDesignForStoneChartFile(file.name);
  const fileItemKey = matchedDesign ? stoneItemKeyFromFileName(file.name, matchedDesign) : DEFAULT_STONE_ITEM_KEY;
  if (matchedDesign) await loadStoneEntry(matchedDesign.id, fileItemKey);
  else if (form.stoneItemKey && fileItemKey !== DEFAULT_STONE_ITEM_KEY) form.stoneItemKey.value = fileItemKey;
  const assignedCount = await autoAssignStoneChartFiles(files);
  await showStoneChartQuality(file);
  if (matchedDesign) {
    await loadStoneEntry(matchedDesign.id, fileItemKey);
  } else {
    preview.classList.remove("empty");
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Selected stone chart preview">`;
  }
  const note = document.getElementById("stone-chart-quality");
  if (assignedCount) {
    note.className = "dialog-note ocr-quality-note good";
    note.textContent = `${assignedCount} matching stone sheet crop(s) assigned automatically. Use Crop Chart From Design if the chart is inside the design image.`;
  }
});

document.getElementById("stone-entry-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const design = findById("designs", form.stoneDesignId.value);
  if (!design) {
    alert("Select design first.");
    return;
  }
  const files = [...form.stoneChart.files];
  if (files.length) {
    await autoAssignStoneChartFiles(files);
    const file = matchingStoneChartFileForDesign(files, design) || files[0];
    await showStoneChartQuality(file);
    await saveStoneChartFileForDesign(design, file, currentStoneEntryItemKey());
  }
  form.stoneChart.value = "";
  selectedStoneChartFiles = [];
  saveState();
  render();
  await loadStoneEntry(design.id, currentStoneEntryItemKey());
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
  if (event.target.name === "cmItemType") updateOrderItemCategoryFields(row);
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

document.getElementById("repair-order-search").addEventListener("input", renderRepairJobOrders);

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

document.getElementById("production-form").addEventListener("input", (event) => {
  if (event.target.name === "metalPurity") updateProductionCastingItemOptions();
  updateIssueMetalSummary();
});
document.getElementById("production-form").addEventListener("change", (event) => {
  if (event.target.name === "jobNumber") applyIssuePurityFromJob();
  if (["jobNumber", "metalPurity"].includes(event.target.name)) updateProductionCastingItemOptions();
  if (event.target.name === "castingSafeItemId") applyCastingSafeItemToIssueForm();
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
  const castingSafeItem = findSafeItemOrGroup(data.castingSafeItemId, metalPurity);
  if (!selectedOrders.length) {
    alert("Select one open job card to issue metal.");
    return;
  }
  if (!karigar) return;
  if (!safeItemIssueSelectionAvailable(castingSafeItem)) {
    alert("Select the casting shelf item from Safe Locker for this job card.");
    return;
  }
  if (netMetalIssuedWeight <= 0) {
    alert("Metal issued weight must be more than wax-set stone weight.");
    return;
  }

  const issueLocker = safeLockerForPurity(metalPurity);
  const selectedLocker = safeLockerForPurity(castingSafeItem.locker || castingSafeItem.purity);
  if (selectedLocker !== issueLocker) {
    alert(`Selected casting item is in ${selectedLocker} Safe, but this job needs ${issueLocker} Safe.`);
    return;
  }
  const castingItemAvailable = safeItemAvailableWeight(castingSafeItem);
  if (netMetalIssuedWeight > castingItemAvailable) {
    alert(`Selected casting item has only ${gram(castingItemAvailable)} available. Required for this job card is ${gram(netMetalIssuedWeight)}.`);
    return;
  }
  const balanceAfterIssue = Number(weight3(castingItemAvailable - netMetalIssuedWeight));
  const issueSourceName = safeIssueSourceName(castingSafeItem);
  const issueSourceDetail = safeItemOptionLabel(castingSafeItem);

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
    issueDepartment: primaryDepartmentProcess(karigar),
    currentDepartment: primaryDepartmentProcess(karigar),
    metalPurity,
    grossIssuedWeight: issuedWeight,
    waxStoneWeight,
    issuedWeight: netMetalIssuedWeight,
    castingSafeItemId: castingSafeItem.id,
    castingSafeItemDescription: castingSafeItem.description || "",
    issueSourceName,
    issueSourceDetail,
    issueSourceLocker: issueLocker,
    rodColour: safeItemColour(castingSafeItem),
    rodDesiredPurity: displayPurity(safeItemDesiredPurity(castingSafeItem)),
    expectedWastage: Number(data.wastagePercent || 0),
    finishedWeight: 0,
    actualWastage: 0,
    status: "Issued",
    transfers: [],
  });
  const productionReference = `${lotNumber} for ${data.jobNumber} issued from ${issueSourceName} to ${karigar.name}; ${issueSourceDetail}; Gold Issue ${gram(issuedWeight)} - Wax Stone ${gram(waxStoneWeight)} = Net Wt ${gram(netMetalIssuedWeight)}; Balance ${gram(balanceAfterIssue)}`;
  state.ledger.unshift({ id: crypto.randomUUID(), date: today(), type: "Out", purity: metalPurity, weight: netMetalIssuedWeight, reference: productionReference });
  issueFromSafeSelection(castingSafeItem, netMetalIssuedWeight, productionReference, lotNumber, {
    grossWeight: issuedWeight,
    waxStoneWeight,
  });
  event.target.reset();
  saveState();
  render();
});

document.getElementById("stock-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const designText = designLabel(data.designId);
  const ledgerEntry = {
    id: crypto.randomUUID(),
    date: today(),
    type: "In",
    purity: data.purity,
    weight: Number(data.weight),
    designId: data.designId || "",
    reference: designText ? `${data.source} / ${designText}` : data.source,
  };
  state.ledger.unshift(ledgerEntry);
  addMetalSafeMovement({
    type: "In",
    direction: "in",
    purity: data.purity,
    weight: Number(data.weight),
    reference: ledgerEntry.reference,
    sourceType: "raw-stock",
    sourceId: ledgerEntry.id,
  });
  event.target.reset();
  saveState();
  render();
});

document.getElementById("safe-item-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const grossWeight = Number(data.grossWeight || 0);
  const waxStoneWeight = Number(data.waxStoneWeight || 0);
  if (waxStoneWeight > grossWeight) {
    alert("Wax stone weight cannot be more than safe item GW.");
    return;
  }
  addSafeItem({
    date: today(),
    locker: data.locker,
    purity: data.locker,
    description: data.description,
    source: data.source || "Manual safe entry",
    grossWeight,
    waxStoneWeight,
    netWeight: safeItemNetFromGross(grossWeight, waxStoneWeight),
    status: "In Safe",
    sourceType: "manual",
  });
  event.target.reset();
  saveState();
  render();
});

document.getElementById("metal-safe-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const ledgerEntry = {
    id: crypto.randomUUID(),
    date: today(),
    type: "In",
    purity: data.purity,
    weight: Number(data.weight),
    reference: `Metal Safe / ${data.reference}`,
  };
  state.ledger.unshift(ledgerEntry);
  addMetalSafeMovement({
    type: "Office In",
    direction: "in",
    purity: data.purity,
    weight: Number(data.weight),
    reference: `Office In / ${data.reference}`,
    sourceType: "metal-safe",
    sourceId: ledgerEntry.id,
  });
  event.target.reset();
  saveState();
  render();
});

document.getElementById("safe-locker-filter").addEventListener("change", renderSafe);
document.getElementById("metal-safe-search").addEventListener("input", renderSafe);

document.getElementById("vendor-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const name = data.name.trim();
  if (!name) {
    alert("Enter vendor / party name.");
    return;
  }
  const duplicate = findVendorByName(name);
  if (duplicate && duplicate.id !== data.vendorId) {
    alert("This vendor / party already exists. Edit the existing vendor instead.");
    return;
  }
  const vendor = data.vendorId ? findById("vendors", data.vendorId) : null;
  if (vendor) {
    Object.assign(vendor, {
      name,
      phone: data.phone || "",
      city: data.city || "",
      remarks: data.remarks || "",
    });
  } else {
    state.vendors = state.vendors || [];
    state.vendors.unshift({
      id: crypto.randomUUID(),
      name,
      phone: data.phone || "",
      city: data.city || "",
      remarks: data.remarks || "",
    });
  }
  resetVendorForm();
  saveState();
  render();
});

document.getElementById("factory-in-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const vendor = findById("vendors", data.vendorId);
  const weight = Number(data.weight || 0);
  if (!vendor) {
    alert("Select vendor / party first.");
    return;
  }
  if (weight <= 0) {
    alert("Enter valid factory in weight.");
    return;
  }
  addFactoryInEntry({
    vendor,
    materialType: data.materialType,
    purity: data.purity,
    weight,
    wstgPercent: data.wstgPercent,
    reference: data.reference,
    remarks: data.remarks,
  });
  event.target.reset();
  event.target.purity.value = "99.5%";
  event.target.wstgPercent.value = "0";
  saveState();
  render();
});

document.getElementById("factory-out-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData(event.target);
  const vendor = findById("vendors", data.vendorId);
  const weight = Number(data.weight || 0);
  if (!vendor) {
    alert("Select vendor / party first.");
    return;
  }
  if (weight <= 0) {
    alert("Enter valid factory out weight.");
    return;
  }
  const result = addFactoryOutEntry({
    vendor,
    materialType: data.materialType,
    purity: data.purity,
    weight,
    wstgPercent: data.wstgPercent,
    reference: data.reference,
    remarks: data.remarks,
  });
  if (!result) return;
  event.target.reset();
  event.target.purity.value = "99.5%";
  event.target.wstgPercent.value = "0";
  saveState();
  render();
});

document.getElementById("cancel-vendor-edit").addEventListener("click", resetVendorForm);
document.getElementById("vendor-search").addEventListener("input", renderFactory);
document.getElementById("factory-ledger-search").addEventListener("input", renderFactory);
document.getElementById("print-factory-summary").addEventListener("click", printFactorySummary);
document.getElementById("factory-entry-edit-form").addEventListener("submit", saveFactoryLedgerEdit);
document.getElementById("cancel-factory-entry-edit").addEventListener("click", () => {
  document.getElementById("factory-entry-dialog").close();
});
document.getElementById("cancel-factory-entry-edit-bottom").addEventListener("click", () => {
  document.getElementById("factory-entry-dialog").close();
});

document.getElementById("add-melting-source").addEventListener("click", () => {
  addMeltingSourceRow("", "", "top", true, "metal");
  updateMeltingCalculation();
});

document.getElementById("add-melting-rod-source").addEventListener("click", () => {
  addMeltingSourceRow("", "", "top", true, "rod");
  updateMeltingCalculation();
});

document.getElementById("add-melting-wastage-source").addEventListener("click", () => {
  addMeltingSourceRow("", "", "top", true, "wastage");
  updateMeltingCalculation();
});

document.getElementById("melting-form").addEventListener("input", (event) => {
  if (["sourcePurity", "sourceWeightLine", "targetPurity"].includes(event.target.name)) {
    updateMeltingCalculation();
  }
});

document.getElementById("melting-form").addEventListener("change", (event) => {
  if (event.target.name === "sourceMetalSafePurity") {
    applyMetalSafeSelectionToMeltingRow(event.target);
    updateMeltingCalculation();
  }
  if (event.target.name === "sourceKind") {
    updateMeltingSourceRowMode(event.target.closest(".source-row"));
    updateMeltingCalculation();
  }
  if (event.target.name === "sourceSafeLocker") {
    applySafeLockerSelectionToMeltingRow(event.target);
    updateMeltingCalculation();
  }
  if (event.target.name === "sourceWastageLocker") {
    applySafeLockerSelectionToMeltingRow(event.target);
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
  const existingMelting = data.meltingId ? findById("melting", data.meltingId) : null;
  const previousSourceMetals = existingMelting ? cloneMeltingSourceMetals(existingMelting.sourceMetals) : [];
  const safeIssueError = validateMetalSafeIssue(sourceMetals, previousSourceMetals) || validateSafeLockerSourceIssue(sourceMetals, previousSourceMetals);
  if (safeIssueError) {
    alert(safeIssueError);
    return;
  }
  const melting = existingMelting || {
    id: crypto.randomUUID(),
    date: today(),
    status: "Issued",
    receivedWeight: 0,
    meltingLoss: 0,
  };
  if (!existingMelting) state.melting.unshift(melting);
  if (existingMelting) restoreMeltingRodIssues(previousSourceMetals, melting.id, "Melting issue edited");
  Object.assign(melting, {
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
  });
  assignMeltingBatchName(melting, state.melting, false);
  if (melting.status === "Received") {
    melting.meltingLoss = Number(weight3(Math.max(Number(melting.finalWeight || 0) - Number(melting.receivedWeight || 0), 0)));
  } else {
    melting.status = "Issued";
    melting.receivedWeight = 0;
    melting.meltingLoss = 0;
  }
  syncMeltingIssueRecords(melting);
  if (melting.status === "Received") syncMeltingReceiveRecords(melting);
  resetMeltingIssueForm();
  updateMeltingCalculation();
  saveState();
  render();
});

document.getElementById("melting-receive-form").addEventListener("input", (event) => {
  if (allMeltingReceiveWeightFields().includes(event.target.name)) updateMeltingReceiveLoss();
});

document.getElementById("melting-receive-form").addEventListener("submit", (event) => {
  event.preventDefault();
  updateMeltingReceiveLoss();
  const data = getFormData(event.target);
  const melting = findById("melting", data.meltingId);
  if (!melting) return;
  const receivedWeight = Number(data.receivedWeight || 0);
  const meltingLoss = Number(data.meltingLoss || 0);
  const receiveBreakup = getMeltingReceiveBreakup(data, melting);
  if (!isMeltingDepartmentReceive(melting) && Number(receiveBreakup.castingWaxStoneWeight || 0) > Number(receiveBreakup.castingItemWeight || 0)) {
    alert("Wax set stone weight cannot be more than Casting Item Weight.");
    return;
  }
  melting.receivedDate = melting.receivedDate || today();
  melting.grossReceivedWeight = meltingReceiveGrossWeight(receiveBreakup, melting);
  melting.receivedWeight = receivedWeight;
  melting.meltingLoss = meltingLoss;
  melting.receiveBreakup = receiveBreakup;
  melting.status = "Received";
  assignMeltingBatchName(melting, state.melting, meltingBatchType(melting) === "CASTING");
  syncMeltingReceiveRecords(melting);
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
  const processes = departmentProcessesFromText(data.speciality);
  const speciality = processes.join(", ");
  if (existing) {
    existing.name = data.name;
    existing.speciality = speciality;
    existing.processes = processes;
    existing.rate = Number(data.rate);
    updateDepartmentReferences(existing);
  } else {
    state.karigars.push({
      id: crypto.randomUUID(),
      name: data.name,
      speciality,
      processes,
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
  if (event.target.id === "office-select-dialog-items") {
    selectAllOfficeDialogItems();
    return;
  }
  const tagButton = event.target.closest("[data-office-tag-key]");
  if (tagButton) {
    printHallmarkedTags([tagButton.dataset.officeTagKey]);
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
  if (event.target.id === "office-print-tags") printHallmarkedTags();
});

document.getElementById("office-details-dialog").addEventListener("input", (event) => {
  if (event.target.id === "office-customer-search") {
    renderOfficeCustomerList();
  }
  if (event.target.classList?.contains("repair-final-gw-input")) {
    updateRepairLossInput(event.target);
  }
});

document.getElementById("office-details-dialog").addEventListener("submit", (event) => {
  if (event.target.id !== "office-customer-form") return;
  event.preventDefault();
  saveOfficeCustomer(event.target);
});

document.getElementById("bill-form").addEventListener("input", updateBillAmount);
document.getElementById("bill-form").addEventListener("change", updateBillAmount);

document.getElementById("bill-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveBillFromForm(true);
});

document.getElementById("bill-qc-ok").addEventListener("click", () => {
  if (isBillQcOnlyMode()) {
    alert("QC check users can only select QC dropdown and save. Transfer to Office must be done by Bill, Manager, or Owner.");
    return;
  }
  transferQcOkItemsToOffice();
});

document.getElementById("bill-qc-failed").addEventListener("click", () => {
  if (isBillQcOnlyMode()) {
    alert("QC check users can only select QC dropdown and save. Sending failed items back to production must be done by Bill, Manager, or Owner.");
    return;
  }
  returnQcFailedItemsToProduction();
});

document.getElementById("print-bill").addEventListener("click", () => {
  printBillFromDialog();
});

document.getElementById("print-packing-list").addEventListener("click", () => {
  printPackingListFromDialog();
});

function saveBillFromForm(closeDialog = false, options = {}) {
  const form = document.getElementById("bill-form");
  updateBillAmount();
  const data = getFormData(form);
  const lot = findById("lots", data.lotId);
  if (!lot) return null;
  const existingBill = lot.bill || state.bills?.find((item) => item.lotId === lot.id) || {};
  if (isBillQcOnlyMode() && !existingBill.id) {
    alert("QC can be updated only after Bill Dept, Manager, or Owner has created the bill.");
    return null;
  }
  if (!existingBill.id && !canCreateBill()) {
    alert("Only Bill Dept, Manager, or Owner can create a bill.");
    return null;
  }
  if (existingBill.id && !isBillQcOnlyMode() && !canEditGeneratedBill()) {
    if (options.allowLockedBillFlow && isBillDeptUser()) {
      lot.bill = existingBill;
      return { lot, bill: existingBill };
    }
    alert("Bill is already generated. Bill Dept can view it only. Only Manager and Owner can edit the bill.");
    return null;
  }
  const items = billItemRows(existingBill.items || []);
  const netWeight = items.reduce((total, item) => total + Number(item.netWeight || 0), 0);
  const bill = {
    id: existingBill.id || lot.bill?.id || crypto.randomUUID(),
    lotId: lot.id,
    jobNumber: lot.orderNumber,
    billNo: data.billNo,
    billDate: data.billDate,
    makingRate: 0,
    officeMakingRate: 0,
    otherCharges: 0,
    manufacturingBillAmount: 0,
    billAmount: 0,
    items,
    netWeight,
    makingGold: 0,
    manufacturingMakingGold: 0,
    officeMakingGold: 0,
    remarks: data.remarks || "",
  };
  state.bills = state.bills || [];
  const existingIndex = state.bills.findIndex((item) => item.lotId === lot.id);
  if (existingIndex >= 0) state.bills[existingIndex] = bill;
  else state.bills.unshift(bill);
  lot.bill = bill;
  syncFactoryOutForBill(lot, bill);
  lot.productionStockWeight = billProductionStockWeight(bill);
  lot.billingStage = lot.billingStage || "Bill / QC";
  lot.currentDepartment = lot.billingStage;
  lot.karigarName = "Bill / QC";
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

document.getElementById("cancel-melting-issue-edit").addEventListener("click", () => {
  resetMeltingIssueForm();
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

document.getElementById("close-job-item-detail").addEventListener("click", () => {
  closeJobItemDetail();
});

document.getElementById("split-job-items").addEventListener("click", splitSelectedJobItems);

document.getElementById("close-barcode-generator").addEventListener("click", () => {
  document.getElementById("barcode-generator-dialog").close();
});

document.getElementById("print-generated-barcode").addEventListener("click", printGeneratedBarcode);

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
  if (event.target.name === "cmItemType") updateItemEditCategoryFields(form);
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
  order.cmItemType = data.cmItemType || "";
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
    itemKey: row.dataset.itemKey || "",
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
  const order = findById("orders", orderId);
  const pendingOrders = order ? getJobOrders(order).filter((item) => item.status === "Pending") : [];
  if (!pendingOrders.length) {
    alert("Gold is already issued for this job card, or no pending item is available for issue.");
    return;
  }
  document.getElementById("order-dialog").close();
  switchView("production");
  switchProductionPage("issue");
  renderSelects();
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
  if (!data.toDepartment) {
    alert("Select process in the new department.");
    return;
  }

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
  const form = event.currentTarget;
  if (event.target.name === "karigarId") {
    renderTransferProcessOptions(form.karigarId.value);
    updateTransferReasonFromProcess();
  }
  if (event.target.name === "toDepartment") {
    updateTransferReasonFromProcess();
  }
});

document.getElementById("close-history").addEventListener("click", () => {
  document.getElementById("history-dialog").close();
});

document.getElementById("transfer-history-search").addEventListener("input", renderOnlineTransferHistory);
document.getElementById("production-transfer-search").addEventListener("input", renderOnlineTransferHistory);
document.getElementById("department-transfer-search")?.addEventListener("input", renderDepartmentTransferHistoryBoard);
document.getElementById("close-department-transfer")?.addEventListener("click", () => {
  document.getElementById("department-transfer-dialog")?.close();
});

document.getElementById("login-user-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isOwner()) {
    alert("Only Owner can add users.");
    return;
  }
  addLoginUser(event.target);
});

document.getElementById("login-users-table")?.addEventListener("click", (event) => {
  const saveButton = event.target.closest("[data-save-user]");
  const deleteButton = event.target.closest("[data-delete-user]");
  if (!saveButton && !deleteButton) return;
  if (!isOwner()) {
    alert("Only Owner can modify users.");
    return;
  }
  if (saveButton) saveLoginUser(saveButton.dataset.saveUser, saveButton.closest("tr"));
  if (deleteButton) deleteLoginUser(deleteButton.dataset.deleteUser);
});

function loadState() {
  try {
    const saved = localStorage.getItem("gold-jewellery-erp-state");
    const normalized = normalizeState(saved ? JSON.parse(saved) : structuredClone(demoState));
    rememberFactoryResetMarker(stateFactoryResetAt(normalized));
    localStorage.setItem("gold-jewellery-erp-state", JSON.stringify(normalized));
    return normalized;
  } catch (error) {
    console.warn("Saved ERP data could not be read. Starting with safe demo data.", error);
    localStorage.removeItem("gold-jewellery-erp-state");
    const normalized = normalizeState(structuredClone(demoState));
    rememberFactoryResetMarker(stateFactoryResetAt(normalized));
    localStorage.setItem("gold-jewellery-erp-state", JSON.stringify(normalized));
    return normalized;
  }
}

function loadCurrentUser() {
  try {
    const saved = localStorage.getItem("gold-jewellery-erp-user");
    const user = saved ? JSON.parse(saved) : null;
    if (user && !allUsers()[user.id]) {
      localStorage.removeItem("gold-jewellery-erp-user");
      return null;
    }
    return user;
  } catch (error) {
    localStorage.removeItem("gold-jewellery-erp-user");
    return null;
  }
}

function applyLoginState() {
  const isLoggedIn = Boolean(currentUser);
  document.body.classList.toggle("logged-out", !isLoggedIn);
  document.body.classList.toggle("is-owner", isOwner());
  document.getElementById("active-user").textContent = isLoggedIn ? currentUser.name : "Not logged in";
  renderLoginUserOptions();
  applyAccessControl();
  renderLoginUsers();
}

function currentUserConfig() {
  return currentUser ? allUsers()[currentUser.id] : null;
}

function allowedPages() {
  const config = currentUserConfig();
  if (!config) return [];
  if (config.pages === "all") return Object.keys(pageInfo);
  return config.pages || [];
}

function canAccessPage(view) {
  if (view === "users" && !isOwner()) return false;
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

function isQcUser() {
  const config = currentUserConfig();
  return config?.role === "qc" || Boolean(config?.qcOnly);
}

function isOfficeMainUser() {
  return currentUserConfig()?.role === "office-main";
}

function isManagerUser() {
  return currentUserConfig()?.role === "manager";
}

function isBillDeptUser() {
  return currentUserConfig()?.role === "bill";
}

function canCreateBill() {
  return isOwner() || isManagerUser() || isBillDeptUser();
}

function canEditGeneratedBill() {
  return isOwner() || isManagerUser();
}

function isGeneratedBillLockedForCurrentUser(bill = {}) {
  return Boolean(bill?.id) && !isBillQcOnlyMode() && !canEditGeneratedBill();
}

function canEditQcStatus() {
  return isOwner() || isOfficeMainUser() || isQcUser();
}

function isBillQcOnlyMode() {
  return isOfficeMainUser() || isQcUser();
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
  document.body.classList.toggle("qc-only-user", isBillQcOnlyMode());
  if (currentUser && !canAccessPage(document.querySelector(".view.active-view")?.id || "dashboard")) {
    switchView(defaultAllowedPage());
  }
}

function saveState() {
  attachLocalFactoryResetMarkerToState();
  rememberFactoryResetMarker(stateFactoryResetAt(state));
  localStorage.setItem("gold-jewellery-erp-state", JSON.stringify(state));
  supabaseLastLocalChangeAt = Date.now();
  queueSupabaseSave();
}

function saveStateLocalOnly() {
  attachLocalFactoryResetMarkerToState();
  rememberFactoryResetMarker(stateFactoryResetAt(state));
  localStorage.setItem("gold-jewellery-erp-state", JSON.stringify(state));
  supabaseLastLocalChangeAt = Date.now();
}

async function resetFactoryData() {
  const resetAt = new Date().toISOString();
  setFactoryResetProtection(true, resetAt);
  supabasePendingCloudState = null;
  clearTimeout(supabaseSaveTimer);
  supabaseSaveTimer = null;
  clearJobCards(resetAt);
  saveStateLocalOnly();
  render();
  setDefaultOrderDates(document.getElementById("order-form"));
  resetOrderItemRows();
  resetMeltingSources();
  updateMeltingCalculation();
  setSyncStatus("saving", "Reset Saved Locally", "Trying to update live sync now.");

  if (!supabaseClient && supabaseSettings.url && supabaseSettings.anonKey) {
    try {
      supabaseClient = await createSupabaseClient();
    } catch (error) {
      console.warn("Supabase reset save could not connect.", error);
      setSyncStatus("offline", syncStatusForError(error, "Reset: Local Only"), error.message || String(error));
    }
  }

  const cloudSaved = supabaseClient ? await syncStateToSupabase({ force: true }) : false;
  if (cloudSaved) {
    setFactoryResetProtection(false);
    startSupabaseAutoRefresh();
  } else {
    setFactoryResetProtection(true, resetAt);
    setSyncStatus("offline", "Reset: Local Only", "Live sync was not updated. Run reset SQL or upload this laptop data after sync connects.");
  }
  return cloudSaved;
}

function setFactoryResetProtection(active, resetAt = "") {
  if (active) rememberFactoryResetMarker(resetAt);
  factoryResetLockUntil = active ? Date.now() + FACTORY_RESET_PROTECTION_MS : 0;
  if (factoryResetLockUntil) {
    localStorage.setItem(FACTORY_RESET_LOCK_KEY, String(factoryResetLockUntil));
  } else {
    localStorage.removeItem(FACTORY_RESET_LOCK_KEY);
  }
}

function isFactoryResetProtected() {
  if (!factoryResetLockUntil) return false;
  if (Date.now() < factoryResetLockUntil) return true;
  setFactoryResetProtection(false);
  return false;
}

function stateFactoryResetAt(source = state) {
  return source?.factoryResetAt || source?.lastFactoryResetAt || "";
}

function factoryResetTimestamp(resetAt) {
  const timestamp = Date.parse(resetAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function rememberFactoryResetMarker(resetAt) {
  if (!resetAt) return;
  if (factoryResetTimestamp(resetAt) < factoryResetTimestamp(localFactoryResetAt)) return;
  localFactoryResetAt = resetAt;
  localStorage.setItem(FACTORY_RESET_MARKER_KEY, resetAt);
}

function attachLocalFactoryResetMarkerToState() {
  if (!localFactoryResetAt) return;
  if (factoryResetTimestamp(stateFactoryResetAt(state)) >= factoryResetTimestamp(localFactoryResetAt)) return;
  state.factoryResetAt = localFactoryResetAt;
  state.factoryResetReason = state.factoryResetReason || FACTORY_RESET_REASON;
}

function localFactoryResetTimestamp() {
  return Math.max(factoryResetTimestamp(localFactoryResetAt), factoryResetTimestamp(stateFactoryResetAt(state)));
}

function isCloudStateOlderThanLocalReset(cloudState = {}) {
  const localResetTime = localFactoryResetTimestamp();
  if (!localResetTime) return false;
  return factoryResetTimestamp(stateFactoryResetAt(cloudState)) < localResetTime;
}

function blockOlderCloudState(cloudState = {}, options = {}) {
  if (!isCloudStateOlderThanLocalReset(cloudState)) return false;
  supabasePendingCloudState = null;
  const detail = "Old live data is blocked. Uploading the cleared factory data again.";
  setSyncStatus("saving", "Reset Protected", detail);
  if (options.manual) {
    alert("Old live data was blocked. The cleared data will stay, and this laptop will upload it to live sync again.");
  }
  if (supabaseClient && !supabaseIsSaving) {
    syncStateToSupabase({ force: true });
  }
  return true;
}

function userPassword(userId) {
  return state.userPasswords?.[userId] || defaultUserPasswords[userId] || "";
}

function allUsers() {
  const custom = (state.customUsers || []).reduce((acc, user) => {
    acc[user.id] = {
      ...user,
      role: user.role || "custom",
      pages: user.pages || [],
    };
    return acc;
  }, {});
  const merged = { ...users, ...custom };
  Object.entries(state.userAccessOverrides || {}).forEach(([id, override]) => {
    if (!merged[id] || id === "owner") return;
    merged[id] = {
      ...merged[id],
      name: override.name || merged[id].name,
      pages: override.pages || merged[id].pages || [],
      canEditOfficeWeights: override.canEditOfficeWeights ?? merged[id].canEditOfficeWeights,
    };
  });
  return merged;
}

function userAccessText(user = {}) {
  if (user.pages === "all") return "Full software";
  return (user.pages || []).map((page) => pageInfo[page]?.[0] || page).join(", ");
}

function renderLoginDetailsList() {
  const list = document.getElementById("login-details-list");
  if (!list) return;
  list.innerHTML = Object.entries(allUsers()).map(([id, user]) =>
    `<span>${escapeHtml(user.name)} / ${escapeHtml(userPassword(id))}</span>`
  ).join("");
}

function renderLoginUserOptions() {
  const select = document.querySelector('#login-form select[name="user"]');
  if (!select) return;
  const currentValue = select.value || "owner";
  select.innerHTML = Object.entries(allUsers()).map(([id, user]) =>
    `<option value="${escapeHtml(id)}">${escapeHtml(user.name)}</option>`
  ).join("");
  select.value = allUsers()[currentValue] ? currentValue : "owner";
}

function loadSupabaseLibrary() {
  return new Promise((resolve, reject) => {
    if (window.supabase) {
      resolve(window.supabase);
      return;
    }
    const timeout = setTimeout(() => {
      reject(new Error("Supabase CDN load timeout."));
    }, SUPABASE_REQUEST_TIMEOUT_MS);
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.onload = () => {
      clearTimeout(timeout);
      resolve(window.supabase);
    };
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Supabase library could not load."));
    };
    document.head.appendChild(script);
  });
}

function normalizeSupabaseUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function withSupabaseTimeout(promise, message = "Supabase request timeout.") {
  let timeout;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), SUPABASE_REQUEST_TIMEOUT_MS);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
}

function supabaseFetch(input, init = {}) {
  if (!window.fetch) return Promise.reject(new Error("Browser fetch is not available."));
  return withSupabaseTimeout(fetch(input, init));
}

function createFetchSupabaseClient(url, anonKey) {
  const baseUrl = normalizeSupabaseUrl(url);
  const headers = (extra = {}) => ({
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    ...extra,
  });
  const asError = async (response) => {
    let details = "";
    try {
      const data = await response.json();
      details = data.message || data.error || JSON.stringify(data);
    } catch {
      details = await response.text().catch(() => "");
    }
    return new Error(details || `${response.status} ${response.statusText}`);
  };
  return {
    from(table) {
      const query = { select: "*", filters: {} };
      const tableUrl = `${baseUrl}/rest/v1/${encodeURIComponent(table)}`;
      const builder = {
        select(columns) {
          query.select = columns || "*";
          return builder;
        },
        eq(column, value) {
          query.filters[column] = `eq.${value}`;
          return builder;
        },
        async maybeSingle() {
          const params = new URLSearchParams({ select: query.select, limit: "1" });
          Object.entries(query.filters).forEach(([column, value]) => params.set(column, value));
          try {
            const response = await supabaseFetch(`${tableUrl}?${params.toString()}`, {
              headers: headers({ Accept: "application/json" }),
            });
            if (!response.ok) return { data: null, error: await asError(response) };
            const rows = await response.json();
            return { data: Array.isArray(rows) ? rows[0] || null : rows, error: null };
          } catch (error) {
            return { data: null, error };
          }
        },
        async upsert(row) {
          try {
            const response = await supabaseFetch(`${tableUrl}?on_conflict=id`, {
              method: "POST",
              headers: headers({
                "Content-Type": "application/json",
                Prefer: "resolution=merge-duplicates,return=minimal",
              }),
              body: JSON.stringify(row),
            });
            if (!response.ok) return { data: null, error: await asError(response) };
            return { data: null, error: null };
          } catch (error) {
            return { data: null, error };
          }
        },
      };
      return builder;
    },
    storage: {
      from(bucket) {
        const objectUrl = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`;
        return {
          async upload(path, blob, options = {}) {
            try {
              const response = await supabaseFetch(`${objectUrl}/${encodeURI(path)}`, {
                method: "POST",
                headers: headers({
                  "Content-Type": options.contentType || blob.type || "application/octet-stream",
                  "x-upsert": options.upsert ? "true" : "false",
                }),
                body: blob,
              });
              if (!response.ok) return { data: null, error: await asError(response) };
              return { data: null, error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
          async download(path) {
            try {
              const response = await supabaseFetch(`${objectUrl}/${encodeURI(path)}`, {
                headers: headers(),
              });
              if (!response.ok) return { data: null, error: await asError(response) };
              return { data: await response.blob(), error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
          async remove(paths) {
            try {
              const response = await supabaseFetch(objectUrl, {
                method: "DELETE",
                headers: headers({ "Content-Type": "application/json" }),
                body: JSON.stringify({ prefixes: paths }),
              });
              if (!response.ok) return { data: null, error: await asError(response) };
              return { data: null, error: null };
            } catch (error) {
              return { data: null, error };
            }
          },
        };
      },
    },
  };
}

async function createSupabaseClient() {
  try {
    const supabaseLibrary = await loadSupabaseLibrary();
    return supabaseLibrary.createClient(supabaseSettings.url, supabaseSettings.anonKey, {
      global: { fetch: supabaseFetch },
    });
  } catch (error) {
    console.warn("Supabase CDN library did not load. Trying direct Supabase connection.", error);
    if (!window.fetch) throw error;
    setSyncStatus("connecting", "Sync: Direct Connect", error.message);
    return createFetchSupabaseClient(supabaseSettings.url, supabaseSettings.anonKey);
  }
}

function setSyncStatus(status, message, detail = "") {
  const pill = document.getElementById("sync-status");
  if (pill) {
    pill.className = `sync-pill ${status}`;
    pill.textContent = message;
    pill.title = detail || message;
  }
  const detailNode = document.getElementById("sync-detail");
  if (detailNode) {
    const detailText = detail ? String(detail).replace(/\s+/g, " ").trim().slice(0, 120) : "auto refresh every 3 sec";
    detailNode.textContent = `${APP_VERSION} / ${detailText}`;
  }
}

function syncStatusForError(error, fallback) {
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("timeout") || message.includes("abort") || message.includes("failed to fetch") || message.includes("networkerror") || message.includes("load failed")) {
    return "Sync: Internet Error";
  }
  if (message.includes("could not load") || message.includes("cdn")) return "Sync: CDN Blocked";
  if (message.includes("permission") || message.includes("policy") || message.includes("row-level security") || message.includes("401") || message.includes("403")) {
    return "Sync: Permission Error";
  }
  if (message.includes("erp_state") || message.includes("schema cache") || message.includes("relation") || message.includes("does not exist")) {
    return "Sync: Setup Missing";
  }
  return fallback;
}

function scheduleSupabaseReconnect() {
  clearTimeout(supabaseReconnectTimer);
  supabaseReconnectTimer = setTimeout(() => {
    initializeSupabase();
  }, SUPABASE_RECONNECT_INTERVAL_MS);
}

function stopSupabaseRealtime() {
  if (!supabaseRealtimeChannel || !supabaseClient?.removeChannel) {
    supabaseRealtimeChannel = null;
    return;
  }
  try {
    supabaseClient.removeChannel(supabaseRealtimeChannel);
  } catch (error) {
    console.warn("Could not stop Supabase realtime channel", error);
  }
  supabaseRealtimeChannel = null;
}

function startSupabaseRealtime() {
  if (!supabaseClient?.channel || supabaseRealtimeChannel) return false;
  try {
    supabaseRealtimeChannel = supabaseClient
      .channel(`erp-state-sync-${supabaseStateId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "erp_state",
        filter: `id=eq.${supabaseStateId}`,
      }, (payload) => {
        const row = payload.new || {};
        if (!row.data) {
          loadSupabaseState({ auto: true, realtime: true });
          return;
        }
        applyCloudStateFromRow(row, { auto: true, realtime: true });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setSyncStatus("online", "Live Sync: Realtime");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          supabaseRealtimeChannel = null;
          setSyncStatus("connecting", "Live Sync: Auto", "Realtime unavailable, polling every few seconds.");
        }
      });
    return true;
  } catch (error) {
    console.warn("Supabase realtime could not start. Auto refresh will continue.", error);
    supabaseRealtimeChannel = null;
    return false;
  }
}

async function initializeSupabase() {
  if (supabaseIsConnecting) return;
  if (!supabaseSettings.url || !supabaseSettings.anonKey) {
    setSyncStatus("offline", "Sync: Local Only");
    return;
  }
  supabaseIsConnecting = true;
  try {
    clearTimeout(supabaseReconnectTimer);
    setSyncStatus("connecting", "Sync: Connecting");
    supabaseClient = await createSupabaseClient();
    const connected = await loadSupabaseState({ initial: true });
    if (connected) startSupabaseAutoRefresh();
    else scheduleSupabaseReconnect();
  } catch (error) {
    console.warn("Supabase is not connected. Local browser data is still working.", error);
    stopSupabaseRealtime();
    supabaseClient = null;
    setSyncStatus("offline", syncStatusForError(error, "Sync: Offline"), error.message || String(error));
    scheduleSupabaseReconnect();
  } finally {
    supabaseIsConnecting = false;
  }
}

async function refreshLiveData() {
  if (!supabaseClient) {
    alert("Live sync is not connected on this laptop. Check internet and refresh the website.");
    setSyncStatus("offline", "Sync: Offline");
    return;
  }
  if (supabasePendingCloudState) {
    const pending = supabasePendingCloudState;
    supabasePendingCloudState = null;
    if (blockOlderCloudState(pending.data, { manual: true })) return;
    applyCloudState(pending.data, pending.updated_at, { manual: true });
    return;
  }
  await loadSupabaseState({ manual: true });
}

async function pushLocalDataToCloud() {
  if (!isOwner()) {
    alert("Only Owner can upload this laptop data to cloud.");
    return;
  }
  if (!supabaseClient) {
    await initializeSupabase();
  }
  if (!supabaseClient) {
    alert("Live sync is not connected on this laptop. Check internet and refresh the website.");
    return;
  }
  if (!confirm("Upload this laptop data to cloud now?\n\nUse this only on the laptop which has the correct latest data. Other laptops will receive this data.")) return;
  supabasePendingCloudState = null;
  const saved = await syncStateToSupabase({ force: true });
  if (saved) setFactoryResetProtection(false);
}

function startSupabaseAutoRefresh() {
  clearInterval(supabaseAutoRefreshTimer);
  if (!supabaseClient) return;
  const realtimeStarted = startSupabaseRealtime();
  supabaseAutoRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    if (applyPendingCloudState("auto")) return;
    loadSupabaseState({ auto: true });
  }, AUTO_SYNC_INTERVAL_MS);
  setSyncStatus("online", realtimeStarted ? "Live Sync: Realtime" : "Live Sync: Auto");
}

window.addEventListener("focus", () => {
  if (applyPendingCloudState("auto")) return;
  if (supabaseClient) loadSupabaseState({ auto: true });
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    flushSupabaseSave();
    return;
  }
  if (applyPendingCloudState("auto")) return;
  if (supabaseClient) loadSupabaseState({ auto: true });
});

window.addEventListener("beforeunload", flushSupabaseSave);
window.addEventListener("pagehide", flushSupabaseSave);

function queueSupabaseSave() {
  if (!supabaseClient) {
    setSyncStatus("offline", "Sync: Offline");
    return;
  }
  setSyncStatus("saving", "Sync: Saving");
  clearTimeout(supabaseSaveTimer);
  supabaseSaveTimer = setTimeout(syncStateToSupabase, SUPABASE_SAVE_DELAY_MS);
}

function flushSupabaseSave() {
  if (!supabaseClient || !supabaseSaveTimer) return;
  syncStateToSupabase({ keepalive: true });
}

async function syncStateToSupabase(options = {}) {
  if (!supabaseClient) {
    setSyncStatus("offline", "Sync: Offline");
    scheduleSupabaseReconnect();
    return false;
  }
  attachLocalFactoryResetMarkerToState();
  clearTimeout(supabaseSaveTimer);
  supabaseSaveTimer = null;
  supabaseIsSaving = true;
  setSyncStatus("saving", "Sync: Saving");
  const updatedAt = new Date().toISOString();
  let error = null;
  try {
    const result = await withSupabaseTimeout(
      supabaseClient
        .from("erp_state")
        .upsert({
          id: supabaseStateId,
          data: state,
          updated_at: updatedAt,
        }),
      "Supabase save timeout."
    );
    error = result?.error || null;
  } catch (caughtError) {
    error = caughtError;
  } finally {
    supabaseIsSaving = false;
  }
  if (error) {
    console.warn("Supabase save failed", error);
    setSyncStatus("offline", syncStatusForError(error, "Sync: Save Failed"), error.message || String(error));
    scheduleSupabaseReconnect();
    return false;
  }
  supabaseLastCloudUpdatedAt = updatedAt;
  setSyncStatus("online", `Live Sync: Saved ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`);
  return true;
}

async function loadSupabaseState(options = {}) {
  if (!supabaseClient) {
    setSyncStatus("offline", "Sync: Offline");
    scheduleSupabaseReconnect();
    return false;
  }
  if (supabaseIsLoading || supabaseIsSaving || supabaseSaveTimer) return false;
  const isAuto = Boolean(options.auto);
  if (isAuto && Date.now() - supabaseLastLocalChangeAt < 1500) return false;
  supabaseIsLoading = true;
  if (!isAuto) setSyncStatus("connecting", "Sync: Loading");
  let data = null;
  let error = null;
  try {
    const result = await withSupabaseTimeout(
      supabaseClient
        .from("erp_state")
        .select("data, updated_at")
        .eq("id", supabaseStateId)
        .maybeSingle(),
      "Supabase load timeout."
    );
    data = result?.data || null;
    error = result?.error || null;
  } catch (caughtError) {
    error = caughtError;
  } finally {
    supabaseIsLoading = false;
  }
  if (error) {
    console.warn("Supabase load failed", error);
    setSyncStatus("offline", syncStatusForError(error, "Sync: Load Failed"), error.message || String(error));
    scheduleSupabaseReconnect();
    return false;
  }
  let handledCloudState = false;
  if (data?.data) {
    handledCloudState = applyCloudStateFromRow(data, options);
  } else {
    handledCloudState = await syncStateToSupabase();
  }
  if (options.initial && handledCloudState) setSyncStatus("online", "Live Sync: Auto");
  return true;
}

function applyCloudStateFromRow(row = {}, options = {}) {
  if (blockOlderCloudState(row.data, options)) return false;
  const cloudUpdatedAt = row.updated_at || "";
  const isAuto = Boolean(options.auto || options.realtime);
  if (isAuto && !isNewerCloudData(cloudUpdatedAt)) {
    setSyncStatus("online", supabaseRealtimeChannel ? "Live Sync: Realtime" : "Live Sync: Auto");
    return false;
  }
  if (isAuto && isUserActivelyEditing()) {
    supabasePendingCloudState = {
      data: row.data,
      updated_at: cloudUpdatedAt,
    };
    setSyncStatus("connecting", "New Data - Refresh", "Another laptop saved new data. Close the open form or click Refresh Live Data to load it.");
    return true;
  }
  applyCloudState(row.data, cloudUpdatedAt, options);
  return true;
}

function applyPendingCloudState(source = "auto") {
  if (!supabasePendingCloudState || isUserActivelyEditing()) return false;
  const pending = supabasePendingCloudState;
  supabasePendingCloudState = null;
  if (blockOlderCloudState(pending.data, { auto: source === "auto" })) return false;
  applyCloudState(pending.data, pending.updated_at, { auto: source === "auto" });
  return true;
}

function applyCloudState(cloudState, cloudUpdatedAt = "", options = {}) {
  state = normalizeState(cloudState);
  const appliedResetAt = stateFactoryResetAt(state);
  if (appliedResetAt) {
    rememberFactoryResetMarker(appliedResetAt);
    setFactoryResetProtection(false);
  }
  supabaseLastCloudUpdatedAt = cloudUpdatedAt || supabaseLastCloudUpdatedAt;
  localStorage.setItem("gold-jewellery-erp-state", JSON.stringify(state));
  render();
  setDefaultOrderDates(document.getElementById("order-form"));
  resetOrderItemRows();
  resetMeltingSources();
  updateMeltingCalculation();
  const time = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (options.manual) {
    setSyncStatus("online", `Live Sync: Refreshed ${time}`);
  } else if (options.realtime) {
    setSyncStatus("online", `Live Sync: Updated ${time}`);
  } else if (options.auto) {
    setSyncStatus("online", `Live Sync: Updated ${time}`);
  } else {
    setSyncStatus("online", "Live Sync: Auto");
  }
}

function isNewerCloudData(cloudUpdatedAt) {
  if (!cloudUpdatedAt) return false;
  if (!supabaseLastCloudUpdatedAt) return true;
  return new Date(cloudUpdatedAt).getTime() > new Date(supabaseLastCloudUpdatedAt).getTime() + 250;
}

function isUserActivelyEditing() {
  const active = document.activeElement;
  const editingElement = active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
  const openDialog = document.querySelector("dialog[open]");
  return Boolean(editingElement || openDialog);
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
  resetBuiltInTilePage(view);
  openDefaultOperationPage(view);
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

function openStoneEntryDialog(designId = "") {
  const dialog = document.getElementById("stone-entry-dialog");
  if (!dialog.open) dialog.showModal();
  if (designId) loadStoneEntry(designId);
}

function restoreStoneEntryReturnContext() {
  const context = stoneEntryReturnContext;
  stoneEntryReturnContext = null;
  if (!context) return;
  if (context.type === "design-category" && context.category) {
    switchDesignPage("master");
    setTimeout(() => openDesignCategory(encodeURIComponent(context.category)), 0);
  }
}

function restoreStoneCropReturnContext() {
  const context = stoneCropReturnContext;
  stoneCropReturnContext = null;
  if (!context) return;
  if (context.type === "design-category" && context.category) {
    switchView("designs");
    switchDesignPage("master");
    setTimeout(() => {
      openDesignCategory(encodeURIComponent(context.category));
      setTimeout(() => focusDesignCardInMaster(context.designId), 60);
    }, 0);
  }
}

function focusDesignCardInMaster(designId) {
  if (!designId) return;
  const card = document.querySelector(`[data-design-card="${designId}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("return-highlight");
  setTimeout(() => card.classList.remove("return-highlight"), 1800);
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
  row.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const action = button.dataset.orderItemAction || (isSaved ? "remove" : "clear");
    if (action === "add") {
      commitCurrentOrderItem();
      return;
    }
    if (action === "remove") {
      row.remove();
    } else if (action === "clear") {
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
    <label class="cm-field">CM Item
      <select name="cmItemType">
        ${renderCmItemTypeOptions(item.cmItemType || defaultCmItemTypeForCategory(item.category))}
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
    <div class="order-item-action-buttons">
      <button class="order-add-item-button" type="button" data-order-item-action="add">Add Item</button>
      <button class="delete-btn" type="button" data-order-item-action="clear">Clear Item</button>
    </div>
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
  const cmDetails = isCmCategory(item.category)
    ? `<span class="saved-item-cell"><b>CM Item</b>${escapeHtml(cmItemTypeLabel(item.cmItemType || defaultCmItemTypeForCategory(item.category)))}</span>`
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
    <input type="hidden" name="cmItemType" value="${escapeHtml(item.cmItemType || "")}">
    <input type="hidden" name="clSize" value="${escapeHtml(item.clSize || "")}">
    <input type="hidden" name="cgSize" value="${escapeHtml(item.cgSize || "")}">
    <input type="hidden" name="color" value="${escapeHtml(item.color || "")}">
    <input type="hidden" name="purity" value="${escapeHtml(item.purity || "18K")}">
    <input type="hidden" name="targetWeight" value="0">
    <input type="hidden" name="remarks" value="${escapeHtml(item.remarks || "")}">
    <span class="saved-item-cell"><b>Category</b>${escapeHtml(item.category || "-")}</span>
    <span class="saved-item-cell"><b>Design</b>${escapeHtml(design)}</span>
    ${cbDetails}
    ${cmDetails}
    ${normalSize}
    <span class="saved-item-cell"><b>Color</b>${escapeHtml(item.color || "-")}</span>
    <span class="saved-item-cell"><b>Purity</b>${escapeHtml(item.purity || "18K")}</span>
    <span class="saved-item-cell"><b>Remark</b>${escapeHtml(item.remarks || "-")}</span>
    <button class="delete-btn" type="button" data-order-item-action="remove">Remove</button>
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

function renderCmItemTypeOptions(selected = "") {
  return [
    ["", "Select CM item"],
    ["CM", "CM - Chams"],
    ["CME", "CME - Chams Ear Rings"],
    ["CMB", "CMB - Chams Bracelet"],
    ["CM+CME", "CM + CME"],
    ["CM+CMB", "CM + CMB"],
    ["CME+CMB", "CME + CMB"],
    ["CM+CME+CMB", "All CM + CME + CMB"],
  ].map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function cmItemTypeKeys(value = "") {
  return String(value || "")
    .split("+")
    .map((key) => categoryCode(key))
    .filter((key, index, list) => CM_ITEM_KEYS.includes(key) && list.indexOf(key) === index);
}

function cmItemTypeLabel(value = "") {
  const keys = cmItemTypeKeys(value);
  if (!keys.length) return "-";
  return keys.map((key) => stoneItemLabel(key)).join(" + ");
}

function defaultCmItemTypeForCategory(value = "") {
  const category = categoryCode(value);
  return CM_ITEM_KEYS.includes(category) ? category : "";
}

function categoryCode(value = "") {
  return String(value).trim().toUpperCase();
}

function isCbCategory(value = "") {
  return ["CB", "CBR"].includes(categoryCode(value));
}

function isCmCategory(value = "") {
  return CM_ITEM_KEYS.includes(categoryCode(value));
}

function needsNormalSize(value = "") {
  return ["BR", "LR", "GR"].includes(categoryCode(value));
}

function updateOrderItemCategoryFields(row) {
  if (!row || row.dataset.mode === "saved") return;
  const category = row.querySelector('[name="category"]').value;
  const ringType = row.querySelector('[name="ringType"]').value;
  const showCb = isCbCategory(category);
  const showCm = isCmCategory(category);
  const showNormalSize = needsNormalSize(category);
  row.querySelectorAll(".cb-field").forEach((field) => field.classList.toggle("hidden", !showCb));
  row.querySelectorAll(".cm-field").forEach((field) => field.classList.toggle("hidden", !showCm));
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
  if (!showCm) {
    row.querySelector('[name="cmItemType"]').value = "";
  } else if (!row.querySelector('[name="cmItemType"]').value) {
    row.querySelector('[name="cmItemType"]').value = defaultCmItemTypeForCategory(category);
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
  expandOrderItemCombinations(item).forEach((orderItem) => addOrderItemRow(orderItem, "saved"));
  clearOrderEntryRow(entryRow);
  renderOrderEntrySummary();
}

function clearOrderEntryRow(row) {
  if (!row) return;
  row.querySelector('[name="designId"]').value = "";
  row.querySelector('[name="designSearch"]').value = "";
  row.querySelector('[name="category"]').value = "";
  row.querySelector('[name="ringType"]').value = "";
  row.querySelector('[name="cmItemType"]').value = "";
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
    .flatMap(expandOrderItemCombinations)
    .filter(hasOrderItemDetails);
}

function expandOrderItemCombinations(item) {
  return expandCmSetItem(item).flatMap(expandCbBothRingItem);
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

function expandCmSetItem(item) {
  if (!item || !isCmCategory(item.category)) return [item].filter(Boolean);
  const keys = cmItemTypeKeys(item.cmItemType || defaultCmItemTypeForCategory(item.category));
  if (!keys.length) return [item].filter(Boolean);
  return keys.map((key) => ({
    ...item,
    cmItemType: key,
    item: key,
  }));
}

function getOrderItemFromRow(row) {
  if (!row) return null;
  return {
    designId: row.querySelector('[name="designId"]').value,
    category: row.querySelector('[name="category"]').value,
    item: row.querySelector('[name="item"]')?.value || "",
    ringType: row.querySelector('[name="ringType"]')?.value || "",
    cmItemType: row.querySelector('[name="cmItemType"]')?.value || "",
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
  return Boolean(item?.designId || item?.category || item?.ringType || item?.cmItemType || item?.clSize || item?.cgSize || item?.size || item?.color || item?.remarks);
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
  if (isCmCategory(design.category) && !row.querySelector('[name="cmItemType"]').value) {
    row.querySelector('[name="cmItemType"]').value = defaultCmItemTypeForCategory(design.category);
  }
  updateOrderItemCategoryFields(row);
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
  const candidates = barcodeSearchCandidates(query);
  const order = state.orders.find((item) =>
    [item.barcode, item.productionNo, item.number].some((code) => {
      const normalized = String(code || "").toUpperCase();
      return normalized && (candidates.includes(normalized) || query.includes(normalized));
    })
  );
  if (!order) {
    alert("No product found for this barcode.");
    return;
  }
  openOrderDetail(order.id);
}

function barcodeSearchCandidates(value = "") {
  const text = String(value || "").trim().toUpperCase();
  const values = new Set([text]);
  const patterns = [
    /\bPR\s*[:#-]?\s*([A-Z0-9-]+)/,
    /\bPRODUCTION\s*[:#-]?\s*([A-Z0-9-]+)/,
    /\bITEM\s*[:#-]?\s*([A-Z0-9-]+)/,
    /\bBARCODE\s*[:#-]?\s*([A-Z0-9-]+)/,
  ];
  patterns.forEach((pattern) => {
    const match = text.match(pattern);
    if (match?.[1]) values.add(match[1]);
  });
  return [...values].filter(Boolean);
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

const code128Patterns = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

function barcodeSafeText(value = "", maxLength = 180) {
  return String(value || "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function code128BarcodeSvg(value, options = {}) {
  const text = barcodeSafeText(value, options.maxLength || 180);
  const codes = [104];
  [...text].forEach((char) => {
    const code = char.charCodeAt(0) - 32;
    codes.push(code >= 0 && code <= 95 ? code : 13);
  });
  const checksum = codes.reduce((sum, code, index) => sum + (index === 0 ? code : code * index), 0) % 103;
  codes.push(checksum, 106);
  let x = 0;
  const bars = [];
  codes.forEach((code) => {
    const pattern = code128Patterns[code] || code128Patterns[13];
    [...pattern].forEach((widthText, index) => {
      const width = Number(widthText);
      if (index % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="60"></rect>`);
      x += width;
    });
  });
  return `<div class="barcode-wrap detail-barcode-wrap"><svg class="barcode code128-barcode" viewBox="0 0 ${x} 60" preserveAspectRatio="none">${bars.join("")}</svg><small>${escapeHtml(text)}</small></div>`;
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

function billableOrderIdsForLot(lot = {}, bill = {}) {
  if (Array.isArray(lot.billOrderIds) && lot.billOrderIds.length) return lot.billOrderIds;
  if (lot.qcReturn || lot.parentLotId) return getLotOrderIds(lot);
  const repairBillItemIds = (bill.items || [])
    .filter((item) => item.reworkLotId === lot.id || item.repairFinalBillLotId === lot.id)
    .map((item) => item.orderId)
    .filter(Boolean);
  return repairBillItemIds.length ? repairBillItemIds : getLotOrderIds(lot);
}

function billableOrdersForLot(lot = {}, bill = {}) {
  const ids = billableOrderIdsForLot(lot, bill);
  const orders = ids.map((id) => findById("orders", id)).filter(Boolean);
  return orders.length ? orders : getLotOrders(lot);
}

function rawGoldStock() {
  const metalSafeTotal = metalSafeBalanceTotal();
  if (state.metalSafeMovements?.length) return metalSafeTotal;
  return state.ledger.reduce((total, item) => {
    if (item.type === "In") return total + item.weight;
    if (item.type === "Out") return total - item.weight;
    return total;
  }, 0);
}

function safeItemStockWeight() {
  return (state.safeItems || [])
    .filter((item) => item.status !== "Out")
    .reduce((total, item) => total + Number(item.netWeight ?? item.grossWeight ?? 0), 0);
}

function safeLockerBalance(locker, safeKind = "all") {
  return Number(weight3((state.safeItems || [])
    .filter((item) => item.status !== "Out" && safeLockerForPurity(item.locker || item.purity) === locker && safeItemMatchesKind(item, safeKind))
    .reduce((total, item) => total + Number(item.netWeight ?? item.grossWeight ?? 0), 0)));
}

function safeItemMatchesKind(item, safeKind = "all") {
  const kind = normalizeSafeKind(safeKind);
  return kind === "all" || safeItemKind(item) === kind;
}

function normalizeSafeKind(value = "") {
  const text = String(value || "").toLowerCase().trim();
  if (["rod", "wastage"].includes(text)) return text;
  return "all";
}

function safeItemKind(item = {}) {
  const savedKind = normalizeSafeKind(item.safeKind);
  if (savedKind !== "all") return savedKind;
  const sourceLine = String(item.sourceLine || "").toLowerCase();
  const description = String(item.description || "").toLowerCase();
  if (["rod1weight", "rod2weight", "castingitemweight"].includes(sourceLine)) return "rod";
  if (description.includes("rod") || description.includes("casting item")) return "rod";
  if (
    sourceLine.includes("wastage")
    || sourceLine === "treecutweight"
    || sourceLine === "scrapdustweight"
    || sourceLine === "otherreceivedweight"
    || description.includes("wastage")
    || description.includes("tree cut")
    || description.includes("scrap")
    || description.includes("dust")
    || description.includes("other received")
  ) return "wastage";
  return "rod";
}

function safeKindLabel(kindOrItem = "") {
  const kind = typeof kindOrItem === "string" ? normalizeSafeKind(kindOrItem) : safeItemKind(kindOrItem);
  return kind === "wastage" ? "Wastage / Scrap" : "Rod / Casting";
}

function safeTextKey(value = "") {
  return String(value || "-").trim() || "-";
}

function safeShelfKey(parts = []) {
  return parts.map((part) => encodeURIComponent(safeTextKey(part))).join("|");
}

function safeShelfId(parts = []) {
  return `shelf:${safeShelfKey(parts)}`;
}

function isSafeShelfId(value = "") {
  return String(value || "").startsWith("shelf:");
}

function isCastingIssueStock(item = {}) {
  if (!item || item.status === "Out" || safeItemKind(item) !== "rod") return false;
  const sourceLine = String(item.sourceLine || "").toLowerCase();
  const description = String(item.description || "").toLowerCase();
  return sourceLine === "castingitemweight"
    || description.includes("casting item")
    || description.includes("casting shelf");
}

function castingShelfGroups(purity = "") {
  const lockerFilter = purity ? safeLockerForPurity(purity) : "";
  const groups = new Map();
  (state.safeItems || [])
    .filter((item) => isCastingIssueStock(item) && (!lockerFilter || safeLockerForPurity(item.locker || item.purity) === lockerFilter))
    .forEach((item) => {
      const locker = safeLockerForPurity(item.locker || item.purity);
      const colour = safeTextKey(safeItemColour(item) || "Mixed");
      const desiredPurity = displayPurity(safeItemDesiredPurity(item));
      const key = safeShelfKey([locker, colour, desiredPurity]);
      const existing = groups.get(key) || {
        id: safeShelfId([locker, colour, desiredPurity]),
        virtualSafeGroup: true,
        locker,
        purity: desiredPurity,
        description: `${safeIssueSourceName({ locker })} Casting Shelf`,
        source: "Combined Casting Shelf",
        sourceLine: "castingItemWeight",
        colour,
        desiredPurity,
        safeKind: "rod",
        status: "In Safe",
        grossWeight: 0,
        waxStoneWeight: 0,
        netWeight: 0,
        items: [],
      };
      existing.grossWeight = Number(weight3(existing.grossWeight + Number(item.grossWeight || 0)));
      existing.waxStoneWeight = Number(weight3(existing.waxStoneWeight + safeItemWaxStoneWeight(item)));
      existing.netWeight = Number(weight3(existing.netWeight + safeItemAvailableWeight(item)));
      existing.items.push(item);
      groups.set(key, existing);
    });
  return [...groups.values()].sort((a, b) =>
    `${a.locker} ${a.colour} ${a.desiredPurity}`.localeCompare(`${b.locker} ${b.colour} ${b.desiredPurity}`)
  );
}

function safeItemColour(item = {}) {
  if (item.colour) return item.colour;
  const description = String(item.description || "");
  const descParts = description.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (descParts.length > 1) {
    const candidate = descParts.at(-1);
    if (!/(correction|factory issue|issued|return)/i.test(candidate)) return candidate;
  }
  const sourceMatch = String(item.source || "").match(/^(.+?)\s+melting/i);
  return sourceMatch ? sourceMatch[1].trim() : "";
}

function safeItemDesiredPurity(item = {}) {
  return item.desiredPurity || item.purity || item.locker || "";
}

function safeItemNetFromGross(grossWeight, waxStoneWeight = 0) {
  return Number(weight3(Math.max(Number(grossWeight || 0) - Number(waxStoneWeight || 0), 0)));
}

function safeItemWaxStoneWeight(item = {}) {
  const grossWeight = Number(item.grossWeight || 0);
  const netWeight = Number(item.netWeight ?? grossWeight);
  const inferredWax = Math.max(grossWeight - netWeight, 0);
  return Number(weight3(item.waxStoneWeight ?? inferredWax));
}

function safeItemAvailableWeight(item = {}) {
  return Number(weight3(item.netWeight ?? item.grossWeight ?? 0));
}

function issueFromSafeLocker(locker, weight, reference, sourceId = "", safeKind = "all") {
  let remaining = Number(weight3(weight));
  if (remaining <= 0) return true;
  const activeItems = (state.safeItems || [])
    .filter((item) => item.status !== "Out" && safeLockerForPurity(item.locker || item.purity) === locker && safeItemMatchesKind(item, safeKind))
    .slice()
    .reverse();
  for (const item of activeItems) {
    if (remaining <= 0) break;
    const itemNet = Number(item.netWeight ?? item.grossWeight ?? 0);
    if (itemNet <= 0) continue;
    const take = Number(weight3(Math.min(itemNet, remaining)));
    const itemGross = Number(item.grossWeight || itemNet);
    const itemWax = safeItemWaxStoneWeight(item);
    const waxTake = itemNet ? Number(weight3((take / itemNet) * itemWax)) : 0;
    const grossTake = Number(weight3(Math.min(itemGross, take + waxTake)));
    if (take >= itemNet - 0.0005) {
      item.status = "Out";
      item.outDate = today();
      item.remarks = reference;
    } else {
      item.netWeight = Number(weight3(itemNet - take));
      item.waxStoneWeight = Number(weight3(Math.max(itemWax - waxTake, 0)));
      item.grossWeight = Number(weight3(Math.max(itemGross - grossTake, 0)));
      addSafeItem({
        date: today(),
        locker,
        purity: item.purity || locker,
        description: `${item.description || locker} - Factory Issue`,
        source: reference,
        sourceType: "factory-issue",
        sourceId,
        sourceLine: item.sourceLine || "",
        colour: item.colour || safeItemColour(item),
        desiredPurity: item.desiredPurity || safeItemDesiredPurity(item),
        safeKind: safeItemKind(item),
        grossWeight: grossTake,
        waxStoneWeight: waxTake,
        netWeight: take,
        status: "Out",
        outDate: today(),
        remarks: reference,
      });
    }
    remaining = Number(weight3(remaining - take));
  }
  return remaining <= 0.0005;
}

function issueFromSafeItem(itemId, weight, reference, sourceId = "", issueDetails = {}) {
  const item = findById("safeItems", itemId);
  if (!item || item.status === "Out") return false;
  const take = Number(weight3(weight));
  const itemNet = safeItemAvailableWeight(item);
  if (take <= 0 || take > itemNet + 0.0005) return false;
  const itemGross = Number(item.grossWeight || itemNet);
  const itemWax = safeItemWaxStoneWeight(item);
  const explicitWax = Object.prototype.hasOwnProperty.call(issueDetails, "waxStoneWeight");
  const waxTake = explicitWax
    ? Number(weight3(Math.min(itemWax, Number(issueDetails.waxStoneWeight || 0))))
    : itemNet
      ? Number(weight3((take / itemNet) * itemWax))
      : 0;
  const grossTake = Number(weight3(Math.min(itemGross, take + waxTake)));
  if (take >= itemNet - 0.0005) {
    item.status = "Out";
    item.outDate = today();
    item.remarks = reference;
  } else {
    item.netWeight = Number(weight3(itemNet - take));
    item.waxStoneWeight = Number(weight3(Math.max(itemWax - waxTake, 0)));
    item.grossWeight = Number(weight3(Math.max(itemGross - grossTake, 0)));
    addSafeItem({
      date: today(),
      locker: item.locker || item.purity,
      purity: item.purity || item.locker,
      description: `${item.description || "Casting item"} - Factory Issue`,
      source: reference,
      sourceType: "factory-issue",
      sourceId,
      sourceLine: item.sourceLine || "",
      colour: safeItemColour(item),
      desiredPurity: safeItemDesiredPurity(item),
      safeKind: safeItemKind(item),
      grossWeight: grossTake,
      waxStoneWeight: waxTake,
      netWeight: take,
      status: "Out",
      outDate: today(),
      remarks: reference,
    });
  }
  return true;
}

function issueFromSafeSelection(selection, weight, reference, sourceId = "", issueDetails = {}) {
  if (!selection) return false;
  if (selection.virtualSafeGroup) return issueFromSafeGroup(selection, weight, reference, sourceId, issueDetails);
  return issueFromSafeItem(selection.id, weight, reference, sourceId, issueDetails);
}

function issueFromSafeGroup(group, weight, reference, sourceId = "", issueDetails = {}) {
  let remainingNet = Number(weight3(weight));
  let remainingWax = Number(weight3(issueDetails.waxStoneWeight || 0));
  const totalNet = remainingNet;
  const items = [...(group.items || [])].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  for (const item of items) {
    if (remainingNet <= 0.0005) break;
    const itemNet = safeItemAvailableWeight(item);
    if (itemNet <= 0) continue;
    const takeNet = Number(weight3(Math.min(itemNet, remainingNet)));
    const proportionalWax = totalNet > 0 ? Number(weight3((takeNet / totalNet) * Number(issueDetails.waxStoneWeight || 0))) : 0;
    const targetWax = remainingNet - takeNet <= 0.0005 ? remainingWax : proportionalWax;
    const takeWax = Number(weight3(Math.min(safeItemWaxStoneWeight(item), remainingWax, targetWax)));
    issueFromSafeItem(item.id, takeNet, reference, sourceId, { waxStoneWeight: takeWax });
    remainingNet = Number(weight3(remainingNet - takeNet));
    remainingWax = Number(weight3(Math.max(remainingWax - takeWax, 0)));
  }
  return remainingNet <= 0.0005;
}

function factoryInWeight() {
  const safeStock = safeItemStockWeight();
  const activeProduction = state.lots
    .filter((lot) => lot.status !== "Completed")
    .reduce((total, lot) => total + Number(currentTransferIssueWeight(lot) || lot.issuedWeight || 0), 0);
  const billPending = state.lots.reduce((total, lot) => {
    if (lot.status !== "Completed") return total;
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    if (bill?.items?.length) return total + billProductionStockWeight(bill);
    return total + Number(lot.finishedWeight || 0);
  }, 0);
  return Number(weight3(safeStock + activeProduction + billPending));
}

function addSafeItem(item) {
  state.safeItems = state.safeItems || [];
  const grossWeight = Number(weight3(item.grossWeight || 0));
  const waxStoneWeight = Number(weight3(item.waxStoneWeight ?? Math.max(grossWeight - Number(item.netWeight ?? grossWeight), 0)));
  const netWeight = Number(weight3(item.netWeight ?? safeItemNetFromGross(grossWeight, waxStoneWeight)));
  state.safeItems.unshift({
    id: item.id || crypto.randomUUID(),
    date: item.date || today(),
    locker: safeLockerForPurity(item.locker || item.purity),
    purity: item.purity || item.locker || "",
    description: item.description || "",
    source: item.source || "",
    sourceType: item.sourceType || "",
    sourceId: item.sourceId || "",
    sourceLine: item.sourceLine || "",
    colour: item.colour || safeItemColour(item),
    desiredPurity: item.desiredPurity || safeItemDesiredPurity(item),
    safeKind: safeItemKind(item),
    grossWeight,
    waxStoneWeight,
    netWeight,
    status: item.status || "In Safe",
    outDate: item.outDate || "",
    remarks: item.remarks || "",
  });
}

function moveSafeItemOut(itemId) {
  const item = findById("safeItems", itemId);
  if (!item) return;
  const reason = prompt(`Move ${item.description || item.locker} out of safe? Enter reason/reference:`, "Issued from safe");
  if (reason === null) return;
  item.status = "Out";
  item.outDate = today();
  item.remarks = reason || "Issued from safe";
  saveState();
  render();
}

function safeLockerForPurity(value) {
  const text = String(value || "").toUpperCase().trim();
  if (SAFE_LOCKERS.includes(text)) return text;
  const percent = purityPercent(value);
  if (!Number.isFinite(percent) || percent <= 0) return "18K";
  const karat = (percent / 100) * 24;
  return SAFE_LOCKERS.reduce((closest, locker) => {
    const currentDiff = Math.abs(Number(locker.replace("K", "")) - karat);
    const closestDiff = Math.abs(Number(closest.replace("K", "")) - karat);
    return currentDiff < closestDiff ? locker : closest;
  }, "18K");
}

function syncMeltingReceiveSafeItems(melting) {
  const sourceId = melting.id;
  state.safeItems = (state.safeItems || []).filter((item) => !(item.sourceType === "melting-receive" && item.sourceId === sourceId));
  const breakup = melting.receiveBreakup || {};
  const locker = safeLockerForPurity(melting.targetPurity);
  const batchName = melting.batchName || assignMeltingBatchName(melting);
  const source = `${batchName} / ${melting.departmentName || "department"}`.trim();
  const lines = [
    ["rod1Weight", "Rod 1"],
    ["rod2Weight", "Rod 2"],
    ["wastage1Weight", "Wastage 1"],
    ["wastage2Weight", "Wastage 2"],
    ["castingItemWeight", "Rod / Casting Item"],
    ["treeCutWeight", "Tree Cut"],
    ["wastageWeight", "Wastage"],
    ["scrapDustWeight", "Scrap / Dust"],
    ["otherReceivedWeight", "Other Received"],
  ];
  lines.forEach(([field, label]) => {
    const weight = Number(breakup[field] || 0);
    if (weight <= 0) return;
    const waxStoneWeight = field === "castingItemWeight" ? meltingReceiveWaxStoneWeight(breakup) : 0;
    addSafeItem({
      date: melting.receivedDate || today(),
      locker,
      purity: formatPurity(melting.targetPurity),
      description: `${label} - ${melting.colour || "Melting"}`,
      source,
      sourceType: "melting-receive",
      sourceId,
      sourceLine: field,
      colour: melting.colour || "",
      desiredPurity: formatPurity(melting.targetPurity),
      grossWeight: weight,
      waxStoneWeight,
      netWeight: safeItemNetFromGross(weight, waxStoneWeight),
      status: "In Safe",
    });
  });
}

function addMetalSafeMovement(movement) {
  state.metalSafeMovements = state.metalSafeMovements || [];
  const weight = Number(weight3(movement.weight || 0));
  if (weight <= 0) return;
  state.metalSafeMovements.unshift({
    id: movement.id || crypto.randomUUID(),
    date: movement.date || today(),
    type: movement.type || (movement.direction === "out" ? "Out" : "In"),
    direction: movement.direction || "in",
    purity: movement.purity || "",
    weight,
    reference: movement.reference || "",
    sourceType: movement.sourceType || "",
    sourceId: movement.sourceId || "",
  });
}

function metalSafeMovementSign(movement = {}) {
  if (movement.direction === "out") return -1;
  if (movement.direction === "in") return 1;
  return ["out", "issue", "melt issue", "production issue", "casting issue"].some((word) => String(movement.type || "").toLowerCase().includes(word)) ? -1 : 1;
}

function metalSafeBalances() {
  return (state.metalSafeMovements || []).reduce((balances, movement) => {
    const purity = normalizeMetalSafePurity(movement.purity);
    const current = balances[purity] || { purity, weight: 0, fineGold: 0 };
    const signedWeight = metalSafeMovementSign(movement) * Number(movement.weight || 0);
    current.weight = Number(weight3(current.weight + signedWeight));
    current.fineGold = Number(weight3(current.fineGold + fineGoldWeight(signedWeight, purity)));
    balances[purity] = current;
    return balances;
  }, {});
}

function metalSafeBalanceTotal() {
  return Object.values(metalSafeBalances()).reduce((total, item) => Number(weight3(total + Number(item.weight || 0))), 0);
}

function metalSafeBalanceForPurity(purity) {
  return Number(metalSafeBalances()[normalizeMetalSafePurity(purity)]?.weight || 0);
}

function factoryMaterialLabel(value = "") {
  const key = String(value || "").toLowerCase();
  if (key === "raw-metal") return "Raw Metal / Pure Gold";
  if (key === "casting-item") return "Casting Item / Rod";
  if (key === "wastage") return "Wastage / Scrap";
  if (key === "bill") return "Bill / Factory Out";
  return "Other Stock Item";
}

function factoryStockPosting(entry = {}) {
  if (entry.stockPosting) return entry.stockPosting;
  if (entry.materialType === "raw-metal") return "Metal Safe";
  if (entry.direction === "out") return "Factory Out";
  return `${safeLockerForPurity(entry.purity)} Shelf`;
}

function findVendorByName(name = "") {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return null;
  return (state.vendors || []).find((vendor) => String(vendor.name || "").trim().toLowerCase() === normalized) || null;
}

function findOrCreateVendorByName(name = "") {
  const cleanName = String(name || "").trim() || "Unknown Party";
  const existing = findVendorByName(cleanName);
  if (existing) return existing;
  const vendor = {
    id: crypto.randomUUID(),
    name: cleanName,
    phone: "",
    city: "",
    remarks: "Auto-created from bill factory out",
  };
  state.vendors = state.vendors || [];
  state.vendors.unshift(vendor);
  return vendor;
}

function addFactoryLedgerEntry(entry = {}) {
  state.factoryLedger = state.factoryLedger || [];
  const weight = Number(weight3(entry.weight || 0));
  if (weight <= 0) return null;
  const purity = entry.purity || "";
  const wstgPercent = factoryWstgPercent(entry.wstgPercent ?? entry.wastagePercent);
  const baseFineGold = fineGoldWeight(weight, purity);
  const wstgFineGold = Number(weight3(entry.wstgFineGold ?? (weight * (wstgPercent / 100))));
  const ledgerEntry = {
    id: entry.id || crypto.randomUUID(),
    date: entry.date || today(),
    direction: entry.direction || "in",
    type: entry.type || (entry.direction === "out" ? "Factory Out" : "Factory In"),
    vendorId: entry.vendorId || "",
    vendorName: entry.vendorName || "",
    materialType: entry.materialType || "other",
    purity,
    weight,
    wstgPercent,
    wastagePercent: wstgPercent,
    baseFineGold,
    wstgFineGold,
    fineGold: Number(weight3(baseFineGold + wstgFineGold)),
    stockPosting: factoryStockPosting(entry),
    reference: entry.reference || "",
    remarks: entry.remarks || "",
    sourceType: entry.sourceType || "",
    sourceId: entry.sourceId || "",
    sourceLine: entry.sourceLine || "",
  };
  state.factoryLedger.unshift(ledgerEntry);
  return ledgerEntry;
}

function factoryWstgPercent(value = 0) {
  const percent = Number(value || 0);
  return Number.isFinite(percent) && percent > 0 ? Number(percent.toFixed(2)) : 0;
}

function factoryFineGoldBreakup(entry = {}) {
  const baseFineGold = Number(entry.baseFineGold ?? fineGoldWeight(entry.weight, entry.purity));
  const wstgPercent = factoryWstgPercent(entry.wstgPercent ?? entry.wastagePercent);
  const weight = Number(entry.weight || 0);
  const wstgFineGold = Number(entry.wstgFineGold ?? Number(weight3(weight * (wstgPercent / 100))));
  const fineGold = Number(weight3(baseFineGold + wstgFineGold));
  return { baseFineGold, wstgPercent, wstgFineGold, fineGold };
}

function addFactoryInEntry({ vendor, materialType, purity, weight, wstgPercent, reference, remarks }) {
  const material = materialType || "raw-metal";
  const ledgerEntry = addFactoryLedgerEntry({
    direction: "in",
    type: "Factory In",
    vendorId: vendor.id,
    vendorName: vendor.name,
    materialType: material,
    purity,
    weight,
    wstgPercent,
    reference,
    remarks,
    stockPosting: material === "raw-metal" ? "Metal Safe" : `${safeLockerForPurity(purity)} Shelf`,
    sourceType: "factory-in",
  });
  if (!ledgerEntry) return null;
  ledgerEntry.sourceId = ledgerEntry.id;
  const sourceText = `${vendor.name} - ${reference || factoryMaterialLabel(material)}`;
  if (material === "raw-metal") {
    addMetalSafeMovement({
      date: ledgerEntry.date,
      type: "Factory In",
      direction: "in",
      purity,
      weight,
      reference: sourceText,
      sourceType: "factory-in",
      sourceId: ledgerEntry.id,
    });
  } else {
    addSafeItem({
      date: ledgerEntry.date,
      locker: safeLockerForPurity(purity),
      purity,
      description: reference || factoryMaterialLabel(material),
      source: sourceText,
      sourceType: "factory-in",
      sourceId: ledgerEntry.id,
      sourceLine: material,
      safeKind: material === "wastage" ? "wastage" : "rod",
      grossWeight: weight,
      waxStoneWeight: 0,
      netWeight: weight,
      status: "In Safe",
      remarks: remarks || "",
    });
  }
  return ledgerEntry;
}

function factorySafeKindForMaterial(materialType = "") {
  if (materialType === "wastage") return "wastage";
  if (materialType === "casting-item") return "rod";
  return "all";
}

function factoryOutAvailableWeight(materialType = "", purity = "") {
  if (materialType === "raw-metal") return metalSafeBalanceForPurity(purity);
  return safeLockerBalance(safeLockerForPurity(purity), factorySafeKindForMaterial(materialType));
}

function factoryOutStockPosting(materialType = "", purity = "") {
  if (materialType === "raw-metal") return `Metal Safe ${normalizeMetalSafePurity(purity)}`;
  const kindText = materialType === "wastage"
    ? "Wastage"
    : materialType === "casting-item"
      ? "Rod / Casting"
      : "Shelf Stock";
  return `${safeLockerForPurity(purity)} Shelf ${kindText}`;
}

function addFactoryOutEntry({ vendor, materialType, purity, weight, wstgPercent, reference, remarks }) {
  const material = materialType || "raw-metal";
  const cleanPurity = purity || "";
  const outWeight = Number(weight3(weight || 0));
  const available = Number(factoryOutAvailableWeight(material, cleanPurity) || 0);
  if (outWeight <= 0) return null;
  if (outWeight > available + 0.0005) {
    alert(`Only ${gram(available)} available for ${factoryOutStockPosting(material, cleanPurity)}.`);
    return null;
  }
  const ledgerId = crypto.randomUUID();
  const sourceText = `${vendor.name} - ${reference || factoryMaterialLabel(material)} factory out`;
  if (material === "raw-metal") {
    addMetalSafeMovement({
      date: today(),
      type: "Factory Out",
      direction: "out",
      purity: cleanPurity,
      weight: outWeight,
      reference: sourceText,
      sourceType: "factory-out",
      sourceId: ledgerId,
    });
  } else {
    const issued = issueFromSafeLocker(
      safeLockerForPurity(cleanPurity),
      outWeight,
      sourceText,
      ledgerId,
      factorySafeKindForMaterial(material)
    );
    if (!issued) {
      alert(`Could not issue ${gram(outWeight)} from ${factoryOutStockPosting(material, cleanPurity)}.`);
      return null;
    }
  }
  return addFactoryLedgerEntry({
    id: ledgerId,
    direction: "out",
    type: "Metal / Stock Factory Out",
    vendorId: vendor.id,
    vendorName: vendor.name,
    materialType: material,
    purity: cleanPurity,
    weight: outWeight,
    wstgPercent,
    reference,
    remarks,
    stockPosting: factoryOutStockPosting(material, cleanPurity),
    sourceType: "factory-out",
    sourceId: ledgerId,
  });
}

function factoryEntryStockSourceId(entry = {}) {
  return entry.sourceId || entry.id || "";
}

function factoryEntrySimpleStockType(entry = {}) {
  if (entry.sourceType === "bill") return "none";
  if (entry.direction === "out" && entry.materialType !== "raw-metal") return "ledger-only";
  if (entry.materialType === "raw-metal") return "metal";
  return entry.direction === "in" ? "safe-in" : "ledger-only";
}

function removeFactoryEntryStockPosting(entry = {}) {
  const sourceId = factoryEntryStockSourceId(entry);
  if (!sourceId) return;
  const stockType = factoryEntrySimpleStockType(entry);
  if (stockType === "metal") {
    state.metalSafeMovements = (state.metalSafeMovements || []).filter((movement) => movement.sourceId !== sourceId);
  } else if (stockType === "safe-in") {
    state.safeItems = (state.safeItems || []).filter((item) => !(item.sourceType === "factory-in" && item.sourceId === sourceId));
  }
}

function postFactoryEntryStockPosting(entry = {}) {
  const stockType = factoryEntrySimpleStockType(entry);
  if (stockType === "none" || stockType === "ledger-only") return;
  const sourceId = factoryEntryStockSourceId(entry);
  const reference = `${entry.vendorName || "Factory"} - ${entry.reference || factoryMaterialLabel(entry.materialType)}`;
  if (stockType === "metal") {
    addMetalSafeMovement({
      date: entry.date || today(),
      type: entry.direction === "out" ? "Factory Out" : "Factory In",
      direction: entry.direction || "in",
      purity: entry.purity,
      weight: entry.weight,
      reference,
      sourceType: entry.sourceType || (entry.direction === "out" ? "factory-out" : "factory-in"),
      sourceId,
    });
  } else if (stockType === "safe-in") {
    addSafeItem({
      date: entry.date || today(),
      locker: safeLockerForPurity(entry.purity),
      purity: entry.purity,
      description: entry.reference || factoryMaterialLabel(entry.materialType),
      source: reference,
      sourceType: "factory-in",
      sourceId,
      sourceLine: entry.materialType || "",
      safeKind: entry.materialType === "wastage" ? "wastage" : "rod",
      grossWeight: entry.weight,
      waxStoneWeight: 0,
      netWeight: entry.weight,
      status: "In Safe",
      remarks: entry.remarks || "",
    });
  }
}

function updateFactoryEntryStockPosting(oldEntry = {}, newEntry = {}) {
  removeFactoryEntryStockPosting(oldEntry);
  postFactoryEntryStockPosting(newEntry);
}

function billCustomerNameForState(source, lot = {}, bill = {}) {
  const orderIds = lot.orderIds?.length ? lot.orderIds : [lot.orderId].filter(Boolean);
  const firstOrder = orderIds.map((id) => (source.orders || []).find((order) => order.id === id)).find(Boolean);
  const customer = firstOrder?.customerId
    ? (source.customers || []).find((item) => item.id === firstOrder.customerId)
    : null;
  return firstOrder?.customer || customer?.name || lot.customer || bill.customer || lot.customerName || "Unknown Party";
}

function findOrCreateVendorByNameInState(source, name = "") {
  const cleanName = String(name || "").trim() || "Unknown Party";
  source.vendors = source.vendors || [];
  const existing = source.vendors.find((vendor) => String(vendor.name || "").trim().toLowerCase() === cleanName.toLowerCase());
  if (existing) return existing;
  const vendor = {
    id: crypto.randomUUID(),
    name: cleanName,
    phone: "",
    city: "",
    remarks: "Auto-created from bill factory out",
  };
  source.vendors.unshift(vendor);
  return vendor;
}

function factoryBillLedgerKey(sourceId = "", sourceLine = "") {
  return `${sourceId || ""}::${sourceLine || ""}`;
}

function mergeFactoryBillLedgerEdit(baseEntry = {}, editEntry = {}) {
  const editableFields = [
    "date",
    "direction",
    "type",
    "vendorId",
    "vendorName",
    "materialType",
    "purity",
    "weight",
    "wstgPercent",
    "wastagePercent",
    "reference",
    "remarks",
    "stockPosting",
  ];
  const merged = { ...baseEntry };
  editableFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(editEntry, field)) merged[field] = editEntry[field];
  });
  merged.sourceType = "bill";
  merged.sourceId = baseEntry.sourceId;
  merged.sourceLine = baseEntry.sourceLine;
  merged.manualFactoryEdit = true;
  merged.editedAt = editEntry.editedAt || new Date().toISOString();
  const fine = factoryFineGoldBreakup(merged);
  merged.baseFineGold = fine.baseFineGold;
  merged.wstgPercent = fine.wstgPercent;
  merged.wastagePercent = fine.wstgPercent;
  merged.wstgFineGold = fine.wstgFineGold;
  merged.fineGold = fine.fineGold;
  return merged;
}

function syncFactoryOutLedgerForState(source) {
  const manualBillEdits = new Map();
  (source.factoryLedger || []).forEach((entry) => {
    if (entry.sourceType === "bill" && entry.manualFactoryEdit) {
      manualBillEdits.set(factoryBillLedgerKey(entry.sourceId, entry.sourceLine), entry);
    }
  });
  source.factoryLedger = (source.factoryLedger || []).filter((entry) => entry.sourceType !== "bill");
  (source.bills || []).forEach((bill) => {
    if (!bill?.id) return;
    const lot = (source.lots || []).find((item) => item.id === bill.lotId);
    if (!lot) return;
    const vendor = findOrCreateVendorByNameInState(source, billCustomerNameForState(source, lot, bill));
    (bill.items || []).forEach((item, index) => {
      if (item.discardStatus) return;
      const netWeight = Number(item.netWeight || 0);
      if (netWeight <= 0) return;
      const order = (source.orders || []).find((entry) => entry.id === item.orderId) || {};
      const purity = item.purity || order.purity || lot.metalPurity || "18K";
      const productionNo = item.productionNo || order.productionNo || order.jobNumber || `Item ${index + 1}`;
      const baseEntry = {
        id: `bill-${bill.id}-${item.orderId || productionNo || index}`,
        date: bill.billDate || today(),
        direction: "out",
        type: "Bill / Factory Out",
        vendorId: vendor.id,
        vendorName: vendor.name,
        materialType: "bill",
        purity,
        weight: Number(weight3(netWeight)),
        wstgPercent: 0,
        wastagePercent: 0,
        baseFineGold: fineGoldWeight(netWeight, purity),
        wstgFineGold: 0,
        fineGold: fineGoldWeight(netWeight, purity),
        stockPosting: "Factory Out By Bill",
        reference: [bill.billNo || "Bill", lot.orderNumber || bill.jobNumber || "", productionNo].filter(Boolean).join(" / "),
        remarks: bill.remarks || "",
        sourceType: "bill",
        sourceId: bill.id,
        sourceLine: item.orderId || productionNo || String(index),
      };
      const manualEdit = manualBillEdits.get(factoryBillLedgerKey(baseEntry.sourceId, baseEntry.sourceLine));
      source.factoryLedger.unshift(manualEdit ? mergeFactoryBillLedgerEdit(baseEntry, manualEdit) : baseEntry);
    });
  });
}

function syncFactoryOutForBill() {
  syncFactoryOutLedgerForState(state);
}

function factoryLedgerTotals() {
  return (state.factoryLedger || []).reduce((totals, entry) => {
    const fine = factoryFineGoldBreakup(entry).fineGold;
    if (entry.direction === "out") totals.outFine = Number(weight3(totals.outFine + fine));
    else totals.inFine = Number(weight3(totals.inFine + fine));
    totals.balanceFine = Number(weight3(totals.inFine - totals.outFine));
    return totals;
  }, { inFine: 0, outFine: 0, balanceFine: 0 });
}

function factoryPhysicalFineStock() {
  const metalFine = Object.values(metalSafeBalances()).reduce((total, item) => Number(weight3(total + Number(item.fineGold || 0))), 0);
  const shelfFine = (state.safeItems || [])
    .filter((item) => item.status !== "Out")
    .reduce((total, item) => Number(weight3(total + fineGoldWeight(item.netWeight ?? item.grossWeight ?? 0, safeItemDesiredPurity(item)))), 0);
  const productionFine = (state.lots || [])
    .filter((lot) => lot.status !== "Completed")
    .reduce((total, lot) => {
      const purity = lot.metalPurity || getLotOrders(lot)[0]?.purity || "18K";
      return Number(weight3(total + fineGoldWeight(currentTransferIssueWeight(lot) || lot.issuedWeight || 0, purity)));
    }, 0);
  return {
    metalFine,
    shelfFine,
    productionFine,
    totalFine: Number(weight3(metalFine + shelfFine + productionFine)),
  };
}

function vendorBalanceRows() {
  const rows = new Map();
  (state.vendors || []).forEach((vendor) => {
    rows.set(vendor.id, {
      vendor,
      inFine: 0,
      outFine: 0,
      balanceFine: 0,
    });
  });
  (state.factoryLedger || []).forEach((entry) => {
    const vendorId = entry.vendorId || "";
    const vendor = vendorId ? findById("vendors", vendorId) : null;
    const key = vendorId || entry.vendorName || "opening-stock";
    if (!rows.has(key)) {
      rows.set(key, {
        vendor: vendor || { id: key, name: entry.vendorName || "Opening Stock", phone: "", city: "", remarks: "" },
        inFine: 0,
        outFine: 0,
        balanceFine: 0,
      });
    }
    const row = rows.get(key);
    const fine = factoryFineGoldBreakup(entry).fineGold;
    if (entry.direction === "out") row.outFine = Number(weight3(row.outFine + fine));
    else row.inFine = Number(weight3(row.inFine + fine));
    row.balanceFine = Number(weight3(row.inFine - row.outFine));
  });
  return [...rows.values()].sort((a, b) => String(a.vendor.name || "").localeCompare(String(b.vendor.name || ""), undefined, { sensitivity: "base" }));
}

function factoryVendorFineTotals(rows = vendorBalanceRows()) {
  const payable = rows.reduce((total, row) => Number(weight3(total + Math.max(row.balanceFine, 0))), 0);
  const receivable = rows.reduce((total, row) => Number(weight3(total + Math.max(-row.balanceFine, 0))), 0);
  const netBalance = rows.reduce((total, row) => Number(weight3(total + Number(row.balanceFine || 0))), 0);
  return { payable, receivable, netBalance };
}

function totalFactoryFineStock(physical = factoryPhysicalFineStock(), vendorTotals = factoryVendorFineTotals()) {
  return Number(weight3(Number(physical.totalFine || 0) - Number(vendorTotals.netBalance || 0)));
}

function factoryBalanceStatus(balanceFine) {
  if (balanceFine > 0.0005) return "Payable To Vendor";
  if (balanceFine < -0.0005) return "Receivable From Vendor";
  return "Settled";
}

function normalizeMetalSafePurity(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "-";
  if (text.endsWith("%")) {
    const percentValue = Number(text.replace("%", ""));
    return Number.isFinite(percentValue) ? `${percentValue.toFixed(2)}%` : text;
  }
  if (text.endsWith("K")) return text;
  const percent = Number(text);
  return Number.isFinite(percent) ? `${percent.toFixed(2)}%` : text;
}

function metalSafeAvailableOptions() {
  return Object.values(metalSafeBalances())
    .filter((item) => Number(item.weight || 0) > 0)
    .sort((a, b) => a.purity.localeCompare(b.purity));
}

function renderMetalSafeSourceOptions(selected = "") {
  const selectedPurity = selected ? normalizeMetalSafePurity(selected) : "";
  const available = metalSafeAvailableOptions();
  if (selectedPurity && !available.some((item) => item.purity === selectedPurity)) {
    available.unshift({ purity: selectedPurity, weight: 0, selectedOnly: true });
  }
  const options = available.map((item) => {
    const label = item.selectedOnly
      ? `${item.purity} / already issued`
      : `${item.purity} / ${gram(item.weight)}`;
    return `<option value="${escapeHtml(item.purity)}" ${item.purity === selectedPurity ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  return `<option value="">Manual source</option>${options}`;
}

function renderSafeLockerRodOptions(selected = "") {
  const options = SAFE_LOCKERS
    .map((locker) => ({ locker, weight: safeLockerBalance(locker, "rod") }))
    .filter((item) => item.weight > 0 || item.locker === selected)
    .map((item) =>
      `<option value="${escapeHtml(item.locker)}" ${item.locker === selected ? "selected" : ""}>${escapeHtml(item.locker)} Safe / Rod ${gram(item.weight)}</option>`
    )
    .join("");
  return options || '<option value="">No rod in safe</option>';
}

function renderSafeLockerWastageOptions(selected = "") {
  const options = SAFE_LOCKERS
    .map((locker) => ({ locker, weight: safeLockerBalance(locker, "wastage") }))
    .filter((item) => item.weight > 0 || item.locker === selected)
    .map((item) =>
      `<option value="${escapeHtml(item.locker)}" ${item.locker === selected ? "selected" : ""}>${escapeHtml(item.locker)} Safe / Wastage ${gram(item.weight)}</option>`
    )
    .join("");
  return options || '<option value="">No wastage in safe</option>';
}

function refreshMeltingSafeSourceOptions() {
  document.querySelectorAll('select[name="sourceMetalSafePurity"]').forEach((select) => {
    const selected = select.value;
    select.innerHTML = renderMetalSafeSourceOptions(selected);
    if (selected && ![...select.options].some((option) => option.value === selected)) select.value = "";
  });
  document.querySelectorAll('select[name="sourceSafeLocker"]').forEach((select) => {
    const selected = select.value;
    select.innerHTML = renderSafeLockerRodOptions(selected);
    if (selected && ![...select.options].some((option) => option.value === selected)) select.value = "";
    updateMeltingSourceRowMode(select.closest(".source-row"));
  });
  document.querySelectorAll('select[name="sourceWastageLocker"]').forEach((select) => {
    const selected = select.value;
    select.innerHTML = renderSafeLockerWastageOptions(selected);
    if (selected && ![...select.options].some((option) => option.value === selected)) select.value = "";
    updateMeltingSourceRowMode(select.closest(".source-row"));
  });
}

function applyMetalSafeSelectionToMeltingRow(select) {
  const row = select.closest(".source-row");
  if (!row) return;
  const purity = select.value;
  if (!purity) return;
  const purityInput = row.querySelector('[name="sourcePurity"]');
  if (purityInput) purityInput.value = weight3(purityPercent(purity)).replace(/\.000$/, "");
}

function applySafeLockerSelectionToMeltingRow(select) {
  const row = select.closest(".source-row");
  if (!row) return;
  const locker = select.value;
  if (!locker) return;
  const purityInput = row.querySelector('[name="sourcePurity"]');
  if (purityInput) purityInput.value = weight3(purityPercent(locker)).replace(/\.000$/, "");
}

function updateMeltingSourceRowMode(row) {
  if (!row) return;
  const sourceKind = row.querySelector('[name="sourceKind"]')?.value || "metal";
  const isRod = sourceKind === "rod";
  const isWastage = sourceKind === "wastage";
  row.querySelector(".melting-metal-safe-field")?.classList.toggle("hidden", isRod || isWastage);
  row.querySelector(".melting-rod-safe-field")?.classList.toggle("hidden", !isRod);
  row.querySelector(".melting-wastage-safe-field")?.classList.toggle("hidden", !isWastage);
  const metalSelect = row.querySelector('[name="sourceMetalSafePurity"]');
  const lockerSelect = row.querySelector('[name="sourceSafeLocker"]');
  const wastageSelect = row.querySelector('[name="sourceWastageLocker"]');
  if (metalSelect) metalSelect.disabled = isRod || isWastage;
  if (lockerSelect) lockerSelect.disabled = !isRod;
  if (wastageSelect) wastageSelect.disabled = !isWastage;
  if (isRod) applySafeLockerSelectionToMeltingRow(lockerSelect);
  else if (isWastage) applySafeLockerSelectionToMeltingRow(wastageSelect);
  else applyMetalSafeSelectionToMeltingRow(metalSelect);
}

function validateMetalSafeIssue(sourceMetals = [], creditMetals = []) {
  const requiredByPurity = sourceMetals.reduce((acc, metal) => {
    if (["rod", "wastage"].includes(metal.sourceKind) || !metal.safePurity) return acc;
    const purity = normalizeMetalSafePurity(metal.safePurity);
    acc[purity] = Number(weight3((acc[purity] || 0) + Number(metal.weight || 0)));
    return acc;
  }, {});
  const creditByPurity = creditMetals.reduce((acc, metal) => {
    if (["rod", "wastage"].includes(metal.sourceKind) || !metal.safePurity) return acc;
    const purity = normalizeMetalSafePurity(metal.safePurity);
    acc[purity] = Number(weight3((acc[purity] || 0) + Number(metal.weight || 0)));
    return acc;
  }, {});
  const balances = metalSafeBalances();
  for (const [purity, required] of Object.entries(requiredByPurity)) {
    const available = Number(weight3(Number(balances[purity]?.weight || 0) + Number(creditByPurity[purity] || 0)));
    if (required > available) {
      return `Metal Safe has only ${gram(available)} of ${purity}. Required for melting is ${gram(required)}.`;
    }
  }
  return "";
}

function validateSafeLockerSourceIssue(sourceMetals = [], creditMetals = []) {
  const requiredByLocker = sourceMetals.reduce((acc, metal) => {
    if (!["rod", "wastage"].includes(metal.sourceKind) || !metal.safeLocker) return acc;
    const locker = safeLockerForPurity(metal.safeLocker);
    const key = `${metal.sourceKind}:${locker}`;
    acc[key] = Number(weight3((acc[key] || 0) + Number(metal.weight || 0)));
    return acc;
  }, {});
  const creditByLocker = creditMetals.reduce((acc, metal) => {
    if (!["rod", "wastage"].includes(metal.sourceKind) || !metal.safeLocker) return acc;
    const locker = safeLockerForPurity(metal.safeLocker);
    const key = `${metal.sourceKind}:${locker}`;
    acc[key] = Number(weight3((acc[key] || 0) + Number(metal.weight || 0)));
    return acc;
  }, {});
  for (const [key, required] of Object.entries(requiredByLocker)) {
    const [kind, locker] = key.split(":");
    const available = Number(weight3(safeLockerBalance(locker, kind) + Number(creditByLocker[key] || 0)));
    if (required > available) {
      return `${locker} Safe has only ${gram(available)} ${kind} available. Required for this melting is ${gram(required)}.`;
    }
  }
  return "";
}

function recordMeltingMetalSafeIssues(sourceMetals = [], meltingId, departmentName = "", batchName = "") {
  sourceMetals.forEach((metal) => {
    if (["rod", "wastage"].includes(metal.sourceKind) || !metal.safePurity) return;
    addMetalSafeMovement({
      type: "Melt Issue",
      direction: "out",
      purity: metal.safePurity,
      weight: metal.weight,
      reference: `${batchName || `Melting ${meltingId}`} issued to ${departmentName || "department"}`,
      sourceType: "melting",
      sourceId: meltingId,
    });
  });
}

function recordMeltingSafeLockerRodIssues(sourceMetals = [], meltingId, departmentName = "", batchName = "") {
  sourceMetals.forEach((metal) => {
    if (!["rod", "wastage"].includes(metal.sourceKind) || !metal.safeLocker) return;
    const locker = safeLockerForPurity(metal.safeLocker);
    const label = metal.sourceKind === "wastage" ? "Wastage" : "Rod";
    issueFromSafeLocker(
      locker,
      metal.weight,
      `${label} from ${locker} Safe used in ${batchName || `melting ${meltingId}`}, issued to ${departmentName || "department"}`,
      meltingId,
      metal.sourceKind
    );
  });
}

function cloneMeltingSourceMetals(sourceMetals = []) {
  return (sourceMetals || []).map((metal) => ({
    weight: Number(metal.weight || 0),
    purity: purityPercent(metal.purity),
    sourceKind: metal.sourceKind || (metal.safeLocker ? "rod" : "metal"),
    safeLocker: metal.safeLocker || "",
    safePurity: metal.safePurity || "",
  }));
}

function removeMeltingIssueRecords(meltingId) {
  state.ledger = (state.ledger || []).filter((entry) => entry.meltingId !== meltingId || entry.type !== "Melt Issue");
  state.metalSafeMovements = (state.metalSafeMovements || []).filter((movement) => !(movement.sourceType === "melting" && movement.sourceId === meltingId));
}

function restoreMeltingRodIssues(sourceMetals = [], meltingId, reason = "Melting issue corrected") {
  sourceMetals.forEach((metal) => {
    if (!["rod", "wastage"].includes(metal.sourceKind) || !metal.safeLocker || Number(metal.weight || 0) <= 0) return;
    const locker = safeLockerForPurity(metal.safeLocker);
    const safeKind = metal.sourceKind === "wastage" ? "wastage" : "rod";
    addSafeItem({
      date: today(),
      locker,
      purity: locker,
      description: `${safeKind === "wastage" ? "Wastage" : "Rod"} returned - melting correction`,
      source: reason,
      sourceType: "melting-rod-return",
      sourceId: meltingId,
      safeKind,
      grossWeight: metal.weight,
      netWeight: metal.weight,
      status: "In Safe",
      remarks: reason,
    });
  });
}

function syncMeltingIssueRecords(melting) {
  removeMeltingIssueRecords(melting.id);
  const batchName = melting.batchName || assignMeltingBatchName(melting);
  state.ledger = state.ledger || [];
  state.ledger.unshift({
    id: crypto.randomUUID(),
    meltingId: melting.id,
    date: melting.date || today(),
    type: "Melt Issue",
    purity: `${formatPurity(melting.targetPurity)}`,
    weight: Number(melting.finalWeight || 0),
    reference: `${batchName}: ${melting.sourceMetals?.length || 1} source metals ${gram(melting.sourceWeight)} to ${formatPurity(melting.targetPurity)} ${melting.colour}, issued to ${melting.departmentName || "department"}`,
  });
  recordMeltingMetalSafeIssues(melting.sourceMetals, melting.id, melting.departmentName, batchName);
  recordMeltingSafeLockerRodIssues(melting.sourceMetals, melting.id, melting.departmentName, batchName);
}

function syncMeltingReceiveRecords(melting) {
  state.ledger = state.ledger || [];
  const receiveBreakup = melting.receiveBreakup || {};
  const grossReceivedWeight = melting.grossReceivedWeight ?? meltingReceiveGrossWeight(receiveBreakup, melting);
  const waxStoneWeight = meltingReceiveWaxStoneWeight(receiveBreakup);
  const batchName = melting.batchName || assignMeltingBatchName(melting);
  state.ledger = (state.ledger || []).filter((entry) => entry.meltingId !== melting.id || entry.type === "Melt Issue");
  state.ledger.unshift({
    id: crypto.randomUUID(),
    meltingId: melting.id,
    date: melting.receivedDate || today(),
    type: "Melt Received",
    purity: `${formatPurity(melting.targetPurity)}`,
    weight: Number(melting.receivedWeight || 0),
    reference: `${batchName}: ${melting.colour} received from ${melting.departmentName || "department"} (${meltingReceiveBreakupText(receiveBreakup)}), GW ${gram(grossReceivedWeight)}, wax stone ${gram(waxStoneWeight)}, NT ${gram(melting.receivedWeight)}, loss ${gram(melting.meltingLoss)}`,
  });
  if (Number(melting.meltingLoss || 0) > 0) {
    state.ledger.unshift({
      id: crypto.randomUUID(),
      meltingId: melting.id,
      date: melting.receivedDate || today(),
      type: "Melt Loss",
      purity: `${formatPurity(melting.targetPurity)}`,
      weight: Number(melting.meltingLoss || 0),
      reference: `${batchName}: ${melting.colour} loss booked for ${melting.departmentName || "department"}`,
    });
  }
  syncMeltingReceiveSafeItems(melting);
}

function deleteMeltingEntry(meltingId) {
  const melting = findById("melting", meltingId);
  if (!melting) return;
  if (!confirm("Delete this melting entry? Issue, receive, loss and safe locker records for this melting will be corrected.")) return;
  restoreMeltingRodIssues(cloneMeltingSourceMetals(melting.sourceMetals), melting.id, "Melting entry deleted");
  removeMeltingIssueRecords(melting.id);
  state.ledger = (state.ledger || []).filter((entry) => entry.meltingId !== melting.id);
  state.safeItems = (state.safeItems || []).filter((item) => !(item.sourceType === "melting-receive" && item.sourceId === melting.id));
  state.melting = (state.melting || []).filter((item) => item.id !== melting.id);
  saveState();
  render();
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

function isFactoryOutBillItem(item = {}) {
  return item.factoryStatus === "Factory Out" || item.officeStatus === "Office";
}

function billProductionStockWeight(bill = {}) {
  return Number(weight3((bill.items || [])
    .filter((item) => !isFactoryOutBillItem(item) && !isRepairItem(item) && !isDiscardedItem(item))
    .reduce((total, item) => total + Number(item.netWeight || item.finalGw || 0), 0)));
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
    await deleteAllStoneChartImages(findById("designs", id));
    selectedDesignIds.delete(id);
  }
  state[collection] = state[collection].filter((item) => item.id !== id);
  saveState();
  render();
}

function clearJobCards(resetAt = new Date().toISOString()) {
  const openingStockId = crypto.randomUUID();
  state.factoryResetAt = resetAt;
  state.factoryResetReason = FACTORY_RESET_REASON;
  state.orders = [];
  state.lots = [];
  state.bills = [];
  state.melting = [];
  state.safeItems = [];
  state.nextOrder = 1001;
  state.nextLot = 201;
  state.ledger = [{
    id: openingStockId,
    date: today(),
    type: "In",
    purity: FACTORY_RESET_STOCK_PURITY,
    weight: FACTORY_RESET_STOCK_WEIGHT,
    reference: "Factory reset opening stock",
  }];
  state.metalSafeMovements = [{
    id: crypto.randomUUID(),
    date: today(),
    type: "Opening Stock",
    direction: "in",
    purity: FACTORY_RESET_STOCK_PURITY,
    weight: FACTORY_RESET_STOCK_WEIGHT,
    reference: "Factory reset opening stock",
    sourceType: "factory-reset",
    sourceId: openingStockId,
  }];
  state.factoryLedger = [{
    id: crypto.randomUUID(),
    date: today(),
    direction: "in",
    type: "Opening Stock",
    vendorId: "",
    vendorName: "Opening Stock",
    materialType: "raw-metal",
    purity: FACTORY_RESET_STOCK_PURITY,
    weight: FACTORY_RESET_STOCK_WEIGHT,
    wstgPercent: 0,
    wastagePercent: 0,
    baseFineGold: fineGoldWeight(FACTORY_RESET_STOCK_WEIGHT, FACTORY_RESET_STOCK_PURITY),
    wstgFineGold: 0,
    fineGold: fineGoldWeight(FACTORY_RESET_STOCK_WEIGHT, FACTORY_RESET_STOCK_PURITY),
    stockPosting: "Metal Safe",
    reference: "Factory reset opening stock",
    remarks: "",
    sourceType: "factory-reset",
    sourceId: openingStockId,
    sourceLine: "",
  }];
  state.metalSafeSeededFromLedger = true;
  closeOpenDialogs();
}

function closeOpenDialogs() {
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
}

function openOrderDetail(orderId, editMode = false, bucket = "all") {
  const order = findById("orders", orderId);
  if (!order) return;
  const form = document.getElementById("update-order-form");
  form.orderId.value = order.id;
  form.customerId.value = order.customerId || "";
  form.orderDate.value = order.orderDate;
  form.productionDays.value = order.productionDays;
  form.dueDate.value = order.dueDate;
  const jobOrders = filterJobOrdersForBucket(getJobOrders(order), bucket);
  document.getElementById("order-dialog-summary").textContent = [
    order.jobNumber || order.number,
    `${jobOrders.length} item${jobOrders.length > 1 ? "s" : ""}`,
    jobCurrentStage(jobOrders),
    jobOrderDeliverySummary(jobOrders),
  ].filter(Boolean).join(" / ");
  renderJobItemsDetail(jobOrders);
  closeJobItemDetail();
  renderOrderLots(order);
  document.getElementById("order-production-panel")?.classList.remove("hidden");
  document.getElementById("update-order-form").classList.toggle("hidden", !editMode);
  document.getElementById("order-dialog").showModal();
}

function getJobOrders(order) {
  const jobNumber = order.jobNumber || order.productionNo || order.number;
  return state.orders.filter((item) => (item.jobNumber || item.productionNo || item.number) === jobNumber);
}

function filterJobOrdersForBucket(orders = [], bucket = "all") {
  if (bucket === "active") return orders.filter((order) => !isCompletedOrder(order));
  if (bucket === "completed") return orders.filter(isCompletedOrder);
  return orders;
}

function renderJobItemsDetail(orders) {
  document.getElementById("order-items-detail").innerHTML = `
    <div class="job-item-button-grid">
      ${orders.map((order) => {
        const stage = orderCurrentStage(order);
        const deliveryText = orderDeliveryText(order);
        return `
          <article class="job-item-select-card">
            <label class="job-split-select">
              <input type="checkbox" class="job-split-check" value="${escapeHtml(order.id)}">
              <span>Split</span>
            </label>
            <button type="button" class="job-item-open-button" data-job-item-id="${escapeHtml(order.id)}" onclick="openJobItemDetail('${escapeHtml(order.id)}')">
              <strong>${escapeHtml(order.productionNo || order.number)}</strong>
              <span>${escapeHtml(order.designNumber || designLabel(order.designId) || order.category || "-")}</span>
              <small>${escapeHtml(stage)}</small>
              ${deliveryText ? `<em>${escapeHtml(deliveryText)}</em>` : ""}
              ${order.urgent ? '<b class="urgent-mini">Urgent</b>' : ""}
            </button>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function closeJobItemDetail() {
  const panel = document.getElementById("job-item-detail-panel");
  const detail = document.getElementById("job-item-open-detail");
  if (panel) panel.classList.add("hidden");
  if (detail) detail.innerHTML = "";
  document.querySelectorAll(".job-item-open-button").forEach((button) => button.classList.remove("active"));
}

function selectedJobSplitIds() {
  return [...document.querySelectorAll("#order-items-detail .job-split-check:checked")]
    .map((input) => input.value)
    .filter(Boolean);
}

function splitJobRootNumber(jobNumber = "") {
  return String(jobNumber || "").replace(/-S\d+$/i, "");
}

function nextSplitJobNumber(jobNumber = "") {
  const root = splitJobRootNumber(jobNumber) || jobNumber || `JOB-${state.nextOrder}`;
  const existing = new Set(state.orders.map((order) => order.jobNumber || order.productionNo || order.number).filter(Boolean));
  let index = 1;
  let candidate = `${root}-S${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `${root}-S${index}`;
  }
  return candidate;
}

function splitJobGwValue() {
  const input = document.getElementById("split-job-gw");
  return Number(input?.value || 0);
}

function clearSplitJobGw() {
  const input = document.getElementById("split-job-gw");
  if (input) input.value = "";
}

function lotOrderNumberFromIds(orderIds = [], fallback = "") {
  const jobNumbers = [...new Set(orderIds.map((id) => {
    const order = findById("orders", id);
    return order?.jobNumber || order?.productionNo || order?.number || "";
  }).filter(Boolean))];
  return jobNumbers.length ? jobNumbers.join(", ") : fallback;
}

function splitLotNetWeight(grossWeight, waxStoneWeight = 0, handStoneWeight = 0) {
  return Number(weight3(Math.max(Number(grossWeight || 0) - Number(waxStoneWeight || 0) - Number(handStoneWeight || 0), 0)));
}

function splitLotAdjustmentTransfer(lot, transferWeight, grossReceivedWeight, waxStoneWeight, handStoneWeight, reason) {
  const department = mergedProductionDepartmentName(lot.currentDepartment || lot.karigarName || "");
  const reducedWeight = Number(weight3(Number(waxStoneWeight || 0) + Number(handStoneWeight || 0)));
  return {
    id: crypto.randomUUID(),
    date: today(),
    fromKarigarId: lot.karigarId || "",
    fromKarigarName: lot.karigarName || department || "",
    toKarigarId: lot.karigarId || "",
    toKarigarName: lot.karigarName || department || "",
    transferWeight: Number(weight3(transferWeight)),
    grossReceivedWeight: Number(weight3(grossReceivedWeight)),
    waxStoneWeight: Number(weight3(waxStoneWeight || 0)),
    stoneWeight: Number(weight3(handStoneWeight || 0)),
    handStoneWeight: Number(weight3(handStoneWeight || 0)),
    reducedWeight,
    receivedWeight: splitLotNetWeight(grossReceivedWeight, waxStoneWeight, handStoneWeight),
    departmentBalance: 0,
    differencePurity: lot.metalPurity || getLotOrders(lot)[0]?.purity || "",
    differenceFineGold: 0,
    balanceDepartment: department,
    fromDepartment: department,
    toDepartment: department,
    reason,
    splitAdjustment: true,
  };
}

function splitProductionLot(lot, selectedIdSet, splitJobNumber, splitGw) {
  const lotIds = getLotOrderIds(lot);
  const selectedLotIds = lotIds.filter((id) => selectedIdSet.has(id));
  const remainingIds = lotIds.filter((id) => !selectedIdSet.has(id));
  const selectedOrders = selectedLotIds.map((id) => findById("orders", id)).filter(Boolean);
  const remainingOrders = remainingIds.map((id) => findById("orders", id)).filter(Boolean);
  const currentGw = Number(weight3(currentTransferIssueWeight(lot)));
  const remainingGw = Number(weight3(currentGw - splitGw));
  const selectedWax = Number(weight3(productionStoneTotalsForOrders(selectedOrders, "wax").weight));
  const remainingWax = Number(weight3(productionStoneTotalsForOrders(remainingOrders, "wax").weight));
  const currentHand = Number(weight3(currentHandStoneWeight(lot)));
  const selectedHandTotal = Number(weight3(productionStoneTotalsForOrders(selectedOrders, "hand").weight));
  const selectedHand = currentHand > 0 ? Number(weight3(Math.min(selectedHandTotal, currentHand))) : 0;
  const remainingHand = Number(weight3(Math.max(currentHand - selectedHand, 0)));
  const originalNetWeight = Number(lot.issuedWeight || splitLotNetWeight(currentGw, lot.waxStoneWeight, currentHand));
  const splitNetWeight = Number(weight3(Math.min(splitLotNetWeight(splitGw, selectedWax, selectedHand), originalNetWeight)));
  const remainingNetWeight = Number(weight3(Math.max(originalNetWeight - splitNetWeight, 0)));
  const splitLotNumber = `LOT-${state.nextLot++}`;
  const currentDepartment = mergedProductionDepartmentName(lot.currentDepartment || lot.karigarName || "");
  const splitReason = `Split ${gram(splitGw)} GW from ${lot.number} to ${splitJobNumber}`;

  lot.orderIds = remainingIds;
  lot.orderId = remainingIds[0] || "";
  lot.orderNumber = lotOrderNumberFromIds(remainingIds, lot.orderNumber);
  lot.grossIssuedWeight = Number(weight3(Math.max(Number(lot.grossIssuedWeight || currentGw) - splitGw, 0)));
  lot.waxStoneWeight = remainingWax;
  lot.issuedWeight = remainingNetWeight;
  lot.transfers = lot.transfers || [];
  lot.transfers.push(splitLotAdjustmentTransfer(lot, currentGw, remainingGw, remainingWax, remainingHand, `${splitReason}; balance remains in original job card`));
  recalculateLotAfterTransferChange(lot);

  const splitLot = {
    id: crypto.randomUUID(),
    number: splitLotNumber,
    issueDate: today(),
    orderId: selectedLotIds[0] || "",
    orderIds: selectedLotIds,
    orderNumber: splitJobNumber,
    karigarId: lot.karigarId || "",
    karigarName: lot.karigarName || currentDepartment,
    issueKarigarId: lot.karigarId || "",
    issueKarigarName: lot.karigarName || currentDepartment,
    issueDepartment: currentDepartment,
    currentDepartment,
    metalPurity: lot.metalPurity || selectedOrders[0]?.purity || "",
    grossIssuedWeight: Number(weight3(splitGw)),
    waxStoneWeight: selectedWax,
    issuedWeight: splitNetWeight,
    expectedWastage: Number(lot.expectedWastage || 0),
    finishedWeight: 0,
    actualWastage: 0,
    status: lot.status || "Issued",
    transfers: [
      splitLotAdjustmentTransfer({
        ...lot,
        orderIds: selectedLotIds,
        orderNumber: splitJobNumber,
        grossIssuedWeight: splitGw,
        issuedWeight: splitNetWeight,
        waxStoneWeight: selectedWax,
        currentDepartment,
      }, splitGw, splitGw, selectedWax, selectedHand, `Split lot created from ${lot.number}; ${splitReason}`),
    ],
    splitFromLotId: lot.id,
    splitFromLotNumber: lot.number,
    splitDate: today(),
  };
  state.lots.unshift(splitLot);
  state.ledger.unshift({
    id: crypto.randomUUID(),
    date: today(),
    type: "Split",
    purity: splitLot.metalPurity || "-",
    weight: 0,
    reference: `${splitLot.number} created for ${splitJobNumber} from ${lot.number}; split GW ${gram(splitGw)}. No stock movement booked.`,
  });
  return splitLot;
}

function splitSelectedJobItems() {
  const form = document.getElementById("update-order-form");
  const currentOrder = findById("orders", form.orderId.value);
  if (!currentOrder) {
    alert("Open a job order first.");
    return;
  }
  const jobOrders = getJobOrders(currentOrder);
  const jobOrderIds = new Set(jobOrders.map((order) => order.id));
  const selectedIds = selectedJobSplitIds().filter((id) => jobOrderIds.has(id));
  if (!selectedIds.length) {
    alert("Select one or more item to split.");
    return;
  }
  if (selectedIds.length >= jobOrders.length) {
    alert("Keep at least one item in the original job card. Select fewer items to split.");
    return;
  }
  const selectedIdSet = new Set(selectedIds);
  const selectedOrders = jobOrders.filter((order) => selectedIdSet.has(order.id));
  if (selectedOrders.some(isCompletedOrder)) {
    alert("Completed item cannot be split.");
    return;
  }
  const mixedLiveLots = state.lots.filter((lot) => {
    if (lot.status === "Completed") return false;
    const ids = getLotOrderIds(lot);
    const hasSelected = ids.some((id) => selectedIdSet.has(id));
    const hasRemaining = ids.some((id) => !selectedIdSet.has(id));
    return hasSelected && hasRemaining;
  });
  if (mixedLiveLots.length > 1) {
    alert("Selected items are in more than one live production lot. Split one production lot at a time.");
    return;
  }
  const mixedLiveLot = mixedLiveLots[0] || null;
  let splitGw = 0;
  if (mixedLiveLot) {
    const availableGw = Number(weight3(currentTransferIssueWeight(mixedLiveLot)));
    splitGw = Number(weight3(splitJobGwValue()));
    if (!splitGw) {
      const entered = prompt(`Selected item is already in production lot ${mixedLiveLot.number}.\n\nEnter GW to move to the split job card.\nAvailable current GW: ${gram(availableGw)}`, "");
      splitGw = Number(weight3(Number(entered || 0)));
    }
    if (splitGw <= 0 || splitGw >= availableGw) {
      alert(`Split GW must be more than 0 and less than current lot GW ${gram(availableGw)}.`);
      return;
    }
  }
  const originalJobNumber = currentOrder.jobNumber || currentOrder.productionNo || currentOrder.number;
  const splitJobNumber = nextSplitJobNumber(originalJobNumber);
  const productionSplitText = mixedLiveLot ? `\n\nProduction lot ${mixedLiveLot.number} will also be split with GW ${gram(splitGw)}.` : "";
  if (!confirm(`Move ${selectedOrders.length} selected item(s) from ${originalJobNumber} to ${splitJobNumber}?${productionSplitText}\n\nCustomer, design, dates, purity, size, stone data and production numbers will remain same. Selected items will be marked Urgent.`)) return;
  selectedOrders.forEach((order) => {
    order.jobNumber = splitJobNumber;
    order.splitFromJobNumber = originalJobNumber;
    order.splitDate = today();
    order.urgent = true;
  });
  if (mixedLiveLot) {
    splitProductionLot(mixedLiveLot, selectedIdSet, splitJobNumber, splitGw);
  }
  state.lots.forEach((lot) => {
    if (mixedLiveLot && lot.id === mixedLiveLot.id) return;
    const ids = getLotOrderIds(lot);
    if (!ids.length || !ids.some((id) => selectedIdSet.has(id))) return;
    if (ids.every((id) => selectedIdSet.has(id))) {
      lot.orderNumber = splitJobNumber;
      lot.orderId = ids[0] || lot.orderId;
      lot.orderIds = ids;
    }
  });
  saveState();
  render();
  clearSplitJobGw();
  openJobOrder(splitJobNumber, "active");
  alert(`${splitJobNumber} created with ${selectedOrders.length} urgent item(s).`);
}

function openJobItemDetail(orderId) {
  const order = findById("orders", orderId);
  if (!order) return;
  document.querySelectorAll(".job-item-open-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.jobItemId === orderId);
  });
  const panel = document.getElementById("job-item-detail-panel");
  const detail = document.getElementById("job-item-open-detail");
  if (!panel || !detail) return;
  panel.classList.remove("hidden");
  detail.innerHTML = jobItemDetailHtml(order);
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function jobItemDetailHtml(order) {
  const lotEntries = lotsForOrder(order);
  const lot = lotEntries[0] || null;
  const billEntry = findBillItemForOrder(order);
  const billItem = billEntry?.item || {};
  const officeEntry = officeItems().find(({ item }) => item.orderId === order.id || item.productionNo === order.productionNo);
  const design = findById("designs", order.designId) || {};
  const productionStones = productionStoneItemsForOrder(order);
  const waxStone = productionStoneTotals(productionStones, "wax");
  const handStone = productionStoneTotals(productionStones, "hand");
  const currentStage = orderCurrentStage(order);
  return `
    <div class="job-item-detail-card">
      <div class="job-item-detail-head">
        <div>
          <strong>${escapeHtml(order.productionNo || order.number || "-")}</strong>
          <span>${escapeHtml(order.customer || "-")} / ${escapeHtml(order.jobNumber || order.number || "-")}</span>
          <span class="status ${statusClass(order.status || currentStage)}">${escapeHtml(currentStage)}</span>
        </div>
        <div class="job-item-barcode">${barcodeSvg(order.barcode || order.productionNo || order.number)}</div>
      </div>
      <div class="job-item-detail-grid">
        ${jobItemDetailCell("Current Production Stage", currentStage)}
        ${orderDeliveryText(order) ? jobItemDetailCell("Days Remaining", orderDeliveryText(order)) : ""}
        ${jobItemDetailCell("Order Status", order.status || "-")}
        ${order.splitFromJobNumber ? jobItemDetailCell("Split From", order.splitFromJobNumber) : ""}
        ${order.splitDate ? jobItemDetailCell("Split Date", order.splitDate) : ""}
        ${jobItemDetailCell("Urgent", order.urgent ? "Yes" : "No")}
        ${jobItemDetailCell("Customer", order.customer || "-")}
        ${jobItemDetailCell("Order Date", order.orderDate || "-")}
        ${jobItemDetailCell("Production Days", order.productionDays || "-")}
        ${jobItemDetailCell("Due Date", order.dueDate || "-")}
        ${jobItemDetailCell("Category", order.category || "-")}
        ${jobItemDetailCell("Design", order.designNumber || designText(design) || "-")}
        ${isCmCategory(order.category) ? jobItemDetailCell("CM Item", cmItemTypeLabel(order.cmItemType || defaultCmItemTypeForCategory(order.category))) : ""}
        ${jobItemDetailCell("Ring Type", ringTypeLabel(order.ringType) || "-")}
        ${jobItemDetailCell("Size", soldItemSizeText(order) || "-")}
        ${jobItemDetailCell("Colour", order.color || "-")}
        ${jobItemDetailCell("Purity", order.purity || "-")}
        ${jobItemDetailCell("Remark", order.remarks || "-")}
        ${jobItemDetailCell("Lot", lot?.number || "-")}
        ${jobItemDetailCell("Department", lot ? `${lot.currentDepartment || lot.karigarName || "-"} / ${lot.status || "-"}` : "-")}
        ${jobItemDetailCell("Issued Gold", lot ? gram(lot.grossIssuedWeight || lot.issuedWeight) : "-")}
        ${jobItemDetailCell("Current Lot Weight", lot ? gram(currentTransferIssueWeight(lot)) : "-")}
        ${jobItemDetailCell("Transfer Entries", lot ? `${(lot.transfers || []).length}` : "-")}
        ${jobItemDetailCell("Bill No", billEntry?.bill?.billNo || "-")}
        ${jobItemDetailCell("QC Status", billItem.qcStatus || "-")}
        ${jobItemDetailCell("Office Location", officeEntry ? officeItemLocation(officeEntry.item) : "-")}
        ${jobItemDetailCell("HUID", officeHuidText(billItem))}
        ${jobItemDetailCell("Final GW", billItem.finalGw !== undefined ? gram(billItem.finalGw) : "-")}
        ${jobItemDetailCell("Total Non-Gold", billItem.reducedWeight !== undefined ? billNonGoldTotalText(billItem, order) : "-")}
        ${jobItemDetailCell("Non-Gold Details", billItem.reducedWeight !== undefined ? billNonGoldSummaryText(billItem, order) : "-")}
        ${jobItemDetailCell("Net Wt", billItem.netWeight !== undefined ? gram(billItem.netWeight) : "-")}
        ${jobItemDetailCell("Wax Stone", `${waxStone.pcs} pcs / ${weight3(waxStone.weight)}g`)}
        ${jobItemDetailCell("Hand Stone", `${handStone.pcs} pcs / ${weight3(handStone.weight)}g`)}
        ${jobItemDetailCell("Repair Status", billItem.repairStatus || "-")}
        ${jobItemDetailCell("Repair Days", billItem.repairStatus ? repairDayText(billItem) : "-")}
        ${jobItemDetailCell("Repair Loss", billItem.repairAdditionalLoss ? gram(billItem.repairAdditionalLoss) : "-")}
      </div>
      ${jobItemTransferHistoryHtml(lotEntries)}
      <div class="row-actions job-item-detail-actions">
        <button type="button" onclick="printSingleJobItem('${escapeHtml(order.id)}')">Print This Item</button>
        <button type="button" onclick="openItemBarcodeGenerator('${escapeHtml(order.id)}')">Phone Barcode</button>
        <button type="button" onclick="openProductionStoneEntry('${escapeHtml(order.id)}')">Stone Entry</button>
        <button type="button" onclick="openItemEdit('${escapeHtml(order.id)}')">Edit Item</button>
      </div>
    </div>
  `;
}

function jobItemDetailCell(label, value) {
  return `
    <span>
      <b>${escapeHtml(label)}</b>
      ${escapeHtml(value || "-")}
    </span>
  `;
}

function itemBarcodeDetails(order = {}) {
  const design = findById("designs", order.designId) || {};
  const lot = lotsForOrder(order).find((item) => item.status !== "Completed") || lotsForOrder(order)[0] || {};
  const customer = findById("customers", order.customerId) || {};
  const billEntry = findBillItemForOrder(order);
  const billItem = billEntry?.item || {};
  return {
    productionNo: order.productionNo || order.number || "",
    jobNumber: order.jobNumber || "",
    customer: order.customer || customer.name || "",
    phone: customer.phone || "",
    design: order.designNumber || designText(design) || "",
    category: order.category || design.category || "",
    cmItem: isCmCategory(order.category || design.category) ? cmItemTypeLabel(order.cmItemType || defaultCmItemTypeForCategory(order.category || design.category)) : "",
    size: soldItemSizeText(order) || "",
    color: order.color || "",
    purity: order.purity || "",
    status: orderCurrentStage(order),
    dueDate: order.dueDate || "",
    lot: lot.number || "",
    department: lot.currentDepartment || lot.karigarName || "",
    gw: billItem.finalGw !== undefined ? weight3(billItem.finalGw) : "",
    netWeight: billItem.netWeight !== undefined ? weight3(billItem.netWeight) : "",
  };
}

function itemBarcodePayload(order = {}) {
  const details = itemBarcodeDetails(order);
  return barcodeSafeText([
    `KJM`,
    `PR:${details.productionNo}`,
    `JOB:${details.jobNumber}`,
    `CUSTOMER:${details.customer}`,
    details.phone ? `PHONE:${details.phone}` : "",
    `DESIGN:${details.design}`,
    `CAT:${details.category}`,
    details.size ? `SIZE:${details.size}` : "",
    `COLOR:${details.color}`,
    `PURITY:${details.purity}`,
    `STATUS:${details.status}`,
    details.dueDate ? `DUE:${details.dueDate}` : "",
    details.lot ? `LOT:${details.lot}` : "",
    details.department ? `DEPT:${details.department}` : "",
    details.gw ? `GW:${details.gw}` : "",
    details.netWeight ? `NET:${details.netWeight}` : "",
  ].filter(Boolean).join(" | "));
}

function itemBarcodeDetailGridHtml(order = {}) {
  const details = itemBarcodeDetails(order);
  return `
    <div class="barcode-detail-grid">
      ${jobItemDetailCell("Production No", details.productionNo)}
      ${jobItemDetailCell("Job No", details.jobNumber)}
      ${jobItemDetailCell("Customer", details.customer)}
      ${jobItemDetailCell("Phone", details.phone)}
      ${jobItemDetailCell("Design", details.design)}
      ${jobItemDetailCell("Category", details.category)}
      ${details.cmItem ? jobItemDetailCell("CM Item", details.cmItem) : ""}
      ${jobItemDetailCell("Size", details.size)}
      ${jobItemDetailCell("Colour", details.color)}
      ${jobItemDetailCell("Purity", details.purity)}
      ${jobItemDetailCell("Status", details.status)}
      ${jobItemDetailCell("Lot", details.lot)}
      ${jobItemDetailCell("Department", details.department)}
    </div>
  `;
}

function itemBarcodeGeneratorHtml(order = {}) {
  const payload = itemBarcodePayload(order);
  return `
    <section class="barcode-generator-card">
      <div class="generated-barcode-box">
        ${code128BarcodeSvg(payload)}
      </div>
      <div class="barcode-readable-text">
        <b>Phone scanner will show this text:</b>
        <p>${escapeHtml(payload)}</p>
      </div>
      ${itemBarcodeDetailGridHtml(order)}
    </section>
  `;
}

function openItemBarcodeGenerator(orderId) {
  const order = findById("orders", orderId);
  if (!order) return;
  document.getElementById("barcode-generator-summary").textContent = `${order.productionNo || order.number} / ${order.customer || "-"} / ${order.designNumber || designLabel(order.designId) || "-"}`;
  document.getElementById("barcode-generator-content").innerHTML = itemBarcodeGeneratorHtml(order);
  document.getElementById("barcode-generator-dialog").showModal();
}

function printGeneratedBarcode() {
  const content = document.getElementById("barcode-generator-content").innerHTML;
  if (!content.trim()) return;
  const printArea = getGlobalPrintArea();
  printArea.innerHTML = `<section class="barcode-print-document">${content}</section>`;
  setPrintPageSize("barcode");
  document.body.classList.add("printing-barcode");
  const cleanup = () => {
    document.body.classList.remove("printing-barcode");
    printArea.innerHTML = "";
    setPrintPageSize("job");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  setTimeout(() => window.print(), 100);
}

function lotsForOrder(order) {
  return state.lots.filter((lot) => getLotOrderIds(lot).includes(order.id));
}

function findBillItemForOrder(order) {
  for (const lot of state.lots) {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    if (!bill?.items?.length) continue;
    const found = bill.items.find((item) =>
      item.orderId === order.id ||
      (item.productionNo && item.productionNo === order.productionNo)
    );
    if (found) return { lot, bill, item: found };
  }
  return null;
}

function jobItemTransferHistoryHtml(lots = []) {
  const rows = lots.flatMap((lot) => [
    {
      date: lot.issueDate || "-",
      from: "Gold Issue",
      to: lot.currentDepartment || lot.karigarName || "-",
      issue: lot.grossIssuedWeight || lot.issuedWeight || 0,
      receive: lot.grossIssuedWeight || lot.issuedWeight || 0,
      difference: 0,
      note: lot.qcReturn ? "Repair production lot" : "First issue",
    },
    ...(lot.transfers || []).map((transfer) => ({
      date: transfer.date || "-",
      from: transfer.fromDepartment || transfer.fromKarigarName || "-",
      to: transfer.toDepartment || transfer.toKarigarName || "-",
      issue: transfer.transferWeight || 0,
      receive: transfer.grossReceivedWeight || 0,
      difference: transfer.departmentBalance || 0,
      note: transfer.reason || "-",
    })),
  ]);
  if (!rows.length) return '<div class="empty">No production movement yet.</div>';
  return `
    <div class="job-item-transfer-table">
      <h3>Item Production Movement</h3>
      <table>
        <thead><tr><th>Date</th><th>From</th><th>To</th><th>Issue GW</th><th>Receive GW</th><th>Difference</th><th>Note</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.date)}</td>
            <td>${escapeHtml(row.from)}</td>
            <td>${escapeHtml(row.to)}</td>
            <td>${gram(row.issue)}</td>
            <td>${gram(row.receive)}</td>
            <td>${gram(row.difference)}</td>
            <td>${escapeHtml(row.note)}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function openProductionStoneEntry(orderId) {
  const order = findById("orders", orderId);
  if (!order) return;
  const form = document.getElementById("production-stone-form");
  form.orderId.value = order.id;
  const design = findById("designs", order.designId);
  const designItems = designStoneItemsForOrder(design, order);
  const itemText = orderStoneItemKeys(order).map(stoneItemInputValue).join(" + ");
  document.getElementById("production-stone-summary").textContent = `${order.productionNo || order.number} / ${order.designNumber || designLabel(order.designId) || order.category || ""} / ${itemText} / ${designItems.length || 0} design stone row${designItems.length === 1 ? "" : "s"}`;
  renderProductionStoneItems(order);
  document.getElementById("production-stone-dialog").showModal();
}

function renderProductionStoneItems(order) {
  const container = document.getElementById("production-stone-details");
  const design = findById("designs", order.designId);
  const designItems = designStoneItemsForOrder(design, order);
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
      <thead><tr><th>Item</th><th>Code</th><th>Type</th><th>Shape</th><th>Size</th><th>No. Pcs</th><th>Wt/Pc (g)</th><th>Total Wt (g)</th><th>Setting Type</th><th>Manufacturing Stage</th></tr></thead>
      <tbody>${plannedItems.map((item) => `
        <tr
          data-design-stone-id="${escapeHtml(item.id)}"
          data-production-stone-id="${escapeHtml(item.productionStoneId)}"
          data-stone-type="${escapeHtml(item.stoneType || "")}"
          data-shape="${escapeHtml(item.shape || "")}"
          data-size="${escapeHtml(item.size || "")}"
          data-item-key="${escapeHtml(normalizeStoneItemKey(item.itemKey))}"
          data-code="${escapeHtml(item.code || stoneLookupCode(item))}"
          data-pcs="${escapeHtml(item.pcs || 0)}"
          data-weight-per-pc="${escapeHtml(item.weightPerPc || "")}"
          data-total-weight="${escapeHtml(item.totalWeight || totalStoneWeight(item.weightPerPc, item.pcs))}"
        >
          <td>${escapeHtml(stoneItemInputValue(item.itemKey))}</td>
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
  form.cmItemType.value = order.cmItemType || defaultCmItemTypeForCategory(order.category || "");
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
  const showCm = isCmCategory(category);
  const showNormalSize = needsNormalSize(category);
  form.querySelectorAll(".cb-field").forEach((field) => field.classList.toggle("hidden", !showCb));
  form.querySelectorAll(".cm-field").forEach((field) => field.classList.toggle("hidden", !showCm));
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
  if (!showCm) {
    form.cmItemType.value = "";
  } else if (!form.cmItemType.value) {
    form.cmItemType.value = defaultCmItemTypeForCategory(category);
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
  if (!isCmCategory(order.category)) order.cmItemType = "";
  else if (!order.cmItemType) order.cmItemType = defaultCmItemTypeForCategory(order.category);
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
  if (isCmCategory(order.category)) {
    return `<span><b>CM Item</b>${escapeHtml(cmItemTypeLabel(order.cmItemType || defaultCmItemTypeForCategory(order.category)))}</span>`;
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
  if (isCmCategory(order.category)) {
    return `<span><b>CM Item</b>${escapeHtml(cmItemTypeLabel(order.cmItemType || defaultCmItemTypeForCategory(order.category)))}</span>`;
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
  if (mode === "bill") {
    style.textContent = "@media print { @page { size: 148.5mm 105mm; margin: 0; } }";
  } else if (mode === "packing-list") {
    style.textContent = "@media print { @page { size: 297mm 210mm; margin: 0; } }";
  } else if (mode === "hallmark-tags") {
    style.textContent = "@media print { @page { size: A4 portrait; margin: 0; } }";
  } else if (mode === "barcode") {
    style.textContent = "@media print { @page { size: A4 portrait; margin: 10mm; } }";
  } else if (mode === "single") {
    style.textContent = "@media print { @page { size: 105mm 148.5mm; margin: 0; } }";
  } else {
    style.textContent = "@media print { @page { size: A4 portrait; margin: 0; } }";
  }
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

function startBillPrint(html) {
  const printArea = getGlobalPrintArea();
  printArea.innerHTML = html;
  setPrintPageSize("bill");
  document.body.classList.add("printing-bill");
  const cleanup = () => {
    document.body.classList.remove("printing-bill");
    printArea.innerHTML = "";
    setPrintPageSize("job");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  setTimeout(() => window.print(), 100);
}

function startPackingListPrint(html) {
  const printArea = getGlobalPrintArea();
  printArea.innerHTML = html;
  setPrintPageSize("packing-list");
  document.body.classList.add("printing-packing-list");
  const cleanup = () => {
    document.body.classList.remove("printing-packing-list");
    printArea.innerHTML = "";
    setPrintPageSize("job");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  setTimeout(() => window.print(), 100);
}

function startHallmarkTagPrint(html, afterPrint = null) {
  const printArea = getGlobalPrintArea();
  printArea.innerHTML = html;
  setPrintPageSize("hallmark-tags");
  document.body.classList.add("printing-hallmark-tags");
  const cleanup = () => {
    document.body.classList.remove("printing-hallmark-tags");
    printArea.innerHTML = "";
    setPrintPageSize("job");
    window.removeEventListener("afterprint", cleanup);
    if (typeof afterPrint === "function") afterPrint();
  };
  window.addEventListener("afterprint", cleanup);
  setTimeout(() => window.print(), 100);
}

function printBillFromDialog() {
  const form = document.getElementById("bill-form");
  if (!form) return;
  const lot = findById("lots", form.lotId.value);
  if (!lot) return;
  const existingBill = lot.bill || state.bills?.find((item) => item.lotId === lot.id) || {};
  let bill = existingBill;
  if (!existingBill.id || canEditGeneratedBill()) {
    const saved = saveBillFromForm(false);
    if (!saved) return;
    bill = saved.bill;
  }
  printBill(lot.id, bill);
}

function printPackingListFromDialog() {
  const form = document.getElementById("bill-form");
  if (!form) return;
  const lot = findById("lots", form.lotId.value);
  if (!lot) return;
  const existingBill = lot.bill || state.bills?.find((item) => item.lotId === lot.id) || {};
  let bill = existingBill;
  if (!existingBill.id || canEditGeneratedBill()) {
    const saved = saveBillFromForm(false);
    if (!saved) return;
    bill = saved.bill;
  }
  printPackingList(lot.id, bill);
}

function printBill(lotId, billOverride = null) {
  const lot = findById("lots", lotId);
  if (!lot) return;
  const bill = billOverride || lot.bill || state.bills?.find((item) => item.lotId === lot.id);
  if (!bill?.id) {
    alert("Generate bill first, then print.");
    return;
  }
  startBillPrint(billPrintHtml(lot, bill));
}

function printPackingList(lotId, billOverride = null) {
  const lot = findById("lots", lotId);
  if (!lot) return;
  const bill = billOverride || lot.bill || state.bills?.find((item) => item.lotId === lot.id);
  if (!bill?.id) {
    alert("Generate bill first, then print packing list.");
    return;
  }
  startPackingListPrint(packingListPrintHtml(lot, bill));
}

function printFactorySummary() {
  startBillPrint(factorySummaryPrintHtml());
}

function factorySummaryPrintHtml() {
  const ledger = factoryLedgerTotals();
  const physical = factoryPhysicalFineStock();
  const vendorRows = vendorBalanceRows();
  const vendorTotals = factoryVendorFineTotals(vendorRows);
  const totalFineStock = totalFactoryFineStock(physical, vendorTotals);
  const entries = [...(state.factoryLedger || [])].slice(0, 10);
  return `
    <section class="bill-print-document small-bill-document factory-summary-print-document">
      <header class="bill-sample-header">
        <div>
          <p><b>Name</b> : Factory</p>
          <p><b>Voucher No</b> : FACTORY</p>
        </div>
        <div class="bill-sample-title">
          <span>KHUSHALI JEWELLS</span>
          <strong>Summary</strong>
          <small>Factory In / Out</small>
        </div>
        <div>
          <p><b>Date</b> : ${escapeHtml(today())}</p>
          <p><b>Page No</b> : 1/1</p>
        </div>
      </header>
      <section class="bill-sample-info">
        <span><b>Factory In Fine</b>${gram(ledger.inFine)}</span>
        <span><b>Factory Out Fine</b>${gram(ledger.outFine)}</span>
        <span><b>Balance Fine</b>${gram(ledger.balanceFine)}</span>
        <span><b>Factory Item Fine</b>${gram(physical.totalFine)}</span>
        <span><b>Vendor Fine Balance</b>${gram(vendorTotals.netBalance)}</span>
        <span><b>Total Factory Fine</b>${gram(totalFineStock)}</span>
      </section>
      <table class="bill-print-table bill-sample-table bill-weight-category-table">
        <thead>
          <tr><th>Sr.</th><th>Weight Category</th><th>Weight (g)</th><th>Remarks</th></tr>
        </thead>
        <tbody>
          ${factorySummaryCategoryRows(ledger, physical, vendorTotals, totalFineStock).map((row, index) => `
            <tr class="${row.highlight ? "bill-sample-total-row" : ""}">
              <td>${index + 1}</td>
              <td>${escapeHtml(row.label)}</td>
              <td>${escapeHtml(row.value)}</td>
              <td>${escapeHtml(row.note || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <section class="bill-print-section">
        <h2>Latest Factory In / Out Entries</h2>
        <table class="bill-print-table bill-print-items-table factory-print-ledger-table">
          <thead><tr><th>Date</th><th>Type</th><th>Vendor</th><th>Purity</th><th>WSTG</th><th>Weight</th><th>Fine</th></tr></thead>
          <tbody>
            ${entries.map((entry) => {
              const fine = factoryFineGoldBreakup(entry);
              return `
                <tr>
                  <td>${escapeHtml(entry.date || "-")}</td>
                  <td>${escapeHtml(entry.direction === "out" ? "Out" : "In")}</td>
                  <td>${escapeHtml(entry.vendorName || "-")}</td>
                  <td>${escapeHtml(entry.purity || "-")}</td>
                  <td>${fine.wstgPercent ? `${fine.wstgPercent.toFixed(2)}%` : "-"}</td>
                  <td>${entry.direction === "out" ? "-" : "+"}${weight3(entry.weight)}</td>
                  <td>${entry.direction === "out" ? "-" : "+"}${weight3(fine.fineGold)}</td>
                </tr>
              `;
            }).join("") || `<tr><td colspan="7">No entries.</td></tr>`}
          </tbody>
        </table>
      </section>
      <section class="bill-sign-row">
        <span>Prepared By</span>
        <span>Checked By</span>
        <span>Approved By</span>
      </section>
    </section>
  `;
}

function factorySummaryCategoryRows(ledger, physical, vendorTotals, totalFineStock) {
  return [
    { label: "Factory In Fine", value: weight3(ledger.inFine), note: "Vendor inward + WSTG + opening stock" },
    { label: "Factory Out Fine", value: weight3(ledger.outFine), note: "Bill + metal/stock out" },
    { label: "Ledger Fine Balance", value: weight3(ledger.balanceFine), note: "Factory in - factory out", highlight: true },
    { label: "Metal Safe Fine", value: weight3(physical.metalFine), note: "Physical raw metal fine" },
    { label: "Shelf Fine", value: weight3(physical.shelfFine), note: "Safe locker item fine" },
    { label: "Production Fine", value: weight3(physical.productionFine), note: "Lots in production" },
    { label: "Factory Item Fine", value: weight3(physical.totalFine), note: "Metal + shelf + production", highlight: true },
    { label: "Vendor Fine Balance", value: weight3(vendorTotals.netBalance), note: "Payable fine minus receivable fine" },
    { label: "Total Factory Fine Stock", value: weight3(totalFineStock), note: "Factory item fine - vendor fine balance", highlight: true },
    { label: "Payable To Vendors", value: weight3(vendorTotals.payable), note: "Metal to give to party" },
    { label: "Receivable From Vendors", value: weight3(vendorTotals.receivable), note: "Metal to receive from party" },
  ];
}

function printHallmarkedTags(keys = null) {
  const selectedKeys = Array.isArray(keys) && keys.length ? keys : selectedOfficeKeys();
  if (!selectedKeys.length) {
    alert("Select hallmarked item to print tag.");
    return;
  }
  const entries = selectedOfficeEntries(selectedKeys).filter(({ item }) => isHallmarkedItem(item));
  if (!entries.length) {
    alert("Selected item is not hallmarked yet.");
    return;
  }
  startHallmarkTagPrint(hallmarkedTagPrintHtml(entries), () => markHallmarkTagsPrinted(entries));
}

function markHallmarkTagsPrinted(entries = []) {
  const printedKeys = entries.map(({ lot, item }) => officeItemKey(lot.id, item));
  if (!printedKeys.length) return;
  let updated = 0;
  state.lots.forEach((lot) => {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    if (!bill?.items?.length) return;
    bill.items = bill.items.map((item) => {
      if (!printedKeys.includes(officeItemKey(lot.id, item))) return item;
      updated += 1;
      return {
        ...item,
        tagPrinted: true,
        tagPrintedDate: today(),
        tagPrintedIsoDate: isoToday(),
      };
    });
    lot.bill = bill;
    updateSavedBill(bill);
  });
  if (!updated) return;
  saveState();
  renderOffice();
  const dialog = document.getElementById("office-details-dialog");
  const page = dialog?.dataset.page || "";
  if (!dialog?.open) return;
  if (page === "hallmarked") {
    openOfficeDialogPage("hallmarked");
  } else if (page === "product-view" && printedKeys.length === 1) {
    openOfficeItemView(printedKeys[0]);
  }
}

function selectAllOfficeDialogItems() {
  const dialog = document.getElementById("office-details-dialog");
  const checkboxes = Array.from(dialog?.querySelectorAll(".office-item-check") || []);
  if (!checkboxes.length) {
    alert("No item available to select.");
    return;
  }
  checkboxes.forEach((input) => {
    input.checked = true;
  });
}

function hallmarkedTagPrintHtml(entries = []) {
  return `
    <section class="hallmark-tags-document">
      ${entries.map(hallmarkedTagHtml).join("")}
    </section>
  `;
}

function hallmarkedTagHtml({ lot, bill, item, order }) {
  const design = findById("designs", order.designId) || {};
  const productionNo = item.productionNo || order.productionNo || order.number || "";
  const designName = order.designNo || designLabel(order.designId) || (design.id ? designText(design) : "") || "-";
  const sizeText = soldItemSizeText(order) || "-";
  const nonGold = billItemNonGoldBreakup(item, order);
  const huid = officeHuidText(item);
  const hmLot = hallmarkLotLabel(item) || "-";
  const nonGoldText = [
    `BB ${weight3(nonGold.blackBeadsWeight)}`,
    `M ${weight3(nonGold.motiWeight)}`,
    `SP ${weight3(nonGold.springWeight)}`,
    `O ${weight3(nonGold.otherNonGoldWeight)}`,
  ].join(" / ");
  return `
    <article class="hallmark-tag-card">
      <div class="hallmark-tag-info">
        <div class="hallmark-tag-head">
          <strong>KJ</strong>
          <b>${escapeHtml(productionNo || "-")}</b>
          <span>${escapeHtml(item.purity || order.purity || "-")}</span>
        </div>
        <div class="hallmark-tag-line"><b>HUID</b> ${escapeHtml(huid)} <b>HM</b> ${escapeHtml(hmLot)} <b>Bill</b> ${escapeHtml(bill.billNo || "-")}</div>
        <div class="hallmark-tag-line">${escapeHtml(designName)} / ${escapeHtml(order.category || design.category || "-")} / ${escapeHtml(order.color || "-")} / Sz ${escapeHtml(sizeText)}</div>
        <div class="hallmark-tag-line"><b>GW</b> ${weight3(item.finalGw)} <b>ST</b> ${weight3(nonGold.stoneWeight)} <b>NET</b> ${weight3(item.netWeight)} <b>Job</b> ${escapeHtml(lot.orderNumber || lot.number || "-")}</div>
        <div class="hallmark-tag-line">${escapeHtml(order.customer || "-")} / ${escapeHtml(nonGoldText)}</div>
      </div>
      <div class="hallmark-tag-barcode">
        ${productionNo ? barcodeSvg(productionNo) : ""}
      </div>
    </article>
  `;
}

function billPrintHtml(lot, bill) {
  const orders = billableOrdersForLot(lot, bill);
  const items = billPrintItems(lot, bill, orders);
  const totals = billTotals(items);
  const customer = billPrintCustomer(orders);
  const purityText = [...new Set(items.map((item) => item.purity).filter(Boolean))].join(", ") || "-";
  const fineWeight = items.reduce((sum, item) => sum + fineGoldWeight(item.netWeight, item.purity || item.order?.purity || 0), 0);
  return `
    <section class="bill-print-document small-bill-document">
      <header class="bill-sample-header">
        <div>
          <p><b>Name</b> : ${escapeHtml(customer.name || "-")}</p>
          <p><b>Voucher No</b> : ${escapeHtml(bill.billNo || "-")}</p>
        </div>
        <div class="bill-sample-title">
          <span>KHUSHALI JEWELLS</span>
          <strong>Bill</strong>
          <small>Weight Approval</small>
        </div>
        <div>
          <p><b>Date</b> : ${escapeHtml(bill.billDate || "-")}</p>
          <p><b>Page No</b> : 1/1</p>
        </div>
      </header>
      <section class="bill-sample-info">
        <span><b>Job Card</b>${escapeHtml(lot.orderNumber || bill.jobNumber || "-")}</span>
        <span><b>Lot</b>${escapeHtml(lot.number || "-")}</span>
        <span><b>Phone</b>${escapeHtml(customer.phone || "-")}</span>
        <span><b>City</b>${escapeHtml(customer.city || "-")}</span>
        <span><b>Items</b>${totals.pieces}</span>
        <span><b>Purity</b>${escapeHtml(purityText)}</span>
      </section>
      <table class="bill-print-table bill-sample-table bill-weight-category-table">
        <thead>
          <tr>
            <th>Sr.</th>
            <th>Weight Category</th>
            <th>Weight (g)</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${billWeightCategoryRows(totals, lot, fineWeight).map((row, index) => `
            <tr class="${row.highlight ? "bill-sample-total-row" : ""}">
              <td>${index + 1}</td>
              <td>${escapeHtml(row.label)}</td>
              <td>${escapeHtml(row.value)}</td>
              <td>${escapeHtml(row.note || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <section class="bill-weight-summary-line">
        <span><b>Total Non-Gold</b>${gram(totals.reducedWeight)}</span>
        <span><b>Net Wt</b>${gram(totals.netWeight)}</span>
        <span><b>Wastage</b>${gram(lot.actualWastage || 0)}</span>
        <span><b>Remarks</b>${escapeHtml(bill.remarks || "-")}</span>
      </section>
      <section class="bill-sign-row">
        <span>Prepared By</span>
        <span>Checked By</span>
        <span>Approved By</span>
      </section>
    </section>
  `;
}

function billWeightCategoryRows(totals = {}, lot = {}, fineWeight = 0) {
  return [
    { label: "Gross Weight", value: weight3(totals.finalGw), note: "Total GW" },
    { label: "BB Weight", value: weight3(totals.bbWeight), note: "Black beads" },
    { label: "Moti Weight", value: weight3(totals.motiWeight), note: "Moti" },
    { label: "Stone Weight", value: weight3(totals.stoneWeight), note: "Stone from job card" },
    { label: "Spring Weight", value: weight3(totals.springWeight), note: "Spring" },
    { label: "Other Weight", value: weight3(totals.otherNonGoldWeight), note: "Other non-gold" },
    { label: "Total Non-Gold", value: weight3(totals.reducedWeight), note: "BB + Moti + Stone + Spring + Other" },
    { label: "Net Weight", value: weight3(totals.netWeight), note: "GW - Total Non-Gold", highlight: true },
    { label: "Wastage", value: weight3(lot.actualWastage || 0), note: "Manufacturing wastage" },
    { label: "Fine Weight", value: weight3(fineWeight), note: "Net by purity", highlight: true },
  ];
}

function billPrintCustomer(orders = []) {
  const customerIds = [...new Set(orders.map((order) => order.customerId).filter(Boolean))];
  const customers = customerIds.map((id) => findById("customers", id)).filter(Boolean);
  const names = [...new Set(orders.map((order) => order.customer).filter(Boolean))];
  return customers[0] || { name: names.join(", ") || "-", phone: "", city: "", gst: "", address: "" };
}

function packingListPrintHtml(lot, bill) {
  const orders = billableOrdersForLot(lot, bill);
  const items = billPrintItems(lot, bill, orders);
  const totals = billTotals(items);
  return `
    <section class="bill-print-document packing-list-document">
      <header class="bill-print-header">
        <div>
          <h1>KHUSHALI JEWELLS MANUFACTURING</h1>
          <p>Packing List</p>
        </div>
        <div class="bill-print-meta">
          <span><b>Bill No</b>${escapeHtml(bill.billNo || "-")}</span>
          <span><b>Bill Date</b>${escapeHtml(bill.billDate || "-")}</span>
          <span><b>Job Card</b>${escapeHtml(lot.orderNumber || bill.jobNumber || "-")}</span>
          <span><b>Lot</b>${escapeHtml(lot.number || "-")}</span>
        </div>
      </header>
      <section class="bill-print-section">
        <h2>Customer Details</h2>
        ${billPrintCustomerHtml(orders)}
      </section>
      <section class="bill-print-section">
        <h2>Total Weight Summary</h2>
        <div class="bill-print-total-grid">
          ${billPrintTotalCard("Items", totals.pieces)}
          ${billPrintTotalCard("Total GW", gram(totals.finalGw))}
          ${billPrintTotalCard("BB Wt", gram(totals.bbWeight))}
          ${billPrintTotalCard("Moti Wt", gram(totals.motiWeight))}
          ${billPrintTotalCard("Stone Wt", gram(totals.stoneWeight))}
          ${billPrintTotalCard("Spring Wt", gram(totals.springWeight))}
          ${billPrintTotalCard("Other Wt", gram(totals.otherNonGoldWeight))}
          ${billPrintTotalCard("Total Non-Gold", gram(totals.reducedWeight))}
          ${billPrintTotalCard("Net Wt", gram(totals.netWeight), "highlight")}
        </div>
      </section>
      <section class="bill-print-section">
        <h2>Item Details</h2>
        ${billPrintItemTableHtml(items)}
      </section>
      ${bill.remarks ? `<section class="bill-print-section"><h2>Remarks</h2><p>${escapeHtml(bill.remarks)}</p></section>` : ""}
    </section>
  `;
}

function billPrintItems(lot, bill, orders = []) {
  const orderMap = Object.fromEntries(orders.map((order) => [order.id, order]));
  const savedItems = Array.isArray(bill.items) ? bill.items : [];
  if (savedItems.length) {
    return savedItems.map((item, index) => {
      const order = orderMap[item.orderId] || findById("orders", item.orderId) || {};
      return billPrintItem(item, order, index);
    });
  }
  return orders.map((order, index) => billPrintItem({}, order, index));
}

function billPrintItem(item = {}, order = {}, index = 0) {
  const nonGold = billItemNonGoldBreakup(item, order);
  const finalGw = billNumber(item.finalGw);
  const reducedWeight = billNumber(item.reducedWeight || nonGold.total);
  const netWeight = billNumber(item.netWeight || Math.max(finalGw - reducedWeight, 0));
  return {
    ...item,
    order,
    index,
    productionNo: item.productionNo || order.productionNo || order.number || "",
    customer: order.customer || "",
    design: order.designNo || designLabel(order.designId) || "",
    category: order.category || "Uncategorised",
    purity: item.purity || order.purity || "",
    finalGw,
    blackBeadsWeight: billNumber(item.blackBeadsWeight || item.bbWeight || nonGold.blackBeadsWeight),
    motiWeight: billNumber(item.motiWeight || item.mmWeight || nonGold.motiWeight),
    stoneWeight: billNumber(item.stoneWeight || item.stWeight || nonGold.stoneWeight),
    springWeight: billNumber(item.springWeight || nonGold.springWeight),
    otherNonGoldWeight: billNumber(item.otherNonGoldWeight || item.otherWeight || nonGold.otherNonGoldWeight),
    reducedWeight,
    netWeight,
  };
}

function billPrintCustomerHtml(orders = [], compact = false) {
  const customerIds = [...new Set(orders.map((order) => order.customerId).filter(Boolean))];
  const customers = customerIds.map((id) => findById("customers", id)).filter(Boolean);
  const names = [...new Set(orders.map((order) => order.customer).filter(Boolean))];
  const primary = customers[0] || { name: names.join(", ") || "-" };
  return `
    <div class="bill-print-customer-grid ${compact ? "compact" : ""}">
      <span><b>Name</b>${escapeHtml(primary.name || names.join(", ") || "-")}</span>
      <span><b>Phone</b>${escapeHtml(primary.phone || "-")}</span>
      ${compact ? "" : `
        <span><b>City</b>${escapeHtml(primary.city || "-")}</span>
        <span><b>GST</b>${escapeHtml(primary.gst || "-")}</span>
        <span class="wide"><b>Address</b>${escapeHtml(primary.address || "-")}</span>
        ${names.length > 1 ? `<span class="wide"><b>All Customers</b>${escapeHtml(names.join(", "))}</span>` : ""}
      `}
    </div>
  `;
}

function billPrintTotalCard(label, value, extraClass = "") {
  return `<div class="bill-print-total ${extraClass}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function billPrintItemTableHtml(items = []) {
  const rows = items.map((item) => `
    <tr>
      <td>${item.index + 1}</td>
      <td>${escapeHtml(item.productionNo || "-")}</td>
      <td>${escapeHtml(item.customer || "-")}</td>
      <td>${escapeHtml(item.category || "-")}</td>
      <td>${escapeHtml(item.design || "-")}</td>
      <td>${escapeHtml(item.purity || "-")}</td>
      <td>${gram(item.finalGw)}</td>
      <td>${gram(item.blackBeadsWeight)}</td>
      <td>${gram(item.motiWeight)}</td>
      <td>${gram(item.stoneWeight)}</td>
      <td>${gram(item.springWeight)}</td>
      <td>${gram(item.otherNonGoldWeight)}</td>
      <td>${gram(item.reducedWeight)}</td>
      <td>${gram(item.netWeight)}</td>
    </tr>
  `).join("");
  return `
    <table class="bill-print-table bill-print-items-table">
      <thead>
        <tr><th>#</th><th>PR No</th><th>Customer</th><th>Category</th><th>Design</th><th>Purity</th><th>GW</th><th>BB</th><th>Moti</th><th>Stone</th><th>Spring</th><th>Other</th><th>Non-Gold</th><th>Net</th></tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="14">No item details</td></tr>`}</tbody>
    </table>
  `;
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
        ${printStoneDetailsHtml(design, order)}
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

function printStoneDetailsHtml(design, order = {}) {
  const items = designStoneItemsForOrder(design, order);
  const totals = designStoneTotals(items);
  const stoneRows = items.map((item) => `
    <tr>
      <td>${escapeHtml(stoneItemInputValue(item.itemKey))}</td>
      <td>${escapeHtml(item.stoneType || "")}</td>
      <td>${escapeHtml([item.shape, item.size].filter(Boolean).join(" "))}</td>
      <td>${escapeHtml(item.pcs || "")}</td>
      <td>${escapeHtml(formatStoneWeight(item.weightPerPc) || "")}</td>
      <td>${escapeHtml(item.totalWeight || "")}</td>
    </tr>
  `).join("");
  const totalRow = `
    <tr class="stone-total-row">
      <td colspan="3">Total</td>
      <td>${escapeHtml(totals.pcs || "")}</td>
      <td></td>
      <td>${escapeHtml(totals.weight ? weight3(totals.weight) : "")}</td>
    </tr>
  `;
  const blankRows = Array.from({ length: 5 }, () => `
    <tr class="manual-stone-row"><td></td><td></td><td></td><td></td><td></td><td></td></tr>
  `).join("");
  return `
    <div class="print-stone-details">
      <b>Stone Details - ${escapeHtml(orderStoneItemKeys(order).map(stoneItemInputValue).join(" + "))}</b>
      <table>
        <thead><tr><th>Item</th><th>Type</th><th>Shape</th><th>No of Pcs</th><th>Wt/Pc</th><th>Total Weight</th></tr></thead>
        <tbody>${stoneRows}${totalRow}${blankRows}</tbody>
      </table>
    </div>
  `;
}

function renderOrderLots(order) {
  const jobOrders = getJobOrders(order);
  const orderIds = new Set(jobOrders.map((item) => item.id));
  const lots = state.lots.filter((lot) => getLotOrderIds(lot).some((id) => orderIds.has(id)));
  const status = document.getElementById("order-current-status");
  if (status) status.innerHTML = orderCurrentLotStatusHtml(jobOrders, lots);
  updateIssueGoldFromOrderButton(jobOrders);
  document.getElementById("order-lots-list").innerHTML = lots.length
    ? lots.map(renderOrderLotCard).join("")
    : '<div class="empty">No gold issued for this order yet. Use Issue Gold to start production.</div>';
}

function updateIssueGoldFromOrderButton(jobOrders = []) {
  const button = document.getElementById("issue-from-order");
  if (!button) return;
  const pendingCount = jobOrders.filter((order) => order.status === "Pending").length;
  button.disabled = pendingCount === 0;
  button.textContent = pendingCount ? "Issue Gold" : "Gold Issued";
  button.title = pendingCount
    ? `Issue gold for ${pendingCount} pending item${pendingCount === 1 ? "" : "s"} in this job card.`
    : "This job card has no pending item left for gold issue.";
}

function orderCurrentLotStatusHtml(jobOrders = [], lots = []) {
  const currentLot = lots.find((lot) => lot.status !== "Completed") || lots[0] || null;
  const pendingCount = jobOrders.filter((order) => order.status === "Pending").length;
  const completedCount = jobOrders.filter(isCompletedOrder).length;
  const activeCount = Math.max(jobOrders.length - pendingCount - completedCount, 0);
  const currentStage = jobCurrentStage(jobOrders);
  const deliveryText = jobOrderDeliverySummary(jobOrders);
  if (!currentLot) {
    return `
      <article class="order-current-card order-current-card-main">
        <span>Current Status</span>
        <strong>Gold Not Issued</strong>
        <small>${pendingCount} pending item${pendingCount === 1 ? "" : "s"} / ${deliveryText || "No delivery balance"}</small>
      </article>
      <article class="order-current-card">
        <span>Next Step</span>
        <strong>Issue Gold</strong>
        <small>Select Issue Gold to start production for this job card.</small>
      </article>
    `;
  }
  const transferCount = (currentLot.transfers || []).length;
  const currentWeight = currentTransferIssueWeight(currentLot);
  return `
    <article class="order-current-card order-current-card-main">
      <span>Current Stage</span>
      <strong>${escapeHtml(currentStage)}</strong>
      <small>${deliveryText ? escapeHtml(deliveryText) : "Delivery completed or not required"}</small>
    </article>
    <article class="order-current-card order-current-dept-card">
      ${currentDepartmentBadgeHtml(currentLot)}
    </article>
    <article class="order-current-card">
      <span>Lot</span>
      <strong>${escapeHtml(currentLot.number || "-")}</strong>
      <small>${escapeHtml(currentLot.status || "-")} / ${escapeHtml(currentLot.metalPurity || "-")}</small>
    </article>
    <article class="order-current-card">
      <span>Current GW</span>
      <strong>${gram(currentWeight)}</strong>
      <small>Issued ${gram(currentLot.grossIssuedWeight || currentLot.issuedWeight || 0)}</small>
    </article>
    <article class="order-current-card">
      <span>Transfers</span>
      <strong>${transferCount}</strong>
      <small>${pendingCount} pending / ${activeCount} active / ${completedCount} completed</small>
    </article>
  `;
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
  return designStoneItemsForOrder(design, order).map((item) => {
    const automaticSetting = automaticProductionStoneSetting(item);
    return {
      id: crypto.randomUUID(),
      sourceDesignStoneId: item.id || "",
      date: today(),
      settingType: automaticSetting.settingType,
      manufacturingStage: automaticSetting.manufacturingStage,
      itemKey: normalizeStoneItemKey(item.itemKey),
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
  const castingItem = findSafeItemOrGroup(form.castingSafeItemId?.value, form.metalPurity.value || purities[0] || "18K");
  const castingAvailable = castingItem ? safeItemAvailableWeight(castingItem) : 0;
  const castingNote = castingItem
    ? ` Casting Item: ${safeItemOptionLabel(castingItem)}. Balance after issue ${gram(Math.max(castingAvailable - Math.max(netMetal, 0), 0))}.`
    : ` Select casting item from ${safeLockerForPurity(form.metalPurity.value || purities[0] || "18K")} Safe.`;
  const purityNote = purities.length > 1 ? ` Multiple purities in job: ${purities.join(", ")}.` : ` Purity: ${purities[0] || form.metalPurity.value || "-"}.`;
  summary.textContent = `Gold Issue ${gram(grossIssue)} - Wax Stone ${gram(waxStoneWeight)} = Net Wt ${gram(Math.max(netMetal, 0))}.${purityNote}${castingNote}`;
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

function castingSafeItemsForPurity(purity = "") {
  return castingShelfGroups(purity).filter((item) => safeItemAvailableWeight(item) > 0);
}

function safeItemOptionLabel(item = {}) {
  const colour = safeItemColour(item) || "-";
  const desiredPurity = displayPurity(safeItemDesiredPurity(item));
  const source = item.virtualSafeGroup ? safeIssueSourceName(item) : item.description || "Casting item";
  const itemCount = item.virtualSafeGroup ? ` / ${item.items?.length || 0} entries` : "";
  return `${source} / ${colour} / ${desiredPurity} / GW ${gram(item.grossWeight)} / Wax ${gram(safeItemWaxStoneWeight(item))} / NT Avl ${gram(safeItemAvailableWeight(item))}${itemCount}`;
}

function safeIssueSourceName(item = {}) {
  return `SHELF${safeLockerForPurity(item.locker || item.purity || "18K")}`;
}

function safeItemIssueSelectionAvailable(item = null) {
  return Boolean(item && item.status !== "Out" && safeItemKind(item) === "rod" && safeItemAvailableWeight(item) > 0);
}

function findSafeItemOrGroup(id = "", purity = "") {
  if (!id) return null;
  if (isSafeShelfId(id)) return castingShelfGroups(purity).find((item) => item.id === id) || null;
  return findById("safeItems", id);
}

function updateProductionCastingItemOptions() {
  const form = document.getElementById("production-form");
  const select = form?.castingSafeItemId;
  if (!select) return;
  const selected = select.value;
  const locker = safeLockerForPurity(form.metalPurity.value || "18K");
  const items = castingSafeItemsForPurity(form.metalPurity.value);
  select.innerHTML = items.length
    ? `<option value="">Select casting item from ${escapeHtml(locker)} Safe</option>${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(safeItemOptionLabel(item))}</option>`).join("")}`
    : `<option value="">No casting item in ${escapeHtml(locker)} Safe</option>`;
  if (items.some((item) => item.id === selected)) {
    select.value = selected;
  } else if (items.length === 1) {
    select.value = items[0].id;
  } else {
    select.value = "";
  }
  applyCastingSafeItemToIssueForm();
}

function applyCastingSafeItemToIssueForm() {
  const form = document.getElementById("production-form");
  if (!form) return;
  const item = findSafeItemOrGroup(form.castingSafeItemId?.value, form.metalPurity.value);
  form.rodColour.value = item ? safeItemColour(item) || "-" : "";
  form.rodDesiredPurity.value = item ? displayPurity(safeItemDesiredPurity(item)) : "";
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
  setTransferCurrentNote(transferCurrentLocationHtml(lot, waxStoneWeight, settingStoneNote));
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
  renderTransferProcessOptions(form.karigarId.value, transfer.toDepartment || "");
  form.transferWeight.value = weight3(transfer.transferWeight);
  form.grossReceivedWeight.value = weight3(transfer.grossReceivedWeight);
  form.waxStoneWeight.value = weight3(transfer.waxStoneWeight);
  form.stoneWeight.value = weight3(transfer.stoneWeight);
  form.reducedWeight.value = weight3(transfer.reducedWeight ?? Number(transfer.waxStoneWeight || 0) + Number(transfer.stoneWeight || 0));
  form.receivedWeight.value = weight3(transfer.receivedWeight);
  form.departmentBalance.value = weight3(transfer.departmentBalance);
  form.fromDepartment.value = transfer.fromDepartment || "";
  form.reason.value = transfer.reason || "";
  setTransferCurrentNote(`
    <span>Editing transfer for ${escapeHtml(lot.number)}. Current department:</span>
    <strong class="transfer-current-dept">${escapeHtml(lot.karigarName || lot.currentDepartment || "-")}</strong>
    <span>Entry: ${escapeHtml(transfer.fromDepartment || "-")} to ${escapeHtml(transfer.toDepartment || transfer.toKarigarName || "-")}.</span>
  `);
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
  return [data.toDepartment, karigar?.name, karigar?.speciality, karigar ? departmentProcessText(karigar) : ""]
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
    .map((karigar) => `<option value="${karigar.id}">${escapeHtml(karigar.name)} - ${escapeHtml(departmentProcessText(karigar))}</option>`)
    .join("");
  document.querySelector('#transfer-form select[name="karigarId"]').innerHTML = options
    ? `<option value="">Select new department</option>${options}`
    : '<option value="">No other department available</option>';
  renderTransferProcessOptions("");
}

function renderTransferProcessOptions(departmentId, selectedProcess = "") {
  const form = document.getElementById("transfer-form");
  const select = form?.toDepartment;
  if (!select) return;
  const department = findById("karigars", departmentId);
  const processes = department ? departmentProcesses(department) : [];
  const selected = String(selectedProcess || "").trim();
  const optionValues = selected && !processes.includes(selected) ? [...processes, selected] : processes;
  select.innerHTML = optionValues.length
    ? `<option value="">Select process</option>${optionValues.map((process) => `<option value="${escapeHtml(process)}">${escapeHtml(process)}</option>`).join("")}`
    : '<option value="">Select department first</option>';
  select.value = selected && optionValues.includes(selected)
    ? selected
    : (optionValues.length === 1 ? optionValues[0] : "");
}

function updateTransferReasonFromProcess() {
  const form = document.getElementById("transfer-form");
  if (!form) return;
  const process = form.toDepartment.value;
  const currentReason = String(form.reason.value || "").trim();
  if (!process || (currentReason && !currentReason.toLowerCase().startsWith("next process:"))) return;
  form.reason.value = `Next process: ${process}`;
}

function applyProductionFlowDefaults(lot) {
  const form = document.getElementById("transfer-form");
  const nextStep = nextProductionFlowStep(lot);
  if (!nextStep) return;
  const targetDepartment = findFlowDepartment(nextStep, lot.karigarId);
  if (targetDepartment) form.karigarId.value = targetDepartment.id;
  renderTransferProcessOptions(form.karigarId.value, nextStep.label);
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
    textMatchesAny(`${karigar.name || ""} ${departmentProcessText(karigar)}`, step.departmentMatches)
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
  renderLoginUserOptions();
  renderSelects();
  renderDashboard();
  renderCustomers();
  renderDesigns();
  renderStoneLibrary();
  renderOrders();
  renderProduction();
  renderBills();
  renderOffice();
  renderSafe();
  renderFactory();
  renderLedger();
  renderMelting();
  renderKarigars();
  renderOnlineTransferHistory();
  renderDepartmentTransferHistoryBoard();
  renderReports();
  renderLoginUsers();
}

function renderLoginUsers() {
  const table = document.getElementById("login-users-table");
  if (!table) return;
  renderNewUserAccessPicker();
  const rows = Object.entries(allUsers()).map(([id, user]) => {
    const isBuiltIn = Boolean(users[id]);
    const isOwnerRow = id === "owner";
    return `
    <tr>
      <td><strong>${escapeHtml(id)}</strong></td>
      <td><input name="userName" value="${escapeHtml(user.name)}" ${isOwnerRow ? "readonly" : ""}></td>
      <td>${isOwnerRow ? "Full software" : renderUserAccessCheckboxes(id, user.pages)}</td>
      <td><span class="password-pill">${escapeHtml(userPassword(id))}</span></td>
      <td><input name="newPassword" type="text" placeholder="Enter new password"></td>
      <td>
        <div class="login-user-actions">
          <button type="button" data-save-user="${escapeHtml(id)}">Save</button>
          ${isBuiltIn ? "" : `<button type="button" class="delete-btn" data-delete-user="${escapeHtml(id)}">Delete</button>`}
        </div>
      </td>
    </tr>
  `;
  }).join("");
  table.innerHTML = isOwner() ? rows : tableEmpty(6, "Only Owner can view login details.");
}

function renderNewUserAccessPicker() {
  const container = document.getElementById("new-user-access");
  if (!container) return;
  container.innerHTML = renderUserAccessCheckboxes("new", ["dashboard"]);
}

function renderUserAccessCheckboxes(userId, selectedPages = []) {
  const selected = new Set(Array.isArray(selectedPages) ? selectedPages : []);
  return `<div class="login-access-grid">${loginAccessPages.map((page) => `
    <label>
      <input type="checkbox" name="pages" value="${escapeHtml(page)}" ${selected.has(page) ? "checked" : ""}>
      ${escapeHtml(pageInfo[page]?.[0] || page)}
    </label>
  `).join("")}</div>`;
}

function selectedAccessPages(container) {
  return [...container.querySelectorAll('input[name="pages"]:checked')].map((input) => input.value);
}

function normalizeLoginUserId(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
}

function addLoginUser(form) {
  const data = getFormData(form);
  const userId = normalizeLoginUserId(data.userId);
  const password = String(data.password || "").trim();
  const pages = selectedAccessPages(form);
  if (!userId || !data.name.trim() || !password) {
    alert("Enter user ID, name, and password.");
    return;
  }
  if (allUsers()[userId]) {
    alert("This user ID already exists.");
    return;
  }
  if (!pages.length) {
    alert("Select at least one access page.");
    return;
  }
  state.customUsers.push({
    id: userId,
    name: data.name.trim(),
    role: "custom",
    pages,
    canEditOfficeWeights: false,
  });
  state.userPasswords[userId] = password;
  saveState();
  form.reset();
  renderLoginUserOptions();
  renderLoginUsers();
  alert("User added.");
}

function saveLoginUser(userId, row) {
  if (!row || !allUsers()[userId]) return;
  const name = row.querySelector('[name="userName"]')?.value.trim() || allUsers()[userId].name;
  const password = row.querySelector('[name="newPassword"]')?.value.trim() || "";
  const pages = userId === "owner" ? "all" : selectedAccessPages(row);
  if (userId !== "owner" && !pages.length) {
    alert("Select at least one access page.");
    return;
  }
  const customUser = (state.customUsers || []).find((user) => user.id === userId);
  if (customUser) {
    customUser.name = name;
    customUser.pages = pages;
  } else if (userId !== "owner") {
    state.userAccessOverrides[userId] = {
      ...(state.userAccessOverrides[userId] || {}),
      name,
      pages,
    };
  }
  if (password) state.userPasswords[userId] = password;
  if (currentUser?.id === userId) {
    currentUser.name = allUsers()[userId]?.name || name;
    localStorage.setItem("gold-jewellery-erp-user", JSON.stringify(currentUser));
  }
  saveState();
  renderLoginUserOptions();
  renderLoginUsers();
  applyAccessControl();
  alert("User updated.");
}

function deleteLoginUser(userId) {
  if (!confirm(`Delete user ${userId}?`)) return;
  state.customUsers = (state.customUsers || []).filter((user) => user.id !== userId);
  delete state.userPasswords[userId];
  delete state.userAccessOverrides[userId];
  saveState();
  renderLoginUserOptions();
  renderLoginUsers();
  alert("User deleted.");
}

function renderStoneLibrary() {
  renderStoneFormOptions();
  renderStoneLookupOptions();
  renderStoneLookup();
  renderStoneLibraryList();
}

function renderStoneLibraryList() {
  const query = document.getElementById("stone-search").value.trim().toLowerCase();
  const lookupType = document.getElementById("stone-lookup-type")?.value || "";
  const lookupShape = document.getElementById("stone-lookup-shape")?.value || "";
  const lookupSize = document.getElementById("stone-lookup-size")?.value || "";
  const hasSearch = Boolean(query || lookupType || lookupShape || lookupSize);
  const matches = state.stones.filter((stone) =>
    `${stone.stoneType} ${stone.shape} ${stone.size} ${stone.code} ${stone.weightPerPc} ${stone.pricePerPc} ${stone.remarks}`.toLowerCase().includes(query) &&
    (!lookupType || stone.stoneType === lookupType) &&
    (!lookupShape || stone.shape === lookupShape) &&
    (!lookupSize || stone.size === lookupSize)
  );
  const totalPages = Math.max(Math.ceil(matches.length / stoneLibraryPageSize), 1);
  stoneLibraryPage = Math.min(Math.max(stoneLibraryPage, 1), totalPages);
  const start = (stoneLibraryPage - 1) * stoneLibraryPageSize;
  const visible = matches.slice(start, start + stoneLibraryPageSize);
  const tableWrap = document.getElementById("stone-table").closest(".table-wrap");
  const pagination = document.getElementById("stone-pagination");
  document.getElementById("stone-library-summary").textContent =
    hasSearch
      ? `${matches.length} match${matches.length === 1 ? "" : "es"} found. Showing ${visible.length ? start + 1 : 0}-${start + visible.length} of ${matches.length}.`
      : "Select Type / Shape / Size or type in search to show stone details.";
  tableWrap.classList.toggle("hidden", !hasSearch);
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
    : hasSearch ? tableEmpty(8, "No stones found.") : "";
  pagination.classList.toggle("hidden", !hasSearch);
  pagination.innerHTML = hasSearch && matches.length
    ? `
      <button class="ghost-button" type="button" onclick="changeStonePage(-1)" ${stoneLibraryPage <= 1 ? "disabled" : ""}>Previous</button>
      <span>Page ${stoneLibraryPage} of ${totalPages}</span>
      <button class="ghost-button" type="button" onclick="changeStonePage(1)" ${stoneLibraryPage >= totalPages ? "disabled" : ""}>Next</button>
    `
    : "";
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
  stoneLibraryPage = 1;
  renderStoneLibraryList();
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
  if (!requireOwnerPermission("edit stone master")) return;
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
  if (!requireOwnerPermission("delete stone from master")) return;
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

function departmentProcessesFromText(value = "") {
  const parts = String(value || "")
    .split(/[,;|\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

function departmentProcesses(department = {}) {
  const savedProcesses = Array.isArray(department.processes)
    ? department.processes.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const textProcesses = departmentProcessesFromText(department.speciality || "");
  const processes = [...new Set([...savedProcesses, ...textProcesses])];
  return processes.length ? processes : [department.name || "Process"];
}

function departmentProcessText(department = {}) {
  return departmentProcesses(department).join(", ");
}

function primaryDepartmentProcess(department = {}) {
  return departmentProcesses(department)[0] || department.speciality || department.name || "";
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
    .map((karigar) => `<option value="${karigar.id}">${escapeHtml(karigar.name)} - ${escapeHtml(departmentProcessText(karigar))}</option>`)
    .join("");
  document.querySelectorAll('#production-form select[name="jobNumber"]').forEach((select) => {
    const selected = select.value;
    select.innerHTML = orderOptions ? `<option value="">Select job card</option>${orderOptions}` : '<option value="">No open job cards</option>';
    select.value = groupedJobOrders().some((job) => job.jobNumber === selected && job.status === "Pending") ? selected : "";
  });
  applyIssuePurityFromJob();
  updateProductionCastingItemOptions();
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

function normalizeStoneItemKey(value = "") {
  const text = String(value || "").trim();
  const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact || ["GENERAL", "GEN", "DEFAULT", "ALL"].includes(compact)) return DEFAULT_STONE_ITEM_KEY;
  const preset = STONE_ITEM_PRESETS.find(([key, label]) =>
    compact === key || compact === label.toUpperCase().replace(/[^A-Z0-9]/g, "")
  );
  if (preset) return preset[0];
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim() || DEFAULT_STONE_ITEM_KEY;
}

function stoneItemStorageSuffix(itemKey = "") {
  return normalizeStoneItemKey(itemKey).replace(/[^A-Z0-9]+/g, "-");
}

function stoneItemLabel(itemKey = "") {
  const key = normalizeStoneItemKey(itemKey);
  return STONE_ITEM_PRESETS.find(([presetKey]) => presetKey === key)?.[1] || key;
}

function stoneItemInputValue(itemKey = "") {
  const key = normalizeStoneItemKey(itemKey);
  return key === DEFAULT_STONE_ITEM_KEY ? "General" : key;
}

function isCbrStoneDesign(design = null) {
  const category = categoryCode(design?.category || "");
  const designTextValue = `${design?.number || ""} ${design?.name || ""} ${category}`.toUpperCase();
  return category === "CBR" || /\bCBR\b/.test(designTextValue);
}

function isCmSetStoneDesign(design = null) {
  const category = categoryCode(design?.category || "");
  const designTextValue = `${design?.number || ""} ${design?.name || ""} ${category}`.toUpperCase();
  return ["CM", "CMB", "CME"].includes(category) || /\bCM(E|B)?\b/.test(designTextValue) || /\bCHAMS?\b/.test(designTextValue);
}

function isRegularRingStoneDesign(design = null) {
  const category = categoryCode(design?.category || "");
  const designTextValue = `${design?.number || ""} ${design?.name || ""} ${category}`.toUpperCase();
  return ["LR", "GR", "RING", "RINGS"].includes(category) || /\b(LR|GR|RING|RINGS)\b/.test(designTextValue);
}

function baseStoneItemKeysForDesign(design = null) {
  const category = categoryCode(design?.category || "");
  if (isCbrStoneDesign(design)) return ["CLR", "CGR"];
  if (category === "CB") return ["CL", "CG"];
  if (isRegularRingStoneDesign(design)) return ["LR", "GR"];
  if (isCmSetStoneDesign(design)) return ["CM", "CME", "CMB"];
  return [DEFAULT_STONE_ITEM_KEY];
}

function defaultStoneItemKeyForDesign(design = null) {
  return baseStoneItemKeysForDesign(design)[0] || DEFAULT_STONE_ITEM_KEY;
}

function stoneItemKeyFromFileName(fileName = "", design = null) {
  return explicitStoneItemKeyFromFileName(fileName, design) || defaultStoneItemKeyForDesign(design);
}

function explicitStoneItemKeyFromFileName(fileName = "", design = null) {
  const name = ` ${designNameFromFile(fileName).toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  const isCbr = isCbrStoneDesign(design);
  const category = categoryCode(design?.category || "");
  if (/\bCGR\b/.test(name) || (isCbr && /\bCG\b/.test(name))) return "CGR";
  if (/\bCLR\b/.test(name) || (isCbr && /\bCL\b/.test(name))) return "CLR";
  if (isCbr && (/\bGR\b/.test(name) || /\bGENTS?\b/.test(name))) return "CGR";
  if (isCbr && (/\bLR\b/.test(name) || /\bLADIES?\b/.test(name))) return "CLR";
  if (/\bCME\b/.test(name)) return "CME";
  if (/\bCMB\b/.test(name)) return "CMB";
  if (/\bCHAMS?\b/.test(name) && /\b(EAR|EARRING|EARRINGS|ER)\b/.test(name)) return "CME";
  if (/\bCHAMS?\b/.test(name) && /\b(BRACELET|BR)\b/.test(name)) return "CMB";
  if (/\bCG\b/.test(name)) return "CG";
  if (/\bCL\b/.test(name)) return "CL";
  if (category === "CB" && (/\bGR\b/.test(name) || /\bGENTS?\b/.test(name))) return "CG";
  if (category === "CB" && (/\bLR\b/.test(name) || /\bLADIES?\b/.test(name))) return "CL";
  if (/\bGR\b/.test(name) || /\bGENTS?\b/.test(name)) return "GR";
  if (/\bLR\b/.test(name) || /\bLADIES?\b/.test(name)) return "LR";
  if (/\bCM\b/.test(name) || /\bCHAMS?\b/.test(name)) return "CM";
  return "";
}

function stoneItemOptionKeysForDesign(design = null) {
  const baseKeys = baseStoneItemKeysForDesign(design);
  const isSpecificMultiItemDesign = isCbrStoneDesign(design) || categoryCode(design?.category || "") === "CB" || isCmSetStoneDesign(design);
  const keys = new Set(baseKeys);
  const category = categoryCode(design?.category || "");
  if (!isSpecificMultiItemDesign && category) keys.add(category);
  const addExistingKey = (value) => {
    const key = normalizeStoneItemKey(value);
    if (key === DEFAULT_STONE_ITEM_KEY && isSpecificMultiItemDesign) return;
    keys.add(key);
  };
  (design?.stoneChartItems || []).forEach((item) => addExistingKey(item.itemKey || item));
  (design?.stoneItems || []).forEach((item) => addExistingKey(item.itemKey));
  state.orders
    .filter((order) => design?.id && order.designId === design.id)
    .flatMap(orderStoneItemKeys)
    .forEach(addExistingKey);
  return [...keys];
}

function stoneItemSelectOptionsForDesign(design = null, selected = "") {
  const selectedKey = normalizeStoneItemKey(selected);
  const keys = stoneItemOptionKeysForDesign(design);
  if (selectedKey && !keys.includes(selectedKey)) keys.push(selectedKey);
  return keys
    .map((key) => {
      const itemKey = normalizeStoneItemKey(key);
      return `<option value="${escapeHtml(itemKey)}" ${itemKey === selectedKey ? "selected" : ""}>${escapeHtml(stoneItemLabel(itemKey))}</option>`;
    })
    .join("");
}

function setStoneItemSelectOptions(select, design = null, selected = "") {
  if (!select) return DEFAULT_STONE_ITEM_KEY;
  const optionKeys = stoneItemOptionKeysForDesign(design);
  const requestedKey = normalizeStoneItemKey(selected || select.value || defaultStoneItemKeyForDesign(design));
  const selectedKey = optionKeys.includes(requestedKey) ? requestedKey : defaultStoneItemKeyForDesign(design);
  select.innerHTML = stoneItemSelectOptionsForDesign(design, selectedKey);
  select.value = selectedKey;
  return selectedKey;
}

function updateStoneItemDatalist(design = null) {
  const list = document.getElementById("stone-item-key-list");
  if (list) {
    list.innerHTML = stoneItemOptionKeysForDesign(design)
      .map((key) => `<option value="${escapeHtml(stoneItemInputValue(key))}" label="${escapeHtml(stoneItemLabel(key))}"></option>`)
      .join("");
  }
}

function currentStoneEntryItemKey() {
  const form = document.getElementById("stone-entry-form");
  return normalizeStoneItemKey(form?.stoneItemKey?.value || DEFAULT_STONE_ITEM_KEY);
}

function currentStoneCropItemKey() {
  return normalizeStoneItemKey(document.getElementById("stone-crop-item-key")?.value || DEFAULT_STONE_ITEM_KEY);
}

function markDesignStoneChart(design, itemKey = DEFAULT_STONE_ITEM_KEY, hasChart = true) {
  if (!design) return;
  const key = normalizeStoneItemKey(itemKey);
  const existingChartItems = design.stoneChartItems?.length
    ? design.stoneChartItems
    : (design.hasStoneChart ? [{ itemKey: DEFAULT_STONE_ITEM_KEY, label: stoneItemLabel(DEFAULT_STONE_ITEM_KEY) }] : []);
  const items = existingChartItems
    .map((item) => ({ itemKey: normalizeStoneItemKey(item.itemKey || item), label: item.label || stoneItemLabel(item.itemKey || item) }))
    .filter((item, index, list) => item.itemKey !== key && list.findIndex((candidate) => candidate.itemKey === item.itemKey) === index);
  if (hasChart) items.push({ itemKey: key, label: stoneItemLabel(key) });
  design.stoneChartItems = items;
  design.hasStoneChart = items.length > 0;
}

function markDesignStoneChartSource(design, sourceName = "") {
  if (!design) return;
  design.hasStoneChartSource = true;
  if (sourceName) design.stoneChartSourceName = sourceName;
}

function designStoneChartItemKeys(design = {}) {
  const keys = new Set();
  if (design.stoneChartItems?.length) {
    design.stoneChartItems.forEach((item) => keys.add(normalizeStoneItemKey(item.itemKey || item)));
  } else if (design.hasStoneChart) {
    keys.add(DEFAULT_STONE_ITEM_KEY);
  }
  return [...keys];
}

function designHasStoneChartForItem(design, itemKey = DEFAULT_STONE_ITEM_KEY) {
  const key = normalizeStoneItemKey(itemKey);
  return designStoneChartItemKeys(design).includes(key);
}

function designStoneItemsForKey(design, itemKey = DEFAULT_STONE_ITEM_KEY) {
  const key = normalizeStoneItemKey(itemKey);
  return (design?.stoneItems || []).filter((item) => normalizeStoneItemKey(item.itemKey) === key);
}

function orderStoneItemKeys(order = {}) {
  const category = categoryCode(order.category || "");
  const itemText = `${order.category || ""} ${order.item || ""} ${order.designNumber || ""}`.toUpperCase();
  const selectedCmKeys = cmItemTypeKeys(order.cmItemType);
  if (selectedCmKeys.length) return selectedCmKeys;
  const isCbrOrder = category === "CBR" || /\bCBR\b/.test(itemText);
  if (isCbrOrder) {
    if (order.ringType === "CL+CG") return ["CLR", "CGR"];
    if (order.ringType === "CL" || order.ringType === "CLR") return ["CLR"];
    if (order.ringType === "CG" || order.ringType === "CGR") return ["CGR"];
    if (/\bCGR\b/.test(itemText)) return ["CGR"];
    if (/\bCLR\b/.test(itemText)) return ["CLR"];
  }
  if (isCbCategory(order.category)) {
    if (order.ringType === "CL+CG") return ["CL", "CG"];
    if (["CL", "CG"].includes(order.ringType)) return [order.ringType];
  }
  if (/\bCME\b/.test(itemText)) return ["CME"];
  if (/\bCMB\b/.test(itemText)) return ["CMB"];
  if (/\bCHAMS?\b/.test(itemText) && /\b(EAR|EARRING|EARRINGS|ER)\b/.test(itemText)) return ["CME"];
  if (/\bCHAMS?\b/.test(itemText) && /\b(BRACELET|BR)\b/.test(itemText)) return ["CMB"];
  if (/\bCHAMS?\b/.test(itemText)) return ["CM"];
  if (["CM", "CMB", "CME"].includes(category)) return [category];
  if (["LR", "GR"].includes(category)) return [category];
  if (/\bGR\b/.test(itemText) || /\bGENTS?\b/.test(itemText)) return ["GR"];
  if (/\bLR\b/.test(itemText) || /\bLADIES?\b/.test(itemText)) return ["LR"];
  return [DEFAULT_STONE_ITEM_KEY];
}

function designStoneItemsForOrder(design, order = {}) {
  const allItems = design?.stoneItems || [];
  const keys = orderStoneItemKeys(order);
  const specificItems = allItems.filter((item) => keys.includes(normalizeStoneItemKey(item.itemKey)));
  if (specificItems.length) return specificItems;
  return designStoneItemsForKey(design, DEFAULT_STONE_ITEM_KEY);
}

function normalizedDesignMatchKey(value = "") {
  return designNameFromFile(String(value || ""))
    .toLowerCase()
    .replace(/\b(stone|chart|sheet|gem|report|image|photo|design|file|both|with|and|jewellery|jewelry)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

function isStoneChartUploadFile(fileName = "") {
  const name = designNameFromFile(fileName).replace(/[_-]+/g, " ");
  return /\b(stone|chart|sheet|gem|report|ocr|both)\b/i.test(name);
}

function cleanUploadDesignName(fileName = "") {
  const rawName = designNameFromFile(fileName);
  const cleaned = rawName
    .replace(/\b(stone|chart|sheet|gem|report|image|photo|design|file|both|with|and)\b/ig, " ")
    .replace(/[_-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || rawName;
}

function groupDesignUploadFiles(files = []) {
  const groups = new Map();
  [...files].forEach((file) => {
    const key = normalizedDesignMatchKey(file.name) || cleanUploadDesignName(file.name).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key) return;
    if (!groups.has(key)) groups.set(key, { key, files: [] });
    groups.get(key).files.push(file);
  });
  return [...groups.values()].map((group) => {
    const normalDesignFile = group.files.find((file) => !isStoneChartUploadFile(file.name));
    const designFile = normalDesignFile || group.files[0];
    const chartFiles = group.files.filter((file) =>
      file !== designFile && isStoneChartUploadFile(file.name)
    );
    if (isStoneChartUploadFile(designFile.name)) chartFiles.unshift(designFile);
    if (!chartFiles.length && group.files.length > 1) {
      chartFiles.push(...group.files.filter((file) => file !== designFile));
    }
    return {
      ...group,
      designFile,
      chartFiles: [...new Set(chartFiles)],
      designName: normalDesignFile ? designNameFromFile(designFile.name) : cleanUploadDesignName(designFile.name),
    };
  });
}

function createDesignFromUploadGroup(group, category, nameOverride = "") {
  const designName = nameOverride || group.designName || designNameFromFile(group.designFile?.name) || "Design";
  return {
    id: crypto.randomUUID(),
    number: designName,
    name: designName,
    category,
    stoneDetails: "",
    stoneItems: [],
    stoneChartItems: [],
    hasStoneChartSource: false,
    stoneChartSourceName: "",
    hasStoneChart: false,
  };
}

function findDesignByUploadKey(key) {
  return state.designs.find((design) => designMatchKeys(design).includes(key));
}

async function mergeUploadGroupIntoDesign(group, design, category, stoneChartFiles = [], replaceDesignImage = false, options = {}) {
  if (!group || !design) return { updated: 0, chartAttached: 0 };
  if (category && !design.category) design.category = category;
  let chartAttached = 0;
  if (group.designFile && !isStoneChartUploadFile(group.designFile.name)) {
    const smartImageResult = await saveDesignUploadImageAndAutoChart(design, group.designFile, { saveDesign: replaceDesignImage, cropPermission: options.cropPermission });
    chartAttached = smartImageResult.chartAttached ? 1 : 0;
  }
  const chartCandidates = [...(group.chartFiles || []), ...stoneChartFiles];
  const matchingStoneChartFile = matchingStoneChartFileForDesign(chartCandidates, design) || group.chartFiles?.[0] || null;
  if (matchingStoneChartFile) {
    const matchingStoneChartResult = await saveStoneChartFileForDesign(design, matchingStoneChartFile);
    chartAttached = matchingStoneChartResult.sourceSaved || matchingStoneChartResult.itemSaved ? 1 : chartAttached;
  }
  updateDesignReferences(design);
  return { updated: 1, chartAttached };
}

function chooseDuplicateDesignUploadAction(duplicateGroups = []) {
  if (!duplicateGroups.length) return "SKIP";
  const preview = duplicateGroups.slice(0, 20).map(({ group, existingDesign }, index) =>
    `${index + 1}. ${group.designName || designNameFromFile(group.designFile?.name) || "Design"} -> ${designText(existingDesign)}`
  ).join("\n");
  const extra = duplicateGroups.length > 20 ? `\n...and ${duplicateGroups.length - 20} more duplicate(s).` : "";
  const action = prompt(
    `${duplicateGroups.length} duplicate design image(s) found.\n\n${preview}${extra}\n\nChoose ONE action for all duplicate images:\nMERGE = attach chart/details to existing design, design image unchanged.\nREPLACE = replace existing design image also.\nNEW = save each duplicate as a new copy with automatic COPY name.\nSKIP = ignore all duplicate images.`,
    "MERGE"
  );
  const choice = String(action || "SKIP").trim().toUpperCase();
  return ["MERGE", "REPLACE", "NEW", "SKIP"].includes(choice) ? choice : "SKIP";
}

function uniqueDuplicateDesignCopyName(baseName) {
  const cleanBase = String(baseName || "Design").trim() || "Design";
  let suffix = "COPY";
  let candidate = `${cleanBase}-${suffix}`;
  let index = 2;
  while (findDesignByUploadKey(normalizedDesignMatchKey(candidate))) {
    suffix = `COPY-${index}`;
    candidate = `${cleanBase}-${suffix}`;
    index += 1;
  }
  return candidate;
}

async function resolveDuplicateDesignUpload(group, existingDesign, category, stoneChartFiles = [], options = {}) {
  const designName = group.designName || designText(existingDesign);
  const action = options.duplicateAction || prompt(
    `Duplicate design number found: ${designName}\nExisting: ${designText(existingDesign)}\n\nType MERGE to attach stone chart/details to existing.\nType REPLACE to also replace existing design image.\nType NEW to keep as separate design.\nType SKIP to ignore this duplicate.`,
    "MERGE"
  );
  const choice = String(action || "SKIP").trim().toUpperCase();
  if (choice === "MERGE") {
    const result = await mergeUploadGroupIntoDesign(group, existingDesign, category, stoneChartFiles, false, options);
    return { created: 0, updated: result.updated, chartAttached: result.chartAttached };
  }
  if (choice === "REPLACE") {
    const result = await mergeUploadGroupIntoDesign(group, existingDesign, category, stoneChartFiles, true, options);
    return { created: 0, updated: result.updated, chartAttached: result.chartAttached };
  }
  if (choice === "NEW") {
    const copyName = options.duplicateAction ? uniqueDuplicateDesignCopyName(designName) : prompt("Enter design number for this separate duplicate:", uniqueDuplicateDesignCopyName(designName));
    const cleanCopyName = String(copyName || "").trim();
    if (!cleanCopyName) return { created: 0, updated: 0, chartAttached: 0 };
    const design = createDesignFromUploadGroup(group, category, cleanCopyName);
    state.designs.push(design);
    let chartAttached = 0;
    if (group.designFile) {
      const smartImageResult = await saveDesignUploadImageAndAutoChart(design, group.designFile, { saveDesign: true, cropPermission: options.cropPermission });
      chartAttached = smartImageResult.chartAttached ? 1 : 0;
    }
    const chartCandidates = [...(group.chartFiles || []), ...stoneChartFiles];
    const matchingStoneChartFile = matchingStoneChartFileForDesign(chartCandidates, design) || group.chartFiles?.[0] || null;
    if (matchingStoneChartFile) {
      const matchingStoneChartResult = await saveStoneChartFileForDesign(design, matchingStoneChartFile);
      chartAttached = matchingStoneChartResult.sourceSaved || matchingStoneChartResult.itemSaved ? 1 : chartAttached;
    }
    return { created: 1, updated: 0, chartAttached };
  }
  return { created: 0, updated: 0, chartAttached: 0 };
}

function designMatchKeys(design) {
  return [...new Set([
    design?.number,
    design?.name,
    design ? designText(design) : "",
  ].map(normalizedDesignMatchKey).filter((key) => key.length >= 3))];
}

function stoneChartFileMatchesDesign(fileName, design) {
  const fileKey = normalizedDesignMatchKey(fileName);
  if (!fileKey) return false;
  return designMatchKeys(design).some((key) => {
    if (fileKey === key) return true;
    if (key.length >= 5 && fileKey.includes(key)) return true;
    if (fileKey.length >= 5 && key.includes(fileKey)) return true;
    return false;
  });
}

function matchingStoneChartFileForDesign(files = [], design) {
  return [...files].find((file) => stoneChartFileMatchesDesign(file.name, design)) || null;
}

function findDesignForStoneChartFile(fileName) {
  return sortedDesigns().find((design) => stoneChartFileMatchesDesign(fileName, design)) || null;
}

async function saveStoneChartFileForDesign(design, file, itemKey = "", options = {}) {
  if (!design || !file) return { imageData: "", itemSaved: false, sourceSaved: false };
  const split = await autoSplitDesignAndStoneChart(file).catch(() => null);
  const imageData = split?.stoneChartImageData || await compressStoneChartImage(file);
  const explicitKey = itemKey ? normalizeStoneItemKey(itemKey) : explicitStoneItemKeyFromFileName(file.name, design);
  const shouldSaveItem = options.saveItem !== false && (Boolean(itemKey) || Boolean(explicitKey) || !baseStoneItemKeysForDesign(design).some((key) => key !== DEFAULT_STONE_ITEM_KEY));
  if (shouldSaveItem) {
    const targetItemKey = normalizeStoneItemKey(explicitKey || defaultStoneItemKeyForDesign(design));
    await saveStoneChartImage(design.id, imageData, targetItemKey);
    markDesignStoneChart(design, targetItemKey, true);
    return { imageData, itemSaved: true, sourceSaved: false, itemKey: targetItemKey };
  }
  return { imageData, itemSaved: false, sourceSaved: false, itemKey: "" };
}

function confirmStoneChartCrop(message) {
  return confirm(`${message}\n\nOnly the stone chart crop will be saved. The design image will stay unchanged.`);
}

function createStoneCropUploadPermission() {
  return { asked: false, allow: false };
}

function shouldSaveAutoDetectedStoneChart(design, file, permission) {
  if (!permission) {
    return confirmStoneChartCrop(`Stone chart detected in ${file.name}. Save this cropped chart to ${designText(design)}?`);
  }
  if (!permission.asked) {
    permission.asked = true;
    permission.allow = confirm(
      `Stone chart detected during this design upload lot.\n\nFirst detected file: ${file.name}\nDesign: ${designText(design)}\n\nSave all auto-detected cropped stone charts for this whole upload lot?\n\nOK = save all detected charts in this upload.\nCancel = skip auto-cropped charts for this upload.\n\nDesign images will stay unchanged.`
    );
  }
  return permission.allow;
}

async function saveDesignUploadImageAndAutoChart(design, file, options = {}) {
  const saveDesign = options.saveDesign !== false;
  if (!design || !file) return { designSaved: false, chartAttached: false, autoSplit: false };
  if (isStoneChartUploadFile(file.name)) {
    const result = await saveStoneChartFileForDesign(design, file);
    return { designSaved: false, chartAttached: result.sourceSaved || result.itemSaved, autoSplit: false };
  }
  const split = await autoSplitDesignAndStoneChart(file).catch((error) => {
    console.warn("Auto stone chart crop failed", error);
    return null;
  });
  let designSaved = false;
  if (saveDesign) {
    await saveDesignImage(design.id, await compressImageFile(file));
    designSaved = true;
  }
  let chartAttached = false;
  if (split?.stoneChartImageData) {
    const targetItemKey = stoneItemKeyFromFileName(file.name, design);
    const shouldSaveChart = shouldSaveAutoDetectedStoneChart(design, file, options.cropPermission);
    if (shouldSaveChart) {
      await saveStoneChartImage(design.id, split.stoneChartImageData, targetItemKey);
      markDesignStoneChart(design, targetItemKey, true);
      chartAttached = true;
    }
  }
  return {
    designSaved,
    chartAttached,
    autoSplit: chartAttached,
  };
}

async function autoSplitDesignAndStoneChart(file) {
  const imageData = await readFileAsDataUrl(file);
  const split = await autoSplitDesignAndStoneChartDataUrl(imageData);
  if (!split?.stoneChartImageData) return null;
  return split;
}

async function autoSplitDesignAndStoneChartDataUrl(imageData) {
  const image = await loadImageFromDataUrl(imageData);
  const chartRect = detectStoneChartRectFromImage(image);
  if (!chartRect) return null;
  const stoneChartImageData = cropImageToDataUrl(image, chartRect, { maxSize: 1800, quality: 0.94 });
  return { stoneChartImageData, chartRect };
}

async function autoAssignStoneChartFiles(files = []) {
  const assignedCharts = new Set();
  let assignedCount = 0;
  for (const file of [...files]) {
    const design = findDesignForStoneChartFile(file.name);
    if (!design) continue;
    const itemKey = explicitStoneItemKeyFromFileName(file.name, design);
    const assignKey = `${design.id}|${itemKey || "SOURCE"}`;
    if (assignedCharts.has(assignKey)) continue;
    await saveStoneChartFileForDesign(design, file, itemKey, { saveItem: Boolean(itemKey) });
    assignedCharts.add(assignKey);
    assignedCount += 1;
  }
  if (assignedCount) {
    saveState();
    renderDesigns();
    updateStoneDesignOptions(document.querySelector('#stone-entry-form [name="stoneDesignId"]')?.value || "");
  }
  return assignedCount;
}

async function assignSelectedStoneChartFiles() {
  const form = document.getElementById("stone-entry-form");
  const files = [...form.stoneChart.files];
  selectedStoneChartFiles = files;
  if (!files.length) {
    alert("Select one or more stone sheet images first.");
    return 0;
  }
  const assignedCount = await autoAssignStoneChartFiles(files);
  const note = document.getElementById("stone-chart-quality");
  note.className = `dialog-note ocr-quality-note ${assignedCount ? "good" : "warn"}`;
  note.textContent = assignedCount
    ? `${assignedCount} stone sheet file(s) assigned by matching design name.`
    : "No matching design name found. Use Crop Chart From Design and choose the design manually.";
  return assignedCount;
}

async function stoneCropSourcesFromSelection() {
  const form = document.getElementById("stone-entry-form");
  const files = [...form.stoneChart.files].length ? [...form.stoneChart.files] : selectedStoneChartFiles;
  if (files.length) return files.map((file) => {
    const matchedDesign = findDesignForStoneChartFile(file.name) || findById("designs", form.stoneDesignId.value);
    const explicitItemKey = matchedDesign ? explicitStoneItemKeyFromFileName(file.name, matchedDesign) : "";
    return { name: file.name, file, designId: matchedDesign?.id || "", itemKey: explicitItemKey || currentStoneEntryItemKey(), sourceImage: true };
  });
  const design = findById("designs", form.stoneDesignId.value);
  if (design) {
    const sources = [];
    const designImageData = await getDesignImage(design.id).catch(() => design.imageData || "");
    if (designImageData) {
      sources.push({ name: `${designText(design)} design image (${DESIGN_IMAGE_ASPECT_TEXT})`, imageData: designImageData, designId: design.id, itemKey: currentStoneEntryItemKey(), fullDesignImage: true });
    }
    for (const itemKey of designStoneChartItemKeys(design)) {
      const imageData = await getStoneChartImage(design.id, itemKey).catch(() => "");
      if (imageData) sources.push({ name: `${designText(design)} saved item crop - ${stoneItemInputValue(itemKey)}`, imageData, designId: design.id, itemKey, itemChart: true });
    }
    if (!designImageData) {
      const savedSourceImageData = await getStoneChartSourceImage(design.id).catch(() => "");
      const legacySourceImageData = savedSourceImageData ? "" : await getStoneChartImage(design.id, DEFAULT_STONE_ITEM_KEY).catch(() => "");
      const mainSourceImageData = savedSourceImageData || legacySourceImageData;
      if (mainSourceImageData) {
        sources.push({ name: `${designText(design)} old full stone chart copy`, imageData: mainSourceImageData, designId: design.id, itemKey: currentStoneEntryItemKey(), legacySourceImage: true });
      }
    }
    if (sources.length) return sources;
  }
  return [];
}

async function openStoneCropDialog() {
  const sources = await stoneCropSourcesFromSelection();
  if (!sources.length) {
    alert("Upload a stone chart or design image first, then crop.");
    return false;
  }
  stoneCropState.files = sources;
  stoneCropState.sourceIndex = 0;
  stoneCropState.rect = null;
  renderStoneCropSourceOptions();
  document.getElementById("stone-crop-reupload").value = "";
  document.getElementById("stone-crop-dialog").showModal();
  await loadStoneCropSource(0);
  return true;
}

function renderStoneCropSourceOptions() {
  const sourceSelect = document.getElementById("stone-crop-source");
  sourceSelect.innerHTML = stoneCropState.files.map((source, index) => {
    const matched = source.designId ? findById("designs", source.designId) : findDesignForStoneChartFile(source.name);
    const suffix = matched ? ` -> ${designText(matched)}` : "";
    return `<option value="${index}">${escapeHtml(source.name + suffix)}</option>`;
  }).join("");
  sourceSelect.value = String(stoneCropState.sourceIndex || 0);
}

function renderStoneCropDesignOptions(selectedDesignId = "") {
  const select = document.getElementById("stone-crop-design");
  const designs = sortedDesigns();
  select.innerHTML = `<option value="">Select design</option>` + designs
    .map((design) => `<option value="${design.id}">${escapeHtml(designText(design))} / ${escapeHtml(design.category || "Uncategorised")}</option>`)
    .join("");
  select.value = designs.some((design) => design.id === selectedDesignId) ? selectedDesignId : "";
  updateStoneCropItemOptions();
}

function updateStoneCropItemOptions(itemKey = "") {
  const design = findById("designs", document.getElementById("stone-crop-design")?.value || "");
  updateStoneItemDatalist(design);
  const input = document.getElementById("stone-crop-item-key");
  setStoneItemSelectOptions(input, design, itemKey || currentStoneEntryItemKey());
}

async function loadStoneCropSource(index = 0) {
  const source = stoneCropState.files[index];
  if (!source) return;
  stoneCropState.sourceIndex = index;
  stoneCropState.rect = null;
  const matchedDesign = source.designId ? findById("designs", source.designId) : findDesignForStoneChartFile(source.name);
  const currentDesignId = document.querySelector('#stone-entry-form [name="stoneDesignId"]')?.value || "";
  renderStoneCropDesignOptions(matchedDesign?.id || currentDesignId);
  updateStoneCropItemOptions(source.itemKey || stoneItemKeyFromFileName(source.name, matchedDesign));
  document.getElementById("stone-crop-status").textContent = "Drag on the image to mark the stone chart area.";
  const imageData = source.imageData || await readFileAsDataUrl(source.file);
  stoneCropState.imageData = imageData;
  stoneCropState.image = await loadImageFromDataUrl(imageData);
  fitStoneCropCanvas();
  autoDetectCurrentStoneCrop(false);
}

async function reuploadStoneCropImage(file) {
  if (!file) return;
  const selectedDesignId = document.getElementById("stone-crop-design").value || "";
  const source = {
    name: `Reupload - ${file.name}`,
    file,
    designId: selectedDesignId,
    itemKey: currentStoneCropItemKey(),
    reuploaded: true,
  };
  stoneCropState.files.unshift(source);
  stoneCropState.sourceIndex = 0;
  renderStoneCropSourceOptions();
  await loadStoneCropSource(0);
  const status = document.getElementById("stone-crop-status");
  if (status) {
    status.className = "dialog-note ocr-quality-note";
    status.textContent = "Reuploaded full image is visible for cropping only. Use Auto Detect or Manual Crop, then save the item chart crop.";
  }
}

function loadImageFromDataUrl(imageData) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = imageData;
  });
}

function fitStoneCropCanvas() {
  const image = stoneCropState.image;
  if (!image) return;
  const canvas = document.getElementById("stone-crop-canvas");
  const stage = canvas.closest(".stone-crop-stage");
  const availableWidth = Math.max(320, (stage?.clientWidth || window.innerWidth) - 28);
  const availableHeight = Math.max(260, window.innerHeight - 250);
  const scale = Math.min(1, availableWidth / image.naturalWidth, availableHeight / image.naturalHeight);
  stoneCropState.canvasScale = scale;
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  drawStoneCropCanvas();
}

function autoDetectCurrentStoneCrop(showAlert = false) {
  const image = stoneCropState.image;
  const canvas = document.getElementById("stone-crop-canvas");
  const status = document.getElementById("stone-crop-status");
  if (!image || !canvas) return false;
  const rect = detectStoneChartRectFromImage(image);
  if (!rect) {
    if (status) {
      status.className = "dialog-note ocr-quality-note warn";
      status.textContent = "Auto detect could not find a clear table. Drag around the stone chart manually.";
    }
    if (showAlert) alert("Could not auto detect the stone chart. Drag around the chart manually.");
    return false;
  }
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  stoneCropState.rect = {
    x: (rect.x / imageWidth) * canvas.width,
    y: (rect.y / imageHeight) * canvas.height,
    width: (rect.width / imageWidth) * canvas.width,
    height: (rect.height / imageHeight) * canvas.height,
  };
  drawStoneCropCanvas();
  if (status) {
    status.className = "dialog-note ocr-quality-note good";
    status.textContent = "Stone chart detected automatically. Check the yellow box, then save or read OCR.";
  }
  return true;
}

function startManualStoneCrop() {
  stoneCropState.rect = null;
  stoneCropState.dragging = false;
  stoneCropState.start = null;
  drawStoneCropCanvas();
  const status = document.getElementById("stone-crop-status");
  if (status) {
    status.className = "dialog-note ocr-quality-note";
    status.textContent = "Manual crop mode: drag around the full Gem Reporter stone chart, then save.";
  }
}

function resetStoneCropSelection() {
  stoneCropState.rect = null;
  stoneCropState.dragging = false;
  stoneCropState.start = null;
  fitStoneCropCanvas();
  const status = document.getElementById("stone-crop-status");
  if (status) {
    status.className = "dialog-note ocr-quality-note";
    status.textContent = "Crop reset. Full source image is visible now. Use Auto Detect Chart or Manual Crop.";
  }
}

function drawStoneCropCanvas() {
  const image = stoneCropState.image;
  if (!image) return;
  const canvas = document.getElementById("stone-crop-canvas");
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const rect = normalizedStoneCropRect();
  if (!rect) return;
  context.save();
  context.fillStyle = "rgba(15, 23, 42, 0.42)";
  context.fillRect(0, 0, canvas.width, rect.y);
  context.fillRect(0, rect.y + rect.height, canvas.width, canvas.height - rect.y - rect.height);
  context.fillRect(0, rect.y, rect.x, rect.height);
  context.fillRect(rect.x + rect.width, rect.y, canvas.width - rect.x - rect.width, rect.height);
  context.strokeStyle = "#f4d35e";
  context.lineWidth = 3;
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.restore();
}

function stoneCropPoint(event) {
  const canvas = document.getElementById("stone-crop-canvas");
  const bounds = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * (canvas.width / bounds.width))),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * (canvas.height / bounds.height))),
  };
}

function startStoneCropSelection(event) {
  if (!stoneCropState.image) return;
  event.preventDefault();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  const status = document.getElementById("stone-crop-status");
  if (status) {
    status.className = "dialog-note ocr-quality-note";
    status.textContent = "Manual crop: release after covering only the full stone chart panel.";
  }
  const point = stoneCropPoint(event);
  stoneCropState.dragging = true;
  stoneCropState.start = point;
  stoneCropState.rect = { x: point.x, y: point.y, width: 0, height: 0 };
  drawStoneCropCanvas();
}

function moveStoneCropSelection(event) {
  if (!stoneCropState.dragging || !stoneCropState.start) return;
  event.preventDefault();
  const point = stoneCropPoint(event);
  stoneCropState.rect = {
    x: stoneCropState.start.x,
    y: stoneCropState.start.y,
    width: point.x - stoneCropState.start.x,
    height: point.y - stoneCropState.start.y,
  };
  drawStoneCropCanvas();
}

function finishStoneCropSelection(event) {
  if (!stoneCropState.dragging) return;
  stoneCropState.dragging = false;
  event.currentTarget.releasePointerCapture?.(event.pointerId);
  const rect = normalizedStoneCropRect();
  const status = document.getElementById("stone-crop-status");
  if (!rect || rect.width < 30 || rect.height < 30) {
    status.className = "dialog-note ocr-quality-note warn";
    status.textContent = "Crop area is too small. Drag around the full stone chart table.";
    return;
  }
  status.className = "dialog-note ocr-quality-note good";
  status.textContent = `Crop selected: ${Math.round(rect.width)} x ${Math.round(rect.height)} px on screen.`;
}

function normalizedStoneCropRect() {
  const rect = stoneCropState.rect;
  if (!rect) return null;
  const canvas = document.getElementById("stone-crop-canvas");
  const x = Math.max(0, Math.min(rect.x, rect.x + rect.width));
  const y = Math.max(0, Math.min(rect.y, rect.y + rect.height));
  const width = Math.min(canvas.width - x, Math.abs(rect.width));
  const height = Math.min(canvas.height - y, Math.abs(rect.height));
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function croppedStoneChartDataUrl() {
  const image = stoneCropState.image;
  const rect = currentStoneCropNaturalRect();
  if (!image || !rect || rect.width < 30 || rect.height < 30) return "";
  return cropImageToDataUrl(image, rect, { maxSize: 1800, quality: 0.94 });
}

function currentStoneCropNaturalRect() {
  const image = stoneCropState.image;
  const rect = normalizedStoneCropRect();
  if (!image || !rect || rect.width < 30 || rect.height < 30) return null;
  const displayCanvas = document.getElementById("stone-crop-canvas");
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  return clampImageRect({
    x: (rect.x / displayCanvas.width) * imageWidth,
    y: (rect.y / displayCanvas.height) * imageHeight,
    width: (rect.width / displayCanvas.width) * imageWidth,
    height: (rect.height / displayCanvas.height) * imageHeight,
  }, imageWidth, imageHeight);
}

function cropImageToDataUrl(image, rect, options = {}) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const cleanRect = clampImageRect(rect, imageWidth, imageHeight);
  if (!cleanRect || cleanRect.width < 20 || cleanRect.height < 20) return "";
  const maxSize = options.maxSize || 1200;
  const quality = options.quality || 0.85;
  const scale = Math.min(1, maxSize / Math.max(cleanRect.width, cleanRect.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cleanRect.width * scale));
  canvas.height = Math.max(1, Math.round(cleanRect.height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    cleanRect.x,
    cleanRect.y,
    cleanRect.width,
    cleanRect.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas.toDataURL("image/jpeg", quality);
}

function designImageToFourBySixDataUrl(image, options = {}) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  if (!imageWidth || !imageHeight) return "";
  const canvas = document.createElement("canvas");
  canvas.width = DESIGN_IMAGE_WIDTH;
  canvas.height = DESIGN_IMAGE_HEIGHT;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const scale = Math.min(canvas.width / imageWidth, canvas.height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const drawX = (canvas.width - drawWidth) / 2;
  const drawY = (canvas.height - drawHeight) / 2;
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  return canvas.toDataURL("image/jpeg", options.quality || 0.82);
}

async function normalizeDesignImageDataUrl(imageData) {
  if (!imageData) return "";
  const image = await loadImageFromDataUrl(imageData);
  return designImageToFourBySixDataUrl(image);
}

function detectStoneChartRectFromImage(image) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  if (!imageWidth || !imageHeight) return null;
  const maxAnalysisSize = 900;
  const scale = Math.min(1, maxAnalysisSize / Math.max(imageWidth, imageHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(imageWidth * scale));
  canvas.height = Math.max(1, Math.round(imageHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const analysisRect = detectStoneChartRectInCanvas(imageData, canvas.width, canvas.height);
  if (!analysisRect) return null;
  const naturalRect = {
    x: analysisRect.x / scale,
    y: analysisRect.y / scale,
    width: analysisRect.width / scale,
    height: analysisRect.height / scale,
  };
  return expandImageRect(naturalRect, imageWidth, imageHeight, Math.max(8, Math.min(imageWidth, imageHeight) * 0.012));
}

function detectStoneChartRectInCanvas(data, width, height) {
  const tileSize = 24;
  const cols = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  const active = Array.from({ length: rows }, () => Array(cols).fill(false));
  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < cols; tileX += 1) {
      const rect = {
        x: tileX * tileSize,
        y: tileY * tileSize,
        width: Math.min(tileSize, width - tileX * tileSize),
        height: Math.min(tileSize, height - tileY * tileSize),
      };
      active[tileY][tileX] = stoneChartTileLooksActive(data, width, height, rect);
    }
  }
  const candidateRects = [
    ...stoneChartComponentRects(active, cols, rows, tileSize, width, height),
    ...stoneChartSideCandidateRects(width, height),
  ];
  let best = null;
  for (const rect of candidateRects) {
    const trimmed = trimStoneChartCandidateRect(data, width, height, rect);
    if (!trimmed) continue;
    const panelRect = expandGemReporterPanelRect(data, width, height, trimmed);
    const score = scoreStoneChartCandidate(data, width, height, panelRect);
    if (!score.accepted) continue;
    if (!best || score.value > best.score.value) best = { rect: panelRect, score };
  }
  return best?.rect || null;
}

function stoneChartTileLooksActive(data, width, height, rect) {
  const rowCounts = Array(rect.height).fill(0);
  const colCounts = Array(rect.width).fill(0);
  let samples = 0;
  let dark = 0;
  let edge = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += 2) {
    for (let x = rect.x; x < rect.x + rect.width; x += 2) {
      const lum = canvasPixelLuminance(data, width, x, y);
      const right = x + 2 < width ? canvasPixelLuminance(data, width, x + 2, y) : lum;
      const down = y + 2 < height ? canvasPixelLuminance(data, width, x, y + 2) : lum;
      const isDark = lum < 135;
      const isEdge = Math.max(Math.abs(lum - right), Math.abs(lum - down)) > 38;
      samples += 1;
      if (isDark) dark += 1;
      if (isEdge) edge += 1;
      if (isDark || isEdge) {
        rowCounts[y - rect.y] += 1;
        colCounts[x - rect.x] += 1;
      }
    }
  }
  const density = samples ? (dark + edge * 0.7) / samples : 0;
  const rowLineThreshold = Math.max(4, rect.width / 7);
  const colLineThreshold = Math.max(4, rect.height / 7);
  const rowLines = rowCounts.filter((count) => count >= rowLineThreshold).length;
  const colLines = colCounts.filter((count) => count >= colLineThreshold).length;
  return density > 0.17 || (density > 0.08 && rowLines + colLines >= 3);
}

function stoneChartComponentRects(active, cols, rows, tileSize, width, height) {
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  const rects = [];
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!active[row][col] || seen[row][col]) continue;
      const queue = [[col, row]];
      seen[row][col] = true;
      let minCol = col;
      let maxCol = col;
      let minRow = row;
      let maxRow = row;
      while (queue.length) {
        const [currentCol, currentRow] = queue.shift();
        minCol = Math.min(minCol, currentCol);
        maxCol = Math.max(maxCol, currentCol);
        minRow = Math.min(minRow, currentRow);
        maxRow = Math.max(maxRow, currentRow);
        offsets.forEach(([dx, dy]) => {
          const nextCol = currentCol + dx;
          const nextRow = currentRow + dy;
          if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) return;
          if (!active[nextRow][nextCol] || seen[nextRow][nextCol]) return;
          seen[nextRow][nextCol] = true;
          queue.push([nextCol, nextRow]);
        });
      }
      const rect = clampImageRect({
        x: (minCol - 1) * tileSize,
        y: (minRow - 1) * tileSize,
        width: (maxCol - minCol + 3) * tileSize,
        height: (maxRow - minRow + 3) * tileSize,
      }, width, height);
      if (rect && rect.width * rect.height >= width * height * 0.04) rects.push(rect);
    }
  }
  return rects;
}

function stoneChartSideCandidateRects(width, height) {
  return [
    { x: 0, y: 0, width: width * 0.58, height },
    { x: width * 0.42, y: 0, width: width * 0.58, height },
    { x: 0, y: 0, width, height: height * 0.58 },
    { x: 0, y: height * 0.42, width, height: height * 0.58 },
    { x: 0, y: 0, width: width * 0.58, height: height * 0.58 },
    { x: width * 0.42, y: 0, width: width * 0.58, height: height * 0.58 },
    { x: 0, y: height * 0.42, width: width * 0.58, height: height * 0.58 },
    { x: width * 0.42, y: height * 0.42, width: width * 0.58, height: height * 0.58 },
  ].map((rect) => clampImageRect(rect, width, height)).filter(Boolean);
}

function trimStoneChartCandidateRect(data, width, height, rect) {
  const cleanRect = clampImageRect(rect, width, height);
  if (!cleanRect) return null;
  const rowActive = [];
  const colActive = [];
  for (let y = cleanRect.y; y < cleanRect.y + cleanRect.height; y += 2) {
    let count = 0;
    let samples = 0;
    for (let x = cleanRect.x; x < cleanRect.x + cleanRect.width; x += 2) {
      if (stoneChartInkPixel(data, width, height, x, y)) count += 1;
      samples += 1;
    }
    rowActive.push(samples ? count / samples > 0.035 : false);
  }
  for (let x = cleanRect.x; x < cleanRect.x + cleanRect.width; x += 2) {
    let count = 0;
    let samples = 0;
    for (let y = cleanRect.y; y < cleanRect.y + cleanRect.height; y += 2) {
      if (stoneChartInkPixel(data, width, height, x, y)) count += 1;
      samples += 1;
    }
    colActive.push(samples ? count / samples > 0.03 : false);
  }
  const firstRow = rowActive.findIndex(Boolean);
  const lastRow = rowActive.length - 1 - [...rowActive].reverse().findIndex(Boolean);
  const firstCol = colActive.findIndex(Boolean);
  const lastCol = colActive.length - 1 - [...colActive].reverse().findIndex(Boolean);
  if (firstRow < 0 || firstCol < 0 || lastRow < firstRow || lastCol < firstCol) return null;
  return expandImageRect({
    x: cleanRect.x + firstCol * 2,
    y: cleanRect.y + firstRow * 2,
    width: (lastCol - firstCol + 1) * 2,
    height: (lastRow - firstRow + 1) * 2,
  }, width, height, 10);
}

function expandGemReporterPanelRect(data, width, height, rect) {
  const seed = clampImageRect(rect, width, height);
  if (!seed) return null;
  const xPad = Math.max(18, Math.round(width * 0.035));
  const yPad = Math.max(18, Math.round(height * 0.04));
  let left = Math.max(0, seed.x - xPad);
  let right = Math.min(width - 1, seed.x + seed.width + xPad);
  let top = seed.y;
  let bottom = seed.y + seed.height;
  let gap = 0;
  for (let y = seed.y; y >= 0; y -= 2) {
    const active = stoneChartPanelRowRatio(data, width, height, left, right, y) > 0.055;
    if (active) {
      top = y;
      gap = 0;
    } else {
      gap += 2;
      if (gap > yPad) break;
    }
  }
  gap = 0;
  for (let y = seed.y + seed.height; y < height; y += 2) {
    const active = stoneChartPanelRowRatio(data, width, height, left, right, y) > 0.055;
    if (active) {
      bottom = y;
      gap = 0;
    } else {
      gap += 2;
      if (gap > yPad) break;
    }
  }
  top = Math.max(0, top - Math.round(yPad * 0.35));
  bottom = Math.min(height, bottom + Math.round(yPad * 0.35));
  gap = 0;
  for (let x = seed.x; x >= 0; x -= 2) {
    const active = stoneChartPanelColRatio(data, width, height, top, bottom, x) > 0.05;
    if (active) {
      left = x;
      gap = 0;
    } else {
      gap += 2;
      if (gap > xPad) break;
    }
  }
  gap = 0;
  for (let x = seed.x + seed.width; x < width; x += 2) {
    const active = stoneChartPanelColRatio(data, width, height, top, bottom, x) > 0.05;
    if (active) {
      right = x;
      gap = 0;
    } else {
      gap += 2;
      if (gap > xPad) break;
    }
  }
  return expandImageRect({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }, width, height, Math.max(8, Math.round(Math.min(width, height) * 0.012)));
}

function stoneChartPanelRowRatio(data, width, height, left, right, y) {
  let count = 0;
  let samples = 0;
  for (let x = Math.max(0, left); x <= Math.min(width - 1, right); x += 3) {
    if (stoneChartPanelPixel(data, width, height, x, y)) count += 1;
    samples += 1;
  }
  return samples ? count / samples : 0;
}

function stoneChartPanelColRatio(data, width, height, top, bottom, x) {
  let count = 0;
  let samples = 0;
  for (let y = Math.max(0, top); y <= Math.min(height - 1, bottom); y += 3) {
    if (stoneChartPanelPixel(data, width, height, x, y)) count += 1;
    samples += 1;
  }
  return samples ? count / samples : 0;
}

function stoneChartPanelPixel(data, width, height, x, y) {
  const lum = canvasPixelLuminance(data, width, x, y);
  const right = x + 2 < width ? canvasPixelLuminance(data, width, x + 2, y) : lum;
  const down = y + 2 < height ? canvasPixelLuminance(data, width, x, y + 2) : lum;
  return lum < 220 || Math.max(Math.abs(lum - right), Math.abs(lum - down)) > 34 || isGreenUiPixel(data, width, x, y);
}

function isGreenUiPixel(data, width, x, y) {
  const index = (Math.max(0, Math.floor(y)) * width + Math.max(0, Math.floor(x))) * 4;
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  return green > 95 && green > red * 1.35 && green > blue * 1.2;
}

function scoreStoneChartCandidate(data, width, height, rect) {
  const cleanRect = clampImageRect(rect, width, height);
  if (!cleanRect) return { accepted: false, value: 0 };
  const areaRatio = (cleanRect.width * cleanRect.height) / (width * height);
  if (areaRatio < 0.06 || areaRatio > 0.84 || cleanRect.width < width * 0.18 || cleanRect.height < height * 0.16) {
    return { accepted: false, value: 0 };
  }
  const rowPeaks = [];
  for (let y = cleanRect.y; y < cleanRect.y + cleanRect.height; y += 2) {
    let count = 0;
    let samples = 0;
    for (let x = cleanRect.x; x < cleanRect.x + cleanRect.width; x += 2) {
      if (stoneChartInkPixel(data, width, height, x, y)) count += 1;
      samples += 1;
    }
    rowPeaks.push(samples ? count / samples > 0.16 : false);
  }
  const colPeaks = [];
  for (let x = cleanRect.x; x < cleanRect.x + cleanRect.width; x += 2) {
    let count = 0;
    let samples = 0;
    for (let y = cleanRect.y; y < cleanRect.y + cleanRect.height; y += 2) {
      if (stoneChartInkPixel(data, width, height, x, y)) count += 1;
      samples += 1;
    }
    colPeaks.push(samples ? count / samples > 0.11 : false);
  }
  const horizontalGroups = countPeakGroups(rowPeaks);
  const verticalGroups = countPeakGroups(colPeaks);
  let inkCount = 0;
  let samples = 0;
  for (let y = cleanRect.y; y < cleanRect.y + cleanRect.height; y += 4) {
    for (let x = cleanRect.x; x < cleanRect.x + cleanRect.width; x += 4) {
      if (stoneChartInkPixel(data, width, height, x, y)) inkCount += 1;
      samples += 1;
    }
  }
  const density = samples ? inkCount / samples : 0;
  const tableScore = horizontalGroups * 2.4 + verticalGroups * 2 + density * 22 + areaRatio * 5;
  return {
    accepted: horizontalGroups >= 3 && verticalGroups >= 2 && density > 0.045 && tableScore >= 15,
    value: tableScore,
    horizontalGroups,
    verticalGroups,
    density,
  };
}

function countPeakGroups(peaks) {
  let groups = 0;
  let inGroup = false;
  peaks.forEach((peak) => {
    if (peak && !inGroup) groups += 1;
    inGroup = Boolean(peak);
  });
  return groups;
}

function stoneChartInkPixel(data, width, height, x, y) {
  const lum = canvasPixelLuminance(data, width, x, y);
  const right = x + 2 < width ? canvasPixelLuminance(data, width, x + 2, y) : lum;
  const down = y + 2 < height ? canvasPixelLuminance(data, width, x, y + 2) : lum;
  return lum < 165 || Math.max(Math.abs(lum - right), Math.abs(lum - down)) > 42;
}

function canvasPixelLuminance(data, width, x, y) {
  const index = (Math.max(0, Math.floor(y)) * width + Math.max(0, Math.floor(x))) * 4;
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

function designRectAfterRemovingChart(image, chartRect) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const chart = clampImageRect(chartRect, imageWidth, imageHeight);
  if (!chart) return null;
  const gap = Math.max(8, Math.round(Math.min(imageWidth, imageHeight) * 0.018));
  const regions = [
    { x: 0, y: 0, width: chart.x - gap, height: imageHeight },
    { x: chart.x + chart.width + gap, y: 0, width: imageWidth - chart.x - chart.width - gap, height: imageHeight },
    { x: 0, y: 0, width: imageWidth, height: chart.y - gap },
    { x: 0, y: chart.y + chart.height + gap, width: imageWidth, height: imageHeight - chart.y - chart.height - gap },
  ].map((rect) => clampImageRect(rect, imageWidth, imageHeight)).filter(Boolean);
  const candidates = regions
    .filter((rect) =>
      rect.width >= imageWidth * 0.18 &&
      rect.height >= imageHeight * 0.18 &&
      rect.width * rect.height >= imageWidth * imageHeight * 0.12
    )
    .sort((a, b) => (b.width * b.height) - (a.width * a.height));
  return candidates[0] || null;
}

function clampImageRect(rect, width, height) {
  if (!rect) return null;
  const x = Math.max(0, Math.min(width, Math.round(rect.x || 0)));
  const y = Math.max(0, Math.min(height, Math.round(rect.y || 0)));
  const rectWidth = Math.max(0, Math.min(width - x, Math.round(rect.width || 0)));
  const rectHeight = Math.max(0, Math.min(height - y, Math.round(rect.height || 0)));
  if (rectWidth <= 0 || rectHeight <= 0) return null;
  return { x, y, width: rectWidth, height: rectHeight };
}

function expandImageRect(rect, width, height, padding = 0) {
  return clampImageRect({
    x: (rect?.x || 0) - padding,
    y: (rect?.y || 0) - padding,
    width: (rect?.width || 0) + padding * 2,
    height: (rect?.height || 0) + padding * 2,
  }, width, height);
}

async function saveStoneCropToDesign(readAfterSave = false) {
  const design = findById("designs", document.getElementById("stone-crop-design").value);
  const status = document.getElementById("stone-crop-status");
  const itemKey = currentStoneCropItemKey();
  if (!design) {
    alert("Select design to save this crop.");
    return;
  }
  const imageData = croppedStoneChartDataUrl();
  if (!imageData) {
    alert("Select crop area first.");
    return;
  }
  const action = readAfterSave ? "Save this crop as stone chart and read OCR" : "Save this crop as stone chart";
  if (!confirmStoneChartCrop(`${action} for ${designText(design)} / ${stoneItemInputValue(itemKey)}?`)) {
    return;
  }
  const source = stoneCropState.files[stoneCropState.sourceIndex] || {};
  if (source.legacySourceImage) {
    await deleteStoneChartSourceImage(design.id).catch(() => {});
    design.hasStoneChartSource = false;
    design.stoneChartSourceName = "";
  }
  await saveStoneChartImage(design.id, imageData, itemKey);
  markDesignStoneChart(design, itemKey, true);
  saveState();
  renderDesigns();
  await loadStoneEntry(design.id, itemKey);
  status.className = "dialog-note ocr-quality-note good";
  status.textContent = `Cropped stone chart saved to ${designText(design)} / ${stoneItemInputValue(itemKey)}. Full duplicate chart source was not stored.`;
  if (readAfterSave) {
    await readStoneChartImageDataForDesign(design, imageData, itemKey);
    document.getElementById("stone-crop-status").textContent = `Crop saved and OCR read for ${designText(design)} / ${stoneItemInputValue(itemKey)}. Full duplicate chart source was not stored.`;
  }
}

async function loadStoneEntry(designId, itemKey = "") {
  const form = document.getElementById("stone-entry-form");
  const summary = document.getElementById("stone-entry-summary");
  const preview = document.getElementById("stone-entry-preview");
  const design = findById("designs", designId);
  if (!design) {
    form.stoneChart.value = "";
    if (form.stoneItemKey) form.stoneItemKey.value = "";
    updateStoneItemDatalist(null);
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
  updateStoneItemDatalist(design);
  const optionKeys = stoneItemOptionKeysForDesign(design);
  const requestedItemKey = normalizeStoneItemKey(itemKey || form.stoneItemKey?.value || defaultStoneItemKeyForDesign(design));
  const selectedItemKey = optionKeys.includes(requestedItemKey) ? requestedItemKey : defaultStoneItemKeyForDesign(design);
  setStoneItemSelectOptions(form.stoneItemKey, design, selectedItemKey);
  renderDesignStoneEntryOptions();
  resetDesignStoneEntryFields();
  renderDesignStoneItems(designStoneItemsForKey(design, selectedItemKey), selectedItemKey);
  const chartKeys = designStoneChartItemKeys(design);
  const hasItemChart = designHasStoneChartForItem(design, selectedItemKey);
  const itemImageData = hasItemChart ? await getStoneChartImage(design.id, selectedItemKey).catch(() => "") : "";
  const designImageData = await getDesignImage(design.id).catch(() => design.imageData || "");
  const legacySourceImageData = designImageData ? "" : await getStoneChartSourceImage(design.id).catch(() => "");
  const imageData = itemImageData || designImageData || legacySourceImageData;
  summary.textContent = `${design.number || "Design"} / ${design.category || "Uncategorised"} / ${stoneItemInputValue(selectedItemKey)} / ${hasItemChart ? "Item crop saved" : "No item crop"}${designImageData ? ` / Design image ${DESIGN_IMAGE_ASPECT_TEXT}` : ""}`;
  preview.classList.toggle("empty", !imageData);
  preview.innerHTML = imageData
    ? `<img src="${imageData}" alt="Stone chart for ${escapeHtml(designText(design))} ${escapeHtml(stoneItemInputValue(selectedItemKey))}"><small>${itemImageData ? `${escapeHtml(stoneItemInputValue(selectedItemKey))} item crop shown.` : designImageData ? `Design image shown. Use Crop Chart From Design to save ${escapeHtml(stoneItemInputValue(selectedItemKey))} chart.` : "Old full chart copy shown. Crop and save once to clean it."}</small>`
    : `No stone chart crop saved for this design.${chartKeys.length ? ` Item crops available: ${chartKeys.map(stoneItemInputValue).join(", ")}` : ""}`;
}

async function refreshStoneEntryItemView() {
  const form = document.getElementById("stone-entry-form");
  const design = findById("designs", form?.stoneDesignId?.value);
  if (!design) return;
  await loadStoneEntry(design.id, currentStoneEntryItemKey());
}

function handleDesignStoneEntryChange(changedField) {
  const form = document.getElementById("stone-entry-form");
  if (changedField === "entryStoneType") {
    form.entryStoneShape.value = "";
    form.entryStoneSize.value = "";
  }
  if (changedField === "entryStoneShape") form.entryStoneSize.value = "";
  renderDesignStoneEntryOptions();
  updateDesignStoneEntryCodePreview();
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
  updateDesignStoneEntryCodePreview();
}

function designStoneCodeForSelection(stoneType, shape, size) {
  const libraryStone = findStoneByLibraryFields(stoneType, shape, size);
  return libraryStone?.code || stoneLookupCode({ stoneType, shape, size });
}

function updateDesignStoneEntryCodePreview() {
  const preview = document.getElementById("entry-stone-code-preview");
  if (!preview) return;
  const form = document.getElementById("stone-entry-form");
  const code = form.entryStoneType.value && form.entryStoneShape.value && form.entryStoneSize.value
    ? designStoneCodeForSelection(form.entryStoneType.value, form.entryStoneShape.value, form.entryStoneSize.value)
    : "-";
  preview.textContent = code || "-";
}

function updateDesignStoneEditRowPreview(row) {
  if (!row) return;
  const stoneType = row.querySelector('[data-stone-edit="stoneType"]')?.value || "";
  const shape = row.querySelector('[data-stone-edit="shape"]')?.value || "";
  const size = row.querySelector('[data-stone-edit="size"]')?.value || "";
  const pcs = Number(row.querySelector('[data-stone-edit="pcs"]')?.value || 0);
  const libraryStone = findStoneByLibraryFields(stoneType, shape, size);
  const code = stoneType && shape && size ? (libraryStone?.code || stoneLookupCode({ stoneType, shape, size })) : "-";
  const weightPerPc = libraryStone?.weightPerPc || "";
  const codeCell = row.querySelector('[data-stone-code-preview]');
  const weightCell = row.querySelector('[data-stone-weight-preview]');
  const totalCell = row.querySelector('[data-stone-total-preview]');
  if (codeCell) codeCell.textContent = code || "-";
  if (weightCell) weightCell.textContent = formatStoneWeight(weightPerPc) || "-";
  if (totalCell) totalCell.textContent = weightPerPc ? totalStoneWeight(weightPerPc, pcs) || "-" : "-";
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
    itemKey: currentStoneEntryItemKey(),
    stoneType: form.entryStoneType.value,
    shape: form.entryStoneShape.value,
    size: form.entryStoneSize.value,
    code: designStoneCodeForSelection(form.entryStoneType.value, form.entryStoneShape.value, form.entryStoneSize.value),
    pcs,
    weightPerPc: formatStoneWeight(weightPerPc),
    totalWeight: totalStoneWeight(weightPerPc, pcs),
  };
  design.stoneItems = [...(design.stoneItems || []), item];
  design.stoneDetails = designStoneDetailsText(design.stoneItems);
  renderDesignStoneItems(designStoneItemsForKey(design, item.itemKey), item.itemKey);
  resetDesignStoneEntryFields();
  saveState();
  renderDesigns();
}

async function readStoneChartImage() {
  const form = document.getElementById("stone-entry-form");
  const design = findById("designs", form.stoneDesignId.value);
  const summary = document.getElementById("stone-entry-summary");
  const itemKey = currentStoneEntryItemKey();
  if (!design) {
    alert("Select design first.");
    return;
  }
  if (!window.Tesseract) {
    alert("OCR library is not loaded. Connect internet and refresh once, then try again.");
    return;
  }
  let imageData = "";
  const files = [...form.stoneChart.files];
  const file = matchingStoneChartFileForDesign(files, design) || files[0];
  if (file) {
    await showStoneChartQuality(file);
    const split = await autoSplitDesignAndStoneChart(file).catch(() => null);
    imageData = split?.stoneChartImageData || await compressStoneChartImage(file);
    await saveStoneChartImage(design.id, imageData, itemKey);
    markDesignStoneChart(design, itemKey, true);
    saveState();
    form.stoneChart.value = "";
    selectedStoneChartFiles = [];
  } else {
    imageData = await getStoneChartImage(design.id, itemKey).catch(() => "");
  }
  if (!imageData) {
    alert(`Upload or save a stone chart image first for ${stoneItemInputValue(itemKey)}.`);
    return;
  }
  await readStoneChartImageDataForDesign(design, imageData, itemKey);
}

async function readStoneChartImageDataForDesign(design, imageData, itemKey = DEFAULT_STONE_ITEM_KEY) {
  const summary = document.getElementById("stone-entry-summary");
  const targetItemKey = normalizeStoneItemKey(itemKey);
  if (!window.Tesseract) {
    alert("OCR library is not loaded. Connect internet and refresh once, then try again.");
    return;
  }
  summary.textContent = `Reading ${stoneItemInputValue(targetItemKey)} stone chart image...`;
  try {
    const result = await Tesseract.recognize(imageData, "eng", {
      logger: (progress) => {
        if (progress.status === "recognizing text") {
          summary.textContent = `Reading ${stoneItemInputValue(targetItemKey)} stone chart image... ${Math.round((progress.progress || 0) * 100)}%`;
        }
      },
    });
    const rows = parseStoneChartText(result.data.text).map((row) => ({ ...row, itemKey: targetItemKey }));
    if (!rows.length) {
      summary.textContent = "Could not read stone rows. Crop the chart table and try again.";
      alert("No stone rows detected. Use a clear crop of the stone table.");
      return;
    }
    const existingRows = design.stoneItems || [];
    const existingItemRows = existingRows.filter((item) => normalizeStoneItemKey(item.itemKey) === targetItemKey);
    const otherRows = existingRows.filter((item) => normalizeStoneItemKey(item.itemKey) !== targetItemKey);
    const replaceRows = existingItemRows.length
      ? confirm(`Existing ${stoneItemInputValue(targetItemKey)} stone rows found. OK = replace this item rows. Cancel = add OCR rows below existing rows.`)
      : true;
    design.stoneItems = replaceRows ? [...otherRows, ...rows] : [...existingRows, ...rows];
    design.stoneDetails = designStoneDetailsText(design.stoneItems);
    saveState();
    renderDesignStoneItems(designStoneItemsForKey(design, targetItemKey), targetItemKey);
    renderDesigns();
    await loadStoneEntry(design.id, targetItemKey);
    summary.textContent = `${rows.length} ${stoneItemInputValue(targetItemKey)} stone row(s) read and ${replaceRows ? "saved" : "added"} from image.`;
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
  renderDesignStoneItems(designStoneItemsForKey(design, currentStoneEntryItemKey()), currentStoneEntryItemKey());
  saveState();
  renderDesigns();
}

function requireOwnerPermission(action) {
  if (isOwner()) return true;
  const password = prompt(`Enter Owner password to ${action}:`);
  if (password === userPassword("owner")) return true;
  alert("Wrong Owner password.");
  return false;
}

function stoneEditOptions(field, selected) {
  const values = stoneOptionValues(field, state.stones);
  const optionValues = selected && !values.includes(selected) ? [...values, selected] : values;
  return `<option value="">Select</option>${optionValues.map((value) =>
    `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`
  ).join("")}`;
}

function stoneItemEditOptions(selected = "") {
  const form = document.getElementById("stone-entry-form");
  const design = findById("designs", form?.stoneDesignId?.value || "");
  return stoneItemSelectOptionsForDesign(design, selected);
}

function saveDesignStoneItemEdit(stoneItemId) {
  const form = document.getElementById("stone-entry-form");
  const design = findById("designs", form.stoneDesignId.value);
  if (!design) return;
  const item = (design.stoneItems || []).find((stoneItem) => stoneItem.id === stoneItemId);
  const row = document.querySelector(`[data-design-stone-row="${stoneItemId}"]`);
  if (!item || !row) return;
  const stoneType = row.querySelector('[data-stone-edit="stoneType"]').value;
  const shape = row.querySelector('[data-stone-edit="shape"]').value;
  const size = row.querySelector('[data-stone-edit="size"]').value;
  const itemKey = normalizeStoneItemKey(row.querySelector('[data-stone-edit="itemKey"]')?.value || currentStoneEntryItemKey());
  const pcs = Number(row.querySelector('[data-stone-edit="pcs"]').value || 0);
  if (!stoneType || !shape || !size || pcs <= 0) {
    alert("Select Type, Shape, Size and enter valid No. Pcs.");
    return;
  }
  const libraryStone = findStoneByLibraryFields(stoneType, shape, size);
  const weightPerPc = libraryStone?.weightPerPc || item.weightPerPc || "";
  Object.assign(item, {
    stoneType,
    shape,
    size,
    itemKey,
    pcs,
    code: designStoneCodeForSelection(stoneType, shape, size),
    weightPerPc: formatStoneWeight(weightPerPc),
    totalWeight: weightPerPc ? totalStoneWeight(weightPerPc, pcs) : item.totalWeight || "",
  });
  design.stoneDetails = designStoneDetailsText(design.stoneItems);
  renderDesignStoneItems(designStoneItemsForKey(design, currentStoneEntryItemKey()), currentStoneEntryItemKey());
  saveState();
  renderDesigns();
  document.getElementById("stone-entry-summary").textContent = "Stone row corrected and saved.";
}

function renderDesignStoneItems(items = [], itemKey = DEFAULT_STONE_ITEM_KEY) {
  const container = document.getElementById("design-stone-details");
  container.classList.toggle("empty", !items.length);
  const activeItem = stoneItemInputValue(itemKey);
  container.innerHTML = items.length
    ? `<div class="stone-total-summary">${activeItem}: ${designStoneSummaryText(items)}</div><table><thead><tr><th>Item</th><th>Code</th><th>Type</th><th>Shape</th><th>Size</th><th>No. Pcs</th><th>Wt/Pc (g)</th><th>Total Wt (g)</th><th></th></tr></thead><tbody>${items.map((item) => `
      <tr data-design-stone-row="${item.id}">
        <td><select data-stone-edit="itemKey">${stoneItemEditOptions(item.itemKey)}</select></td>
        <td data-stone-code-preview>${escapeHtml(item.code || stoneLookupCode(item) || "-")}</td>
        <td><select data-stone-edit="stoneType">${stoneEditOptions("stoneType", item.stoneType || "")}</select></td>
        <td><select data-stone-edit="shape">${stoneEditOptions("shape", item.shape || "")}</select></td>
        <td><select data-stone-edit="size">${stoneEditOptions("size", item.size || "")}</select></td>
        <td><input data-stone-edit="pcs" type="number" min="1" step="1" value="${escapeHtml(item.pcs || "")}"></td>
        <td data-stone-weight-preview>${escapeHtml(formatStoneWeight(item.weightPerPc) || "-")}</td>
        <td data-stone-total-preview>${escapeHtml(item.totalWeight || "-")}</td>
        <td><div class="row-actions"><button class="ghost-button" type="button" onclick="saveDesignStoneItemEdit('${item.id}')">Save</button><button class="delete-btn" type="button" onclick="removeDesignStoneItem('${item.id}')">Remove</button></div></td>
      </tr>
    `).join("")}</tbody></table>`
    : `No stone added for ${escapeHtml(activeItem)}.`;
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
  updateDesignStoneEntryCodePreview();
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
  const itemName = stoneItemInputValue(item.itemKey).padEnd(8);
  const pcs = `${item.pcs || 0} PCS`;
  const weightPerPc = formatStoneWeight(item.weightPerPc) || "-";
  const totalWeight = item.totalWeight || "-";
  return `${itemName} ${stoneName.padEnd(18)} ${pcs.padEnd(8)} ${weightPerPc.padStart(9)} ${String(totalWeight).padStart(9)}`;
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
  document.getElementById("metric-factory-in").textContent = gram(factoryInWeight());
  document.getElementById("metric-wip").textContent = gram(workInProgress());
  document.getElementById("metric-safe-items").textContent = gram(safeItemStockWeight());
  document.getElementById("metric-production-stock").textContent = gram(finishedStock());
  document.getElementById("metric-office-stock").textContent = gram(officeStockWeight());
  document.getElementById("metric-orders").textContent = state.orders.filter((order) => order.status !== "Completed").length;
  document.getElementById("metric-customers").textContent = state.customers.length;

  const pendingOrders = groupedJobOrders((order) => !isCompletedOrder(order), "active");
  document.getElementById("pending-orders-list").innerHTML = pendingOrders.length
    ? pendingOrders.map(dashboardPendingOrderItem).join("")
    : '<div class="empty">No pending job orders.</div>';

  const transfers = recentDashboardTransfers();
  document.getElementById("activity-list").innerHTML = transfers.length
    ? transfers.map(dashboardTransferItem).join("")
    : '<div class="empty">No transfer history recorded.</div>';

  renderDepartmentMetal();
}

function dashboardPendingOrderItem(job) {
  const jobNumber = job.jobNumber || "-";
  const detail = [
    job.customer || "-",
    `${job.orders.length} item${job.orders.length === 1 ? "" : "s"}`,
    job.categories || "-",
    job.currentStage || "-",
    job.dueDate ? `Due ${job.dueDate}` : "",
  ].filter(Boolean).join(" / ");
  return `
    <div class="stack-item dashboard-job-item">
      <button type="button" class="dashboard-job-button" onclick="openJobOrder(decodeURIComponent('${encodeURIComponent(jobNumber)}'), 'active')">${escapeHtml(jobNumber)}</button>
      <span>${escapeHtml(detail)}</span>
    </div>
  `;
}

function recentDashboardTransfers(limit = 8) {
  return state.lots
    .flatMap((lot) => (lot.transfers || []).map((transfer) => ({ lot, transfer })))
    .sort((a, b) => String(b.transfer.date || "").localeCompare(String(a.transfer.date || "")))
    .slice(0, limit);
}

function dashboardTransferItem({ lot, transfer }) {
  const from = transfer.fromDepartment || transfer.fromKarigarName || "-";
  const to = transfer.toDepartment || transfer.toKarigarName || "-";
  const title = `${lot.orderNumber || lot.number || "-"} / ${from} -> ${to}`;
  const detail = `${transfer.date || "-"} / Issue ${gram(transfer.transferWeight)} / Net ${gram(transfer.receivedWeight)} / Diff ${gram(transfer.departmentBalance)}`;
  return `
    <div class="stack-item dashboard-transfer-item">
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(detail)}</strong>
    </div>
  `;
}

function renderDepartmentMetal() {
  const departments = departmentMetalInHand();
  const rows = Object.entries(departments)
    .sort((a, b) => (b[1].gross + b[1].loss) - (a[1].gross + a[1].loss))
    .map(([department, totals]) => `
      <article class="department-card">
        <span>${escapeHtml(department)}</span>
        <strong>${gram(totals.gold)}</strong>
        <div class="department-breakup">
          <small><b>GW</b>${gram(totals.gross)}</small>
          <small><b>Wax Stone</b>${gram(totals.waxStone)}</small>
          <small><b>Hand Stone</b>${gram(totals.handStone)}</small>
          <small><b>Total Stone</b>${gram(totals.waxStone + totals.handStone)}</small>
          ${Number(totals.loss || 0) ? `<small class="loss-row"><b>Loss</b>${gram(totals.loss)}</small>` : ""}
          ${Number(totals.lossFineGold || 0) ? `<small class="loss-row"><b>Loss Fine</b>${gram(totals.lossFineGold)}</small>` : ""}
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
    purity.gross !== 0 || purity.gold !== 0 || purity.waxStone !== 0 || purity.handStone !== 0 || purity.loss !== 0
  );
  if (!purities.length) return "";
  return `
    <div class="department-purity-split">
      <div class="department-purity-head"><span>Purity</span><span>Gold</span><span>Stone</span><span>Loss</span><span>Fine</span></div>
      ${purities.map(([purity, item]) => `
        <div class="department-purity-row">
          <span>${escapeHtml(purity)}</span>
          <span>${gram(item.gold)}</span>
          <span>${gram(item.waxStone + item.handStone)}</span>
          <span>${gram(item.loss)}</span>
          <span>${gram(item.fineGold + item.lossFineGold)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderDepartmentSplit(totals) {
  const sections = Object.entries(totals.sections || {}).filter(([, section]) =>
    section.gross !== 0 || section.gold !== 0 || section.waxStone !== 0 || section.handStone !== 0 || section.loss !== 0
  );
  if (sections.length <= 1) return "";
  return `
    <div class="department-split">
      ${sections.map(([label, section]) => `
        <small><b>${escapeHtml(label)}</b><span>Gold ${gram(section.gold)} / GW ${gram(section.gross)}${Number(section.loss || 0) ? ` / Loss ${gram(section.loss)}` : ""}</span></small>
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
  addMeltingCastingDashboardWeights(departments);
  return Object.fromEntries(Object.entries(departments).filter(([, totals]) =>
    totals.gross !== 0 || totals.gold !== 0 || totals.waxStone !== 0 || totals.handStone !== 0 || totals.loss !== 0
  ));
}

function addMeltingCastingDashboardWeights(departments) {
  (state.melting || []).forEach((melting) => {
    const department = meltingDashboardDepartmentName(melting);
    const purity = melting.targetPurity || "";
    if ((melting.status || "Issued") !== "Received") {
      const inHand = Number(melting.finalWeight || melting.sourceWeight || 0);
      addDepartmentWeight(departments, department, {
        gross: inHand,
        gold: inHand,
        purity,
      });
    }
    const loss = Number(melting.meltingLoss || 0);
    if (loss > 0) {
      addDepartmentWeight(departments, department, {
        loss,
        lossFineGold: fineGoldWeight(loss, purity),
        purity,
      });
    }
  });
}

function meltingDashboardDepartmentName(melting = {}) {
  return meltingBatchType(melting) === "MELTING" ? "Melting Department" : "Casting Department";
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
  const current = departments[key] || { gross: 0, gold: 0, waxStone: 0, handStone: 0, fineGold: 0, loss: 0, lossFineGold: 0, sections: {}, purities: {} };
  const currentSection = current.sections[splitKey] || { gross: 0, gold: 0, waxStone: 0, handStone: 0, loss: 0, lossFineGold: 0 };
  const purityKey = displayPurity(totals.purity);
  const currentPurity = current.purities[purityKey] || { gross: 0, gold: 0, waxStone: 0, handStone: 0, fineGold: 0, loss: 0, lossFineGold: 0 };
  const added = {
    gross: Number(totals.gross || 0),
    gold: Number(totals.gold || 0),
    waxStone: Number(totals.waxStone || 0),
    handStone: Number(totals.handStone || 0),
    fineGold: Number(totals.fineGold ?? fineGoldWeight(totals.gold || 0, totals.purity || 0)),
    loss: Number(totals.loss || 0),
    lossFineGold: Number(totals.lossFineGold ?? fineGoldWeight(totals.loss || 0, totals.purity || 0)),
  };
  departments[key] = {
    gross: Number(weight3(current.gross + added.gross)),
    gold: Number(weight3(current.gold + added.gold)),
    waxStone: Number(weight3(current.waxStone + added.waxStone)),
    handStone: Number(weight3(current.handStone + added.handStone)),
    fineGold: Number(weight3(current.fineGold + added.fineGold)),
    loss: Number(weight3(current.loss + added.loss)),
    lossFineGold: Number(weight3(current.lossFineGold + added.lossFineGold)),
    sections: {
      ...current.sections,
      [splitKey]: {
        gross: Number(weight3(currentSection.gross + added.gross)),
        gold: Number(weight3(currentSection.gold + added.gold)),
        waxStone: Number(weight3(currentSection.waxStone + added.waxStone)),
        handStone: Number(weight3(currentSection.handStone + added.handStone)),
        loss: Number(weight3(currentSection.loss + added.loss)),
        lossFineGold: Number(weight3(currentSection.lossFineGold + added.lossFineGold)),
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
        loss: Number(weight3(currentPurity.loss + added.loss)),
        lossFineGold: Number(weight3(currentPurity.lossFineGold + added.lossFineGold)),
      },
    },
  };
}

function renderOrders() {
  const activeRows = groupedJobOrders((order) => !isCompletedOrder(order), "active")
    .map(orderTableRow)
    .join("");
  const completedRows = groupedJobOrders(isCompletedOrder, "completed")
    .map(orderTableRow)
    .join("");
  document.getElementById("orders-table").innerHTML = activeRows || tableEmpty(3, "No active job orders recorded.");
  document.getElementById("completed-orders-table").innerHTML = completedRows || tableEmpty(3, "No completed job orders recorded.");
  renderRepairJobOrders();
}

function renderRepairJobOrders() {
  const board = document.getElementById("repair-orders-board");
  if (!board) return;
  const query = (document.getElementById("repair-order-search")?.value || "").toLowerCase();
  const entries = repairJobItems()
    .filter(({ lot, bill, item, order }) => {
      const text = [
        lot.number,
        lot.orderNumber,
        bill.billNo,
        item.productionNo,
        order.productionNo,
        order.customer,
        order.designNo,
        designLabel(order.designId),
        item.repairStatus,
        item.qcStatus,
        officeItemLocation(item),
      ].join(" ").toLowerCase();
      return text.includes(query);
    });
  board.innerHTML = entries.length
    ? `<div class="repair-item-grid">${entries.map(renderRepairJobOrderCard).join("")}</div>`
    : '<div class="empty">No Repair / QC Failed job item.</div>';
}

function renderRepairJobOrderCard({ lot, bill, item, order }) {
  const productionNo = item.productionNo || order.productionNo || "-";
  return `
    <article class="office-library-item repair repair-detail-card repair-job-card">
      <div class="office-library-row">
        <strong>${escapeHtml(productionNo)}</strong>
        <span class="status ${officeItemStatusClass(item)}">${escapeHtml(repairDayText(item))}</span>
      </div>
      <span>${escapeHtml(order.customer || "-")} / ${escapeHtml(order.designNo || designLabel(order.designId) || "-")}</span>
      <div class="sales-detail-grid repair-detail-grid">
        <span><b>Job Card</b>${escapeHtml(lot.orderNumber || lot.number || "-")}</span>
        <span><b>Bill No</b>${escapeHtml(bill.billNo || "-")}</span>
        <span><b>QC Status</b>${escapeHtml(item.qcStatus || "-")}</span>
        <span><b>Repair Status</b>${escapeHtml(item.repairStatus || "QC Failed")}</span>
        <span><b>Repair Start</b>${escapeHtml(item.repairStartDate || item.qcDate || "-")}</span>
        <span><b>Repair Issue</b>${escapeHtml(item.repairIssueDate || "-")}</span>
        <span><b>Repair Return</b>${escapeHtml(item.repairReturnDate || "-")}</span>
        <span><b>Current Location</b>${escapeHtml(officeItemLocation(item))}</span>
        <span><b>Final GW</b>${gram(item.finalGw)}</span>
        <span><b>Net Wt</b>${gram(item.netWeight)}</span>
        <span><b>Total Non-Gold</b>${billNonGoldTotalText(item, order)}</span>
        <span><b>Non-Gold Details</b>${escapeHtml(billNonGoldSummaryText(item, order))}</span>
        <span><b>Extra Loss</b>${gram(item.repairAdditionalLoss)}</span>
      </div>
      <div class="row-actions">
        <button type="button" onclick="openRepairJobItem('${escapeHtml(order.id)}')">Open Job Item</button>
      </div>
    </article>
  `;
}

function orderTableRow(job) {
  const urgency = job.urgent ? '<span class="job-badge urgent">Urgent</span>' : "";
  const delivery = isCompletedJob(job) ? "" : deliveryBadgeHtml(job.dueDate);
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
      <td><div class="row-actions"><button onclick="openJobOrder('${job.jobNumber}', '${job.bucket || "all"}')">Open</button><button class="ghost-button" onclick="editJobOrder('${job.jobNumber}', '${job.bucket || "all"}')">Edit</button><button class="delete-btn" onclick="removeJobOrder('${job.jobNumber}')">Delete</button></div></td>
    </tr>
  `;
}

function jobDetailsText(job) {
  const dueText = isCompletedJob(job) ? "" : ` / Due ${job.dueDate}`;
  return `${job.jobNumber} / ${job.orders.length} item${job.orders.length > 1 ? "s" : ""} / ${job.categories}${dueText} / ${job.status}`;
}

function groupedJobOrders(orderFilter = null, bucket = "all") {
  const sourceOrders = orderFilter ? state.orders.filter(orderFilter) : state.orders;
  const groups = sourceOrders.reduce((acc, order) => {
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
      bucket,
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

function isCompletedOrder(order = {}) {
  return String(order.status || "").toLowerCase() === "completed";
}

function isCompletedJob(job = {}) {
  return String(job.status || "").toLowerCase() === "completed"
    || (job.orders || []).every(isCompletedOrder);
}

function orderDeliveryText(order = {}) {
  return isCompletedOrder(order) ? "" : daysRemainingText(order.dueDate);
}

function jobOrderDeliverySummary(orders = []) {
  return orders.length && orders.every(isCompletedOrder) ? "" : daysRemainingText(orders[0]?.dueDate);
}

function jobCurrentStage(orders = []) {
  const stages = [...new Set(orders.map(orderCurrentStage).filter(Boolean))];
  if (!stages.length) return "Pending";
  return stages.length === 1 ? stages[0] : `Mixed: ${stages.join(", ")}`;
}

function orderCurrentStage(order = {}) {
  const officeEntry = officeItems().find(({ item }) => item.orderId === order.id || item.productionNo === order.productionNo);
  if (officeEntry) return officeItemLocation(officeEntry.item);
  const repairEntry = findBillItemForOrder(order);
  if (repairEntry?.item && isRepairItem(repairEntry.item)) {
    const reworkLot = repairEntry.item.reworkLotId ? findById("lots", repairEntry.item.reworkLotId) : null;
    if (reworkLot && reworkLot.status !== "Completed") return reworkLot.currentDepartment || "Repair Production";
    return officeItemLocation(repairEntry.item);
  }
  const lot = state.lots.find((item) => getLotOrderIds(item).includes(order.id));
  if (lot?.bill) return lot.billingStage || "Bill / QC";
  if (lot) return lot.currentDepartment || lot.karigarName || "Production";
  return order.status || "Pending";
}

function openJobOrder(jobNumber, bucket = "all") {
  const first = findJobOrderForBucket(jobNumber, bucket);
  if (first) openOrderDetail(first.id, false, bucket);
}

function openRepairJobItem(orderId) {
  const order = findById("orders", orderId);
  if (!order) {
    alert("Repair job item not found.");
    return;
  }
  openOrderDetail(order.id, false, "all");
  setTimeout(() => openJobItemDetail(order.id), 0);
}

function editJobOrder(jobNumber, bucket = "all") {
  const first = findJobOrderForBucket(jobNumber, bucket);
  if (first) openOrderDetail(first.id, true, bucket);
}

function findJobOrderForBucket(jobNumber, bucket = "all") {
  return state.orders.find((order) =>
    (order.jobNumber || order.productionNo || order.number) === jobNumber
    && (
      bucket === "all"
      || (bucket === "completed" && isCompletedOrder(order))
      || (bucket === "active" && !isCompletedOrder(order))
    )
  );
}

function removeJobOrder(jobNumber) {
  if (!confirm(`Delete full job card ${jobNumber}?`)) return;
  state.orders = state.orders.filter((order) => (order.jobNumber || order.productionNo || order.number) !== jobNumber);
  saveState();
  render();
}

function handleDesignSelectionChange(event) {
  const input = event.target.closest?.(".design-select-input");
  if (!input) return;
  if (input.checked) selectedDesignIds.add(input.dataset.designSelect);
  else selectedDesignIds.delete(input.dataset.designSelect);
  updateDesignSelectionSummary();
}

function updateDesignSelectionSummary() {
  const validIds = new Set(state.designs.map((design) => design.id));
  selectedDesignIds = new Set([...selectedDesignIds].filter((id) => validIds.has(id)));
  document.querySelectorAll(".design-select-input").forEach((input) => {
    input.checked = selectedDesignIds.has(input.dataset.designSelect);
  });
  const text = selectedDesignIds.size
    ? `${selectedDesignIds.size} design${selectedDesignIds.size === 1 ? "" : "s"} selected`
    : "No design selected";
  document.querySelectorAll("[data-design-selection-count]").forEach((item) => {
    item.textContent = text;
  });
}

function selectAllDesigns() {
  selectedDesignIds = new Set(state.designs.map((design) => design.id));
  updateDesignSelectionSummary();
}

function selectVisibleDesigns() {
  const visibleInputs = document.querySelectorAll("#design-page-master .design-select-input, #design-category-dialog[open] .design-select-input");
  if (!visibleInputs.length) {
    alert("Open a category or search designs first, then select visible designs.");
    return;
  }
  visibleInputs.forEach((input) => selectedDesignIds.add(input.dataset.designSelect));
  updateDesignSelectionSummary();
}

function clearDesignSelection() {
  selectedDesignIds.clear();
  updateDesignSelectionSummary();
}

function selectCurrentDesignCategory() {
  const category = document.getElementById("design-category-title")?.textContent || "";
  const group = designCategoryGroups().find((item) => item.category === category);
  if (!group) {
    alert("No designs found in this category.");
    return;
  }
  group.designs.forEach((design) => selectedDesignIds.add(design.id));
  updateDesignSelectionSummary();
}

async function autoCropExistingDesigns() {
  const button = document.getElementById("design-auto-crop-existing");
  const status = document.getElementById("design-bulk-crop-status");
  const selected = selectedDesignIds.size
    ? state.designs.filter((design) => selectedDesignIds.has(design.id))
    : state.designs;
  if (!selected.length) {
    alert("No designs available for stone chart detection.");
    return;
  }
  const scopeText = selectedDesignIds.size
    ? `${selected.length} selected design(s)`
    : `all ${selected.length} design(s)`;
  if (!confirmStoneChartCrop(`Auto detect and save stone chart crops for ${scopeText}?`)) {
    return;
  }
  button.disabled = true;
  let processed = 0;
  let cropped = 0;
  let noChart = 0;
  let failed = 0;
  try {
    for (const design of selected) {
      processed += 1;
      if (status) status.textContent = `Checking ${processed} of ${selected.length}: ${designText(design)}`;
      try {
        const imageData = await getDesignImage(design.id);
        if (!imageData) {
          noChart += 1;
          continue;
        }
        const split = await autoSplitDesignAndStoneChartDataUrl(imageData);
        if (!split?.stoneChartImageData) {
          noChart += 1;
          continue;
        }
        await saveStoneChartImage(design.id, split.stoneChartImageData, DEFAULT_STONE_ITEM_KEY);
        markDesignStoneChart(design, DEFAULT_STONE_ITEM_KEY, true);
        await deleteStoneChartSourceImage(design.id).catch(() => {});
        design.hasStoneChartSource = false;
        design.stoneChartSourceName = "";
        cropped += 1;
      } catch (error) {
        console.warn("Could not detect stone chart in old design", design, error);
        failed += 1;
      }
    }
    if (cropped) saveState();
    renderDesigns();
    if (document.getElementById("design-category-dialog").open) {
      const category = document.getElementById("design-category-title").textContent || "";
      if (category) openDesignCategory(encodeURIComponent(category));
    }
    if (status) {
      status.textContent = `Stone chart auto detect complete: ${cropped} crop(s) saved, ${noChart} no chart found, ${failed} failed. Full chart copies were not kept.`;
    }
    alert(`Stone chart auto detect complete.\nCrops saved: ${cropped}\nNo chart found: ${noChart}\nFailed: ${failed}\n\nFull duplicate stone chart copies were not kept.`);
  } finally {
    button.disabled = false;
  }
}

async function resizeDesignImagesAndCleanChartCopies() {
  const button = document.getElementById("design-resize-clean");
  const status = document.getElementById("design-bulk-crop-status");
  const selected = selectedDesignIds.size
    ? state.designs.filter((design) => selectedDesignIds.has(design.id))
    : state.designs;
  if (!selected.length) {
    alert("No designs available.");
    return;
  }
  const scopeText = selectedDesignIds.size
    ? `${selected.length} selected design(s)`
    : `all ${selected.length} design(s)`;
  if (!confirm(`Resize ${scopeText} to ${DESIGN_IMAGE_ASPECT_TEXT} and remove old full stone-chart source copies?\n\nCropped item stone charts and stone details will remain.`)) return;
  button.disabled = true;
  let resized = 0;
  let missing = 0;
  let cleaned = 0;
  let failed = 0;
  try {
    for (const [index, design] of selected.entries()) {
      if (status) status.textContent = `Processing ${index + 1} of ${selected.length}: ${designText(design)}`;
      try {
        const imageData = await getDesignImage(design.id).catch(() => design.imageData || "");
        if (imageData) {
          const normalizedImage = await normalizeDesignImageDataUrl(imageData);
          if (normalizedImage) {
            await saveDesignImage(design.id, normalizedImage);
            resized += 1;
          }
        } else {
          missing += 1;
        }
        await deleteStoneChartSourceImage(design.id).catch(() => {});
        if (design.hasStoneChartSource || design.stoneChartSourceName) cleaned += 1;
        design.hasStoneChartSource = false;
        design.stoneChartSourceName = "";
      } catch (error) {
        console.warn("Could not resize/clean design image", design, error);
        failed += 1;
      }
    }
    saveState();
    renderDesigns();
    if (document.getElementById("design-category-dialog").open) {
      const category = document.getElementById("design-category-title").textContent || "";
      if (category) openDesignCategory(encodeURIComponent(category));
    }
    if (status) {
      status.textContent = `${DESIGN_IMAGE_ASPECT_TEXT} cleanup complete: ${resized} design image(s) resized, ${cleaned} full chart source copy/copies removed, ${missing} missing image(s), ${failed} failed.`;
    }
    alert(`${DESIGN_IMAGE_ASPECT_TEXT} cleanup complete.\nDesign images resized: ${resized}\nFull chart source copies removed: ${cleaned}\nMissing images: ${missing}\nFailed: ${failed}`);
  } finally {
    button.disabled = false;
  }
}

async function deleteSelectedDesigns() {
  const ids = [...selectedDesignIds].filter((id) => state.designs.some((design) => design.id === id));
  if (!ids.length) {
    alert("Select design first.");
    return;
  }
  const usedIds = ids.filter((id) => state.orders.some((order) => order.designId === id));
  const deleteIds = ids.filter((id) => !usedIds.includes(id));
  if (!deleteIds.length) {
    alert("Selected designs are used in job orders, so they cannot be deleted.");
    return;
  }
  const usedNote = usedIds.length ? `\n\n${usedIds.length} design(s) are used in job orders and will be skipped.` : "";
  if (!confirm(`Delete ${deleteIds.length} selected design(s)? Design images, stone charts, and stone details will be removed.${usedNote}`)) return;
  const openCategoryDialog = document.getElementById("design-category-dialog");
  const openCategory = openCategoryDialog?.open ? document.getElementById("design-category-title")?.textContent || "" : "";
  for (const id of deleteIds) {
    const design = findById("designs", id);
    await deleteDesignImage(id);
    await deleteAllStoneChartImages(design);
  }
  state.designs = state.designs.filter((design) => !deleteIds.includes(design.id));
  deleteIds.forEach((id) => selectedDesignIds.delete(id));
  saveState();
  render();
  if (openCategoryDialog?.open) {
    const stillExists = designCategoryGroups().some((group) => group.category === openCategory);
    if (stillExists) openDesignCategory(encodeURIComponent(openCategory));
    else openCategoryDialog.close();
  }
  alert(`Deleted ${deleteIds.length} design(s).${usedIds.length ? ` ${usedIds.length} used design(s) skipped.` : ""}`);
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
    updateDesignSelectionSummary();
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
  updateDesignSelectionSummary();
}

function designStoneChartPreviewHtml(design) {
  const chartKeys = designStoneChartItemKeys(design);
  const hasSource = Boolean(design.hasStoneChartSource);
  if (!chartKeys.length && !hasSource) return "";
  const previewKey = chartKeys[0];
  const showItemCrop = Boolean(previewKey);
  return `
    <figure>
      <span>${showItemCrop ? `Stone Chart${chartKeys.length > 1 ? "s" : ""}` : "Old Full Chart Copy"}</span>
      <img class="design-thumb stone-chart-thumb" ${showItemCrop ? `data-stone-chart-image="${design.id}" data-stone-chart-item="${escapeHtml(previewKey)}"` : `data-stone-chart-source-image="${design.id}"`} alt="Stone chart for ${escapeHtml(design.name)}">
      <small class="stone-chart-chip-list">${chartKeys.map((key) => `<b>${escapeHtml(stoneItemInputValue(key))}</b>`).join("")}${!showItemCrop && hasSource ? "<b>Old Source</b>" : ""}</small>
    </figure>
  `;
}

function renderDesignCard(design) {
  const chartKeys = designStoneChartItemKeys(design);
  const hasSource = Boolean(design.hasStoneChartSource);
  const stoneSummary = design.stoneItems?.length ? ` / ${designStoneSummaryText(design.stoneItems)}` : design.stoneDetails ? " / Stone details added" : "";
  return `
    <article class="design-category-item" data-design-card="${escapeHtml(design.id)}">
      <label class="design-select-check">
        <input class="design-select-input" type="checkbox" data-design-select="${escapeHtml(design.id)}" ${selectedDesignIds.has(design.id) ? "checked" : ""}>
        <span>Select</span>
      </label>
      <div class="design-preview-pair ${chartKeys.length || hasSource ? "has-stone-chart" : ""}">
        <figure>
          <span>Design</span>
          <img class="design-thumb" data-design-image="${design.id}" alt="${escapeHtml(design.name)}">
        </figure>
        ${designStoneChartPreviewHtml(design)}
      </div>
      <strong>${escapeHtml(designText(design))}</strong>
      <span>${escapeHtml(design.category || "Uncategorised")}</span>
      <span class="dialog-note">${chartKeys.length ? `${chartKeys.length} item crop${chartKeys.length === 1 ? "" : "s"} saved` : "No item crop saved"}${hasSource ? " / old full chart copy can be cleaned" : ""}${escapeHtml(stoneSummary)}</span>
      <div class="row-actions">
        <button class="ghost-button" onclick="openDesignImage('${design.id}')">View</button>
        <button class="ghost-button" onclick="openDesignStoneCrop('${design.id}')">Crop Chart From Design</button>
        ${chartKeys.length || hasSource ? `<button class="ghost-button" onclick="openStoneChart('${design.id}')">Stone Chart</button><button class="ghost-button danger-button" onclick="removeDesignStoneChart('${design.id}')">Remove Stone Chart</button>` : ""}
        <button class="ghost-button" onclick="openDesignStoneDetails('${design.id}')">Modify Stone Details</button>
        <button class="ghost-button" onclick="mergeDesignPrompt('${design.id}')">Merge</button>
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
  const dialog = document.getElementById("design-category-dialog");
  if (!dialog.open) dialog.showModal();
  loadDesignThumbnails();
  updateDesignSelectionSummary();
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

async function openDesignStoneCrop(designId) {
  const design = findById("designs", designId);
  if (!design) return;
  const categoryDialog = document.getElementById("design-category-dialog");
  stoneCropReturnContext = {
    type: "design-category",
    category: categoryDialog.open
      ? document.getElementById("design-category-title").textContent || design.category || "Uncategorised"
      : design.category || "Uncategorised",
    designId: design.id,
  };
  if (document.getElementById("design-category-dialog").open) {
    document.getElementById("design-category-dialog").close();
  }
  await loadStoneEntry(design.id, defaultStoneItemKeyForDesign(design));
  const opened = await openStoneCropDialog();
  if (!opened) stoneCropReturnContext = null;
}

async function openStoneChart(designId) {
  const design = findById("designs", designId);
  if (!design) return;
  const chartKeys = designStoneChartItemKeys(design);
  const choices = [...(design.hasStoneChartSource ? ["SOURCE"] : []), ...chartKeys];
  if (!choices.length) {
    alert("No stone chart uploaded for this design.");
    return;
  }
  const labelForChoice = (key) => key === "SOURCE" ? "Main" : stoneItemInputValue(key);
  const choice = choices.length === 1
    ? labelForChoice(choices[0])
    : prompt(`Which stone chart to view?\nAvailable: ${choices.map(labelForChoice).join(", ")}`, labelForChoice(choices[0]));
  if (choice === null) return;
  const selectedKey = String(choice || "").trim().toUpperCase() === "MAIN" || String(choice || "").trim().toUpperCase() === "SOURCE"
    ? "SOURCE"
    : normalizeStoneItemKey(choice);
  if (!choices.includes(selectedKey)) {
    alert("Stone chart item not found.");
    return;
  }
  const imageData = selectedKey === "SOURCE"
    ? await getStoneChartSourceImage(design.id).catch(() => "")
    : await getStoneChartImage(design.id, selectedKey).catch(() => "");
  if (!imageData) {
    alert("No stone chart uploaded for this item.");
    return;
  }
  const image = document.getElementById("design-image-full");
  image.src = imageData;
  document.getElementById("design-image-title").textContent = `Stone Chart - ${design.number || "Design"} / ${labelForChoice(selectedKey)}`;
  document.getElementById("design-image-summary").textContent = `${design.name || ""} ${selectedKey === "SOURCE" ? "Main matching image" : stoneItemLabel(selectedKey)}`.trim();
  document.getElementById("design-image-dialog").showModal();
}

async function removeDesignStoneChart(designId) {
  const design = findById("designs", designId);
  if (!design) return;
  const chartKeys = designStoneChartItemKeys(design);
  const choices = [...(design.hasStoneChartSource ? ["SOURCE"] : []), ...chartKeys];
  if (!choices.length) return;
  const labelForChoice = (key) => key === "SOURCE" ? "Main" : stoneItemInputValue(key);
  const choice = choices.length === 1
    ? labelForChoice(choices[0])
    : prompt(`Which stone chart to remove?\nAvailable: ${choices.map(labelForChoice).join(", ")}`, labelForChoice(choices[0]));
  if (choice === null) return;
  const selectedKey = String(choice || "").trim().toUpperCase() === "MAIN" || String(choice || "").trim().toUpperCase() === "SOURCE"
    ? "SOURCE"
    : normalizeStoneItemKey(choice);
  if (!choices.includes(selectedKey)) {
    alert("Stone chart item not found.");
    return;
  }
  if (!confirm(`Remove ${labelForChoice(selectedKey)} stone chart from ${designText(design)}? Stone detail rows will remain for checking/editing.`)) return;
  if (selectedKey === "SOURCE") {
    await deleteStoneChartSourceImage(design.id);
    design.hasStoneChartSource = false;
    design.stoneChartSourceName = "";
  } else {
    await deleteStoneChartImage(design.id, selectedKey);
    markDesignStoneChart(design, selectedKey, false);
  }
  saveState();
  renderDesigns();
  if (document.getElementById("design-category-dialog").open) {
    openDesignCategory(encodeURIComponent(design.category || "Uncategorised"));
  }
}

function findDesignByMergeInput(input, excludeId = "") {
  const query = normalizedDesignMatchKey(input);
  if (!query) return null;
  return state.designs.find((design) =>
    design.id !== excludeId &&
    designMatchKeys(design).some((key) => key === query || key.includes(query) || query.includes(key))
  );
}

async function mergeDesignPrompt(sourceDesignId) {
  const source = findById("designs", sourceDesignId);
  if (!source) return;
  const targetInput = prompt(`Merge ${designText(source)} into which design number/name?`);
  const target = findDesignByMergeInput(targetInput, source.id);
  if (!target) {
    alert("Target design not found.");
    return;
  }
  if (!confirm(`Merge ${designText(source)} into ${designText(target)}?\n\nSource design will be removed after image, stone chart, stone details, and job references are moved.`)) return;
  await mergeDesignRecords(source, target);
  const category = target.category || source.category || "Uncategorised";
  saveState();
  render();
  if (document.getElementById("design-category-dialog").open) {
    openDesignCategory(encodeURIComponent(category));
  }
  alert("Designs merged.");
}

async function mergeDesignRecords(source, target) {
  if (!source || !target || source.id === target.id) return;
  if (!target.category && source.category) target.category = source.category;
  if (!target.stoneItems?.length && source.stoneItems?.length) {
    target.stoneItems = source.stoneItems.map((item) => ({ ...item, id: crypto.randomUUID() }));
  } else if (source.stoneItems?.length) {
    target.stoneItems = [
      ...(target.stoneItems || []),
      ...source.stoneItems.map((item) => ({ ...item, id: crypto.randomUUID() })),
    ];
  }
  target.stoneDetails = designStoneDetailsText(target.stoneItems || []);
  for (const itemKey of designStoneChartItemKeys(source)) {
    if (designHasStoneChartForItem(target, itemKey)) continue;
    const sourceChart = await getStoneChartImage(source.id, itemKey).catch(() => "");
    if (sourceChart) {
      await saveStoneChartImage(target.id, sourceChart, itemKey);
      markDesignStoneChart(target, itemKey, true);
    }
  }
  const targetImage = await getDesignImage(target.id).catch(() => "");
  if (!targetImage) {
    const sourceImage = await getDesignImage(source.id).catch(() => "");
    if (sourceImage) await saveDesignImage(target.id, await normalizeDesignImageDataUrl(sourceImage).catch(() => sourceImage));
  }
  state.orders.forEach((order) => {
    if (order.designId === source.id) {
      order.designId = target.id;
      order.designNumber = designLabel(target.id);
      order.designNo = designLabel(target.id);
      order.category = target.category || order.category || "";
    }
  });
  await deleteDesignImage(source.id);
  await deleteAllStoneChartImages(source);
  state.designs = state.designs.filter((design) => design.id !== source.id);
  updateDesignReferences(target);
}

function openDesignStoneDetails(designId) {
  const categoryDialog = document.getElementById("design-category-dialog");
  if (categoryDialog?.open) {
    const design = findById("designs", designId);
    stoneEntryReturnContext = {
      type: "design-category",
      category: design?.category || document.getElementById("design-category-title").textContent || "Uncategorised",
    };
    categoryDialog.close();
  }
  openStoneEntryDialog(designId);
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
  document.getElementById("design-form-title").textContent = "Edit Design / Add Stone Charts";
  document.getElementById("design-submit").textContent = "Update Design";
  document.getElementById("design-upload-status").textContent = designStoneChartItemKeys(design).length
    ? "Stone chart item(s) already added. Use Stone Entry to add CL/CG/CM charts separately."
    : "Upload a stone chart here, or use Stone Entry to crop item-wise charts.";
  document.getElementById("cancel-design-edit").classList.remove("hidden");
}

function resetDesignForm() {
  const form = document.getElementById("design-form");
  form.reset();
  form.designId.value = "";
  document.getElementById("design-form-title").textContent = "Add Design";
  document.getElementById("design-submit").textContent = "Upload Design(s)";
  document.getElementById("design-upload-status").textContent = "Design images are saved in 4x6 size. If the same image contains a stone chart, use Crop Chart From Design in Design Master instead of uploading the chart again.";
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
  if (supabaseClient) {
    const blob = dataUrlToBlob(imageData);
    await supabaseClient.storage
      .from("design-images")
      .upload(`${id}.jpg`, blob, { contentType: blob.type || "image/jpeg", upsert: true });
  }
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

function stoneChartKey(id, itemKey = DEFAULT_STONE_ITEM_KEY) {
  const key = normalizeStoneItemKey(itemKey);
  return key === DEFAULT_STONE_ITEM_KEY
    ? `stone-chart-${id}`
    : `stone-chart-${id}-${stoneItemStorageSuffix(key)}`;
}

function stoneChartSourceKey(id) {
  return `stone-chart-source-${id}`;
}

async function saveStoneChartSourceImage(id, imageData) {
  return saveDesignImage(stoneChartSourceKey(id), imageData);
}

async function getStoneChartSourceImage(id) {
  return getDesignImage(stoneChartSourceKey(id));
}

async function deleteStoneChartSourceImage(id) {
  return deleteDesignImage(stoneChartSourceKey(id));
}

async function saveStoneChartImage(id, imageData, itemKey = DEFAULT_STONE_ITEM_KEY) {
  return saveDesignImage(stoneChartKey(id, itemKey), imageData);
}

async function getStoneChartImage(id, itemKey = DEFAULT_STONE_ITEM_KEY) {
  return getDesignImage(stoneChartKey(id, itemKey));
}

async function deleteStoneChartImage(id, itemKey = DEFAULT_STONE_ITEM_KEY) {
  return deleteDesignImage(stoneChartKey(id, itemKey));
}

async function deleteAllStoneChartImages(design) {
  if (!design) return;
  await deleteStoneChartSourceImage(design.id).catch(() => {});
  const keys = new Set([DEFAULT_STONE_ITEM_KEY, ...designStoneChartItemKeys(design)]);
  for (const itemKey of keys) {
    await deleteStoneChartImage(design.id, itemKey).catch(() => {});
  }
}

async function getDesignImage(id) {
  if (supabaseClient) {
    const { data, error } = await supabaseClient.storage
      .from("design-images")
      .download(`${id}.jpg`);
    if (!error && data) return blobToDataUrl(data);
  }
  const db = await openDesignImageDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("images", "readonly");
    const request = transaction.objectStore("images").get(id);
    request.onsuccess = () => resolve(request.result || "");
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function deleteDesignImage(id) {
  if (supabaseClient) {
    await supabaseClient.storage.from("design-images").remove([`${id}.jpg`]);
  }
  const db = await openDesignImageDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("images", "readwrite");
    transaction.objectStore("images").delete(id);
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
  const stoneCharts = [...document.querySelectorAll("[data-stone-chart-image]")];
  for (const image of stoneCharts) {
    try {
      image.src = await getStoneChartImage(image.dataset.stoneChartImage, image.dataset.stoneChartItem || DEFAULT_STONE_ITEM_KEY);
    } catch (error) {
      image.removeAttribute("src");
      image.alt = "Stone chart not available";
    }
  }
  const stoneChartSources = [...document.querySelectorAll("[data-stone-chart-source-image]")];
  for (const image of stoneChartSources) {
    try {
      image.src = await getStoneChartSourceImage(image.dataset.stoneChartSourceImage);
    } catch (error) {
      image.removeAttribute("src");
      image.alt = "Main stone chart not available";
    }
  }
}

async function migrateLegacyDesignImages() {
  const legacyDesigns = state.designs.filter((design) => design.imageData);
  if (!legacyDesigns.length) return;
  for (const design of legacyDesigns) {
    const normalizedImage = await normalizeDesignImageDataUrl(design.imageData).catch(() => design.imageData);
    await saveDesignImage(design.id, normalizedImage || design.imageData);
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
        resolve(designImageToFourBySixDataUrl(image));
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

function currentDepartmentBadgeHtml(lot = {}) {
  const department = lot.karigarName || lot.currentDepartment || "-";
  const process = lot.currentDepartment && lot.currentDepartment !== department ? lot.currentDepartment : "";
  const completedClass = lot.status === "Completed" ? " completed" : "";
  return `
    <div class="current-dept-badge${completedClass}">
      <span>${lot.status === "Completed" ? "Last Dept" : "Current Dept"}</span>
      <strong>${escapeHtml(department)}</strong>
      ${process ? `<small>Process: ${escapeHtml(process)}</small>` : `<small>Process: -</small>`}
    </div>
  `;
}

function transferCurrentLocationHtml(lot = {}, waxStoneWeight = 0, settingStoneNote = "") {
  const department = lot.karigarName || lot.currentDepartment || "current department";
  const process = lot.currentDepartment && lot.currentDepartment !== department ? lot.currentDepartment : "";
  return `
    <span>${escapeHtml(lot.number || "Lot")} current department:</span>
    <strong class="transfer-current-dept">${escapeHtml(department)}</strong>
    ${process ? `<span class="transfer-current-process">Process: <b>${escapeHtml(process)}</b></span>` : ""}
    <span>GW includes wax stone ${gram(waxStoneWeight)}.${escapeHtml(settingStoneNote)}</span>
  `;
}

function setTransferCurrentNote(html) {
  const note = document.getElementById("transfer-current");
  note.className = "dialog-note transfer-current-highlight";
  note.innerHTML = html;
}

function renderProduction() {
  const rows = state.lots.map((lot) => `
    <tr>
      <td>${lot.number}</td>
      <td>${escapeHtml(lot.orderNumber)}</td>
      <td class="current-dept-cell">${currentDepartmentBadgeHtml(lot)}</td>
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
    .filter((lot) => {
      const hasBill = Boolean(lot.bill || state.bills?.some((item) => item.lotId === lot.id));
      if (isBillQcOnlyMode()) return hasBill;
      return lot.status === "Completed" || hasBill;
    })
    .filter((lot) => {
      const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id) || {};
      const orders = billableOrdersForLot(lot, bill);
      const text = `${lot.number} ${lot.orderNumber} ${orders.map((order) => order.customer).join(" ")} ${bill.billNo || ""}`.toLowerCase();
      return text.includes(query);
    })
    .map((lot) => {
      const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
      const orders = billableOrdersForLot(lot, bill || {});
      const customer = orders[0]?.customer || "-";
      const billWeight = bill ? gram(Number(bill.netWeight || 0)) : "-";
      const actionLabel = isBillQcOnlyMode()
        ? "QC Check"
        : bill
          ? (isGeneratedBillLockedForCurrentUser(bill) ? "View Bill" : "View / Edit Bill")
          : "Make Bill";
      return `
        <tr>
          <td>${escapeHtml(lot.number)}</td>
          <td>${escapeHtml(lot.orderNumber || "-")}${lot.qcReturn ? "<br><small>Repair final bill</small>" : ""}</td>
          <td>${escapeHtml(customer)}</td>
          <td>${gram(lot.finishedWeight)}</td>
          <td>${wastageDetailHtml(lot)}</td>
          <td>${escapeHtml(bill?.billNo || "-")}</td>
          <td>${billWeight}</td>
          <td><span class="status ${bill ? "completed" : "pending"}">${bill ? escapeHtml(lot.billingStage || "Sales Office QC") : "Pending Bill"}</span></td>
          <td>
            <div class="row-actions">
              <button type="button" onclick="openBill('${lot.id}')">${actionLabel}</button>
              ${bill ? `<button type="button" class="ghost-button" onclick="printBill('${lot.id}')">Bill</button><button type="button" class="ghost-button" onclick="printPackingList('${lot.id}')">Packing List</button>` : ""}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
  document.getElementById("bill-table").innerHTML = rows || tableEmpty(9, "No completed job cards available for billing.");
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
        entry.item.hallmarkLotNo,
        entry.item.hallmarkLotNumber,
        entry.item.salesTeam,
        entry.item.soldCustomer,
        entry.item.repairStatus,
        entry.item.repairStartDate,
        entry.item.repairIssueDate,
        entry.item.repairReturnDate,
        entry.item.repairAdditionalLoss,
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
        <td>${escapeHtml(bill.billNo || "-")}</td>
        <td>${escapeHtml(officeHuidText(item))}</td>
        <td>${escapeHtml(officeItemLocation(item))}${hallmarkLotLabel(item) ? `<br><small>HM Lot ${escapeHtml(hallmarkLotLabel(item))}</small>` : ""}</td>
        <td><span class="status ${officeItemStatusClass(item)}">${escapeHtml(officeItemStatus(item))}</span><br><small>${escapeHtml(officeItemDate(item))}</small>${isRepairItem(item) ? `<br><small>${escapeHtml(repairDayText(item))} / Loss ${gram(item.repairAdditionalLoss)}</small>` : ""}</td>
        <td><button type="button" class="ghost-button office-view-button" data-office-view-key="${escapeHtml(key)}">View</button></td>
      </tr>
    `;
    })
    .join("");
  document.getElementById("office-table").innerHTML = rows || tableEmpty(12, "No QC OK items received in Office.");
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
      content: renderHallmarkLotLibraryItems(groups.hallmarking, "No item issued to Hallmarking."),
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
        <button type="button" id="office-select-dialog-items" class="ghost-button">Select All</button>
        <button type="button" id="office-print-tags" class="ghost-button">Print Selected Tags</button>
      `,
      content: renderHallmarkLotLibraryItems(groups.hallmarked, "No hallmarked stock."),
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
  const hmLot = hallmarkLotLabel(item);
  const department = officeDepartment(item);
  return `
    <article class="office-item-tile ${department}">
      <label class="office-tile-select">
        <input class="office-item-check" type="checkbox" value="${escapeHtml(key)}">
        <span>${escapeHtml(officeItemStatus(item))}</span>
      </label>
      <strong>${escapeHtml(item.productionNo || order.productionNo || "-")}</strong>
      <span>${escapeHtml(order.customer || "-")}</span>
      <span>${escapeHtml(order.designNo || designLabel(order.designId) || "-")}</span>
      <div class="office-tile-metrics">
        <b>Net ${gram(item.netWeight)}</b>
      </div>
      <div class="office-tile-huid">
        ${officeHuidHtml(lot, item, order)}
        <small>${escapeHtml(huidText)}</small>
      </div>
      <div class="office-tile-footer">
        <span>${escapeHtml(officeItemLocation(item))}</span>
        <span class="status ${officeItemStatusClass(item)}">${escapeHtml(officeItemStatus(item))}</span>
      </div>
      ${hmLot ? `<small>HM Lot ${escapeHtml(hmLot)}</small>` : ""}
      ${isRepairItem(item) ? `<small>${escapeHtml(repairDayText(item))} / Extra loss ${gram(item.repairAdditionalLoss)}</small>` : ""}
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
          <span><b>Total Non-Gold</b>${billNonGoldTotalText(item, order)}</span>
          <span><b>Non-Gold Details</b>${escapeHtml(billNonGoldSummaryText(item, order))}</span>
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

function renderRepairItems(entries, emptyText) {
  if (!entries.length) return `<div class="empty">${emptyText}</div>`;
  const readonly = canEditOfficeWeights() ? "" : "readonly";
  return `
    <div class="repair-item-grid">
      ${entries.map(({ lot, bill, item, order }) => {
        const key = officeItemKey(lot.id, item);
        const suggestedLoss = repairSuggestedAdditionalLoss(item);
        return `
          <div class="office-library-item repair repair-detail-card">
            <label class="office-tile-select">
              <input class="office-item-check" type="checkbox" value="${escapeHtml(key)}">
              <span>${escapeHtml(officeItemStatus(item))}</span>
            </label>
            <div class="office-library-row">
              <strong>${escapeHtml(item.productionNo || order.productionNo || "-")}</strong>
              <span class="status ${officeItemStatusClass(item)}">${escapeHtml(repairDayText(item))}</span>
            </div>
            <span>${escapeHtml(order.customer || "-")} / ${escapeHtml(order.designNo || designLabel(order.designId) || "-")}</span>
            <div class="sales-detail-grid repair-detail-grid">
              <span><b>Job Card</b>${escapeHtml(lot.orderNumber || lot.number || "-")}</span>
              <span><b>Repair Start</b>${escapeHtml(item.repairStartDate || item.qcDate || "-")}</span>
              <span><b>Repair Issue</b>${escapeHtml(item.repairIssueDate || "-")}</span>
              <span><b>Repair Return</b>${escapeHtml(item.repairReturnDate || "-")}</span>
              <span><b>Previous Net</b>${gram(item.repairBaseNetWeight || item.netWeight)}</span>
              <span><b>Current Net</b>${gram(item.netWeight)}</span>
              <span><b>Extra Loss</b>${gram(item.repairAdditionalLoss)}</span>
              <span><b>Status</b>${escapeHtml(item.repairStatus || "QC Failed")}</span>
            </div>
            <div class="repair-input-grid">
              <label>Final GW After Repair <input class="repair-final-gw-input" data-key="${escapeHtml(key)}" type="number" min="0" step="0.001" value="${weight3(item.finalGw)}" ${readonly}></label>
              <label>Additional Repair Loss <input class="repair-loss-input" data-key="${escapeHtml(key)}" type="number" min="0" step="0.001" value="${weight3(suggestedLoss)}" ${readonly}></label>
            </div>
            <small>${escapeHtml(bill.billNo || "-")} / ${escapeHtml(officeItemLocation(item))}</small>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderHallmarkLotLibraryItems(entries, emptyText) {
  if (!entries.length) return `<div class="empty">${emptyText}</div>`;
  const groups = entries.reduce((acc, entry) => {
    const lotNo = hallmarkLotLabel(entry.item) || "No HM Lot";
    acc[lotNo] = acc[lotNo] || [];
    acc[lotNo].push(entry);
    return acc;
  }, {});
  return `
    <div class="hallmark-lot-groups">
      ${Object.entries(groups).map(([lotNo, lotEntries]) => `
        <section class="hallmark-lot-group">
          <div class="panel-heading hallmark-lot-heading">
            <h3>${escapeHtml(lotNo)}</h3>
            <span>${lotEntries.length} pcs</span>
          </div>
          ${renderOfficeLibraryItems(lotEntries, "")}
        </section>
      `).join("")}
    </div>
  `;
}

function renderOfficeLibraryItems(entries, emptyText) {
  if (!entries.length) return `<div class="empty">${emptyText}</div>`;
  return entries.map(({ lot, bill, item, order }) => {
    const key = officeItemKey(lot.id, item);
    const hmLot = hallmarkLotLabel(item);
    const soldAction = item.saleStatus === "Sold"
      ? `<button type="button" class="ghost-button office-view-button" data-sold-view-key="${escapeHtml(key)}">View</button>`
      : "";
    const tagAction = isHallmarkedItem(item)
      ? `<button type="button" class="ghost-button office-view-button" data-office-tag-key="${escapeHtml(key)}">Tag</button>`
      : "";
    return `
      <div class="office-library-item ${officeDepartment(item)}">
        <label class="office-tile-select">
          <input class="office-item-check" type="checkbox" value="${escapeHtml(key)}">
          <span>${escapeHtml(officeItemStatus(item))}</span>
        </label>
        <div class="office-library-row">
          <strong>${escapeHtml(item.productionNo || order.productionNo || "-")}</strong>
          <div class="row-actions">${tagAction}${soldAction}</div>
        </div>
        <span>${escapeHtml(order.customer || "-")} / ${escapeHtml(order.designNo || designLabel(order.designId) || "-")}</span>
        <small>${escapeHtml(lot.orderNumber || "-")} / ${escapeHtml(bill.billNo || "-")} / ${gram(item.netWeight)}</small>
        ${hmLot ? `<small><b>HM Lot</b> ${escapeHtml(hmLot)}${item.hallmarkLotIssueDate ? ` / Issue ${escapeHtml(item.hallmarkLotIssueDate)}` : ""}${item.hallmarkLotReceiveDate ? ` / Return ${escapeHtml(item.hallmarkLotReceiveDate)}` : ""}</small>` : ""}
        <small>Location: ${escapeHtml(officeItemLocation(item))}</small>
        ${isRepairItem(item) ? `<small>${escapeHtml(repairDayText(item))} / Extra loss ${gram(item.repairAdditionalLoss)}</small>` : ""}
        ${item.soldCustomer ? `<small>Sold To: ${escapeHtml(item.soldCustomer)}</small>` : ""}
        ${item.hallmarkStatus === "Issued" ? officeHuidHtml(lot, item, order) : ""}
        ${isHallmarkedItem(item) ? `<small>HUID: ${escapeHtml([item.huid1, item.huid2].filter(Boolean).join(" / "))}</small>` : ""}
        ${item.tagPrinted ? `<small><span class="status completed">Tag Printed</span> ${escapeHtml(item.tagPrintedDate || "")}</small>` : ""}
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
  const tagAction = isHallmarkedItem(item)
    ? `<button type="button" class="ghost-button" data-office-tag-key="${escapeHtml(key)}">Print Tag</button>`
    : "";
  if (actions) actions.innerHTML = `<button type="button" id="office-back-sold" class="ghost-button">Back To Office Details</button>${tagAction}${discardAction}`;
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
            ${isRepairItem(item) || item.repairStatus ? soldDetailCell("Repair Status", item.repairStatus || "-") : ""}
            ${isRepairItem(item) || item.repairStatus ? soldDetailCell("Repair Days", repairDayText(item)) : ""}
            ${isRepairItem(item) || item.repairStatus ? soldDetailCell("Repair Start", item.repairStartDate) : ""}
            ${isRepairItem(item) || item.repairStatus ? soldDetailCell("Repair Issue", item.repairIssueDate) : ""}
            ${isRepairItem(item) || item.repairStatus ? soldDetailCell("Repair Return", item.repairReturnDate) : ""}
            ${isRepairItem(item) || item.repairStatus ? soldDetailCell("Additional Repair Loss", gram(item.repairAdditionalLoss)) : ""}
            ${isDiscardedItem(item) ? soldDetailCell("Discard Reason", item.discardReason) : ""}
            ${isDiscardedItem(item) ? soldDetailCell("Discard Date", item.discardDate) : ""}
            ${soldDetailCell("Job Card", lot.orderNumber || lot.number)}
            ${soldDetailCell("Lot", lot.number)}
            ${soldDetailCell("Hallmark Lot", hallmarkLotLabel(item))}
            ${soldDetailCell("HM Issue Date", item.hallmarkLotIssueDate || item.hallmarkIssueDate)}
            ${soldDetailCell("HM Return Date", item.hallmarkLotReceiveDate || item.hallmarkReceiveDate)}
            ${soldDetailCell("Bill No", bill.billNo)}
            ${soldDetailCell("Original Customer", order.customer)}
            ${soldDetailCell("Sold To", item.soldCustomer)}
            ${soldDetailCell("Sale Date", item.saleDate)}
            ${soldDetailCell("Sales Team", item.salesTeam)}
            ${soldDetailCell("Design", order.designNo || designLabel(order.designId))}
            ${soldDetailCell("Category", order.category || design.category)}
            ${isCmCategory(order.category || design.category) ? soldDetailCell("CM Item", cmItemTypeLabel(order.cmItemType || defaultCmItemTypeForCategory(order.category || design.category))) : ""}
            ${soldDetailCell("Ring Type", ringTypeLabel(order.ringType))}
            ${soldDetailCell("Size", soldItemSizeText(order))}
            ${soldDetailCell("Colour", order.color)}
            ${soldDetailCell("Purity", item.purity || order.purity)}
            ${soldDetailCell("GW", gram(item.finalGw))}
            ${soldDetailCell("Total Non-Gold", billNonGoldTotalText(item, order))}
            ${soldDetailCell("Non-Gold Details", billNonGoldSummaryText(item, order))}
            ${soldDetailCell("Net Wt", gram(item.netWeight))}
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
      .filter((item) => !isDiscardedItem(item) && (
        item.qcStatus === "QC OK" && item.officeStatus === "Office"
      ))
      .map((item) => ({
        lot,
        bill,
        item,
        order: findById("orders", item.orderId) || {},
      }));
  });
}

function repairJobItems() {
  return state.lots.flatMap((lot) => {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    if (!bill?.items?.length) return [];
    return bill.items
      .filter((item) => isRepairItem(item))
      .map((item) => ({
        lot,
        bill,
        item,
        order: findById("orders", item.orderId) || {},
      }));
  });
}

function isRepairItem(item = {}) {
  if (isDiscardedItem(item)) return false;
  if (item.qcStatus === "QC Failed") return true;
  return ["QC Failed", "In Repair Production", "Repaired - Ready For Final Bill"].includes(item.repairStatus || "");
}

function officeDepartment(item = {}) {
  if (isDiscardedItem(item)) return "discarded";
  if (item.saleStatus === "Sold") return "sold";
  if (isRepairItem(item)) return "repair";
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
  if (isRepairItem(item)) return item.repairStatus === "In Repair Production" ? "Repair Production" : "QC Failed / Repair";
  if (item.saleStatus === "Sold") return item.salesTeam || "Sold";
  if (item.salesTeam) return item.salesTeam;
  if (item.hallmarkStatus === "Issued") return hallmarkLotLabel(item) ? `Hallmarking Department - ${hallmarkLotLabel(item)}` : "Hallmarking Department";
  if (isHallmarkedItem(item)) return "Hallmarked Item";
  return "Non Hallmarked Item";
}

function officeItemLocation(item) {
  if (isDiscardedItem(item)) return "Discarded / Melting";
  if (isRepairItem(item)) {
    if (item.repairStatus === "In Repair Production") return "Repair Production";
    if (item.repairStatus === "Repaired - Ready For Final Bill") return "Repair Completed - Final Bill";
    return "QC Failed - Back To Production";
  }
  if (item.saleStatus === "Sold") return item.soldCustomer ? `Sold to ${item.soldCustomer}` : "Sold Item";
  if (item.salesTeam) return `Sales Team - ${item.salesTeam}`;
  if (item.hallmarkStatus === "Issued") return hallmarkLotLabel(item) ? `Hallmarking Department - ${hallmarkLotLabel(item)}` : "Hallmarking Department";
  if (isHallmarkedItem(item)) return hallmarkLotLabel(item) ? `Office - Hallmarked Item Stock - ${hallmarkLotLabel(item)}` : "Office - Hallmarked Item Stock";
  return "Office - Non Hallmarked Item Stock";
}

function officeItemStatus(item) {
  if (isDiscardedItem(item)) return "Discarded for Melting";
  if (isRepairItem(item)) return item.repairStatus || "QC Failed";
  if (item.saleStatus === "Sold") return "Sold";
  if (item.salesTeam) return "With Sales Team";
  if (item.hallmarkStatus === "Issued") return hallmarkLotLabel(item) ? `Hallmarking Issued ${hallmarkLotLabel(item)}` : "Hallmarking Issued";
  if (isHallmarkedItem(item)) return item.tagPrinted ? "Tag Printed" : "Hallmarked";
  return "Non Hallmarked";
}

function officeItemStatusClass(item) {
  if (isDiscardedItem(item)) return "cancelled";
  if (isRepairItem(item)) {
    if (item.repairStatus === "In Repair Production") return "transfer";
    if (item.repairStatus === "Repaired - Ready For Final Bill") return "pending";
    return "cancelled";
  }
  if (item.saleStatus === "Sold") return "completed";
  if (item.salesTeam) return "pending";
  if (item.hallmarkStatus === "Issued") return "transfer";
  return "completed";
}

function officeItemDate(item) {
  if (isDiscardedItem(item)) return item.discardDate || "";
  if (isRepairItem(item)) return item.repairReturnDate || item.repairIssueDate || item.repairStartDate || item.qcDate || "";
  if (isHallmarkedItem(item) && item.tagPrinted && !item.salesTeam && item.hallmarkStatus !== "Issued") return item.tagPrintedDate || "";
  return item.saleDate || item.salesIssueDate || item.hallmarkReceiveDate || item.hallmarkIssueDate || item.qcDate || "";
}

function repairDayCount(item = {}) {
  const start = item.repairStartIsoDate || "";
  const end = item.repairReturnIsoDate || isoToday();
  if (start) return daysBetween(start, end);
  return Number(item.repairDays || 0);
}

function repairDayText(item = {}) {
  const days = repairDayCount(item);
  return `${days} repair day${days === 1 ? "" : "s"}`;
}

function repairSuggestedAdditionalLoss(item = {}) {
  if (Number(item.repairLastLoss || 0) > 0) return Number(item.repairLastLoss || 0);
  const baseNet = Number(item.repairBaseNetWeight || item.netWeight || 0);
  const currentNet = Number(item.netWeight || 0);
  return Number(weight3(Math.max(baseNet - currentNet, 0)));
}

function isDiscardedItem(item = {}) {
  return item.discardStatus === "Discarded";
}

function selectedOfficeKeys() {
  return Array.from(document.querySelectorAll(".office-item-check:checked")).map((input) => input.value);
}

function hallmarkLotLabel(item = {}) {
  return item.hallmarkLotNo || item.hallmarkLotNumber || "";
}

function nextHallmarkLotNumber() {
  let max = 0;
  state.lots.forEach((lot) => {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    (bill?.items || []).forEach((item) => {
      const match = String(hallmarkLotLabel(item)).match(/hm\s*0*(\d+)/i);
      if (match) max = Math.max(max, Number(match[1] || 0));
    });
  });
  return `HM${String(max + 1).padStart(2, "0")}`;
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
  const hallmarkLotNo = action === "hallmarkIssue" ? nextHallmarkLotNumber() : "";
  let updated = 0;
  state.lots.forEach((lot) => {
    const bill = lot.bill || state.bills?.find((item) => item.lotId === lot.id);
    if (!bill?.items?.length) return;
    bill.items = bill.items.map((item) => {
      if (!keys.includes(officeItemKey(lot.id, item))) return item;
      updated += 1;
      if (action === "hallmarkIssue") {
        return {
          ...item,
          hallmarkStatus: "Issued",
          hallmarkIssueDate: today(),
          hallmarkIssueIsoDate: isoToday(),
          hallmarkLotNo,
          hallmarkLotNumber: hallmarkLotNo,
          hallmarkLotIssueDate: today(),
          hallmarkLotIssueIsoDate: isoToday(),
          holder: "Hallmarking Department",
          salesTeam: "",
          salesIssueDate: "",
          saleStatus: "",
        };
      }
      if (action === "hallmarkReceive") {
        return {
          ...item,
          hallmarkStatus: "Received",
          hallmarkReceiveDate: today(),
          hallmarkReceiveIsoDate: isoToday(),
          hallmarkLotNo: hallmarkLotLabel(item),
          hallmarkLotNumber: hallmarkLotLabel(item),
          hallmarkLotReceiveDate: today(),
          hallmarkLotReceiveIsoDate: isoToday(),
          holder: "Hallmarked Item",
        };
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
  if (isBillQcOnlyMode() && !bill.id) {
    alert("Bill must be created by Bill Dept, Manager, or Owner before QC check.");
    return;
  }
  const form = document.getElementById("bill-form");
  const billableOrders = billableOrdersForLot(lot, bill);
  const customer = billableOrders[0]?.customer || "-";
  form.lotId.value = lot.id;
  form.billNo.value = bill.billNo || nextBillNumber();
  form.billDate.value = bill.billDate || isoToday();
  form.remarks.value = bill.remarks || "";
  const lockedForUser = isGeneratedBillLockedForCurrentUser(bill);
  document.getElementById("bill-form-title").textContent = isBillQcOnlyMode()
    ? "QC Check"
    : bill.billNo
      ? (lockedForUser ? "View Bill" : "View / Edit Bill")
      : "Make Bill";
  document.getElementById("bill-summary").textContent = [
    `${lot.number} / ${lot.orderNumber || "-"} / ${customer} / ${billableOrders.length} current item${billableOrders.length === 1 ? "" : "s"} / Finished ${gram(lot.finishedWeight)}`,
    lockedForUser ? "Bill already generated. Bill Dept can view only; Manager and Owner can edit." : "",
  ].filter(Boolean).join(" | ");
  renderBillItems(lot, bill);
  updateBillAmount();
  applyBillAccessMode();
  document.getElementById("bill-dialog").showModal();
}

function applyBillAccessMode() {
  const form = document.getElementById("bill-form");
  if (!form) return;
  const qcOnlyMode = isBillQcOnlyMode();
  const canChangeQc = canEditQcStatus();
  const lot = findById("lots", form.lotId.value);
  const bill = lot?.bill || state.bills?.find((item) => item.lotId === lot?.id) || {};
  const lockedForUser = isGeneratedBillLockedForCurrentUser(bill);
  form.classList.toggle("qc-only-bill-form", qcOnlyMode);
  form.classList.toggle("locked-bill-form", lockedForUser);
  form.querySelectorAll("input, textarea").forEach((input) => {
    if (input.type === "hidden") return;
    input.readOnly = qcOnlyMode || lockedForUser || input.hasAttribute("readonly");
  });
  form.querySelectorAll("select").forEach((select) => {
    select.disabled = lockedForUser || (qcOnlyMode && select.name !== "billItemQcStatus") || (select.name === "billItemQcStatus" && !canChangeQc);
  });
  const transferOk = document.getElementById("bill-qc-ok");
  const transferFailed = document.getElementById("bill-qc-failed");
  const submitButton = form.querySelector('button[type="submit"]');
  if (transferOk) transferOk.classList.toggle("hidden", qcOnlyMode);
  if (transferFailed) transferFailed.classList.toggle("hidden", qcOnlyMode);
  if (submitButton) {
    submitButton.classList.toggle("hidden", lockedForUser);
    submitButton.disabled = lockedForUser;
    submitButton.textContent = qcOnlyMode ? "Save QC Check" : "Save Bill";
  }
}

function billWeightInputValue(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number === 0) return "0";
  return weight3(number).replace(/0+$/, "").replace(/\.$/, "");
}

function billWeightText(value) {
  return `${billWeightInputValue(value)} g`;
}

function billNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeBbType(value = "") {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  if (!match) return "";
  const number = Number(match[0]);
  if (!Number.isFinite(number) || number <= 0) return "";
  return String(number);
}

function bbTypeOptions(selected = "") {
  const normalized = normalizeBbType(selected);
  const options = [
    ["", "Select"],
    ["1.3", "1.3 gm / 100 pc"],
    ["0.9", "0.9 gm / 100 pc"],
  ];
  return options.map(([value, label]) =>
    `<option value="${escapeHtml(value)}" ${value === normalized ? "selected" : ""}>${escapeHtml(label)}</option>`
  ).join("");
}

function bbTypeLabel(value = "") {
  const normalized = normalizeBbType(value);
  if (normalized === "1.3") return "1.3 gm/100 pc";
  if (normalized === "0.9") return "0.9 gm/100 pc";
  return "";
}

function bbTypeWeightPerPc(value = "") {
  const normalized = Number(normalizeBbType(value));
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  return normalized > 0.1 ? normalized / 100 : normalized;
}

function bbWeightFromType(bbNo = "", bbType = "") {
  const pcs = Number(bbNo || 0);
  const weightPerPc = bbTypeWeightPerPc(bbType);
  if (!Number.isFinite(pcs) || pcs <= 0 || !weightPerPc) return 0;
  return Number(weight3(pcs * weightPerPc));
}

function automaticBillStoneWeight(order = {}) {
  if (!order?.id) return 0;
  return Number(weight3(productionStoneTotalsForOrders([order]).weight || 0));
}

function billItemNonGoldBreakup(item = {}, order = {}) {
  const plannedStoneWeight = automaticBillStoneWeight(order);
  const stoneWeight = order.id
    ? plannedStoneWeight
    : billNumber(item.stoneWeight ?? item.stWeight ?? item.stoneWt);
  const bbNo = item.bbNo ?? item.blackBeads ?? "";
  const bbType = normalizeBbType(item.bbType ?? "");
  const calculatedBbWeight = bbWeightFromType(bbNo, bbType);
  const savedBbWeight = billNumber(item.blackBeadsWeight ?? item.bbWeight);
  const blackBeadsWeight = bbType ? calculatedBbWeight : savedBbWeight;
  const motiWeight = billNumber(item.motiWeight ?? item.mmWeight);
  const springWeight = billNumber(item.springWeight);
  const otherNonGoldWeight = billNumber(item.otherNonGoldWeight ?? item.otherWeight);
  const total = Number(weight3(stoneWeight + blackBeadsWeight + motiWeight + springWeight + otherNonGoldWeight));
  return {
    bbNo,
    bbType,
    blackBeadsWeight,
    motiWeight,
    stoneWeight,
    springWeight,
    otherNonGoldWeight,
    total,
  };
}

function billNonGoldSummaryText(item = {}, order = {}) {
  const nonGold = billItemNonGoldBreakup(item, order);
  return [
    `BB ${nonGold.bbNo ? `${nonGold.bbNo}${bbTypeLabel(nonGold.bbType) ? ` ${bbTypeLabel(nonGold.bbType)}` : ""} ` : ""}${billWeightText(nonGold.blackBeadsWeight)}`,
    `Moti ${billWeightText(nonGold.motiWeight)}`,
    `Stone ${billWeightText(nonGold.stoneWeight)}`,
    `Spring ${billWeightText(nonGold.springWeight)}`,
    `Other ${billWeightText(nonGold.otherNonGoldWeight)}`,
  ].join(" / ");
}

function billNonGoldTotalText(item = {}, order = {}) {
  return billWeightText(billItemNonGoldBreakup(item, order).total);
}

function updateBillAmount() {
  const form = document.getElementById("bill-form");
  if (!form) return;
  const itemRows = billItemRows();
  renderBillTotals(itemRows);
}

function billTotals(items = []) {
  return items.reduce((total, item) => ({
    pieces: total.pieces + 1,
    finalGw: total.finalGw + billNumber(item.finalGw),
    bbWeight: total.bbWeight + billNumber(item.blackBeadsWeight || item.bbWeight),
    motiWeight: total.motiWeight + billNumber(item.motiWeight || item.mmWeight),
    stoneWeight: total.stoneWeight + billNumber(item.stoneWeight || item.stWeight),
    springWeight: total.springWeight + billNumber(item.springWeight),
    otherNonGoldWeight: total.otherNonGoldWeight + billNumber(item.otherNonGoldWeight || item.otherWeight),
    reducedWeight: total.reducedWeight + billNumber(item.reducedWeight),
    netWeight: total.netWeight + billNumber(item.netWeight),
  }), {
    pieces: 0,
    finalGw: 0,
    bbWeight: 0,
    motiWeight: 0,
    stoneWeight: 0,
    springWeight: 0,
    otherNonGoldWeight: 0,
    reducedWeight: 0,
    netWeight: 0,
  });
}

function renderBillTotals(items = []) {
  const container = document.getElementById("bill-totals");
  if (!container) return;
  const total = billTotals(items);
  container.innerHTML = `
    <div class="bill-total-card"><span>Items</span><strong>${total.pieces}</strong></div>
    <div class="bill-total-card"><span>Total GW (g)</span><strong>${gram(total.finalGw)}</strong></div>
    <div class="bill-total-card"><span>BB Wt (g)</span><strong>${gram(total.bbWeight)}</strong></div>
    <div class="bill-total-card"><span>Moti Wt (g)</span><strong>${gram(total.motiWeight)}</strong></div>
    <div class="bill-total-card"><span>Stone Wt (g)</span><strong>${gram(total.stoneWeight)}</strong></div>
    <div class="bill-total-card"><span>Spring Wt (g)</span><strong>${gram(total.springWeight)}</strong></div>
    <div class="bill-total-card"><span>Other Wt (g)</span><strong>${gram(total.otherNonGoldWeight)}</strong></div>
    <div class="bill-total-card"><span>Total Non-Gold (g)</span><strong>${gram(total.reducedWeight)}</strong></div>
    <div class="bill-total-card highlight"><span>Net Wt (g)</span><strong>${gram(total.netWeight)}</strong></div>
  `;
}

function billOrderDesignCode(order = {}) {
  const design = findById("designs", order.designId) || {};
  return order.designNo || order.designNumber || design.number || designText(design) || order.category || "";
}

function renderBillItems(lot, bill = {}) {
  const body = document.getElementById("bill-item-table");
  if (!body) return;
  const savedItems = Array.isArray(bill.items) ? bill.items : [];
  const billableOrders = billableOrdersForLot(lot, bill);
  const qcDisabled = canEditQcStatus() ? "" : " disabled";
  const rows = billableOrders.map((order, index) => {
    const saved = savedItems.find((item) => item.orderId === order.id || item.productionNo === order.productionNo) || {};
    const nonGold = billItemNonGoldBreakup(saved, order);
    const finalGwValue = saved.finalGw ?? "";
    const finalGw = Number(finalGwValue || 0);
    const netWeight = finalGwValue === "" ? 0 : Math.max(finalGw - nonGold.total, 0);
    const purity = saved.purity || order.purity || "18K";
    const qcStatus = saved.qcStatus || "Pending QC";
    const qcNote = saved.reworkLotNumber ? `Returned: ${saved.reworkLotNumber}` : (saved.officeStatus ? saved.officeStatus : "");
    const designCode = billOrderDesignCode(order);
    const itemLabel = [
      designCode || `Item ${index + 1}`,
      order.productionNo || order.number || "",
      order.ringType || "",
    ].filter(Boolean).join(" / ");
    return `
      <tr data-order-id="${escapeHtml(order.id)}" data-production-no="${escapeHtml(order.productionNo || "")}" data-design-no="${escapeHtml(designCode)}" data-job-stone-weight="${weight3(nonGold.stoneWeight)}" data-purity="${escapeHtml(purity)}" data-office-status="${escapeHtml(saved.officeStatus || "")}" data-rework-lot-id="${escapeHtml(saved.reworkLotId || "")}" data-rework-lot-number="${escapeHtml(saved.reworkLotNumber || "")}">
        <td>
          <strong>${escapeHtml(itemLabel)}</strong>
          <small>${escapeHtml(order.customer || "")}${order.color ? ` / ${escapeHtml(order.color)}` : ""}${order.size ? ` / Size ${escapeHtml(order.size)}` : ""}</small>
        </td>
        <td><input name="billItemFinalGw" type="number" min="0" step="0.001" value="${escapeHtml(finalGwValue)}" placeholder="Final GW"></td>
        <td>
          <div class="bill-non-gold-grid">
            <label>BB No <input name="billItemBbNo" type="number" min="0" step="1" value="${escapeHtml(nonGold.bbNo)}" placeholder="0"></label>
            <label>BB Type <select name="billItemBbType">${bbTypeOptions(nonGold.bbType)}</select></label>
            <label>BB Wt <input name="billItemBbWeight" type="number" readonly value="${escapeHtml(billWeightInputValue(nonGold.blackBeadsWeight))}"></label>
            <label>Moti Wt <input name="billItemMotiWeight" type="number" min="0" step="0.00001" value="${escapeHtml(billWeightInputValue(nonGold.motiWeight))}"></label>
            <label>Stone Wt <input name="billItemStoneWeight" type="number" readonly value="${escapeHtml(billWeightInputValue(nonGold.stoneWeight))}"></label>
            <label>Spring <input name="billItemSpringWeight" type="number" min="0" step="0.00001" value="${escapeHtml(billWeightInputValue(nonGold.springWeight))}"></label>
            <label>Other Wt <input name="billItemOtherNonGoldWeight" type="number" min="0" step="0.00001" value="${escapeHtml(billWeightInputValue(nonGold.otherNonGoldWeight))}"></label>
          </div>
        </td>
        <td><input name="billItemReducedWeight" type="number" readonly value="${weight3(nonGold.total)}"></td>
        <td><input name="billItemNetWeight" type="number" readonly value="${weight3(netWeight)}"></td>
        <td>${escapeHtml(purity)}</td>
        <td>
          <select name="billItemQcStatus"${qcDisabled}>
            <option value="Pending QC" ${qcStatus === "Pending QC" ? "selected" : ""}>Pending QC</option>
            <option value="QC OK" ${qcStatus === "QC OK" ? "selected" : ""}>QC OK</option>
            <option value="QC Failed" ${qcStatus === "QC Failed" ? "selected" : ""}>QC Failed</option>
          </select>
          <small>${escapeHtml(qcNote)}</small>
        </td>
      </tr>
    `;
  }).join("");
  body.innerHTML = rows || tableEmpty(7, "No item details found for this job card.");
}

function billItemRows(existingItems = []) {
  const canChangeQc = canEditQcStatus();
  return Array.from(document.querySelectorAll("#bill-item-table tr[data-order-id]")).map((row) => {
    const existing = existingItems.find((item) => item.orderId === row.dataset.orderId || item.productionNo === row.dataset.productionNo) || {};
    const finalGwInput = row.querySelector('[name="billItemFinalGw"]');
    const bbNoInput = row.querySelector('[name="billItemBbNo"]');
    const bbTypeInput = row.querySelector('[name="billItemBbType"]');
    const bbWeightInput = row.querySelector('[name="billItemBbWeight"]');
    const motiWeightInput = row.querySelector('[name="billItemMotiWeight"]');
    const stoneWeightInput = row.querySelector('[name="billItemStoneWeight"]');
    const springWeightInput = row.querySelector('[name="billItemSpringWeight"]');
    const otherNonGoldWeightInput = row.querySelector('[name="billItemOtherNonGoldWeight"]');
    const reducedInput = row.querySelector('[name="billItemReducedWeight"]');
    const netInput = row.querySelector('[name="billItemNetWeight"]');
    const qcStatusInput = row.querySelector('[name="billItemQcStatus"]');
    const finalGw = Number(finalGwInput?.value || 0);
    const bbNo = (bbNoInput?.value || "").trim();
    const bbType = (bbTypeInput?.value || "").trim();
    const calculatedBbWeight = bbWeightFromType(bbNo, bbType);
    const blackBeadsWeight = bbType ? calculatedBbWeight : Number(bbWeightInput?.value || 0);
    const motiWeight = Number(motiWeightInput?.value || 0);
    const stoneWeight = Number(row.dataset.jobStoneWeight || 0);
    const springWeight = Number(springWeightInput?.value || 0);
    const otherNonGoldWeight = Number(otherNonGoldWeightInput?.value || 0);
    const reducedWeight = Number(weight3(blackBeadsWeight + motiWeight + stoneWeight + springWeight + otherNonGoldWeight));
    const netWeight = Math.max(finalGw - reducedWeight, 0);
    if (bbWeightInput) bbWeightInput.value = billWeightInputValue(blackBeadsWeight);
    if (stoneWeightInput) stoneWeightInput.value = billWeightInputValue(stoneWeight);
    if (reducedInput) reducedInput.value = weight3(reducedWeight);
    if (netInput) netInput.value = weight3(netWeight);
    return {
      ...existing,
      orderId: row.dataset.orderId || "",
      productionNo: row.dataset.productionNo || "",
      designNo: row.dataset.designNo || existing.designNo || "",
      purity: row.dataset.purity || "",
      finalGw: Number(weight3(finalGw)),
      bbNo,
      bbType: normalizeBbType(bbType),
      blackBeads: bbNo || existing.blackBeads || "",
      blackBeadsWeight: Number(weight3(blackBeadsWeight)),
      bbWeight: Number(weight3(blackBeadsWeight)),
      motiWeight: Number(weight3(motiWeight)),
      mmWeight: Number(weight3(motiWeight)),
      stoneWeight: Number(weight3(stoneWeight)),
      stWeight: Number(weight3(stoneWeight)),
      springWeight: Number(weight3(springWeight)),
      otherNonGoldWeight: Number(weight3(otherNonGoldWeight)),
      otherWeight: Number(weight3(otherNonGoldWeight)),
      reducedWeight: Number(weight3(reducedWeight)),
      netWeight: Number(weight3(netWeight)),
      makingPercent: 0,
      makingGold: 0,
      manufacturingMakingPercent: 0,
      manufacturingMakingGold: 0,
      officeMakingPercent: 0,
      officeMakingGold: 0,
      qcStatus: canChangeQc ? (qcStatusInput?.value || "Pending QC") : (existing.qcStatus || "Pending QC"),
      officeStatus: row.dataset.officeStatus || "",
      reworkLotId: row.dataset.reworkLotId || "",
      reworkLotNumber: row.dataset.reworkLotNumber || "",
    };
  });
}

function transferQcOkItemsToOffice() {
  const saved = saveBillFromForm(false, { allowLockedBillFlow: true });
  if (!saved) return;
  const { lot, bill } = saved;
  let moved = 0;
  bill.items = (bill.items || []).map((item) => {
    if (isDiscardedItem(item)) return item;
    if (item.qcStatus !== "QC OK") return item;
    moved += 1;
    return {
      ...item,
      officeStatus: "Office",
      qcDate: today(),
      factoryStatus: "Factory Out",
      factoryOutDate: today(),
      holder: "Office",
    };
  });
  if (!moved) {
    alert("Select QC OK for at least one item.");
    return;
  }
  lot.bill = bill;
  lot.billingStage = bill.items.some((item) => item.qcStatus === "QC Failed") ? "QC Failed / Repair Pending" : "Office";
  lot.productionStockWeight = billProductionStockWeight(bill);
  lot.currentDepartment = "Office";
  lot.karigarName = "Office Department";
  markParentRepairItemsComplete(lot, bill);
  updateSavedBill(bill);
  saveState();
  render();
  openBill(lot.id);
}

function markParentRepairItemsComplete(reworkLot, reworkBill = {}) {
  if (!reworkLot?.parentLotId || !reworkBill?.items?.length) return;
  const parentLot = findById("lots", reworkLot.parentLotId);
  const parentBill = parentLot?.bill || state.bills?.find((item) => item.lotId === reworkLot.parentLotId);
  if (!parentLot || !parentBill?.items?.length) return;
  const okItems = (reworkBill.items || []).filter((item) => item.qcStatus === "QC OK" && !isDiscardedItem(item));
  if (!okItems.length) return;
  const okByOrderId = Object.fromEntries(okItems.map((item) => [item.orderId, item]));
  const repairReturnIsoDate = isoToday();
  const repairReturnDate = today();
  let changed = false;
  parentBill.items = parentBill.items.map((item) => {
    const repairedItem = okByOrderId[item.orderId];
    if (!repairedItem || item.reworkLotId !== reworkLot.id || item.repairStatus === "Repair Complete") return item;
    changed = true;
    const netWeight = Number(repairedItem.netWeight || item.netWeight || 0);
    const baseNet = Number(item.repairBaseNetWeight || item.netWeight || 0);
    const lastLoss = Number(weight3(Math.max(baseNet - netWeight, 0)));
    addRepairLossToLot(parentLot, findById("orders", item.orderId) || {}, item, lastLoss);
    return {
      ...item,
      finalGw: Number(repairedItem.finalGw || item.finalGw || 0),
      bbNo: repairedItem.bbNo || item.bbNo || "",
      bbType: repairedItem.bbType || item.bbType || "",
      blackBeads: repairedItem.blackBeads || repairedItem.bbNo || item.blackBeads || "",
      blackBeadsWeight: Number(repairedItem.blackBeadsWeight ?? item.blackBeadsWeight ?? 0),
      bbWeight: Number(repairedItem.bbWeight ?? repairedItem.blackBeadsWeight ?? item.bbWeight ?? 0),
      motiWeight: Number(repairedItem.motiWeight ?? item.motiWeight ?? 0),
      mmWeight: Number(repairedItem.mmWeight ?? repairedItem.motiWeight ?? item.mmWeight ?? 0),
      stoneWeight: Number(repairedItem.stoneWeight ?? item.stoneWeight ?? 0),
      stWeight: Number(repairedItem.stWeight ?? repairedItem.stoneWeight ?? item.stWeight ?? 0),
      springWeight: Number(repairedItem.springWeight ?? item.springWeight ?? 0),
      otherNonGoldWeight: Number(repairedItem.otherNonGoldWeight ?? item.otherNonGoldWeight ?? 0),
      otherWeight: Number(repairedItem.otherWeight ?? repairedItem.otherNonGoldWeight ?? item.otherWeight ?? 0),
      reducedWeight: Number(repairedItem.reducedWeight || item.reducedWeight || 0),
      netWeight,
      qcStatus: "QC OK",
      officeStatus: "",
      repairStatus: "Repair Complete",
      repairReturnDate: item.repairReturnDate || repairReturnDate,
      repairReturnIsoDate: item.repairReturnIsoDate || repairReturnIsoDate,
      repairCompleteDate: repairReturnDate,
      repairCompleteIsoDate: repairReturnIsoDate,
      repairDays: repairDayCount({ ...item, repairReturnIsoDate }),
      repairLastLoss: lastLoss,
      repairAdditionalLoss: Number(weight3(Number(item.repairAdditionalLoss || 0) + lastLoss)),
      repairFinalBillLotId: reworkLot.id,
      holder: "Repair Complete / Sent To Office",
    };
  });
  if (!changed) return;
  parentLot.bill = parentBill;
  parentLot.productionStockWeight = billProductionStockWeight(parentBill);
  updateSavedBill(parentBill);
}

function returnQcFailedItemsToProduction() {
  const saved = saveBillFromForm(false, { allowLockedBillFlow: true });
  if (!saved) return;
  const { lot, bill } = saved;
  const failedItems = (bill.items || []).filter((item) =>
    item.qcStatus === "QC Failed"
    && !isDiscardedItem(item)
    && item.repairStatus !== "In Repair Production"
    && !item.reworkLotId
  );
  if (!failedItems.length) {
    alert("Select QC Failed for at least one item not already sent to repair production.");
    return;
  }
  const failedOrderIds = failedItems.map((item) => item.orderId).filter(Boolean);
  const failedOrders = failedOrderIds.map((id) => findById("orders", id)).filter(Boolean);
  if (!failedOrders.length) {
    alert("No failed job item found.");
    return;
  }
  const repairStartDate = today();
  const repairStartIsoDate = isoToday();
  const reworkLot = createQcFailedReworkLot(lot, failedOrders, failedItems);
  failedOrders.forEach((order) => {
    order.status = "Repair Production";
  });
  bill.items = (bill.items || []).map((item) => {
    if (!failedOrderIds.includes(item.orderId)) return item;
    return {
      ...item,
      officeStatus: "",
      repairStatus: "In Repair Production",
      repairStartDate: item.repairStartDate || repairStartDate,
      repairStartIsoDate: item.repairStartIsoDate || repairStartIsoDate,
      repairIssueDate: repairStartDate,
      repairIssueIsoDate: repairStartIsoDate,
      repairBaseFinalGw: Number(item.repairBaseFinalGw || item.finalGw || 0),
      repairBaseNetWeight: Number(item.repairBaseNetWeight || item.netWeight || 0),
      repairAdditionalLoss: Number(item.repairAdditionalLoss || 0),
      reworkLotId: reworkLot.id,
      reworkLotNumber: reworkLot.number,
      holder: "Repair Production",
      salesTeam: "",
      salesIssueDate: "",
      saleStatus: "",
      qcDate: repairStartDate,
    };
  });
  lot.bill = bill;
  lot.billingStage = "QC Failed / Repair Production";
  lot.productionStockWeight = billProductionStockWeight(bill);
  lot.currentDepartment = "Repair Production";
  lot.karigarName = "Repair Production";
  updateSavedBill(bill);
  saveState();
  render();
  openBill(lot.id);
}

function moveQcFailedItemsToOfficeRepair() {
  returnQcFailedItemsToProduction();
}

function issueRepairItemsToProduction() {
  const keys = selectedOfficeKeys();
  if (!keys.length) {
    alert("Select repair item to issue.");
    return;
  }
  const entries = selectedOfficeEntries(keys).filter(({ item }) => isRepairItem(item) && item.repairStatus !== "In Repair Production");
  if (!entries.length) {
    alert("Selected repair item is already issued or not in repair category.");
    return;
  }
  const entriesByLot = entries.reduce((acc, entry) => {
    acc[entry.lot.id] = acc[entry.lot.id] || [];
    acc[entry.lot.id].push(entry);
    return acc;
  }, {});
  Object.values(entriesByLot).forEach((lotEntries) => {
    const sourceLot = lotEntries[0].lot;
    const orders = lotEntries.map(({ order }) => order).filter((order) => order.id);
    const failedItems = lotEntries.map(({ item }) => item);
    const reworkLot = createQcFailedReworkLot(sourceLot, orders, failedItems);
    orders.forEach((order) => {
      order.status = "Repair Production";
    });
    const bill = sourceLot.bill || state.bills?.find((item) => item.lotId === sourceLot.id);
    if (!bill?.items?.length) return;
    const orderIds = new Set(failedItems.map((item) => item.orderId));
    bill.items = bill.items.map((item) => {
      if (!orderIds.has(item.orderId)) return item;
      return {
        ...item,
        officeStatus: "",
        repairStatus: "In Repair Production",
        repairIssueDate: today(),
        repairIssueIsoDate: isoToday(),
        reworkLotId: reworkLot.id,
        reworkLotNumber: reworkLot.number,
        holder: "Repair Production",
      };
    });
    sourceLot.bill = bill;
    sourceLot.billingStage = "Repair Production";
    sourceLot.currentDepartment = "Repair Production";
    sourceLot.karigarName = "Repair Production";
    updateSavedBill(bill);
  });
  saveState();
  render();
  openOfficeDialogPage("repair");
}

function receiveRepairItemsToOffice() {
  const keys = selectedOfficeKeys();
  if (!keys.length) {
    alert("Select repair item to receive.");
    return;
  }
  const finalGwInputs = repairInputValues(".repair-final-gw-input");
  const lossInputs = repairInputValues(".repair-loss-input");
  let updated = 0;
  selectedOfficeEntries(keys).forEach(({ lot, bill, item, order }) => {
    if (!isRepairItem(item) || item.repairStatus !== "In Repair Production") return;
    const key = officeItemKey(lot.id, item);
    const finalGw = Number(finalGwInputs[key] ?? item.finalGw ?? 0);
    if (!Number.isFinite(finalGw) || finalGw < 0) return;
    const reducedWeight = Number(item.reducedWeight || 0);
    const netWeight = Number(weight3(Math.max(finalGw - reducedWeight, 0)));
    const computedLoss = Number(weight3(Math.max(Number(item.netWeight || 0) - netWeight, 0)));
    const additionalLoss = Number(weight3(Number(lossInputs[key] ?? computedLoss)));
    const repairReturnIsoDate = isoToday();
    const repairReturnDate = today();
    const repairDays = repairDayCount({ ...item, repairReturnIsoDate });
    const index = bill.items.findIndex((billItem) => officeItemKey(lot.id, billItem) === key);
    if (index < 0) return;
    bill.items[index] = {
      ...item,
      finalGw: Number(weight3(finalGw)),
      netWeight,
      repairStatus: "Repaired - Ready For Final Bill",
      repairReturnDate,
      repairReturnIsoDate,
      repairDays,
      repairLastLoss: additionalLoss,
      repairAdditionalLoss: Number(weight3(Number(item.repairAdditionalLoss || 0) + additionalLoss)),
      holder: "Repair Completed / Final Bill",
      qcStatus: "QC OK",
      qcDate: repairReturnDate,
    };
    lot.bill = bill;
    closeRepairReworkLot(item.reworkLotId, netWeight);
    addRepairLossToLot(lot, order, item, additionalLoss);
    if (order.id) order.status = "Repair Ready For Final Bill";
    updateSavedBill(bill);
    updated += 1;
  });
  if (!updated) {
    alert("Select item that is issued for repair production.");
    return;
  }
  saveState();
  render();
  openOfficeDialogPage("repair");
}

function moveRepairedItemsToOfficeStock() {
  const keys = selectedOfficeKeys();
  if (!keys.length) {
    alert("Select repaired item to move to stock.");
    return;
  }
  let updated = 0;
  selectedOfficeEntries(keys).forEach(({ lot, bill, item, order }) => {
    if (!isRepairItem(item) || item.repairStatus !== "Repaired - Ready For Final Bill") return;
    const key = officeItemKey(lot.id, item);
    const index = bill.items.findIndex((billItem) => officeItemKey(lot.id, billItem) === key);
    if (index < 0) return;
    const updatedItem = {
      ...item,
      officeStatus: "Office",
      repairStatus: "Repair Complete",
      repairCompleteDate: today(),
      repairCompleteIsoDate: isoToday(),
      holder: isHallmarkedItem(item) ? "Hallmarked Item" : "Non Hallmarked Item",
      qcStatus: "QC OK",
    };
    bill.items[index] = updatedItem;
    lot.bill = bill;
    if (order.id) order.status = "Office";
    updateSavedBill(bill);
    updated += 1;
  });
  if (!updated) {
    alert("Select repaired item already received back to Office.");
    return;
  }
  saveState();
  render();
  openOfficeDialogPage("repair");
}

function repairInputValues(selector) {
  return Array.from(document.querySelectorAll(selector)).reduce((values, input) => {
    values[input.dataset.key] = input.value;
    return values;
  }, {});
}

function updateRepairLossInput(finalGwInput) {
  const found = findOfficeBillItem(finalGwInput.dataset.key);
  if (!found) return;
  const finalGw = Number(finalGwInput.value || 0);
  const reducedWeight = Number(found.item.reducedWeight || 0);
  const newNet = Number(weight3(Math.max(finalGw - reducedWeight, 0)));
  const loss = Number(weight3(Math.max(Number(found.item.netWeight || 0) - newNet, 0)));
  const lossInput = Array.from(document.querySelectorAll(".repair-loss-input"))
    .find((input) => input.dataset.key === finalGwInput.dataset.key);
  if (lossInput) lossInput.value = weight3(loss);
}

function closeRepairReworkLot(reworkLotId, netWeight) {
  if (!reworkLotId) return;
  const reworkLot = findById("lots", reworkLotId);
  if (!reworkLot) return;
  reworkLot.status = "Completed";
  reworkLot.finishedWeight = Number(weight3(netWeight || 0));
  reworkLot.productionStockWeight = 0;
  reworkLot.currentDepartment = "Bill / QC";
  reworkLot.karigarName = "Bill / QC";
}

function addRepairLossToLot(lot, order, item, additionalLoss) {
  const loss = Number(weight3(additionalLoss || 0));
  if (loss <= 0) return;
  const purity = item.purity || order.purity || lot.metalPurity || lot.wastagePurity || "18K";
  lot.repairAdditionalLoss = Number(weight3(Number(lot.repairAdditionalLoss || 0) + loss));
  lot.actualWastage = Number(weight3(Number(lot.actualWastage || 0) + loss));
  lot.wastagePurity = lot.wastagePurity || purity;
  lot.wastageFineGold = Number(weight3(fineGoldWeight(lot.actualWastage, lot.wastagePurity)));
  state.ledger.unshift({
    id: crypto.randomUUID(),
    date: today(),
    type: "Repair Loss",
    purity,
    weight: loss,
    reference: `${item.productionNo || order.productionNo || "Repair item"} extra repair manufacturing loss in ${lot.orderNumber || lot.number}`,
  });
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
    billOrderIds: orders.map((order) => order.id),
    orderNumber: sourceLot.orderNumber,
    karigarId: "",
    karigarName: "Repair Production",
    issueKarigarId: "",
    issueKarigarName: "Bill / QC",
    issueDepartment: "Bill / QC",
    currentDepartment: "Repair Production",
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
    qcReturnReason: "QC Failed repair from Bill / QC",
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
  syncFactoryOutForBill();
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
  const repairLoss = Number(lot.repairAdditionalLoss || 0);
  return `${gram(lot.actualWastage)}<br><small>${displayPurity(purity)} / Fine ${gram(fine)}${repairLoss ? ` / Repair +${gram(repairLoss)}` : ""}</small>`;
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

function renderSafe() {
  renderSafeLockers();
  renderMetalSafe();
  refreshMeltingSafeSourceOptions();
}

function renderSafeLockers() {
  const filter = document.getElementById("safe-locker-filter")?.value || "";
  const activeItems = (state.safeItems || []).filter((item) => item.status !== "Out");
  const totals = SAFE_LOCKERS.reduce((acc, locker) => {
    const items = activeItems.filter((item) => safeLockerForPurity(item.locker || item.purity) === locker);
    acc[locker] = {
      count: items.length,
      grossWeight: Number(weight3(items.reduce((total, item) => total + Number(item.grossWeight || 0), 0))),
      waxStoneWeight: Number(weight3(items.reduce((total, item) => total + safeItemWaxStoneWeight(item), 0))),
      netWeight: Number(weight3(items.reduce((total, item) => total + Number(item.netWeight ?? item.grossWeight ?? 0), 0))),
      rodWeight: safeLockerBalance(locker, "rod"),
      wastageWeight: safeLockerBalance(locker, "wastage"),
    };
    return acc;
  }, {});
  const tileContainer = document.getElementById("safe-locker-tiles");
  if (tileContainer) {
    tileContainer.innerHTML = SAFE_LOCKERS.map((locker) => `
      <button class="safe-locker-card ${filter === locker ? "active" : ""}" type="button" onclick="selectSafeLocker('${locker}')">
        <span>${locker} Safe</span>
        <strong>GW ${gram(totals[locker].grossWeight)}</strong>
        <small>Wax Stone ${gram(totals[locker].waxStoneWeight)} / NT ${gram(totals[locker].netWeight)}</small>
        <small>Rod NT ${gram(totals[locker].rodWeight)} / Wstg NT ${gram(totals[locker].wastageWeight)}</small>
        <small>${totals[locker].count} item${totals[locker].count === 1 ? "" : "s"}</small>
      </button>
    `).join("");
  }
  const shelfContainer = document.getElementById("safe-casting-shelves");
  if (shelfContainer) {
    const shelfGroups = castingShelfGroups(filter);
    shelfContainer.innerHTML = shelfGroups.length
      ? shelfGroups.map((group) => `
        <article class="safe-casting-shelf-card">
          <span>${escapeHtml(safeIssueSourceName(group))}</span>
          <strong>${escapeHtml(safeItemColour(group) || "-")}</strong>
          <small>${escapeHtml(displayPurity(safeItemDesiredPurity(group)))} / ${group.items.length} casting entr${group.items.length === 1 ? "y" : "ies"}</small>
          <div>
            <b>GW ${gram(group.grossWeight)}</b>
            <b>Wax ${gram(safeItemWaxStoneWeight(group))}</b>
            <b>NT ${gram(safeItemAvailableWeight(group))}</b>
          </div>
        </article>
      `).join("")
      : '<div class="empty">No combined casting shelf stock yet.</div>';
  }
  const rows = (state.safeItems || [])
    .filter((item) => !filter || safeLockerForPurity(item.locker || item.purity) === filter)
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.date || "-")}</td>
        <td>${escapeHtml(safeLockerForPurity(item.locker || item.purity))}</td>
        <td>${escapeHtml(safeKindLabel(item))}</td>
        <td>${escapeHtml(item.description || "-")}<br><small>${escapeHtml(item.sourceLine || item.purity || "")}</small></td>
        <td>${escapeHtml(item.source || "-")}</td>
        <td>${gram(item.grossWeight)}</td>
        <td>${gram(safeItemWaxStoneWeight(item))}</td>
        <td>${gram(item.netWeight ?? item.grossWeight)}</td>
        <td><span class="status ${statusClass(item.status || "In Safe")}">${escapeHtml(item.status || "In Safe")}</span>${item.remarks ? `<br><small>${escapeHtml(item.remarks)}</small>` : ""}</td>
        <td>${item.status === "Out" ? escapeHtml(item.outDate || "-") : `<button class="ghost-button" type="button" onclick="moveSafeItemOut('${item.id}')">Move Out</button>`}</td>
      </tr>
    `).join("");
  const table = document.getElementById("safe-item-table");
  if (table) table.innerHTML = rows || tableEmpty(10, "No item in this safe locker yet.");
}

function selectSafeLocker(locker) {
  const filter = document.getElementById("safe-locker-filter");
  if (filter) filter.value = filter.value === locker ? "" : locker;
  renderSafeLockers();
}

function renderMetalSafe() {
  const query = (document.getElementById("metal-safe-search")?.value || "").toLowerCase();
  const balances = Object.values(metalSafeBalances())
    .filter((item) => item.weight !== 0)
    .sort((a, b) => a.purity.localeCompare(b.purity));
  const summary = document.getElementById("metal-safe-summary");
  if (summary) {
    summary.innerHTML = balances.length
      ? balances.map((item) => `
        <article class="metal-safe-balance">
          <span>${escapeHtml(item.purity)}</span>
          <strong>${gram(item.weight)}</strong>
          <small>Fine ${gram(item.fineGold)}</small>
        </article>
      `).join("")
      : '<div class="empty">No metal in safe yet.</div>';
  }
  const rows = (state.metalSafeMovements || [])
    .filter((item) => {
      if (!query) return true;
      return [item.type, item.purity, item.reference, item.sourceType].join(" ").toLowerCase().includes(query);
    })
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.date || "-")}</td>
        <td><span class="status ${statusClass(item.type || item.direction || "In")}">${escapeHtml(item.type || "-")}</span></td>
        <td>${escapeHtml(normalizeMetalSafePurity(item.purity))}</td>
        <td>${metalSafeMovementSign(item) < 0 ? "-" : "+"}${gram(item.weight)}</td>
        <td>${gram(fineGoldWeight(item.weight, item.purity))}</td>
        <td>${escapeHtml(item.reference || "-")}</td>
      </tr>
    `).join("");
  const table = document.getElementById("metal-safe-table");
  if (table) table.innerHTML = rows || tableEmpty(6, "No metal safe movements recorded.");
}

function renderFactory() {
  renderFactoryVendorOptions();
  renderFactorySummary();
  renderVendorBalances();
  renderFactoryLedger();
}

function renderFactoryVendorOptions() {
  const vendors = [...(state.vendors || [])].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
  document.querySelectorAll('#factory-in-form select[name="vendorId"], #factory-out-form select[name="vendorId"]').forEach((select) => {
    const selected = select.value;
    select.innerHTML = vendors.length
      ? `<option value="">Select vendor / party</option>${vendors.map((vendor) => `<option value="${vendor.id}">${escapeHtml(vendor.name)}</option>`).join("")}`
      : '<option value="">Add vendor first</option>';
    select.value = vendors.some((vendor) => vendor.id === selected) ? selected : "";
  });
}

function renderFactorySummary() {
  const grid = document.getElementById("factory-summary-grid");
  if (!grid) return;
  const ledger = factoryLedgerTotals();
  const physical = factoryPhysicalFineStock();
  const vendorRows = vendorBalanceRows();
  const vendorTotals = factoryVendorFineTotals(vendorRows);
  const totalFineStock = totalFactoryFineStock(physical, vendorTotals);
  grid.innerHTML = [
    factorySummaryCard("Factory In Fine", gram(ledger.inFine), "Vendor inward + WSTG + opening stock"),
    factorySummaryCard("Factory Out Fine", gram(ledger.outFine), "Bills + metal/stock out"),
    factorySummaryCard("Ledger Fine Balance", gram(ledger.balanceFine), "Factory in minus factory out"),
    factorySummaryCard("Factory Item Fine", gram(physical.totalFine), `Metal ${gram(physical.metalFine)} / Shelf ${gram(physical.shelfFine)} / Production ${gram(physical.productionFine)}`),
    factorySummaryCard("Vendor Fine Balance", gram(vendorTotals.netBalance), `Payable ${gram(vendorTotals.payable)} / Receivable ${gram(vendorTotals.receivable)}`),
    factorySummaryCard("Total Factory Fine Stock", gram(totalFineStock), "Factory item fine - vendor fine balance", "owned"),
    factorySummaryCard("Payable To Vendors", gram(vendorTotals.payable), "Metal to give to party", vendorTotals.payable > 0 ? "payable" : ""),
    factorySummaryCard("Receivable From Vendors", gram(vendorTotals.receivable), "Metal to receive from party", vendorTotals.receivable > 0 ? "receivable" : ""),
  ].join("");
}

function factorySummaryCard(title, value, note, variant = "") {
  return `
    <article class="factory-summary-card ${escapeHtml(variant)}">
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function renderVendorBalances() {
  const query = (document.getElementById("vendor-search")?.value || "").trim().toLowerCase();
  const rows = vendorBalanceRows()
    .filter((row) => !query || [row.vendor.name, row.vendor.phone, row.vendor.city, row.vendor.remarks].join(" ").toLowerCase().includes(query))
    .map((row) => {
      const status = factoryBalanceStatus(row.balanceFine);
      const isManualVendor = Boolean((state.vendors || []).some((vendor) => vendor.id === row.vendor.id));
      return `
        <tr>
          <td><strong>${escapeHtml(row.vendor.name || "-")}</strong><br><small>${escapeHtml([row.vendor.phone, row.vendor.city].filter(Boolean).join(" / ") || row.vendor.remarks || "-")}</small></td>
          <td>${gram(row.inFine)}</td>
          <td>${gram(row.outFine)}</td>
          <td><strong>${row.balanceFine < 0 ? "-" : ""}${gram(Math.abs(row.balanceFine))}</strong></td>
          <td><span class="status ${statusClass(status)}">${escapeHtml(status)}</span></td>
          <td>${isManualVendor ? `<button class="ghost-button" type="button" onclick="editVendor('${row.vendor.id}')">Edit</button>` : ""}</td>
        </tr>
      `;
    }).join("");
  const table = document.getElementById("vendor-balance-table");
  if (table) table.innerHTML = rows || tableEmpty(6, "No vendor balance recorded yet.");
}

function renderFactoryLedger() {
  const query = (document.getElementById("factory-ledger-search")?.value || "").trim().toLowerCase();
  const rows = [...(state.factoryLedger || [])]
    .filter((entry) => {
      if (!query) return true;
      return [entry.date, entry.type, entry.vendorName, factoryMaterialLabel(entry.materialType), entry.purity, entry.wstgPercent, entry.reference, entry.stockPosting]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .map((entry) => `
      ${(() => {
        const fine = factoryFineGoldBreakup(entry);
        return `
      <tr>
        <td>${escapeHtml(entry.date || "-")}</td>
        <td><span class="status ${statusClass(entry.type || entry.direction)}">${escapeHtml(entry.type || "-")}</span></td>
        <td>${escapeHtml(entry.vendorName || "-")}</td>
        <td>${escapeHtml(factoryMaterialLabel(entry.materialType))}</td>
        <td>${escapeHtml(entry.purity || "-")}</td>
        <td>${fine.wstgPercent ? `${fine.wstgPercent.toFixed(2)}%<br><small>${gram(fine.wstgFineGold)}</small>` : "-"}</td>
        <td>${entry.direction === "out" ? "-" : "+"}${gram(entry.weight)}</td>
        <td>${entry.direction === "out" ? "-" : "+"}${gram(fine.fineGold)}<br><small>Base ${gram(fine.baseFineGold)}</small></td>
        <td>${escapeHtml(factoryStockPosting(entry))}</td>
        <td>${escapeHtml(entry.reference || "-")}${entry.remarks ? `<br><small>${escapeHtml(entry.remarks)}</small>` : ""}</td>
        <td><button class="ghost-button" type="button" onclick="openFactoryLedgerEdit('${entry.id}')">Edit</button></td>
      </tr>
        `;
      })()}
    `).join("");
  const table = document.getElementById("factory-ledger-table");
  if (table) table.innerHTML = rows || tableEmpty(11, "No factory in/out ledger entries yet.");
}

function renderFactoryEditVendorOptions(selectedVendorId = "") {
  const select = document.querySelector('#factory-entry-edit-form select[name="vendorId"]');
  if (!select) return;
  const vendors = [...(state.vendors || [])].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
  select.innerHTML = `<option value="">No vendor / opening stock</option>${vendors.map((vendor) => `<option value="${vendor.id}">${escapeHtml(vendor.name)}</option>`).join("")}`;
  select.value = vendors.some((vendor) => vendor.id === selectedVendorId) ? selectedVendorId : "";
}

function openFactoryLedgerEdit(id) {
  const entry = (state.factoryLedger || []).find((item) => item.id === id);
  if (!entry) return;
  const form = document.getElementById("factory-entry-edit-form");
  renderFactoryEditVendorOptions(entry.vendorId || "");
  form.entryId.value = entry.id;
  form.direction.value = entry.direction || "in";
  form.vendorId.value = entry.vendorId || "";
  form.materialType.value = entry.materialType || "raw-metal";
  form.purity.value = entry.purity || "";
  form.wstgPercent.value = factoryWstgPercent(entry.wstgPercent ?? entry.wastagePercent);
  form.weight.value = weight3(entry.weight || 0);
  form.reference.value = entry.reference || "";
  form.remarks.value = entry.remarks || "";
  document.getElementById("factory-entry-edit-note").textContent = entry.sourceType === "bill"
    ? "Bill factory-out row: corrected details will stay linked to this bill item."
    : "Factory in/out row: linked metal/shelf posting will be corrected where possible.";
  document.getElementById("factory-entry-dialog").showModal();
}

function editedFactoryLedgerEntry(existing = {}, data = {}) {
  const vendor = data.vendorId ? findById("vendors", data.vendorId) : null;
  const direction = data.direction || existing.direction || "in";
  const materialType = data.materialType || existing.materialType || "raw-metal";
  const purity = data.purity || existing.purity || "";
  const weight = Number(weight3(data.weight || existing.weight || 0));
  const wstgPercent = factoryWstgPercent(data.wstgPercent ?? existing.wstgPercent);
  const baseFineGold = fineGoldWeight(weight, purity);
  const wstgFineGold = Number(weight3(weight * (wstgPercent / 100)));
  const sourceType = existing.sourceType === "bill" ? "bill" : (direction === "out" ? "factory-out" : "factory-in");
  const stockPosting = materialType === "bill"
    ? "Factory Out By Bill"
    : direction === "out"
      ? factoryOutStockPosting(materialType, purity)
      : materialType === "raw-metal"
        ? "Metal Safe"
        : `${safeLockerForPurity(purity)} Shelf`;
  return {
    ...existing,
    date: existing.date || today(),
    direction,
    type: materialType === "bill"
      ? "Bill / Factory Out"
      : direction === "out"
        ? "Metal / Stock Factory Out"
        : "Factory In",
    vendorId: vendor?.id || data.vendorId || "",
    vendorName: vendor?.name || existing.vendorName || "",
    materialType,
    purity,
    weight,
    wstgPercent,
    wastagePercent: wstgPercent,
    baseFineGold,
    wstgFineGold,
    fineGold: Number(weight3(baseFineGold + wstgFineGold)),
    stockPosting,
    reference: data.reference || "",
    remarks: data.remarks || "",
    sourceType,
    sourceId: existing.sourceId || existing.id,
    sourceLine: existing.sourceLine || "",
    manualFactoryEdit: sourceType === "bill" || Boolean(existing.manualFactoryEdit),
    editedAt: new Date().toISOString(),
  };
}

function saveFactoryLedgerEdit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = getFormData(form);
  const index = (state.factoryLedger || []).findIndex((entry) => entry.id === data.entryId);
  if (index < 0) return;
  const oldEntry = { ...state.factoryLedger[index] };
  const newEntry = editedFactoryLedgerEntry(oldEntry, data);
  if (newEntry.weight <= 0) {
    alert("Enter valid factory weight.");
    return;
  }
  if (oldEntry.sourceType !== "bill") updateFactoryEntryStockPosting(oldEntry, newEntry);
  state.factoryLedger[index] = newEntry;
  saveState();
  render();
  document.getElementById("factory-entry-dialog").close();
}

function editVendor(id) {
  const vendor = findById("vendors", id);
  if (!vendor) return;
  openOperationPage("factory", "vendor");
  const form = document.getElementById("vendor-form");
  form.vendorId.value = vendor.id;
  form.name.value = vendor.name || "";
  form.phone.value = vendor.phone || "";
  form.city.value = vendor.city || "";
  form.remarks.value = vendor.remarks || "";
  document.getElementById("vendor-form-title").textContent = "Edit Vendor";
  document.getElementById("vendor-submit").textContent = "Update Vendor";
  document.getElementById("cancel-vendor-edit").classList.remove("hidden");
}

function resetVendorForm() {
  const form = document.getElementById("vendor-form");
  if (!form) return;
  form.reset();
  form.vendorId.value = "";
  document.getElementById("vendor-form-title").textContent = "Vendor Master";
  document.getElementById("vendor-submit").textContent = "Save Vendor";
  document.getElementById("cancel-vendor-edit").classList.add("hidden");
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

function addMeltingSourceRow(weight = "", purity = "", position = "bottom", shouldFocus = false, sourceKind = "metal", safePurity = "", safeLocker = "") {
  const row = document.createElement("div");
  row.className = "source-row";
  row.innerHTML = `
    <label>Source Type
      <select name="sourceKind">
        <option value="metal" ${!["rod", "wastage"].includes(sourceKind) ? "selected" : ""}>Metal Safe / Manual</option>
        <option value="rod" ${sourceKind === "rod" ? "selected" : ""}>Rod From Safe Locker</option>
        <option value="wastage" ${sourceKind === "wastage" ? "selected" : ""}>Wastage From Safe Locker</option>
      </select>
    </label>
    <label class="melting-metal-safe-field">Metal Safe <select name="sourceMetalSafePurity">${renderMetalSafeSourceOptions(safePurity)}</select></label>
    <label class="melting-rod-safe-field">Rod Safe <select name="sourceSafeLocker">${renderSafeLockerRodOptions(safeLocker)}</select></label>
    <label class="melting-wastage-safe-field">Wastage Safe <select name="sourceWastageLocker">${renderSafeLockerWastageOptions(safeLocker)}</select></label>
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
  updateMeltingSourceRowMode(row);
  if (shouldFocus) row.querySelector('[name="sourceWeightLine"]').focus();
}

function resetMeltingSources() {
  document.getElementById("melting-sources").innerHTML = "";
  addMeltingSourceRow();
}

function resetMeltingIssueForm() {
  const form = document.getElementById("melting-form");
  form.reset();
  form.meltingId.value = "";
  resetMeltingSources();
  document.getElementById("melting-form-title").textContent = "Melting Conversion";
  document.getElementById("melting-submit").textContent = "Save & Issue Melting";
  document.getElementById("cancel-melting-issue-edit").classList.add("hidden");
  updateMeltingCalculation();
}

function getMeltingSourceMetals() {
  return [...document.querySelectorAll("#melting-sources .source-row")]
    .map((row) => {
      const sourceKind = row.querySelector('[name="sourceKind"]')?.value || "metal";
      const safeLocker = sourceKind === "rod"
        ? row.querySelector('[name="sourceSafeLocker"]')?.value || ""
        : sourceKind === "wastage"
          ? row.querySelector('[name="sourceWastageLocker"]')?.value || ""
          : "";
      const safePurity = sourceKind === "metal" ? row.querySelector('[name="sourceMetalSafePurity"]')?.value || "" : "";
      const puritySource = safeLocker || safePurity;
      const purity = puritySource ? purityPercent(puritySource) : Number(row.querySelector('[name="sourcePurity"]').value || 0);
      return {
        weight: Number(row.querySelector('[name="sourceWeightLine"]').value || 0),
        purity,
        safePurity,
        sourceKind,
        safeLocker,
      };
    })
    .filter((metal) => metal.weight > 0 && metal.purity > 0);
}

function renderMeltingDashboard() {
  const records = state.melting || [];
  const totals = records.reduce((acc, item) => {
    const type = meltingBatchType(item);
    const issuedWeight = Number(item.finalWeight || item.sourceWeight || 0);
    const receivedWeight = Number(item.receivedWeight || 0);
    const loss = Number(item.meltingLoss || 0);
    acc.total += 1;
    acc.issuedWeight = Number(weight3(acc.issuedWeight + issuedWeight));
    if ((item.status || "Issued") === "Received") {
      acc.received += 1;
      acc.receivedWeight = Number(weight3(acc.receivedWeight + receivedWeight));
      acc.loss = Number(weight3(acc.loss + loss));
      acc.lossFineGold = Number(weight3(acc.lossFineGold + fineGoldWeight(loss, item.targetPurity)));
      if (type === "MELTING") acc.meltingLoss = Number(weight3(acc.meltingLoss + loss));
      else acc.castingLoss = Number(weight3(acc.castingLoss + loss));
    } else {
      acc.pending += 1;
      acc.inHand = Number(weight3(acc.inHand + issuedWeight));
      if (type === "MELTING") {
        acc.meltingInHand = Number(weight3(acc.meltingInHand + issuedWeight));
        acc.meltingPending += 1;
      } else {
        acc.castingInHand = Number(weight3(acc.castingInHand + issuedWeight));
        acc.castingPending += 1;
      }
    }
    return acc;
  }, {
    total: 0,
    pending: 0,
    meltingPending: 0,
    castingPending: 0,
    received: 0,
    issuedWeight: 0,
    receivedWeight: 0,
    inHand: 0,
    meltingInHand: 0,
    castingInHand: 0,
    loss: 0,
    meltingLoss: 0,
    castingLoss: 0,
    lossFineGold: 0,
  });

  const summary = document.getElementById("melting-summary-grid");
  if (summary) {
    summary.innerHTML = `
      ${meltingSummaryCard("Metal With Melting", gram(totals.meltingInHand), [`Pending melting ${totals.meltingPending}`, `Loss booked ${gram(totals.meltingLoss)}`])}
      ${meltingSummaryCard("Metal With Casting", gram(totals.castingInHand), [`Pending casting ${totals.castingPending}`, `Loss booked ${gram(totals.castingLoss)}`])}
      ${meltingSummaryCard("Total Loss", gram(totals.loss), [`Fine gold loss ${gram(totals.lossFineGold)}`, `Received batches ${totals.received}`], "loss")}
      ${meltingSummaryCard("History", `${totals.total}`, [`Pending ${totals.pending}`, `Received NT ${gram(totals.receivedWeight)}`])}
    `;
  }

  const tiles = document.getElementById("melting-history-tiles");
  if (tiles) {
    tiles.innerHTML = records.length
      ? records.map(renderMeltingHistoryTile).join("")
      : '<div class="empty">No melting or casting history yet. Open New Melting to create first batch.</div>';
  }
}

function meltingSummaryCard(title, value, lines = [], variant = "") {
  return `
    <article class="melting-summary-card ${variant}">
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${lines.map((line) => `<small>${escapeHtml(line)}</small>`).join("")}
    </article>
  `;
}

function renderMeltingHistoryTile(item) {
  const status = item.status || "Issued";
  const isReceived = status === "Received";
  const department = meltingDashboardDepartmentName(item);
  const inHand = isReceived ? 0 : Number(item.finalWeight || item.sourceWeight || 0);
  const receivedText = isReceived
    ? `Received NT ${gram(item.receivedWeight)} / Loss ${gram(item.meltingLoss)}`
    : `Metal in hand ${gram(inHand)}`;
  return `
    <article class="melting-history-card ${isReceived ? "received" : "pending"}">
      <div>
        <span>${escapeHtml(department)}</span>
        <strong>${escapeHtml(item.batchName || assignMeltingBatchName(item))}</strong>
      </div>
      <small>${escapeHtml(item.date || "-")} / ${escapeHtml(formatPurity(item.targetPurity))} / ${escapeHtml(item.colour || "-")}</small>
      <small>${escapeHtml(receivedText)}</small>
      <div class="melting-history-card-footer">
        <span class="status ${statusClass(status)}">${escapeHtml(status)}</span>
        ${renderMeltingActionButtons(item)}
      </div>
    </article>
  `;
}

function renderMelting() {
  renderMeltingDashboard();
}

function renderMeltingActionButtons(item) {
  const isReceived = (item.status || "Issued") === "Received";
  return `
    <div class="row-actions melting-actions">
      <button class="ghost-button" type="button" onclick="openMeltingView('${item.id}')">View</button>
      <button class="ghost-button" type="button" onclick="openMeltingIssueEdit('${item.id}')">Edit Issue</button>
      <button type="button" onclick="openMeltingReceive('${item.id}')">${isReceived ? "Edit Receive" : "Receive"}</button>
      <button class="delete-btn" type="button" onclick="deleteMeltingEntry('${item.id}')">Delete</button>
    </div>
  `;
}

function scrollToMeltingConversion() {
  resetMeltingIssueForm();
  openOperationPage("melting", "conversion");
  document.getElementById("melting-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function scrollToMeltingHistoryTiles() {
  openOperationPage("melting", "history");
  document.querySelector(".melting-history-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderMeltingSources(item) {
  const metals = item.sourceMetals?.length
    ? item.sourceMetals
    : [{ weight: item.sourceWeight, purity: item.sourcePurity }];
  return metals.map((metal) => {
    const sourceText = metal.sourceKind === "rod" && metal.safeLocker
      ? `Rod ${safeLockerForPurity(metal.safeLocker)} Safe`
      : metal.sourceKind === "wastage" && metal.safeLocker
        ? `Wastage ${safeLockerForPurity(metal.safeLocker)} Safe`
      : metal.safePurity
        ? `Metal Safe ${normalizeMetalSafePurity(metal.safePurity)}`
        : "Manual";
    return `${gram(metal.weight)} @ ${formatPurity(metal.purity)}<br><small>${escapeHtml(sourceText)}</small>`;
  }).join("<br>");
}

function meltingReceivedCell(item) {
  const breakup = item.receiveBreakup || {};
  const title = item.receiveBreakup ? meltingReceiveBreakupText(breakup) : "";
  const grossWeight = item.grossReceivedWeight ?? meltingReceiveGrossWeight(breakup, item);
  const waxStoneWeight = meltingReceiveWaxStoneWeight(breakup);
  return `<span title="${escapeHtml(title)}">NT ${gram(item.receivedWeight)}<br><small>GW ${gram(grossWeight)} / Wax ${gram(waxStoneWeight)}</small></span>`;
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
  if (typeof value === "string") {
    const text = value.trim().toUpperCase();
    if (text.includes("K")) {
      return (Number(text.replace("K", "")) / 24) * 100;
    }
    return Number(text.replace("%", "") || 0);
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
        <td>${escapeHtml(departmentProcessText(karigar))}</td>
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
  form.speciality.value = departmentProcessText(department);
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
      lot.currentDepartment = primaryDepartmentProcess(department);
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
        ? `${lot.number} gold issue ${lot.issueSourceName || lotIssueSourceName(lot)} ${lot.karigarName || ""} ${lot.currentDepartment || ""}`.toLowerCase()
        : `${lot.number} ${transfer.fromDepartment || ""} ${transfer.toDepartment || ""} ${transfer.fromKarigarName || ""} ${transfer.toKarigarName || ""} ${transfer.reason || ""}`.toLowerCase();
      return text.includes(query);
    })
    .map(renderTransferHistoryRow)
    .join("");
  const content = rows || tableEmpty(14, "No transfer history recorded.");
  document.getElementById("transfer-history-table").innerHTML = content;
  document.getElementById("production-transfer-table").innerHTML = content;
}

function renderDepartmentTransferHistoryBoard() {
  const grid = document.getElementById("department-transfer-grid");
  if (!grid) return;
  const query = (document.getElementById("department-transfer-search")?.value || "").trim().toLowerCase();
  const departments = departmentTransferSummaries()
    .filter((department) => !query || `${department.name} ${department.detail}`.toLowerCase().includes(query));
  grid.innerHTML = departments.length
    ? departments.map(renderDepartmentTransferTile).join("")
    : '<div class="empty">No department transfer history recorded.</div>';
}

function renderDepartmentTransferTile(department) {
  return `
    <button class="department-transfer-tile" type="button" onclick="openDepartmentTransferHistory(decodeURIComponent('${encodeURIComponent(department.name)}'))">
      <span>${escapeHtml(department.name)}</span>
      <strong>${department.inCount} IN / ${department.outCount} OUT</strong>
      <div>
        <small><b>IN GW</b>${gram(department.inGw)}</small>
        <small><b>OUT GW</b>${gram(department.outGw)}</small>
        <small><b>Reduced</b>${gram(department.difference)}</small>
        <small><b>Fine</b>${gram(department.fineGold)}</small>
      </div>
      ${department.detail ? `<em>${escapeHtml(department.detail)}</em>` : ""}
    </button>
  `;
}

function openDepartmentTransferHistory(departmentName) {
  const dialog = document.getElementById("department-transfer-dialog");
  if (!dialog) return;
  const events = departmentTransferEvents().filter((event) => event.department === departmentName);
  const inRows = events.filter((event) => event.direction === "in");
  const outRows = events.filter((event) => event.direction === "out");
  const summary = departmentTransferSummaryFromEvents(departmentName, events);
  document.getElementById("department-transfer-title").textContent = `${departmentName} Transfer History`;
  document.getElementById("department-transfer-summary").textContent =
    `${summary.inCount} inward entries and ${summary.outCount} outward entries. Difference and fine are counted when item goes out from this department.`;
  document.getElementById("department-transfer-total-cards").innerHTML = renderDepartmentTransferTotals(summary);
  document.getElementById("department-transfer-in-table").innerHTML =
    inRows.length ? inRows.map((event) => renderDepartmentTransferRow(event, "in")).join("") : tableEmpty(8, "No inward entries for this department.");
  document.getElementById("department-transfer-out-table").innerHTML =
    outRows.length ? outRows.map((event) => renderDepartmentTransferRow(event, "out")).join("") : tableEmpty(8, "No outward entries for this department.");
  if (!dialog.open) dialog.showModal();
}

function renderDepartmentTransferTotals(summary) {
  return [
    factorySummaryCard("Total IN GW", gram(summary.inGw), `${summary.inCount} inward entries`),
    factorySummaryCard("Total OUT GW", gram(summary.outGw), `${summary.outCount} outward entries`),
    factorySummaryCard("IN Net Wt", gram(summary.inNet), "Net weight received in department"),
    factorySummaryCard("OUT Net Wt", gram(summary.outNet), "Net weight moved out"),
    factorySummaryCard("Total Reduced", gram(summary.difference), "Difference booked to this department", summary.difference ? "payable" : ""),
    factorySummaryCard("Fine Gold Reduced", gram(summary.fineGold), "Fine gold of department difference", summary.fineGold ? "receivable" : ""),
  ].join("");
}

function departmentTransferSummaries() {
  const summaries = new Map();
  (state.karigars || []).forEach((department) => {
    const groupName = departmentTransferGroupName(department.name, primaryDepartmentProcess(department));
    const summary = ensureDepartmentTransferSummary(summaries, groupName);
    summary.details.add(department.name || groupName);
    departmentProcesses(department).forEach((process) => summary.details.add(process));
  });
  departmentTransferEvents().forEach((event) => {
    const summary = ensureDepartmentTransferSummary(summaries, event.department);
    if (event.departmentDetail) summary.details.add(event.departmentDetail);
    if (event.direction === "in") {
      summary.inCount += 1;
      summary.inGw = Number(weight3(summary.inGw + Number(event.receiveGw || 0)));
      summary.inNet = Number(weight3(summary.inNet + Number(event.netWeight || 0)));
    } else {
      summary.outCount += 1;
      summary.outGw = Number(weight3(summary.outGw + Number(event.issueGw || 0)));
      summary.outNet = Number(weight3(summary.outNet + Number(event.netWeight || 0)));
      summary.difference = Number(weight3(summary.difference + Number(event.difference || 0)));
      summary.fineGold = Number(weight3(summary.fineGold + Number(event.fineGold || 0)));
    }
  });
  return [...summaries.values()]
    .map((summary) => ({
      ...summary,
      detail: [...summary.details].filter((item) => item && item !== summary.name).slice(0, 4).join(" / "),
    }))
    .filter((summary) => summary.inCount || summary.outCount || summary.detail)
    .sort((a, b) => (b.inCount + b.outCount) - (a.inCount + a.outCount) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function departmentTransferSummaryFromEvents(name, events = []) {
  const summaries = new Map();
  const summary = ensureDepartmentTransferSummary(summaries, name);
  events.forEach((event) => {
    if (event.direction === "in") {
      summary.inCount += 1;
      summary.inGw = Number(weight3(summary.inGw + Number(event.receiveGw || 0)));
      summary.inNet = Number(weight3(summary.inNet + Number(event.netWeight || 0)));
    } else {
      summary.outCount += 1;
      summary.outGw = Number(weight3(summary.outGw + Number(event.issueGw || 0)));
      summary.outNet = Number(weight3(summary.outNet + Number(event.netWeight || 0)));
      summary.difference = Number(weight3(summary.difference + Number(event.difference || 0)));
      summary.fineGold = Number(weight3(summary.fineGold + Number(event.fineGold || 0)));
    }
  });
  return summary;
}

function ensureDepartmentTransferSummary(map, name) {
  const key = name || "Unassigned";
  if (!map.has(key)) {
    map.set(key, { name: key, detail: "", details: new Set(), inCount: 0, outCount: 0, inGw: 0, outGw: 0, inNet: 0, outNet: 0, difference: 0, fineGold: 0 });
  }
  return map.get(key);
}

function departmentTransferEvents() {
  const events = [];
  let sortIndex = 0;
  state.lots.forEach((lot) => {
    const issueGw = Number(lot.grossIssuedWeight || (Number(lot.issuedWeight || 0) + Number(lot.waxStoneWeight || 0)));
    if (lot.issueDate || issueGw > 0) {
      const firstDepartment = lot.issueKarigarName || lot.karigarName || lot.issueDepartment || lot.currentDepartment || "Unassigned";
      const firstProcess = lot.issueDepartment || lot.currentDepartment || firstDepartment;
      const sourceName = lot.issueSourceName || lotIssueSourceName(lot);
      events.push({
        id: `${lot.id}-issue-in`,
        sortIndex: sortIndex++,
        direction: "in",
        type: "Gold Issue",
        department: departmentTransferGroupName(firstDepartment, firstProcess),
        departmentDetail: departmentTransferDetail(firstDepartment, firstProcess),
        date: lot.issueDate || "-",
        lotNumber: lot.number || "-",
        counterparty: sourceName,
        process: firstProcess,
        issueGw,
        receiveGw: issueGw,
        netWeight: Number(lot.issuedWeight || 0),
        difference: 0,
        fineGold: 0,
        purity: lot.metalPurity || getLotOrders(lot)[0]?.purity || "",
        remarks: `Gold issued from ${sourceName}${Number(lot.waxStoneWeight || 0) ? `; Wax Stone ${gram(lot.waxStoneWeight)}` : ""}`,
      });
    }
    (lot.transfers || []).forEach((transfer) => {
      const fromDepartment = transfer.fromKarigarName || transfer.fromDepartment || "Unassigned";
      const fromProcess = transfer.fromDepartment || fromDepartment;
      const toDepartment = transfer.toKarigarName || transfer.toDepartment || "Unassigned";
      const toProcess = transfer.toDepartment || toDepartment;
      const common = {
        id: transfer.id || `${lot.id}-${sortIndex}`,
        sortIndex: sortIndex++,
        type: "Transfer",
        date: transfer.date || "-",
        lotNumber: lot.number || "-",
        issueGw: Number(transfer.transferWeight || 0),
        receiveGw: Number(transfer.grossReceivedWeight || 0),
        netWeight: Number(transfer.receivedWeight || 0),
        difference: Number(transfer.departmentBalance || 0),
        fineGold: transferFineGold(transfer, lot),
        purity: transfer.differencePurity || lot.metalPurity || getLotOrders(lot)[0]?.purity || "",
        remarks: transfer.reason || "-",
      };
      events.push({
        ...common,
        direction: "out",
        department: departmentTransferGroupName(fromDepartment, fromProcess),
        departmentDetail: departmentTransferDetail(fromDepartment, fromProcess),
        counterparty: departmentTransferDetail(toDepartment, toProcess),
        process: fromProcess,
      });
      events.push({
        ...common,
        id: `${common.id}-in`,
        direction: "in",
        department: departmentTransferGroupName(toDepartment, toProcess),
        departmentDetail: departmentTransferDetail(toDepartment, toProcess),
        counterparty: departmentTransferDetail(fromDepartment, fromProcess),
        process: toProcess,
      });
    });
  });
  return events.sort((a, b) => b.sortIndex - a.sortIndex);
}

function departmentTransferGroupName(departmentName = "", processName = "") {
  const combined = `${processName || ""} ${departmentName || ""}`;
  if (textMatchesAny(combined, ["filer", "filing", "fitting", "back to filer", "vinod"])) return "Filing / Fitting";
  if (isPrePolishDepartment(combined) || isPolishDepartment(combined)) return "Pre Polish / Polish";
  return departmentDashboardHeader(processName || departmentName || "Unassigned");
}

function departmentTransferDetail(departmentName = "", processName = "") {
  const department = String(departmentName || "").trim();
  const process = String(processName || "").trim();
  if (!department) return process || "-";
  if (!process || department.toLowerCase() === process.toLowerCase()) return department;
  return `${department} / ${process}`;
}

function renderDepartmentTransferRow(event, direction) {
  const gw = direction === "in" ? event.receiveGw : event.issueGw;
  const difference = direction === "out" ? gram(event.difference) : "-";
  const fineGold = direction === "out" ? gram(event.fineGold) : "-";
  return `
    <tr>
      <td>${escapeHtml(event.date || "-")}</td>
      <td><button class="link-button" type="button" onclick="openLotHistoryByNumber(decodeURIComponent('${encodeURIComponent(event.lotNumber)}'))">${escapeHtml(event.lotNumber || "-")}</button></td>
      <td>${escapeHtml(event.counterparty || "-")}<br><small>${escapeHtml(event.process || "")}</small></td>
      <td>${gram(gw)}</td>
      <td>${gram(event.netWeight)}</td>
      <td>${difference}</td>
      <td>${fineGold}</td>
      <td>${escapeHtml(event.remarks || "-")}</td>
    </tr>
  `;
}

function openLotHistoryByNumber(lotNumber) {
  const lot = state.lots.find((item) => item.number === lotNumber);
  if (!lot) return;
  const departmentDialog = document.getElementById("department-transfer-dialog");
  if (departmentDialog?.open) departmentDialog.close();
  openLotHistory(lot.id);
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
    const sourceName = lot.issueSourceName || lotIssueSourceName(lot);
    const firstDepartment = lot.issueDepartment || lot.currentDepartment || lot.karigarName || "-";
    return `
      <tr>
        <td>${escapeHtml(transfer.date || "-")}</td>
        <td>${escapeHtml(lot.number)}</td>
        <td>${escapeHtml(sourceName)} to ${escapeHtml(firstDepartment)}</td>
        <td>${escapeHtml(sourceName)} to ${escapeHtml(transfer.toKarigarName || firstDepartment)}</td>
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
      reason: `Gold issued from ${lot.issueSourceName || lotIssueSourceName(lot)} to ${lot.currentDepartment || lot.karigarName || "-"}${Number(lot.waxStoneWeight || 0) ? `; Gold Issue - Wax Stone = Net Wt, Wax Stone ${gram(lot.waxStoneWeight)}` : ""}`,
    },
  };
}

function lotIssueSourceName(lot = {}) {
  return lot.issueSourceName || `SHELF${safeLockerForPurity(lot.issueSourceLocker || lot.metalPurity || getLotOrders(lot)[0]?.purity || "18K")}`;
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
  const sourceName = lotIssueSourceName(lot);
  const firstDepartment = lot.issueDepartment || lot.currentDepartment || lot.karigarName || "-";
  return `
    <tr>
      <td>1</td>
      <td>${escapeHtml(lot.issueDate || "-")}</td>
      <td>${escapeHtml(sourceName)} to ${escapeHtml(firstDepartment)}</td>
      <td>${escapeHtml(sourceName)} to ${escapeHtml(lot.karigarName || firstDepartment)}</td>
      <td>${gram(issueGw)}</td>
      <td>${gram(issueGw)}</td>
      <td>${gram(waxStone)}</td>
      <td>${gram(0)}</td>
      <td>${gram(waxStone)}</td>
      <td>${gram(lot.issuedWeight)}</td>
      <td>-</td>
      <td>${escapeHtml(displayPurity(lot.metalPurity || "-"))}</td>
      <td>${gram(0)}</td>
      <td>${escapeHtml(`${sourceName}; Purity ${lot.metalPurity || "-"}; Gold Issue - Wax Stone = Net Wt`)}</td>
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
  const isRodReceive = isMeltingDepartmentReceive(melting);
  document.getElementById("melting-receive-title").textContent = melting.status === "Received" ? "Edit Melting Receive" : "Receive Melting";
  form.meltingId.value = melting.id;
  form.finalWeight.value = weight3(melting.finalWeight);
  form.castingItemWeight.value = weight3(isRodReceive ? 0 : (breakup.castingItemWeight ?? defaultItemWeight));
  form.castingWaxStoneWeight.value = weight3(isRodReceive ? 0 : (breakup.castingWaxStoneWeight ?? breakup.waxStoneWeight ?? 0));
  form.castingItemNetWeight.value = weight3(isRodReceive ? 0 : safeItemNetFromGross(form.castingItemWeight.value, form.castingWaxStoneWeight.value));
  form.treeCutWeight.value = weight3(breakup.treeCutWeight);
  form.wastageWeight.value = weight3(breakup.wastageWeight);
  form.scrapDustWeight.value = weight3(breakup.scrapDustWeight);
  form.otherReceivedWeight.value = weight3(breakup.otherReceivedWeight);
  form.rod1Weight.value = weight3(isRodReceive ? (breakup.rod1Weight ?? breakup.castingItemWeight ?? defaultItemWeight) : breakup.rod1Weight);
  form.rod2Weight.value = weight3(breakup.rod2Weight);
  form.wastage1Weight.value = weight3(breakup.wastage1Weight ?? (isRodReceive ? breakup.wastageWeight : 0));
  form.wastage2Weight.value = weight3(breakup.wastage2Weight);
  toggleMeltingReceiveMode(isRodReceive);
  document.getElementById("melting-receive-summary").textContent =
    `${melting.date} / ${melting.departmentName || "Department"} / ${formatPurity(melting.targetPurity)} ${melting.colour}`;
  updateMeltingReceiveLoss();
  document.getElementById("melting-receive-dialog").showModal();
}

function openMeltingIssueEdit(meltingId) {
  const melting = findById("melting", meltingId);
  if (!melting) return;
  openOperationPage("melting", "conversion");
  const form = document.getElementById("melting-form");
  form.meltingId.value = melting.id;
  document.getElementById("melting-sources").innerHTML = "";
  cloneMeltingSourceMetals(melting.sourceMetals).forEach((metal) => {
    addMeltingSourceRow(
      weight3(metal.weight),
      weight3(metal.purity).replace(/\.000$/, ""),
      "bottom",
      false,
      metal.sourceKind,
      metal.safePurity,
      metal.safeLocker
    );
  });
  if (!document.querySelectorAll("#melting-sources .source-row").length) addMeltingSourceRow();
  form.targetPurity.value = weight3(melting.targetPurity).replace(/\.000$/, "");
  form.colour.value = melting.colour || "Yellow";
  form.meltingDepartmentId.value = meltingDepartmentOptionValue(melting);
  updateMeltingCalculation();
  document.getElementById("melting-form-title").textContent = "Edit Melting Issue";
  document.getElementById("melting-submit").textContent = "Update Melting Issue";
  document.getElementById("cancel-melting-issue-edit").classList.remove("hidden");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function meltingDepartmentOptionValue(melting = {}) {
  const text = `${melting.departmentName || ""} ${melting.departmentId || ""}`.toLowerCase();
  if (text.includes("melting")) return "Melting Department";
  return "Casting Department";
}

function parseAppDate(value = "") {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function batchDateLabel(value = today()) {
  const date = parseAppDate(value);
  const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  return `${date.getDate()}${months[date.getMonth()]}${date.getFullYear()}`;
}

function batchColourLabel(colour = "") {
  return String(colour || "MIXED").toUpperCase().replace(/[^A-Z0-9]/g, "") || "MIXED";
}

function meltingBatchType(melting = {}) {
  return meltingDepartmentOptionValue(melting) === "Melting Department" ? "MELTING" : "CASTING";
}

function meltingBatchDateValue(melting = {}) {
  return meltingBatchType(melting) === "CASTING" && melting.receivedDate ? melting.receivedDate : melting.date || today();
}

function meltingBatchSequenceFromName(name = "") {
  const match = String(name || "").match(/\/(\d+)\//);
  return match ? Number(match[1]) : 0;
}

function assignMeltingBatchName(melting, collection = state.melting, force = false) {
  if (!melting) return "";
  if (melting.batchName && !force) return melting.batchName;
  const type = meltingBatchType(melting);
  const colour = batchColourLabel(melting.colour);
  const dateText = batchDateLabel(meltingBatchDateValue(melting));
  const prefix = `${colour}${type}`;
  const existingSequence = meltingBatchSequenceFromName(melting.batchName);
  const existingSequences = (collection || [])
    .filter((item) => item.id !== melting.id)
    .filter((item) =>
      batchColourLabel(item.colour) === colour
      && meltingBatchType(item) === type
      && batchDateLabel(meltingBatchDateValue(item)) === dateText
    )
    .map((item) => meltingBatchSequenceFromName(item.batchName))
    .filter((sequence) => sequence > 0);
  const sequence = existingSequence || (existingSequences.length ? Math.max(...existingSequences) + 1 : 1);
  melting.batchName = `${prefix}/${sequence}/${dateText}`;
  return melting.batchName;
}

function openMeltingView(meltingId) {
  const melting = findById("melting", meltingId);
  if (!melting) return;
  const breakup = melting.receiveBreakup || {};
  document.getElementById("melting-view-summary").textContent =
    `${melting.batchName || assignMeltingBatchName(melting)} / ${melting.date} / ${melting.departmentName || "Department"} / ${formatPurity(melting.targetPurity)} ${melting.colour}`;
  document.getElementById("melting-view-body").innerHTML = `
    <article class="history-item">
      <div class="history-step">1</div>
      <div class="history-body">
        <div class="history-title"><strong>Source & Issue</strong><span>${escapeHtml(melting.status || "Issued")}</span></div>
        <div class="history-grid">
          <span><b>Batch Name</b>${escapeHtml(melting.batchName || assignMeltingBatchName(melting))}</span>
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
          ${meltingReceiveBreakupDetailHtml(melting)}
          <span><b>Full GW Received</b>${gram(melting.grossReceivedWeight ?? meltingReceiveGrossWeight(breakup, melting))}</span>
          <span><b>Wax Stone</b>${gram(meltingReceiveWaxStoneWeight(breakup))}</span>
          <span><b>Gold / NT Received</b>${gram(melting.receivedWeight)}</span>
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
  const melting = findById("melting", form?.meltingId?.value);
  const isRodReceive = isMeltingDepartmentReceive(melting);
  const grossReceivedWeight = meltingReceiveWeightFields()
    .reduce((total, field) => total + Number(form[field].value || 0), 0);
  const castingItemWeight = isRodReceive ? 0 : Number(form.castingItemWeight.value || 0);
  const waxStoneWeight = isRodReceive ? 0 : Number(form.castingWaxStoneWeight.value || 0);
  const castingItemNetWeight = safeItemNetFromGross(castingItemWeight, waxStoneWeight);
  if (form.castingItemNetWeight) form.castingItemNetWeight.value = weight3(castingItemNetWeight);
  const receivedWeight = isRodReceive ? grossReceivedWeight : Number(weight3(grossReceivedWeight - Math.min(waxStoneWeight, castingItemWeight)));
  form.receivedWeight.value = weight3(receivedWeight);
  form.meltingLoss.value = weight3(Math.max(finalWeight - receivedWeight, 0));
}

function allMeltingReceiveWeightFields() {
  return [
    "castingItemWeight",
    "castingWaxStoneWeight",
    "treeCutWeight",
    "wastageWeight",
    "scrapDustWeight",
    "otherReceivedWeight",
    "rod1Weight",
    "rod2Weight",
    "wastage1Weight",
    "wastage2Weight",
  ];
}

function meltingReceiveWeightFields() {
  const melting = findById("melting", document.getElementById("melting-receive-form")?.meltingId?.value);
  return isMeltingDepartmentReceive(melting)
    ? ["rod1Weight", "rod2Weight", "wastage1Weight", "wastage2Weight"]
    : ["castingItemWeight", "treeCutWeight", "wastageWeight", "scrapDustWeight", "otherReceivedWeight"];
}

function meltingReceiveGrossWeight(breakup = {}, melting = {}) {
  const fields = isMeltingDepartmentReceive(melting)
    ? ["rod1Weight", "rod2Weight", "wastage1Weight", "wastage2Weight"]
    : ["castingItemWeight", "treeCutWeight", "wastageWeight", "scrapDustWeight", "otherReceivedWeight"];
  return Number(weight3(fields.reduce((total, field) => total + Number(breakup[field] || 0), 0)));
}

function meltingReceiveWaxStoneWeight(breakup = {}) {
  return Number(weight3(breakup.castingWaxStoneWeight ?? breakup.waxStoneWeight ?? 0));
}

function meltingReceiveNetWeight(breakup = {}, melting = {}) {
  return Number(weight3(Math.max(meltingReceiveGrossWeight(breakup, melting) - meltingReceiveWaxStoneWeight(breakup), 0)));
}

function getMeltingReceiveBreakup(data, melting = {}) {
  if (isMeltingDepartmentReceive(melting)) {
    return {
      rod1Weight: Number(data.rod1Weight || 0),
      rod2Weight: Number(data.rod2Weight || 0),
      wastage1Weight: Number(data.wastage1Weight || 0),
      wastage2Weight: Number(data.wastage2Weight || 0),
      castingItemWeight: 0,
      castingWaxStoneWeight: 0,
      castingItemNetWeight: 0,
      treeCutWeight: 0,
      wastageWeight: 0,
      scrapDustWeight: 0,
      otherReceivedWeight: 0,
    };
  }
  return {
    rod1Weight: 0,
    rod2Weight: 0,
    wastage1Weight: 0,
    wastage2Weight: 0,
    castingItemWeight: Number(data.castingItemWeight || 0),
    castingWaxStoneWeight: Number(data.castingWaxStoneWeight || 0),
    castingItemNetWeight: safeItemNetFromGross(data.castingItemWeight, data.castingWaxStoneWeight),
    treeCutWeight: Number(data.treeCutWeight || 0),
    wastageWeight: Number(data.wastageWeight || 0),
    scrapDustWeight: Number(data.scrapDustWeight || 0),
    otherReceivedWeight: Number(data.otherReceivedWeight || 0),
  };
}

function meltingReceiveBreakupText(breakup) {
  if (Number(breakup.rod1Weight || breakup.rod2Weight || breakup.wastage1Weight || breakup.wastage2Weight)) {
    return [
      `rod 1 ${gram(breakup.rod1Weight)}`,
      `rod 2 ${gram(breakup.rod2Weight)}`,
      `wastage 1 ${gram(breakup.wastage1Weight)}`,
      `wastage 2 ${gram(breakup.wastage2Weight)}`,
    ].join(", ");
  }
  return [
    `item ${gram(breakup.castingItemWeight)}`,
    `wax stone ${gram(meltingReceiveWaxStoneWeight(breakup))}`,
    `item net ${gram(breakup.castingItemNetWeight ?? safeItemNetFromGross(breakup.castingItemWeight, meltingReceiveWaxStoneWeight(breakup)))}`,
    `tree ${gram(breakup.treeCutWeight)}`,
    `wastage ${gram(breakup.wastageWeight)}`,
    `scrap/dust ${gram(breakup.scrapDustWeight)}`,
    `other ${gram(breakup.otherReceivedWeight)}`,
  ].join(", ");
}

function meltingReceiveBreakupDetailHtml(melting) {
  const breakup = melting.receiveBreakup || {};
  if (isMeltingDepartmentReceive(melting)) {
    return `
      <span><b>Rod 1</b>${gram(breakup.rod1Weight ?? breakup.castingItemWeight)}</span>
      <span><b>Rod 2</b>${gram(breakup.rod2Weight)}</span>
      <span><b>Wastage 1</b>${gram(breakup.wastage1Weight ?? breakup.wastageWeight)}</span>
      <span><b>Wastage 2</b>${gram(breakup.wastage2Weight)}</span>
    `;
  }
  return `
    <span><b>Casting Item</b>${gram(breakup.castingItemWeight)}</span>
    <span><b>Wax Set Stone</b>${gram(meltingReceiveWaxStoneWeight(breakup))}</span>
    <span><b>Casting Item NT</b>${gram(breakup.castingItemNetWeight ?? safeItemNetFromGross(breakup.castingItemWeight, meltingReceiveWaxStoneWeight(breakup)))}</span>
    <span><b>Tree Cut</b>${gram(breakup.treeCutWeight)}</span>
    <span><b>Wastage Received</b>${gram(breakup.wastageWeight)}</span>
    <span><b>Scrap / Dust</b>${gram(breakup.scrapDustWeight)}</span>
    <span><b>Other Received</b>${gram(breakup.otherReceivedWeight)}</span>
  `;
}

function isMeltingDepartmentReceive(melting = {}) {
  return meltingDepartmentOptionValue(melting) === "Melting Department";
}

function toggleMeltingReceiveMode(isRodReceive) {
  document.querySelectorAll(".melting-receive-casting").forEach((field) => field.classList.toggle("hidden", isRodReceive));
  document.querySelectorAll(".melting-receive-rod").forEach((field) => field.classList.toggle("hidden", !isRodReceive));
}

function meltingDepartment(name) {
  const selectedName = name || "Casting Department";
  const existing = state.karigars.find((department) =>
    department.name.toLowerCase() === selectedName.toLowerCase()
    || department.speciality.toLowerCase() === selectedName.replace(" Department", "").toLowerCase()
  );
  return existing || { id: selectedName, name: selectedName };
}

function seedMetalSafeFromLedger(currentState) {
  if (currentState.metalSafeSeededFromLedger) return;
  const existingSources = new Set((currentState.metalSafeMovements || []).map((movement) => movement.sourceId).filter(Boolean));
  (currentState.ledger || []).forEach((entry, index) => {
    const type = String(entry.type || "");
    const normalizedType = type.toLowerCase();
    if (!["in", "melt issue"].includes(normalizedType)) return;
    const sourceId = entry.id || `ledger-${index}-${entry.date || ""}-${type}`;
    if (existingSources.has(sourceId)) return;
    currentState.metalSafeMovements.unshift({
      id: crypto.randomUUID(),
      date: entry.date || today(),
      type: normalizedType === "in" ? "Office In" : "Melt Issue",
      direction: normalizedType === "in" ? "in" : "out",
      purity: entry.purity || "",
      weight: Number(entry.weight || 0),
      reference: entry.reference || "Migrated from raw gold ledger",
      sourceType: "ledger-migration",
      sourceId,
    });
  });
  currentState.metalSafeSeededFromLedger = true;
}

function normalizeState(currentState) {
  currentState.factoryResetAt = currentState.factoryResetAt || "";
  currentState.factoryResetReason = currentState.factoryResetReason || "";
  currentState.nextOrder = currentState.nextOrder || 1004;
  currentState.nextLot = currentState.nextLot || 204;
  currentState.userPasswords = { ...defaultUserPasswords, ...(currentState.userPasswords || {}) };
  currentState.customUsers = (currentState.customUsers || []).map((user) => ({
    id: normalizeLoginUserId(user.id),
    name: user.name || user.id || "User",
    role: user.role || "custom",
    pages: Array.isArray(user.pages) ? user.pages.filter((page) => loginAccessPages.includes(page)) : ["dashboard"],
    canEditOfficeWeights: Boolean(user.canEditOfficeWeights),
  })).filter((user) => user.id && !users[user.id]);
  currentState.userAccessOverrides = Object.fromEntries(Object.entries(currentState.userAccessOverrides || {}).map(([id, override]) => [
    id,
    {
      name: override.name || users[id]?.name || id,
      pages: Array.isArray(override.pages) ? override.pages.filter((page) => loginAccessPages.includes(page)) : users[id]?.pages || [],
      canEditOfficeWeights: override.canEditOfficeWeights ?? users[id]?.canEditOfficeWeights ?? false,
    },
  ]).filter(([id]) => users[id] && id !== "owner"));
  currentState.customers = currentState.customers || [];
  currentState.officeCustomers = currentState.officeCustomers || [];
  currentState.vendors = (currentState.vendors || []).map((vendor) => ({
    id: vendor.id || crypto.randomUUID(),
    name: vendor.name || "Vendor",
    phone: vendor.phone || "",
    city: vendor.city || "",
    remarks: vendor.remarks || "",
  }));
  currentState.factoryLedger = (currentState.factoryLedger || []).map((entry) => {
    const weight = Number(weight3(entry.weight || 0));
    const purity = entry.purity || "";
    const wstgPercent = factoryWstgPercent(entry.wstgPercent ?? entry.wastagePercent);
    const baseFineGold = Number(weight3(entry.baseFineGold ?? fineGoldWeight(weight, purity)));
    const wstgFineGold = Number(weight3(entry.wstgFineGold ?? (weight * (wstgPercent / 100))));
    return {
      id: entry.id || crypto.randomUUID(),
      date: entry.date || today(),
      direction: entry.direction || (String(entry.type || "").toLowerCase().includes("out") ? "out" : "in"),
      type: entry.type || "Factory In",
      vendorId: entry.vendorId || "",
      vendorName: entry.vendorName || "",
      materialType: entry.materialType || (String(entry.type || "").toLowerCase().includes("bill") ? "bill" : "raw-metal"),
      purity,
      weight,
      wstgPercent,
      wastagePercent: wstgPercent,
      baseFineGold,
      wstgFineGold,
      fineGold: Number(weight3(baseFineGold + wstgFineGold)),
      stockPosting: entry.stockPosting || "",
      reference: entry.reference || "",
      remarks: entry.remarks || "",
      sourceType: entry.sourceType || "",
      sourceId: entry.sourceId || "",
      sourceLine: entry.sourceLine || "",
      manualFactoryEdit: Boolean(entry.manualFactoryEdit),
      editedAt: entry.editedAt || "",
    };
  });
  currentState.safeItems = (currentState.safeItems || []).map((item) => {
    const grossWeight = Number(item.grossWeight ?? item.netWeight ?? 0);
    const savedNetWeight = Number(item.netWeight ?? grossWeight);
    const waxStoneWeight = Number(weight3(item.waxStoneWeight ?? Math.max(grossWeight - savedNetWeight, 0)));
    const netWeight = Number(weight3(item.netWeight ?? safeItemNetFromGross(grossWeight, waxStoneWeight)));
    return {
      id: item.id || crypto.randomUUID(),
      date: item.date || today(),
      locker: safeLockerForPurity(item.locker || item.purity),
      purity: item.purity || item.locker || "",
      description: item.description || "",
      source: item.source || "",
      sourceType: item.sourceType || "",
      sourceId: item.sourceId || "",
      sourceLine: item.sourceLine || "",
      colour: item.colour || safeItemColour(item),
      desiredPurity: item.desiredPurity || safeItemDesiredPurity(item),
      safeKind: safeItemKind(item),
      grossWeight,
      waxStoneWeight,
      netWeight,
      status: item.status || "In Safe",
      outDate: item.outDate || "",
      remarks: item.remarks || "",
    };
  });
  currentState.metalSafeMovements = (currentState.metalSafeMovements || []).map((movement) => ({
    id: movement.id || crypto.randomUUID(),
    date: movement.date || today(),
    type: movement.type || (movement.direction === "out" ? "Out" : "In"),
    direction: movement.direction || (["out", "issue", "melt issue", "production issue", "casting issue"].some((word) => String(movement.type || "").toLowerCase().includes(word)) ? "out" : "in"),
    purity: movement.purity || "",
    weight: Number(movement.weight || 0),
    reference: movement.reference || "",
    sourceType: movement.sourceType || "",
    sourceId: movement.sourceId || "",
  })).filter((movement) =>
    movement.sourceType !== "production"
    && !String(movement.type || "").toLowerCase().includes("production issue")
  );
  const hasFactoryOpeningLedger = currentState.factoryLedger.some((entry) =>
    entry.type === "Opening Stock"
    || ["factory-default", "factory-reset"].includes(entry.sourceType)
  );
  if (!hasFactoryOpeningLedger) {
    const openingMovement = currentState.metalSafeMovements.find((movement) =>
      movement.direction === "in"
      && ["factory-default", "factory-reset"].includes(movement.sourceType)
    );
    if (openingMovement) {
      currentState.factoryLedger.push({
        id: `${openingMovement.sourceType || "factory"}-factory-ledger-${openingMovement.id}`,
        date: openingMovement.date || today(),
        direction: "in",
        type: "Opening Stock",
        vendorId: "",
        vendorName: "Opening Stock",
        materialType: "raw-metal",
        purity: openingMovement.purity || FACTORY_RESET_STOCK_PURITY,
        weight: Number(openingMovement.weight || 0),
        wstgPercent: 0,
        wastagePercent: 0,
        baseFineGold: fineGoldWeight(openingMovement.weight || 0, openingMovement.purity || FACTORY_RESET_STOCK_PURITY),
        wstgFineGold: 0,
        fineGold: fineGoldWeight(openingMovement.weight || 0, openingMovement.purity || FACTORY_RESET_STOCK_PURITY),
        stockPosting: "Metal Safe",
        reference: openingMovement.reference || "Factory opening stock",
        remarks: "",
        sourceType: openingMovement.sourceType || "factory-default",
        sourceId: openingMovement.sourceId || openingMovement.id,
        sourceLine: "",
      });
    }
  }
  currentState.bills = (currentState.bills || []).map((bill) => ({
    id: bill.id || crypto.randomUUID(),
    lotId: bill.lotId || "",
    jobNumber: bill.jobNumber || "",
    billNo: bill.billNo || "",
    billDate: bill.billDate || "",
    makingRate: 0,
    officeMakingRate: 0,
    otherCharges: 0,
    manufacturingBillAmount: 0,
    billAmount: 0,
    netWeight: Number(bill.netWeight || 0),
    makingGold: 0,
    manufacturingMakingGold: 0,
    officeMakingGold: 0,
    items: (bill.items || []).map((item) => ({
      orderId: item.orderId || "",
      productionNo: item.productionNo || "",
      purity: item.purity || "",
      finalGw: Number(item.finalGw || 0),
      bbNo: item.bbNo || item.blackBeads || "",
      bbType: normalizeBbType(item.bbType || ""),
      blackBeadsWeight: Number(item.blackBeadsWeight ?? item.bbWeight ?? 0),
      bbWeight: Number(item.blackBeadsWeight ?? item.bbWeight ?? 0),
      motiWeight: Number(item.motiWeight ?? item.mmWeight ?? 0),
      mmWeight: Number(item.motiWeight ?? item.mmWeight ?? 0),
      stoneWeight: Number(item.stoneWeight ?? item.stWeight ?? item.reducedWeight ?? 0),
      stWeight: Number(item.stoneWeight ?? item.stWeight ?? item.reducedWeight ?? 0),
      springWeight: Number(item.springWeight || 0),
      otherNonGoldWeight: Number(item.otherNonGoldWeight ?? item.otherWeight ?? 0),
      otherWeight: Number(item.otherNonGoldWeight ?? item.otherWeight ?? 0),
      reducedWeight: Number(item.reducedWeight || 0),
      netWeight: Number(item.netWeight || 0),
      makingPercent: 0,
      makingGold: 0,
      manufacturingMakingPercent: 0,
      manufacturingMakingGold: 0,
      officeMakingPercent: 0,
      officeMakingGold: 0,
      qcStatus: item.qcStatus || "Pending QC",
      qcDate: item.qcDate || "",
      officeStatus: item.qcStatus === "QC Failed" && !item.discardStatus ? "" : (item.officeStatus || ""),
      factoryStatus: item.factoryStatus || (item.officeStatus === "Office" ? "Factory Out" : "Factory In"),
      factoryOutDate: item.factoryOutDate || (item.officeStatus === "Office" ? item.qcDate || today() : ""),
      hallmarkStatus: item.hallmarkStatus || "",
      hallmarkIssueDate: item.hallmarkIssueDate || "",
      hallmarkIssueIsoDate: item.hallmarkIssueIsoDate || "",
      hallmarkReceiveDate: item.hallmarkReceiveDate || "",
      hallmarkReceiveIsoDate: item.hallmarkReceiveIsoDate || "",
      hallmarkLotNo: item.hallmarkLotNo || item.hallmarkLotNumber || "",
      hallmarkLotNumber: item.hallmarkLotNumber || item.hallmarkLotNo || "",
      hallmarkLotIssueDate: item.hallmarkLotIssueDate || "",
      hallmarkLotIssueIsoDate: item.hallmarkLotIssueIsoDate || "",
      hallmarkLotReceiveDate: item.hallmarkLotReceiveDate || "",
      hallmarkLotReceiveIsoDate: item.hallmarkLotReceiveIsoDate || "",
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
      blackBeads: item.blackBeads || item.bbNo || "",
      moti: item.moti || "",
      spring: item.spring || "",
      otherDetails: item.otherDetails || "",
      officeDetailUpdatedDate: item.officeDetailUpdatedDate || "",
      reworkLotId: item.reworkLotId || "",
      reworkLotNumber: item.reworkLotNumber || "",
      repairStatus: item.repairStatus || (item.qcStatus === "QC Failed" ? (item.reworkLotId ? "In Repair Production" : "QC Failed") : ""),
      repairStartDate: item.repairStartDate || (item.qcStatus === "QC Failed" ? item.qcDate || today() : ""),
      repairStartIsoDate: item.repairStartIsoDate || (item.qcStatus === "QC Failed" ? isoToday() : ""),
      repairIssueDate: item.repairIssueDate || "",
      repairIssueIsoDate: item.repairIssueIsoDate || "",
      repairReturnDate: item.repairReturnDate || "",
      repairReturnIsoDate: item.repairReturnIsoDate || "",
      repairCompleteDate: item.repairCompleteDate || "",
      repairCompleteIsoDate: item.repairCompleteIsoDate || "",
      repairDays: Number(item.repairDays || 0),
      repairBaseFinalGw: Number(item.repairBaseFinalGw ?? item.finalGw ?? 0),
      repairBaseNetWeight: Number(item.repairBaseNetWeight ?? item.netWeight ?? 0),
      repairLastLoss: Number(item.repairLastLoss || 0),
      repairAdditionalLoss: Number(item.repairAdditionalLoss || 0),
      discardStatus: item.discardStatus || "",
      discardDate: item.discardDate || "",
      discardReason: item.discardReason || "",
      discardMeltingId: item.discardMeltingId || "",
    })),
    remarks: bill.remarks || "",
  }));
  currentState.designs = (currentState.designs || []).map((design) => {
    const stoneItems = (design.stoneItems || []).map((item) => ({
      id: item.id || crypto.randomUUID(),
      itemKey: normalizeStoneItemKey(item.itemKey),
      stoneType: item.stoneType || "",
      shape: item.shape || "",
      size: item.size || "",
      code: item.code || stoneLookupCode(item),
      pcs: Number(item.pcs || 0),
      weightPerPc: formatStoneWeight(item.weightPerPc),
      totalWeight: item.totalWeight || totalStoneWeight(item.weightPerPc, item.pcs),
    }));
    return {
      id: design.id || crypto.randomUUID(),
      number: design.number || "",
      name: design.name || "",
      category: design.category || "",
      imageData: design.imageData || "",
      stoneDetails: stoneItems.length ? designStoneDetailsText(stoneItems) : design.stoneDetails || "",
      stoneItems,
      stoneChartItems: (design.stoneChartItems?.length
        ? design.stoneChartItems
        : (design.hasStoneChart ? [{ itemKey: DEFAULT_STONE_ITEM_KEY, label: stoneItemLabel(DEFAULT_STONE_ITEM_KEY) }] : [])
      ).map((item) => ({
        itemKey: normalizeStoneItemKey(item.itemKey || item),
        label: item.label || stoneItemLabel(item.itemKey || item),
      })),
      hasStoneChartSource: Boolean(design.hasStoneChartSource),
      stoneChartSourceName: design.stoneChartSourceName || "",
      hasStoneChart: Boolean(design.hasStoneChart || design.stoneChartItems?.length),
    };
  });
  if (!Array.isArray(currentState.stones) || (!currentState.stones.length && !currentState.stoneLibrarySeeded)) {
    currentState.stones = defaultStoneLibrary();
    currentState.stoneLibrarySeeded = true;
  } else {
    currentState.stones = currentState.stones.map(normalizeStone);
    currentState.stones = mergeDefaultStoneLibrary(currentState.stones);
    currentState.stoneLibrarySeeded = true;
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
    grossReceivedWeight: Number(item.grossReceivedWeight ?? (item.receiveBreakup ? meltingReceiveGrossWeight(item.receiveBreakup, item) : item.receivedWeight) ?? 0),
    meltingLoss: Number(item.meltingLoss || 0),
    receiveBreakup: item.receiveBreakup || null,
    sourceType: item.sourceType || "",
    sourceLotId: item.sourceLotId || "",
    sourceJobNumber: item.sourceJobNumber || "",
    sourceProductionNo: item.sourceProductionNo || "",
    discardReason: item.discardReason || "",
    sourceMetals: item.sourceMetals?.length
      ? item.sourceMetals.map((metal) => ({
          weight: Number(metal.weight || 0),
          purity: purityPercent(metal.purity),
          sourceKind: metal.sourceKind || (metal.safeLocker ? "rod" : "metal"),
          safeLocker: metal.safeLocker || "",
          safePurity: metal.safePurity || "",
        }))
      : [{
          weight: Number(item.sourceWeight || 0),
          purity: purityPercent(item.sourcePurity),
          sourceKind: "metal",
          safeLocker: "",
          safePurity: "",
        }],
  }));
  currentState.melting.forEach((item) => assignMeltingBatchName(item, currentState.melting, false));
  currentState.orders = currentState.orders || [];
  currentState.orders.forEach((order) => {
    order.designId = order.designId || "";
    const design = currentState.designs.find((item) => item.id === order.designId);
    order.designNumber = design ? designText(design) : order.designNumber || "";
    order.category = order.category || design?.category || "";
    order.size = order.size || "";
    order.ringType = order.ringType || "";
    order.cmItemType = order.cmItemType || (isCmCategory(order.category) && CM_ITEM_KEYS.includes(categoryCode(order.item || "")) ? categoryCode(order.item) : defaultCmItemTypeForCategory(order.category));
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
    order.productionStoneItems = (order.productionStoneItems || []).map((item) => {
      const designStoneCandidates = designStoneItemsForOrder(design, order);
      const matchedDesignStone = designStoneCandidates.find((stoneItem) =>
        item.sourceDesignStoneId === stoneItem.id ||
        (item.code && item.code === stoneItem.code) ||
        (item.stoneType === stoneItem.stoneType && item.shape === stoneItem.shape && item.size === stoneItem.size)
      );
      const automaticSetting = automaticProductionStoneSetting(matchedDesignStone || item);
      return {
        id: item.id || crypto.randomUUID(),
        sourceDesignStoneId: item.sourceDesignStoneId || matchedDesignStone?.id || "",
        date: item.date || today(),
        settingType: item.settingType || automaticSetting.settingType,
        manufacturingStage: item.manufacturingStage || automaticSetting.manufacturingStage,
        itemKey: normalizeStoneItemKey(item.itemKey || matchedDesignStone?.itemKey),
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
        customer = { id: crypto.randomUUID(), name: order.customer, phone: "", city: "", gst: "", address: "" };
        currentState.customers.push(customer);
      }
      order.customerId = customer.id;
    }
  });
  migrateCbBothRingOrders(currentState);
  currentState.lots = (currentState.lots || []).map((lot) => normalizeLotIssueWeights(currentState, lot));
  currentState.lots.forEach((lot) => {
    const bill = currentState.bills.find((item) => item.lotId === lot.id);
    if (bill) lot.bill = bill;
  });
  syncFactoryOutLedgerForState(currentState);
  currentState.karigars = (currentState.karigars || []).map((department) => {
    const processes = departmentProcesses(department);
    return {
      ...department,
      speciality: processes.join(", "),
      processes,
    };
  });
  currentState.ledger = currentState.ledger || [];
  applyWaxStoneIssueLedgerMigration(currentState);
  seedMetalSafeFromLedger(currentState);
  return currentState;
}

function normalizeLotIssueWeights(currentState, lot) {
  const orderIds = lot.orderIds?.length ? lot.orderIds : [lot.orderId].filter(Boolean);
  const billOrderIds = lot.billOrderIds?.length
    ? lot.billOrderIds.filter((id) => orderIds.includes(id))
    : (lot.qcReturn || lot.parentLotId ? orderIds : []);
  const transfers = lot.transfers || [];
  const firstTransfer = transfers[0] || {};
  const bill = lot.bill || (currentState.bills || []).find((item) => item.lotId === lot.id);
  const productionStockWeight = bill?.items?.length
    ? billProductionStockWeight(bill)
    : lot.productionStockWeight !== undefined
      ? Number(lot.productionStockWeight || 0)
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
    orderIds,
    billOrderIds,
    issueKarigarId: lot.issueKarigarId || firstTransfer.fromKarigarId || lot.karigarId || "",
    issueKarigarName: lot.issueKarigarName || firstTransfer.fromKarigarName || lot.karigarName || "",
    issueDepartment: mergedProductionDepartmentName(lot.issueDepartment || firstTransfer.fromDepartment || lot.currentDepartment || lot.karigarName || ""),
    transfers: transfers.map((transfer) => ({
      id: transfer.id || crypto.randomUUID(),
      ...transfer,
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
    issueSourceName: lot.issueSourceName || `SHELF${safeLockerForPurity(lot.issueSourceLocker || lot.metalPurity || currentState.orders.find((order) => orderIds.includes(order.id))?.purity || "18K")}`,
    issueSourceDetail: lot.issueSourceDetail || lot.castingSafeItemDescription || "",
    issueSourceLocker: lot.issueSourceLocker || safeLockerForPurity(lot.metalPurity || currentState.orders.find((order) => orderIds.includes(order.id))?.purity || "18K"),
    actualWastage: Number(lot.actualWastage || 0),
    repairAdditionalLoss: Number(lot.repairAdditionalLoss || 0),
    wastageFineGold: Number(lot.wastageFineGold ?? fineGoldWeight(lot.actualWastage || 0, lot.wastagePurity || lot.metalPurity || currentState.orders.find((order) => orderIds.includes(order.id))?.purity || 0)),
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
  return designStoneItemsForOrder(design, order).map((item) => {
    const automaticSetting = automaticProductionStoneSetting(item);
    return {
      settingType: automaticSetting.settingType,
      itemKey: normalizeStoneItemKey(item.itemKey),
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
      id: crypto.randomUUID(),
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
  return dedupeStoneLibrary((window.KJM_STONE_LIBRARY || []).map((stone) => normalizeStone({
    ...stone,
    id: crypto.randomUUID(),
  })));
}

function normalizeStone(stone) {
  return {
    id: stone.id || crypto.randomUUID(),
    stoneType: String(stone.stoneType || "").trim(),
    shape: String(stone.shape || "").trim(),
    size: normalizeSizeText(stone.size || ""),
    code: stone.code || stoneLookupCode(stone),
    weightPerPc: formatStoneWeight(stone.weightPerPc),
    pricePerPc: stone.pricePerPc || "",
    remarks: stone.remarks || "",
  };
}

function stoneLibraryKey(stone) {
  return [
    String(stone.stoneType || "").trim().toUpperCase(),
    String(stone.shape || "").trim().toUpperCase(),
    normalizeSizeText(stone.size || "").trim().toUpperCase(),
  ].join("|");
}

function dedupeStoneLibrary(stones = []) {
  const byKey = new Map();
  stones.map(normalizeStone).forEach((stone) => {
    const key = stoneLibraryKey(stone);
    if (!key.replaceAll("|", "")) return;
    if (!byKey.has(key)) {
      byKey.set(key, stone);
      return;
    }
    const existing = byKey.get(key);
    existing.code = existing.code || stone.code || stoneLookupCode(existing);
    existing.weightPerPc = existing.weightPerPc && Number(existing.weightPerPc) > 0 ? existing.weightPerPc : stone.weightPerPc;
    existing.pricePerPc = existing.pricePerPc || stone.pricePerPc || "";
    existing.remarks = existing.remarks || stone.remarks || "";
  });
  return [...byKey.values()];
}

function mergeDefaultStoneLibrary(stones = []) {
  const merged = dedupeStoneLibrary(stones);
  const byKey = new Map(merged.map((stone) => [stoneLibraryKey(stone), stone]));
  defaultStoneLibrary().forEach((seedStone) => {
    const key = stoneLibraryKey(seedStone);
    const existing = byKey.get(key);
    if (!existing) {
      merged.push(seedStone);
      byKey.set(key, seedStone);
      return;
    }
    existing.code = existing.code || seedStone.code || stoneLookupCode(existing);
    if ((!existing.weightPerPc || Number(existing.weightPerPc) === 0) && seedStone.weightPerPc && Number(seedStone.weightPerPc) > 0) {
      existing.weightPerPc = seedStone.weightPerPc;
    }
    existing.pricePerPc = existing.pricePerPc || seedStone.pricePerPc || "";
    existing.remarks = existing.remarks || seedStone.remarks || "";
  });
  return merged.sort((a, b) => `${a.stoneType} ${a.shape} ${a.size}`.localeCompare(`${b.stoneType} ${b.shape} ${b.size}`, undefined, { numeric: true, sensitivity: "base" }));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

initializeOperationTiles();
applyLoginState();
render();
migrateLegacyDesignImages().catch(() => {
  document.getElementById("design-upload-status").textContent = "Design image storage is using browser local storage fallback.";
});
setDefaultOrderDates(document.getElementById("order-form"));
resetOrderItemRows();
resetMeltingSources();
updateMeltingCalculation();
initializeSupabase();
