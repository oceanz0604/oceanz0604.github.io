/**
 * Statistics Routes
 * Dashboard stats and reports
 */

import { Router } from 'express';
import Database from '../db/db.js';

const router = Router();

// Get dashboard stats
router.get('/dashboard', (req, res) => {
  try {
    const stats = Database.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get revenue stats
router.get('/revenue', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const transactions = Database.transactions.getAll();
    
    let filtered = transactions;
    if (startDate) {
      filtered = filtered.filter(t => t.createdAt >= startDate);
    }
    if (endDate) {
      filtered = filtered.filter(t => t.createdAt <= endDate);
    }

    const recharges = filtered.filter(t => t.type === 'recharge');
    
    const stats = {
      totalRecharges: recharges.reduce((sum, t) => sum + t.amount, 0),
      rechargeCount: recharges.length,
      byCashMethod: recharges.filter(t => t.paymentMethod === 'cash')
        .reduce((sum, t) => sum + t.amount, 0),
      byUpiMethod: recharges.filter(t => t.paymentMethod === 'upi')
        .reduce((sum, t) => sum + t.amount, 0),
      byCardMethod: recharges.filter(t => t.paymentMethod === 'card')
        .reduce((sum, t) => sum + t.amount, 0)
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get member stats
router.get('/members', (req, res) => {
  try {
    const members = Database.members.getAll();
    
    const stats = {
      total: members.length,
      active: members.filter(m => m.status === 'active').length,
      inactive: members.filter(m => m.status !== 'active').length,
      totalBalance: members.reduce((sum, m) => sum + (m.balance || 0), 0),
      totalMinutes: members.reduce((sum, m) => sum + (m.totalMinutes || 0), 0),
      totalSpent: members.reduce((sum, m) => sum + (m.totalSpent || 0), 0),
      avgBalance: members.length > 0 
        ? members.reduce((sum, m) => sum + (m.balance || 0), 0) / members.length 
        : 0
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leaderboard
router.get('/leaderboard', (req, res) => {
  try {
    const { period, limit } = req.query;
    const maxLimit = parseInt(limit) || 50;
    
    if (period === 'monthly') {
      // Get current month's sessions
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      
      const sessions = Database.sessions.getAll()
        .filter(s => s.status === 'completed' && s.startTime >= monthStart);
      
      // Aggregate by member
      const memberStats = {};
      sessions.forEach(s => {
        if (s.memberId) {
          if (!memberStats[s.memberId]) {
            memberStats[s.memberId] = {
              memberId: s.memberId,
              username: s.memberUsername,
              totalMinutes: 0,
              sessionsCount: 0,
              totalSpent: 0
            };
          }
          memberStats[s.memberId].totalMinutes += s.duration;
          memberStats[s.memberId].sessionsCount += 1;
          memberStats[s.memberId].totalSpent += s.cost;
        }
      });

      const leaderboard = Object.values(memberStats)
        .sort((a, b) => b.totalMinutes - a.totalMinutes)
        .slice(0, maxLimit)
        .map((m, i) => ({ ...m, rank: i + 1 }));

      res.json(leaderboard);
    } else if (period === 'weekly') {
      // Get current week's sessions
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      
      const sessions = Database.sessions.getAll()
        .filter(s => s.status === 'completed' && s.startTime >= weekStart.toISOString());
      
      // Aggregate by member
      const memberStats = {};
      sessions.forEach(s => {
        if (s.memberId) {
          if (!memberStats[s.memberId]) {
            memberStats[s.memberId] = {
              memberId: s.memberId,
              username: s.memberUsername,
              totalMinutes: 0,
              sessionsCount: 0,
              totalSpent: 0
            };
          }
          memberStats[s.memberId].totalMinutes += s.duration;
          memberStats[s.memberId].sessionsCount += 1;
          memberStats[s.memberId].totalSpent += s.cost;
        }
      });

      const leaderboard = Object.values(memberStats)
        .sort((a, b) => b.totalMinutes - a.totalMinutes)
        .slice(0, maxLimit)
        .map((m, i) => ({ ...m, rank: i + 1 }));

      res.json(leaderboard);
    } else {
      // All-time leaderboard
      res.json(Database.members.getLeaderboard(maxLimit));
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get daily report
router.get('/daily/:date', (req, res) => {
  try {
    const { date } = req.params;
    
    const sessions = Database.sessions.getAll()
      .filter(s => s.startTime.startsWith(date));
    
    const transactions = Database.transactions.getAll()
      .filter(t => t.createdAt.startsWith(date));

    const completed = sessions.filter(s => s.status === 'completed');
    
    const report = {
      date,
      sessions: {
        total: sessions.length,
        completed: completed.length,
        active: sessions.filter(s => s.status === 'active').length,
        guest: completed.filter(s => s.isGuest).length,
        member: completed.filter(s => !s.isGuest).length,
        totalMinutes: completed.reduce((sum, s) => sum + s.duration, 0),
        totalRevenue: completed.reduce((sum, s) => sum + s.cost, 0)
      },
      transactions: {
        recharges: transactions.filter(t => t.type === 'recharge').length,
        rechargeAmount: transactions
          .filter(t => t.type === 'recharge')
          .reduce((sum, t) => sum + t.amount, 0),
        byCash: transactions
          .filter(t => t.paymentMethod === 'cash' && t.type === 'recharge')
          .reduce((sum, t) => sum + t.amount, 0),
        byUpi: transactions
          .filter(t => t.paymentMethod === 'upi' && t.type === 'recharge')
          .reduce((sum, t) => sum + t.amount, 0)
      },
      byDevice: {
        PC: completed.filter(s => s.deviceType === 'PC'),
        XBOX: completed.filter(s => s.deviceType === 'XBOX'),
        PS: completed.filter(s => s.deviceType === 'PS')
      }
    };

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export data (backup)
router.get('/export', (req, res) => {
  try {
    const data = Database.backup();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=cybercafe-backup-${new Date().toISOString().split('T')[0]}.json`);
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
