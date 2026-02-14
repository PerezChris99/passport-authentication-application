const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  // User who performed the action (null for anonymous actions)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // Type of action
  action: {
    type: String,
    required: true,
    enum: [
      'LOGIN_SUCCESS',
      'LOGIN_FAILURE',
      'LOGOUT',
      'REGISTER',
      'PASSWORD_RESET_REQUEST',
      'PASSWORD_RESET_SUCCESS',
      'PASSWORD_CHANGE',
      'EMAIL_VERIFICATION',
      'EMAIL_VERIFICATION_RESEND',
      '2FA_ENABLED',
      '2FA_DISABLED',
      '2FA_VERIFIED',
      '2FA_FAILED',
      'ACCOUNT_LOCKED',
      'ACCOUNT_UNLOCKED',
      'PROFILE_UPDATE',
      'OAUTH_LOGIN',
      'OAUTH_LINK',
      'API_KEY_CREATED',
      'API_KEY_REVOKED',
      'ADMIN_USER_CREATE',
      'ADMIN_USER_UPDATE',
      'ADMIN_USER_DELETE',
      'ADMIN_USER_UNLOCK',
      'SESSION_REVOKED',
      'SUSPICIOUS_ACTIVITY'
    ],
    index: true
  },
  
  // Status of the action
  status: {
    type: String,
    enum: ['success', 'failure', 'warning'],
    default: 'success'
  },
  
  // IP address
  ipAddress: {
    type: String,
    required: true
  },
  
  // User agent
  userAgent: {
    type: String
  },
  
  // Additional details
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Resource affected (e.g., user ID that was modified)
  resourceType: {
    type: String
  },
  
  resourceId: {
    type: mongoose.Schema.Types.ObjectId
  },
  
  // Geolocation (if available)
  geolocation: {
    country: String,
    city: String,
    region: String
  },
  
  // Session ID
  sessionId: {
    type: String
  },
  
  // Timestamp
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Indexes for common queries
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ ipAddress: 1, createdAt: -1 });

// Static method to log an audit event
AuditLogSchema.statics.log = async function(data) {
  try {
    const log = new this(data);
    await log.save();
    return log;
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - audit logging should not break the app
    return null;
  }
};

// Static method to get user's recent activity
AuditLogSchema.statics.getUserActivity = async function(userId, limit = 50) {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

// Static method to get failed login attempts
AuditLogSchema.statics.getFailedLogins = async function(ipAddress, since) {
  return this.countDocuments({
    action: 'LOGIN_FAILURE',
    ipAddress,
    createdAt: { $gte: since }
  });
};

// Static method to detect suspicious activity
AuditLogSchema.statics.detectSuspiciousActivity = async function(userId, ipAddress) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  // Check for multiple failed logins
  const failedLogins = await this.countDocuments({
    action: 'LOGIN_FAILURE',
    $or: [{ userId }, { ipAddress }],
    createdAt: { $gte: oneHourAgo }
  });
  
  // Check for logins from multiple IPs
  const distinctIps = await this.distinct('ipAddress', {
    userId,
    action: 'LOGIN_SUCCESS',
    createdAt: { $gte: oneHourAgo }
  });
  
  return {
    failedLoginCount: failedLogins,
    distinctIpCount: distinctIps.length,
    suspicious: failedLogins >= 5 || distinctIps.length >= 3
  };
};

// TTL index to auto-delete old logs (optional - 90 days retention)
// Uncomment to enable automatic deletion
// AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

module.exports = AuditLog;
