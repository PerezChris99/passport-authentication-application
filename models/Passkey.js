/**
 * Passkey/WebAuthn Model
 * Stores WebAuthn credentials for passwordless authentication
 * This is a critical differentiator - no major competitor has proper passkey support
 */

const mongoose = require('mongoose');

const PasskeySchema = new mongoose.Schema({
  // User reference
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // WebAuthn credential data
  credentialId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Public key in COSE format (base64 encoded)
  publicKey: {
    type: String,
    required: true
  },
  
  // Signature counter for replay attack prevention
  counter: {
    type: Number,
    required: true,
    default: 0
  },
  
  // Credential type
  credentialType: {
    type: String,
    enum: ['public-key'],
    default: 'public-key'
  },
  
  // Authenticator type
  authenticatorType: {
    type: String,
    enum: ['platform', 'cross-platform'],
    default: 'platform'
  },
  
  // Transports the authenticator supports
  transports: [{
    type: String,
    enum: ['usb', 'ble', 'nfc', 'internal', 'hybrid', 'smart-card']
  }],
  
  // Attestation data
  attestationFormat: {
    type: String,
    enum: ['none', 'packed', 'tpm', 'android-key', 'android-safetynet', 'fido-u2f', 'apple'],
    default: 'none'
  },
  
  // AAGUID - Authenticator Attestation GUID
  aaguid: String,
  
  // User-friendly name for the passkey
  name: {
    type: String,
    default: 'My Passkey',
    maxlength: 100
  },
  
  // Device information
  deviceInfo: {
    platform: String,      // 'Windows', 'macOS', 'iOS', 'Android'
    browser: String,       // 'Chrome', 'Safari', 'Firefox'
    userAgent: String
  },
  
  // Backup eligibility and state (for synced passkeys)
  backupEligible: {
    type: Boolean,
    default: false
  },
  backupState: {
    type: Boolean,
    default: false
  },
  
  // UV (User Verification) capability
  userVerified: {
    type: Boolean,
    default: true
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUsedAt: Date,
  
  // Usage count
  useCount: {
    type: Number,
    default: 0
  },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'revoked'],
    default: 'active'
  },
  
  // Revocation details
  revokedAt: Date,
  revokedReason: String

}, {
  timestamps: true
});

// Compound indexes
PasskeySchema.index({ user: 1, status: 1 });
PasskeySchema.index({ credentialId: 1, status: 1 });

// Virtual for credential ID buffer
PasskeySchema.virtual('credentialIdBuffer').get(function() {
  return Buffer.from(this.credentialId, 'base64url');
});

// Virtual for public key buffer
PasskeySchema.virtual('publicKeyBuffer').get(function() {
  return Buffer.from(this.publicKey, 'base64url');
});

// Instance method to increment counter
PasskeySchema.methods.incrementCounter = function(newCounter) {
  if (newCounter <= this.counter) {
    throw new Error('Invalid counter value - possible replay attack');
  }
  this.counter = newCounter;
  this.lastUsedAt = new Date();
  this.useCount += 1;
  return this.save();
};

// Instance method to revoke passkey
PasskeySchema.methods.revoke = function(reason = 'User requested') {
  this.status = 'revoked';
  this.revokedAt = new Date();
  this.revokedReason = reason;
  return this.save();
};

// Static method to find active passkey by credential ID
PasskeySchema.statics.findByCredentialId = function(credentialId) {
  return this.findOne({ 
    credentialId, 
    status: 'active' 
  }).populate('user');
};

// Static method to get user's active passkeys
PasskeySchema.statics.getForUser = function(userId) {
  return this.find({ 
    user: userId, 
    status: 'active' 
  }).sort({ lastUsedAt: -1 });
};

// Static method to count user's passkeys
PasskeySchema.statics.countForUser = function(userId) {
  return this.countDocuments({ 
    user: userId, 
    status: 'active' 
  });
};

module.exports = mongoose.model('Passkey', PasskeySchema);
