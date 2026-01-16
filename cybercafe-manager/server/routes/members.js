/**
 * Members Routes
 * CRUD operations for members
 */

import { Router } from 'express';
import Database from '../db/db.js';

const router = Router();

// Get all members
router.get('/', (req, res) => {
  try {
    const members = Database.members.getAll().map(m => ({
      id: m.id,
      username: m.username,
      displayName: m.displayName,
      email: m.email,
      phone: m.phone,
      balance: m.balance,
      totalMinutes: m.totalMinutes,
      totalSpent: m.totalSpent,
      sessionsCount: m.sessionsCount,
      status: m.status,
      createdAt: m.createdAt
    }));
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get member by ID
router.get('/:id', (req, res) => {
  try {
    const member = Database.members.getById(req.params.id);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    // Don't send password
    const { password, ...memberData } = member;
    res.json(memberData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get member's sessions
router.get('/:id/sessions', (req, res) => {
  try {
    const sessions = Database.sessions.getByMemberId(req.params.id);
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get member's transactions
router.get('/:id/transactions', (req, res) => {
  try {
    const transactions = Database.transactions.getByMemberId(req.params.id);
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get member's bookings
router.get('/:id/bookings', (req, res) => {
  try {
    const bookings = Database.bookings.getAll().filter(
      b => b.memberId === req.params.id
    );
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update member
router.put('/:id', async (req, res) => {
  try {
    const { displayName, email, phone, status } = req.body;
    
    const member = await Database.members.update(req.params.id, {
      displayName,
      email,
      phone,
      status
    });
    
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    const { password, ...memberData } = member;
    res.json(memberData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Recharge member balance
router.post('/:id/recharge', async (req, res) => {
  try {
    const { amount, paymentMethod, staffId } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const member = Database.members.getById(req.params.id);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Update balance
    await Database.members.updateBalance(req.params.id, amount);
    
    // Create transaction record
    await Database.transactions.create({
      memberId: member.id,
      memberUsername: member.username,
      type: 'recharge',
      amount: amount,
      paymentMethod: paymentMethod || 'cash',
      description: `Balance recharge: ₹${amount}`,
      staffId
    });

    const updatedMember = Database.members.getById(req.params.id);
    
    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('member:updated', { 
        id: updatedMember.id, 
        balance: updatedMember.balance 
      });
    }

    res.json({
      success: true,
      newBalance: updatedMember.balance,
      message: `Recharged ₹${amount} successfully`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete member
router.delete('/:id', async (req, res) => {
  try {
    const success = await Database.members.delete(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json({ success: true, message: 'Member deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leaderboard
router.get('/stats/leaderboard', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const leaderboard = Database.members.getLeaderboard(limit);
    res.json(leaderboard);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search members
router.get('/search/:query', (req, res) => {
  try {
    const query = req.params.query.toLowerCase();
    const members = Database.members.getAll()
      .filter(m => 
        m.username.toLowerCase().includes(query) ||
        m.displayName.toLowerCase().includes(query) ||
        (m.email && m.email.toLowerCase().includes(query))
      )
      .map(m => ({
        id: m.id,
        username: m.username,
        displayName: m.displayName,
        balance: m.balance
      }));
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
