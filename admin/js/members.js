/**
 * OceanZ Gaming Cafe - Members Directory
 * Rich member cards + dossier modal with lazy recent activity.
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  FDB_DATASET_CONFIG,
  FDB_APP_NAME,
  FB_PATHS,
  FB_PATHS_V2,
  SharedCache,
  formatToIST,
  TIMEZONE
} from "../../shared/config.js";

const createDbWrapper = (database) => ({
  ref: (path) => ref(database, path),
  get: (dbRef) => get(dbRef)
});

let fdbApp = getApps().find(a => a.name === FDB_APP_NAME);
if (!fdbApp) fdbApp = initializeApp(FDB_DATASET_CONFIG, FDB_APP_NAME);
const db = getDatabase(fdbApp);
const fdbDb = createDbWrapper(db);

const $ = id => document.getElementById(id);

let allMembers = [];
let filteredMembers = [];
let searchQuery = "";
let statusFilter = "all"; // all | active | regular | ghost | low_balance
let sortMode = "name"; // name | balance | hours | recent
let selectedUsername = null;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function displayName(m) {
  const full = [m.FIRSTNAME, m.LASTNAME].filter(Boolean).join(" ").trim();
  return full || m.DISPLAY_NAME || m.USERNAME || "—";
}

function initials(m) {
  const name = displayName(m);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.slice(0, 2) || "?").toUpperCase();
}

function activityStatus(m) {
  return m.badges?.activity_status || "regular";
}

function activityMeta(status) {
  const map = {
    active: { label: "Active", color: "#00ff88", bg: "rgba(0,255,136,0.15)" },
    regular: { label: "Regular", color: "#00f0ff", bg: "rgba(0,240,255,0.12)" },
    ghost: { label: "Ghost", color: "#888", bg: "rgba(136,136,136,0.15)" }
  };
  return map[status] || map.regular;
}

function formatMinutes(mins) {
  const n = Number(mins) || 0;
  if (n < 60) return `${Math.round(n)}m`;
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatMoney(n) {
  return `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
}

function formatLastActive(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d)) return String(iso).slice(0, 10);
    const now = Date.now();
    const diff = now - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-IN", { timeZone: TIMEZONE, day: "numeric", month: "short", year: "2-digit" });
  } catch {
    return "—";
  }
}

function badgeChips(m) {
  const b = m.badges || {};
  const chips = [];
  if (b.champion) chips.push({ t: "👑 Champ", c: "#ffd700" });
  if (b.runner_up) chips.push({ t: "🥈 #2", c: "#c0c0c0" });
  if (b.third_place) chips.push({ t: "🥉 #3", c: "#cd7f32" });
  if (b.grinder) chips.push({ t: "🔥 Grinder", c: "#ff6b00" });
  if (b.big_spender) chips.push({ t: "💰 Whale", c: "#b829ff" });
  if (b.streak_master || (b.streak_days && b.streak_days >= 7)) {
    chips.push({ t: `⚡ ${b.streak_days || m.stats?.streak_days || 0}d`, c: "#00ff88" });
  }
  return chips.slice(0, 3);
}

// ==================== LOAD / FILTER ====================

export async function initMembersPage() {
  await loadMembersDirectory();
}

async function loadMembersDirectory() {
  const list = $("membersList");
  if (list) {
    list.innerHTML = `<div class="col-span-full text-center py-12 text-gray-500 font-orbitron text-sm">Loading roster…</div>`;
  }

  try {
    const members = await SharedCache.getMembers(fdbDb, FB_PATHS.MEMBERS);
    allMembers = (members || []).map(m => ({
      ...m,
      USERNAME: m.USERNAME || m.username,
      _name: displayName(m).toLowerCase(),
      _balance: Number(m.balance?.current_balance) || 0,
      _minutes: Number(m.stats?.total_minutes) || 0,
      _sessions: Number(m.stats?.total_sessions) || 0,
      _lastActive: m.stats?.last_active || "",
      _status: activityStatus(m)
    }));

    applyFilters();
    updateRosterStats();
  } catch (err) {
    console.error("Members load failed:", err);
    if (list) {
      list.innerHTML = `<div class="col-span-full text-center py-12 text-red-400 font-orbitron text-sm">Failed to load members</div>`;
    }
  }
}

function applyFilters() {
  const q = searchQuery.trim().toLowerCase();
  let list = [...allMembers];

  if (q) {
    list = list.filter(m =>
      m._name.includes(q) ||
      (m.USERNAME || "").toLowerCase().includes(q) ||
      (m.PHONE || "").includes(q) ||
      (m.EMAIL || "").toLowerCase().includes(q)
    );
  }

  if (statusFilter === "active") list = list.filter(m => m._status === "active");
  else if (statusFilter === "regular") list = list.filter(m => m._status === "regular");
  else if (statusFilter === "ghost") list = list.filter(m => m._status === "ghost");
  else if (statusFilter === "low_balance") list = list.filter(m => m._balance > 0 && m._balance < 100);

  list.sort((a, b) => {
    if (sortMode === "balance") return b._balance - a._balance;
    if (sortMode === "hours") return b._minutes - a._minutes;
    if (sortMode === "recent") {
      return String(b._lastActive).localeCompare(String(a._lastActive));
    }
    return a._name.localeCompare(b._name);
  });

  filteredMembers = list;
  renderMemberCards();
  const countEl = $("membersResultCount");
  if (countEl) {
    countEl.textContent = `${list.length} of ${allMembers.length}`;
  }
}

function updateRosterStats() {
  const total = allMembers.length;
  const active = allMembers.filter(m => m._status === "active").length;
  const ghost = allMembers.filter(m => m._status === "ghost").length;
  const lowBal = allMembers.filter(m => m._balance > 0 && m._balance < 100).length;
  const hours = Math.round(allMembers.reduce((s, m) => s + m._minutes, 0) / 60);

  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set("membersStatTotal", total.toLocaleString("en-IN"));
  set("membersStatActive", active.toLocaleString("en-IN"));
  set("membersStatGhost", ghost.toLocaleString("en-IN"));
  set("membersStatLowBal", lowBal.toLocaleString("en-IN"));
  set("membersStatHours", `${hours.toLocaleString("en-IN")}h`);
}

// ==================== CARDS ====================

function renderMemberCards() {
  const container = $("membersList");
  if (!container) return;

  if (!filteredMembers.length) {
    container.innerHTML = `<div class="col-span-full text-center py-14 text-gray-500">
      <div class="text-3xl mb-2 opacity-50">👤</div>
      <p class="font-orbitron text-sm">No members match</p>
    </div>`;
    return;
  }

  container.innerHTML = filteredMembers.map(m => {
    const status = activityMeta(m._status);
    const chips = badgeChips(m);
    const balColor = m._balance <= 0 ? "#ff0044" : m._balance < 100 ? "#ff6b00" : "#00ff88";
    const uname = escapeHtml(m.USERNAME);

    return `
      <button type="button" class="member-card member-card-rich text-left w-full"
        data-username="${uname}" onclick="openMemberDossier('${uname.replace(/'/g, "\\'")}')">
        <div class="member-card-top">
          <div class="member-avatar" style="border-color: ${status.color}; box-shadow: 0 0 12px ${status.color}33;">
            ${escapeHtml(initials(m))}
          </div>
          <div class="member-card-id min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-orbitron font-bold text-sm truncate" style="color: var(--neon-cyan);">${escapeHtml(displayName(m))}</h3>
              <span class="member-status-pill" style="color:${status.color}; background:${status.bg};">${status.label}</span>
            </div>
            <p class="text-xs text-gray-500 truncate">@${uname}</p>
          </div>
        </div>
        <div class="member-card-stats">
          <div>
            <div class="member-stat-label">Balance</div>
            <div class="member-stat-value font-orbitron" style="color:${balColor};">${formatMoney(m._balance)}</div>
          </div>
          <div>
            <div class="member-stat-label">Playtime</div>
            <div class="member-stat-value font-orbitron" style="color: var(--neon-purple);">${formatMinutes(m._minutes)}</div>
          </div>
          <div>
            <div class="member-stat-label">Sessions</div>
            <div class="member-stat-value font-orbitron" style="color: var(--neon-yellow);">${m._sessions}</div>
          </div>
        </div>
        <div class="member-card-foot">
          <span class="text-[10px] text-gray-600">Last: <span style="color:#aaa;">${escapeHtml(formatLastActive(m._lastActive))}</span></span>
          <div class="member-chip-row">
            ${chips.map(c => `<span class="member-mini-chip" style="color:${c.c}; border-color:${c.c}44;">${c.t}</span>`).join("")}
          </div>
        </div>
      </button>
    `;
  }).join("");
}

// ==================== DOSSIER MODAL ====================

window.openMemberDossier = async function(username) {
  const m = allMembers.find(x => x.USERNAME === username);
  if (!m) return;
  selectedUsername = username;

  const modal = $("memberDossierModal");
  if (!modal) return;

  modal.classList.remove("hidden");
  modal.classList.add("flex");
  if (typeof syncModalScrollLock === "function") syncModalScrollLock();

  populateDossierShell(m);
  loadDossierExtras(username, m);
};

window.closeMemberDossier = function() {
  const modal = $("memberDossierModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  selectedUsername = null;
  if (typeof syncModalScrollLock === "function") syncModalScrollLock();
};

function populateDossierShell(m) {
  const status = activityMeta(m._status);
  const chips = badgeChips(m);
  const balColor = m._balance <= 0 ? "#ff0044" : m._balance < 100 ? "#ff6b00" : "#00ff88";

  const avatar = $("dossierAvatar");
  if (avatar) {
    avatar.textContent = initials(m);
    avatar.style.borderColor = status.color;
    avatar.style.boxShadow = `0 0 24px ${status.color}44`;
  }

  const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  setText("dossierName", displayName(m));
  setText("dossierUsername", `@${m.USERNAME}`);
  setText("dossierStatus", status.label);
  const statusEl = $("dossierStatus");
  if (statusEl) {
    statusEl.style.color = status.color;
    statusEl.style.background = status.bg;
  }

  setText("dossierBalance", formatMoney(m._balance));
  const balEl = $("dossierBalance");
  if (balEl) balEl.style.color = balColor;
  setText("dossierLoaded", formatMoney(m.balance?.total_loaded));
  setText("dossierSpent", formatMoney(m.balance?.total_spent));
  setText("dossierHours", formatMinutes(m._minutes));
  setText("dossierSessions", String(m._sessions));
  setText("dossierMonthly", formatMinutes(m.stats?.monthly_minutes));
  setText("dossierStreak", `${m.stats?.streak_days || m.badges?.streak_days || 0}d`);
  setText("dossierJoined", m.RECDATE || "—");
  setText("dossierLastActive", formatLastActive(m._lastActive));
  setText("dossierPhone", m.PHONE || "—");
  setText("dossierEmail", m.EMAIL || "—");
  setText("dossierMemberId", m.id != null ? String(m.id) : "—");
  setText("dossierState", m.MEMBERSTATE || "—");

  const ranks = m.ranks || {};
  setText("dossierRankAll", ranks.all_time != null ? `#${ranks.all_time}` : "—");
  setText("dossierRankMonth", ranks.monthly != null ? `#${ranks.monthly}` : "—");
  setText("dossierRankWeek", ranks.weekly != null ? `#${ranks.weekly}` : "—");

  const badgeRow = $("dossierBadges");
  if (badgeRow) {
    const allChips = badgeChips(m);
    // show more badge keys as chips
    const b = m.badges || {};
    Object.entries(b).forEach(([k, v]) => {
      if (!v || k === "activity_status" || k === "streak_days") return;
      if (["champion", "runner_up", "third_place", "grinder", "big_spender", "streak_master"].includes(k)) return;
      allChips.push({ t: String(k).replace(/_/g, " "), c: "#00f0ff" });
    });
    badgeRow.innerHTML = allChips.length
      ? allChips.map(c => `<span class="member-mini-chip" style="color:${c.c}; border-color:${c.c}55;">${escapeHtml(c.t)}</span>`).join("")
      : `<span class="text-xs text-gray-600">No special badges yet</span>`;
  }

  const hist = $("dossierHistory");
  const sess = $("dossierSessionsList");
  if (hist) hist.innerHTML = `<p class="text-xs text-gray-500 py-4 text-center">Loading activity…</p>`;
  if (sess) sess.innerHTML = `<p class="text-xs text-gray-500 py-4 text-center">Loading sessions…</p>`;
}

async function loadDossierExtras(username, cached) {
  try {
    const snap = await get(ref(db, FB_PATHS_V2.MEMBER(username)));
    const raw = snap.val() || {};
    const history = raw.recent_history || {};
    const sessions = raw.recent_sessions || {};

    renderHistoryList(history);
    renderSessionsList(sessions);

    // Refresh shell fields if raw has fresher stats
    if (raw.stats || raw.balance) {
      const merged = {
        ...cached,
        balance: raw.balance || cached.balance,
        stats: raw.stats || cached.stats,
        badges: raw.badges || cached.badges,
        ranks: raw.ranks || cached.ranks,
        _balance: Number(raw.balance?.current_balance ?? cached._balance) || 0,
        _minutes: Number(raw.stats?.total_minutes ?? cached._minutes) || 0,
        _sessions: Number(raw.stats?.total_sessions ?? cached._sessions) || 0,
        _lastActive: raw.stats?.last_active || cached._lastActive,
        _status: raw.badges?.activity_status || cached._status
      };
      if (selectedUsername === username) populateDossierShell(merged);
      // re-fill lists after shell wipe
      renderHistoryList(history);
      renderSessionsList(sessions);
    }
  } catch (err) {
    console.warn("Dossier extras failed:", err);
    const hist = $("dossierHistory");
    const sess = $("dossierSessionsList");
    if (hist) hist.innerHTML = `<p class="text-xs text-gray-600 py-4 text-center">No recent history</p>`;
    if (sess) sess.innerHTML = `<p class="text-xs text-gray-600 py-4 text-center">No recent sessions</p>`;
  }
}

function renderHistoryList(historyMap) {
  const el = $("dossierHistory");
  if (!el) return;
  const rows = Object.entries(historyMap || {})
    .map(([id, h]) => ({ id, ...h }))
    .sort((a, b) => String(b.DATE || "").localeCompare(String(a.DATE || "")) || String(b.TIME || "").localeCompare(String(a.TIME || "")))
    .slice(0, 15);

  if (!rows.length) {
    el.innerHTML = `<p class="text-xs text-gray-600 py-4 text-center">No recent history on file</p>`;
    return;
  }

  el.innerHTML = rows.map(h => {
    const charge = Number(h.CHARGE) || 0;
    const mins = Number(h.USINGMIN) || 0;
    const term = h.TERMINAL_SHORT || h.TERMINALNAME || "—";
    return `
      <div class="dossier-feed-row">
        <div class="min-w-0">
          <div class="text-xs text-white truncate">${escapeHtml(h.NOTE || "Session charge")}</div>
          <div class="text-[10px] text-gray-500">${escapeHtml(h.DATE || "")} ${escapeHtml(h.TIME || "")} · ${escapeHtml(term)}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="font-orbitron text-xs" style="color: var(--neon-orange);">−${formatMoney(Math.abs(charge))}</div>
          <div class="text-[10px] text-gray-500">${mins ? formatMinutes(mins) : ""}</div>
        </div>
      </div>
    `;
  }).join("");
}

function renderSessionsList(sessionsMap) {
  const el = $("dossierSessionsList");
  if (!el) return;
  const rows = Object.entries(sessionsMap || {})
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => String(b.STARTPOINT || b.ENDPOINT || "").localeCompare(String(a.STARTPOINT || a.ENDPOINT || "")))
    .slice(0, 10);

  if (!rows.length) {
    el.innerHTML = `<p class="text-xs text-gray-600 py-4 text-center">No recent sessions on file</p>`;
    return;
  }

  el.innerHTML = rows.map(s => {
    const mins = Number(s.USINGMIN) || 0;
    const price = Number(s.TOTALPRICE) || 0;
    let when = "—";
    try {
      if (s.STARTPOINT) {
        when = new Date(s.STARTPOINT).toLocaleString("en-IN", {
          timeZone: TIMEZONE,
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true
        });
      }
    } catch { /* ignore */ }
    return `
      <div class="dossier-feed-row">
        <div class="min-w-0">
          <div class="text-xs text-white truncate">${escapeHtml(s.TERMINALNAME || "Terminal")}</div>
          <div class="text-[10px] text-gray-500">${escapeHtml(when)}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="font-orbitron text-xs" style="color: var(--neon-cyan);">${formatMinutes(mins)}</div>
          <div class="text-[10px] text-gray-500">${price ? formatMoney(price) : ""}</div>
        </div>
      </div>
    `;
  }).join("");
}

// ==================== UI CONTROLS ====================

window.filterMembersDirectory = function() {
  searchQuery = $("membersSearch")?.value || "";
  applyFilters();
};

window.setMembersStatusFilter = function(filter) {
  statusFilter = filter;
  document.querySelectorAll(".members-filter-chip").forEach(btn => {
    const on = btn.dataset.filter === filter;
    btn.classList.toggle("active", on);
  });
  applyFilters();
};

window.setMembersSort = function(mode) {
  sortMode = mode;
  const sel = $("membersSort");
  if (sel && sel.value !== mode) sel.value = mode;
  applyFilters();
};

window.clearMembersSearch = function() {
  const input = $("membersSearch");
  if (input) input.value = "";
  searchQuery = "";
  applyFilters();
};

// Close dossier on backdrop / Escape
document.addEventListener("DOMContentLoaded", () => {
  const modal = $("memberDossierModal");
  modal?.addEventListener("click", e => {
    if (e.target === modal) closeMemberDossier();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      closeMemberDossier();
    }
  });
});

window.initMembersPage = initMembersPage;
window.loadAllMembers = loadMembersDirectory;

export { loadMembersDirectory };
