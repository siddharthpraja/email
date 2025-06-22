require('dotenv').config();
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const schedule = require('node-schedule');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { default: axios } = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// File upload configuration with unique filenames
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads');
    }
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '-');
    cb(null, uniqueSuffix + '-' + sanitizedName);
  }
});

const upload = multer({ storage });

// In-memory storage with persistence
let uploadedFiles = [];
const scheduledJobs = {};
const unsubscribedEmails = new Set();

// SMTP transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Load existing files on server start
function loadExistingFiles() {
  if (fs.existsSync('uploads')) {
    const files = fs.readdirSync('uploads');
    files.forEach(file => {
      if (file.endsWith('.xlsx')) {
        const filePath = path.join('uploads', file);
        try {
          const emails = extractEmailsFromExcel(filePath);
          uploadedFiles.push({
            filename: path.parse(file).name.replace(/^\d+-/g, ''), // Original name
            storedFilename: file, // Actual stored filename
            path: filePath,
            emails,
            uploadDate: fs.statSync(filePath).birthtime || new Date()
          });
        } catch (error) {
          console.error(`Error processing existing file ${file}:`, error);
        }
      }
    });
  }
}

// Extract emails from Excel
function extractEmailsFromExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet);

  const emails = [];
  data.forEach(row => {
    const email = row.email || row.Email || row.EMAIL;
    if (email && typeof email === 'string' && email.includes('@')) {
      emails.push(email.trim().toLowerCase());
    }
  });

  return emails;
}

// Schedule email job
function scheduleEmailJob(jobId, date, repetition, emails, subject, message, attachments, callback) {
  const job = schedule.scheduleJob(date, () => {
    sendEmails(emails, subject, message, attachments);
    
    if (repetition) {
      const rule = new schedule.RecurrenceRule();
      
      if (repetition === 'daily') {
        rule.hour = date.getHours();
        rule.minute = date.getMinutes();
      } else if (repetition === 'weekly') {
        rule.dayOfWeek = date.getDay();
        rule.hour = date.getHours();
        rule.minute = date.getMinutes();
      } else if (repetition === 'monthly') {
        rule.date = date.getDate();
        rule.hour = date.getHours();
        rule.minute = date.getMinutes();
      }
      
      scheduledJobs[jobId].job = schedule.scheduleJob(rule, () => {
        sendEmails(emails, subject, message, attachments);
      });
    }
  });

  scheduledJobs[jobId] = {
    job,
    date,
    repetition,
    emails,
    subject,
    message,
    attachments
  };

  callback();
}

// Send emails
function sendEmails(emails, subject, message, attachments = []) {
  const escapeHTML = (str) =>
    str.replace(/&/g, "&amp;")
       .replace(/</g, "&lt;")
       .replace(/>/g, "&gt;")
       .replace(/"/g, "&quot;")
       .replace(/'/g, "&#039;");

  // Convert newlines to <br> after escaping
  const formatMessage = (msg) => escapeHTML(msg).replace(/\n/g, "<br>");

  emails.forEach(email => {
    if (unsubscribedEmails.has(email)) return;

    const unsubscribeLink = `${process.env.BASE_URL}/unsubscribe.html?email=${encodeURIComponent(email)}`;
    const formattedMessage = formatMessage(message);

    const emailMessage = `
      ${formattedMessage}
      <br><br>
      <p>If you no longer wish to receive these emails, please <a href="${unsubscribeLink}">unsubscribe</a>.</p>
    `;

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: subject,
      html: emailMessage,
      attachments: attachments.map(file => ({
        filename: file.originalname,
        path: file.path
      }))
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error(`Error sending email to ${email}:`, error);
      } else {
        console.log(`Email sent to ${email}:`, info.response);
      }
    });
  });
}


// Load existing files when server starts
loadExistingFiles();

// API Endpoints

// Upload Excel file
app.post('/api/upload', upload.single('excelFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const emails = extractEmailsFromExcel(req.file.path);
    const fileInfo = {
      filename: req.file.originalname,
      storedFilename: req.file.filename,
      path: req.file.path,
      emails,
      uploadDate: new Date()
    };
    
    uploadedFiles.push(fileInfo);
    
    res.json({ 
      success: true, 
      filename: fileInfo.filename,
      storedFilename: fileInfo.storedFilename,
      emailCount: emails.length
    });
  } catch (error) {
    console.error('Error processing file:', error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Error processing file' });
  }
});

// Schedule emails
app.post('/api/schedule', upload.array('attachments', 5), (req, res) => {
  const { filename, subject, message, scheduleDate, repetition } = req.body;
  
  if (!filename || !subject || !message || !scheduleDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const file = uploadedFiles.find(f => f.filename === filename);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const date = new Date(scheduleDate);
  if (isNaN(date.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }

  const attachments = req.files || [];
  const jobId = `job_${Date.now()}`;

  scheduleEmailJob(
    jobId,
    date,
    repetition,
    file.emails,
    subject,
    message,
    attachments,
    () => {
      res.json({ 
        success: true, 
        jobId,
        scheduledDate: date.toISOString(),
        repetition
      });
    }
  );
});

// Get uploaded files
app.get('/api/files', (req, res) => {
  res.json(uploadedFiles.map(file => ({
    filename: file.filename,
    storedFilename: file.storedFilename,
    uploadDate: file.uploadDate,
    emailCount: file.emails.length
  })));
});

// Get file details
app.get('/api/files/:filename', (req, res) => {
  const storedFilename = req.params.filename;
  const file = uploadedFiles.find(f => f.storedFilename === storedFilename);
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.json({
    filename: file.filename,
    storedFilename: file.storedFilename,
    uploadDate: file.uploadDate,
    emails: file.emails
  });
});

// Download file
app.get('/api/files/:filename/download', (req, res) => {
  const storedFilename = req.params.filename;
  const file = uploadedFiles.find(f => f.storedFilename === storedFilename);
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  if (!fs.existsSync(file.path)) {
    uploadedFiles = uploadedFiles.filter(f => f.storedFilename !== storedFilename);
    return res.status(404).json({ error: 'File no longer exists' });
  }

  res.download(file.path, file.filename);
});

// Delete file
app.delete('/api/files/:filename', (req, res) => {
  const storedFilename = req.params.filename;
  const index = uploadedFiles.findIndex(f => f.storedFilename === storedFilename);
  
  if (index === -1) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Remove any scheduled jobs for this file
  Object.keys(scheduledJobs).forEach(jobId => {
    if (scheduledJobs[jobId].emails === uploadedFiles[index].emails) {
      scheduledJobs[jobId].job.cancel();
      delete scheduledJobs[jobId];
    }
  });

  // Delete the file
  try {
    fs.unlinkSync(uploadedFiles[index].path);
    uploadedFiles.splice(index, 1);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting file' });
  }
});

// Get scheduled jobs
app.get('/api/jobs', (req, res) => {
  const jobs = Object.keys(scheduledJobs).map(jobId => ({
    jobId,
    filename: uploadedFiles.find(f => 
      JSON.stringify(f.emails) === JSON.stringify(scheduledJobs[jobId].emails)
    )?.filename || 'Unknown',
    scheduledDate: scheduledJobs[jobId].date,
    repetition: scheduledJobs[jobId].repetition,
    subject: scheduledJobs[jobId].subject
  }));

  res.json(jobs);
});

// Cancel job
app.delete('/api/jobs/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  
  if (!scheduledJobs[jobId]) {
    return res.status(404).json({ error: 'Job not found' });
  }

  scheduledJobs[jobId].job.cancel();
  delete scheduledJobs[jobId];

  res.json({ success: true });
});

// Unsubscribe email
app.post('/api/unsubscribe', (req, res) => {
  const { email } = req.body;
  
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  unsubscribedEmails.add(email.toLowerCase());
  res.json({ success: true });
});

// Check unsubscribe status
app.get('/api/unsubscribe/:email', (req, res) => {
  const email = req.params.email;
  res.json({ unsubscribed: unsubscribedEmails.has(email.toLowerCase()) });
});

// Format message with AI
app.post('/api/format', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid message format' });
    }

    const response = await axios.post(
      `${process.env.NEXT_PUBLIC_GENERATIVE_API_URL}?key=${process.env.NEXT_PUBLIC_GENERATIVE_API_KEY}`,
      {
        contents: [{
          parts: [{
            text: `Please rewrite this email in professional business English while preserving all links and special formatting:\n\n${message}`
          }]
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const formattedText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || message;
    res.json({ formatted: formattedText });
    
  } catch (err) {
    console.error('AI Formatting Error:', {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message
    });
    
    res.status(500).json({ 
      error: 'AI formatting failed',
      details: err.response?.data || err.message 
    });
  }
});

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/history', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/history.html'));
});

app.get('/unsubscribe', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/unsubscribe.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Clean up on exit
process.on('SIGINT', () => {
  console.log('Server shutting down...');
  process.exit();
});