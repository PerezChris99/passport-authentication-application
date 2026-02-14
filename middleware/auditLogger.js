const AuditLog = require('../models/AuditLog');

/**
 * Middleware to automatically log requests to audit log
 */
const auditMiddleware = (options = {}) => {
  const {
    excludePaths = ['/health', '/favicon.ico', '/css', '/js', '/images'],
    logAllRequests = false
  } = options;

  return async (req, res, next) => {
    // Skip excluded paths
    if (excludePaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Only log mutations by default
    if (!logAllRequests && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    // Store original end to capture response
    const originalEnd = res.end;
    const startTime = Date.now();

    res.end = function(...args) {
      // Calculate duration
      const duration = Date.now() - startTime;

      // Don't await - fire and forget
      setImmediate(async () => {
        try {
          // Only log significant actions
          if (res.statusCode >= 400 || req.path.includes('/auth') || req.path.includes('/admin')) {
            await AuditLog.log({
              userId: req.user?.id || null,
              action: mapRouteToAction(req.method, req.path, res.statusCode),
              status: res.statusCode < 400 ? 'success' : 'failure',
              ipAddress: getClientIp(req),
              userAgent: req.get('user-agent'),
              details: {
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                duration,
                query: Object.keys(req.query).length > 0 ? req.query : undefined
              },
              sessionId: req.sessionID
            });
          }
        } catch (error) {
          console.error('Audit logging error:', error);
        }
      });

      return originalEnd.apply(this, args);
    };

    next();
  };
};

/**
 * Helper to get client IP address
 */
const getClientIp = (req) => {
  return req.ip || 
         req.headers['x-forwarded-for']?.split(',')[0].trim() || 
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         'unknown';
};

/**
 * Map routes to audit actions
 */
const mapRouteToAction = (method, path, statusCode) => {
  const routeMap = {
    'POST /auth/login': statusCode < 400 ? 'LOGIN_SUCCESS' : 'LOGIN_FAILURE',
    'POST /auth/register': 'REGISTER',
    'GET /auth/logout': 'LOGOUT',
    'POST /auth/logout': 'LOGOUT',
    'POST /auth/forgot-password': 'PASSWORD_RESET_REQUEST',
    'POST /auth/reset-password': 'PASSWORD_RESET_SUCCESS',
    'POST /auth/change-password': 'PASSWORD_CHANGE',
    'GET /auth/verify-email': 'EMAIL_VERIFICATION',
    'POST /auth/2fa/enable': '2FA_ENABLED',
    'POST /auth/2fa/disable': '2FA_DISABLED',
    'POST /auth/2fa-verify': statusCode < 400 ? '2FA_VERIFIED' : '2FA_FAILED'
  };

  const key = `${method} ${path}`;
  return routeMap[key] || `${method}_${path.replace(/\//g, '_').toUpperCase()}`;
};

/**
 * Direct audit logging function for use in routes
 */
const logAuditEvent = async (req, action, status = 'success', details = {}) => {
  try {
    await AuditLog.log({
      userId: req.user?.id || null,
      action,
      status,
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent'),
      details,
      sessionId: req.sessionID
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
};

module.exports = {
  auditMiddleware,
  logAuditEvent,
  getClientIp
};
