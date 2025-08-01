import * as XLSX from 'xlsx';
import { Applicant } from '../types/applicant';

export const parseExcelFile = (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Get raw data with header: 1 to handle the timestamp column properly
        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const processedData = processRawExcelData(rawData);
        
        resolve(processedData);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsBinaryString(file);
  });
};

const processRawExcelData = (rawData: any[][]): any[] => {
  if (rawData.length < 2) return [];
  
  const headers = rawData[0];
  const dataRows = rawData.slice(1);
  
  // Handle the case where first column might be timestamp with no header
  const processedHeaders = headers.map((header, index) => {
    if (index === 0 && (!header || header.trim() === '')) {
      // Check if first column contains timestamp-like data
      const firstDataValue = dataRows[0]?.[0];
      if (firstDataValue && isTimestampLike(String(firstDataValue))) {
        return 'Timestamp';
      }
    }
    return header || `Column_${index + 1}`;
  });
  
  return dataRows.map(row => {
    const obj: any = {};
    processedHeaders.forEach((header, index) => {
      obj[header] = row[index] || '';
    });
    return obj;
  });
};

const isTimestampLike = (value: string): boolean => {
  // Check for common timestamp patterns
  const timestampPatterns = [
    /^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}$/, // 2/1/2025 11:53:46
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/, // 2025-02-01 11:53:46
    /^\d{1,2}\/\d{1,2}\/\d{4}$/, // 2/1/2025
    /^\d{4}-\d{2}-\d{2}$/ // 2025-02-01
  ];
  
  return timestampPatterns.some(pattern => pattern.test(value.trim()));
};

export const parseCSVFile = (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          resolve([]);
          return;
        }
        
        const headers = lines[0].split('\t').map(h => h.trim()); // Use tab delimiter for better parsing
        const data = [];
        
        // Handle timestamp column
        const processedHeaders = headers.map((header, index) => {
          if (index === 0 && (!header || header.trim() === '')) {
            const firstDataValue = lines[1]?.split('\t')[0];
            if (firstDataValue && isTimestampLike(firstDataValue)) {
              return 'Timestamp';
            }
          }
          return header || `Column_${index + 1}`;
        });
        
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim()) {
            const values = lines[i].split('\t').map(v => v.trim());
            const row: any = {};
            processedHeaders.forEach((header, index) => {
              row[header] = values[index] || '';
            });
            data.push(row);
          }
        }
        
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
};

// Helper function to get value from row with multiple possible column names
const getFieldValue = (row: any, possibleNames: string[]): string => {
  for (const name of possibleNames) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
      return String(row[name]).trim();
    }
  }
  return '';
};

// Helper function to get numeric value from row
const getNumericValue = (row: any, possibleNames: string[]): number => {
  const value = getFieldValue(row, possibleNames);
  if (!value) return 0;
  
  // Handle percentage values that might have % symbol
  const cleanValue = value.replace('%', '').trim();
  const parsed = parseFloat(cleanValue);
  return isNaN(parsed) ? 0 : parsed;
};

// Helper function to parse timestamp
const parseTimestamp = (timestampStr: string): Date => {
  if (!timestampStr) return new Date();
  
  try {
    // Handle MM/DD/YYYY HH:MM:SS format
    const parsed = new Date(timestampStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  } catch (error) {
    // Fallback to current date if parsing fails
  }
  
  return new Date();
};

export const validateApplicantData = (data: any[]): { valid: Applicant[]; errors: string[]; duplicates: string[] } => {
  const valid: Applicant[] = [];
  const errors: string[] = [];
  const duplicates: string[] = [];
  
  // Check against existing data in localStorage
  const existingData = localStorage.getItem('ongc-applicants');
  const existingApplicants: Applicant[] = existingData ? JSON.parse(existingData) : [];
  
  const seenEmails = new Set<string>(existingApplicants.map(a => a.email.toLowerCase()));
  const seenCPFs = new Set<string>(existingApplicants.map(a => a.cpf).filter(Boolean));
  
  // Also track within current batch
  const currentBatchEmails = new Set<string>();
  const currentBatchCPFs = new Set<string>();
  
  data.forEach((row, index) => {
    try {
      // Extract timestamp if available
      const timestampValue = getFieldValue(row, ['']);
      const submissionDate = timestampValue ? parseTimestamp(timestampValue) : new Date();
      
      // Extract email and CPF for duplicate checking
      const email = getFieldValue(row, [
        'Email address',
        'Email'
      ]).toLowerCase();
      
      const cpf = getFieldValue(row, [
        'सीपीएफ / CPF',
        'CPF'
      ]);
      
      // Check for duplicates
      if (email && (seenEmails.has(email) || currentBatchEmails.has(email))) {
        duplicates.push(`Row ${index + 2}: Duplicate email found - ${email} ${seenEmails.has(email) ? '(exists in database)' : '(duplicate in current batch)'}`);
        return;
      }
      
      if (cpf && (seenCPFs.has(cpf) || currentBatchCPFs.has(cpf))) {
        duplicates.push(`Row ${index + 2}: Duplicate CPF found - ${cpf} ${seenCPFs.has(cpf) ? '(exists in database)' : '(duplicate in current batch)'}`);
        return;
      }
      
      // Map Excel columns to our schema using the exact column names from your format
      const applicant: Partial<Applicant> = {
        submissionTimestamp: submissionDate,
        
        email: email,
        
        instructionAcknowledged: getFieldValue(row, [
          'I have read and understood the instructions of the above mentioned notification.'
        ]),
        
        trainingAcknowledgement: getFieldValue(row, [
          'मैं समझता हूं कि यह केवल एक आवेदन पत्र है, प्रशिक्षण ओएनजीसी द्वारा पुष्टि के अधीन होगा। / I understand that this is an application form only, training will be subject to confirmation by ONGC.'
        ]),
        
        name: getFieldValue(row, [
          'नाम/  Name (in capital)'
        ]),
        
        age: getNumericValue(row, [
          'आयु (वर्षों में) / Age (in years)'
        ]),
        
        gender: getFieldValue(row, [
          'लिंग/ Gender'
        ]),
        
        category: getFieldValue(row, [
          'वर्ग / Category'
        ]),
        
        address: getFieldValue(row, [
          'पता / Address'
        ]),
        
        mobileNo: getFieldValue(row, [
          'मोबाइल  / Mobile No.'
        ]),
        
        email2: getFieldValue(row, [
          'ईमेल / Email'
        ]),
        
        fatherMotherName: getFieldValue(row, [
          'पिता/माता का नाम / Father/ Mother\'s Name'
        ]),
        
        fatherMotherOccupation: getFieldValue(row, [
          'पिता/माता का व्यवसाय / Father/ Mother\'s Occupation'
        ]),
        
        presentInstitute: getFieldValue(row, [
          'वर्तमान संस्थान का नाम / Name of the present Institute'
        ]),
        
        areasOfTraining: getFieldValue(row, [
          'ओएनजीसी, देहरादून द्वारा प्रदान किए जाने वाले प्रशिक्षण के क्षेत्र / Areas of Training offered by ONGC, Dehradun'
        ]),
        
        presentSemester: getFieldValue(row, [
          'वर्तमान सेमेस्टर / Present Semester'
        ]),
        
        lastSemesterSGPA: getNumericValue(row, [
          'अंतिम सेमेस्टर एसजीपीए / Last Semester SGPA'
        ]),
        
        percentageIn10Plus2: getNumericValue(row, [
          '10+2 में प्रतिशत / Percentage in 10+2'
        ]),
        
        declaration01: getFieldValue(row, [
          'आवेदक का घोषणापत्र_01 / Applicant\'s Declaration_01'
        ]),
        
        declaration02: getFieldValue(row, [
          'आवेदक का घोषणापत्र_02 / Applicant\'s Declaration_02'
        ]),
        
        declaration03: getFieldValue(row, [
          'आवेदक का घोषणापत्र_03 / Applicant\'s Declaration_03'
        ]),
        
        designation: getFieldValue(row, [
          'पदनाम / Designation'
        ]),
        
        cpf: cpf,
        
        section: getFieldValue(row, [
          'अनुभाग / Section'
        ]),
        
        location: getFieldValue(row, [
          'स्थान / Location'
        ]),
        
        mentorMobileNo: getFieldValue(row, [
          'मोबाइल  / Mobile No. ' // The second Mobile No. column (with trailing space)
        ]),
        
        mentorDetailsAvailable: getFieldValue(row, [
          'मेंटर का विवरण उपलब्ध / Mentor details available'
        ]),
        
        guardianOccupationDetails: getFieldValue(row, [
          'पिता/माता/अभिभावक का व्यवसाय विवरण / Father/Mother/Guardian\'s Occupation details'
        ]),
        
        mentorCPF: getFieldValue(row, [
          'मेंटर का सीपीएफ / CPF No. of Mentor'
        ]),
        
        mentorName: getFieldValue(row, [
          'मेंटर का नाम / Name of Mentor'
        ]),
        
        mentorDesignation: getFieldValue(row, [
          'मेंटर का पदनाम / Designation of Mentor'
        ]),
        
        mentorSection: getFieldValue(row, [
          'मेंटर का अनुभाग / Section of Mentor'
        ]),
        
        mentorLocation: getFieldValue(row, [
          'मेंटर का स्थान / Location of Mentor'
        ]),
        
        mentorEmail: getFieldValue(row, [
          'मेंटर का आधिकारिक ईमेल / Official email of mentor'
        ]),
        
        preferenceCriteria: getFieldValue(row, [
          'Preference Criteria'
        ]),
        
        referredBy: getFieldValue(row, [
          'Referred by'
        ]),
        
        status: getFieldValue(row, [
          'Status'
        ]) || 'Pending',
        
        uploadDate: new Date(),
        processedBy: 'admin'
      };
      
      // Only validate truly required fields to ensure 100% success rate
      if (!applicant.email) {
        errors.push(`Row ${index + 2}: Missing email address`);
        return;
      }
      
      if (!applicant.name) {
        errors.push(`Row ${index + 2}: Missing name`);
        return;
      }
      
      // Compute fields
      applicant.term = computeTerm();
      applicant.quotaCategory = computeQuotaCategory(applicant.category || '');
      applicant.lateApplication = computeLateApplication(applicant.mentorDetailsAvailable || '');
      
      // Add to seen sets to prevent duplicates
      if (email) {
        seenEmails.add(email);
        currentBatchEmails.add(email);
      }
      if (cpf) {
        seenCPFs.add(cpf);
        currentBatchCPFs.add(cpf);
      }
      
      valid.push(applicant as Applicant);
      
    } catch (error) {
      errors.push(`Row ${index + 2}: ${error instanceof Error ? error.message : 'Processing error'}`);
    }
  });
  
  // Sort by submission timestamp (most recent first)
  valid.sort((a, b) => {
    const dateA = a.submissionTimestamp ? new Date(a.submissionTimestamp).getTime() : 0;
    const dateB = b.submissionTimestamp ? new Date(b.submissionTimestamp).getTime() : 0;
    return dateB - dateA; // Descending order (newest first)
  });
  
  return { valid, errors, duplicates };
};

const computeTerm = (): 'Summer' | 'Winter' => {
  const now = new Date();
  const month = now.getMonth();
  // Summer: April-September (months 3-8), Winter: October-March (months 9-2)
  return month >= 3 && month <= 8 ? 'Summer' : 'Winter';
};

const computeQuotaCategory = (category: string): 'General' | 'Reserved' => {
  if (!category) return 'General';
  
  const categoryUpper = category.toUpperCase();
  const reservedKeywords = ['SC', 'ST', 'OBC', 'EWS', 'एससी', 'एसटी'];
  
  return reservedKeywords.some(keyword => categoryUpper.includes(keyword)) ? 'Reserved' : 'General';
};

const computeLateApplication = (mentorDetailsAvailable: string): boolean => {
  if (!mentorDetailsAvailable) return false;
  
  // Check if mentor details are available
  const mentorAvailable = mentorDetailsAvailable.toLowerCase();
  const hasMentorSupport = mentorAvailable.includes('yes') || 
                          mentorAvailable.includes('हां') || 
                          mentorAvailable.includes('available');
  
  // For demo purposes, assume deadline was 30 days ago
  const deadline = new Date();
  deadline.setDate(deadline.getDate() - 30);
  
  return new Date() > deadline && hasMentorSupport;
};