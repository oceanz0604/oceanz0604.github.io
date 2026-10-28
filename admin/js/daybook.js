/**
 * Generic cafe day book.
 * Manual counter entries only: sessions, snacks, split payments, and cash out.
 * Stored in this browser. No PanCafe feed.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root.document !== "undefined") {
    root.CafeDaybook = api;
    const boot = () => {
      if (root.document.getElementById("daybook-app")) api.mount(root.document);
    };
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const STORAGE_KEY = "cafe-daybook-v1";
  const PAYMENT_KEYS = [
    ["gpay", "GPay"],
    ["bpay", "Bharat Pay"],
    ["debit", "Debit"],
    ["cash", "Cash"],
    ["other", "GO"],
  ];

  function round2(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  function money(value) {
    return round2(value).toFixed(2);
  }

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function monthLabel(iso) {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "";
    const mon = d.toLocaleString("en-US", { month: "short" });
    return `${mon}-${String(d.getFullYear()).slice(2)}`;
  }

  function defaultMenu() {
    return [
      { name: "Water", price: 20 },
      { name: "Pepsi", price: 20 },
      { name: "Mountain Dew", price: 20 },
      { name: "7-UP", price: 20 },
      { name: "Sting", price: 30 },
      { name: "Nimbus", price: 30 },
      { name: "Slice", price: 40 },
      { name: "Mirinda", price: 40 },
      { name: "Red Bull", price: 100 },
      { name: "Burger", price: 100 },
      { name: "Chicken", price: 300 },
    ];
  }

  function defaultState() {
    return {
      settings: {
        cafeName: "Gaming Cafe",
        openingBalance: 0,
        startNo: "",
        endNo: "",
        splitAt: 15,
        groupA: { label: "1 to 15", rates: [70, 100, 150, 300] },
        groupB: { label: "16 to 24", rates: [90, 100, 200, 400] },
        menu: defaultMenu(),
      },
      entries: [],
    };
  }

  function parseRates(text) {
    return String(text || "")
      .split(/[, ]+/)
      .map((part) => round2(part))
      .filter((n) => n > 0);
  }

  function minutesBetween(from, to) {
    const parse = (value) => {
      if (!value) return null;
      const match = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return null;
      const h = Number(match[1]);
      const m = Number(match[2]);
      if (h > 23 || m > 59) return null;
      return h * 60 + m;
    };
    const start = parse(from);
    const end = parse(to);
    if (start == null || end == null) return 0;
    let diff = end - start;
    if (diff < 0) diff += 24 * 60;
    return diff;
  }

  function ratesForComp(compNo, settings) {
    const n = Number(String(compNo || "").replace(/[^\d.]/g, ""));
    const split = Number(settings.splitAt) || 15;
    if (Number.isFinite(n) && n > split) return settings.groupB?.rates || [];
    return settings.groupA?.rates || [];
  }

  function suggestRate(compNo, settings) {
    const rates = ratesForComp(compNo, settings);
    return rates.length ? rates[0] : 0;
  }

  function productLines(entry) {
    return (entry.products || []).filter((item) => Number(item.qty) > 0);
  }

  function computeMoney(entry) {
    const extraMinutes = Math.max(0, Math.round(Number(entry.extraMinutes) || 0));
    const minutes = minutesBetween(entry.from, entry.to) + extraMinutes;
    const playAmount = round2((minutes / 60) * (Number(entry.rate) || 0));
    const products = round2(
      productLines(entry).reduce((sum, item) => sum + Number(item.qty) * Number(item.price || 0), 0)
    );
    const extra = round2(entry.extraCost);
    const discount = round2(entry.discount);
    const afterDiscount = round2(Math.max(0, playAmount + products + extra - discount));
    const payments = entry.payments || {};
    const paid = round2(PAYMENT_KEYS.reduce((sum, [key]) => sum + (Number(payments[key]) || 0), 0));
    const outgoing = round2(entry.outgoing);
    return {
      minutes,
      extraMinutes,
      playAmount,
      products,
      extra,
      discount,
      afterDiscount,
      paid,
      outgoing,
      net: round2(afterDiscount - outgoing),
    };
  }

  function sortEntries(entries) {
    return entries.slice().sort((a, b) => {
      if (a.date !== b.date) return String(a.date).localeCompare(String(b.date));
      if ((a.sr || 0) !== (b.sr || 0)) return (a.sr || 0) - (b.sr || 0);
      return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });
  }

  function withBalances(entries, openingBalance) {
    let balance = round2(openingBalance);
    return sortEntries(entries).map((entry) => {
      const moneyRow = computeMoney(entry);
      balance = round2(balance + moneyRow.net);
      return { ...entry, money: moneyRow, balance };
    });
  }

  function nextSr(entries, date) {
    const used = entries.filter((entry) => entry.date === date).map((entry) => Number(entry.sr) || 0);
    return (used.length ? Math.max(...used) : 0) + 1;
  }

  function csvCell(value) {
    const text = value == null ? "" : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function productSummary(entry) {
    return productLines(entry)
      .map((item) => `${item.name} x${item.qty}`)
      .join("; ");
  }

  function entryRows(state, dateFilter) {
    const rows = withBalances(state.entries, state.settings.openingBalance);
    if (!dateFilter || dateFilter === "all") return rows;
    return rows.filter((entry) => entry.date === dateFilter);
  }

  function ledgerHeaders() {
    return [
      "Date",
      "Sr No",
      "ID No",
      "Name",
      "Comp No",
      "From",
      "To",
      "Total Time",
      "Extra Time",
      "Rate",
      "Discount",
      "Af Disc",
      "Extra Cost",
      "Product Cost",
      "Products",
      "GPay",
      "Bharat Pay",
      "Debit",
      "Cash",
      "GO",
      "Total Paid",
      "OUT",
      "Balance",
    ];
  }

  function ledgerValues(entry) {
    const pay = entry.payments || {};
    const m = entry.money;
    return [
      entry.date,
      entry.sr,
      entry.customerId || "",
      entry.name || "",
      entry.compNo || "",
      entry.from || "",
      entry.to || "",
      m.minutes,
      m.extraMinutes,
      money(entry.rate),
      money(m.discount),
      money(m.afterDiscount),
      money(m.extra),
      money(m.products),
      productSummary(entry),
      money(pay.gpay),
      money(pay.bpay),
      money(pay.debit),
      money(pay.cash),
      money(pay.other),
      money(m.paid),
      money(m.outgoing),
      money(entry.balance),
    ];
  }

  function toCsv(state, dateFilter) {
    const settings = state.settings;
    const rows = entryRows(state, dateFilter);
    const label = !dateFilter || dateFilter === "all" ? "All dates" : monthLabel(dateFilter);
    const lines = [
      [settings.cafeName, label, "Start No", settings.startNo || "", "End No", settings.endNo || ""].map(csvCell).join(","),
      ["Comp group", settings.groupA.label, ...(settings.groupA.rates || [])].map(csvCell).join(","),
      ["Comp group", settings.groupB.label, ...(settings.groupB.rates || [])].map(csvCell).join(","),
      ["Opening balance", money(settings.openingBalance)].map(csvCell).join(","),
      [],
      ledgerHeaders().map(csvCell).join(","),
      ...rows.map((entry) => ledgerValues(entry).map(csvCell).join(",")),
    ];

    const menu = settings.menu || [];
    if (menu.length) {
      const qty = {};
      rows.forEach((entry) => {
        productLines(entry).forEach((item) => {
          qty[item.name] = (qty[item.name] || 0) + Number(item.qty);
        });
      });
      lines.push([]);
      lines.push(["Product", "Price", "Qty", "Amount"].map(csvCell).join(","));
      menu.forEach((item) => {
        const count = qty[item.name] || 0;
        lines.push([item.name, money(item.price), count, money(count * item.price)].map(csvCell).join(","));
      });
    }

    const totals = rows.reduce(
      (sum, entry) => {
        sum.after += entry.money.afterDiscount;
        sum.out += entry.money.outgoing;
        sum.paid += entry.money.paid;
        return sum;
      },
      { after: 0, out: 0, paid: 0 }
    );
    lines.push([]);
    lines.push(
      ["Entries", rows.length, "Af Disc", money(totals.after), "Paid", money(totals.paid), "OUT", money(totals.out)].map(csvCell).join(",")
    );
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  }

  function loadState() {
    const base = defaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      return {
        settings: { ...base.settings, ...(saved.settings || {}), menu: saved.settings?.menu?.length ? saved.settings.menu : base.settings.menu },
        entries: Array.isArray(saved.entries) ? saved.entries : [],
      };
    } catch (error) {
      return base;
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function mount(document) {
    const state = loadState();
    const $ = (id) => document.getElementById(id);
    let editingId = null;

    function toast(message, isError) {
      const el = $("daybook-toast");
      el.textContent = message;
      el.classList.toggle("error", !!isError);
      el.hidden = false;
      clearTimeout(toast._t);
      toast._t = setTimeout(() => {
        el.hidden = true;
      }, 2800);
    }

    function readSettingsFromForm() {
      state.settings.cafeName = $("cafe-name").value.trim() || "Gaming Cafe";
      state.settings.openingBalance = round2($("opening-balance").value);
      state.settings.startNo = $("start-no").value.trim();
      state.settings.endNo = $("end-no").value.trim();
      state.settings.splitAt = Math.max(1, Math.round(Number($("split-at").value) || 15));
      state.settings.groupA = {
        label: $("group-a-label").value.trim() || "1 to 15",
        rates: parseRates($("group-a-rates").value),
      };
      state.settings.groupB = {
        label: $("group-b-label").value.trim() || "16 to 24",
        rates: parseRates($("group-b-rates").value),
      };
      state.settings.menu = [...document.querySelectorAll("[data-menu-row]")].map((row) => ({
        name: row.querySelector("[data-menu-name]").value.trim(),
        price: round2(row.querySelector("[data-menu-price]").value),
      })).filter((item) => item.name);
    }

    function fillSettings() {
      const s = state.settings;
      $("cafe-name").value = s.cafeName;
      $("opening-balance").value = s.openingBalance;
      $("start-no").value = s.startNo || "";
      $("end-no").value = s.endNo || "";
      $("split-at").value = s.splitAt;
      $("group-a-label").value = s.groupA.label;
      $("group-a-rates").value = (s.groupA.rates || []).join(", ");
      $("group-b-label").value = s.groupB.label;
      $("group-b-rates").value = (s.groupB.rates || []).join(", ");
      $("cafe-title").textContent = s.cafeName;
      renderMenuEditor();
      renderProductInputs();
    }

    function renderMenuEditor() {
      const host = $("menu-editor");
      host.innerHTML = "";
      state.settings.menu.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "menu-edit-row";
        row.dataset.menuRow = "1";
        row.innerHTML = `
          <input data-menu-name value="${escapeAttr(item.name)}" aria-label="Item name" />
          <input data-menu-price type="number" min="0" step="1" value="${item.price}" aria-label="Item price" />
          <button type="button" data-remove-menu="${index}" aria-label="Remove ${escapeAttr(item.name)}">Remove</button>
        `;
        host.appendChild(row);
      });
    }

    function renderProductInputs() {
      const host = $("product-inputs");
      const previous = {};
      host.querySelectorAll("[data-product-qty]").forEach((input) => {
        previous[input.dataset.productQty] = input.value;
      });
      host.innerHTML = "";
      state.settings.menu.forEach((item) => {
        const wrap = document.createElement("label");
        wrap.className = "product-qty";
        wrap.innerHTML = `<span>${escapeHtml(item.name)} <small>₹${money(item.price)}</small></span>`;
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.step = "1";
        input.value = previous[item.name] || "0";
        input.dataset.productQty = item.name;
        input.dataset.productPrice = String(item.price);
        wrap.appendChild(input);
        host.appendChild(wrap);
      });
    }

    function selectedDate() {
      return $("filter-date").value || todayISO();
    }

    function visibleRows() {
      const filter = $("show-all").checked ? "all" : selectedDate();
      return entryRows(state, filter);
    }

    function render() {
      const rows = visibleRows();
      const body = $("ledger-body");
      body.innerHTML = "";
      if (!rows.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="14" class="empty">No entries for this view. Add a session or a cash-out.</td>`;
        body.appendChild(tr);
      } else {
        rows.forEach((entry) => {
          const tr = document.createElement("tr");
          const pay = entry.payments || {};
          tr.innerHTML = `
            <td>${entry.sr}</td>
            <td>${escapeHtml(entry.customerId || "")}</td>
            <td>${escapeHtml(entry.name || "")}</td>
            <td>${escapeHtml(entry.compNo || "")}</td>
            <td>${escapeHtml(entry.from || "")}–${escapeHtml(entry.to || "")}</td>
            <td>${entry.money.minutes}</td>
            <td>${money(entry.rate)}</td>
            <td>${money(entry.money.afterDiscount)}</td>
            <td>${escapeHtml(productSummary(entry))}</td>
            <td>${money(pay.gpay)}</td>
            <td>${money(pay.cash)}</td>
            <td>${money(entry.money.paid)}</td>
            <td>${money(entry.money.outgoing)}</td>
            <td class="num">${money(entry.balance)}</td>
          `;
          const actions = document.createElement("td");
          actions.className = "actions";
          const edit = document.createElement("button");
          edit.type = "button";
          edit.textContent = "Edit";
          edit.addEventListener("click", () => loadEntry(entry.id));
          const del = document.createElement("button");
          del.type = "button";
          del.textContent = "Delete";
          del.addEventListener("click", () => removeEntry(entry.id));
          actions.append(edit, del);
          tr.appendChild(actions);
          body.appendChild(tr);
        });
      }

      const totals = rows.reduce(
        (sum, entry) => {
          sum.after += entry.money.afterDiscount;
          sum.out += entry.money.outgoing;
          sum.paid += entry.money.paid;
          sum.products += entry.money.products;
          return sum;
        },
        { after: 0, out: 0, paid: 0, products: 0 }
      );
      $("stat-entries").textContent = String(rows.length);
      $("stat-collection").textContent = money(totals.after);
      $("stat-products").textContent = money(totals.products);
      $("stat-out").textContent = money(totals.out);
      const allRows = entryRows(state, "all");
      let closing = round2(state.settings.openingBalance);
      if ($("show-all").checked) {
        if (allRows.length) closing = allRows[allRows.length - 1].balance;
      } else {
        const upTo = allRows.filter((entry) => entry.date <= selectedDate());
        if (upTo.length) closing = upTo[upTo.length - 1].balance;
      }
      $("stat-balance").textContent = money(closing);
      $("preview").textContent = previewText();
      $("cafe-title").textContent = state.settings.cafeName || "Gaming Cafe";
    }

    function previewText() {
      const draft = readFormEntry(false);
      if (!draft) return "Enter a name, or a cash-out amount.";
      const m = computeMoney(draft);
      const gap = round2(m.afterDiscount - m.paid);
      const gapNote = m.afterDiscount > 0 && gap !== 0 ? ` Payment gap ₹${money(gap)}.` : "";
      return `${m.minutes} min · play ₹${money(m.playAmount)} · snacks ₹${money(m.products)} · after discount ₹${money(m.afterDiscount)} · paid ₹${money(m.paid)} · out ₹${money(m.outgoing)}.${gapNote}`;
    }

    function readFormEntry(requireIdentity) {
      const name = $("entry-name").value.trim();
      const outgoing = round2($("entry-out").value);
      if (requireIdentity && !name && outgoing <= 0) return null;
      const products = [...document.querySelectorAll("[data-product-qty]")].map((input) => ({
        name: input.dataset.productQty,
        price: round2(input.dataset.productPrice),
        qty: Math.max(0, Math.round(Number(input.value) || 0)),
      }));
      const payments = {};
      PAYMENT_KEYS.forEach(([key]) => {
        payments[key] = round2($(`pay-${key}`).value);
      });
      return {
        id: editingId || uid(),
        date: $("entry-date").value || selectedDate(),
        customerId: $("entry-id").value.trim(),
        name,
        compNo: $("entry-comp").value.trim(),
        from: $("entry-from").value,
        to: $("entry-to").value,
        extraMinutes: Math.max(0, Math.round(Number($("entry-extra-min").value) || 0)),
        rate: round2($("entry-rate").value),
        discount: round2($("entry-discount").value),
        extraCost: round2($("entry-extra-cost").value),
        outgoing,
        outgoingNote: $("entry-out-note").value.trim(),
        products,
        payments,
      };
    }

    function clearForm() {
      editingId = null;
      ["entry-id", "entry-name", "entry-comp", "entry-from", "entry-to", "entry-out-note"].forEach((id) => {
        $(id).value = "";
      });
      ["entry-extra-min", "entry-discount", "entry-extra-cost", "entry-out", "pay-gpay", "pay-bpay", "pay-debit", "pay-cash", "pay-other"].forEach((id) => {
        $(id).value = "0";
      });
      $("entry-rate").value = "";
      document.querySelectorAll("[data-product-qty]").forEach((input) => {
        input.value = "0";
      });
      $("entry-date").value = $("show-all").checked ? todayISO() : selectedDate();
      $("entry-rate").dataset.touched = "";
      $("save-entry").textContent = "Add entry";
      render();
    }

    function loadEntry(id) {
      const entry = state.entries.find((item) => item.id === id);
      if (!entry) return;
      editingId = id;
      $("entry-date").value = entry.date;
      $("entry-id").value = entry.customerId || "";
      $("entry-name").value = entry.name || "";
      $("entry-comp").value = entry.compNo || "";
      $("entry-from").value = entry.from || "";
      $("entry-to").value = entry.to || "";
      $("entry-extra-min").value = entry.extraMinutes || 0;
      $("entry-rate").value = entry.rate || 0;
      $("entry-discount").value = entry.discount || 0;
      $("entry-extra-cost").value = entry.extraCost || 0;
      $("entry-out").value = entry.outgoing || 0;
      $("entry-out-note").value = entry.outgoingNote || "";
      PAYMENT_KEYS.forEach(([key]) => {
        $(`pay-${key}`).value = entry.payments?.[key] || 0;
      });
      const qty = {};
      (entry.products || []).forEach((item) => {
        qty[item.name] = item.qty;
      });
      document.querySelectorAll("[data-product-qty]").forEach((input) => {
        input.value = qty[input.dataset.productQty] || 0;
      });
      $("save-entry").textContent = "Update entry";
      $("entry-form").scrollIntoView({ behavior: "smooth", block: "start" });
      render();
    }

    function removeEntry(id) {
      const entry = state.entries.find((item) => item.id === id);
      if (!entry) return;
      const label = entry.name || "this cash-out";
      if (!confirm(`Delete ${label}?`)) return;
      state.entries = state.entries.filter((item) => item.id !== id);
      if (editingId === id) editingId = null;
      saveState(state);
      render();
      toast("Entry deleted");
    }

    function saveEntry() {
      readSettingsFromForm();
      const draft = readFormEntry(true);
      if (!draft) {
        toast("Add a name, or a cash-out amount.", true);
        return;
      }
      const existing = state.entries.find((item) => item.id === draft.id);
      if (existing) {
        draft.sr = existing.sr;
        draft.createdAt = existing.createdAt;
        state.entries = state.entries.map((item) => (item.id === draft.id ? { ...existing, ...draft } : item));
      } else {
        draft.sr = nextSr(state.entries, draft.date);
        draft.createdAt = new Date().toISOString();
        state.entries.push(draft);
      }
      saveState(state);
      $("filter-date").value = draft.date;
      $("show-all").checked = false;
      clearForm();
      toast(existing ? "Entry updated" : "Entry added");
    }

    function download(filename, blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function fileStamp() {
      const filter = $("show-all").checked ? "all" : selectedDate();
      const cafe = (state.settings.cafeName || "cafe").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return `${cafe || "cafe"}-daybook-${filter}`;
    }

    function exportCsv() {
      readSettingsFromForm();
      saveState(state);
      const filter = $("show-all").checked ? "all" : selectedDate();
      const csv = toCsv(state, filter);
      download(`${fileStamp()}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
      toast("CSV downloaded");
    }

    function exportPdf() {
      readSettingsFromForm();
      saveState(state);
      const jsPDF = window.jspdf?.jsPDF;
      if (!jsPDF) {
        toast("PDF library did not load. Use CSV, or check the network.", true);
        return;
      }
      const filter = $("show-all").checked ? "all" : selectedDate();
      const rows = entryRows(state, filter);
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const settings = state.settings;
      const titleDate = filter === "all" ? "All dates" : `${filter} (${monthLabel(filter)})`;
      doc.setFontSize(16);
      doc.text(settings.cafeName || "Gaming Cafe", 14, 14);
      doc.setFontSize(10);
      doc.text(`Day book  ${titleDate}`, 14, 20);
      doc.text(
        `Start No ${settings.startNo || "-"}    End No ${settings.endNo || "-"}    Opening balance ${money(settings.openingBalance)}`,
        14,
        26
      );
      doc.text(
        `${settings.groupA.label}: ${(settings.groupA.rates || []).join(" / ")}     ${settings.groupB.label}: ${(settings.groupB.rates || []).join(" / ")}`,
        14,
        31
      );
      doc.autoTable({
        startY: 36,
        head: [ledgerHeaders()],
        body: rows.map((entry) => ledgerValues(entry)),
        styles: { fontSize: 7, cellPadding: 1.2 },
        headStyles: { fillColor: [20, 20, 32], textColor: 255 },
        margin: { left: 8, right: 8 },
      });
      const menu = settings.menu || [];
      if (menu.length) {
        const qty = {};
        rows.forEach((entry) => {
          productLines(entry).forEach((item) => {
            qty[item.name] = (qty[item.name] || 0) + Number(item.qty);
          });
        });
        doc.autoTable({
          startY: doc.lastAutoTable.finalY + 6,
          head: [["Product", "Price", "Qty", "Amount"]],
          body: menu.map((item) => {
            const count = qty[item.name] || 0;
            return [item.name, money(item.price), count, money(count * item.price)];
          }),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [20, 20, 32], textColor: 255 },
          margin: { left: 8, right: 8 },
        });
      }
      doc.save(`${fileStamp()}.pdf`);
      toast("PDF downloaded");
    }

    function onCompInput() {
      if ($("entry-rate").dataset.touched === "1") return;
      const rate = suggestRate($("entry-comp").value, state.settings);
      if (rate) $("entry-rate").value = String(rate);
      render();
    }

    $("filter-date").value = todayISO();
    $("entry-date").value = todayISO();
    fillSettings();
    render();

    $("save-settings").addEventListener("click", () => {
      readSettingsFromForm();
      saveState(state);
      fillSettings();
      render();
      toast("Cafe settings saved");
    });
    $("add-menu-item").addEventListener("click", () => {
      readSettingsFromForm();
      state.settings.menu.push({ name: "New item", price: 0 });
      renderMenuEditor();
      renderProductInputs();
    });
    $("menu-editor").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-menu]");
      if (!button) return;
      readSettingsFromForm();
      state.settings.menu.splice(Number(button.dataset.removeMenu), 1);
      renderMenuEditor();
      renderProductInputs();
    });
    $("save-entry").addEventListener("click", saveEntry);
    $("clear-entry").addEventListener("click", clearForm);
    $("export-csv").addEventListener("click", exportCsv);
    $("export-pdf").addEventListener("click", exportPdf);
    $("filter-date").addEventListener("change", () => {
      if (!$("show-all").checked) $("entry-date").value = selectedDate();
      render();
    });
    $("show-all").addEventListener("change", render);
    $("entry-form").addEventListener("input", render);
    $("entry-comp").addEventListener("input", onCompInput);
    $("entry-rate").addEventListener("input", () => {
      $("entry-rate").dataset.touched = "1";
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  return {
    STORAGE_KEY,
    defaultState,
    minutesBetween,
    suggestRate,
    computeMoney,
    withBalances,
    nextSr,
    toCsv,
    ledgerHeaders,
    mount,
  };
});
