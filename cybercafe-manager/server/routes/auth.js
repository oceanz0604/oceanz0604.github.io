/**
 * Authentication Routes
 * Handles admin and member login/logout
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from '../db/db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'cybercafe-secret-key-2024';

// Admin Login
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const admin = Database.admins.getByUsername(username);
    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, admin.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role, type: 'admin' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: admin.id,
        username: admin.username,
        role: admin.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Member Login
router.post('/member/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const member = Database.members.getByUsername(username);
    if (!member) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (member.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    const validPassword = await bcrypt.compare(password, member.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: member.id, username: member.username, type: 'member' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: member.id,
        username: member.username,
        displayName: member.displayName,
        balance: member.balance,
        totalMinutes: member.totalMinutes,
        totalSpent: member.totalSpent,
        sessionsCount: member.sessionsCount
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify Token
router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Register new member (admin only)
router.post('/member/register', async (req, res) => {
  try {
    const { username, password, displayName, email, phone, balance } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Check if username exists
    const existing = Database.members.getByUsername(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const member = await Database.members.create({
      username,
      password: hashedPassword,
      displayName: displayName || username,
      email,
      phone,
      balance: balance || 0
    });

    res.status(201).json({
      success: true,
      member: {
        id: member.id,
        username: member.username,
        displayName: member.displayName,
        balance: member.balance
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Change password
router.post('/change-password', async (req, res) => {
  try {
    const { userId, currentPassword, newPassword, type } = req.body;
    
    let user;
    if (type === 'admin') {
      user = Database.admins.getAll().find(a => a.id === userId);
    } else {
      user = Database.members.getById(userId);
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    if (type === 'member') {
      await Database.members.update(userId, { password: hashedPassword });
    }

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
