/**
 * Database Initialization Script
 * Run this once to set up initial data
 */

import Database from './db.js';
import bcrypt from 'bcryptjs';

async function initializeDatabase() {
  console.log('🚀 Initializing CyberCafe Manager Database...\n');

  // Create default admin
  const existingAdmin = Database.admins.getByUsername('admin');
  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await Database.admins.create({
      username: 'admin',
      password: hashedPassword,
      role: 'superadmin'
    });
    console.log('✅ Default admin created (username: admin, password: admin123)');
  } else {
    console.log('ℹ️  Admin already exists');
  }

  // Create sample terminals
  const terminals = Database.terminals.getAll();
  if (terminals.length === 0) {
    const terminalConfigs = [
      // Gaming PCs
      { name: 'PC-01', type: 'PC' },
      { name: 'PC-02', type: 'PC' },
      { name: 'PC-03', type: 'PC' },
      { name: 'PC-04', type: 'PC' },
      { name: 'PC-05', type: 'PC' },
      { name: 'PC-06', type: 'PC' },
      { name: 'PC-07', type: 'PC' },
      { name: 'PC-08', type: 'PC' },
      { name: 'PC-09', type: 'PC' },
      { name: 'PC-10', type: 'PC' },
      // Consoles
      { name: 'XBOX-01', type: 'XBOX' },
      { name: 'PS-01', type: 'PS' },
      { name: 'PS-02', type: 'PS' }
    ];

    for (const config of terminalConfigs) {
      await Database.terminals.create(config);
    }
    console.log(`✅ Created ${terminalConfigs.length} terminals`);
  } else {
    console.log(`ℹ️  ${terminals.length} terminals already exist`);
  }

  // Create sample members
  const members = Database.members.getAll();
  if (members.length === 0) {
    const sampleMembers = [
      { username: 'saish0007', displayName: 'Saish', balance: 500 },
      { username: 'player1', displayName: 'Player One', balance: 200 },
      { username: 'gamer99', displayName: 'Pro Gamer', balance: 1000 },
      { username: 'ninja_x', displayName: 'Ninja X', balance: 300 },
      { username: 'shadow', displayName: 'Shadow', balance: 150 }
    ];

    for (const memberData of sampleMembers) {
      const hashedPassword = await bcrypt.hash('member123', 10);
      await Database.members.create({
        ...memberData,
        password: hashedPassword
      });
    }
    console.log(`✅ Created ${sampleMembers.length} sample members`);
  } else {
    console.log(`ℹ️  ${members.length} members already exist`);
  }

  // Display stats
  const stats = Database.getStats();
  console.log('\n📊 Database Statistics:');
  console.log(`   Members: ${stats.totalMembers}`);
  console.log(`   Terminals: ${stats.totalTerminals}`);
  console.log(`   Active Sessions: ${stats.activeSessions}`);

  console.log('\n✨ Database initialization complete!');
  console.log('   Run "npm start" to start the server\n');
}

initializeDatabase().catch(console.error);
