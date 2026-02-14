const express = require('express');
const router = express.Router();

// Import API sub-routes
const authRoutes = require('./auth');
const sdkRoutes = require('./sdk');

// Mount API routes
router.use('/auth', authRoutes);
router.use('/sdk', sdkRoutes);

// API health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API info
router.get('/', (req, res) => {
  res.json({
    name: 'AuthService API',
    version: '1.0.0',
    description: 'Auth-as-a-Service platform API',
    endpoints: {
      auth: {
        login: 'POST /api/auth/login',
        register: 'POST /api/auth/register',
        refresh: 'POST /api/auth/refresh',
        logout: 'POST /api/auth/logout',
        me: 'GET /api/auth/me'
      },
      sdk: {
        users: 'GET/POST /api/sdk/users',
        userById: 'GET/PATCH/DELETE /api/sdk/users/:userId',
        verifyPassword: 'POST /api/sdk/auth/verify-password',
        generateTokens: 'POST /api/sdk/auth/tokens',
        magicLink: 'POST /api/sdk/auth/magic-link',
        revoke: 'POST /api/sdk/auth/revoke',
        sessions: 'GET /api/sdk/users/:userId/sessions',
        organization: 'GET /api/sdk/organization',
        stats: 'GET /api/sdk/stats'
      },
      oauth: {
        authorize: 'GET /oauth/authorize',
        token: 'POST /oauth/token',
        userinfo: 'GET /oauth/userinfo',
        introspect: 'POST /oauth/introspect',
        revoke: 'POST /oauth/revoke',
        discovery: 'GET /oauth/.well-known/openid-configuration'
      }
    },
    documentation: '/docs'
  });
});

// 404 handler for API
router.use((req, res) => {
  res.status(404).json({
    status: 404,
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

module.exports = router;
