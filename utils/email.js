const nodemailer = require('nodemailer');

// Create transporter
let transporter;

if (process.env.NODE_ENV === 'production') {
  // Production config (e.g., with SendGrid, Mailgun, etc.)
  transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE,
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD
    }
  });
} else {
  // Development config using Ethereal
  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: process.env.ETHEREAL_EMAIL || 'ethereal.user@ethereal.email',
      pass: process.env.ETHEREAL_PASSWORD || 'ethereal.password'
    }
  });
}

// Send verification email
exports.sendVerificationEmail = async (user, verificationUrl) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@yourapp.com',
    to: user.email,
    subject: 'Email Verification',
    html: `
      <h1>Email Verification</h1>
      <p>Hi ${user.username || user.firstName || 'there'},</p>
      <p>Please verify your email address by clicking on the link below:</p>
      <a href="${verificationUrl}">Verify Email</a>
      <p>If you did not create an account, please ignore this email.</p>
    `
  };

  await transporter.sendMail(mailOptions);
};

// Send password reset email
exports.sendPasswordResetEmail = async (user, resetUrl) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@yourapp.com',
    to: user.email,
    subject: 'Password Reset Request',
    html: `
      <h1>Password Reset</h1>
      <p>Hi ${user.username || user.firstName || 'there'},</p>
      <p>You requested a password reset. Click on the link below to reset your password:</p>
      <a href="${resetUrl}">Reset Password</a>
      <p>If you didn't request this, please ignore this email.</p>
      <p>This link will expire in 1 hour.</p>
    `
  };

  await transporter.sendMail(mailOptions);
};

// Send 2FA code
exports.send2FACode = async (user, code) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@yourapp.com',
    to: user.email,
    subject: 'Your 2FA Code',
    html: `
      <h1>Two-Factor Authentication Code</h1>
      <p>Hi ${user.username || user.firstName || 'there'},</p>
      <p>Your verification code is: <strong>${code}</strong></p>
      <p>This code will expire in 10 minutes.</p>
    `
  };

  await transporter.sendMail(mailOptions);
};
