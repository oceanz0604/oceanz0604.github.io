/**
 * CyberCafe Manager - Member Portal
 */

const API_BASE = '/api';
const socket = io();

// State
let member = null;
let settings = {};
let terminals = [];
let selectedDevice = 'PC';
let selectedTerminal = null;
let selectedDuration = 120;

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
  // Check if already logged in
  const token = localStorage.getItem('memberToken');
  if (token) {
    try {
      const res = await fetch(`${API_BASE}/auth/verify`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.valid && data.user.type === 'member') {
          await loadMemberData(data.user.id);
          showDashboard();
        }
      }
    } catch (e) {
      localStorage.removeItem('memberToken');
    }
  }
  
  // Load settings
  await loadSettings();
  
  // Set default date
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('bookingDate').value = today;
  document.getElementById('bookingDate').min = today;
  
  // Load time slots
  loadTimeSlots();
  loadSlots();
  
  // Socket events
  socket.on('terminals:status', (data) => {
    terminals = data;
    renderSlots();
  });
  
  socket.on('member:updated', (data) => {
    if (member && data.id === member.id) {
      member.balance = data.balance;
      updateMemberUI();
    }
  });
});

// ==================== AUTHENTICATION ====================

async function login(event) {
  event.preventDefault();
  const form = event.target;
  
  try {
    const res = await fetch(`${API_BASE}/auth/member/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.username.value,
        password: form.password.value
      })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    
    const data = await res.json();
    localStorage.setItem('memberToken', data.token);
    member = data.user;
    
    showDashboard();
    showToast('Welcome back!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function logout() {
  localStorage.removeItem('memberToken');
  member = null;
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  updateMemberUI();
  loadHistory();
  loadSlots();
}

async function loadMemberData(memberId) {
  try {
    const res = await fetch(`${API_BASE}/members/${memberId}`);
    member = await res.json();
    updateMemberUI();
  } catch (error) {
    console.error('Failed to load member data', error);
  }
}

function updateMemberUI() {
  if (!member) return;
  
  document.getElementById('memberName').textContent = member.displayName;
  document.getElementById('memberUsername').textContent = member.username;
  document.getElementById('memberBalance').textContent = member.balance?.toFixed(0) || 0;
  document.getElementById('memberTime').textContent = formatDuration(member.totalMinutes);
  document.getElementById('memberSessions').textContent = member.sessionsCount || 0;
  document.getElementById('memberSpent').textContent = `₹${member.totalSpent?.toFixed(0) || 0}`;
}

// ==================== SETTINGS ====================

async function loadSettings() {
  try {
    const res = await fetch(`${API_BASE}/settings`);
    settings = await res.json();
    
    // Update device rates in UI
    document.querySelectorAll('.device-btn').forEach(btn => {
      const type = btn.dataset.type;
      const rate = settings.rates?.[type] || 40;
      btn.querySelector('.device-rate').textContent = rate;
    });
    
    updateSummary();
  } catch (error) {
    console.error('Failed to load settings', error);
  }
}

// ==================== TABS ====================

function showTab(tabName) {
  // Update buttons
  document.querySelectorAll('[id^="tab-"]').forEach(btn => {
    btn.className = btn.id === `tab-${tabName}` ? 'btn btn-primary' : 'btn btn-ghost';
  });
  
  // Show content
  document.querySelectorAll('[id^="content-"]').forEach(el => {
    el.classList.toggle('hidden', el.id !== `content-${tabName}`);
  });
  
  // Load data
  if (tabName === 'history') loadHistory();
  if (tabName === 'leaderboard') loadLeaderboard();
}

// ==================== BOOKING ====================

function selectDevice(btn) {
  document.querySelectorAll('.device-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedDevice = btn.dataset.type;
  selectedTerminal = null;
  loadSlots();
  updateSummary();
}

async function loadSlots() {
  try {
    const res = await fetch(`${API_BASE}/terminals?type=${selectedDevice}`);
    terminals = await res.json();
    renderSlots();
  } catch (error) {
    showToast('Failed to load terminals', 'error');
  }
}

function renderSlots() {
  const filtered = terminals.filter(t => t.type === selectedDevice);
  
  const html = filtered.map(t => `
    <div class="slot-card ${t.status === 'occupied' ? 'occupied' : ''} ${selectedTerminal?.id === t.id ? 'selected' : ''}"
      onclick="${t.status !== 'occupied' ? `selectSlot('${t.id}')` : ''}">
      <div style="font-size: 1.5rem; margin-bottom: 4px;">
        ${t.status === 'available' ? '✅' : t.status === 'occupied' ? '🔴' : '🔧'}
      </div>
      <div style="font-weight: 600;">${t.name}</div>
      <div style="font-size: 0.75rem; color: var(--text-muted);">
        ${t.status === 'occupied' ? 'In Use' : t.status}
      </div>
    </div>
  `).join('');
  
  document.getElementById('slotGrid').innerHTML = html || 
    '<p class="text-secondary">No terminals available</p>';
}

function selectSlot(terminalId) {
  selectedTerminal = terminals.find(t => t.id === terminalId);
  renderSlots();
  updateSummary();
}

function selectDuration(btn) {
  document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedDuration = parseInt(btn.dataset.duration);
  updateSummary();
}

function loadTimeSlots() {
  const select = document.getElementById('startTime');
  const openHour = parseInt(settings.openTime?.split(':')[0]) || 10;
  const closeHour = parseInt(settings.closeTime?.split(':')[0]) || 23;
  
  let html = '';
  for (let h = openHour; h < closeHour; h++) {
    for (let m = 0; m < 60; m += 30) {
      const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      html += `<option value="${time}">${time}</option>`;
    }
  }
  
  select.innerHTML = html;
  
  // Set current time as default
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${(Math.ceil(now.getMinutes() / 30) * 30 % 60).toString().padStart(2, '0')}`;
  select.value = currentTime;
  
  updateSummary();
}

function updateSummary() {
  const deviceNames = { PC: 'Gaming PC', XBOX: 'Xbox', PS: 'PlayStation' };
  const rate = settings.rates?.[selectedDevice] || 40;
  const cost = (selectedDuration / 60) * rate;
  
  const startTime = document.getElementById('startTime').value;
  const [hours, mins] = startTime.split(':').map(Number);
  const endMins = hours * 60 + mins + selectedDuration;
  const endTime = `${Math.floor(endMins / 60).toString().padStart(2, '0')}:${(endMins % 60).toString().padStart(2, '0')}`;
  
  document.getElementById('summaryDevice').textContent = deviceNames[selectedDevice];
  document.getElementById('summaryTerminal').textContent = selectedTerminal?.name || 'Not selected';
  document.getElementById('summaryDate').textContent = document.getElementById('bookingDate').value;
  document.getElementById('summaryTime').textContent = `${startTime} - ${endTime}`;
  document.getElementById('summaryDuration').textContent = `${selectedDuration / 60} Hour${selectedDuration > 60 ? 's' : ''}`;
  document.getElementById('summaryCost').textContent = `₹${cost}`;
}

async function confirmBooking() {
  if (!member) {
    showToast('Please login first', 'error');
    return;
  }
  
  if (!selectedTerminal) {
    showToast('Please select a terminal', 'error');
    return;
  }
  
  const rate = settings.rates?.[selectedDevice] || 40;
  const cost = (selectedDuration / 60) * rate;
  
  if (member.balance < cost) {
    showToast('Insufficient balance', 'error');
    return;
  }
  
  const startTime = document.getElementById('startTime').value;
  const [hours, mins] = startTime.split(':').map(Number);
  const endMins = hours * 60 + mins + selectedDuration;
  const endTime = `${Math.floor(endMins / 60).toString().padStart(2, '0')}:${(endMins % 60).toString().padStart(2, '0')}`;
  
  const bookingData = {
    memberId: member.id,
    memberUsername: member.displayName,
    terminalId: selectedTerminal.id,
    terminalName: selectedTerminal.name,
    deviceType: selectedDevice,
    date: document.getElementById('bookingDate').value,
    startTime: startTime,
    endTime: endTime,
    duration: selectedDuration
  };
  
  try {
    const res = await fetch(`${API_BASE}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingData)
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error);
    }
    
    showToast('Booking confirmed! 🎉', 'success');
    selectedTerminal = null;
    loadSlots();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ==================== HISTORY ====================

async function loadHistory() {
  if (!member) return;
  
  try {
    const [transactions, sessions] = await Promise.all([
      fetch(`${API_BASE}/members/${member.id}/transactions`).then(r => r.json()),
      fetch(`${API_BASE}/members/${member.id}/sessions`).then(r => r.json())
    ]);
    
    renderTransactions(transactions);
    renderSessionHistory(sessions);
  } catch (error) {
    showToast('Failed to load history', 'error');
  }
}

function renderTransactions(transactions) {
  const html = transactions
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20)
    .map(t => `
      <div class="history-card">
        <div class="history-icon">
          ${t.type === 'recharge' ? '💰' : '🎮'}
        </div>
        <div class="history-info">
          <div class="history-title">${t.type === 'recharge' ? 'Balance Recharge' : 'Session Payment'}</div>
          <div class="history-meta">${formatDate(t.createdAt)} • ${t.paymentMethod}</div>
        </div>
        <div class="history-amount ${t.amount >= 0 ? 'positive' : 'negative'}">
          ${t.amount >= 0 ? '+' : ''}₹${Math.abs(t.amount).toFixed(0)}
        </div>
      </div>
    `).join('');
  
  document.getElementById('historyList').innerHTML = html || 
    '<p class="text-center text-secondary">No transactions yet</p>';
}

function renderSessionHistory(sessions) {
  const html = sessions
    .filter(s => s.status === 'completed')
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
    .slice(0, 20)
    .map(s => `
      <div class="history-card">
        <div class="history-icon">
          ${getDeviceIcon(s.deviceType)}
        </div>
        <div class="history-info">
          <div class="history-title">${s.terminalName}</div>
          <div class="history-meta">${formatDate(s.startTime)} • ${formatDuration(s.duration)}</div>
        </div>
        <div class="history-amount negative">
          -₹${s.cost?.toFixed(0) || 0}
        </div>
      </div>
    `).join('');
  
  document.getElementById('sessionHistory').innerHTML = html || 
    '<p class="text-center text-secondary">No sessions yet</p>';
}

// ==================== LEADERBOARD ====================

async function loadLeaderboard() {
  const period = document.getElementById('leaderboardPeriod').value;
  
  try {
    const res = await fetch(`${API_BASE}/stats/leaderboard?period=${period}`);
    const data = await res.json();
    renderLeaderboard(data);
  } catch (error) {
    showToast('Failed to load leaderboard', 'error');
  }
}

function renderLeaderboard(data) {
  const html = data.map((entry, i) => {
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const isMe = member && entry.username === member.displayName;
    
    return `
      <div class="leaderboard-item ${i < 3 ? 'top-3' : ''}" style="${isMe ? 'border-color: var(--primary);' : ''}">
        <div class="leaderboard-rank ${rankClass}">${i + 1}</div>
        <div class="leaderboard-info">
          <div class="leaderboard-name">${entry.username} ${isMe ? '(You)' : ''}</div>
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

// ==================== UTILITIES ====================

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

function formatDate(isoString) {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getDeviceIcon(type) {
  const icons = { PC: '🖥️', XBOX: '🎮', PS: '🎮' };
  return icons[type] || '🖥️';
}
