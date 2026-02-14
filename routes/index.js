const express = require('express');
const router = express.Router();
const { ensureAuthenticated, ensureVerified } = require('../config/auth');
const { logUserActivity } = require('../utils/logger');

// Home route
router.get('/', (req, res) => {
  res.render('home');
});

// Dashboard route
router.get('/dashboard', ensureAuthenticated, (req, res) => {
  logUserActivity(req.user.id, 'Visited dashboard');
  res.render('dashboard', {
    user: req.user
  });
});

// Profile route
router.get('/profile', ensureAuthenticated, ensureVerified, (req, res) => {
  logUserActivity(req.user.id, 'Viewed profile');
  res.render('profile', {
    user: req.user
  });
});

module.exports = router;
