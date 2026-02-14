/**
 * Application Model
 * Represents a client application that uses the auth service
 * Each organization can have multiple applications
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const ApplicationSchema = new mongoose.Schema({
  // Basic Info
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
  
  // Organization
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  
  // Application Type
  type: {
    type: String,
    enum: ['web', 'spa', 'native', 'mobile', 'machine-to-machine', 'api'],
    default: 'web'
  },
  
  // Credentials
  clientId: {
    type: String,
    required: true,
    unique: true,
    default: () => `app_${crypto.randomBytes(16).toString('hex')}`
  },
  clientSecret: {
    type: String,
    required: true,
    default: () => crypto.randomBytes(32).toString('hex')
  },
  clientSecretHash: String, // For secure storage
  
  // OAuth Settings
  oauth: {
    // Allowed grant types
    grantTypes: [{
      type: String,
      enum: ['authorization_code', 'implicit', 'client_credentials', 'refresh_token', 'password'],
      default: ['authorization_code', 'refresh_token']
    }],
    
    // Redirect URIs (required for authorization_code and implicit)
    redirectUris: [{
      type: String,
      validate: {
        validator: function(v) {
          try {
            new URL(v);
            return true;
          } catch {
            return false;
          }
        },
        message: 'Invalid URL format'
      }
    }],
    
    // Allowed origins for CORS
    allowedOrigins: [String],
    
    // Logout URLs
    logoutUrls: [String],
    
    // Allowed callback URLs for web message response
    allowedWebOrigins: [String],
    
    // Token settings
    accessTokenLifetime: { type: Number, default: 3600 }, // 1 hour in seconds
    refreshTokenLifetime: { type: Number, default: 2592000 }, // 30 days
    idTokenLifetime: { type: Number, default: 3600 },
    
    // Token signing
    tokenSigningAlg: {
      type: String,
      enum: ['HS256', 'RS256'],
      default: 'RS256'
    },
    
    // PKCE requirement
    requirePKCE: { type: Boolean, default: true }
  },
  
  // Scopes this application can request
  allowedScopes: [{
    type: String,
    default: ['openid', 'profile', 'email']
  }],
  
  // API Permissions (for machine-to-machine apps)
  apiPermissions: [{
    api: String, // API identifier
    scopes: [String]
  }],
  
  // Branding (can override org branding)
  branding: {
    logo: String,
    primaryColor: String,
    backgroundColor: String
  },
  
  // Settings
  settings: {
    // Authentication
    allowedAuthMethods: {
      emailPassword: { type: Boolean, default: true },
      magicLink: { type: Boolean, default: true },
      google: { type: Boolean, default: true },
      facebook: { type: Boolean, default: true },
      github: { type: Boolean, default: true }
    },
    
    // Refresh token behavior
    refreshTokenRotation: { type: Boolean, default: true },
    refreshTokenReuseDetection: { type: Boolean, default: true },
    
    // Session
    useCookies: { type: Boolean, default: true },
    cookieDomain: String,
    
    // Cross-origin
    allowCrossOriginAuth: { type: Boolean, default: false }
  },
  
  // Connections (enabled identity providers)
  connections: [{
    type: {
      type: String,
      enum: ['database', 'google', 'facebook', 'github', 'saml', 'ldap']
    },
    enabled: { type: Boolean, default: true },
    settings: mongoose.Schema.Types.Mixed
  }],
  
  // Webhooks specific to this app
  webhooks: [{
    url: String,
    events: [String],
    enabled: { type: Boolean, default: true },
    secret: String
  }],
  
  // Status
  status: {
    type: String,
    enum: ['active', 'disabled', 'deleted'],
    default: 'active'
  },
  
  // Metadata
  metadata: {
    type: Map,
    of: String
  },
  
  // Usage tracking
  stats: {
    totalUsers: { type: Number, default: 0 },
    totalLogins: { type: Number, default: 0 },
    lastLoginAt: Date
  }
}, {
  timestamps: true
});

// Indexes
ApplicationSchema.index({ organization: 1 });
ApplicationSchema.index({ clientId: 1 });
ApplicationSchema.index({ status: 1 });
ApplicationSchema.index({ type: 1 });

// Pre-save: hash client secret
ApplicationSchema.pre('save', async function(next) {
  if (this.isModified('clientSecret') && this.clientSecret) {
    const crypto = require('crypto');
    this.clientSecretHash = crypto
      .createHash('sha256')
      .update(this.clientSecret)
      .digest('hex');
  }
  next();
});

// Verify client secret
ApplicationSchema.methods.verifyClientSecret = function(secret) {
  const crypto = require('crypto');
  const hash = crypto
    .createHash('sha256')
    .update(secret)
    .digest('hex');
  return hash === this.clientSecretHash;
};

// Rotate client secret
ApplicationSchema.methods.rotateClientSecret = function() {
  this.clientSecret = crypto.randomBytes(32).toString('hex');
  return this.clientSecret;
};

// Validate redirect URI
ApplicationSchema.methods.isValidRedirectUri = function(uri) {
  return this.oauth.redirectUris.includes(uri);
};

// Validate origin
ApplicationSchema.methods.isValidOrigin = function(origin) {
  return this.oauth.allowedOrigins.includes(origin);
};

// Check if grant type is allowed
ApplicationSchema.methods.isGrantTypeAllowed = function(grantType) {
  return this.oauth.grantTypes.includes(grantType);
};

// Increment login count
ApplicationSchema.methods.recordLogin = async function() {
  this.stats.totalLogins += 1;
  this.stats.lastLoginAt = new Date();
  await this.save();
};

// Static: Find by client ID
ApplicationSchema.statics.findByClientId = function(clientId) {
  return this.findOne({ clientId, status: 'active' });
};

module.exports = mongoose.model('Application', ApplicationSchema);
