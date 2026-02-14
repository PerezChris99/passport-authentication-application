const express = require('express');
const router = express.Router();
const passport = require('passport');
const crypto = require('crypto');
const User = require('../models/User');
const { forwardAuthenticated, ensureAuthenticated } = require('../config/auth');
const { sendVerificationEmail, sendPasswordResetEmail, send2FACode } = require('../utils/email');
const { generateToken, setup2FA, verify2FAToken, generate2FACode } = require('../utils/security');
const { logAuditEvent } = require('../middleware/auditLogger');
const { 
  registerValidation, 
  loginValidation, 
  forgotPasswordValidation,
  resetPasswordValidation,
  changePasswordValidation,
  twoFactorValidation,
  handleValidationErrors 
} = require('../middleware/validators');
const { 
  authLimiter, 
  registrationLimiter, 
  passwordResetLimiter,
  twoFactorLimiter,
  emailVerificationLimiter 
} = require('../middleware/rateLimiter');

// ==========================================
// LOGIN ROUTES
// ==========================================

// Login page
router.get('/login', forwardAuthenticated, (req, res) => {
  res.render('login', { csrfToken: req.csrfToken() });
});

// Login process
router.post('/login', authLimiter, loginValidation, handleValidationErrors, (req, res, next) => {
  passport.authenticate('local', async (err, user, info) => {
    if (err) {
      await logAuditEvent(req, 'LOGIN_FAILURE', 'failure', { error: err.message });
      return next(err);
    }
    
    if (!user) {
      await logAuditEvent(req, 'LOGIN_FAILURE', 'failure', { 
        email: req.body.email,
        reason: info?.message 
      });
      req.flash('error_msg', info?.message || 'Invalid credentials');
      return res.redirect('/auth/login');
    }
    
    // Check if email is verified (skip for OAuth users)
    if (!user.isVerified && !user.password.startsWith('google-oauth') && 
        !user.password.startsWith('facebook-oauth') && !user.password.startsWith('github-oauth')) {
      req.flash('error_msg', 'Please verify your email before logging in. Check your inbox or request a new verification email.');
      return res.redirect('/auth/login');
    }
    
    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      req.session.pendingUserId = user.id;
      req.session.twoFactorPending = true;
      
      // For email-based 2FA (no secret stored)
      if (!user.twoFactorSecret) {
        const code = generate2FACode();
        req.session.twoFactorCode = code;
        req.session.twoFactorCodeExpires = Date.now() + 10 * 60 * 1000;
        
        try {
          await send2FACode(user, code);
        } catch (emailErr) {
          console.error('Error sending 2FA code:', emailErr);
        }
      }
      
      return res.redirect('/auth/2fa-verify');
    }

    // Regular login
    req.logIn(user, async (err) => {
      if (err) {
        await logAuditEvent(req, 'LOGIN_FAILURE', 'failure', { error: err.message });
        return next(err);
      }
      
      // Update last login
      user.lastLogin = new Date();
      await user.save();
      
      await logAuditEvent(req, 'LOGIN_SUCCESS', 'success', { userId: user.id });
      
      // Redirect to intended URL or dashboard
      const redirectTo = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;
      return res.redirect(redirectTo);
    });
  })(req, res, next);
});

// ==========================================
// REGISTRATION ROUTES
// ==========================================

// Registration page
router.get('/register', forwardAuthenticated, (req, res) => {
  res.render('register', { csrfToken: req.csrfToken() });
});

// Registration process
router.post('/register', registrationLimiter, registerValidation, handleValidationErrors, async (req, res) => {
  const { username, email, password, firstName, lastName } = req.body;
  
  try {
    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    
    if (existingUser) {
      if (existingUser.email === email) {
        req.flash('error_msg', 'Email is already registered');
      } else {
        req.flash('error_msg', 'Username is already taken');
      }
      return res.redirect('/auth/register');
    }
    
    // Generate verification token
    const verificationToken = generateToken();
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Create user
    const user = new User({
      username,
      email,
      password,
      firstName,
      lastName,
      verificationToken,
      verificationTokenExpires,
      isVerified: false
    });
    
    await user.save();
    
    // Send verification email
    const verificationUrl = `${req.protocol}://${req.get('host')}/auth/verify-email/${verificationToken}`;
    
    try {
      await sendVerificationEmail(user, verificationUrl);
      await logAuditEvent(req, 'REGISTER', 'success', { userId: user.id });
      req.flash('success_msg', 'Registration successful! Please check your email to verify your account.');
    } catch (emailErr) {
      console.error('Error sending verification email:', emailErr);
      await logAuditEvent(req, 'REGISTER', 'warning', { 
        userId: user.id, 
        note: 'Email sending failed' 
      });
      req.flash('success_msg', 'Registration successful! However, we could not send a verification email. Please request a new one.');
    }
    
    res.redirect('/auth/login');
    
  } catch (error) {
    console.error('Registration error:', error);
    await logAuditEvent(req, 'REGISTER', 'failure', { error: error.message });
    req.flash('error_msg', 'An error occurred during registration. Please try again.');
    res.redirect('/auth/register');
  }
});

// ==========================================
// EMAIL VERIFICATION ROUTES
// ==========================================

// Verify email
router.get('/verify-email/:token', async (req, res) => {
  try {
    const user = await User.findOne({
      verificationToken: req.params.token,
      verificationTokenExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      req.flash('error_msg', 'Invalid or expired verification link. Please request a new one.');
      return res.redirect('/auth/login');
    }
    
    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();
    
    await logAuditEvent(req, 'EMAIL_VERIFICATION', 'success', { userId: user.id });
    req.flash('success_msg', 'Email verified successfully! You can now log in.');
    res.redirect('/auth/login');
    
  } catch (error) {
    console.error('Verification error:', error);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/auth/login');
  }
});

// Resend verification email page
router.get('/resend-verification', forwardAuthenticated, (req, res) => {
  res.render('resend-verification', { csrfToken: req.csrfToken() });
});

// Resend verification email
router.post('/resend-verification', emailVerificationLimiter, async (req, res) => {
  const { email } = req.body;
  
  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      // Don't reveal if user exists
      req.flash('success_msg', 'If an account exists with that email, a verification link has been sent.');
      return res.redirect('/auth/login');
    }
    
    if (user.isVerified) {
      req.flash('success_msg', 'This email is already verified. You can log in.');
      return res.redirect('/auth/login');
    }
    
    // Generate new token
    user.verificationToken = generateToken();
    user.verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();
    
    const verificationUrl = `${req.protocol}://${req.get('host')}/auth/verify-email/${user.verificationToken}`;
    await sendVerificationEmail(user, verificationUrl);
    
    await logAuditEvent(req, 'EMAIL_VERIFICATION_RESEND', 'success', { userId: user.id });
    req.flash('success_msg', 'Verification email sent! Please check your inbox.');
    res.redirect('/auth/login');
    
  } catch (error) {
    console.error('Resend verification error:', error);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/auth/resend-verification');
  }
});

// ==========================================
// PASSWORD RESET ROUTES
// ==========================================

// Forgot password page
router.get('/forgot-password', forwardAuthenticated, (req, res) => {
  res.render('forgot-password', { csrfToken: req.csrfToken() });
});

// Forgot password process
router.post('/forgot-password', passwordResetLimiter, forgotPasswordValidation, handleValidationErrors, async (req, res) => {
  const { email } = req.body;
  
  try {
    const user = await User.findOne({ email });
    
    // Always show same message (security)
    const successMessage = 'If an account exists with that email, a password reset link has been sent.';
    
    if (!user) {
      req.flash('success_msg', successMessage);
      return res.redirect('/auth/login');
    }
    
    // Generate reset token
    const resetToken = generateToken();
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();
    
    const resetUrl = `${req.protocol}://${req.get('host')}/auth/reset-password/${resetToken}`;
    await sendPasswordResetEmail(user, resetUrl);
    
    await logAuditEvent(req, 'PASSWORD_RESET_REQUEST', 'success', { userId: user.id });
    req.flash('success_msg', successMessage);
    res.redirect('/auth/login');
    
  } catch (error) {
    console.error('Forgot password error:', error);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/auth/forgot-password');
  }
});

// Reset password page
router.get('/reset-password/:token', async (req, res) => {
  try {
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      req.flash('error_msg', 'Password reset link is invalid or has expired.');
      return res.redirect('/auth/forgot-password');
    }
    
    res.render('reset-password', { 
      token: req.params.token,
      csrfToken: req.csrfToken() 
    });
    
  } catch (error) {
    console.error('Reset password page error:', error);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/auth/forgot-password');
  }
});

// Reset password process
router.post('/reset-password/:token', resetPasswordValidation, handleValidationErrors, async (req, res) => {
  try {
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      req.flash('error_msg', 'Password reset link is invalid or has expired.');
      return res.redirect('/auth/forgot-password');
    }
    
    // Update password
    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.failedLoginAttempts = 0;
    user.accountLocked = false;
    user.accountLockedUntil = undefined;
    await user.save();
    
    await logAuditEvent(req, 'PASSWORD_RESET_SUCCESS', 'success', { userId: user.id });
    req.flash('success_msg', 'Password has been reset successfully. You can now log in.');
    res.redirect('/auth/login');
    
  } catch (error) {
    console.error('Reset password error:', error);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/auth/forgot-password');
  }
});

// ==========================================
// CHANGE PASSWORD (AUTHENTICATED)
// ==========================================

router.get('/change-password', ensureAuthenticated, (req, res) => {
  res.render('change-password', { csrfToken: req.csrfToken() });
});

router.post('/change-password', ensureAuthenticated, changePasswordValidation, handleValidationErrors, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  try {
    const user = await User.findById(req.user.id);
    
    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      req.flash('error_msg', 'Current password is incorrect');
      return res.redirect('/auth/change-password');
    }
    
    user.password = newPassword;
    await user.save();
    
    await logAuditEvent(req, 'PASSWORD_CHANGE', 'success', { userId: user.id });
    req.flash('success_msg', 'Password changed successfully');
    res.redirect('/dashboard');
    
  } catch (error) {
    console.error('Change password error:', error);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/auth/change-password');
  }
});

// ==========================================
// TWO-FACTOR AUTHENTICATION ROUTES
// ==========================================

// 2FA verification page (during login)
router.get('/2fa-verify', (req, res) => {
  if (!req.session.pendingUserId || !req.session.twoFactorPending) {
    return res.redirect('/auth/login');
  }
  res.render('2fa-verify', { csrfToken: req.csrfToken() });
});

// 2FA verification process
router.post('/2fa-verify', twoFactorLimiter, twoFactorValidation, handleValidationErrors, async (req, res) => {
  const { token } = req.body;
  const userId = req.session.pendingUserId;
  
  if (!userId || !req.session.twoFactorPending) {
    req.flash('error_msg', 'Session expired. Please log in again.');
    return res.redirect('/auth/login');
  }
  
  try {
    const user = await User.findById(userId);
    
    if (!user) {
      req.flash('error_msg', 'User not found. Please log in again.');
      return res.redirect('/auth/login');
    }
    
    let isValid = false;
    
    // Check TOTP (app-based 2FA)
    if (user.twoFactorSecret) {
      isValid = verify2FAToken(token, user.twoFactorSecret);
    } 
    // Check email-based 2FA
    else if (req.session.twoFactorCode) {
      if (Date.now() > req.session.twoFactorCodeExpires) {
        req.flash('error_msg', 'Verification code has expired. Please log in again.');
        delete req.session.pendingUserId;
        delete req.session.twoFactorPending;
        delete req.session.twoFactorCode;
        delete req.session.twoFactorCodeExpires;
        return res.redirect('/auth/login');
      }
      isValid = token === req.session.twoFactorCode;
    }
    
    if (!isValid) {
      await logAuditEvent(req, '2FA_FAILED', 'failure', { userId: user.id });
      req.flash('error_msg', 'Invalid verification code');
      return res.redirect('/auth/2fa-verify');
    }
    
    // Clean up session
    delete req.session.pendingUserId;
    delete req.session.twoFactorPending;
    delete req.session.twoFactorCode;
    delete req.session.twoFactorCodeExpires;
    
    // Complete login
    req.logIn(user, async (err) => {
      if (err) {
        console.error('Login error after 2FA:', err);
        req.flash('error_msg', 'An error occurred. Please try again.');
        return res.redirect('/auth/login');
      }
      
      user.lastLogin = new Date();
      await user.save();
      
      await logAuditEvent(req, '2FA_VERIFIED', 'success', { userId: user.id });
      await logAuditEvent(req, 'LOGIN_SUCCESS', 'success', { userId: user.id, twoFactor: true });
      
      const redirectTo = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;
      res.redirect(redirectTo);
    });
    
  } catch (error) {
    console.error('2FA verification error:', error);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/auth/login');
  }
});

// 2FA setup page
router.get('/2fa/setup', ensureAuthenticated, async (req, res) => {
  try {
    if (req.user.twoFactorEnabled) {
      req.flash('error_msg', 'Two-factor authentication is already enabled');
      return res.redirect('/users/profile');
    }
    
    const { secret, qrCodeUrl } = await setup2FA(req.user);
    
    // Store secret temporarily in session
    req.session.tempTwoFactorSecret = secret;
    
    res.render('2fa-setup', { 
      qrCodeUrl, 
      secret,
      csrfToken: req.csrfToken() 
    });
    
  } catch (error) {
    console.error('2FA setup error:', error);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/users/profile');
  }
});

// Enable 2FA
router.post('/2fa/enable', ensureAuthenticated, twoFactorValidation, handleValidationErrors, async (req, res) => {
  const { token } = req.body;
  const secret = req.session.tempTwoFactorSecret;
  
  if (!secret) {
    req.flash('error_msg', 'Session expired. Please try setting up 2FA again.');
    return res.redirect('/auth/2fa/setup');
  }
  
  try {
    // Verify the token
    const isValid = verify2FAToken(token, secret);
    
    if (!isValid) {
      req.flash('error_msg', 'Invalid verification code. Please try again.');
      return res.redirect('/auth/2fa/setup');
    }
    
    // Enable 2FA
    const user = await User.findById(req.user.id);
    user.twoFactorEnabled = true;
    user.twoFactorSecret = secret;
    await user.save();
    
    delete req.session.tempTwoFactorSecret;
    
    await logAuditEvent(req, '2FA_ENABLED', 'success', { userId: user.id });
    req.flash('success_msg', 'Two-factor authentication has been enabled');
    res.redirect('/users/profile');
    
  } catch (error) {
    console.error('Enable 2FA error:', error);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/auth/2fa/setup');
  }
});

// Disable 2FA
router.post('/2fa/disable', ensureAuthenticated, async (req, res) => {
  const { password, token } = req.body;
  
  try {
    const user = await User.findById(req.user.id);
    
    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      req.flash('error_msg', 'Incorrect password');
      return res.redirect('/users/profile');
    }
    
    // Verify 2FA token if TOTP is set up
    if (user.twoFactorSecret && token) {
      const isValid = verify2FAToken(token, user.twoFactorSecret);
      if (!isValid) {
        req.flash('error_msg', 'Invalid verification code');
        return res.redirect('/users/profile');
      }
    }
    
    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    await user.save();
    
    await logAuditEvent(req, '2FA_DISABLED', 'success', { userId: user.id });
    req.flash('success_msg', 'Two-factor authentication has been disabled');
    res.redirect('/users/profile');
    
  } catch (error) {
    console.error('Disable 2FA error:', error);
    req.flash('error_msg', 'An error occurred. Please try again.');
    res.redirect('/users/profile');
  }
});

// ==========================================
// OAUTH ROUTES
// ==========================================

// Google OAuth
router.get('/google', passport.authenticate('google', { 
  scope: ['profile', 'email'] 
}));

router.get('/google/callback', 
  passport.authenticate('google', { 
    failureRedirect: '/auth/login',
    failureFlash: 'Google authentication failed'
  }),
  async (req, res) => {
    await logAuditEvent(req, 'OAUTH_LOGIN', 'success', { 
      userId: req.user.id, 
      provider: 'google' 
    });
    res.redirect('/dashboard');
  }
);

// Facebook OAuth
router.get('/facebook', passport.authenticate('facebook', { 
  scope: ['email'] 
}));

router.get('/facebook/callback',
  passport.authenticate('facebook', { 
    failureRedirect: '/auth/login',
    failureFlash: 'Facebook authentication failed'
  }),
  async (req, res) => {
    await logAuditEvent(req, 'OAUTH_LOGIN', 'success', { 
      userId: req.user.id, 
      provider: 'facebook' 
    });
    res.redirect('/dashboard');
  }
);

// GitHub OAuth
router.get('/github', passport.authenticate('github', { 
  scope: ['user:email'] 
}));

router.get('/github/callback',
  passport.authenticate('github', { 
    failureRedirect: '/auth/login',
    failureFlash: 'GitHub authentication failed'
  }),
  async (req, res) => {
    await logAuditEvent(req, 'OAUTH_LOGIN', 'success', { 
      userId: req.user.id, 
      provider: 'github' 
    });
    res.redirect('/dashboard');
  }
);

// ==========================================
// LOGOUT
// ==========================================

router.get('/logout', ensureAuthenticated, async (req, res) => {
  const userId = req.user.id;
  
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
      res.redirect('/auth/login');
    });
  });
});

router.post('/logout', ensureAuthenticated, async (req, res) => {
  const userId = req.user.id;
  
  await logAuditEvent(req, 'LOGOUT', 'success', { userId });
  
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
      res.redirect('/auth/login');
    });
  });
});

module.exports = router;
