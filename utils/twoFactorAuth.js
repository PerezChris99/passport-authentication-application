/**
 * Two-Factor Authentication Utilities
 * Provides TOTP and email-based 2FA functionality
 */

const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');

/**
 * Generate a new TOTP secret for a user
 * @param {string} email - User's email address
 * @param {string} appName - Application name for authenticator display
 * @returns {Object} Secret object with base32, otpauth_url, etc.
 */
exports.generateSecret = (email, appName = 'PassportAuth') => {
  const secret = speakeasy.generateSecret({
    name: `${appName}:${email}`,
    issuer: appName,
    length: 32
  });
  
  return {
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url
  };
};

/**
 * Generate QR code data URL for authenticator apps
 * @param {string} otpauthUrl - OTPAuth URL from generateSecret
 * @returns {Promise<string>} Data URL for QR code image
 */
exports.generateQRCode = async (otpauthUrl) => {
  try {
    const dataUrl = await QRCode.toDataURL(otpauthUrl, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    return dataUrl;
  } catch (error) {
    throw new Error('Failed to generate QR code');
  }
};

/**
 * Verify a TOTP token against a secret
 * @param {string} token - 6-digit token from authenticator
 * @param {string} secret - Base32 encoded secret
 * @param {number} window - Number of time windows to check (default: 2)
 * @returns {boolean} Whether the token is valid
 */
exports.verifyToken = (token, secret, window = 2) => {
  if (!token || !secret) {
    return false;
  }
  
  // Clean the token - remove spaces and non-digits
  const cleanToken = token.toString().replace(/\s/g, '').replace(/\D/g, '');
  
  if (cleanToken.length !== 6) {
    return false;
  }
  
  try {
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: cleanToken,
      window: window
    });
    
    return verified;
  } catch (error) {
    return false;
  }
};

/**
 * Generate a time-limited email verification code
 * @param {number} length - Length of the code (default: 6)
 * @returns {Object} Code and expiration timestamp
 */
exports.generateEmailCode = (length = 6) => {
  const code = crypto.randomInt(Math.pow(10, length - 1), Math.pow(10, length)).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  
  return {
    code,
    expiresAt
  };
};

/**
 * Verify an email-based 2FA code
 * @param {string} inputCode - Code entered by user
 * @param {string} storedCode - Code stored in session/database
 * @param {Date} expiresAt - Expiration timestamp
 * @returns {boolean} Whether the code is valid and not expired
 */
exports.verifyEmailCode = (inputCode, storedCode, expiresAt) => {
  if (!inputCode || !storedCode || !expiresAt) {
    return false;
  }
  
  const now = new Date();
  const expiry = new Date(expiresAt);
  
  if (now > expiry) {
    return false;
  }
  
  return inputCode.toString().trim() === storedCode.toString().trim();
};

/**
 * Generate backup codes for account recovery
 * @param {number} count - Number of backup codes to generate (default: 10)
 * @returns {Array<string>} Array of backup codes
 */
exports.generateBackupCodes = (count = 10) => {
  const codes = [];
  
  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric codes
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    // Format as XXXX-XXXX
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  
  return codes;
};

/**
 * Hash backup codes for secure storage
 * @param {Array<string>} codes - Array of plain text backup codes
 * @returns {Array<string>} Array of hashed codes
 */
exports.hashBackupCodes = (codes) => {
  return codes.map(code => {
    return crypto
      .createHash('sha256')
      .update(code.replace('-', '').toUpperCase())
      .digest('hex');
  });
};

/**
 * Verify a backup code against hashed codes
 * @param {string} inputCode - Code entered by user
 * @param {Array<string>} hashedCodes - Array of hashed backup codes
 * @returns {number} Index of matching code (-1 if not found)
 */
exports.verifyBackupCode = (inputCode, hashedCodes) => {
  if (!inputCode || !hashedCodes || !Array.isArray(hashedCodes)) {
    return -1;
  }
  
  const normalizedInput = inputCode.replace('-', '').replace(/\s/g, '').toUpperCase();
  const inputHash = crypto
    .createHash('sha256')
    .update(normalizedInput)
    .digest('hex');
  
  return hashedCodes.findIndex(hash => hash === inputHash);
};

/**
 * Get current TOTP token (for testing purposes)
 * @param {string} secret - Base32 encoded secret
 * @returns {string} Current 6-digit TOTP token
 */
exports.getCurrentToken = (secret) => {
  return speakeasy.totp({
    secret: secret,
    encoding: 'base32'
  });
};

/**
 * Calculate time remaining until next TOTP token
 * @returns {number} Seconds remaining (0-30)
 */
exports.getTimeRemaining = () => {
  const epoch = Math.floor(Date.now() / 1000);
  return 30 - (epoch % 30);
};

module.exports = exports;
