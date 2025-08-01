const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

// Production security middleware
const productionMiddleware = (app) => {
  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
    message: {
      error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Apply rate limiting to all routes
  app.use(limiter);

  // Stricter rate limiting for authentication routes
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: {
      error: 'Too many authentication attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/auth', authLimiter);

  // Compression
  app.use(compression());

  // Trust proxy (if behind reverse proxy)
  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  // Logging
  const logFile = process.env.LOG_FILE || './logs/app.log';
  const logDir = path.dirname(logFile);
  
  // Create logs directory if it doesn't exist
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Use local log file instead of system log
  const accessLogStream = fs.createWriteStream(
    logFile,
    { flags: 'a' }
  );

  app.use(morgan('combined', { stream: accessLogStream }));
  app.use(morgan('combined')); // Also log to console

  // Error logging
  const errorLogStream = fs.createWriteStream(
    process.env.LOG_FILE || './logs/error.log',
    { flags: 'a' }
  );

  return {
    accessLogStream,
    errorLogStream
  };
};

// Production error handler
const productionErrorHandler = (err, req, res, next) => {
  // Log error
  console.error('Production Error:', err);

  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Something went wrong'
    });
  }

  // In development/staging, show more details
  res.status(500).json({
    error: err.message,
    stack: err.stack
  });
};

// Database connection with retry logic
const connectWithRetry = async (connectFunction, maxRetries = 5) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await connectFunction();
      return true;
    } catch (error) {
      console.error(`Connection attempt ${i + 1} failed:`, error.message);
      if (i === maxRetries - 1) {
        throw error;
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 5000 * (i + 1)));
    }
  }
};

module.exports = {
  productionMiddleware,
  productionErrorHandler,
  connectWithRetry
}; 