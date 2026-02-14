const express = require('express');
const router = express.Router();
const passport = require('passport');
const User = require('../../models/User');
const { generateJWT, verifyJWT, verify2FAToken, generate2FACode } = require('../../utils/security');
const { ensureApiAuthenticated } = require('../../config/auth');
const { logAuditEvent, getClientIp } = require('../../middleware/auditLogger');
const { 
  registerValidation, 
  loginValidation,
  changePasswordValidation,
  twoFactorValidation,
  handleValidationErrors 
} = require('../../middleware/validators');
const { authLimiter, registrationLimiter } = require('../../middleware/rateLimiter');

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', registrationLimiter, registerValidation, handleValidationErrors, async (req, res) => {
  const { username, email, password, firstName, lastName } = req.body;
  
  try {
    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    
    if (existingUser) {
      return res.status(400).json({
        status: 400,
        error: 'User exists',
        message: existingUser.email === email ? 'Email is already registered' : 'Username is already taken'
      });
    }
    
    // Create user
    const user = new User({
      username,
      email,
      password,
      firstName,
      lastName,
      isVerified: false
    });
    
    await user.save();
    
    // Generate JWT
    const token = generateJWT(user.id);
    
    res.status(201).json({
      status: 201,
      message: 'Registration successful',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName
        },
        token
      }
    });
    
  } catch (error) {
    console.error('API registration error:', error);
    res.status(500).json({
      status: 500,
      error: 'Server Error',
      message: 'An error occurred during registration'
    });
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Login user and return JWT
 * @access  Public
 */
router.post('/login', authLimiter, loginValidation, handleValidationErrors, async (req, res) => {
  const { email, password, twoFactorToken } = req.body;
  
  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(401).json({
        status: 401,
        error: 'Authentication failed',
        message: 'Invalid email or password'
      });
    }
    
    // Check account lock
    if (user.accountLocked && user.accountLockedUntil > Date.now()) {
      const remainingTime = Math.ceil((user.accountLockedUntil - Date.now()) / 60000);
      return res.status(423).json({
        status: 423,
        error: 'Account locked',
        message: `Account is locked due to multiple failed login attempts. Try again in ${remainingTime} minutes.`
      });
    }
    
    // Verify password
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      await user.incrementLoginAttempts();
      return res.status(401).json({
        status: 401,
        error: 'Authentication failed',
        message: 'Invalid email or password'
      });
    }
    
    // Check 2FA
    if (user.twoFactorEnabled) {
      if (!twoFactorToken) {
        return res.status(200).json({
          status: 200,
          requiresTwoFactor: true,
          message: 'Two-factor authentication required'
        });
      }
      
      const isValidToken = verify2FAToken(twoFactorToken, user.twoFactorSecret);
      if (!isValidToken) {
        return res.status(401).json({
          status: 401,
          error: 'Invalid 2FA token',
          message: 'Two-factor authentication code is invalid'
        });
      }
    }
    
    // Reset login attempts
    await user.resetLoginAttempts();
    
    // Update last login
    user.lastLogin = new Date();
    await user.save();
    
    // Generate tokens
    const token = generateJWT(user.id);
    const refreshToken = generateJWT(user.id, '7d');
    
    res.json({
      status: 200,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isVerified: user.isVerified,
          twoFactorEnabled: user.twoFactorEnabled
        },
        token,
        refreshToken,
        expiresIn: 3600 // 1 hour
      }
    });
    
  } catch (error) {
    console.error('API login error:', error);
    res.status(500).json({
      status: 500,
      error: 'Server Error',
      message: 'An error occurred during login'
    });
  }
});

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh JWT token
 * @access  Public (with valid refresh token)
 */
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(400).json({
      status: 400,
      error: 'Bad Request',
      message: 'Refresh token is required'
    });
  }
  
  try {
    const { valid, expired, decoded } = verifyJWT(refreshToken);
    
    if (!valid) {
      return res.status(401).json({
        status: 401,
        error: 'Invalid token',
        message: expired ? 'Refresh token has expired' : 'Invalid refresh token'
      });
    }
    
    // Verify user still exists
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        status: 401,
        error: 'User not found',
        message: 'User no longer exists'
      });
    }
    
    // Generate new tokens
    const newToken = generateJWT(user.id);
    const newRefreshToken = generateJWT(user.id, '7d');
    
    res.json({
      status: 200,
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
        expiresIn: 3600
      }
    });
    
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      status: 500,
      error: 'Server Error',
      message: 'An error occurred while refreshing token'
    });
  }
});

/**
 * @route   GET /api/auth/me
 * @desc    Get current user
 * @access  Private
 */
router.get('/me', ensureApiAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -twoFactorSecret -verificationToken -resetPasswordToken');
    
    if (!user) {
      return res.status(404).json({
        status: 404,
        error: 'Not Found',
        message: 'User not found'
      });
    }
    
    res.json({
      status: 200,
      data: { user }
    });
    
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      status: 500,
      error: 'Server Error',
      message: 'An error occurred'
    });
  }
});

/**
 * @route   PUT /api/auth/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile', ensureApiAuthenticated, async (req, res) => {
  const { username, firstName, lastName } = req.body;
  
  try {
    const user = await User.findById(req.user.id);
    
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({
          status: 400,
          error: 'Username taken',
          message: 'Username is already in use'
        });
      }
      user.username = username;
    }
    
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    
    await user.save();
    
    res.json({
      status: 200,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName
        }
      }
    });
    
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      status: 500,
      error: 'Server Error',
      message: 'An error occurred'
    });
  }
});

/**
 * @route   POST /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.post('/change-password', ensureApiAuthenticated, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      status: 400,
      error: 'Bad Request',
      message: 'Current password and new password are required'
    });
  }
  
  try {
    const user = await User.findById(req.user.id);
    
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        status: 400,
        error: 'Invalid password',
        message: 'Current password is incorrect'
      });
    }
    
    user.password = newPassword;
    await user.save();
    
    res.json({
      status: 200,
      message: 'Password changed successfully'
    });
    
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      status: 500,
      error: 'Server Error',
      message: 'An error occurred'
    });
  }
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout (client should discard token)
 * @access  Private
 */
router.post('/logout', ensureApiAuthenticated, (req, res) => {
  // In JWT auth, logout is client-side (discard token)
  // This endpoint exists for audit logging and future token blacklisting
  res.json({
    status: 200,
    message: 'Logout successful'
  });
});

/**
 * @route   GET /api/auth/verify
 * @desc    Verify if token is valid
 * @access  Private
 */
router.get('/verify', ensureApiAuthenticated, (req, res) => {
  res.json({
    status: 200,
    valid: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role
    }
  });
});

module.exports = router;
