const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const bodyParser = require('body-parser');
const path = require('path');
const mongoose = require('mongoose');
const flash = require('connect-flash');
const dotenv = require('dotenv');
const helmet = require('helmet');
const csrf = require('csurf');
const cookieParser = require('cookie-parser');
const { logger } = require('./utils/logger');

// Load environment variables
dotenv.config();

const app = express();

// Trust proxy for production (behind load balancer/reverse proxy)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security headers with sensible defaults
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Database Config
const db = require('./config/database').MongoURI;

// Connect to MongoDB with proper options
mongoose.connect(db)
  .then(() => logger.info('MongoDB Connected'))
  .catch(err => {
    logger.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Handle MongoDB connection events
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB error:', err);
});

// Middleware setup
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser(process.env.COOKIE_SECRET || process.env.SESSION_SECRET));

// Session setup with MongoDB store
app.use(session({ 
  secret: process.env.SESSION_SECRET || 'keyboard cat', 
  resave: false, 
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: db,
    collection: 'sessions',
    ttl: 14 * 24 * 60 * 60, // 14 days
    autoRemove: 'native'
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 14 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  },
  name: 'sessionId' // Don't use default 'connect.sid'
}));

// CSRF protection
const csrfProtection = csrf({ cookie: true });
app.use(csrfProtection);

// Flash messages
app.use(flash());

// Passport config & init
require('./config/passport')(passport);
app.use(passport.initialize());
app.use(passport.session());

// Global variables
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.user = req.user || null;
  res.locals.csrfToken = req.csrfToken();
  next();
});

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Import rate limiters
const { apiLimiter, authLimiter } = require('./middleware/rateLimiter');

// Apply rate limiters
app.use('/api/', apiLimiter);
app.use('/auth/', authLimiter);

// Routes
app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/users', require('./routes/users'));
app.use('/api', require('./routes/api/index'));
app.use('/admin', require('./routes/admin'));

// Auth-as-a-Service Routes
app.use('/developer', require('./routes/developer'));
app.use('/oauth', require('./routes/oauth'));
app.use('/auth/magic', require('./routes/magic'));
app.use('/webauthn', require('./routes/webauthn'));

// CSRF error handler
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    logger.warn('CSRF token validation failed', { 
      ip: req.ip, 
      path: req.path 
    });
    if (req.xhr || req.path.startsWith('/api')) {
      return res.status(403).json({ message: 'Invalid or expired form token. Please refresh and try again.' });
    }
    req.flash('error_msg', 'Form expired. Please try again.');
    return res.redirect('back');
  }
  next(err);
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    status: 404,
    message: 'Page not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', { 
    error: err.message, 
    stack: err.stack,
    path: req.path,
    method: req.method
  });
  
  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Something went wrong' 
    : err.message;
  
  if (req.xhr || req.path.startsWith('/api')) {
    return res.status(status).json({ message });
  }
  
  res.status(status).render('error', { status, message });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  mongoose.connection.close(false, () => {
    logger.info('MongoDB connection closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server started on http://localhost:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});
