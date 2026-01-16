/**
 * CyberCafe Manager - Admin Dashboard
 */

// API Base URL
const API_BASE = '/api';

// Socket.io connection
const socket = io();

// State
let terminals = [];
let members = [];
let settings = {};

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initSocket();
  loadDashboard();
  updateClock();
  setInterval(updateClock, 1000);
  
  // Event listeners
  document.getElementById('sessionDate').addEventListener('change', loadSessions);
  document.getElementById('bookingDate').addEventListener('change', loadBookings);
  document.getElementById('leaderboardPeriod').addEventListener('change', loadLeaderboard);
  document.getElementById('memberSearch').addEventListener('input', debounce(searchMembers, 300));
  
  // Set default dates
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('sessionDate').value = today;
  document.getElementById('bookingDate').value = today;
});

// ==================== NAVIGATION ====================

function initNavigation() {
  const links = document.querySelectorAll('.sidebar-link');
  
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      
      // Update active state
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      
      // Show page
      document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
      document.getElementById(`page-${page}`).classList.remove('hidden');
      document.getElementById('pageTitle').textContent = link.textContent.trim();
      
      // Load page data
      loadPageData(page);
    });
  });
}

function loadPageData(page) {
  switch(page) {
    case 'dashboard': loadDashboard(); break;
    case 'terminals': loadTerminals(); break;
    case 'members': loadMembers(); break;
    case 'sessions': loadSessions(); break;
    case 'bookings': loadBookings(); break;
    case 'leaderboard': loadLeaderboard(); break;
    case 'settings': loadSettings(); break;
  }
}

// ==================== SOCKET.IO ====================

function initSocket() {
  socket.on('connect', () => {
    document.getElementById('connectionStatus').innerHTML = 
      '<span class="pulse">●</span> Connected';
    document.getElementById('connectionStatus').className = 'badge badge-success';
  });

  socket.on('disconnect', () => {
    document.getElementById('connectionStatus').innerHTML = 
      '<span>●</span> Disconnected';
    document.getElementById('connectionStatus').className = 'badge badge-danger';
  });

  socket.on('terminals:status', (data) => {
    terminals = data;
    renderTerminals();
    updateStats();
  });

  socket.on('session:started', () => {
    loadDashboard();
    showToast('Session started', 'success');
  });

  socket.on('session:ended', () => {
    loadDashboard();
    showToast('Session ended', 'success');
  });

  socket.on('member:updated', () => {
    loadMembers();
  });
}

// ==================== DASHBOARD ====================

async function loadDashboard() {
  try {
    const [stats, terminalData, sessions] = await Promise.all([
      fetch(`${API_BASE}/stats/dashboard`).then(r => r.json()),
      fetch(`${API_BASE}/terminals`).then(r => r.json()),
      fetch(`${API_BASE}/sessions/today`).then(r => r.json())
    ]);

    terminals = terminalData;
    
    // Update stats
    document.getElementById('stat-members').textContent = stats.totalMembers;
    document.getElementById('stat-terminals').textContent = 
      `${stats.availableTerminals}/${stats.totalTerminals}`;
    document.getElementById('stat-sessions').textContent = stats.activeSessions;
    document.getElementById('stat-revenue').textContent = `₹${stats.todayRevenue}`;
    
    // Render terminals
    renderTerminals();
    
    // Render recent sessions
    renderSessions(sessions.slice(0, 10), 'recentSessions');
  } catch (error) {
    showToast('Failed to load dashboard', 'error');
    console.error(error);
  }
}

// ==================== TERMINALS ====================

function renderTerminals() {
  const html = terminals.map(t => `
    <div class="terminal-card ${t.status}" onclick="showTerminalModal('${t.id}')">
      <span class="icon">${getDeviceIcon(t.type)}</span>
      <span class="name">${t.name}</span>
      ${t.currentMember ? `<span class="user">${t.currentMember.username}</span>` : ''}
      <span class="badge badge-${getStatusBadge(t.status)}">${t.status}</span>
    </div>
  `).join('');
  
  document.getElementById('terminalGrid').innerHTML = html;
  
  const terminalsPage = document.getElementById('terminalsPage');
  if (terminalsPage) terminalsPage.innerHTML = html;
}

function getDeviceIcon(type) {
  const icons = { PC: '🖥️', XBOX: '🎮', PS: '🎮' };
  return icons[type] || '🖥️';
}

function getStatusBadge(status) {
  const badges = { available: 'success', occupied: 'danger', maintenance: 'warning' };
  return badges[status] || 'info';
}

async function showTerminalModal(terminalId) {
  const terminal = terminals.find(t => t.id === terminalId);
  if (!terminal) return;
  
  document.getElementById('terminalModalTitle').textContent = terminal.name;
  
  let content = '';
  
  if (terminal.status === 'available') {
    // Show start session form
    const membersRes = await fetch(`${API_BASE}/members`);
    const membersList = await membersRes.json();
    
    content = `
      <form onsubmit="startSession(event, '${terminal.id}')">
        <div class="form-group">
          <label class="form-label">Session Type</label>
          <div class="flex gap-1">
            <button type="button" class="btn btn-ghost flex-1 session-type active" 
              data-type="member" onclick="selectSessionType(this)">Member</button>
            <button type="button" class="btn btn-ghost flex-1 session-type" 
              data-type="guest" onclick="selectSessionType(this)">Guest</button>
          </div>
        </div>
        <div class="form-group" id="memberSelectGroup">
          <label class="form-label">Select Member</label>
          <select class="form-select" name="memberId">
            <option value="">-- Select Member --</option>
            ${membersList.map(m => `
              <option value="${m.id}">${m.displayName} (₹${m.balance})</option>
            `).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Rate: ₹${settings.rates?.[terminal.type] || 40}/hr</label>
        </div>
        <button type="submit" class="btn btn-success w-full">Start Session</button>
      </form>
    `;
  } else if (terminal.status === 'occupied') {
    // Show end session option
    const sessionsRes = await fetch(`${API_BASE}/sessions/active`);
    const activeSessions = await sessionsRes.json();
    const session = activeSessions.find(s => s.terminalId === terminal.id);
    
    if (session) {
      const duration = Math.ceil((Date.now() - new Date(session.startTime)) / 60000);
      const cost = ((duration / 60) * session.rate).toFixed(2);
      
      content = `
        <div class="text-center mb-3">
          <p class="text-secondary">Current User</p>
          <h3 class="text-primary">${session.memberUsername}</h3>
        </div>
        <div class="grid grid-2 gap-2 mb-3">
          <div class="stat-card">
            <div class="stat-value">${formatDuration(duration)}</div>
            <div class="stat-label">Duration</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">₹${cost}</div>
            <div class="stat-label">Current Cost</div>
          </div>
        </div>
        <button class="btn btn-danger w-full" onclick="endSession('${session.id}')">
          End Session
        </button>
      `;
    }
  } else {
    content = `
      <p class="text-center text-secondary mb-3">Terminal is in maintenance mode</p>
      <button class="btn btn-success w-full" onclick="activateTerminal('${terminal.id}')">
        Set Available
      </button>
    `;
  }
  
  document.getElementById('terminalModalContent').innerHTML = content;
  openModal('terminalModal');
}

function selectSessionType(btn) {
  document.querySelectorAll('.session-type').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  
  const memberGroup = document.getElementById('memberSelectGroup');
  if (btn.dataset.type === 'guest') {
    memberGroup.style.display = 'none';
  } else {
    memberGroup.style.display = 'block';
  }
}

async function startSession(event, terminalId) {
  event.preventDefault();
  const form = event.target;
  const terminal = terminals.find(t => t.id === terminalId);
  const isGuest = document.querySelector('.session-type.active')?.dataset.type === 'guest';
  
  const data = {
    terminalId,
    terminalName: terminal.name,
    deviceType: terminal.type,
    memberId: isGuest ? null : form.memberId.value || null,
    memberUsername: isGuest ? 'Guest' : (form.memberId.options[form.memberId.selectedIndex]?.text.split(' (')[0] || 'Guest')
  };
  
  try {
    const res = await fetch(`${API_BASE}/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    
    closeModal('terminalModal');
    showToast('Session started!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function endSession(sessionId) {
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/end`, {
      method: 'POST'
    });
    
    if (!res.ok) throw new Error('Failed to end session');
    
    closeModal('terminalModal');
    showToast('Session ended!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function activateTerminal(terminalId) {
  try {
    await fetch(`${API_BASE}/terminals/${terminalId}/activate`, { method: 'POST' });
    closeModal('terminalModal');
    showToast('Terminal activated!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function showAddTerminalModal() {
  document.getElementById('terminalModalTitle').textContent = 'Add Terminal';
  document.getElementById('terminalModalContent').innerHTML = `
    <form onsubmit="addTerminal(event)">
      <div class="form-group">
        <label class="form-label">Terminal Name</label>
        <input type="text" class="form-input" name="name" placeholder="e.g., PC-11" required>
      </div>
      <div class="form-group">
        <label class="form-label">Type</label>
        <select class="form-select" name="type">
          <option value="PC">Gaming PC</option>
          <option value="XBOX">Xbox</option>
          <option value="PS">PlayStation</option>
        </select>
      </div>
      <button type="submit" class="btn btn-primary w-full">Add Terminal</button>
    </form>
  `;
  openModal('terminalModal');
}

async function addTerminal(event) {
  event.preventDefault();
  const form = event.target;
  
  try {
    const res = await fetch(`${API_BASE}/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.value,
        type: form.type.value
      })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    
    closeModal('terminalModal');
    showToast('Terminal added!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ==================== MEMBERS ====================

async function loadMembers() {
  try {
    const res = await fetch(`${API_BASE}/members`);
    members = await res.json();
    renderMembers(members);
  } catch (error) {
    showToast('Failed to load members', 'error');
  }
}

function renderMembers(membersList) {
  const html = membersList.map(m => `
    <tr>
      <td>${m.username}</td>
      <td>${m.displayName}</td>
      <td class="text-primary">₹${m.balance}</td>
      <td>${formatDuration(m.totalMinutes)}</td>
      <td>${m.sessionsCount}</td>
      <td><span class="badge badge-${m.status === 'active' ? 'success' : 'danger'}">${m.status}</span></td>
      <td>
        <button class="btn btn-success btn-sm" onclick="showRechargeModal('${m.id}', '${m.displayName}')">💰 Recharge</button>
      </td>
    </tr>
  `).join('');
  
  document.getElementById('membersTable').innerHTML = html || 
    '<tr><td colspan="7" class="text-center text-secondary">No members found</td></tr>';
}

function searchMembers(e) {
  const query = e.target.value.toLowerCase();
  const filtered = members.filter(m => 
    m.username.toLowerCase().includes(query) ||
    m.displayName.toLowerCase().includes(query)
  );
  renderMembers(filtered);
}

function showAddMemberModal() {
  openModal('memberModal');
}

async function addMember(event) {
  event.preventDefault();
  const form = event.target;
  
  try {
    const res = await fetch(`${API_BASE}/auth/member/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.username.value,
        displayName: form.displayName.value || form.username.value,
        password: form.password.value,
        balance: parseFloat(form.balance.value) || 0
      })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    
    closeModal('memberModal');
    form.reset();
    loadMembers();
    showToast('Member added!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function showRechargeModal(memberId, memberName) {
  document.getElementById('rechargeMemberId').value = memberId;
  document.getElementById('rechargeMemberName').value = memberName;
  openModal('rechargeModal');
}

async function rechargeMember(event) {
  event.preventDefault();
  const form = event.target;
  
  try {
    const res = await fetch(`${API_BASE}/members/${form.memberId.value}/recharge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: parseFloat(form.amount.value),
        paymentMethod: form.paymentMethod.value
      })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    
    closeModal('rechargeModal');
    form.reset();
    loadMembers();
    showToast('Balance recharged!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ==================== SESSIONS ====================

async function loadSessions() {
  const date = document.getElementById('sessionDate').value;
  
  try {
    const res = await fetch(`${API_BASE}/sessions?date=${date}`);
    const sessions = await res.json();
    renderSessions(sessions, 'sessionsTable');
  } catch (error) {
    showToast('Failed to load sessions', 'error');
  }
}

function renderSessions(sessions, containerId) {
  const html = sessions.map(s => `
    <tr>
      <td>${s.terminalName}</td>
      <td>${s.memberUsername}</td>
      <td><span class="badge badge-info">${s.deviceType}</span></td>
      <td>${formatTime(s.startTime)}</td>
      <td>${s.endTime ? formatTime(s.endTime) : '-'}</td>
      <td>${formatDuration(s.duration)}</td>
      <td>₹${s.cost?.toFixed(2) || '0.00'}</td>
      <td><span class="badge badge-${s.status === 'active' ? 'success' : 'info'}">${s.status}</span></td>
    </tr>
  `).join('');
  
  document.getElementById(containerId).innerHTML = html ||
    '<tr><td colspan="8" class="text-center text-secondary">No sessions found</td></tr>';
}

// ==================== BOOKINGS ====================

async function loadBookings() {
  const date = document.getElementById('bookingDate').value;
  
  try {
    const res = await fetch(`${API_BASE}/bookings?date=${date}`);
    const bookings = await res.json();
    renderBookings(bookings);
  } catch (error) {
    showToast('Failed to load bookings', 'error');
  }
}

function renderBookings(bookings) {
  const html = bookings.map(b => `
    <tr>
      <td>${b.memberUsername}</td>
      <td>${b.terminalName}</td>
      <td>${b.date}</td>
      <td>${b.startTime} - ${b.endTime}</td>
      <td>${b.duration} min</td>
      <td><span class="badge badge-${getBookingStatusBadge(b.status)}">${b.status}</span></td>
      <td>
        ${b.status === 'confirmed' ? `
          <button class="btn btn-danger btn-sm" onclick="cancelBooking('${b.id}')">Cancel</button>
        ` : ''}
      </td>
    </tr>
  `).join('');
  
  document.getElementById('bookingsTable').innerHTML = html ||
    '<tr><td colspan="7" class="text-center text-secondary">No bookings found</td></tr>';
}

function getBookingStatusBadge(status) {
  const badges = { confirmed: 'success', cancelled: 'danger', completed: 'info' };
  return badges[status] || 'info';
}

async function cancelBooking(bookingId) {
  if (!confirm('Cancel this booking?')) return;
  
  try {
    await fetch(`${API_BASE}/bookings/${bookingId}/cancel`, { method: 'POST' });
    loadBookings();
    showToast('Booking cancelled', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ==================== LEADERBOARD ====================

async function loadLeaderboard() {
  const period = document.getElementById('leaderboardPeriod').value;
  
  try {
    const res = await fetch(`${API_BASE}/stats/leaderboard?period=${period}`);
    const leaderboard = await res.json();
    renderLeaderboard(leaderboard);
  } catch (error) {
    showToast('Failed to load leaderboard', 'error');
  }
}

function renderLeaderboard(data) {
  const html = data.map((entry, i) => {
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    
    return `
      <div class="leaderboard-item ${i < 3 ? 'top-3' : ''}">
        <div class="leaderboard-rank ${rankClass}">${i + 1}</div>
        <div class="leaderboard-info">
          <div class="leaderboard-name">${entry.username}</div>
          <div class="leaderboard-stats">
            ${entry.sessionsCount} sessions • ₹${entry.totalSpent?.toFixed(0) || 0} spent
          </div>
        </div>
        <div class="leaderboard-time">${formatDuration(entry.totalMinutes)}</div>
      </div>
    `;
  }).join('');
  
  document.getElementById('leaderboardList').innerHTML = html ||
    '<p class="text-center text-secondary">No data available</p>';
}

// ==================== SETTINGS ====================

async function loadSettings() {
  try {
    const res = await fetch(`${API_BASE}/settings`);
    settings = await res.json();
    
    document.getElementById('rate-pc').value = settings.rates?.PC || 40;
    document.getElementById('rate-xbox').value = settings.rates?.XBOX || 60;
    document.getElementById('rate-ps').value = settings.rates?.PS || 100;
    document.getElementById('openTime').value = settings.openTime || '10:00';
    document.getElementById('closeTime').value = settings.closeTime || '23:00';
  } catch (error) {
    showToast('Failed to load settings', 'error');
  }
}

async function saveRates() {
  try {
    await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rates: {
          PC: parseInt(document.getElementById('rate-pc').value),
          XBOX: parseInt(document.getElementById('rate-xbox').value),
          PS: parseInt(document.getElementById('rate-ps').value)
        }
      })
    });
    showToast('Rates saved!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function saveHours() {
  try {
    await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        openTime: document.getElementById('openTime').value,
        closeTime: document.getElementById('closeTime').value
      })
    });
    showToast('Hours saved!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function downloadBackup() {
  window.location.href = `${API_BASE}/stats/export`;
}

// ==================== UTILITIES ====================

function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  
  setTimeout(() => toast.remove(), 3000);
}

function formatDuration(minutes) {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(isoString) {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function updateClock() {
  const now = new Date();
  document.getElementById('currentTime').textContent = now.toLocaleTimeString('en-IN');
}

function updateStats() {
  const available = terminals.filter(t => t.status === 'available').length;
  const active = terminals.filter(t => t.status === 'occupied').length;
  document.getElementById('stat-terminals').textContent = `${available}/${terminals.length}`;
  document.getElementById('stat-sessions').textContent = active;
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function logout() {
  localStorage.removeItem('token');
  window.location.href = '/';
}

// Load settings on init
loadSettings();
