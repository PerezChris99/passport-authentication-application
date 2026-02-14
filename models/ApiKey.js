/**
 * API Key Model
 * Manages API keys for server-to-server authentication
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const ApiKeySchema = new mongoose.Schema({
  // Key identifier (public, safe to expose)
  keyId: {
    type: String,
    required: true,
    unique: true,
    default: () => `pk_${crypto.randomBytes(12).toString('hex')}`
  },
  
  // Secret key (shown once, stored hashed)
  secretKey: {
    type: String,
    required: true
  },
  secretKeyHash: {
    type: String,
    required: true
  },
  secretKeyPrefix: {
    type: String,
    required: true
  },
  
  // Name and description
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 500
  },
  
  // Ownership
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  application: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Application'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Key type
  type: {
    type: String,
    enum: ['publishable', 'secret', 'restricted'],
    default: 'secret'
  },
  
  // Environment
  environment: {
    type: String,
    enum: ['development', 'staging', 'production'],
    default: 'development'
  },
  
  // Permissions/Scopes
  scopes: [{
    type: String,
    enum: [
      'users:read',
      'users:write',
      'users:delete',
      'sessions:read',
      'sessions:write',
      'sessions:delete',
      'organizations:read',
      'organizations:write',
      'applications:read',
      'applications:write',
      'logs:read',
      'webhooks:read',
      'webhooks:write',
      'stats:read',
      '*' // Full access
    ]
  }],
  
  // Rate Limiting
  rateLimit: {
    requestsPerMinute: { type: Number, default: 60 },
    requestsPerHour: { type: Number, default: 1000 },
    requestsPerDay: { type: Number, default: 10000 }
  },
  
  // IP Restrictions
  allowedIps: [String],
  
  // Expiration
  expiresAt: Date,
  
  // Status
  status: {
    type: String,
    enum: ['active', 'revoked', 'expired'],
    default: 'active'
  },
  revokedAt: Date,
  revokedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  revokedReason: String,
  
  // Usage tracking
  usage: {
    totalRequests: { type: Number, default: 0 },
    lastUsedAt: Date,
    lastUsedIp: String,
    lastUsedUserAgent: String
  },
  
  // Metadata
  metadata: {
    type: Map,
    of: String
  }
}, {
  timestamps: true
});

// Indexes
ApiKeySchema.index({ keyId: 1 });
ApiKeySchema.index({ secretKeyHash: 1 });
ApiKeySchema.index({ organization: 1 });
ApiKeySchema.index({ application: 1 });
ApiKeySchema.index({ status: 1 });
ApiKeySchema.index({ environment: 1 });
ApiKeySchema.index({ expiresAt: 1 });

// Generate new API key
ApiKeySchema.statics.generateKey = async function(data) {
  const secretKey = `sk_${data.environment === 'production' ? 'live' : 'test'}_${crypto.randomBytes(24).toString('hex')}`;
  const secretKeyHash = crypto.createHash('sha256').update(secretKey).digest('hex');
  const secretKeyPrefix = secretKey.substring(0, 12) + '...';
  
  const apiKey = new this({
    ...data,
    secretKey,
    secretKeyHash,
    secretKeyPrefix
  });
  
  await apiKey.save();
  
  // Return with full secret (only time it's available)
  return {
    apiKey,
    fullSecretKey: secretKey
  };
};

// Find by secret key
ApiKeySchema.statics.findBySecretKey = async function(secretKey) {
  const hash = crypto.createHash('sha256').update(secretKey).digest('hex');
  return this.findOne({ 
    secretKeyHash: hash, 
    status: 'active' 
  }).populate('organization application');
};

// Find by key ID
ApiKeySchema.statics.findByKeyId = function(keyId) {
  return this.findOne({ keyId }).populate('organization application createdBy');
};

// Verify and get key
ApiKeySchema.statics.verifyKey = async function(keyIdOrSecret) {
  let key;
  
  // Check if it's a key ID or secret
  if (keyIdOrSecret.startsWith('pk_')) {
    key = await this.findOne({ keyId: keyIdOrSecret, status: 'active' });
  } else if (keyIdOrSecret.startsWith('sk_')) {
    key = await this.findBySecretKey(keyIdOrSecret);
  }
  
  if (!key) return null;
  
  // Check expiration
  if (key.expiresAt && new Date() > key.expiresAt) {
    key.status = 'expired';
    await key.save();
    return null;
  }
  
  return key;
};

// Record usage
ApiKeySchema.methods.recordUsage = async function(ip, userAgent) {
  this.usage.totalRequests += 1;
  this.usage.lastUsedAt = new Date();
  this.usage.lastUsedIp = ip;
  this.usage.lastUsedUserAgent = userAgent;
  await this.save();
};

// Check if IP is allowed
ApiKeySchema.methods.isIpAllowed = function(ip) {
  if (!this.allowedIps || this.allowedIps.length === 0) return true;
  return this.allowedIps.includes(ip);
};

// Check if has scope
ApiKeySchema.methods.hasScope = function(scope) {
  if (this.scopes.includes('*')) return true;
  return this.scopes.includes(scope);
};

// Revoke key
ApiKeySchema.methods.revoke = async function(userId, reason) {
  this.status = 'revoked';
  this.revokedAt = new Date();
  this.revokedBy = userId;
  this.revokedReason = reason;
  await this.save();
};

module.exports = mongoose.model('ApiKey', ApiKeySchema);
