(function () {
  const pageInfo = {
    dashboard: ["Dashboard", "Track orders, gold issued, production, wastage, and finished jewellery."],
    customers: ["Customers", "Add, edit, and search customer details."],
    designs: ["Designs", "Upload and view jewellery design images by category."],
    orders: ["Job Orders", "Create, open, update, transfer, complete, and print job cards."],
    production: ["Production", "Create casting batches and track production lots."],
    stock: ["Gold Stock", "Maintain gold stock by purity."],
    melting: ["Melting", "Convert source metal into target purity and record melting receive/loss."],
    karigars: ["Departments", "Manage production departments and metal in hand."],
    "transfer-history": ["Transfer History", "Online one-line history for every lot transfer."],
    reports: ["Reports", "Review wastage, making charges, and completed orders."],
  };

  function switchView(view) {
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });
    document.querySelectorAll(".view").forEach((section) => {
      section.classList.toggle("active-view", section.id === view);
    });
    const info = pageInfo[view];
    if (info) {
      const title = document.getElementById("page-title");
      const subtitle = document.getElementById("page-subtitle");
      if (title) title.textContent = info[0];
      if (subtitle) subtitle.textContent = info[1];
    }
  }

  function switchOrderPage(page) {
    document.querySelectorAll("[data-order-page]").forEach((button) => {
      button.classList.toggle("active", button.dataset.orderPage === page);
    });
    document.querySelectorAll(".order-page").forEach((section) => {
      section.classList.toggle("active-order-page", section.id === `order-page-${page}`);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.view));
    });
    document.querySelectorAll("[data-order-page]").forEach((button) => {
      button.addEventListener("click", () => switchOrderPage(button.dataset.orderPage));
    });
  });
})();
