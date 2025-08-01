const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const SQLUser = require('../models/User');

// Generate JWT token
const generateToken = (userId, role) => {
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '24h' }
  );
};

// Verify JWT token
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
  } catch (error) {
    return null;
  }
};

// Find user by email (SQL database)
const findUserByEmail = async (email) => {
  try {
    return await SQLUser.findByEmail(email);
  } catch (error) {
    console.error('Error finding user by email:', error);
    return null;
  }
};

// Find user by ID (SQL database)
const findUserById = async (id) => {
  try {
    return await SQLUser.findById(id);
  } catch (error) {
    console.error('Error finding user by ID:', error);
    return null;
  }
};

// Create new user (SQL database)
const createUser = async (userData) => {
  try {
    return await SQLUser.create(userData);
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
};

// Update user (SQL database)
const updateUser = async (id, updateData) => {
  try {
    const user = await SQLUser.findById(id);
    if (!user) return null;
    
    return await user.update(updateData);
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
};

// Initialize default users in SQL database
const initializeSQLUsers = async () => {
  try {
    const defaultUsers = [
      {
        email: 'hr@ongc.co.in',
        password: 'password123',
        name: 'HR Manager',
        role: 'hr_manager',
        department: 'Human Resources',
        employeeId: 'HR001',
        isActive: true
      },
      {
        email: 'admin@ongc.co.in',
        password: 'admin123',
        name: 'System Administrator',
        role: 'admin',
        department: 'IT',
        employeeId: 'IT001',
        isActive: true
      },
      {
        email: 'viewer@ongc.co.in',
        password: 'viewer123',
        name: 'Data Viewer',
        role: 'viewer',
        department: 'HR',
        employeeId: 'HR002',
        isActive: true
      }
    ];

    for (const userData of defaultUsers) {
      const existingUser = await findUserByEmail(userData.email);
      if (!existingUser) {
        await createUser(userData);
        console.log(`✅ Created default user: ${userData.email}`);
      }
    }
    
    console.log('✅ SQL Users initialization completed');
  } catch (error) {
    console.error('❌ Error initializing SQL users:', error);
  }
};

// Check if SQL database is connected
const isSQLConnected = async () => {
  try {
    await SQLUser.sequelize.authenticate();
    return true;
  } catch (error) {
    return false;
  }
};

module.exports = {
  generateToken,
  verifyToken,
  findUserByEmail,
  findUserById,
  createUser,
  updateUser,
  initializeSQLUsers,
  isSQLConnected
}; 