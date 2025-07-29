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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

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
  return nodemailer.createTransport({
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
const Applicant = mongoose.model('Applicant', applicantSchema);

// MongoDB connection with fallback to in-memory storage
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ongc-internship';
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000 // 5 second timeout
    });
    console.log('Connected to MongoDB');
    await initializeMongoUsers();
  } catch (error) {
    console.warn('MongoDB connection failed, using in-memory storage:', error.message);
    console.log('Server running with in-memory storage (data will not persist)');
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

// Middleware for authentication
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    let user;
    if (mongoose.connection.readyState === 1) {
      // MongoDB is connected
      user = await User.findById(decoded.userId).select('-password');
    } else {
      // Use in-memory storage
      user = users.find(u => u._id === decoded.userId);
      if (user) {
        const { password, ...userWithoutPassword } = user;
        user = userWithoutPassword;
      }
    }
    
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive user' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Middleware for role-based access
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// Authentication Routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }
    
    let user;
    if (mongoose.connection.readyState === 1) {
      // MongoDB is connected
      user = await User.findOne({ email: email.toLowerCase() });
    } else {
      // Use in-memory storage
      user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    }
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }
    
    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is deactivated' 
      });
    }
    
    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }
    
    // Update last login
    user.lastLogin = new Date();
    if (mongoose.connection.readyState === 1) {
      await user.save();
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    // Return user data without password
    const { password: _, ...userWithoutPassword } = user.toObject ? user.toObject() : user;
    
    res.json({
      success: true,
      token,
      user: userWithoutPassword
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ 
    success: true, 
    user: req.user 
  });
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
  res.json({ 
    success: true, 
    message: 'Logged out successfully' 
  });
});
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
    
    // Validate required fields
    if (!to || !subject || (!html && !text)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: to, subject, and html/text content'
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
    } catch (verifyError) {
      console.error('Email transporter verification failed:', verifyError);
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'MongoDB Connected' : 'In-Memory Storage';
  const emailConfigured = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
  
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    database: dbStatus,
    email: emailConfigured ? 'Configured' : 'Not Configured'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Connect to database and start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log('Demo credentials:');
    console.log('HR Manager: hr@ongc.co.in / password123');
    console.log('Admin: admin@ongc.co.in / admin123');
  });
});