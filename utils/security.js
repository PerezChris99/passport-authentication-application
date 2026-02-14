const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

// Generate random token
exports.generateToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Generate JWT
exports.generateJWT = (userId) => {
  const payload = { id: userId };
  const token = jwt.sign(
    payload, 
    process.env.JWT_SECRET || 'your_jwt_secret', 
    { expiresIn: '1h' }
  );
  return token;
};

// Verify JWT
exports.verifyJWT = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    return { valid: true, expired: false, decoded };
  } catch (error) {
    return {
      valid: false,
      expired: error.name === 'TokenExpiredError',
      decoded: null
    };
  }
};

// Setup 2FA
exports.setup2FA = async (user) => {
  // Generate a secret
  const secret = speakeasy.generateSecret({
    name: `MyApp:${user.email}`
  });
  
  // Generate QR code data URL
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
  
  return {
    secret: secret.base32,
    qrCodeUrl
  };
};

// Verify 2FA token
exports.verify2FAToken = (token, secret) => {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 1  // Allow 1 step before/after for time sync issues
  });
};

// Generate random 6-digit code for email 2FA
exports.generate2FACode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};
