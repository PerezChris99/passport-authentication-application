const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  password: {
    type: String,
    required: true
  },
  
  // Profile information
  profile: {
    firstName: String,
    lastName: String,
    avatar: String,
    phone: String,
    timezone: String
  },
  
  // Legacy fields for backwards compatibility
  firstName: String,
  lastName: String,
  
  // Multi-tenancy support
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    index: true
  },
  
  // Custom metadata (like Clerk/Auth0)
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Role and permissions
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  
  // Account status
  isVerified: {
    type: Boolean,
    default: false
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  
  // Verification tokens
  verificationToken: String,
  verificationTokenExpires: Date,
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  
  // Security
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  accountLocked: {
    type: Boolean,
    default: false
  },
  accountLockedUntil: Date,
  
  // Two-factor authentication
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  twoFactorSecret: String,
  
  // OAuth connections
  oauth: {
    google: {
      id: String,
      email: String,
      accessToken: String,
      refreshToken: String
    },
    github: {
      id: String,
      username: String,
      accessToken: String
    },
    facebook: {
      id: String,
      email: String,
      accessToken: String
    }
  },
  
  // Activity tracking
  lastLogin: Date,
  lastPasswordChange: Date,
  
  // Timestamps
  date: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound indexes for multi-tenancy
UserSchema.index({ email: 1, organization: 1 }, { unique: true, sparse: true });
UserSchema.index({ username: 1, organization: 1 });

// Hash password before saving
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Reset failed login attempts
UserSchema.methods.resetLoginAttempts = function() {
  this.failedLoginAttempts = 0;
  this.accountLocked = false;
  this.accountLockedUntil = null;
  return this.save();
};

// Increment failed login attempts
UserSchema.methods.incrementLoginAttempts = function() {
  this.failedLoginAttempts += 1;
  
  // Lock account after 5 failed attempts
  if (this.failedLoginAttempts >= 5) {
    this.accountLocked = true;
    // Lock for 30 minutes
    this.accountLockedUntil = new Date(Date.now() + 30 * 60 * 1000);
  }
  
  return this.save();
};

const User = mongoose.model('User', UserSchema);

module.exports = User;
