/**
 * Bookings Routes
 * Handle advance bookings for terminals
 */

import { Router } from 'express';
import Database from '../db/db.js';

const router = Router();

// Get all bookings
router.get('/', (req, res) => {
  try {
    const { date, status, memberId } = req.query;
    let bookings = Database.bookings.getAll();
    
    if (date) {
      bookings = bookings.filter(b => b.date === date);
    }
    
    if (status) {
      bookings = bookings.filter(b => b.status === status);
    }
    
    if (memberId) {
      bookings = bookings.filter(b => b.memberId === memberId);
    }
    
    // Sort by date and start time
    bookings.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    });
    
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get upcoming bookings
router.get('/upcoming', (req, res) => {
  try {
    const bookings = Database.bookings.getUpcoming();
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bookings for a specific date
router.get('/date/:date', (req, res) => {
  try {
    const bookings = Database.bookings.getByDate(req.params.date);
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get booking by ID
router.get('/:id', (req, res) => {
  try {
    const booking = Database.bookings.getAll().find(b => b.id === req.params.id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.json(booking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new booking
router.post('/', async (req, res) => {
  try {
    const { 
      memberId, 
      memberUsername, 
      terminalId, 
      terminalName,
      deviceType,
      date, 
      startTime, 
      endTime, 
      duration 
    } = req.body;
    
    if (!memberId || !terminalId || !date || !startTime) {
      return res.status(400).json({ 
        error: 'Member ID, Terminal ID, date, and start time required' 
      });
    }

    // Check for conflicts
    const existingBookings = Database.bookings.getByDate(date);
    const conflict = existingBookings.find(b => 
      b.terminalId === terminalId &&
      b.status === 'confirmed' &&
      ((startTime >= b.startTime && startTime < b.endTime) ||
       (endTime > b.startTime && endTime <= b.endTime) ||
       (startTime <= b.startTime && endTime >= b.endTime))
    );

    if (conflict) {
      return res.status(409).json({ 
        error: 'Time slot already booked',
        conflictingBooking: conflict
      });
    }

    // Get rate
    const rates = Database.settings.getRates();
    const rate = rates[deviceType || 'PC'];
    const estimatedCost = (duration / 60) * rate;

    const booking = await Database.bookings.create({
      memberId,
      memberUsername,
      terminalId,
      terminalName,
      deviceType: deviceType || 'PC',
      date,
      startTime,
      endTime,
      duration,
      rate,
      estimatedCost
    });

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('booking:created', booking);
    }

    res.status(201).json(booking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel booking
router.post('/:id/cancel', async (req, res) => {
  try {
    const booking = await Database.bookings.cancel(req.params.id);
    
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('booking:cancelled', booking);
    }

    res.json({ success: true, booking });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark booking as completed
router.post('/:id/complete', async (req, res) => {
  try {
    const booking = await Database.bookings.complete(req.params.id);
    
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('booking:completed', booking);
    }

    res.json({ success: true, booking });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check availability for a date and terminal
router.get('/check-availability/:terminalId/:date', (req, res) => {
  try {
    const { terminalId, date } = req.params;
    const bookings = Database.bookings.getByDate(date)
      .filter(b => b.terminalId === terminalId && b.status === 'confirmed');
    
    // Generate available time slots (10:00 - 23:00, 1-hour slots)
    const settings = Database.settings.get();
    const openHour = parseInt(settings.openTime.split(':')[0]);
    const closeHour = parseInt(settings.closeTime.split(':')[0]);
    
    const slots = [];
    for (let hour = openHour; hour < closeHour; hour++) {
      const slotStart = `${hour.toString().padStart(2, '0')}:00`;
      const slotEnd = `${(hour + 1).toString().padStart(2, '0')}:00`;
      
      const isBooked = bookings.some(b => 
        (slotStart >= b.startTime && slotStart < b.endTime) ||
        (slotEnd > b.startTime && slotEnd <= b.endTime)
      );
      
      slots.push({
        startTime: slotStart,
        endTime: slotEnd,
        available: !isBooked
      });
    }
    
    res.json({ terminalId, date, slots });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
