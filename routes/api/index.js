const express = require('express');
const router = express.Router();

// Import API sub-routes
const authRoutes = require('./auth');

// Mount API routes
router.use('/auth', authRoutes);

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
    name: 'Passport Authentication API',
    version: '1.0.0',
    endpoints: {
      auth: {
        login: 'POST /api/auth/login',
        register: 'POST /api/auth/register',
        refresh: 'POST /api/auth/refresh',
        logout: 'POST /api/auth/logout',
        me: 'GET /api/auth/me'
      }
    }
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
