/**
 * Client SDK API Endpoints
 * REST API for external applications to authenticate users
 * Similar to Auth0 Management API / Clerk Backend API
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, query, param, validationResult } = require('express-validator');

const User = require('../../models/User');
const Application = require('../../models/Application');
const ApiKey = require('../../models/ApiKey');
const Organization = require('../../models/Organization');
const OAuthToken = require('../../models/OAuthToken');
const MagicLink = require('../../models/MagicLink');
const AuditLog = require('../../models/AuditLog');
const { sendEmail } = require('../../utils/emailSender');

// ============================================
// API Key Authentication Middleware
// ============================================

const authenticateApiKey = async (req, res, next) => {
  try {
    const authHeader = req.get('Authorization');
    let secretKey;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      secretKey = authHeader.substring(7);
    } else if (req.query.api_key) {
      secretKey = req.query.api_key;
    }
    
    if (!secretKey) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'API key required. Provide via Authorization: Bearer <key> header'
      });
    }
    
    const apiKey = await ApiKey.findBySecretKey(secretKey);
    
    if (!apiKey) {
      return res.status(401).json({
        error: 'invalid_api_key',
        message: 'Invalid or expired API key'
      });
    }
    
    // Check rate limits
    if (!apiKey.checkRateLimit()) {
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Rate limit exceeded. Please slow down.',
        retryAfter: 60
      });
    }
    
    // Check IP restrictions
    if (apiKey.restrictions.ipAddresses.length > 0) {
      const clientIp = req.ip;
      if (!apiKey.restrictions.ipAddresses.includes(clientIp)) {
        return res.status(403).json({
          error: 'ip_not_allowed',
          message: 'Request from this IP address is not allowed'
        });
      }
    }
    
    // Record usage
    await apiKey.recordUsage(true);
    
    // Load organization
    const organization = await Organization.findById(apiKey.organization);
    if (!organization || organization.status !== 'active') {
      return res.status(403).json({
        error: 'organization_inactive',
        message: 'Organization is not active'
      });
    }
    
    req.apiKey = apiKey;
    req.organization = organization;
    next();
  } catch (error) {
    console.error('API auth error:', error);
    res.status(500).json({
      error: 'server_error',
      message: 'Authentication failed'
    });
  }
};

// Check API key scope
const requireScope = (...requiredScopes) => {
  return (req, res, next) => {
    const hasScope = requiredScopes.some(scope => 
      req.apiKey.scopes.includes(scope) || req.apiKey.scopes.includes('*')
    );
    
    if (!hasScope) {
      return res.status(403).json({
        error: 'insufficient_scope',
        message: `This operation requires one of these scopes: ${requiredScopes.join(', ')}`
      });
    }
    
    next();
  };
};

// Apply authentication to all routes
router.use(authenticateApiKey);

// ============================================
// Users API
// ============================================

/**
 * @route GET /api/sdk/users
 * @desc List users in organization
 */
router.get('/users',
  requireScope('users:read', 'users:write'),
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('email').optional().isEmail(),
    query('search').optional().trim()
  ],
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      
      // Build filter
      const filter = { organization: req.organization._id };
      
      if (req.query.email) {
        filter.email = req.query.email.toLowerCase();
      }
      
      if (req.query.search) {
        filter.$or = [
          { email: new RegExp(req.query.search, 'i') },
          { username: new RegExp(req.query.search, 'i') }
        ];
      }
      
      const [users, total] = await Promise.all([
        User.find(filter)
          .select('-password -twoFactorSecret')
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 }),
        User.countDocuments(filter)
      ]);
      
      res.json({
        data: users.map(formatUser),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore: page * limit < total
        }
      });
    } catch (error) {
      console.error('List users error:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to list users' });
    }
  }
);

/**
 * @route POST /api/sdk/users
 * @desc Create a new user
 */
router.post('/users',
  requireScope('users:write'),
  [
    body('email').isEmail().normalizeEmail(),
    body('password').optional().isLength({ min: 8 }),
    body('username').optional().trim().isLength({ min: 3, max: 30 }),
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('emailVerified').optional().isBoolean(),
    body('metadata').optional().isObject()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'validation_error', details: errors.array() });
      }
      
      const { email, password, username, firstName, lastName, emailVerified, metadata } = req.body;
      
      // Check if user exists
      const existingUser = await User.findOne({ 
        email: email.toLowerCase(),
        organization: req.organization._id
      });
      
      if (existingUser) {
        return res.status(409).json({
          error: 'user_exists',
          message: 'A user with this email already exists'
        });
      }
      
      // Generate password if not provided
      const finalPassword = password || crypto.randomBytes(16).toString('base64');
      
      // Create user
      const user = new User({
        email: email.toLowerCase(),
        username: username || email.split('@')[0],
        password: finalPassword,
        organization: req.organization._id,
        isVerified: emailVerified || false,
        profile: {
          firstName,
          lastName
        },
        metadata: metadata || {}
      });
      
      await user.save();
      
      // Log event
      await AuditLog.logEvent({
        action: 'user_created_via_api',
        userId: user._id,
        status: 'success',
        details: { 
          organizationId: req.organization._id,
          apiKeyId: req.apiKey._id
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      res.status(201).json({
        data: formatUser(user),
        message: 'User created successfully'
      });
    } catch (error) {
      console.error('Create user error:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to create user' });
    }
  }
);

/**
 * @route GET /api/sdk/users/:userId
 * @desc Get user by ID
 */
router.get('/users/:userId',
  requireScope('users:read', 'users:write'),
  async (req, res) => {
    try {
      const user = await User.findOne({
        _id: req.params.userId,
        organization: req.organization._id
      }).select('-password -twoFactorSecret');
      
      if (!user) {
        return res.status(404).json({
          error: 'not_found',
          message: 'User not found'
        });
      }
      
      res.json({ data: formatUser(user) });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to get user' });
    }
  }
);

/**
 * @route PATCH /api/sdk/users/:userId
 * @desc Update user
 */
router.patch('/users/:userId',
  requireScope('users:write'),
  [
    body('email').optional().isEmail().normalizeEmail(),
    body('username').optional().trim().isLength({ min: 3, max: 30 }),
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('emailVerified').optional().isBoolean(),
    body('blocked').optional().isBoolean(),
    body('metadata').optional().isObject()
  ],
  async (req, res) => {
    try {
      const user = await User.findOne({
        _id: req.params.userId,
        organization: req.organization._id
      });
      
      if (!user) {
        return res.status(404).json({
          error: 'not_found',
          message: 'User not found'
        });
      }
      
      const { email, username, firstName, lastName, emailVerified, blocked, metadata } = req.body;
      
      if (email) user.email = email.toLowerCase();
      if (username) user.username = username;
      if (firstName !== undefined) user.profile.firstName = firstName;
      if (lastName !== undefined) user.profile.lastName = lastName;
      if (emailVerified !== undefined) user.isVerified = emailVerified;
      if (blocked !== undefined) user.isBlocked = blocked;
      if (metadata) user.metadata = { ...user.metadata, ...metadata };
      
      await user.save();
      
      res.json({
        data: formatUser(user),
        message: 'User updated successfully'
      });
    } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to update user' });
    }
  }
);

/**
 * @route DELETE /api/sdk/users/:userId
 * @desc Delete user
 */
router.delete('/users/:userId',
  requireScope('users:delete'),
  async (req, res) => {
    try {
      const user = await User.findOneAndDelete({
        _id: req.params.userId,
        organization: req.organization._id
      });
      
      if (!user) {
        return res.status(404).json({
          error: 'not_found',
          message: 'User not found'
        });
      }
      
      // Revoke all tokens
      await OAuthToken.revokeAllForUser(user._id);
      
      // Log event
      await AuditLog.logEvent({
        action: 'user_deleted_via_api',
        status: 'success',
        details: { 
          userId: user._id,
          organizationId: req.organization._id,
          apiKeyId: req.apiKey._id
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      res.json({ message: 'User deleted successfully' });
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to delete user' });
    }
  }
);

// ============================================
// Authentication API
// ============================================

/**
 * @route POST /api/sdk/auth/verify-password
 * @desc Verify user password (for custom auth flows)
 */
router.post('/auth/verify-password',
  requireScope('auth:verify'),
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
  ],
  async (req, res) => {
    try {
      const { email, password } = req.body;
      
      const user = await User.findOne({
        email: email.toLowerCase(),
        organization: req.organization._id
      });
      
      if (!user) {
        return res.status(401).json({
          error: 'invalid_credentials',
          message: 'Invalid email or password'
        });
      }
      
      if (user.isBlocked) {
        return res.status(403).json({
          error: 'user_blocked',
          message: 'This account has been blocked'
        });
      }
      
      const isMatch = await user.comparePassword(password);
      
      if (!isMatch) {
        return res.status(401).json({
          error: 'invalid_credentials',
          message: 'Invalid email or password'
        });
      }
      
      res.json({
        valid: true,
        user: formatUser(user)
      });
    } catch (error) {
      console.error('Verify password error:', error);
      res.status(500).json({ error: 'server_error', message: 'Verification failed' });
    }
  }
);

/**
 * @route POST /api/sdk/auth/tokens
 * @desc Generate tokens for a user (after external verification)
 */
router.post('/auth/tokens',
  requireScope('tokens:create'),
  [
    body('userId').notEmpty(),
    body('scope').optional()
  ],
  async (req, res) => {
    try {
      const { userId, scope = 'openid profile email' } = req.body;
      
      const user = await User.findOne({
        _id: userId,
        organization: req.organization._id
      });
      
      if (!user) {
        return res.status(404).json({
          error: 'not_found',
          message: 'User not found'
        });
      }
      
      // Find or create default application for API tokens
      let application = await Application.findOne({
        organization: req.organization._id,
        type: 'machine-to-machine',
        isDefault: true
      });
      
      if (!application) {
        application = new Application({
          name: 'API Token Application',
          type: 'machine-to-machine',
          organization: req.organization._id,
          isDefault: true,
          isFirstParty: true
        });
        await application.save();
      }
      
      const scopes = scope.split(' ');
      const expiresIn = 3600; // 1 hour
      
      // Generate access token
      const { plainToken: accessToken } = await OAuthToken.generate({
        type: 'access_token',
        user: user._id,
        application: application._id,
        organization: req.organization._id,
        scope: scopes,
        expiresAt: new Date(Date.now() + expiresIn * 1000)
      });
      
      // Generate refresh token
      const { plainToken: refreshToken } = await OAuthToken.generate({
        type: 'refresh_token',
        user: user._id,
        application: application._id,
        organization: req.organization._id,
        scope: scopes,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      });
      
      res.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
        scope: scopes.join(' ')
      });
    } catch (error) {
      console.error('Generate tokens error:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to generate tokens' });
    }
  }
);

/**
 * @route POST /api/sdk/auth/magic-link
 * @desc Send magic link to user
 */
router.post('/auth/magic-link',
  requireScope('auth:magic-link'),
  [
    body('email').isEmail().normalizeEmail(),
    body('redirectUrl').isURL()
  ],
  async (req, res) => {
    try {
      const { email, redirectUrl } = req.body;
      
      // Find or create user
      let user = await User.findOne({
        email: email.toLowerCase(),
        organization: req.organization._id
      });
      
      if (!user) {
        // Create user for magic link
        user = new User({
          email: email.toLowerCase(),
          username: email.split('@')[0],
          password: crypto.randomBytes(32).toString('hex'), // Random password
          organization: req.organization._id,
          isVerified: false
        });
        await user.save();
      }
      
      // Generate magic link
      const magicLink = new MagicLink({
        user: user._id,
        organization: req.organization._id,
        redirectUrl,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      await magicLink.save();
      
      // Build magic link URL
      const magicUrl = `${process.env.APP_URL}/auth/magic/${magicLink.token}`;
      
      // Send email
      await sendEmail({
        to: user.email,
        subject: `Sign in to ${req.organization.name}`,
        html: `
          <h2>Sign in to ${req.organization.name}</h2>
          <p>Click the button below to sign in. This link expires in 15 minutes.</p>
          <a href="${magicUrl}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:white;text-decoration:none;border-radius:6px;">
            Sign In
          </a>
          <p style="color:#666;font-size:12px;margin-top:20px;">
            If you didn't request this, you can safely ignore this email.
          </p>
        `
      });
      
      res.json({
        message: 'Magic link sent',
        expiresIn: 900 // 15 minutes
      });
    } catch (error) {
      console.error('Magic link error:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to send magic link' });
    }
  }
);

/**
 * @route POST /api/sdk/auth/revoke
 * @desc Revoke user tokens
 */
router.post('/auth/revoke',
  requireScope('tokens:revoke'),
  [
    body('userId').notEmpty()
  ],
  async (req, res) => {
    try {
      const { userId } = req.body;
      
      const user = await User.findOne({
        _id: userId,
        organization: req.organization._id
      });
      
      if (!user) {
        return res.status(404).json({
          error: 'not_found',
          message: 'User not found'
        });
      }
      
      await OAuthToken.revokeAllForUser(userId);
      
      res.json({ message: 'All tokens revoked' });
    } catch (error) {
      console.error('Revoke tokens error:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to revoke tokens' });
    }
  }
);

// ============================================
// Sessions API
// ============================================

/**
 * @route GET /api/sdk/users/:userId/sessions
 * @desc List user sessions
 */
router.get('/users/:userId/sessions',
  requireScope('sessions:read'),
  async (req, res) => {
    try {
      const tokens = await OAuthToken.find({
        user: req.params.userId,
        organization: req.organization._id,
        type: { $in: ['access_token', 'refresh_token'] },
        status: 'active'
      }).select('type scope ipAddress userAgent deviceInfo createdAt expiresAt');
      
      res.json({
        data: tokens.map(t => ({
          id: t._id,
          type: t.type,
          scope: t.scope,
          ipAddress: t.ipAddress,
          userAgent: t.userAgent,
          device: t.deviceInfo,
          createdAt: t.createdAt,
          expiresAt: t.expiresAt
        }))
      });
    } catch (error) {
      console.error('List sessions error:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to list sessions' });
    }
  }
);

/**
 * @route DELETE /api/sdk/users/:userId/sessions/:sessionId
 * @desc Revoke specific session
 */
router.delete('/users/:userId/sessions/:sessionId',
  requireScope('sessions:revoke'),
  async (req, res) => {
    try {
      const token = await OAuthToken.findOne({
        _id: req.params.sessionId,
        user: req.params.userId,
        organization: req.organization._id
      });
      
      if (!token) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Session not found'
        });
      }
      
      await token.revoke('api_revoked');
      
      res.json({ message: 'Session revoked' });
    } catch (error) {
      console.error('Revoke session error:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to revoke session' });
    }
  }
);

// ============================================
// Organization API
// ============================================

/**
 * @route GET /api/sdk/organization
 * @desc Get organization details
 */
router.get('/organization',
  requireScope('organization:read'),
  async (req, res) => {
    try {
      res.json({
        data: {
          id: req.organization._id,
          name: req.organization.name,
          slug: req.organization.slug,
          plan: req.organization.plan,
          usage: {
            activeUsers: req.organization.usage.currentMonthActiveUsers,
            apiCalls: req.organization.usage.currentMonthApiCalls
          },
          limits: req.organization.limits,
          createdAt: req.organization.createdAt
        }
      });
    } catch (error) {
      console.error('Get organization error:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to get organization' });
    }
  }
);

/**
 * @route GET /api/sdk/stats
 * @desc Get organization statistics
 */
router.get('/stats',
  requireScope('analytics:read'),
  async (req, res) => {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      const [totalUsers, newUsers, logins, failedLogins] = await Promise.all([
        User.countDocuments({ organization: req.organization._id }),
        User.countDocuments({
          organization: req.organization._id,
          createdAt: { $gte: thirtyDaysAgo }
        }),
        AuditLog.countDocuments({
          'details.organizationId': req.organization._id,
          action: 'login',
          createdAt: { $gte: thirtyDaysAgo }
        }),
        AuditLog.countDocuments({
          'details.organizationId': req.organization._id,
          action: 'login_failed',
          createdAt: { $gte: thirtyDaysAgo }
        })
      ]);
      
      res.json({
        data: {
          totalUsers,
          newUsersLast30Days: newUsers,
          loginsLast30Days: logins,
          failedLoginsLast30Days: failedLogins,
          apiCallsThisMonth: req.organization.usage.currentMonthApiCalls
        }
      });
    } catch (error) {
      console.error('Get stats error:', error);
      res.status(500).json({ error: 'server_error', message: 'Failed to get stats' });
    }
  }
);

// ============================================
// Helper Functions
// ============================================

function formatUser(user) {
  return {
    id: user._id,
    email: user.email,
    username: user.username,
    emailVerified: user.isVerified,
    blocked: user.isBlocked || false,
    profile: {
      firstName: user.profile?.firstName,
      lastName: user.profile?.lastName,
      avatar: user.profile?.avatar
    },
    metadata: user.metadata || {},
    mfaEnabled: user.twoFactorEnabled || false,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

module.exports = router;
