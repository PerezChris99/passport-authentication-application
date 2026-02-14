module.exports = {
  ensureAuthenticated: function(req, res, next) {
    if (req.isAuthenticated()) {
      return next();
    }
    req.flash('error_msg', 'Please log in to view this resource');
    res.redirect('/login');
  },
  forwardAuthenticated: function(req, res, next) {
    if (!req.isAuthenticated()) {
      return next();
    }
    res.redirect('/dashboard');      
  },
  ensureAdmin: function(req, res, next) {
    if (req.isAuthenticated() && req.user.role === 'admin') {
      return next();
    }
    req.flash('error_msg', 'Access denied. Admin privileges required');
    res.redirect('/dashboard');
  },
  ensureVerified: function(req, res, next) {
    if (req.isAuthenticated() && req.user.isVerified) {
      return next();
    } else if (req.isAuthenticated()) {
      req.flash('error_msg', 'Please verify your email address to access this feature');
      res.redirect('/dashboard');
    } else {
      req.flash('error_msg', 'Please log in to view this resource');
      res.redirect('/login');
    }
  },
  ensureApiAuthenticated: function(req, res, next) {
    const passport = require('passport');
    passport.authenticate('jwt', { session: false }, function(err, user, info) {
      if (err) {
        return next(err);
      }
      if (!user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      req.user = user;
      next();
    })(req, res, next);
  }
};
