const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { ensureAuthenticated, ensureVerified } = require('../config/auth');
const { logAuditEvent } = require('../middleware/auditLogger');
const { profileUpdateValidation, handleValidationErrors } = require('../middleware/validators');

// Get user profile
router.get('/profile', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.render('profile', { user, csrfToken: req.csrfToken() });
  } catch (error) {
    console.error('Profile fetch error:', error);
    req.flash('error_msg', 'Error loading profile');
    res.redirect('/dashboard');
  }
});

// Update profile
router.post('/profile', ensureAuthenticated, profileUpdateValidation, handleValidationErrors, async (req, res) => {
  const { username, firstName, lastName } = req.body;
  
  try {
    const user = await User.findById(req.user.id);
    
    // Check if username is taken (if changed)
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        req.flash('error_msg', 'Username is already taken');
        return res.redirect('/users/profile');
      }
      user.username = username;
    }
    
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    
    await user.save();
    
    await logAuditEvent(req, 'PROFILE_UPDATE', 'success', { 
      userId: user.id,
      fields: Object.keys(req.body).filter(k => k !== '_csrf')
    });
    
    req.flash('success_msg', 'Profile updated successfully');
    res.redirect('/users/profile');
    
  } catch (error) {
    console.error('Profile update error:', error);
    req.flash('error_msg', 'Error updating profile');
    res.redirect('/users/profile');
  }
});

// Account settings page
router.get('/settings', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.render('settings', { user, csrfToken: req.csrfToken() });
  } catch (error) {
    console.error('Settings fetch error:', error);
    req.flash('error_msg', 'Error loading settings');
    res.redirect('/dashboard');
  }
});

// Delete account
router.post('/delete-account', ensureAuthenticated, async (req, res) => {
  const { password, confirmDelete } = req.body;
  
  if (confirmDelete !== 'DELETE') {
    req.flash('error_msg', 'Please type DELETE to confirm account deletion');
    return res.redirect('/users/settings');
  }
  
  try {
    const user = await User.findById(req.user.id);
    
    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      req.flash('error_msg', 'Incorrect password');
      return res.redirect('/users/settings');
    }
    
    // Log before deletion
    await logAuditEvent(req, 'ACCOUNT_DELETED', 'success', { 
      userId: user.id,
      email: user.email
    });
    
    // Delete user
    await User.findByIdAndDelete(req.user.id);
    
    req.logout((err) => {
      if (err) console.error('Logout error:', err);
      
      req.session.destroy((err) => {
        if (err) console.error('Session destroy error:', err);
        res.redirect('/');
      });
    });
    
  } catch (error) {
    console.error('Account deletion error:', error);
    req.flash('error_msg', 'Error deleting account');
    res.redirect('/users/settings');
  }
});

// Activity log
router.get('/activity', ensureAuthenticated, async (req, res) => {
  try {
    const AuditLog = require('../models/AuditLog');
    const activities = await AuditLog.getUserActivity(req.user.id, 50);
    
    res.render('activity', { 
      activities,
      csrfToken: req.csrfToken()
    });
  } catch (error) {
    console.error('Activity log error:', error);
    req.flash('error_msg', 'Error loading activity log');
    res.redirect('/dashboard');
  }
});

// Active sessions (basic implementation)
router.get('/sessions', ensureAuthenticated, async (req, res) => {
  try {
    // In a full implementation, you'd query the session store
    // This is a simplified version showing current session
    res.render('sessions', { 
      currentSession: {
        id: req.sessionID,
        createdAt: req.session.cookie._expires,
        userAgent: req.get('user-agent'),
        ip: req.ip
      },
      csrfToken: req.csrfToken()
    });
  } catch (error) {
    console.error('Sessions error:', error);
    req.flash('error_msg', 'Error loading sessions');
    res.redirect('/dashboard');
  }
});

module.exports = router;
