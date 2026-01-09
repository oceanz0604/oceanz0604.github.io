/**
 * OceanZ Gaming Cafe - Daily Recharges Management
 */

import { BOOKING_DB_CONFIG, FDB_DATASET_CONFIG, BOOKING_APP_NAME, FDB_APP_NAME } from "../../shared/config.js";

// ==================== FIREBASE INIT ====================

// Initialize both Firebase apps
let bookingApp = firebase.apps.find(a => a.name === BOOKING_APP_NAME);
if (!bookingApp) bookingApp = firebase.initializeApp(BOOKING_DB_CONFIG, BOOKING_APP_NAME);

let fdbApp = firebase.apps.find(a => a.name === FDB_APP_NAME);
if (!fdbApp) fdbApp = firebase.initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);

const rechargeDb = bookingApp.database();
const fdbDb = fdbApp.database();

// ==================== STATE ====================

let selectedDate = new Date().toISOString().split("T")[0];
let editId = null;
let state = [];
let allMembers = [];
let dailyChart, monthlyChart;

const ADMIN = sessionStorage.getItem("ADMIN") || "admin";

// ==================== DOM ELEMENTS ====================

const $ = id => document.getElementById(id);

const elements = {
  memberInput: $("memberInput"),
  amountInput: $("amountInput"),
  modeInput: $("modeInput"),
  noteInput: $("noteInput"),
  listEl: $("rechargeList"),
  suggestionsBox: $("memberSuggestions"),
  totalEl: $("totalAmount"),
  cashEl: $("cashTotal"),
  upiEl: $("upiTotal"),
  cardEl: $("cardTotal"),
  datePicker: $("datePicker")
};

// ==================== DATE PICKER ====================

if (elements.datePicker) {
  elements.datePicker.value = selectedDate;
  elements.datePicker.onchange = e => {
    selectedDate = e.target.value;
    loadDay();
  };
}

// ==================== MEMBER AUTOCOMPLETE ====================

fdbDb.ref("fdb/MEMBERS").once("value").then(snap => {
  allMembers = Object.values(snap.val() || []);
});

elements.memberInput?.addEventListener("input", () => {
  const q = elements.memberInput.value.toLowerCase();
  elements.suggestionsBox.innerHTML = "";

  if (!q) {
    elements.suggestionsBox.classList.add("hidden");
    return;
  }

  const matches = allMembers
    .filter(m => m.USERNAME?.toLowerCase().includes(q))
    .slice(0, 6);

  matches.forEach(m => {
    const div = document.createElement("div");
    div.className = "px-3 py-2 hover:bg-gray-700 cursor-pointer";
    div.textContent = m.USERNAME;
    div.onclick = () => {
      elements.memberInput.value = m.USERNAME;
      elements.suggestionsBox.classList.add("hidden");
    };
    elements.suggestionsBox.appendChild(div);
  });

  elements.suggestionsBox.classList.remove("hidden");
});

// ==================== LOAD DATA ====================

function loadDay() {
  const ref = rechargeDb.ref(`recharges/${selectedDate}`);
  ref.off();
  ref.on("value", snap => {
    state = snap.val()
      ? Object.entries(snap.val()).map(([id, r]) => ({ id, ...r }))
      : [];
    render();
    renderCharts();
    loadAudit();
  });
}

loadDay();

// ==================== ADD / EDIT ====================

window.addRecharge = () => {
  const member = elements.memberInput.value.trim();
  const amount = Number(elements.amountInput.value);

  if (!member || !amount) {
    alert("Invalid input");
    return;
  }

  const data = {
    member,
    amount,
    mode: elements.modeInput.value,
    note: elements.noteInput.value || "",
    admin: ADMIN,
    createdAt: new Date().toISOString()
  };

  const refPath = `recharges/${selectedDate}`;

  if (editId) {
    rechargeDb.ref(`${refPath}/${editId}`).update(data);
  } else {
    rechargeDb.ref(refPath).push(data);
  }

  logAudit(editId ? "EDIT" : "ADD", member, amount);
  editId = null;
  elements.memberInput.value = "";
  elements.amountInput.value = "";
  elements.noteInput.value = "";
};

// ==================== RENDER LIST ====================

function render() {
  elements.listEl.innerHTML = "";
  let total = 0, cash = 0, upi = 0, card = 0;

  state.forEach(r => {
    total += r.amount;
    if (r.mode === "cash") cash += r.amount;
    if (r.mode === "upi") upi += r.amount;
    if (r.mode === "card") card += r.amount;

    const div = document.createElement("div");
    div.className = "recharge-item p-4 rounded-lg flex justify-between items-center";
    div.innerHTML = `
      <div>
        <strong class="font-orbitron" style="color: #00f0ff;">${r.member}</strong>
        <span style="color: #00ff88;"> — ₹${r.amount}</span>
        <div class="text-xs text-gray-500 mt-1">${r.mode.toUpperCase()}</div>
      </div>
      <div class="flex gap-3">
        <button onclick="editRecharge('${r.id}')" class="hover:scale-110 transition-transform" style="color: #00f0ff;">✏</button>
        <button onclick="deleteRecharge('${r.id}')" class="hover:scale-110 transition-transform" style="color: #ff0044;">✖</button>
      </div>
    `;
    elements.listEl.appendChild(div);
  });

  elements.totalEl.textContent = `₹${total}`;
  elements.cashEl.textContent = `₹${cash}`;
  elements.upiEl.textContent = `₹${upi}`;
  elements.cardEl.textContent = `₹${card}`;
}

window.editRecharge = id => {
  const r = state.find(x => x.id === id);
  if (!r) return;

  editId = id;
  elements.memberInput.value = r.member;
  elements.amountInput.value = r.amount;
  elements.modeInput.value = r.mode;
  elements.noteInput.value = r.note || "";
};

window.deleteRecharge = id => {
  if (confirm("Delete entry?")) {
    rechargeDb.ref(`recharges/${selectedDate}/${id}`).remove();
    logAudit("DELETE", id);
  }
};

// ==================== AUDIT LOG ====================

function logAudit(action, ref, amount = "") {
  rechargeDb.ref("recharge_audit").push({
    action,
    ref,
    amount,
    admin: ADMIN,
    at: new Date().toISOString()
  });
}

function loadAudit() {
  const el = $("auditLog");
  if (!el) return;

  el.innerHTML = "";
  rechargeDb.ref("recharge_audit").limitToLast(10).once("value").then(snap => {
    Object.values(snap.val() || {}).reverse().forEach(a => {
      const div = document.createElement("div");
      div.className = "audit-item px-3 py-2 rounded text-sm";
      div.innerHTML = `<span style="color: #b829ff;">${a.at.slice(11, 19)}</span> • <span style="color: #00f0ff;">${a.admin}</span> • <span style="color: #00ff88;">${a.action}</span>`;
      el.appendChild(div);
    });
  });
}

// ==================== CHARTS ====================

function renderCharts() {
  if (!window.Chart) return;

  const modes = { cash: 0, upi: 0, card: 0 };
  state.forEach(r => modes[r.mode] += r.amount);

  dailyChart?.destroy();
  dailyChart = new Chart($("dailyChart"), {
    type: "bar",
    data: {
      labels: ["Cash", "UPI", "Card"],
      datasets: [{ data: Object.values(modes), backgroundColor: ["#22c55e", "#3b82f6", "#a855f7"] }]
    }
  });

  const ym = selectedDate.slice(0, 7);
  let monthTotal = 0;

  rechargeDb.ref("recharges").once("value").then(snap => {
    Object.entries(snap.val() || {}).forEach(([d, v]) => {
      if (d.startsWith(ym)) {
        Object.values(v).forEach(r => monthTotal += r.amount);
      }
    });

    monthlyChart?.destroy();
    monthlyChart = new Chart($("monthlyChart"), {
      type: "doughnut",
      data: {
        labels: ["Total"],
        datasets: [{ data: [monthTotal], backgroundColor: ["#16a34a"] }]
      }
    });
  });
}

// ==================== EXPORTS ====================

window.exportMonthCSV = () => {
  const ym = selectedDate.slice(0, 7);
  const rows = [["Date", "Member", "Amount", "Mode", "Admin"]];

  rechargeDb.ref("recharges").once("value").then(snap => {
    Object.entries(snap.val() || {}).forEach(([d, v]) => {
      if (!d.startsWith(ym)) return;
      Object.values(v).forEach(r => rows.push([d, r.member, r.amount, r.mode, r.admin]));
    });

    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `recharges_${ym}.csv`;
    a.click();
  });
};

window.printSheet = () => {
  const w = window.open("");
  w.document.write(`
    <h2>Daily Recharge Sheet</h2>
    <p>Date: ${selectedDate}</p>
    <p>${elements.totalEl.textContent}</p>
    <p>${elements.cashEl.textContent} | ${elements.upiEl.textContent} | ${elements.cardEl.textContent}</p>
    <br><p>Admin: ${ADMIN}</p>
  `);
  w.print();
};
