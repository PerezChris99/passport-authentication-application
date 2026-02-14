/**
 * Webhook Model
 * Manages webhook endpoints for event notifications
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const WebhookDeliverySchema = new mongoose.Schema({
  event: String,
  payload: mongoose.Schema.Types.Mixed,
  response: {
    statusCode: Number,
    body: String,
    headers: mongoose.Schema.Types.Mixed
  },
  duration: Number, // ms
  success: Boolean,
  error: String,
  attemptNumber: Number,
  deliveredAt: Date
});

const WebhookSchema = new mongoose.Schema({
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
  
  // Webhook details
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: String,
  
  // Endpoint
  url: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        try {
          const url = new URL(v);
          return url.protocol === 'https:' || process.env.NODE_ENV !== 'production';
        } catch {
          return false;
        }
      },
      message: 'Webhook URL must be a valid HTTPS URL'
    }
  },
  
  // Authentication
  secret: {
    type: String,
    required: true,
    default: () => `whsec_${crypto.randomBytes(24).toString('hex')}`
  },
  
  // Custom headers to send with webhook
  headers: {
    type: Map,
    of: String
  },
  
  // Events to listen for
  events: [{
    type: String,
    enum: [
      // User events
      'user.created',
      'user.updated',
      'user.deleted',
      'user.verified',
      
      // Authentication events
      'user.login',
      'user.login.failed',
      'user.logout',
      'user.password.changed',
      'user.password.reset.requested',
      'user.password.reset.completed',
      
      // MFA events
      'user.mfa.enabled',
      'user.mfa.disabled',
      'user.mfa.challenged',
      
      // Session events
      'session.created',
      'session.revoked',
      
      // Security events
      'user.blocked',
      'user.unblocked',
      'user.suspicious_activity',
      
      // Organization events
      'organization.created',
      'organization.updated',
      'organization.member.added',
      'organization.member.removed',
      
      // Application events
      'application.created',
      'application.updated',
      'application.deleted',
      
      // Catch-all
      '*'
    ]
  }],
  
  // Status
  status: {
    type: String,
    enum: ['active', 'paused', 'disabled'],
    default: 'active'
  },
  
  // Retry configuration
  retryConfig: {
    maxRetries: { type: Number, default: 3 },
    retryDelay: { type: Number, default: 60 }, // seconds
    exponentialBackoff: { type: Boolean, default: true }
  },
  
  // Timeout
  timeout: {
    type: Number,
    default: 30000 // 30 seconds
  },
  
  // Statistics
  stats: {
    totalDeliveries: { type: Number, default: 0 },
    successfulDeliveries: { type: Number, default: 0 },
    failedDeliveries: { type: Number, default: 0 },
    lastDeliveryAt: Date,
    lastSuccessAt: Date,
    lastFailureAt: Date,
    consecutiveFailures: { type: Number, default: 0 }
  },
  
  // Recent deliveries (keep last 100)
  recentDeliveries: [WebhookDeliverySchema],
  
  // Auto-disable on consecutive failures
  autoDisableOnFailure: {
    enabled: { type: Boolean, default: true },
    threshold: { type: Number, default: 10 }
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
WebhookSchema.index({ organization: 1 });
WebhookSchema.index({ application: 1 });
WebhookSchema.index({ status: 1 });
WebhookSchema.index({ events: 1 });

// Check if webhook should receive event
WebhookSchema.methods.shouldReceiveEvent = function(eventType) {
  if (this.status !== 'active') return false;
  if (this.events.includes('*')) return true;
  return this.events.includes(eventType);
};

// Generate signature for payload
WebhookSchema.methods.generateSignature = function(payload, timestamp) {
  const message = `${timestamp}.${JSON.stringify(payload)}`;
  return crypto
    .createHmac('sha256', this.secret)
    .update(message)
    .digest('hex');
};

// Record delivery attempt
WebhookSchema.methods.recordDelivery = async function(delivery) {
  this.stats.totalDeliveries += 1;
  this.stats.lastDeliveryAt = new Date();
  
  if (delivery.success) {
    this.stats.successfulDeliveries += 1;
    this.stats.lastSuccessAt = new Date();
    this.stats.consecutiveFailures = 0;
  } else {
    this.stats.failedDeliveries += 1;
    this.stats.lastFailureAt = new Date();
    this.stats.consecutiveFailures += 1;
    
    // Auto-disable on too many failures
    if (this.autoDisableOnFailure.enabled && 
        this.stats.consecutiveFailures >= this.autoDisableOnFailure.threshold) {
      this.status = 'disabled';
    }
  }
  
  // Keep only last 100 deliveries
  this.recentDeliveries.unshift(delivery);
  if (this.recentDeliveries.length > 100) {
    this.recentDeliveries = this.recentDeliveries.slice(0, 100);
  }
  
  await this.save();
};

// Static: Find webhooks for event
WebhookSchema.statics.findForEvent = async function(organizationId, eventType, applicationId = null) {
  const query = {
    organization: organizationId,
    status: 'active',
    $or: [
      { events: eventType },
      { events: '*' }
    ]
  };
  
  if (applicationId) {
    query.$or.push(
      { application: applicationId },
      { application: null }
    );
  }
  
  return this.find(query);
};

// Static: Verify webhook signature
WebhookSchema.statics.verifySignature = function(payload, signature, secret, timestamp) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${JSON.stringify(payload)}`)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

module.exports = mongoose.model('Webhook', WebhookSchema);
