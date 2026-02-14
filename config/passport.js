const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const User = require('../models/User');

module.exports = function(passport) {
  // Local Strategy
  passport.use(new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      try {
        // Find user by email
        const user = await User.findOne({ email });
        if (!user) {
          return done(null, false, { message: 'That email is not registered' });
        }

        // Check if account is locked
        if (user.accountLocked && user.accountLockedUntil > Date.now()) {
          return done(null, false, { message: 'Account locked due to multiple failed login attempts. Try again later.' });
        }

        // Match password
        const isMatch = await user.comparePassword(password);
        if (isMatch) {
          // Reset login attempts on successful login
          await user.resetLoginAttempts();
          return done(null, user);
        } else {
          // Increment failed login attempts
          await user.incrementLoginAttempts();
          return done(null, false, { message: 'Password incorrect' });
        }
      } catch (err) {
        return done(err);
      }
    }
  ));

  // Google OAuth Strategy
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/auth/google/callback',
      proxy: true
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user exists
        let user = await User.findOne({ email: profile.emails[0].value });
        
        if (user) {
          return done(null, user);
        }
        
        // Create new user
        user = new User({
          username: profile.displayName,
          email: profile.emails[0].value,
          password: 'google-oauth-' + Math.random().toString(36).substring(2),
          isVerified: true
        });
        
        await user.save();
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }));
  }

  // Facebook OAuth Strategy
  if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    passport.use(new FacebookStrategy({
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL: '/auth/facebook/callback',
      profileFields: ['id', 'emails', 'name'],
      proxy: true
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user exists
        let user = await User.findOne({ email: profile.emails[0].value });
        
        if (user) {
          return done(null, user);
        }
        
        // Create new user
        user = new User({
          username: `${profile.name.givenName}${profile.name.familyName}`,
          firstName: profile.name.givenName,
          lastName: profile.name.familyName,
          email: profile.emails[0].value,
          password: 'facebook-oauth-' + Math.random().toString(36).substring(2),
          isVerified: true
        });
        
        await user.save();
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }));
  }

  // GitHub OAuth Strategy
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport.use(new GitHubStrategy({
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: '/auth/github/callback',
      proxy: true
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        // GitHub may not provide email, use username as fallback
        const email = profile.emails ? profile.emails[0].value : `${profile.username}@github.com`;
        
        // Check if user exists
        let user = await User.findOne({ email });
        
        if (user) {
          return done(null, user);
        }
        
        // Create new user
        user = new User({
          username: profile.username,
          email: email,
          password: 'github-oauth-' + Math.random().toString(36).substring(2),
          isVerified: true
        });
        
        await user.save();
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }));
  }

  // JWT Strategy for API Authentication
  const jwtOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: process.env.JWT_SECRET || 'your_jwt_secret'
  };
  
  passport.use(new JwtStrategy(jwtOptions, async (payload, done) => {
    try {
      const user = await User.findById(payload.id);
      if (user) {
        return done(null, user);
      }
      return done(null, false);
    } catch (err) {
      return done(err, false);
    }
  }));

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id, done) => {
    User.findById(id)
      .then(user => done(null, user))
      .catch(err => done(err));
  });
};
