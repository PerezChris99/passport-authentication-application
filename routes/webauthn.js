/**
 * WebAuthn/Passkey Routes
 * 
 * Implements passwordless authentication using the WebAuthn standard.
 * This is a CRITICAL differentiator - no major competitor has proper passkey support.
 * 
 * Features:
 * - Passkey registration (add new passkeys to account)
 * - Passkey authentication (login without password)
 * - Passkey management (list, rename, revoke)
 * - Discoverable credential support (usernameless login)
 * 
 * Security:
 * - Challenge-response with 30s expiry
 * - Signature counter validation
 * - Origin verification
 * - User verification preferred
 */

const express = require('express');
const router = express.Router();
const Passkey = require('../models/Passkey');
const User = require('../models/User');
const webauthn = require('../utils/webauthn');
const { ensureAuthenticated } = require('../config/auth');

// Get RP (Relying Party) configuration from environment
const getRP = (req) => ({
  rpId: process.env.RP_ID || req.hostname || 'localhost',
  rpName: process.env.APP_NAME || 'NexusAuth',
  origin: process.env.BASE_URL || `${req.protocol}://${req.get('host')}`
});

/* ===== REGISTRATION FLOW ===== */

/**
 * GET /webauthn/register
 * Passkey registration page
 */
router.get('/register', ensureAuthenticated, (req, res) => {
  res.render('auth/passkey-register', {
    title: 'Register Passkey',
    user: req.user
  });
});

/**
 * POST /webauthn/register/options
 * Generate registration options for new passkey
 * 
 * Response: PublicKeyCredentialCreationOptions
 */
router.post('/register/options', ensureAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    const { authenticatorType } = req.body; // 'platform' or 'cross-platform'
    
    // Get user's existing passkeys to exclude
    const existingPasskeys = await Passkey.getForUser(user._id);
    const existingCredentials = existingPasskeys.map(p => p.credentialId);
    
    const rp = getRP(req);
    
    // Generate registration options
    const options = webauthn.generateRegistrationOptions(
      user,
      existingCredentials,
      {
        rpName: rp.rpName,
        rpId: rp.rpId,
        attestation: 'none', // 'direct' for attestation verification
        authenticatorSelection: {
          authenticatorAttachment: authenticatorType || undefined,
          residentKey: 'preferred',
          userVerification: 'preferred'
        }
      }
    );
    
    res.json({
      success: true,
      options
    });
    
  } catch (error) {
    console.error('Registration options error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate registration options'
    });
  }
});

/**
 * POST /webauthn/register/verify
 * Verify registration response and store passkey
 * 
 * Body: { credential: PublicKeyCredential, name?: string }
 */
router.post('/register/verify', ensureAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    const { credential, name } = req.body;
    
    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Missing credential data'
      });
    }
    
    const rp = getRP(req);
    
    // Verify the registration response
    const verificationResult = await webauthn.verifyRegistration(
      credential,
      user._id.toString(),
      rp.origin,
      rp.rpId
    );
    
    // Check if credential already exists
    const existing = await Passkey.findOne({ 
      credentialId: verificationResult.credentialId 
    });
    
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'This passkey is already registered'
      });
    }
    
    // Parse device info from user agent
    const userAgent = req.get('user-agent') || '';
    const deviceInfo = parseUserAgent(userAgent);
    
    // Create passkey record
    const passkey = await Passkey.create({
      user: user._id,
      credentialId: verificationResult.credentialId,
      publicKey: verificationResult.publicKey,
      counter: verificationResult.counter,
      credentialType: verificationResult.credentialType,
      authenticatorType: credential.authenticatorAttachment || 'platform',
      attestationFormat: verificationResult.attestationFormat,
      aaguid: verificationResult.aaguid,
      transports: verificationResult.transports || credential.response?.getTransports?.() || [],
      backupEligible: verificationResult.backupEligible,
      backupState: verificationResult.backupState,
      userVerified: verificationResult.userVerified,
      name: name || generatePasskeyName(deviceInfo),
      deviceInfo
    });
    
    // Log the event
    console.log(`Passkey registered for user ${user.email}: ${passkey.name}`);
    
    res.json({
      success: true,
      message: 'Passkey registered successfully',
      passkey: {
        id: passkey._id,
        name: passkey.name,
        createdAt: passkey.createdAt,
        authenticatorType: passkey.authenticatorType
      }
    });
    
  } catch (error) {
    console.error('Registration verification error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to verify registration'
    });
  }
});

/* ===== AUTHENTICATION FLOW ===== */

/**
 * GET /webauthn/login
 * Passkey login page
 */
router.get('/login', (req, res) => {
  res.render('auth/passkey-login', {
    title: 'Login with Passkey'
  });
});

/**
 * POST /webauthn/login/options
 * Generate authentication options
 * 
 * Body: { email?: string } - Optional email for non-discoverable credentials
 * Response: PublicKeyCredentialRequestOptions
 */
router.post('/login/options', async (req, res) => {
  try {
    const { email } = req.body;
    const rp = getRP(req);
    
    let allowedCredentials = [];
    let userId = null;
    
    // If email provided, get user's passkeys
    if (email) {
      const user = await User.findOne({ email: email.toLowerCase() });
      
      if (user) {
        const passkeys = await Passkey.getForUser(user._id);
        allowedCredentials = passkeys.map(p => ({
          credentialId: p.credentialId,
          transports: p.transports
        }));
        userId = user._id.toString();
      }
    }
    
    // Generate authentication options
    const { options, challengeKey } = webauthn.generateAuthenticationOptions(
      allowedCredentials,
      userId,
      {
        rpId: rp.rpId,
        userVerification: 'preferred'
      }
    );
    
    // Store challenge key in session for verification
    req.session.webauthnChallenge = challengeKey;
    
    res.json({
      success: true,
      options
    });
    
  } catch (error) {
    console.error('Authentication options error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate authentication options'
    });
  }
});

/**
 * POST /webauthn/login/verify
 * Verify authentication response and log user in
 * 
 * Body: { credential: PublicKeyCredential }
 */
router.post('/login/verify', async (req, res) => {
  try {
    const { credential } = req.body;
    
    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Missing credential data'
      });
    }
    
    const rp = getRP(req);
    const challengeKey = req.session.webauthnChallenge;
    
    if (!challengeKey) {
      return res.status(400).json({
        success: false,
        message: 'Authentication session expired'
      });
    }
    
    // Find the passkey by credential ID
    const passkey = await Passkey.findByCredentialId(credential.id);
    
    if (!passkey) {
      return res.status(401).json({
        success: false,
        message: 'Passkey not found or revoked'
      });
    }
    
    // Verify the authentication response
    const result = await webauthn.verifyAuthentication(
      credential,
      passkey,
      challengeKey,
      rp.origin,
      rp.rpId
    );
    
    if (!result.verified) {
      return res.status(401).json({
        success: false,
        message: 'Authentication failed'
      });
    }
    
    // Update passkey counter and last used
    await passkey.incrementCounter(result.newCounter);
    
    // Get the user
    const user = passkey.user;
    
    // Check if user is blocked
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Account is blocked'
      });
    }
    
    // Clear the challenge from session
    delete req.session.webauthnChallenge;
    
    // Log the user in
    req.login(user, (err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: 'Login failed'
        });
      }
      
      // Update last login
      user.lastLogin = new Date();
      user.save();
      
      console.log(`Passkey login: ${user.email} using "${passkey.name}"`);
      
      res.json({
        success: true,
        message: 'Authentication successful',
        user: {
          id: user._id,
          email: user.email,
          username: user.username
        },
        redirect: '/dashboard'
      });
    });
    
  } catch (error) {
    console.error('Authentication verification error:', error);
    res.status(401).json({
      success: false,
      message: error.message || 'Authentication failed'
    });
  }
});

/* ===== PASSKEY MANAGEMENT ===== */

/**
 * GET /webauthn/credentials
 * List user's passkeys
 */
router.get('/credentials', ensureAuthenticated, async (req, res) => {
  try {
    const passkeys = await Passkey.getForUser(req.user._id);
    
    res.json({
      success: true,
      passkeys: passkeys.map(p => ({
        id: p._id,
        name: p.name,
        authenticatorType: p.authenticatorType,
        transports: p.transports,
        createdAt: p.createdAt,
        lastUsedAt: p.lastUsedAt,
        useCount: p.useCount,
        backupEligible: p.backupEligible,
        backupState: p.backupState,
        deviceInfo: p.deviceInfo
      }))
    });
    
  } catch (error) {
    console.error('List passkeys error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list passkeys'
    });
  }
});

/**
 * PATCH /webauthn/credentials/:id
 * Update passkey (rename)
 */
router.patch('/credentials/:id', ensureAuthenticated, async (req, res) => {
  try {
    const { name } = req.body;
    
    const passkey = await Passkey.findOne({
      _id: req.params.id,
      user: req.user._id,
      status: 'active'
    });
    
    if (!passkey) {
      return res.status(404).json({
        success: false,
        message: 'Passkey not found'
      });
    }
    
    if (name) {
      passkey.name = name.trim().substring(0, 100);
      await passkey.save();
    }
    
    res.json({
      success: true,
      message: 'Passkey updated',
      passkey: {
        id: passkey._id,
        name: passkey.name
      }
    });
    
  } catch (error) {
    console.error('Update passkey error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update passkey'
    });
  }
});

/**
 * DELETE /webauthn/credentials/:id
 * Revoke a passkey
 */
router.delete('/credentials/:id', ensureAuthenticated, async (req, res) => {
  try {
    const passkey = await Passkey.findOne({
      _id: req.params.id,
      user: req.user._id,
      status: 'active'
    });
    
    if (!passkey) {
      return res.status(404).json({
        success: false,
        message: 'Passkey not found'
      });
    }
    
    // Check if this is the user's only passkey and they have no password
    const passkeyCount = await Passkey.countForUser(req.user._id);
    const hasPassword = req.user.password && req.user.password.length > 0;
    
    if (passkeyCount === 1 && !hasPassword) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove your only passkey without a password set'
      });
    }
    
    await passkey.revoke('User requested');
    
    console.log(`Passkey revoked: ${passkey.name} for user ${req.user.email}`);
    
    res.json({
      success: true,
      message: 'Passkey removed'
    });
    
  } catch (error) {
    console.error('Delete passkey error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove passkey'
    });
  }
});

/**
 * GET /webauthn/credentials/page
 * Passkey management page
 */
router.get('/credentials/page', ensureAuthenticated, async (req, res) => {
  try {
    const passkeys = await Passkey.getForUser(req.user._id);
    
    res.render('auth/passkey-manage', {
      title: 'Manage Passkeys',
      user: req.user,
      passkeys
    });
    
  } catch (error) {
    console.error('Passkey management page error:', error);
    req.flash('error', 'Failed to load passkeys');
    res.redirect('/settings');
  }
});

/* ===== HELPER FUNCTIONS ===== */

/**
 * Parse user agent to get device info
 */
function parseUserAgent(userAgent) {
  const info = {
    platform: 'Unknown',
    browser: 'Unknown',
    userAgent
  };
  
  // Detect platform
  if (/Windows/.test(userAgent)) info.platform = 'Windows';
  else if (/Macintosh|Mac OS X/.test(userAgent)) info.platform = 'macOS';
  else if (/iPhone|iPad/.test(userAgent)) info.platform = 'iOS';
  else if (/Android/.test(userAgent)) info.platform = 'Android';
  else if (/Linux/.test(userAgent)) info.platform = 'Linux';
  else if (/CrOS/.test(userAgent)) info.platform = 'Chrome OS';
  
  // Detect browser
  if (/Edg\//.test(userAgent)) info.browser = 'Edge';
  else if (/Chrome\//.test(userAgent)) info.browser = 'Chrome';
  else if (/Safari\//.test(userAgent)) info.browser = 'Safari';
  else if (/Firefox\//.test(userAgent)) info.browser = 'Firefox';
  else if (/Opera|OPR\//.test(userAgent)) info.browser = 'Opera';
  
  return info;
}

/**
 * Generate a user-friendly passkey name based on device info
 */
function generatePasskeyName(deviceInfo) {
  const names = {
    'Windows': 'Windows Hello',
    'macOS': 'Touch ID',
    'iOS': 'Face ID',
    'Android': 'Android',
    'Chrome OS': 'Chromebook'
  };
  
  const platformName = names[deviceInfo.platform] || deviceInfo.platform;
  
  if (deviceInfo.browser && deviceInfo.browser !== 'Unknown') {
    return `${platformName} (${deviceInfo.browser})`;
  }
  
  return platformName;
}

module.exports = router;
