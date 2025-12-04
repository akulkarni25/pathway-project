require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const pdfParseRaw = require("pdf-parse");
const mammoth = require("mammoth");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const router = express.Router();

let pdfParse = pdfParseRaw;
if (typeof pdfParse !== "function" && pdfParse && typeof pdfParse.default === "function") {
  pdfParse = pdfParse.default;
}

// ---------- Supabase client ----------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_KEY");
}

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// ---------- OpenAI client ----------
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ---------- Require auth (uses existing session middleware) ----------
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Not logged in.",
    });
  }
  next();
}

// ---------- Multer upload (PDF / DOCX) ----------
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const userId = (req.session && req.session.user && req.session.user.id) || "anon";
    const safeOriginal = file.originalname.replace(/[^\w.\-]/g, "_");
    cb(null, `${userId}_${Date.now()}_${safeOriginal}`);
  },
});

const upload = multer({ storage });

// ---------- Helper: extract text from PDF/DOCX ----------
async function extractTextFromResume(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const buffer = fs.readFileSync(file.path);

  console.log(">> extractTextFromResume ext:", ext, "mimetype:", file.mimetype);
  console.log(">> typeof pdfParse:", typeof pdfParse);

  if (ext === ".pdf" || file.mimetype === "application/pdf") {
    const parsed = await pdfParse(buffer);
    return parsed.text || "";
  }

  if (ext === ".docx" ||
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }

  throw new Error("Unsupported file type. Only PDF and DOCX are allowed.");
}

// ---------- Helper: call OpenAI to extract skills ----------
async function extractSkillsWithOpenAI(resumeText) {
  if (!openai) {
    throw new Error("OpenAI API key is not configured on the server.");
  }

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an assistant that extracts key skills from resumes. " +
          "Return a JSON object with `skills`, an array of short skill phrases. " +
          "Each skill must be at most 3 words (e.g. 'Data Analysis', 'React', 'Project Management'). " +
          "Avoid long sentences or full responsibilities."
      },
      {
        role: "user",
        content:
          "Here is the resume text. Extract the key skills as short phrases (max 3 words each):\n\n" +
          resumeText.slice(0, 15000)
      }
    ],
  });

  let parsed;
  try {
    parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
  } catch (e) {
    console.error("Failed to parse OpenAI JSON:", e);
    parsed = {};
  }

  let skills = Array.isArray(parsed.skills) ? parsed.skills : [];

  skills = skills
    .map((s) => String(s || "").trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const parts = s.split(/\s+/);
      return parts.slice(0, 3).join(" ");
    });

  const seen = new Set();
  skills = skills.filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return skills;
}

// ---------- Route: POST /api/resume_upload ----------
router.post(
  "/resume_upload",
  requireAuth,
  upload.single("resume"),
  async (req, res) => {
    const file = req.file;

    console.log(">> HIT /api/resume_upload, file:", file && file.originalname);

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No resume file uploaded.",
      });
    }

    if (!supabase) {
      return res.status(500).json({
        success: false,
        message: "Supabase is not configured on the server.",
      });
    }

    try {
      // 1) Extract text from resume (PDF / DOCX)
      const resumeText = await extractTextFromResume(file);
      console.log(">> resumeText length:", resumeText && resumeText.length);

      if (!resumeText || !resumeText.trim()) {
        throw new Error("Could not extract readable text from the resume.");
      }

      // 2) Extract skills with OpenAI
      const newSkills = await extractSkillsWithOpenAI(resumeText);
      console.log(">> newSkills:", newSkills);

      const userId = req.session.user.id;

      const resumeUrl = `/uploads/${file.filename}`;

      const { data, error } = await supabase
        .from("users")
        .update({
          skills: newSkills,
          resume_url: resumeUrl,
        })
        .eq("id", userId)
        .select("id, skills, resume_url")
        .maybeSingle();

      if (error) {
        console.error("Supabase update skills/resume error:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to save skills or resume to your profile.",
        });
      }

      console.log(">> sending success response from /api/resume_upload");
      return res.json({
        success: true,
        message: "Skills extracted and resume saved to your profile.",
        skills: data?.skills || newSkills,
        resumeUrl: data?.resume_url || resumeUrl,
      });
    } catch (err) {
      console.error("/api/resume_upload error:", err);

      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: err.message || "Server error while extracting skills.",
        });
      }

      res.end();
    }
  }
);


module.exports = router;