/**
 * Developer Portal Routes
 * Manages organizations, applications, API keys, and webhooks
 */

const express = require('express');
const router = express.Router();
const { ensureAuthenticated, ensureVerified } = require('../config/auth');
const Organization = require('../models/Organization');
const Application = require('../models/Application');
const ApiKey = require('../models/ApiKey');
const Webhook = require('../models/Webhook');
const AuditLog = require('../models/AuditLog');
const { body, param, query, validationResult } = require('express-validator');

// ============================================
// Middleware
// ============================================

// Ensure user has an organization
const ensureOrganization = async (req, res, next) => {
  try {
    const org = await Organization.findOne({
      $or: [
        { owner: req.user._id },
        { 'members.user': req.user._id }
      ],
      status: 'active'
    });
    
    if (!org) {
      // Redirect to org creation
      return res.redirect('/developer/organizations/new');
    }
    
    req.organization = org;
    next();
  } catch (error) {
    next(error);
  }
};

// Load specific organization
const loadOrganization = async (req, res, next) => {
  try {
    const org = await Organization.findOne({
      slug: req.params.orgSlug,
      $or: [
        { owner: req.user._id },
        { 'members.user': req.user._id }
      ],
      status: 'active'
    });
    
    if (!org) {
      req.flash('error_msg', 'Organization not found');
      return res.redirect('/developer');
    }
    
    req.organization = org;
    next();
  } catch (error) {
    next(error);
  }
};

// Check organization permission
const requireOrgPermission = (requiredRole) => {
  return (req, res, next) => {
    if (!req.organization.hasPermission(req.user._id, requiredRole)) {
      req.flash('error_msg', 'You do not have permission to perform this action');
      return res.redirect(`/developer/${req.organization.slug}`);
    }
    next();
  };
};

// ============================================
// Dashboard
// ============================================

// Developer dashboard home
router.get('/', ensureAuthenticated, ensureVerified, async (req, res) => {
  try {
    const organizations = await Organization.find({
      $or: [
        { owner: req.user._id },
        { 'members.user': req.user._id }
      ],
      status: 'active'
    }).sort({ updatedAt: -1 });
    
    res.render('developer/dashboard', {
      title: 'Developer Dashboard',
      organizations
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading dashboard');
    res.redirect('/dashboard');
  }
});

// ============================================
// Organizations
// ============================================

// List organizations
router.get('/organizations', ensureAuthenticated, ensureVerified, async (req, res) => {
  try {
    const organizations = await Organization.find({
      $or: [
        { owner: req.user._id },
        { 'members.user': req.user._id }
      ],
      status: 'active'
    }).populate('owner', 'username email');
    
    res.render('developer/organizations', {
      title: 'Organizations',
      organizations
    });
  } catch (error) {
    console.error(error);
    req.flash('error_msg', 'Error loading organizations');
    res.redirect('/developer');
  }
});

// New organization form
router.get('/organizations/new', ensureAuthenticated, ensureVerified, (req, res) => {
  res.render('developer/organization-new', {
    title: 'Create Organization'
  });
});

// Create organization
router.post('/organizations', 
  ensureAuthenticated, 
  ensureVerified,
  [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
    body('description').optional().trim().isLength({ max: 500 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.render('developer/organization-new', {
          title: 'Create Organization',
          errors: errors.array(),
          values: req.body
        });
      }
      
      const { name, description } = req.body;
      const slug = await Organization.generateSlug(name);
      
      const organization = new Organization({
        name,
        slug,
        description,
        owner: req.user._id,
        members: [{
          user: req.user._id,
          role: 'owner',
          joinedAt: new Date()
        }]
      });
      
      await organization.save();
      
      await AuditLog.logEvent({
        action: 'organization_created',
        userId: req.user._id,
        status: 'success',
        details: { organizationId: organization._id, name },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      req.flash('success_msg', 'Organization created successfully');
      res.redirect(`/developer/${slug}`);
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error creating organization');
      res.redirect('/developer/organizations/new');
    }
  }
);

// Organization dashboard
router.get('/:orgSlug', 
  ensureAuthenticated, 
  ensureVerified, 
  loadOrganization,
  async (req, res) => {
    try {
      const [applications, apiKeys, webhooks, recentLogs] = await Promise.all([
        Application.find({ organization: req.organization._id, status: { $ne: 'deleted' } }),
        ApiKey.find({ organization: req.organization._id, status: 'active' }),
        Webhook.find({ organization: req.organization._id, status: { $ne: 'disabled' } }),
        AuditLog.find({ 'details.organizationId': req.organization._id })
          .sort({ createdAt: -1 })
          .limit(10)
      ]);
      
      res.render('developer/organization-dashboard', {
        title: req.organization.name,
        org: req.organization,
        applications,
        apiKeys,
        webhooks,
        recentLogs,
        userRole: req.organization.getUserRole(req.user._id)
      });
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error loading organization');
      res.redirect('/developer');
    }
  }
);

// Organization settings
router.get('/:orgSlug/settings', 
  ensureAuthenticated, 
  ensureVerified, 
  loadOrganization,
  requireOrgPermission('admin'),
  (req, res) => {
    res.render('developer/organization-settings', {
      title: 'Organization Settings',
      org: req.organization
    });
  }
);

// Update organization
router.post('/:orgSlug/settings',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('admin'),
  [
    body('name').trim().notEmpty().isLength({ max: 100 }),
    body('description').optional().trim().isLength({ max: 500 })
  ],
  async (req, res) => {
    try {
      const { name, description } = req.body;
      
      req.organization.name = name;
      req.organization.description = description;
      await req.organization.save();
      
      req.flash('success_msg', 'Organization updated');
      res.redirect(`/developer/${req.organization.slug}/settings`);
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error updating organization');
      res.redirect(`/developer/${req.organization.slug}/settings`);
    }
  }
);

// ============================================
// Applications
// ============================================

// List applications
router.get('/:orgSlug/applications',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  async (req, res) => {
    try {
      const applications = await Application.find({
        organization: req.organization._id,
        status: { $ne: 'deleted' }
      }).sort({ createdAt: -1 });
      
      res.render('developer/applications', {
        title: 'Applications',
        org: req.organization,
        applications
      });
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error loading applications');
      res.redirect(`/developer/${req.params.orgSlug}`);
    }
  }
);

// New application form
router.get('/:orgSlug/applications/new',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('developer'),
  (req, res) => {
    res.render('developer/application-new', {
      title: 'Create Application',
      org: req.organization
    });
  }
);

// Create application
router.post('/:orgSlug/applications',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('developer'),
  [
    body('name').trim().notEmpty().isLength({ max: 100 }),
    body('type').isIn(['web', 'spa', 'native', 'mobile', 'machine-to-machine', 'api']),
    body('redirectUris').optional()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.render('developer/application-new', {
          title: 'Create Application',
          org: req.organization,
          errors: errors.array(),
          values: req.body
        });
      }
      
      const { name, type, description, redirectUris } = req.body;
      
      // Parse redirect URIs
      const uris = redirectUris ? 
        redirectUris.split('\n').map(u => u.trim()).filter(u => u) : 
        [];
      
      const application = new Application({
        name,
        type,
        description,
        organization: req.organization._id,
        oauth: {
          redirectUris: uris,
          grantTypes: type === 'machine-to-machine' ? 
            ['client_credentials'] : 
            ['authorization_code', 'refresh_token']
        }
      });
      
      await application.save();
      
      await AuditLog.logEvent({
        action: 'application_created',
        userId: req.user._id,
        status: 'success',
        details: { 
          organizationId: req.organization._id,
          applicationId: application._id, 
          name 
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      req.flash('success_msg', 'Application created. Save your client secret - it won\'t be shown again!');
      res.redirect(`/developer/${req.organization.slug}/applications/${application.clientId}`);
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error creating application');
      res.redirect(`/developer/${req.params.orgSlug}/applications/new`);
    }
  }
);

// View application
router.get('/:orgSlug/applications/:clientId',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  async (req, res) => {
    try {
      const application = await Application.findOne({
        clientId: req.params.clientId,
        organization: req.organization._id,
        status: { $ne: 'deleted' }
      });
      
      if (!application) {
        req.flash('error_msg', 'Application not found');
        return res.redirect(`/developer/${req.organization.slug}/applications`);
      }
      
      // Check if this is a new app (just created)
      const isNew = Date.now() - application.createdAt < 60000; // Within 1 minute
      
      res.render('developer/application-detail', {
        title: application.name,
        org: req.organization,
        app: application,
        showSecret: isNew // Only show secret for new apps
      });
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error loading application');
      res.redirect(`/developer/${req.params.orgSlug}/applications`);
    }
  }
);

// Update application
router.post('/:orgSlug/applications/:clientId',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('developer'),
  async (req, res) => {
    try {
      const application = await Application.findOne({
        clientId: req.params.clientId,
        organization: req.organization._id
      });
      
      if (!application) {
        req.flash('error_msg', 'Application not found');
        return res.redirect(`/developer/${req.organization.slug}/applications`);
      }
      
      const { name, description, redirectUris, allowedOrigins, logoutUrls } = req.body;
      
      application.name = name;
      application.description = description;
      application.oauth.redirectUris = redirectUris ? 
        redirectUris.split('\n').map(u => u.trim()).filter(u => u) : [];
      application.oauth.allowedOrigins = allowedOrigins ?
        allowedOrigins.split('\n').map(u => u.trim()).filter(u => u) : [];
      application.oauth.logoutUrls = logoutUrls ?
        logoutUrls.split('\n').map(u => u.trim()).filter(u => u) : [];
      
      await application.save();
      
      req.flash('success_msg', 'Application updated');
      res.redirect(`/developer/${req.organization.slug}/applications/${application.clientId}`);
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error updating application');
      res.redirect(`/developer/${req.params.orgSlug}/applications/${req.params.clientId}`);
    }
  }
);

// Rotate client secret
router.post('/:orgSlug/applications/:clientId/rotate-secret',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('admin'),
  async (req, res) => {
    try {
      const application = await Application.findOne({
        clientId: req.params.clientId,
        organization: req.organization._id
      });
      
      if (!application) {
        return res.status(404).json({ error: 'Application not found' });
      }
      
      const newSecret = application.rotateClientSecret();
      await application.save();
      
      await AuditLog.logEvent({
        action: 'application_secret_rotated',
        userId: req.user._id,
        status: 'success',
        details: { applicationId: application._id },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      res.json({ 
        success: true, 
        clientSecret: newSecret,
        message: 'Save this secret - it won\'t be shown again!'
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error rotating secret' });
    }
  }
);

// Delete application
router.post('/:orgSlug/applications/:clientId/delete',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('admin'),
  async (req, res) => {
    try {
      const application = await Application.findOne({
        clientId: req.params.clientId,
        organization: req.organization._id
      });
      
      if (!application) {
        req.flash('error_msg', 'Application not found');
        return res.redirect(`/developer/${req.organization.slug}/applications`);
      }
      
      application.status = 'deleted';
      await application.save();
      
      await AuditLog.logEvent({
        action: 'application_deleted',
        userId: req.user._id,
        status: 'success',
        details: { applicationId: application._id, name: application.name },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      req.flash('success_msg', 'Application deleted');
      res.redirect(`/developer/${req.organization.slug}/applications`);
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error deleting application');
      res.redirect(`/developer/${req.params.orgSlug}/applications`);
    }
  }
);

// ============================================
// API Keys
// ============================================

// List API keys
router.get('/:orgSlug/api-keys',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  async (req, res) => {
    try {
      const apiKeys = await ApiKey.find({
        organization: req.organization._id
      }).populate('createdBy', 'username email').sort({ createdAt: -1 });
      
      res.render('developer/api-keys', {
        title: 'API Keys',
        org: req.organization,
        apiKeys
      });
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error loading API keys');
      res.redirect(`/developer/${req.params.orgSlug}`);
    }
  }
);

// Create API key
router.post('/:orgSlug/api-keys',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('admin'),
  [
    body('name').trim().notEmpty().isLength({ max: 100 }),
    body('environment').isIn(['development', 'staging', 'production']),
    body('scopes').optional()
  ],
  async (req, res) => {
    try {
      const { name, description, environment, scopes, expiresIn } = req.body;
      
      const scopeArray = scopes ? 
        (Array.isArray(scopes) ? scopes : [scopes]) : 
        ['*'];
      
      let expiresAt = null;
      if (expiresIn && expiresIn !== 'never') {
        const days = parseInt(expiresIn);
        expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }
      
      const { apiKey, fullSecretKey } = await ApiKey.generateKey({
        name,
        description,
        environment,
        scopes: scopeArray,
        expiresAt,
        organization: req.organization._id,
        createdBy: req.user._id
      });
      
      await AuditLog.logEvent({
        action: 'api_key_created',
        userId: req.user._id,
        status: 'success',
        details: { 
          organizationId: req.organization._id,
          keyId: apiKey.keyId, 
          name 
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      // Return JSON with the secret key (only time it's shown)
      res.json({
        success: true,
        keyId: apiKey.keyId,
        secretKey: fullSecretKey,
        message: 'Save this key - it won\'t be shown again!'
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error creating API key' });
    }
  }
);

// Revoke API key
router.post('/:orgSlug/api-keys/:keyId/revoke',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('admin'),
  async (req, res) => {
    try {
      const apiKey = await ApiKey.findOne({
        keyId: req.params.keyId,
        organization: req.organization._id
      });
      
      if (!apiKey) {
        return res.status(404).json({ error: 'API key not found' });
      }
      
      await apiKey.revoke(req.user._id, req.body.reason || 'Manual revocation');
      
      await AuditLog.logEvent({
        action: 'api_key_revoked',
        userId: req.user._id,
        status: 'success',
        details: { keyId: apiKey.keyId },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error revoking API key' });
    }
  }
);

// ============================================
// Webhooks
// ============================================

// List webhooks
router.get('/:orgSlug/webhooks',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  async (req, res) => {
    try {
      const webhooks = await Webhook.find({
        organization: req.organization._id
      }).sort({ createdAt: -1 });
      
      res.render('developer/webhooks', {
        title: 'Webhooks',
        org: req.organization,
        webhooks
      });
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error loading webhooks');
      res.redirect(`/developer/${req.params.orgSlug}`);
    }
  }
);

// Create webhook
router.post('/:orgSlug/webhooks',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('developer'),
  [
    body('name').trim().notEmpty().isLength({ max: 100 }),
    body('url').isURL({ protocols: ['https'] }),
    body('events').notEmpty()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      
      const { name, url, events, description } = req.body;
      
      const eventArray = Array.isArray(events) ? events : [events];
      
      const webhook = new Webhook({
        name,
        url,
        events: eventArray,
        description,
        organization: req.organization._id,
        createdBy: req.user._id
      });
      
      await webhook.save();
      
      await AuditLog.logEvent({
        action: 'webhook_created',
        userId: req.user._id,
        status: 'success',
        details: { 
          organizationId: req.organization._id,
          webhookId: webhook._id, 
          name,
          url 
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      res.json({ 
        success: true, 
        webhook: {
          id: webhook._id,
          name: webhook.name,
          secret: webhook.secret
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error creating webhook' });
    }
  }
);

// Test webhook
router.post('/:orgSlug/webhooks/:webhookId/test',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('developer'),
  async (req, res) => {
    try {
      const webhook = await Webhook.findOne({
        _id: req.params.webhookId,
        organization: req.organization._id
      });
      
      if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      
      // Send test event
      const WebhookService = require('../services/webhookService');
      const result = await WebhookService.sendTestEvent(webhook);
      
      res.json({ success: true, result });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error testing webhook' });
    }
  }
);

// Delete webhook
router.post('/:orgSlug/webhooks/:webhookId/delete',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('admin'),
  async (req, res) => {
    try {
      await Webhook.findOneAndDelete({
        _id: req.params.webhookId,
        organization: req.organization._id
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error deleting webhook' });
    }
  }
);

// ============================================
// Logs & Analytics
// ============================================

// View logs
router.get('/:orgSlug/logs',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = 50;
      const skip = (page - 1) * limit;
      
      const filter = { 'details.organizationId': req.organization._id };
      if (req.query.action) filter.action = req.query.action;
      
      const [logs, total] = await Promise.all([
        AuditLog.find(filter)
          .populate('userId', 'username email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        AuditLog.countDocuments(filter)
      ]);
      
      res.render('developer/logs', {
        title: 'Activity Logs',
        org: req.organization,
        logs,
        pagination: {
          page,
          totalPages: Math.ceil(total / limit),
          total
        }
      });
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error loading logs');
      res.redirect(`/developer/${req.params.orgSlug}`);
    }
  }
);

// Analytics
router.get('/:orgSlug/analytics',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  async (req, res) => {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // Get various stats
      const [
        totalUsers,
        activeUsers,
        totalLogins,
        failedLogins,
        signups
      ] = await Promise.all([
        // These would query your User model filtered by organization
        // For now, returning placeholder data
        Promise.resolve(req.organization.usage.currentMonthActiveUsers),
        Promise.resolve(Math.floor(req.organization.usage.currentMonthActiveUsers * 0.3)),
        AuditLog.countDocuments({
          'details.organizationId': req.organization._id,
          action: 'login',
          createdAt: { $gte: thirtyDaysAgo }
        }),
        AuditLog.countDocuments({
          'details.organizationId': req.organization._id,
          action: 'login_failed',
          createdAt: { $gte: thirtyDaysAgo }
        }),
        AuditLog.countDocuments({
          'details.organizationId': req.organization._id,
          action: 'register',
          createdAt: { $gte: thirtyDaysAgo }
        })
      ]);
      
      res.render('developer/analytics', {
        title: 'Analytics',
        org: req.organization,
        stats: {
          totalUsers,
          activeUsers,
          totalLogins,
          failedLogins,
          signups,
          apiCalls: req.organization.usage.currentMonthApiCalls
        }
      });
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error loading analytics');
      res.redirect(`/developer/${req.params.orgSlug}`);
    }
  }
);

// ============================================
// Team Management
// ============================================

// Team members
router.get('/:orgSlug/team',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('admin'),
  async (req, res) => {
    try {
      const org = await Organization.findById(req.organization._id)
        .populate('owner', 'username email')
        .populate('members.user', 'username email');
      
      res.render('developer/team', {
        title: 'Team',
        org
      });
    } catch (error) {
      console.error(error);
      req.flash('error_msg', 'Error loading team');
      res.redirect(`/developer/${req.params.orgSlug}`);
    }
  }
);

// Invite member (placeholder)
router.post('/:orgSlug/team/invite',
  ensureAuthenticated,
  ensureVerified,
  loadOrganization,
  requireOrgPermission('admin'),
  async (req, res) => {
    // TODO: Implement invitation system
    res.json({ success: false, message: 'Feature coming soon' });
  }
);

module.exports = router;
