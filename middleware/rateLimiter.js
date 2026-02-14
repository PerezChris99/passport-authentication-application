const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter
 */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    status: 429,
    error: 'Too many requests',
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      status: 429,
      error: 'Too many requests',
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Strict rate limiter for authentication routes
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes
  message: {
    status: 429,
    error: 'Too many login attempts',
    message: 'Too many login attempts from this IP. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  handler: (req, res) => {
    res.status(429).json({
      status: 429,
      error: 'Too many login attempts',
      message: 'Too many login attempts from this IP. Please try again after 15 minutes.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Rate limiter for password reset requests
 */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per hour
  message: {
    status: 429,
    error: 'Too many password reset requests',
    message: 'Too many password reset requests. Please try again after an hour.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Rate limiter for email verification resend
 */
const emailVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per hour
  message: {
    status: 429,
    error: 'Too many verification emails requested',
    message: 'Too many verification email requests. Please try again after an hour.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Rate limiter for registration
 */
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour per IP
  message: {
    status: 429,
    error: 'Too many accounts created',
    message: 'Too many accounts created from this IP. Please try again after an hour.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Rate limiter for 2FA verification
 */
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: {
    status: 429,
    error: 'Too many 2FA attempts',
    message: 'Too many 2FA verification attempts. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Very strict limiter for sensitive operations
 */
const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per hour
  message: {
    status: 429,
    error: 'Rate limit exceeded',
    message: 'You have exceeded the rate limit for this operation. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Create a custom rate limiter
 */
const createLimiter = (options) => {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    message: options.message || {
      status: 429,
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    ...options
  });
};

module.exports = {
  apiLimiter,
  authLimiter,
  passwordResetLimiter,
  emailVerificationLimiter,
  registrationLimiter,
  twoFactorLimiter,
  strictLimiter,
  createLimiter
};
