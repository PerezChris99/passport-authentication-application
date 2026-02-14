/**
 * OAuth 2.0 / OIDC Provider Routes
 * Implements the OAuth 2.0 Authorization Server
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { body, query, validationResult } = require('express-validator');

const Application = require('../models/Application');
const OAuthToken = require('../models/OAuthToken');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { ensureAuthenticated } = require('../config/auth');

// ============================================
// Constants
// ============================================

const SUPPORTED_RESPONSE_TYPES = ['code', 'token', 'id_token', 'code id_token', 'token id_token'];
const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token', 'client_credentials', 'password'];
const SUPPORTED_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

// ============================================
// Helper Functions
// ============================================

// Generate ID Token (JWT)
function generateIdToken(user, application, nonce, accessToken) {
  const claims = {
    iss: process.env.OAUTH_ISSUER || `${process.env.APP_URL}/oauth`,
    sub: user._id.toString(),
    aud: application.clientId,
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    iat: Math.floor(Date.now() / 1000),
    auth_time: Math.floor(user.lastLogin?.getTime() / 1000 || Date.now() / 1000)
  };
  
  if (nonce) claims.nonce = nonce;
  
  // Add at_hash if access token provided
  if (accessToken) {
    const hash = crypto.createHash('sha256').update(accessToken).digest();
    claims.at_hash = hash.slice(0, hash.length / 2).toString('base64url');
  }
  
  // Add profile claims if scope includes profile
  claims.name = user.username;
  if (user.profile) {
    claims.given_name = user.profile.firstName;
    claims.family_name = user.profile.lastName;
    claims.picture = user.profile.avatar;
  }
  
  // Add email if scope includes email
  claims.email = user.email;
  claims.email_verified = user.isVerified;
  
  return jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

// Parse Basic Auth header
function parseBasicAuth(header) {
  if (!header || !header.startsWith('Basic ')) return null;
  
  const encoded = header.substring(6);
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const [clientId, clientSecret] = decoded.split(':');
  
  return { clientId, clientSecret };
}

// Validate redirect URI
function isValidRedirectUri(application, redirectUri) {
  if (!redirectUri) return false;
  return application.oauth.redirectUris.some(uri => {
    if (uri === redirectUri) return true;
    // Allow localhost with different ports for development
    if (application.environment === 'development') {
      const uriObj = new URL(uri);
      const redirectObj = new URL(redirectUri);
      return uriObj.hostname === 'localhost' && redirectObj.hostname === 'localhost' &&
             uriObj.pathname === redirectObj.pathname;
    }
    return false;
  });
}

// ============================================
// Well-Known Endpoints
// ============================================

// OpenID Configuration Discovery
router.get('/.well-known/openid-configuration', (req, res) => {
  const issuer = process.env.OAUTH_ISSUER || `${process.env.APP_URL}/oauth`;
  
  res.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    revocation_endpoint: `${issuer}/revoke`,
    introspection_endpoint: `${issuer}/introspect`,
    end_session_endpoint: `${issuer}/logout`,
    registration_endpoint: `${issuer}/register`,
    
    scopes_supported: SUPPORTED_SCOPES,
    response_types_supported: SUPPORTED_RESPONSE_TYPES,
    response_modes_supported: ['query', 'fragment', 'form_post'],
    grant_types_supported: SUPPORTED_GRANT_TYPES,
    
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256', 'RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    
    code_challenge_methods_supported: ['plain', 'S256'],
    
    claims_supported: [
      'sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce',
      'name', 'given_name', 'family_name', 'email', 'email_verified', 'picture'
    ]
  });
});

// JWKS endpoint (for RS256 signing - placeholder)
router.get('/.well-known/jwks.json', (req, res) => {
  // In production, you'd return your RSA public keys here
  res.json({
    keys: []
  });
});

// ============================================
// Authorization Endpoint
// ============================================

router.get('/authorize',
  [
    query('client_id').notEmpty().withMessage('client_id is required'),
    query('redirect_uri').notEmpty().withMessage('redirect_uri is required'),
    query('response_type').notEmpty().withMessage('response_type is required'),
    query('scope').optional(),
    query('state').optional(),
    query('nonce').optional(),
    query('code_challenge').optional(),
    query('code_challenge_method').optional().isIn(['plain', 'S256']),
    query('prompt').optional().isIn(['none', 'login', 'consent', 'select_account']),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('oauth/error', {
          title: 'Authorization Error',
          error: 'invalid_request',
          error_description: errors.array().map(e => e.msg).join(', ')
        });
      }
      
      const {
        client_id,
        redirect_uri,
        response_type,
        scope = 'openid',
        state,
        nonce,
        code_challenge,
        code_challenge_method,
        prompt
      } = req.query;
      
      // Find application
      const application = await Application.findOne({ 
        clientId: client_id,
        status: 'active'
      }).populate('organization');
      
      if (!application) {
        return res.status(400).render('oauth/error', {
          title: 'Authorization Error',
          error: 'unauthorized_client',
          error_description: 'Unknown client application'
        });
      }
      
      // Validate redirect URI
      if (!isValidRedirectUri(application, redirect_uri)) {
        return res.status(400).render('oauth/error', {
          title: 'Authorization Error',
          error: 'invalid_redirect_uri',
          error_description: 'The redirect_uri is not registered for this application'
        });
      }
      
      // Validate response type
      if (!SUPPORTED_RESPONSE_TYPES.includes(response_type)) {
        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set('error', 'unsupported_response_type');
        if (state) redirectUrl.searchParams.set('state', state);
        return res.redirect(redirectUrl.toString());
      }
      
      // Check if user is authenticated
      if (!req.isAuthenticated()) {
        if (prompt === 'none') {
          const redirectUrl = new URL(redirect_uri);
          redirectUrl.searchParams.set('error', 'login_required');
          if (state) redirectUrl.searchParams.set('state', state);
          return res.redirect(redirectUrl.toString());
        }
        
        // Store OAuth params in session and redirect to login
        req.session.oauthParams = req.query;
        return res.redirect('/login?oauth=true');
      }
      
      // Parse scopes
      const requestedScopes = scope.split(' ').filter(s => s);
      const validScopes = requestedScopes.filter(s => 
        SUPPORTED_SCOPES.includes(s) || application.oauth.allowedScopes.includes(s)
      );
      
      // Show consent screen (or auto-approve for first-party apps)
      if (application.isFirstParty || prompt === 'none') {
        // Auto-approve, skip consent screen
        return handleAuthorization(req, res, {
          application,
          redirect_uri,
          response_type,
          scopes: validScopes,
          state,
          nonce,
          code_challenge,
          code_challenge_method
        });
      }
      
      // Render consent screen
      res.render('oauth/consent', {
        title: 'Authorize Application',
        application,
        organization: application.organization,
        scopes: validScopes,
        scopeDescriptions: {
          openid: 'Authenticate you using OpenID Connect',
          profile: 'Access your basic profile information',
          email: 'Access your email address',
          offline_access: 'Maintain access while you\'re away'
        },
        params: {
          client_id,
          redirect_uri,
          response_type,
          scope: validScopes.join(' '),
          state,
          nonce,
          code_challenge,
          code_challenge_method
        }
      });
    } catch (error) {
      console.error('Authorization error:', error);
      res.status(500).render('oauth/error', {
        title: 'Server Error',
        error: 'server_error',
        error_description: 'An unexpected error occurred'
      });
    }
  }
);

// Handle authorization decision (consent form submission)
router.post('/authorize',
  ensureAuthenticated,
  async (req, res) => {
    try {
      const { 
        decision,
        client_id, 
        redirect_uri, 
        response_type,
        scope,
        state,
        nonce,
        code_challenge,
        code_challenge_method
      } = req.body;
      
      const application = await Application.findOne({ clientId: client_id });
      
      if (!application) {
        return res.status(400).render('oauth/error', {
          title: 'Error',
          error: 'unauthorized_client',
          error_description: 'Application not found'
        });
      }
      
      // User denied access
      if (decision !== 'allow') {
        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set('error', 'access_denied');
        redirectUrl.searchParams.set('error_description', 'User denied access');
        if (state) redirectUrl.searchParams.set('state', state);
        return res.redirect(redirectUrl.toString());
      }
      
      // Handle authorization
      return handleAuthorization(req, res, {
        application,
        redirect_uri,
        response_type,
        scopes: scope.split(' '),
        state,
        nonce,
        code_challenge,
        code_challenge_method
      });
    } catch (error) {
      console.error('Authorization error:', error);
      res.status(500).render('oauth/error', {
        title: 'Error',
        error: 'server_error',
        error_description: 'An unexpected error occurred'
      });
    }
  }
);

// Internal function to handle authorization after consent
async function handleAuthorization(req, res, params) {
  const {
    application,
    redirect_uri,
    response_type,
    scopes,
    state,
    nonce,
    code_challenge,
    code_challenge_method
  } = params;
  
  const redirectUrl = new URL(redirect_uri);
  const useFragment = response_type.includes('token');
  
  try {
    // Authorization Code Flow
    if (response_type.includes('code')) {
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      
      const { plainToken: code } = await OAuthToken.generate({
        type: 'authorization_code',
        user: req.user._id,
        application: application._id,
        organization: application.organization,
        scope: scopes,
        redirectUri: redirect_uri,
        state,
        nonce,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method || 'plain',
        expiresAt,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      if (useFragment) {
        redirectUrl.hash = `code=${code}`;
        if (state) redirectUrl.hash += `&state=${encodeURIComponent(state)}`;
      } else {
        redirectUrl.searchParams.set('code', code);
        if (state) redirectUrl.searchParams.set('state', state);
      }
    }
    
    // Implicit Flow (deprecated but supported)
    if (response_type.includes('token') && !response_type.includes('code')) {
      const expiresAt = new Date(Date.now() + application.oauth.tokenLifetime.accessToken * 1000);
      
      const { plainToken: accessToken } = await OAuthToken.generate({
        type: 'access_token',
        user: req.user._id,
        application: application._id,
        organization: application.organization,
        scope: scopes,
        expiresAt,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      redirectUrl.hash = `access_token=${accessToken}&token_type=Bearer&expires_in=${application.oauth.tokenLifetime.accessToken}`;
      if (state) redirectUrl.hash += `&state=${encodeURIComponent(state)}`;
      
      // ID Token for implicit flow with openid scope
      if (response_type.includes('id_token') && scopes.includes('openid')) {
        const idToken = generateIdToken(req.user, application, nonce, accessToken);
        redirectUrl.hash += `&id_token=${idToken}`;
      }
    }
    
    // Log the authorization
    await AuditLog.logEvent({
      action: 'oauth_authorize',
      userId: req.user._id,
      status: 'success',
      details: {
        applicationId: application._id,
        applicationName: application.name,
        scopes,
        responseType: response_type
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('Authorization error:', error);
    redirectUrl.searchParams.set('error', 'server_error');
    redirectUrl.searchParams.set('error_description', 'Failed to generate authorization');
    if (state) redirectUrl.searchParams.set('state', state);
    res.redirect(redirectUrl.toString());
  }
}

// ============================================
// Token Endpoint
// ============================================

router.post('/token',
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const { grant_type } = req.body;
      
      // Get client credentials
      let clientId, clientSecret;
      
      const authHeader = req.get('Authorization');
      if (authHeader && authHeader.startsWith('Basic ')) {
        const credentials = parseBasicAuth(authHeader);
        clientId = credentials?.clientId;
        clientSecret = credentials?.clientSecret;
      } else {
        clientId = req.body.client_id;
        clientSecret = req.body.client_secret;
      }
      
      if (!clientId) {
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Client authentication required'
        });
      }
      
      // Find and validate application
      const application = await Application.findOne({ clientId, status: 'active' });
      
      if (!application) {
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Unknown client'
        });
      }
      
      // Verify client secret (unless public client)
      const requiresSecret = !['spa', 'native', 'mobile'].includes(application.type);
      if (requiresSecret && !application.verifyClientSecret(clientSecret)) {
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Invalid client credentials'
        });
      }
      
      // Check grant type is allowed
      if (!application.oauth.grantTypes.includes(grant_type)) {
        return res.status(400).json({
          error: 'unauthorized_client',
          error_description: 'Grant type not allowed for this client'
        });
      }
      
      // Handle different grant types
      switch (grant_type) {
        case 'authorization_code':
          return handleAuthorizationCodeGrant(req, res, application);
        case 'refresh_token':
          return handleRefreshTokenGrant(req, res, application);
        case 'client_credentials':
          return handleClientCredentialsGrant(req, res, application);
        case 'password':
          return handlePasswordGrant(req, res, application);
        default:
          return res.status(400).json({
            error: 'unsupported_grant_type',
            error_description: `Grant type '${grant_type}' is not supported`
          });
      }
    } catch (error) {
      console.error('Token endpoint error:', error);
      res.status(500).json({
        error: 'server_error',
        error_description: 'An unexpected error occurred'
      });
    }
  }
);

// Authorization Code Grant
async function handleAuthorizationCodeGrant(req, res, application) {
  const { code, redirect_uri, code_verifier } = req.body;
  
  if (!code) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Authorization code is required'
    });
  }
  
  // Find and validate authorization code
  const authCode = await OAuthToken.findByToken(code);
  
  if (!authCode || authCode.type !== 'authorization_code') {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid or expired authorization code'
    });
  }
  
  // Verify application match
  if (authCode.application._id.toString() !== application._id.toString()) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code was not issued to this client'
    });
  }
  
  // Verify redirect URI
  if (authCode.redirectUri !== redirect_uri) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Redirect URI mismatch'
    });
  }
  
  // Verify PKCE code challenge
  if (authCode.codeChallenge) {
    if (!code_verifier) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Code verifier is required'
      });
    }
    
    if (!authCode.verifyCodeChallenge(code_verifier)) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid code verifier'
      });
    }
  }
  
  // Mark code as used
  await authCode.markAsUsed();
  
  // Generate tokens
  return issueTokens(res, authCode.user, application, authCode.scope, authCode.nonce);
}

// Refresh Token Grant
async function handleRefreshTokenGrant(req, res, application) {
  const { refresh_token, scope } = req.body;
  
  if (!refresh_token) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Refresh token is required'
    });
  }
  
  // Find refresh token
  const token = await OAuthToken.findByToken(refresh_token);
  
  if (!token || token.type !== 'refresh_token') {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid or expired refresh token'
    });
  }
  
  // Verify application match
  if (token.application._id.toString() !== application._id.toString()) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Refresh token was not issued to this client'
    });
  }
  
  // Check for token rotation
  if (application.oauth.rotateRefreshTokens) {
    await token.revoke('rotation');
  }
  
  // Parse requested scopes
  let scopes = token.scope;
  if (scope) {
    const requestedScopes = scope.split(' ');
    // New scope must be subset of original
    scopes = requestedScopes.filter(s => token.scope.includes(s));
  }
  
  // Issue new tokens
  return issueTokens(res, token.user, application, scopes, null, !application.oauth.rotateRefreshTokens);
}

// Client Credentials Grant
async function handleClientCredentialsGrant(req, res, application) {
  const { scope } = req.body;
  
  // Parse scopes
  const scopes = scope ? scope.split(' ').filter(s => 
    application.oauth.allowedScopes.includes(s) || s === 'openid'
  ) : [];
  
  // Generate access token only (no user context)
  const expiresIn = application.oauth.tokenLifetime.accessToken;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  
  const { plainToken: accessToken } = await OAuthToken.generate({
    type: 'access_token',
    user: application.organization, // Use org as "user" for M2M
    application: application._id,
    organization: application.organization,
    scope: scopes,
    expiresAt
  });
  
  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: scopes.join(' ')
  });
}

// Password Grant (Resource Owner Password Credentials)
async function handlePasswordGrant(req, res, application) {
  const { username, password, scope } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Username and password are required'
    });
  }
  
  // Find user
  const user = await User.findOne({ 
    $or: [{ email: username }, { username }]
  });
  
  if (!user) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid credentials'
    });
  }
  
  // Verify password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid credentials'
    });
  }
  
  // Parse scopes
  const scopes = scope ? scope.split(' ').filter(s => SUPPORTED_SCOPES.includes(s)) : ['openid'];
  
  return issueTokens(res, user, application, scopes);
}

// Issue access and refresh tokens
async function issueTokens(res, user, application, scopes, nonce = null, skipRefresh = false) {
  const accessExpiresIn = application.oauth.tokenLifetime.accessToken;
  const refreshExpiresIn = application.oauth.tokenLifetime.refreshToken;
  
  // Generate access token
  const { plainToken: accessToken } = await OAuthToken.generate({
    type: 'access_token',
    user: user._id,
    application: application._id,
    organization: application.organization,
    scope: scopes,
    expiresAt: new Date(Date.now() + accessExpiresIn * 1000)
  });
  
  const response = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: accessExpiresIn
  };
  
  // Generate refresh token if allowed
  if (!skipRefresh && scopes.includes('offline_access')) {
    const { plainToken: refreshToken } = await OAuthToken.generate({
      type: 'refresh_token',
      user: user._id,
      application: application._id,
      organization: application.organization,
      scope: scopes,
      expiresAt: new Date(Date.now() + refreshExpiresIn * 1000)
    });
    
    response.refresh_token = refreshToken;
  }
  
  // Generate ID token if openid scope
  if (scopes.includes('openid')) {
    response.id_token = generateIdToken(user, application, nonce, accessToken);
  }
  
  response.scope = scopes.join(' ');
  
  res.json(response);
}

// ============================================
// UserInfo Endpoint
// ============================================

router.get('/userinfo', async (req, res) => {
  try {
    const authHeader = req.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Access token required'
      });
    }
    
    const token = authHeader.substring(7);
    const oauthToken = await OAuthToken.findByToken(token);
    
    if (!oauthToken || oauthToken.type !== 'access_token') {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Invalid or expired access token'
      });
    }
    
    const user = oauthToken.user;
    const scopes = oauthToken.scope;
    
    // Build response based on scopes
    const userInfo = {
      sub: user._id.toString()
    };
    
    if (scopes.includes('profile')) {
      userInfo.name = user.username;
      userInfo.preferred_username = user.username;
      userInfo.updated_at = Math.floor(user.updatedAt?.getTime() / 1000 || Date.now() / 1000);
      
      if (user.profile) {
        userInfo.given_name = user.profile.firstName;
        userInfo.family_name = user.profile.lastName;
        userInfo.picture = user.profile.avatar;
      }
    }
    
    if (scopes.includes('email')) {
      userInfo.email = user.email;
      userInfo.email_verified = user.isVerified;
    }
    
    res.json(userInfo);
  } catch (error) {
    console.error('UserInfo error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'An unexpected error occurred'
    });
  }
});

// POST variant for userinfo
router.post('/userinfo', async (req, res) => {
  // Redirect to GET handler
  req.method = 'GET';
  return router.handle(req, res);
});

// ============================================
// Token Introspection (RFC 7662)
// ============================================

router.post('/introspect',
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const { token, token_type_hint } = req.body;
      
      // Authenticate client
      const authHeader = req.get('Authorization');
      const credentials = parseBasicAuth(authHeader);
      
      if (!credentials) {
        return res.status(401).json({ error: 'invalid_client' });
      }
      
      const application = await Application.findOne({ 
        clientId: credentials.clientId,
        status: 'active'
      });
      
      if (!application || !application.verifyClientSecret(credentials.clientSecret)) {
        return res.status(401).json({ error: 'invalid_client' });
      }
      
      // Find token
      const oauthToken = await OAuthToken.findByToken(token);
      
      if (!oauthToken) {
        return res.json({ active: false });
      }
      
      // Return token info
      res.json({
        active: true,
        scope: oauthToken.scope.join(' '),
        client_id: oauthToken.application.clientId,
        username: oauthToken.user?.username,
        token_type: oauthToken.type === 'access_token' ? 'Bearer' : oauthToken.type,
        exp: Math.floor(oauthToken.expiresAt.getTime() / 1000),
        iat: Math.floor(oauthToken.createdAt.getTime() / 1000),
        sub: oauthToken.user?._id.toString(),
        aud: oauthToken.application.clientId,
        iss: process.env.OAUTH_ISSUER || `${process.env.APP_URL}/oauth`
      });
    } catch (error) {
      console.error('Introspection error:', error);
      res.status(500).json({ error: 'server_error' });
    }
  }
);

// ============================================
// Token Revocation (RFC 7009)
// ============================================

router.post('/revoke',
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const { token, token_type_hint } = req.body;
      
      // Authenticate client
      const authHeader = req.get('Authorization');
      let credentials = parseBasicAuth(authHeader);
      
      if (!credentials) {
        credentials = {
          clientId: req.body.client_id,
          clientSecret: req.body.client_secret
        };
      }
      
      if (!credentials.clientId) {
        return res.status(401).json({ error: 'invalid_client' });
      }
      
      const application = await Application.findOne({ 
        clientId: credentials.clientId,
        status: 'active'
      });
      
      if (!application) {
        return res.status(401).json({ error: 'invalid_client' });
      }
      
      // Find and revoke token
      const oauthToken = await OAuthToken.findByToken(token);
      
      if (oauthToken && oauthToken.application._id.toString() === application._id.toString()) {
        await oauthToken.revoke('client_revoked');
      }
      
      // Always return 200 (RFC 7009)
      res.status(200).send();
    } catch (error) {
      console.error('Revocation error:', error);
      res.status(200).send(); // Still return 200 per spec
    }
  }
);

// ============================================
// Logout Endpoint
// ============================================

router.get('/logout', async (req, res) => {
  const { 
    id_token_hint, 
    post_logout_redirect_uri, 
    state,
    client_id 
  } = req.query;
  
  try {
    // Validate post_logout_redirect_uri if provided
    if (post_logout_redirect_uri && client_id) {
      const application = await Application.findOne({ clientId: client_id });
      if (!application || !application.oauth.logoutUrls.includes(post_logout_redirect_uri)) {
        return res.status(400).render('oauth/error', {
          title: 'Logout Error',
          error: 'invalid_request',
          error_description: 'Invalid post_logout_redirect_uri'
        });
      }
    }
    
    // Logout user
    if (req.isAuthenticated()) {
      // Revoke all tokens for this user/app if id_token_hint provided
      if (id_token_hint) {
        try {
          const decoded = jwt.verify(id_token_hint, process.env.JWT_SECRET);
          const application = await Application.findOne({ clientId: decoded.aud });
          if (application) {
            await OAuthToken.revokeAllForUser(decoded.sub, application._id);
          }
        } catch (e) {
          // Invalid ID token, ignore
        }
      }
      
      req.logout((err) => {
        if (err) console.error('Logout error:', err);
      });
    }
    
    // Redirect
    if (post_logout_redirect_uri) {
      const redirectUrl = new URL(post_logout_redirect_uri);
      if (state) redirectUrl.searchParams.set('state', state);
      return res.redirect(redirectUrl.toString());
    }
    
    res.render('oauth/logged-out', {
      title: 'Logged Out',
      message: 'You have been logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).render('oauth/error', {
      title: 'Error',
      error: 'server_error',
      error_description: 'An unexpected error occurred'
    });
  }
});

module.exports = router;
