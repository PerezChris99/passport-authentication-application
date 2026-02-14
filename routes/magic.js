/**
 * Passwordless / Magic Link Authentication Routes
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');

const User = require('../models/User');
const MagicLink = require('../models/MagicLink');
const OAuthToken = require('../models/OAuthToken');
const Application = require('../models/Application');
const Organization = require('../models/Organization');
const AuditLog = require('../models/AuditLog');
const { sendEmail } = require('../utils/emailSender');
const WebhookService = require('../services/webhookService');

// ============================================
// Request Magic Link (Public)
// ============================================

// Render magic link request form
router.get('/login', (req, res) => {
  const { app, redirect } = req.query;
  
  res.render('auth/magic-link', {
    title: 'Sign in with Email',
    clientId: app,
    redirectUrl: redirect
  });
});

// Request magic link
router.post('/request',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.accepts('json')) {
          return res.status(400).json({ error: 'validation_error', details: errors.array() });
        }
        return res.render('auth/magic-link', {
          title: 'Sign in with Email',
          errors: errors.array(),
          email: req.body.email
        });
      }
      
      const { email, clientId, redirectUrl } = req.body;
      
      // Find organization by client ID or use default
      let organization = null;
      let application = null;
      
      if (clientId) {
        application = await Application.findOne({ clientId, status: 'active' });
        if (application) {
          organization = await Organization.findById(application.organization);
        }
      }
      
      // Find user
      let user = await User.findOne({ 
        email: email.toLowerCase(),
        ...(organization ? { organization: organization._id } : {})
      });
      
      // If no user and we have an organization, create one
      if (!user && organization) {
        user = new User({
          email: email.toLowerCase(),
          username: email.split('@')[0] + '_' + crypto.randomBytes(3).toString('hex'),
          password: crypto.randomBytes(32).toString('hex'),
          organization: organization._id,
          isVerified: false
        });
        await user.save();
        
        // Trigger webhook
        await WebhookService.userCreated(organization._id, user);
      } else if (!user) {
        // No organization context and no user - respond success anyway for security
        // (don't reveal if email exists)
        return respondSuccess(req, res, email);
      }
      
      // Create magic link
      const magicLink = new MagicLink({
        user: user._id,
        organization: organization?._id,
        application: application?._id,
        redirectUrl: redirectUrl || '/',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      await magicLink.save();
      
      // Build magic link URL
      const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const magicUrl = `${baseUrl}/auth/magic/${magicLink.token}`;
      
      // Determine organization name for email
      const orgName = organization?.name || process.env.APP_NAME || 'Our Application';
      const branding = organization?.branding || {};
      
      // Send email
      await sendEmail({
        to: user.email,
        subject: `Sign in to ${orgName}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            <div style="max-width:560px;margin:40px auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
              ${branding.logoUrl ? `
                <div style="padding:24px;text-align:center;background:${branding.primaryColor || '#4f46e5'};">
                  <img src="${branding.logoUrl}" alt="${orgName}" style="max-height:48px;">
                </div>
              ` : `
                <div style="padding:24px;text-align:center;background:${branding.primaryColor || '#4f46e5'};">
                  <h1 style="margin:0;color:white;font-size:24px;">${orgName}</h1>
                </div>
              `}
              
              <div style="padding:32px 24px;">
                <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Sign in to your account</h2>
                <p style="margin:0 0 24px;color:#6b7280;line-height:1.6;">
                  Click the button below to sign in. This link will expire in 15 minutes.
                </p>
                
                <a href="${magicUrl}" style="display:inline-block;padding:12px 32px;background:${branding.primaryColor || '#4f46e5'};color:white;text-decoration:none;border-radius:6px;font-weight:500;">
                  Sign In
                </a>
                
                <p style="margin:24px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;">
                  If you didn't request this email, you can safely ignore it.
                  <br>
                  For security, this link can only be used once.
                </p>
              </div>
              
              <div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;">
                <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                  This email was sent to ${user.email}
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `Sign in to ${orgName}\n\nClick this link to sign in: ${magicUrl}\n\nThis link expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore it.`
      });
      
      // Log event
      await AuditLog.logEvent({
        action: 'magic_link_requested',
        userId: user._id,
        status: 'success',
        details: { email: user.email },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return respondSuccess(req, res, email);
    } catch (error) {
      console.error('Magic link request error:', error);
      
      if (req.accepts('json')) {
        return res.status(500).json({ error: 'server_error', message: 'Failed to send magic link' });
      }
      
      req.flash('error_msg', 'Failed to send magic link. Please try again.');
      res.redirect('/auth/magic/login');
    }
  }
);

// Helper to respond success
function respondSuccess(req, res, email) {
  if (req.accepts('json')) {
    return res.json({
      success: true,
      message: 'If an account exists, a magic link has been sent',
      expiresIn: 900
    });
  }
  
  res.render('auth/magic-link-sent', {
    title: 'Check Your Email',
    email
  });
}

// ============================================
// Verify Magic Link
// ============================================

router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Find magic link
    const magicLink = await MagicLink.findOne({ token })
      .populate('user')
      .populate('application')
      .populate('organization');
    
    if (!magicLink) {
      return res.render('auth/magic-link-error', {
        title: 'Invalid Link',
        error: 'This link is invalid or has expired.',
        suggestion: 'Please request a new sign-in link.'
      });
    }
    
    // Check if valid
    if (!magicLink.isValid()) {
      const reason = magicLink.usedAt ? 'already been used' : 'expired';
      return res.render('auth/magic-link-error', {
        title: 'Link Expired',
        error: `This link has ${reason}.`,
        suggestion: 'Please request a new sign-in link.'
      });
    }
    
    // Additional security check - IP matching (optional, configurable)
    const strictIpCheck = magicLink.organization?.security?.strictMagicLinkIp || false;
    if (strictIpCheck && magicLink.ipAddress !== req.ip) {
      await AuditLog.logEvent({
        action: 'magic_link_ip_mismatch',
        userId: magicLink.user._id,
        status: 'warning',
        details: {
          originalIp: magicLink.ipAddress,
          currentIp: req.ip
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      // Show warning but allow proceed
      return res.render('auth/magic-link-confirm', {
        title: 'Confirm Sign In',
        token,
        warning: 'This sign-in link was requested from a different location. Continue?'
      });
    }
    
    // Mark as used
    await magicLink.consume();
    
    // Verify user email if not verified
    if (!magicLink.user.isVerified) {
      magicLink.user.isVerified = true;
      await magicLink.user.save();
    }
    
    // Update last login
    magicLink.user.lastLogin = new Date();
    await magicLink.user.save();
    
    // Log the user in
    req.login(magicLink.user, async (err) => {
      if (err) {
        console.error('Magic link login error:', err);
        return res.render('auth/magic-link-error', {
          title: 'Login Error',
          error: 'Failed to complete sign in.',
          suggestion: 'Please try again or contact support.'
        });
      }
      
      // Log event
      await AuditLog.logEvent({
        action: 'login_magic_link',
        userId: magicLink.user._id,
        status: 'success',
        details: {
          organizationId: magicLink.organization?._id,
          applicationId: magicLink.application?._id
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      // Trigger webhook
      if (magicLink.organization) {
        await WebhookService.loginSucceeded(magicLink.organization._id, magicLink.user, {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          method: 'magic_link'
        });
      }
      
      // Handle OAuth flow if application is present
      if (magicLink.application && req.session.oauthParams) {
        return res.redirect('/oauth/authorize?' + new URLSearchParams(req.session.oauthParams).toString());
      }
      
      // Redirect to specified URL or dashboard
      const redirectUrl = magicLink.redirectUrl || '/dashboard';
      res.redirect(redirectUrl);
    });
  } catch (error) {
    console.error('Magic link verify error:', error);
    res.render('auth/magic-link-error', {
      title: 'Error',
      error: 'An unexpected error occurred.',
      suggestion: 'Please try again or contact support.'
    });
  }
});

// Confirm magic link from different IP
router.post('/:token/confirm', async (req, res) => {
  try {
    const { token } = req.params;
    
    const magicLink = await MagicLink.findOne({ token })
      .populate('user')
      .populate('application')
      .populate('organization');
    
    if (!magicLink || !magicLink.isValid()) {
      return res.redirect(`/auth/magic/${token}`);
    }
    
    // Mark as used
    await magicLink.consume();
    
    // Verify and login (same as above)
    if (!magicLink.user.isVerified) {
      magicLink.user.isVerified = true;
      await magicLink.user.save();
    }
    
    magicLink.user.lastLogin = new Date();
    await magicLink.user.save();
    
    req.login(magicLink.user, async (err) => {
      if (err) {
        req.flash('error_msg', 'Failed to complete sign in');
        return res.redirect('/login');
      }
      
      await AuditLog.logEvent({
        action: 'login_magic_link_confirmed',
        userId: magicLink.user._id,
        status: 'success',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      if (magicLink.organization) {
        await WebhookService.loginSucceeded(magicLink.organization._id, magicLink.user, {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          method: 'magic_link_confirmed'
        });
      }
      
      const redirectUrl = magicLink.redirectUrl || '/dashboard';
      res.redirect(redirectUrl);
    });
  } catch (error) {
    console.error('Magic link confirm error:', error);
    req.flash('error_msg', 'An error occurred');
    res.redirect('/login');
  }
});

// ============================================
// API Endpoints for SDK
// ============================================

// Generate magic link via API (authenticated)
router.post('/api/generate',
  async (req, res) => {
    // This would typically be called by the SDK with API key authentication
    // Implementation delegated to SDK routes
    res.status(501).json({ error: 'Use /api/sdk/auth/magic-link endpoint' });
  }
);

// Verify magic link via API (returns tokens)
router.post('/api/verify',
  [
    body('token').notEmpty()
  ],
  async (req, res) => {
    try {
      const { token } = req.body;
      
      const magicLink = await MagicLink.findOne({ token })
        .populate('user')
        .populate('application')
        .populate('organization');
      
      if (!magicLink || !magicLink.isValid()) {
        return res.status(400).json({
          error: 'invalid_token',
          message: 'Magic link is invalid or expired'
        });
      }
      
      // Mark as used
      await magicLink.consume();
      
      // Verify email
      if (!magicLink.user.isVerified) {
        magicLink.user.isVerified = true;
        await magicLink.user.save();
      }
      
      // Update last login
      magicLink.user.lastLogin = new Date();
      await magicLink.user.save();
      
      // Generate tokens
      let application = magicLink.application;
      if (!application && magicLink.organization) {
        application = await Application.findOne({
          organization: magicLink.organization._id,
          isDefault: true
        });
      }
      
      if (!application) {
        return res.json({
          success: true,
          user: {
            id: magicLink.user._id,
            email: magicLink.user.email,
            emailVerified: magicLink.user.isVerified
          }
        });
      }
      
      // Generate access token
      const expiresIn = 3600;
      const { plainToken: accessToken } = await OAuthToken.generate({
        type: 'access_token',
        user: magicLink.user._id,
        application: application._id,
        organization: magicLink.organization._id,
        scope: ['openid', 'profile', 'email'],
        expiresAt: new Date(Date.now() + expiresIn * 1000)
      });
      
      // Generate refresh token
      const { plainToken: refreshToken } = await OAuthToken.generate({
        type: 'refresh_token',
        user: magicLink.user._id,
        application: application._id,
        organization: magicLink.organization._id,
        scope: ['openid', 'profile', 'email', 'offline_access'],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });
      
      // Log event
      await AuditLog.logEvent({
        action: 'magic_link_api_verify',
        userId: magicLink.user._id,
        status: 'success',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      res.json({
        success: true,
        user: {
          id: magicLink.user._id,
          email: magicLink.user.email,
          username: magicLink.user.username,
          emailVerified: magicLink.user.isVerified
        },
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: expiresIn
        }
      });
    } catch (error) {
      console.error('Magic link API verify error:', error);
      res.status(500).json({
        error: 'server_error',
        message: 'Failed to verify magic link'
      });
    }
  }
);

module.exports = router;
