const express = require('express');
const router = express.Router();
const { 
  generateToken, 
  verifyToken, 
  findUserByEmail, 
  findUserById, 
  createUser, 
  updateUser,
  isSQLConnected 
} = require('../utils/authHelpers');

// Middleware for authentication
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    const user = await findUserById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive user' });
    }

    req.user = user.toJSON();
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Middleware for role-based access
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// Login route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }
    
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }
    
    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is deactivated' 
      });
    }
    
    // Check password
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }
    
    // Update last login
    await updateUser(user.id, { lastLogin: new Date() });
    
    // Generate token
    const token = generateToken(user.id, user.role);
    
    // Return user data without password
    const userData = user.toJSON();
    
    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: userData
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Verify token route
router.get('/verify', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Token is valid',
    user: req.user
  });
});

// Get current user profile
router.get('/profile', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// Register new user (admin only)
router.post('/register', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { email, password, name, role, department, employeeId } = req.body;
    
    if (!email || !password || !name || !role) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email, password, name, and role are required' 
      });
    }
    
    // Check if user already exists
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'User with this email already exists' 
      });
    }
    
    // Create new user
    const newUser = await createUser({
      email,
      password,
      name,
      role,
      department,
      employeeId,
      isActive: true
    });
    
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: newUser.toJSON()
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, department, employeeId } = req.body;
    const userId = req.user.id;
    
    const updateData = {};
    if (name) updateData.name = name;
    if (department) updateData.department = department;
    if (employeeId) updateData.employeeId = employeeId;
    
    const updatedUser = await updateUser(userId, updateData);
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser.toJSON()
    });
    
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Change password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Current password and new password are required' 
      });
    }
    
    const user = await findUserById(userId);
    const isValidPassword = await user.comparePassword(currentPassword);
    
    if (!isValidPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Current password is incorrect' 
      });
    }
    
    await updateUser(userId, { password: newPassword });
    
    res.json({
      success: true,
      message: 'Password changed successfully'
    });
    
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get all users (admin only)
router.get('/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const SQLUser = require('../models/User');
    const users = await SQLUser.findAll({
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']]
    });
    
    res.json({
      success: true,
      users: users.map(user => user.toJSON())
    });
    
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Toggle user active status (admin only)
router.put('/users/:id/toggle-status', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await findUserById(userId);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    const updatedUser = await updateUser(userId, { isActive: !user.isActive });
    
    res.json({
      success: true,
      message: `User ${updatedUser.isActive ? 'activated' : 'deactivated'} successfully`,
      user: updatedUser.toJSON()
    });
    
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

module.exports = {
  router,
  authenticateToken,
  requireRole
}; 