/* ================= FIREBASE INIT ================= */

const firebaseConfig = {
  apiKey: "AIzaSyAc0Gz1Em0TUeGnKD4jQjZl5fn_FyoWCLo",
  databaseURL: "https://gaming-cafe-booking-630f9-default-rtdb.asia-southeast1.firebasedatabase.app",
  authDomain: "gaming-cafe-booking-630f9.firebaseapp.com",
  projectId: "gaming-cafe-booking-630f9",
  storageBucket: "gaming-cafe-booking-630f9.appspot.com",
  messagingSenderId: "872841235480",
  appId: "1:872841235480:web:58cfe4fc38cc8a037b076d"
};

const secondAppConfig = {
  apiKey: "AIzaSyCaC558bQ7mhYlhjmthvZZX9SBVvNe6wYg",
  authDomain: "fdb-dataset.firebaseapp.com",
  databaseURL: "https://fdb-dataset-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "fdb-dataset",
  storageBucket: "fdb-dataset.appspot.com",
  messagingSenderId: "497229278574",
  appId: "1:497229278574:web:c8f127aad76b8ed004657f"
};

/* ---- init main recharge DB ---- */
const rechargeApp = firebase.apps.find(a => a.name === "[DEFAULT]")
  || firebase.initializeApp(firebaseConfig);

const recharge = firebase.database();

/* ---- init second app (members DB) ---- */
const dbApp = firebase.apps.find(a => a.name === "SECOND_APP")
  || firebase.initializeApp(secondAppConfig, "SECOND_APP");

const db = dbApp.database();

/* ================= STATE ================= */

let selectedDate = new Date().toISOString().split("T")[0];
let editId = null;
let state = [];
let allMembers = [];

const ADMIN = sessionStorage.getItem("ADMIN") || "admin";

/* ================= DOM ================= */

const memberInput = document.getElementById("memberInput");
const amountInput = document.getElementById("amountInput");
const modeInput = document.getElementById("modeInput");
const noteInput = document.getElementById("noteInput");
const listEl = document.getElementById("rechargeList");
const suggestionsBox = document.getElementById("memberSuggestions");

const totalEl = document.getElementById("totalAmount");
const cashEl = document.getElementById("cashTotal");
const upiEl = document.getElementById("upiTotal");
const cardEl = document.getElementById("cardTotal");

/* ================= DATE PICKER ================= */

const datePicker = document.getElementById("datePicker");
if (datePicker) {
  datePicker.value = selectedDate;
  datePicker.onchange = e => {
    selectedDate = e.target.value;
    loadDay();
  };
}

/* ================= MEMBER AUTOCOMPLETE (UNCHANGED) ================= */

db.ref("fdb/MEMBERS").once("value").then(snap => {
  allMembers = Object.values(snap.val() || []);
});

memberInput.addEventListener("input", () => {
  const q = memberInput.value.toLowerCase();
  suggestionsBox.innerHTML = "";
  if (!q) return suggestionsBox.classList.add("hidden");

  allMembers
    .filter(m => m.USERNAME?.toLowerCase().includes(q))
    .slice(0, 6)
    .forEach(m => {
      const div = document.createElement("div");
      div.className = "px-3 py-2 hover:bg-gray-700 cursor-pointer";
      div.textContent = m.USERNAME;
      div.onclick = () => {
        memberInput.value = m.USERNAME;
        suggestionsBox.classList.add("hidden");
      };
      suggestionsBox.appendChild(div);
    });

  suggestionsBox.classList.remove("hidden");
});

/* ================= LOAD DAILY DATA ================= */

function loadDay() {
  recharge.ref(`recharges/${selectedDate}`).off();
  recharge.ref(`recharges/${selectedDate}`).on("value", snap => {
    state = snap.val()
      ? Object.entries(snap.val()).map(([id, r]) => ({ id, ...r }))
      : [];
    render();
    renderCharts();
    loadAudit();
  });
}

loadDay();

/* ================= ADD / EDIT ================= */

window.addRecharge = () => {
  const member = memberInput.value.trim();
  const amount = Number(amountInput.value);
  if (!member || !amount) return alert("Invalid input");

  const data = {
    member,
    amount,
    mode: modeInput.value,
    note: noteInput.value || "",
    admin: ADMIN,
    createdAt: new Date().toISOString()
  };

  const refPath = `recharges/${selectedDate}`;
  editId
    ? recharge.ref(`${refPath}/${editId}`).update(data)
    : recharge.ref(refPath).push(data);

  logAudit(editId ? "EDIT" : "ADD", member, amount);
  editId = null;
  memberInput.value = amountInput.value = noteInput.value = "";
};

/* ================= RENDER LIST ================= */

function render() {
  listEl.innerHTML = "";
  let total = 0, cash = 0, upi = 0, card = 0;

  state.forEach(r => {
    total += r.amount;
    if (r.mode === "cash") cash += r.amount;
    if (r.mode === "upi") upi += r.amount;
    if (r.mode === "card") card += r.amount;

    const div = document.createElement("div");
    div.className = "bg-gray-800 p-3 rounded flex justify-between";
    div.innerHTML = `
      <div>
        <strong>${r.member}</strong> — ₹${r.amount}
        <div class="text-xs text-gray-400">${r.mode}</div>
      </div>
      <div class="flex gap-2">
        <button onclick="editRecharge('${r.id}')" class="text-blue-400">✏</button>
        <button onclick="deleteRecharge('${r.id}')" class="text-red-400">✖</button>
      </div>
    `;
    listEl.appendChild(div);
  });

  totalEl.textContent = `₹${total}`;
  cashEl.textContent = `₹${cash}`;
  upiEl.textContent = `₹${upi}`;
  cardEl.textContent = `₹${card}`;
}

window.editRecharge = id => {
  const r = state.find(x => x.id === id);
  if (!r) return;
  editId = id;
  memberInput.value = r.member;
  amountInput.value = r.amount;
  modeInput.value = r.mode;
  noteInput.value = r.note || "";
};

window.deleteRecharge = id => {
  if (confirm("Delete entry?")) {
    recharge.ref(`recharges/${selectedDate}/${id}`).remove();
    logAudit("DELETE", id);
  }
};

/* ================= AUDIT LOG ================= */

function logAudit(action, ref, amount = "") {
  recharge.ref("recharge_audit").push({
    action,
    ref,
    amount,
    admin: ADMIN,
    at: new Date().toISOString()
  });
}

function loadAudit() {
  const el = document.getElementById("auditLog");
  if (!el) return;

  el.innerHTML = "";
  recharge.ref("recharge_audit").limitToLast(10).once("value").then(snap => {
    Object.values(snap.val() || {}).reverse().forEach(a => {
      const div = document.createElement("div");
      div.textContent = `${a.at.slice(11,19)} • ${a.admin} • ${a.action}`;
      el.appendChild(div);
    });
  });
}

/* ================= CHARTS ================= */

let dailyChart, monthlyChart;

function renderCharts() {
  if (!window.Chart) return;

  const modes = { cash: 0, upi: 0, card: 0 };
  state.forEach(r => modes[r.mode] += r.amount);

  dailyChart?.destroy();
  dailyChart = new Chart(document.getElementById("dailyChart"), {
    type: "bar",
    data: {
      labels: ["Cash", "UPI", "Card"],
      datasets: [{
        data: Object.values(modes),
        backgroundColor: ["#22c55e","#3b82f6","#a855f7"]
      }]
    }
  });

  const ym = selectedDate.slice(0,7);
  let monthTotal = 0;

  recharge.ref("recharges").once("value").then(snap => {
    Object.entries(snap.val() || {}).forEach(([d,v]) => {
      if (d.startsWith(ym))
        Object.values(v).forEach(r => monthTotal += r.amount);
    });

    monthlyChart?.destroy();
    monthlyChart = new Chart(document.getElementById("monthlyChart"), {
      type: "doughnut",
      data: {
        labels: ["Total"],
        datasets: [{ data: [monthTotal], backgroundColor: ["#16a34a"] }]
      }
    });
  });
}

/* ================= MONTH CSV EXPORT ================= */

window.exportMonthCSV = () => {
  const ym = selectedDate.slice(0,7);
  const rows = [["Date","Member","Amount","Mode","Admin"]];

  recharge.ref("recharges").once("value").then(snap => {
    Object.entries(snap.val() || {}).forEach(([d,v]) => {
      if (!d.startsWith(ym)) return;
      Object.values(v).forEach(r =>
        rows.push([d,r.member,r.amount,r.mode,r.admin])
      );
    });

    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv],{type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `recharges_${ym}.csv`;
    a.click();
  });
};

/* ================= PRINT ================= */

window.printSheet = () => {
  const w = window.open("");
  w.document.write(`
    <h2>Daily Recharge Sheet</h2>
    <p>Date: ${selectedDate}</p>
    <p>${totalEl.textContent}</p>
    <p>${cashEl.textContent} | ${upiEl.textContent} | ${cardEl.textContent}</p>
    <br><p>Admin: ${ADMIN}</p>
  `);
  w.print();
};
