require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const multer = require("multer");
const XLSX = require("xlsx");
const schedule = require("node-schedule");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const bodyParser = require("body-parser");
const ENV_PATH = path.join(__dirname, '.env');

const app = express();
const PORT = 3000;

const unsubscribedEmails = new Set();

// Updated multer storage to save files with original filename
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: true,
  auth: {
    user: process.env.SMTP_MAIL,
    pass: process.env.SMTP_APP_PASS,
  },
});

// Unsubscribe route
app.get("/unsubscribe", (req, res) => {
  const email = req.query.email;
  if (!email) return res.send("No email provided.");
  unsubscribedEmails.add(email);
  res.sendFile(path.join(__dirname, "public", "unsubscribe.html"));
});

// Schedule single email (optional)
app.post("/schedule", (req, res) => {
  const { name, email, message, sendAt } = req.body;
  const sendDate = new Date(sendAt);
  if (unsubscribedEmails.has(email))
    return res.status(400).json({ success: false, message: "Unsubscribed." });
  if (isNaN(sendDate) || sendDate < new Date())
    return res.status(400).json({ message: "Invalid time." });

  schedule.scheduleJob(sendDate, async () => {
    const mailOptions = {
      from: process.env.SMTP_MAIL,
      to: email,
      subject: `Message from ${name}`,
      html: `<p>${message}</p><hr><p><a href="http://localhost:${PORT}/unsubscribe?email=${encodeURIComponent(
        email
      )}">Unsubscribe</a></p>`,
    };
    try {
      await transporter.sendMail(mailOptions);
    } catch (err) {
      console.error(err);
    }
  });

  res.json({ success: true, message: "Scheduled successfully" });
});

// Upload Excel and schedule bulk emails
app.post("/upload", upload.single("excel"), (req, res) => {
  const { message, sendAt } = req.body;
  const filePath = req.file.path; // path to saved file with original filename
  const originalName = req.file.originalname;
  const sendDate = new Date(sendAt);

  if (isNaN(sendDate) || sendDate < new Date()) {
    return res.status(400).json({ message: "Invalid date/time." });
  }

  // Read Excel file
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  const emails = sheet
    .map((row) => row.email || row.Email || row.E_mail || row["E-mail"])
    .filter(Boolean);

  if (emails.length === 0) {
    return res.status(400).json({ message: "No valid emails found in Excel." });
  }

  // Save email list as a log file for history
  const logPath = path.join(__dirname, "uploads", originalName + ".log.txt");
  fs.writeFileSync(logPath, emails.join("\n"));

  emails.forEach((email) => {
    if (unsubscribedEmails.has(email)) return;
    schedule.scheduleJob(sendDate, async () => {
      const mailOptions = {
        from: process.env.SMTP_MAIL,
        to: email,
        subject: "Scheduled Message",
        html: `<p>${message}</p><hr><p><a href="http://localhost:${PORT}/unsubscribe?email=${encodeURIComponent(
          email
        )}">Unsubscribe</a></p>`,
      };
      try {
        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${email}`);
      } catch (err) {
        console.error(`Failed to send to ${email}:`, err);
      }
    });
  });

  res.json({
    success: true,
    message: `Scheduled emails to ${emails.length} recipients.`,
  });
});

// Return only list of filenames (without emails)
app.get("/history", (req, res) => {
  const uploadDir = path.join(__dirname, "uploads");
  const files = fs.readdirSync(uploadDir).filter((f) => f.endsWith(".log.txt"));
  // Strip .log.txt extension
  const filenames = files.map((f) => f.replace(".log.txt", ""));
  res.json(filenames);
});

// Return emails for a given file (passed as query param)
app.get("/history/emails", (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).json({ error: "File param required" });

  const logPath = path.join(__dirname, "uploads", file + ".log.txt");
  if (!fs.existsSync(logPath))
    return res.status(404).json({ error: "File not found" });

  const emails = fs.readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
  res.json(emails);
});

// Download original uploaded Excel file by filename
app.get("/download", (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).send("File param required");

  const filePath = path.join(__dirname, "uploads", file);
  if (!fs.existsSync(filePath)) return res.status(404).send("File not found");

  res.download(filePath, file); // Force download with original filename
});

app.post("/update-settings", (req, res) => {
  const { SMTP_HOST, SMTP_PORT, SMTP_MAIL, SMTP_APP_PASS } = req.body;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_MAIL || !SMTP_APP_PASS) {
    return res.status(400).json({ message: "All fields are required." });
  }

  const newEnvContent = `SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_MAIL=${SMTP_MAIL}
SMTP_APP_PASS=${SMTP_APP_PASS}
`;

  try {
    fs.writeFileSync(ENV_PATH, newEnvContent);
    return res.json({
      message: "Settings updated. Please restart the server to apply changes.",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to update settings." });
  }
});

app.listen(PORT, () =>
  console.log(`Server running at http://localhost:${PORT}`)
);
