const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Define log formats
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
);

// Create Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    // File output - general logs
    new winston.transports.File({ 
      filename: path.join(logDir, 'app.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // File output - error logs
    new winston.transports.File({ 
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // File output - auth logs
    new winston.transports.File({ 
      filename: path.join(logDir, 'auth.log'),
      level: 'info',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// User activity logger
exports.logUserActivity = (userId, activity, details = {}) => {
  logger.info({
    userId,
    activity,
    details,
    timestamp: new Date()
  });
};

// Auth logger
exports.logAuthActivity = (type, userId = null, status, details = {}) => {
  logger.info({
    type, // login, logout, register, password reset, etc.
    userId,
    status, // success, failure
    details,
    ip: details.ip,
    timestamp: new Date()
  });
};

// Error logger
exports.logError = (error, userId = null, details = {}) => {
  logger.error({
    error: error.message,
    stack: error.stack,
    userId,
    details,
    timestamp: new Date()
  });
};

module.exports = {
  logger,
  logUserActivity: exports.logUserActivity,
  logAuthActivity: exports.logAuthActivity,
  logError: exports.logError
};
