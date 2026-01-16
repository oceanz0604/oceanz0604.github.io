/**
 * Database Layer - JSON-based storage using LowDB
 * Simple, file-based database perfect for small-medium cyber cafes
 */

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'database.json');

// Default data structure
const defaultData = {
  members: [],
  sessions: [],
  terminals: [],
  bookings: [],
  transactions: [],
  settings: {
    rates: { PC: 40, XBOX: 60, PS: 100 },
    openTime: "10:00",
    closeTime: "23:00",
    currency: "₹",
    cafeName: "OceanZ Gaming Cafe"
  },
  admins: [],
  staff: []
};

// Initialize database
const adapter = new JSONFile(DB_PATH);
const db = new Low(adapter, defaultData);

// Load database
await db.read();

// If database is empty, set defaults
if (!db.data) {
  db.data = defaultData;
  await db.write();
}

/**
 * Database Helper Functions
 */
export const Database = {
  // ============ MEMBERS ============
  members: {
    getAll: () => db.data.members,
    
    getById: (id) => db.data.members.find(m => m.id === id),
    
    getByUsername: (username) => 
      db.data.members.find(m => m.username.toLowerCase() === username.toLowerCase()),
    
    create: async (memberData) => {
      const member = {
        id: uuidv4(),
        username: memberData.username,
        password: memberData.password, // Should be hashed
        displayName: memberData.displayName || memberData.username,
        email: memberData.email || '',
        phone: memberData.phone || '',
        balance: memberData.balance || 0,
        totalMinutes: 0,
        totalSpent: 0,
        sessionsCount: 0,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.data.members.push(member);
      await db.write();
      return member;
    },
    
    update: async (id, updates) => {
      const index = db.data.members.findIndex(m => m.id === id);
      if (index === -1) return null;
      
      db.data.members[index] = {
        ...db.data.members[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      await db.write();
      return db.data.members[index];
    },
    
    updateBalance: async (id, amount) => {
      const member = db.data.members.find(m => m.id === id);
      if (!member) return null;
      
      member.balance = (member.balance || 0) + amount;
      member.updatedAt = new Date().toISOString();
      await db.write();
      return member;
    },
    
    delete: async (id) => {
      const index = db.data.members.findIndex(m => m.id === id);
      if (index === -1) return false;
      
      db.data.members.splice(index, 1);
      await db.write();
      return true;
    },

    getLeaderboard: (limit = 50) => {
      return [...db.data.members]
        .sort((a, b) => b.totalMinutes - a.totalMinutes)
        .slice(0, limit)
        .map((m, i) => ({
          rank: i + 1,
          username: m.displayName,
          totalMinutes: m.totalMinutes,
          sessionsCount: m.sessionsCount,
          totalSpent: m.totalSpent
        }));
    }
  },

  // ============ SESSIONS ============
  sessions: {
    getAll: () => db.data.sessions,
    
    getActive: () => db.data.sessions.filter(s => s.status === 'active'),
    
    getByMemberId: (memberId) => 
      db.data.sessions.filter(s => s.memberId === memberId),
    
    getByTerminalId: (terminalId) => 
      db.data.sessions.filter(s => s.terminalId === terminalId),
    
    start: async (sessionData) => {
      const session = {
        id: uuidv4(),
        memberId: sessionData.memberId || null,
        memberUsername: sessionData.memberUsername || 'Guest',
        terminalId: sessionData.terminalId,
        terminalName: sessionData.terminalName,
        deviceType: sessionData.deviceType || 'PC',
        rate: sessionData.rate,
        startTime: new Date().toISOString(),
        endTime: null,
        duration: 0,
        cost: 0,
        status: 'active',
        isGuest: !sessionData.memberId
      };
      db.data.sessions.push(session);
      await db.write();
      return session;
    },
    
    end: async (sessionId) => {
      const session = db.data.sessions.find(s => s.id === sessionId);
      if (!session) return null;
      
      const endTime = new Date();
      const startTime = new Date(session.startTime);
      const durationMs = endTime - startTime;
      const durationMinutes = Math.ceil(durationMs / 60000);
      const cost = (durationMinutes / 60) * session.rate;
      
      session.endTime = endTime.toISOString();
      session.duration = durationMinutes;
      session.cost = Math.round(cost * 100) / 100;
      session.status = 'completed';
      
      // Update member stats if not guest
      if (session.memberId) {
        const member = db.data.members.find(m => m.id === session.memberId);
        if (member) {
          member.totalMinutes += durationMinutes;
          member.totalSpent += session.cost;
          member.sessionsCount += 1;
          member.balance -= session.cost;
          member.updatedAt = new Date().toISOString();
        }
      }
      
      await db.write();
      return session;
    },

    getToday: () => {
      const today = new Date().toISOString().split('T')[0];
      return db.data.sessions.filter(s => s.startTime.startsWith(today));
    }
  },

  // ============ TERMINALS ============
  terminals: {
    getAll: () => db.data.terminals,
    
    getById: (id) => db.data.terminals.find(t => t.id === id),
    
    getByName: (name) => db.data.terminals.find(t => t.name === name),
    
    getAvailable: () => db.data.terminals.filter(t => t.status === 'available'),
    
    create: async (terminalData) => {
      const terminal = {
        id: uuidv4(),
        name: terminalData.name,
        type: terminalData.type || 'PC',
        ipAddress: terminalData.ipAddress || '',
        status: 'available',
        currentSessionId: null,
        currentMember: null,
        lastActivity: new Date().toISOString()
      };
      db.data.terminals.push(terminal);
      await db.write();
      return terminal;
    },
    
    updateStatus: async (id, status, sessionId = null, memberInfo = null) => {
      const terminal = db.data.terminals.find(t => t.id === id);
      if (!terminal) return null;
      
      terminal.status = status;
      terminal.currentSessionId = sessionId;
      terminal.currentMember = memberInfo;
      terminal.lastActivity = new Date().toISOString();
      await db.write();
      return terminal;
    },
    
    delete: async (id) => {
      const index = db.data.terminals.findIndex(t => t.id === id);
      if (index === -1) return false;
      
      db.data.terminals.splice(index, 1);
      await db.write();
      return true;
    }
  },

  // ============ BOOKINGS ============
  bookings: {
    getAll: () => db.data.bookings,
    
    getUpcoming: () => {
      const now = new Date().toISOString();
      return db.data.bookings.filter(b => 
        b.status === 'confirmed' && b.startTime > now
      );
    },
    
    getByDate: (date) => 
      db.data.bookings.filter(b => b.date === date),
    
    create: async (bookingData) => {
      const booking = {
        id: uuidv4(),
        memberId: bookingData.memberId,
        memberUsername: bookingData.memberUsername,
        terminalId: bookingData.terminalId,
        terminalName: bookingData.terminalName,
        deviceType: bookingData.deviceType || 'PC',
        date: bookingData.date,
        startTime: bookingData.startTime,
        endTime: bookingData.endTime,
        duration: bookingData.duration,
        rate: bookingData.rate,
        estimatedCost: bookingData.estimatedCost,
        status: 'confirmed',
        createdAt: new Date().toISOString()
      };
      db.data.bookings.push(booking);
      await db.write();
      return booking;
    },
    
    cancel: async (id) => {
      const booking = db.data.bookings.find(b => b.id === id);
      if (!booking) return null;
      
      booking.status = 'cancelled';
      await db.write();
      return booking;
    },
    
    complete: async (id) => {
      const booking = db.data.bookings.find(b => b.id === id);
      if (!booking) return null;
      
      booking.status = 'completed';
      await db.write();
      return booking;
    }
  },

  // ============ TRANSACTIONS ============
  transactions: {
    getAll: () => db.data.transactions,
    
    getByMemberId: (memberId) => 
      db.data.transactions.filter(t => t.memberId === memberId),
    
    create: async (transactionData) => {
      const transaction = {
        id: uuidv4(),
        memberId: transactionData.memberId,
        memberUsername: transactionData.memberUsername,
        type: transactionData.type, // 'recharge', 'session', 'refund'
        amount: transactionData.amount,
        paymentMethod: transactionData.paymentMethod || 'cash',
        description: transactionData.description || '',
        staffId: transactionData.staffId,
        createdAt: new Date().toISOString()
      };
      db.data.transactions.push(transaction);
      await db.write();
      return transaction;
    },

    getToday: () => {
      const today = new Date().toISOString().split('T')[0];
      return db.data.transactions.filter(t => t.createdAt.startsWith(today));
    }
  },

  // ============ SETTINGS ============
  settings: {
    get: () => db.data.settings,
    
    update: async (updates) => {
      db.data.settings = { ...db.data.settings, ...updates };
      await db.write();
      return db.data.settings;
    },
    
    getRates: () => db.data.settings.rates,
    
    updateRates: async (rates) => {
      db.data.settings.rates = { ...db.data.settings.rates, ...rates };
      await db.write();
      return db.data.settings.rates;
    }
  },

  // ============ ADMINS & STAFF ============
  admins: {
    getAll: () => db.data.admins,
    
    getByUsername: (username) => 
      db.data.admins.find(a => a.username.toLowerCase() === username.toLowerCase()),
    
    create: async (adminData) => {
      const admin = {
        id: uuidv4(),
        username: adminData.username,
        password: adminData.password, // Should be hashed
        role: adminData.role || 'admin',
        createdAt: new Date().toISOString()
      };
      db.data.admins.push(admin);
      await db.write();
      return admin;
    }
  },

  // ============ UTILITIES ============
  save: async () => await db.write(),
  
  backup: () => JSON.stringify(db.data, null, 2),
  
  getStats: () => {
    const today = new Date().toISOString().split('T')[0];
    const todaySessions = db.data.sessions.filter(s => s.startTime.startsWith(today));
    const todayTransactions = db.data.transactions.filter(t => t.createdAt.startsWith(today));
    
    return {
      totalMembers: db.data.members.length,
      activeMembers: db.data.members.filter(m => m.status === 'active').length,
      totalTerminals: db.data.terminals.length,
      availableTerminals: db.data.terminals.filter(t => t.status === 'available').length,
      activeSessions: db.data.sessions.filter(s => s.status === 'active').length,
      todaySessions: todaySessions.length,
      todayRevenue: todayTransactions
        .filter(t => t.type === 'recharge')
        .reduce((sum, t) => sum + t.amount, 0),
      pendingBookings: db.data.bookings.filter(b => b.status === 'confirmed').length
    };
  }
};

export default Database;
