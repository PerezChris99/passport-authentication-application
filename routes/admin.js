const express = require('express');
const router = express.Router();
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { ensureAuthenticated, ensureAdmin } = require('../config/auth');
const { logAuditEvent } = require('../middleware/auditLogger');
const { userIdValidation, paginationValidation, handleValidationErrors } = require('../middleware/validators');

// Admin middleware - check on all routes
router.use(ensureAuthenticated, ensureAdmin);

// ==========================================
// DASHBOARD
// ==========================================

router.get('/', async (req, res) => {
  try {
    const [
      totalUsers,
      verifiedUsers,
      lockedUsers,
      recentLogins,
      recentRegistrations
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isVerified: true }),
      User.countDocuments({ accountLocked: true }),
      AuditLog.countDocuments({ 
        action: 'LOGIN_SUCCESS', 
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }),
      User.countDocuments({ 
        date: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      })
    ]);
    
    res.render('admin/dashboard', {
      stats: {
        totalUsers,
        verifiedUsers,
        lockedUsers,
        recentLogins,
        recentRegistrations
      },
      csrfToken: req.csrfToken()
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    req.flash('error_msg', 'Error loading dashboard');
    res.redirect('/dashboard');
  }
});

// ==========================================
// USER MANAGEMENT
// ==========================================

// List all users
router.get('/users', paginationValidation, handleValidationErrors, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = req.query.search || '';
  const skip = (page - 1) * limit;
  
  try {
    let query = {};
    
    if (search) {
      query = {
        $or: [
          { username: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } }
        ]
      };
    }
    
    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password -twoFactorSecret -verificationToken -resetPasswordToken')
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query)
    ]);
    
    const totalPages = Math.ceil(total / limit);
    
    res.render('admin/users', {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      search,
      csrfToken: req.csrfToken()
    });
  } catch (error) {
    console.error('Admin users list error:', error);
    req.flash('error_msg', 'Error loading users');
    res.redirect('/admin');
  }
});

// View single user
router.get('/users/:id', userIdValidation, handleValidationErrors, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -twoFactorSecret -verificationToken -resetPasswordToken')
      .lean();
    
    if (!user) {
      req.flash('error_msg', 'User not found');
      return res.redirect('/admin/users');
    }
    
    // Get user's recent activity
    const recentActivity = await AuditLog.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    
    res.render('admin/user-detail', {
      targetUser: user,
      recentActivity,
      csrfToken: req.csrfToken()
    });
  } catch (error) {
    console.error('Admin user detail error:', error);
    req.flash('error_msg', 'Error loading user');
    res.redirect('/admin/users');
  }
});

// Update user
router.post('/users/:id', userIdValidation, handleValidationErrors, async (req, res) => {
  const { role, isVerified } = req.body;
  
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      req.flash('error_msg', 'User not found');
      return res.redirect('/admin/users');
    }
    
    // Prevent self-demotion
    if (user.id === req.user.id && role !== 'admin') {
      req.flash('error_msg', 'You cannot change your own admin role');
      return res.redirect(`/admin/users/${req.params.id}`);
    }
    
    const changes = {};
    
    if (role && ['user', 'admin'].includes(role)) {
      changes.role = { from: user.role, to: role };
      user.role = role;
    }
    
    if (isVerified !== undefined) {
      changes.isVerified = { from: user.isVerified, to: isVerified === 'true' };
      user.isVerified = isVerified === 'true';
    }
    
    await user.save();
    
    await logAuditEvent(req, 'ADMIN_USER_UPDATE', 'success', {
      targetUserId: user.id,
      changes
    });
    
    req.flash('success_msg', 'User updated successfully');
    res.redirect(`/admin/users/${req.params.id}`);
    
  } catch (error) {
    console.error('Admin user update error:', error);
    req.flash('error_msg', 'Error updating user');
    res.redirect(`/admin/users/${req.params.id}`);
  }
});

// Unlock user account
router.post('/users/:id/unlock', userIdValidation, handleValidationErrors, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      req.flash('error_msg', 'User not found');
      return res.redirect('/admin/users');
    }
    
    user.accountLocked = false;
    user.accountLockedUntil = undefined;
    user.failedLoginAttempts = 0;
    await user.save();
    
    await logAuditEvent(req, 'ADMIN_USER_UNLOCK', 'success', {
      targetUserId: user.id
    });
    
    req.flash('success_msg', 'User account unlocked');
    res.redirect(`/admin/users/${req.params.id}`);
    
  } catch (error) {
    console.error('Admin unlock user error:', error);
    req.flash('error_msg', 'Error unlocking user');
    res.redirect(`/admin/users/${req.params.id}`);
  }
});

// Delete user
router.post('/users/:id/delete', userIdValidation, handleValidationErrors, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      req.flash('error_msg', 'User not found');
      return res.redirect('/admin/users');
    }
    
    // Prevent self-deletion
    if (user.id === req.user.id) {
      req.flash('error_msg', 'You cannot delete your own account from admin panel');
      return res.redirect(`/admin/users/${req.params.id}`);
    }
    
    await logAuditEvent(req, 'ADMIN_USER_DELETE', 'success', {
      targetUserId: user.id,
      targetEmail: user.email
    });
    
    await User.findByIdAndDelete(req.params.id);
    
    req.flash('success_msg', 'User deleted successfully');
    res.redirect('/admin/users');
    
  } catch (error) {
    console.error('Admin delete user error:', error);
    req.flash('error_msg', 'Error deleting user');
    res.redirect('/admin/users');
  }
});

// ==========================================
// AUDIT LOGS
// ==========================================

router.get('/audit-logs', paginationValidation, handleValidationErrors, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const action = req.query.action || '';
  const skip = (page - 1) * limit;
  
  try {
    let query = {};
    
    if (action) {
      query.action = action;
    }
    
    const [logs, total, actionTypes] = await Promise.all([
      AuditLog.find(query)
        .populate('userId', 'username email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(query),
      AuditLog.distinct('action')
    ]);
    
    const totalPages = Math.ceil(total / limit);
    
    res.render('admin/audit-logs', {
      logs,
      actionTypes,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      selectedAction: action,
      csrfToken: req.csrfToken()
    });
  } catch (error) {
    console.error('Admin audit logs error:', error);
    req.flash('error_msg', 'Error loading audit logs');
    res.redirect('/admin');
  }
});

// ==========================================
// SYSTEM SETTINGS (placeholder)
// ==========================================

router.get('/settings', (req, res) => {
  res.render('admin/settings', {
    csrfToken: req.csrfToken()
  });
});

module.exports = router;
