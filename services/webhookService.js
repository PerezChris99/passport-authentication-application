/**
 * Webhook Service
 * Sends webhook events to subscribed endpoints
 */

const crypto = require('crypto');
const axios = require('axios');
const Webhook = require('../models/Webhook');
const AuditLog = require('../models/AuditLog');

class WebhookService {
  /**
   * Trigger webhooks for an event
   * @param {string} event - Event type (e.g., 'user.created')
   * @param {ObjectId} organizationId - Organization ID
   * @param {Object} payload - Event payload data
   */
  static async trigger(event, organizationId, payload) {
    try {
      // Find all webhooks subscribed to this event
      const webhooks = await Webhook.find({
        organization: organizationId,
        status: 'active',
        events: { $in: [event, '*'] }
      });
      
      if (webhooks.length === 0) {
        return { sent: 0, webhooks: [] };
      }
      
      // Send to all webhooks in parallel
      const results = await Promise.allSettled(
        webhooks.map(webhook => this.sendToWebhook(webhook, event, payload))
      );
      
      const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.filter(r => r.status === 'rejected' || !r.value?.success).length;
      
      return {
        sent: webhooks.length,
        succeeded,
        failed,
        webhooks: results.map((r, i) => ({
          webhookId: webhooks[i]._id,
          success: r.status === 'fulfilled' && r.value?.success,
          error: r.status === 'rejected' ? r.reason?.message : r.value?.error
        }))
      };
    } catch (error) {
      console.error('Webhook trigger error:', error);
      return { sent: 0, error: error.message };
    }
  }
  
  /**
   * Send webhook to single endpoint
   */
  static async sendToWebhook(webhook, event, payload) {
    const deliveryId = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    
    // Build webhook payload
    const webhookPayload = {
      id: deliveryId,
      type: event,
      created: timestamp,
      data: payload,
      organization: webhook.organization.toString()
    };
    
    // Generate signature
    const signature = this.generateSignature(webhook.secret, webhookPayload, timestamp);
    
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'AuthService-Webhook/1.0',
      'X-Webhook-Id': webhook._id.toString(),
      'X-Webhook-Delivery': deliveryId,
      'X-Webhook-Event': event,
      'X-Webhook-Timestamp': timestamp.toString(),
      'X-Webhook-Signature': signature,
      'X-Webhook-Signature-256': `sha256=${signature}`
    };
    
    // Add custom headers
    if (webhook.config.headers) {
      Object.assign(headers, webhook.config.headers);
    }
    
    // Track delivery
    const delivery = {
      deliveryId,
      event,
      payload: webhookPayload,
      timestamp: new Date(timestamp),
      response: {},
      retryCount: 0
    };
    
    try {
      const response = await axios.post(webhook.url, webhookPayload, {
        headers,
        timeout: webhook.config.timeout || 30000,
        maxRedirects: 5,
        validateStatus: () => true // Don't throw on non-2xx
      });
      
      delivery.response = {
        statusCode: response.status,
        headers: response.headers,
        body: typeof response.data === 'string' ? 
          response.data.substring(0, 1000) : 
          JSON.stringify(response.data).substring(0, 1000)
      };
      delivery.success = response.status >= 200 && response.status < 300;
      
      // Update webhook delivery history
      webhook.deliveryHistory.push(delivery);
      if (webhook.deliveryHistory.length > 100) {
        webhook.deliveryHistory = webhook.deliveryHistory.slice(-100);
      }
      
      if (delivery.success) {
        webhook.stats.successCount++;
        webhook.stats.lastSuccessAt = new Date();
        webhook.stats.consecutiveFailures = 0;
      } else {
        webhook.stats.failureCount++;
        webhook.stats.lastFailureAt = new Date();
        webhook.stats.consecutiveFailures++;
        
        // Check if should disable
        if (webhook.shouldDisable()) {
          webhook.status = 'failing';
          console.warn(`Webhook ${webhook._id} marked as failing due to consecutive failures`);
        }
      }
      
      await webhook.save();
      
      return {
        success: delivery.success,
        deliveryId,
        statusCode: response.status
      };
    } catch (error) {
      delivery.response = {
        error: error.message,
        code: error.code
      };
      delivery.success = false;
      
      webhook.deliveryHistory.push(delivery);
      webhook.stats.failureCount++;
      webhook.stats.lastFailureAt = new Date();
      webhook.stats.consecutiveFailures++;
      
      if (webhook.shouldDisable()) {
        webhook.status = 'failing';
      }
      
      await webhook.save();
      
      // Queue for retry if enabled
      if (webhook.config.retry?.enabled && webhook.stats.consecutiveFailures < webhook.config.retry.maxAttempts) {
        await this.scheduleRetry(webhook, event, payload, webhook.stats.consecutiveFailures);
      }
      
      return {
        success: false,
        deliveryId,
        error: error.message
      };
    }
  }
  
  /**
   * Generate HMAC signature
   */
  static generateSignature(secret, payload, timestamp) {
    const signatureData = `${timestamp}.${JSON.stringify(payload)}`;
    return crypto
      .createHmac('sha256', secret)
      .update(signatureData)
      .digest('hex');
  }
  
  /**
   * Verify incoming webhook signature (for webhook consumers)
   */
  static verifySignature(secret, payload, timestamp, signature) {
    const expectedSignature = this.generateSignature(secret, payload, timestamp);
    
    // Timing-safe comparison
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    
    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  }
  
  /**
   * Schedule retry for failed webhook
   */
  static async scheduleRetry(webhook, event, payload, attemptNumber) {
    // Calculate exponential backoff delay
    const delays = [60, 300, 900, 3600, 7200]; // 1m, 5m, 15m, 1h, 2h
    const delay = delays[Math.min(attemptNumber, delays.length - 1)] * 1000;
    
    // In production, you'd use a job queue (Bull, Bee-Queue, etc.)
    // For now, simple setTimeout (not production-ready)
    setTimeout(async () => {
      try {
        const freshWebhook = await Webhook.findById(webhook._id);
        if (freshWebhook && freshWebhook.status !== 'disabled') {
          await this.sendToWebhook(freshWebhook, event, payload);
        }
      } catch (error) {
        console.error('Webhook retry error:', error);
      }
    }, delay);
    
    console.log(`Scheduled webhook retry for ${webhook._id} in ${delay/1000}s`);
  }
  
  /**
   * Send test event to webhook
   */
  static async sendTestEvent(webhook) {
    const testPayload = {
      test: true,
      message: 'This is a test webhook event',
      timestamp: new Date().toISOString()
    };
    
    return this.sendToWebhook(webhook, 'test', testPayload);
  }
  
  /**
   * Common event triggers
   */
  static async userCreated(organizationId, user) {
    return this.trigger('user.created', organizationId, {
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt
      }
    });
  }
  
  static async userUpdated(organizationId, user, changes) {
    return this.trigger('user.updated', organizationId, {
      user: {
        id: user._id,
        email: user.email,
        username: user.username
      },
      changes
    });
  }
  
  static async userDeleted(organizationId, userId, email) {
    return this.trigger('user.deleted', organizationId, {
      user: { id: userId, email }
    });
  }
  
  static async loginSucceeded(organizationId, user, context) {
    return this.trigger('login.succeeded', organizationId, {
      user: {
        id: user._id,
        email: user.email
      },
      context: {
        ipAddress: context.ip,
        userAgent: context.userAgent,
        timestamp: new Date().toISOString()
      }
    });
  }
  
  static async loginFailed(organizationId, email, context, reason) {
    return this.trigger('login.failed', organizationId, {
      email,
      reason,
      context: {
        ipAddress: context.ip,
        userAgent: context.userAgent,
        timestamp: new Date().toISOString()
      }
    });
  }
  
  static async passwordChanged(organizationId, user) {
    return this.trigger('password.changed', organizationId, {
      user: {
        id: user._id,
        email: user.email
      },
      timestamp: new Date().toISOString()
    });
  }
  
  static async mfaEnabled(organizationId, user, method) {
    return this.trigger('mfa.enabled', organizationId, {
      user: {
        id: user._id,
        email: user.email
      },
      method,
      timestamp: new Date().toISOString()
    });
  }
  
  static async tokenCreated(organizationId, userId, tokenType) {
    return this.trigger('token.created', organizationId, {
      userId,
      tokenType,
      timestamp: new Date().toISOString()
    });
  }
  
  static async tokenRevoked(organizationId, userId, reason) {
    return this.trigger('token.revoked', organizationId, {
      userId,
      reason,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = WebhookService;
