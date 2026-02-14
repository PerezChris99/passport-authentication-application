/**
 * Magic Link Model
 * Passwordless authentication via email
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const MagicLinkSchema = new mongoose.Schema({
  // Token
  token: {
    type: String,
    required: true,
    unique: true
  },
  tokenHash: {
    type: String,
    required: true,
    index: true
  },
  
  // User (may not exist yet for registration)
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Context
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization'
  },
  application: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Application'
  },
  
  // Purpose
  type: {
    type: String,
    enum: ['login', 'register', 'verify', 'invite'],
    default: 'login'
  },
  
  // Redirect after auth
  redirectUri: String,
  state: String,
  
  // Expiration
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'used', 'expired', 'revoked'],
    default: 'pending'
  },
  usedAt: Date,
  
  // Security
  ipAddress: String,
  userAgent: String,
  
  // Metadata
  metadata: {
    type: Map,
    of: String
  }
}, {
  timestamps: true
});

// Indexes
MagicLinkSchema.index({ tokenHash: 1 });
MagicLinkSchema.index({ email: 1 });
MagicLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Generate magic link
MagicLinkSchema.statics.generate = async function(data) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  // Invalidate any existing pending links for this email
  await this.updateMany(
    { email: data.email, status: 'pending' },
    { status: 'revoked' }
  );
  
  const magicLink = new this({
    ...data,
    token,
    tokenHash
  });
  
  await magicLink.save();
  
  return {
    magicLink,
    token // Return plain token for URL
  };
};

// Find by token
MagicLinkSchema.statics.findByToken = async function(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return this.findOne({ 
    tokenHash, 
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).populate('user organization application');
};

// Consume (use) the magic link
MagicLinkSchema.methods.consume = async function() {
  if (this.status !== 'pending') {
    throw new Error('Magic link already used or expired');
  }
  
  if (new Date() > this.expiresAt) {
    this.status = 'expired';
    await this.save();
    throw new Error('Magic link expired');
  }
  
  this.status = 'used';
  this.usedAt = new Date();
  await this.save();
  
  return true;
};

// Check if valid
MagicLinkSchema.methods.isValid = function() {
  return this.status === 'pending' && new Date() < this.expiresAt;
};

module.exports = mongoose.model('MagicLink', MagicLinkSchema);
