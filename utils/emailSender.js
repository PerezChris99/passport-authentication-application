/**
 * Email Sender Utility
 * Comprehensive email sending service with templates and retry logic
 */

const nodemailer = require('nodemailer');
const logger = require('./logger');

class EmailSender {
  constructor() {
    this.transporter = null;
    this.initialized = false;
  }

  /**
   * Initialize the email transporter
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      // Production configuration
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100
      });
    } else {
      // Development: use Ethereal for testing or console logging
      if (process.env.ETHEREAL_EMAIL && process.env.ETHEREAL_PASSWORD) {
        this.transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: process.env.ETHEREAL_EMAIL,
            pass: process.env.ETHEREAL_PASSWORD
          }
        });
      } else {
        // Create test account dynamically
        try {
          const testAccount = await nodemailer.createTestAccount();
          this.transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: {
              user: testAccount.user,
              pass: testAccount.pass
            }
          });
          logger.info('Ethereal test account created', { email: testAccount.user });
        } catch (error) {
          // Fallback to console logging
          this.transporter = {
            sendMail: async (options) => {
              logger.info('Email would be sent (dev mode):', {
                to: options.to,
                subject: options.subject
              });
              return { messageId: 'dev-mode-' + Date.now() };
            }
          };
        }
      }
    }

    this.initialized = true;
  }

  /**
   * Get the base email template
   */
  getBaseTemplate(content, { preheader = '' } = {}) {
    const appName = process.env.APP_NAME || 'Passport Auth';
    const primaryColor = '#4F46E5';
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; padding: 20px 0; border-bottom: 1px solid #eee; }
    .header h1 { color: ${primaryColor}; margin: 0; }
    .content { padding: 30px 0; }
    .button { display: inline-block; padding: 12px 30px; background: ${primaryColor}; color: white !important; text-decoration: none; border-radius: 6px; font-weight: 600; }
    .button:hover { background: #4338CA; }
    .footer { text-align: center; padding: 20px 0; border-top: 1px solid #eee; color: #666; font-size: 12px; }
    .code { font-size: 32px; font-weight: bold; letter-spacing: 8px; color: ${primaryColor}; background: #F3F4F6; padding: 15px 30px; border-radius: 8px; display: inline-block; }
    .preheader { display: none; max-width: 0; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #fff; }
  </style>
</head>
<body>
  <span class="preheader">${preheader}</span>
  <div class="container">
    <div class="header">
      <h1>${appName}</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
      <p>This is an automated message. Please do not reply.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Send an email with retry logic
   */
  async send(options, retries = 3) {
    await this.initialize();

    const mailOptions = {
      from: options.from || process.env.EMAIL_FROM || `"${process.env.APP_NAME || 'Passport Auth'}" <noreply@example.com>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const info = await this.transporter.sendMail(mailOptions);
        
        logger.info('Email sent successfully', {
          to: options.to,
          subject: options.subject,
          messageId: info.messageId
        });

        // Log preview URL for Ethereal emails
        if (process.env.NODE_ENV !== 'production' && info.messageId) {
          const previewUrl = nodemailer.getTestMessageUrl(info);
          if (previewUrl) {
            logger.info('Preview URL:', { url: previewUrl });
          }
        }

        return info;
      } catch (error) {
        logger.error(`Email send attempt ${attempt} failed`, {
          to: options.to,
          error: error.message
        });

        if (attempt === retries) {
          throw error;
        }

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  /**
   * Send verification email
   */
  async sendVerificationEmail(user, verificationUrl) {
    const content = `
      <h2>Welcome, ${this.escapeHtml(user.username || user.firstName || 'there')}!</h2>
      <p>Thank you for registering. Please verify your email address to activate your account.</p>
      <p style="text-align: center; margin: 30px 0;">
        <a href="${verificationUrl}" class="button">Verify Email Address</a>
      </p>
      <p style="color: #666; font-size: 14px;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${verificationUrl}" style="color: #4F46E5;">${verificationUrl}</a>
      </p>
      <p style="color: #666; font-size: 14px;">This link will expire in 24 hours.</p>
      <p>If you didn't create an account, you can safely ignore this email.</p>
    `;

    return this.send({
      to: user.email,
      subject: 'Verify Your Email Address',
      html: this.getBaseTemplate(content, { preheader: 'Please verify your email to complete registration' })
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(user, resetUrl) {
    const content = `
      <h2>Password Reset Request</h2>
      <p>Hi ${this.escapeHtml(user.username || user.firstName || 'there')},</p>
      <p>We received a request to reset your password. Click the button below to create a new password:</p>
      <p style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}" class="button">Reset Password</a>
      </p>
      <p style="color: #666; font-size: 14px;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${resetUrl}" style="color: #4F46E5;">${resetUrl}</a>
      </p>
      <p style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>
      <p style="color: #c00; font-weight: bold;">If you didn't request this, please secure your account immediately.</p>
    `;

    return this.send({
      to: user.email,
      subject: 'Password Reset Request',
      html: this.getBaseTemplate(content, { preheader: 'Reset your password' })
    });
  }

  /**
   * Send 2FA code email
   */
  async send2FACode(user, code) {
    const content = `
      <h2>Two-Factor Authentication Code</h2>
      <p>Hi ${this.escapeHtml(user.username || user.firstName || 'there')},</p>
      <p>Your verification code is:</p>
      <p style="text-align: center; margin: 30px 0;">
        <span class="code">${code}</span>
      </p>
      <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes.</p>
      <p style="color: #c00;">If you didn't request this code, someone may be trying to access your account.</p>
    `;

    return this.send({
      to: user.email,
      subject: `${code} is your verification code`,
      html: this.getBaseTemplate(content, { preheader: `Your code is ${code}` })
    });
  }

  /**
   * Send account locked notification
   */
  async sendAccountLockedEmail(user) {
    const content = `
      <h2>Account Security Alert</h2>
      <p>Hi ${this.escapeHtml(user.username || user.firstName || 'there')},</p>
      <p>Your account has been temporarily locked due to multiple failed login attempts.</p>
      <p>If this was you, please wait 30 minutes before trying again, or use the password reset option.</p>
      <p style="color: #c00;">If this wasn't you, we recommend changing your password immediately after regaining access.</p>
    `;

    return this.send({
      to: user.email,
      subject: 'Account Temporarily Locked',
      html: this.getBaseTemplate(content, { preheader: 'Your account has been temporarily locked' })
    });
  }

  /**
   * Send password changed notification
   */
  async sendPasswordChangedEmail(user) {
    const content = `
      <h2>Password Changed Successfully</h2>
      <p>Hi ${this.escapeHtml(user.username || user.firstName || 'there')},</p>
      <p>Your password was recently changed.</p>
      <p><strong>When:</strong> ${new Date().toLocaleString()}</p>
      <p>If you made this change, you can safely ignore this email.</p>
      <p style="color: #c00;">If you didn't change your password, please contact support immediately.</p>
    `;

    return this.send({
      to: user.email,
      subject: 'Password Changed',
      html: this.getBaseTemplate(content, { preheader: 'Your password has been changed' })
    });
  }

  /**
   * Send welcome email after verification
   */
  async sendWelcomeEmail(user) {
    const content = `
      <h2>Welcome to ${process.env.APP_NAME || 'Passport Auth'}!</h2>
      <p>Hi ${this.escapeHtml(user.username || user.firstName || 'there')},</p>
      <p>Your email has been verified and your account is now active.</p>
      <h3>Get Started:</h3>
      <ul>
        <li>Complete your profile</li>
        <li>Enable two-factor authentication for extra security</li>
        <li>Explore the dashboard</li>
      </ul>
      <p style="text-align: center; margin: 30px 0;">
        <a href="${process.env.BASE_URL || 'http://localhost:3000'}/dashboard" class="button">Go to Dashboard</a>
      </p>
    `;

    return this.send({
      to: user.email,
      subject: `Welcome to ${process.env.APP_NAME || 'Passport Auth'}!`,
      html: this.getBaseTemplate(content, { preheader: 'Your account is now active' })
    });
  }

  /**
   * HTML escape utility
   */
  escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

// Export singleton instance
module.exports = new EmailSender();
