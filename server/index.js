const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');

// SQL Database imports
const { testConnection, syncDatabase } = require('./config/database');
const { initializeSQLUsers } = require('./utils/authHelpers');
const { router: authRouter, authenticateToken, requireRole } = require('./routes/auth');

// MongoDB imports
const Applicant = require('./models/Applicant');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
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
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500,
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Stricter rate limiting for authentication routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
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

const accessLogStream = fs.createWriteStream(logFile, { flags: 'a' });
app.use(morgan('combined', { stream: accessLogStream }));
app.use(morgan('combined')); // Also log to console

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN ? 
    process.env.CORS_ORIGIN.split(',') : 
    ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json({ limit: process.env.MAX_FILE_SIZE || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.MAX_FILE_SIZE || '10mb' }));

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel and CSV files are allowed.'));
    }
  }
});

// In-memory storage for development (replace with MongoDB when available)
let users = [
  {
    _id: '1',
    email: 'hr@ongc.co.in',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password123
    name: 'HR Manager',
    role: 'hr_manager',
    department: 'Human Resources',
    employeeId: 'HR001',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    _id: '2',
    email: 'admin@ongc.co.in',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // admin123
    name: 'System Administrator',
    role: 'admin',
    department: 'IT',
    employeeId: 'IT001',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

let applicants = [];
let nextApplicantId = 1;

// Configure Nodemailer transporter
const createEmailTransporter = () => {
  console.log('📧 Configuring email transporter...');
  console.log(`📮 Host: ${process.env.EMAIL_HOST || 'smtp.gmail.com'}`);
  console.log(`🔌 Port: ${process.env.EMAIL_PORT || 587}`);
  console.log(`👤 User: ${process.env.EMAIL_USER || 'Not configured'}`);
  console.log(`🔐 Password: ${process.env.EMAIL_PASS ? '***configured***' : 'Not configured'}`);
  
  // Use real email transporter (no more mock for development)
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false
    }
  });
  
  console.log('✅ Email transporter configured successfully.');
  return transporter;
};

// Define schemas and models (always available)
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { 
    type: String, 
    enum: ['hr_manager', 'admin', 'viewer'], 
    default: 'hr_manager' 
  },
  department: { type: String, default: 'Human Resources' },
  employeeId: { type: String, required: true, unique: true },
  isActive: { type: Boolean, default: true },
  lastLogin: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const applicantSchema = new mongoose.Schema({
  submissionTimestamp: Date,
  email: { type: String, required: true, unique: true },
  instructionAcknowledged: String,
  trainingAcknowledgement: String,
  name: { type: String, required: true },
  age: Number,
  gender: String,
  category: String,
  address: String,
  mobileNo: String,
  email2: String,
  fatherMotherName: String,
  fatherMotherOccupation: String,
  presentInstitute: String,
  areasOfTraining: String,
  presentSemester: String,
  lastSemesterSGPA: Number,
  percentageIn10Plus2: Number,
  declaration01: String,
  declaration02: String,
  declaration03: String,
  designation: String,
  cpf: { type: String, required: true },
  section: String,
  location: String,
  mentorMobileNo: String,
  mentorDetailsAvailable: String,
  guardianOccupationDetails: String,
  mentorCPF: String,
  mentorName: String,
  mentorDesignation: String,
  mentorSection: String,
  mentorLocation: String,
  mentorEmail: String,
  preferenceCriteria: String,
  referredBy: String,
  status: { type: String, default: 'Pending' },
  
  // Computed fields
  term: { type: String, enum: ['Summer', 'Winter'] },
  quotaCategory: { type: String, enum: ['General', 'Reserved'] },
  lateApplication: { type: Boolean, default: false },
  uploadDate: { type: Date, default: Date.now },
  processedBy: String
});

const User = mongoose.model('User', userSchema);

// SQL Database connection
const connectSQLDB = async () => {
  try {
    console.log('🗄️  Initializing SQL database connection...');
    
    // First, create database if it doesn't exist
    const { createDatabaseIfNotExists } = require('./config/database');
    await createDatabaseIfNotExists();
    
    // Then test connection
    const isConnected = await testConnection();
    if (isConnected) {
      await syncDatabase();
      await initializeSQLUsers();
      console.log('✅ SQL Database setup completed');
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ SQL Database connection failed:', error.message);
    return false;
  }
};

// MongoDB connection with fallback to in-memory storage
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ongc-internship';
    console.log('🗄️  Connecting to MongoDB...');
    console.log(`📊 URI: ${mongoUri}`);
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000 // 5 second timeout
    });
    console.log('✅ Connected to MongoDB successfully');
    
    // Log MongoDB statistics
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    console.log(`📊 MongoDB Collections: ${collections.map(c => c.name).join(', ')}`);
    
    // Check applicant data
    const applicantCount = await Applicant.countDocuments();
    console.log(`👥 Total Applicants in MongoDB: ${applicantCount}`);
    
    await initializeMongoUsers();
  } catch (error) {
    console.warn('⚠️  MongoDB connection failed, using in-memory storage:', error.message);
    console.log('💾 Server running with in-memory storage (data will not persist)');
    await initializeInMemoryUsers();
  }
};

// Initialize users for MongoDB
const initializeMongoUsers = async () => {
  try {
    const userCount = await User.countDocuments();
    
    if (userCount === 0) {
      const defaultUsers = [
        {
          email: 'hr@ongc.co.in',
          password: await bcrypt.hash('password123', 10),
          name: 'HR Manager',
          role: 'hr_manager',
          department: 'Human Resources',
          employeeId: 'HR001',
          isActive: true
        },
        {
          email: 'admin@ongc.co.in',
          password: await bcrypt.hash('admin123', 10),
          name: 'System Administrator',
          role: 'admin',
          department: 'IT',
          employeeId: 'IT001',
          isActive: true
        }
      ];
      
      await User.insertMany(defaultUsers);
      console.log('Default users created successfully');
    }
  } catch (error) {
    console.error('Error initializing MongoDB users:', error);
  }
};

// Initialize users for in-memory storage
const initializeInMemoryUsers = async () => {
  try {
    // Hash passwords for in-memory users
    users[0].password = await bcrypt.hash('password123', 10);
    users[1].password = await bcrypt.hash('admin123', 10);
    console.log('In-memory users initialized successfully');
  } catch (error) {
    console.error('Error initializing in-memory users:', error);
  }
};

// Note: authenticateToken and requireRole are imported from routes/auth.js

// Authentication routes are handled by authRouter
// Function to fill PDF form with applicant data
const fillPDFForm = async (applicantData, registrationNumber) => {
  try {
    const templatePath = path.join(__dirname, 'templates', 'template.pdf');
    
    // Check if template exists
    if (!fs.existsSync(templatePath)) {
      console.warn('PDF template not found at:', templatePath);
      return null;
    }
    
    // Read the template PDF
    const existingPdfBytes = fs.readFileSync(templatePath);
    
    // Load the PDF document
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    
    // Get the form from the PDF
    const form = pdfDoc.getForm();
    
    // Get all field names (for debugging - you can remove this later)
    const fieldNames = form.getFields().map(field => field.getName());
    console.log('Available PDF form fields:', fieldNames);
    
    // Helper function to safely set field value
    const setFieldValue = (fieldName, value) => {
      try {
        const field = form.getField(fieldName);
        if (field) {
          // Convert value to string and handle null/undefined
          const stringValue = value ? String(value).trim() : '';
          
          // Check field type and set accordingly
          if (field.constructor.name === 'PDFTextField') {
            field.setText(stringValue);
          } else if (field.constructor.name === 'PDFCheckBox') {
            // For checkboxes, check if value indicates true
            const shouldCheck = stringValue.toLowerCase().includes('yes') || 
                               stringValue.toLowerCase().includes('हां') ||
                               stringValue === '1' ||
                               stringValue.toLowerCase() === 'true';
            if (shouldCheck) {
              field.check();
            }
          } else if (field.constructor.name === 'PDFDropdown') {
            // For dropdowns, try to select the option
            const options = field.getOptions();
            const matchingOption = options.find(opt => 
              opt.toLowerCase().includes(stringValue.toLowerCase()) ||
              stringValue.toLowerCase().includes(opt.toLowerCase())
            );
            if (matchingOption) {
              field.select(matchingOption);
            }
          }
          console.log(`Set field "${fieldName}" to "${stringValue}"`);
        }
      } catch (error) {
        console.warn(`Could not set field "${fieldName}":`, error.message);
      }
    };
    
    // Fill the form fields with applicant data
    // You may need to adjust these field names based on your actual PDF form
    
    // Basic Information
    setFieldValue('name', applicantData.name);
    setFieldValue('Name', applicantData.name);
    setFieldValue('applicant_name', applicantData.name);
    setFieldValue('student_name', applicantData.name);
    
    setFieldValue('email', applicantData.email);
    setFieldValue('Email', applicantData.email);
    setFieldValue('email_address', applicantData.email);
    
    setFieldValue('mobile', applicantData.mobileNo);
    setFieldValue('Mobile', applicantData.mobileNo);
    setFieldValue('mobile_no', applicantData.mobileNo);
    setFieldValue('phone', applicantData.mobileNo);
    
    setFieldValue('age', applicantData.age);
    setFieldValue('Age', applicantData.age);
    
    setFieldValue('gender', applicantData.gender);
    setFieldValue('Gender', applicantData.gender);
    
    setFieldValue('category', applicantData.category);
    setFieldValue('Category', applicantData.category);
    
    setFieldValue('address', applicantData.address);
    setFieldValue('Address', applicantData.address);
    
    // Family Information
    setFieldValue('father_mother_name', applicantData.fatherMotherName);
    setFieldValue('father_name', applicantData.fatherMotherName);
    setFieldValue('parent_name', applicantData.fatherMotherName);
    
    setFieldValue('father_mother_occupation', applicantData.fatherMotherOccupation);
    setFieldValue('father_occupation', applicantData.fatherMotherOccupation);
    setFieldValue('parent_occupation', applicantData.fatherMotherOccupation);
    
    // Academic Information
    setFieldValue('institute', applicantData.presentInstitute);
    setFieldValue('Institute', applicantData.presentInstitute);
    setFieldValue('college', applicantData.presentInstitute);
    setFieldValue('present_institute', applicantData.presentInstitute);
    
    setFieldValue('semester', applicantData.presentSemester);
    setFieldValue('Semester', applicantData.presentSemester);
    setFieldValue('present_semester', applicantData.presentSemester);
    
    setFieldValue('sgpa', applicantData.lastSemesterSGPA);
    setFieldValue('SGPA', applicantData.lastSemesterSGPA);
    setFieldValue('last_semester_sgpa', applicantData.lastSemesterSGPA);
    
    setFieldValue('percentage_12th', applicantData.percentageIn10Plus2);
    setFieldValue('12th_percentage', applicantData.percentageIn10Plus2);
    setFieldValue('percentage_10_2', applicantData.percentageIn10Plus2);
    
    setFieldValue('training_area', applicantData.areasOfTraining);
    setFieldValue('areas_of_training', applicantData.areasOfTraining);
    setFieldValue('training_areas', applicantData.areasOfTraining);
    
    // ONGC Specific Information
    setFieldValue('cpf', applicantData.cpf);
    setFieldValue('CPF', applicantData.cpf);
    setFieldValue('cpf_number', applicantData.cpf);
    
    setFieldValue('designation', applicantData.designation);
    setFieldValue('Designation', applicantData.designation);
    
    setFieldValue('section', applicantData.section);
    setFieldValue('Section', applicantData.section);
    
    setFieldValue('location', applicantData.location);
    setFieldValue('Location', applicantData.location);
    
    // Mentor Information
    setFieldValue('mentor_name', applicantData.mentorName);
    setFieldValue('mentor_designation', applicantData.mentorDesignation);
    setFieldValue('mentor_section', applicantData.mentorSection);
    setFieldValue('mentor_location', applicantData.mentorLocation);
    setFieldValue('mentor_email', applicantData.mentorEmail);
    setFieldValue('mentor_cpf', applicantData.mentorCPF);
    setFieldValue('mentor_mobile', applicantData.mentorMobileNo);
    
    // Registration and System Information
    setFieldValue('registration_number', registrationNumber);
    setFieldValue('reg_number', registrationNumber);
    setFieldValue('registration_no', registrationNumber);
    
    setFieldValue('term', applicantData.term);
    setFieldValue('Term', applicantData.term);
    
    setFieldValue('quota_category', applicantData.quotaCategory);
    setFieldValue('quota', applicantData.quotaCategory);
    
    // Current date
    const currentDate = new Date().toLocaleDateString('en-IN');
    setFieldValue('date', currentDate);
    setFieldValue('Date', currentDate);
    setFieldValue('application_date', currentDate);
    
    // Declarations (if they exist as checkboxes)
    setFieldValue('declaration_01', applicantData.declaration01);
    setFieldValue('declaration_02', applicantData.declaration02);
    setFieldValue('declaration_03', applicantData.declaration03);
    
    setFieldValue('instruction_acknowledged', applicantData.instructionAcknowledged);
    setFieldValue('training_acknowledgement', applicantData.trainingAcknowledgement);
    
    // Flatten the form to prevent further editing
    form.flatten();
    
    // Serialize the PDF
    const pdfBytes = await pdfDoc.save();
    
    return pdfBytes;
    
  } catch (error) {
    console.error('Error filling PDF form:', error);
    return null;
  }
};

// Email sending endpoint
app.post('/api/send-email', authenticateToken, async (req, res) => {
  try {
    const { to, subject, html, text, attachTemplate } = req.body;
    
    console.log('📧 Email sending request received:');
    console.log(`   📮 To: ${to}`);
    console.log(`   📝 Subject: ${subject}`);
    console.log(`   📎 Attach Template: ${attachTemplate ? 'Yes' : 'No'}`);
    
    // Validate required fields
    if (!to || !subject || (!html && !text)) {
      console.log('❌ Missing required email fields');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: to, subject, and html/text content'
      });
    }
    
    // Check if email configuration is available
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log('❌ Email configuration not found');
      return res.status(500).json({
        success: false,
        message: 'Email configuration not found. Please configure EMAIL_USER and EMAIL_PASS in environment variables.'
      });
    }
    
    // Create transporter
    console.log('🔧 Creating email transporter...');
    const transporter = createEmailTransporter();
    
    // Verify transporter configuration
    try {
      console.log('🔍 Verifying email transporter...');
      await transporter.verify();
      console.log('✅ Email transporter verified successfully.');
    } catch (verifyError) {
      console.error('❌ Email transporter verification failed:', verifyError);
      return res.status(500).json({
        success: false,
        message: 'Email service configuration error. Please check your email credentials.'
      });
    }
    
    // Email options
    const mailOptions = {
      from: `"ONGC Dehradun - SAIL" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      html: html,
      text: text || html?.replace(/<[^>]*>/g, ''), // Strip HTML tags for text version
      attachments: []
    };
    
    // Add PDF template attachment if requested
    if (attachTemplate) {
      // Check if we have applicant data to fill the form
      let pdfBuffer = null;
      
      // Try to extract applicant data from email content for form filling
      if (html && html.includes('Registration number is:')) {
        try {
          // Extract registration number from email content
          const regMatch = html.match(/SAIL-\d{4}-\d{4}/);
          const registrationNumber = regMatch ? regMatch[0] : '';
          
          // Create mock applicant data from email recipient
          // In a real implementation, you'd pass the full applicant data
          const applicantData = {
            name: to.split('@')[0], // Basic fallback
            email: to,
            registrationNumber: registrationNumber,
            // Add other fields as available
          };
          
          // Fill the PDF form
          pdfBuffer = await fillPDFForm(applicantData, registrationNumber);
        } catch (error) {
          console.error('Error creating filled PDF:', error);
        }
      }
      
      if (pdfBuffer) {
        // Use filled PDF
        mailOptions.attachments.push({
          filename: 'ONGC_Internship_Application_Form_Filled.pdf',
          content: pdfBuffer,
          contentType: 'application/pdf'
        });
      } else {
        // Fallback to blank template
        const templatePath = path.join(__dirname, 'templates', 'template.pdf');
        
        try {
          if (fs.existsSync(templatePath)) {
            mailOptions.attachments.push({
              filename: 'ONGC_Internship_Application_Form.pdf',
              path: templatePath,
              contentType: 'application/pdf'
            });
          } else {
            console.warn('Template PDF not found at:', templatePath);
          }
        } catch (attachError) {
          console.error('Error attaching template:', attachError);
        }
      }
    }
    
    // Send email
    const info = await transporter.sendMail(mailOptions);
    
    console.log('Email sent successfully:', {
      messageId: info.messageId,
      to: to,
      subject: subject
    });
    
    res.json({
      success: true,
      message: 'Email sent successfully',
      messageId: info.messageId
    });
    
  } catch (error) {
    console.error('Email sending error:', error);
    
    // Handle specific email errors
    let errorMessage = 'Failed to send email';
    if (error.code === 'EAUTH') {
      errorMessage = 'Email authentication failed. Please check your email credentials.';
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'Failed to connect to email server. Please check your network connection.';
    } else if (error.responseCode === 550) {
      errorMessage = 'Email rejected by recipient server. Please check the recipient email address.';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Bulk email sending endpoint
app.post('/api/send-bulk-emails', authenticateToken, async (req, res) => {
  try {
    const { emails } = req.body; // Array of { to, subject, html, text, attachTemplate } objects
    
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid emails array provided'
      });
    }
    
    // Check if email configuration is available
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({
        success: false,
        message: 'Email configuration not found'
      });
    }
    
    const transporter = createEmailTransporter();
    
    // Verify transporter
    try {
      await transporter.verify();
    } catch (verifyError) {
      return res.status(500).json({
        success: false,
        message: 'Email service configuration error'
      });
    }
    
    const results = [];
    const batchSize = 5; // Send emails in batches to avoid overwhelming the server
    
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (emailData) => {
        try {
          const mailOptions = {
            from: `"ONGC Dehradun - SAIL" <${process.env.EMAIL_USER}>`,
            to: emailData.to,
            subject: emailData.subject,
            html: emailData.html,
            text: emailData.text || emailData.html?.replace(/<[^>]*>/g, ''),
            attachments: []
          };
          
          // Add PDF template attachment if requested
          if (emailData.attachTemplate) {
            // Try to fill PDF with applicant data if available
            let pdfBuffer = null;
            
            if (emailData.applicantData) {
              try {
                // Extract registration number from email content
                const regMatch = emailData.html ? emailData.html.match(/SAIL-\d{4}-\d{4}/) : null;
                const registrationNumber = regMatch ? regMatch[0] : '';
                
                pdfBuffer = await fillPDFForm(emailData.applicantData, registrationNumber);
              } catch (error) {
                console.error(`Error creating filled PDF for ${emailData.to}:`, error);
              }
            }
            
            if (pdfBuffer) {
              // Use filled PDF
              mailOptions.attachments.push({
                filename: 'ONGC_Internship_Application_Form_Filled.pdf',
                content: pdfBuffer,
                contentType: 'application/pdf'
              });
            } else {
              // Fallback to blank template
              const templatePath = path.join(__dirname, 'templates', 'template.pdf');
              
              try {
                if (fs.existsSync(templatePath)) {
                  mailOptions.attachments.push({
                    filename: 'ONGC_Internship_Application_Form.pdf',
                    path: templatePath,
                    contentType: 'application/pdf'
                  });
                }
              } catch (attachError) {
                console.error(`Error attaching template for ${emailData.to}:`, attachError);
              }
            }
          }
          
          const info = await transporter.sendMail(mailOptions);
          
          return {
            to: emailData.to,
            success: true,
            messageId: info.messageId
          };
        } catch (error) {
          console.error(`Failed to send email to ${emailData.to}:`, error);
          return {
            to: emailData.to,
            success: false,
            error: error.message
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Add delay between batches to avoid rate limiting
      if (i + batchSize < emails.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    res.json({
      success: true,
      message: `Bulk email sending completed. ${successCount} sent, ${failureCount} failed.`,
      results: results,
      summary: {
        total: emails.length,
        sent: successCount,
        failed: failureCount
      }
    });
    
  } catch (error) {
    console.error('Bulk email sending error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send bulk emails',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Authentication routes (SQL Database)
app.use('/api/auth', authRouter);

// Applicant routes (MongoDB)
const applicantRouter = require('./routes/applicants');
app.use('/api/applicants', applicantRouter);

// Legacy route redirects (for backward compatibility)
app.get('/api/shortlisted', authenticateToken, (req, res) => {
  res.redirect('/api/applicants/shortlisted');
});

app.get('/api/approved', authenticateToken, (req, res) => {
  res.redirect('/api/applicants/approved');
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'MongoDB Connected' : 'In-Memory Storage';
  const emailConfigured = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
  
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    mongodb: mongoStatus,
    sql: 'Available for Authentication',
    email: emailConfigured ? 'Configured' : 'Not Configured'
  });
});

// Test email endpoint (no authentication required)
app.post('/api/test-email', async (req, res) => {
  try {
    const { to, subject, html } = req.body;
    
    console.log('📧 Test email request received:');
    console.log(`   📮 To: ${to}`);
    console.log(`   📝 Subject: ${subject}`);
    
    // Validate required fields
    if (!to || !subject || !html) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: to, subject, html'
      });
    }
    
    // Check if email configuration is available
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({
        success: false,
        message: 'Email configuration not found. Please configure EMAIL_USER and EMAIL_PASS in environment variables.'
      });
    }
    
    // Create transporter
    const transporter = createEmailTransporter();
    
    // Verify transporter configuration
    try {
      await transporter.verify();
      console.log('✅ Email transporter verified successfully.');
    } catch (verifyError) {
      console.error('❌ Email transporter verification failed:', verifyError);
      return res.status(500).json({
        success: false,
        message: 'Email service configuration error. Please check your email credentials.'
      });
    }
    
    // Email options
    const mailOptions = {
      from: `"ONGC Dehradun - SAIL" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      html: html,
      text: html.replace(/<[^>]*>/g, '') // Strip HTML tags for text version
    };
    
    // Send email
    const info = await transporter.sendMail(mailOptions);
    
    console.log('✅ Test email sent successfully:', {
      messageId: info.messageId,
      to: to,
      subject: subject
    });
    
    res.json({
      success: true,
      message: 'Test email sent successfully',
      messageId: info.messageId
    });
    
  } catch (error) {
    console.error('❌ Test email sending error:', error);
    
    let errorMessage = 'Failed to send test email';
    if (error.code === 'EAUTH') {
      errorMessage = 'Email authentication failed. Please check your email credentials.';
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'Failed to connect to email server. Please check your network connection.';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
});

// Error handling
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
  }
  
  console.error('Unhandled error:', error);
  
  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Something went wrong'
    });
  }

  // In development, show more details
  res.status(500).json({
    error: error.message,
    stack: error.stack
  });
});

// Connect to databases and start server
const startServer = async () => {
  try {
    // Connect to SQL database for authentication
    await connectSQLDB();
    
    // Connect to MongoDB for applicant data
    await connectDB();
    
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log('🔐 Authentication Demo credentials:');
      console.log('   HR Manager: hr@ongc.co.in / password123');
      console.log('   Admin: admin@ongc.co.in / admin123');
      console.log('   Viewer: viewer@ongc.co.in / viewer123');
      console.log('📝 Note: MongoDB handles applicant data, SQL handles authentication');
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
        process.exit(0);
      });
    });
    
  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
};

startServer();