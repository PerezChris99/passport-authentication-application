/**
 * OAuth Token Model
 * Stores OAuth access tokens, refresh tokens, and authorization codes
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const OAuthTokenSchema = new mongoose.Schema({
  // Token type
  type: {
    type: String,
    enum: ['authorization_code', 'access_token', 'refresh_token', 'id_token'],
    required: true
  },
  
  // Token value (hashed for security)
  token: {
    type: String,
    required: true
  },
  tokenHash: {
    type: String,
    required: true,
    index: true
  },
  
  // Relationships
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  application: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Application',
    required: true
  },
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  
  // OAuth flow data
  scope: [String],
  redirectUri: String,
  state: String,
  nonce: String,
  
  // PKCE
  codeChallenge: String,
  codeChallengeMethod: {
    type: String,
    enum: ['plain', 'S256']
  },
  
  // Expiration
  expiresAt: {
    type: Date,
    required: true
  },
  
  // For refresh tokens - link to access token
  accessTokenId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OAuthToken'
  },
  
  // Rotation tracking for refresh tokens
  rotatedAt: Date,
  rotatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OAuthToken'
  },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'used', 'revoked', 'expired'],
    default: 'active'
  },
  revokedAt: Date,
  revokedReason: String,
  
  // Session binding
  sessionId: String,
  
  // Security context
  ipAddress: String,
  userAgent: String,
  deviceInfo: {
    type: String,
    browser: String,
    os: String,
    device: String
  }
}, {
  timestamps: true
});

// Indexes
OAuthTokenSchema.index({ tokenHash: 1 });
OAuthTokenSchema.index({ user: 1, application: 1 });
OAuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
OAuthTokenSchema.index({ type: 1, status: 1 });

// Generate token
OAuthTokenSchema.statics.generate = async function(data) {
  let tokenValue;
  let prefix;
  
  switch (data.type) {
    case 'authorization_code':
      prefix = 'code';
      tokenValue = crypto.randomBytes(32).toString('base64url');
      break;
    case 'access_token':
      prefix = 'at';
      tokenValue = crypto.randomBytes(48).toString('base64url');
      break;
    case 'refresh_token':
      prefix = 'rt';
      tokenValue = crypto.randomBytes(48).toString('base64url');
      break;
    default:
      throw new Error('Invalid token type');
  }
  
  const token = `${prefix}_${tokenValue}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  const oauthToken = new this({
    ...data,
    token,
    tokenHash
  });
  
  await oauthToken.save();
  
  return {
    oauthToken,
    plainToken: token
  };
};

// Find by token
OAuthTokenSchema.statics.findByToken = async function(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return this.findOne({ 
    tokenHash,
    status: 'active',
    expiresAt: { $gt: new Date() }
  }).populate('user application organization');
};

// Verify code challenge (PKCE)
OAuthTokenSchema.methods.verifyCodeChallenge = function(codeVerifier) {
  if (!this.codeChallenge) return true;
  
  if (this.codeChallengeMethod === 'plain') {
    return this.codeChallenge === codeVerifier;
  }
  
  if (this.codeChallengeMethod === 'S256') {
    const hash = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    return hash === this.codeChallenge;
  }
  
  return false;
};

// Mark as used (for authorization codes)
OAuthTokenSchema.methods.markAsUsed = async function() {
  this.status = 'used';
  await this.save();
};

// Revoke
OAuthTokenSchema.methods.revoke = async function(reason) {
  this.status = 'revoked';
  this.revokedAt = new Date();
  this.revokedReason = reason;
  await this.save();
};

// Revoke all tokens for user/app
OAuthTokenSchema.statics.revokeAllForUser = async function(userId, applicationId = null) {
  const query = { user: userId, status: 'active' };
  if (applicationId) query.application = applicationId;
  
  return this.updateMany(query, {
    status: 'revoked',
    revokedAt: new Date(),
    revokedReason: 'user_revoked'
  });
};

module.exports = mongoose.model('OAuthToken', OAuthTokenSchema);
