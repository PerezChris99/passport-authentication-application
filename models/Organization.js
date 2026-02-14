/**
 * Organization Model
 * Multi-tenant support for Auth-as-a-Service
 * Each organization can have multiple applications and users
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const OrganizationSchema = new mongoose.Schema({
  // Basic Info
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9-]+$/
  },
  description: {
    type: String,
    maxlength: 500
  },
  
  // Owner & Members
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'developer', 'viewer'],
      default: 'developer'
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Branding & Customization
  branding: {
    logo: String,
    favicon: String,
    primaryColor: {
      type: String,
      default: '#4F46E5'
    },
    accentColor: {
      type: String,
      default: '#06B6D4'
    },
    customDomain: String,
    companyName: String,
    supportEmail: String,
    privacyPolicyUrl: String,
    termsOfServiceUrl: String
  },
  
  // Settings
  settings: {
    // Authentication Methods
    allowedAuthMethods: {
      emailPassword: { type: Boolean, default: true },
      magicLink: { type: Boolean, default: false },
      google: { type: Boolean, default: false },
      facebook: { type: Boolean, default: false },
      github: { type: Boolean, default: false },
      saml: { type: Boolean, default: false }
    },
    
    // Security Settings
    security: {
      requireEmailVerification: { type: Boolean, default: true },
      require2FA: { type: Boolean, default: false },
      passwordMinLength: { type: Number, default: 8 },
      passwordRequireUppercase: { type: Boolean, default: true },
      passwordRequireNumbers: { type: Boolean, default: true },
      passwordRequireSymbols: { type: Boolean, default: false },
      maxLoginAttempts: { type: Number, default: 5 },
      lockoutDuration: { type: Number, default: 30 }, // minutes
      sessionDuration: { type: Number, default: 14 }, // days
      allowMultipleSessions: { type: Boolean, default: true },
      maxConcurrentSessions: { type: Number, default: 10 }
    },
    
    // Rate Limiting
    rateLimits: {
      loginAttemptsPerMinute: { type: Number, default: 10 },
      apiCallsPerMinute: { type: Number, default: 100 },
      registrationsPerHour: { type: Number, default: 50 }
    },
    
    // IP Rules
    ipWhitelist: [String],
    ipBlacklist: [String],
    
    // User Registration
    allowPublicRegistration: { type: Boolean, default: true },
    requireInvitation: { type: Boolean, default: false },
    allowedEmailDomains: [String], // Empty = all allowed
    blockedEmailDomains: [String]
  },
  
  // Plan & Billing
  plan: {
    type: String,
    enum: ['free', 'starter', 'pro', 'enterprise'],
    default: 'free'
  },
  billing: {
    customerId: String, // Stripe customer ID
    subscriptionId: String,
    currentPeriodEnd: Date
  },
  
  // Usage & Limits
  limits: {
    maxApplications: { type: Number, default: 3 },
    maxMonthlyActiveUsers: { type: Number, default: 1000 },
    maxApiCallsPerMonth: { type: Number, default: 10000 },
    maxTeamMembers: { type: Number, default: 5 }
  },
  usage: {
    currentMonthActiveUsers: { type: Number, default: 0 },
    currentMonthApiCalls: { type: Number, default: 0 },
    lastResetDate: { type: Date, default: Date.now }
  },
  
  // OAuth Provider Settings (when acting as OAuth provider)
  oauthProvider: {
    enabled: { type: Boolean, default: false },
    issuer: String,
    authorizationEndpoint: String,
    tokenEndpoint: String,
    userinfoEndpoint: String,
    jwksUri: String
  },
  
  // Webhook Settings
  webhooks: {
    signingSecret: {
      type: String,
      default: () => crypto.randomBytes(32).toString('hex')
    }
  },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'suspended', 'deleted'],
    default: 'active'
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
OrganizationSchema.index({ slug: 1 });
OrganizationSchema.index({ owner: 1 });
OrganizationSchema.index({ 'members.user': 1 });
OrganizationSchema.index({ status: 1 });
OrganizationSchema.index({ plan: 1 });

// Generate unique slug
OrganizationSchema.statics.generateSlug = async function(name) {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  
  let uniqueSlug = slug;
  let counter = 1;
  
  while (await this.findOne({ slug: uniqueSlug })) {
    uniqueSlug = `${slug}-${counter}`;
    counter++;
  }
  
  return uniqueSlug;
};

// Check if user is member
OrganizationSchema.methods.isMember = function(userId) {
  if (this.owner.toString() === userId.toString()) return true;
  return this.members.some(m => m.user.toString() === userId.toString());
};

// Get user role in organization
OrganizationSchema.methods.getUserRole = function(userId) {
  if (this.owner.toString() === userId.toString()) return 'owner';
  const member = this.members.find(m => m.user.toString() === userId.toString());
  return member ? member.role : null;
};

// Check permission
OrganizationSchema.methods.hasPermission = function(userId, requiredRole) {
  const roleHierarchy = ['viewer', 'developer', 'admin', 'owner'];
  const userRole = this.getUserRole(userId);
  if (!userRole) return false;
  return roleHierarchy.indexOf(userRole) >= roleHierarchy.indexOf(requiredRole);
};

// Increment API usage
OrganizationSchema.methods.incrementApiUsage = async function() {
  const now = new Date();
  const resetDate = new Date(this.usage.lastResetDate);
  
  // Reset if new month
  if (now.getMonth() !== resetDate.getMonth() || now.getFullYear() !== resetDate.getFullYear()) {
    this.usage.currentMonthActiveUsers = 0;
    this.usage.currentMonthApiCalls = 0;
    this.usage.lastResetDate = now;
  }
  
  this.usage.currentMonthApiCalls += 1;
  await this.save();
};

// Check if within limits
OrganizationSchema.methods.isWithinLimits = function(type) {
  switch (type) {
    case 'apiCalls':
      return this.usage.currentMonthApiCalls < this.limits.maxApiCallsPerMonth;
    case 'activeUsers':
      return this.usage.currentMonthActiveUsers < this.limits.maxMonthlyActiveUsers;
    default:
      return true;
  }
};

module.exports = mongoose.model('Organization', OrganizationSchema);
