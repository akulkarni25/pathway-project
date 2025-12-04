require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const pdfParseRaw = require("pdf-parse");
const mammoth = require("mammoth");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const { Document, Packer, Paragraph, TextRun } = require("docx");

const router = express.Router();

let pdfParse = pdfParseRaw;
if (typeof pdfParse !== "function" && pdfParse && typeof pdfParse.default === "function") {
  pdfParse = pdfParse.default;
}

// ----- Supabase client -----
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing SUPABASE_URL or Supabase key for resume reformatter.");
}

const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// ----- OpenAI client -----
const openai =
  process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

// ----- Auth middleware (same logic as in server.js) -----
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Not logged in.",
    });
  }
  next();
}

// ----- Helper: extract text from resume file path -----
async function extractTextFromResumeFile(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  console.log(">> [reformatter] Extract ext:", ext);

  if (ext === ".pdf") {
    const parsed = await pdfParse(buffer);
    return parsed.text || "";
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }

  // Generic fallback (txt, unknown)
  return buffer.toString("utf8");
}

// ----- Helper: build prompt for AI -----
function buildReformatterPrompt(resumeText, jobDescription, preferences, tone) {
  const prefText = preferences
    ? `User preferences for changes:\n${preferences}\n\n`
    : "User did not provide specific formatting preferences.\n\n";

  const toneText = tone
    ? `Desired tone/emphasis: ${tone}.\n\n`
    : "Keep a similar tone to the original resume.\n\n";

  return `
You are an expert resume writer and editor.
You are given the full text of a candidate's resume and a target job description.

Your job:
- Reshape and lightly restructure the resume so it is clearly targeted to the job.
- Preserve the overall visual style and formatting as much as possible (section headings, bullet points, order of content), but:
  - You may move sections or bullets to highlight the most relevant skills and achievements.
  - You may rephrase bullets to be more action-driven, metric-focused, and aligned with the job.
- Keep all facts truthful; do not invent experience or skills that are not implied by the resume.
- Emphasize keywords, technologies, and responsibilities that match the job posting.
- Keep the resume to one page in length.

${prefText}${toneText}
Original resume starts below:
--------------------
${resumeText}
--------------------

Target job description:
--------------------
${jobDescription}
--------------------

Now produce a SINGLE, fully rewritten resume text, ready to paste into a document.
Do NOT include commentary, explanation, or markdown fences. Just output the revised resume itself.
`;
}

// ----- POST /api/resume/reformatter -----
router.post("/resume/reformatter", requireAuth, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({
        success: false,
        message: "Supabase is not configured on the server.",
      });
    }

    if (!openai) {
      return res.status(500).json({
        success: false,
        message: "OpenAI API key is not configured on the server.",
      });
    }

    const { jobDescription, preferences, tone } = req.body || {};

    if (!jobDescription || !jobDescription.trim()) {
      return res.status(400).json({
        success: false,
        message: "Please provide the target job description.",
      });
    }

    const userId = req.session.user.id;

    // 1) Fetch resume_url for this user
    const { data: userRow, error: fetchErr } = await supabase
      .from("users")
      .select("id, resume_url, fullname, occupation")
      .eq("id", userId)
      .maybeSingle();

    if (fetchErr) {
      console.error("[reformatter] Supabase fetch error:", fetchErr);
      return res.status(500).json({
        success: false,
        message: "Failed to look up your account in the database.",
      });
    }

    if (!userRow || !userRow.resume_url) {
      return res.status(400).json({
        success: false,
        message:
          "No resume found for your account. Please upload a resume first in the Resume Uploader tab.",
      });
    }

    const resumeUrl = userRow.resume_url; // e.g. "/uploads/xyz.pdf"
    const localPath = path.join(
      __dirname,
      resumeUrl.replace(/^\//, "") // strip leading slash
    );

    if (!fs.existsSync(localPath)) {
      console.error("[reformatter] Resume file not found at:", localPath);
      return res.status(500).json({
        success: false,
        message:
          "We couldn't find your stored resume file. Please re-upload it in the Resume Uploader tab.",
      });
    }

    // 2) Extract text from resume file
    const resumeText = await extractTextFromResumeFile(localPath, resumeUrl);
    if (!resumeText || !resumeText.trim()) {
      return res.status(500).json({
        success: false,
        message:
          "We couldn't extract readable text from your resume. Try uploading a PDF or DOCX version.",
      });
    }

    // 3) Call OpenAI to reformat / tailor the resume
    const prompt = buildReformatterPrompt(
      resumeText.slice(0, 15000),
      jobDescription.trim(),
      preferences?.trim() || "",
      tone?.trim() || ""
    );

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You are an expert resume writer who restructures and rewrites resumes to target specific jobs.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const tailoredResume =
      completion.choices?.[0]?.message?.content ||
      "Sorry, I couldn't generate a revised resume.";

    // 4) Build a .docx file from the tailored resume
    //    We'll treat blank lines as paragraph breaks, and lines ending with ":" as headings.
    const lines = tailoredResume.split(/\r?\n/);
    const paragraphs = [];
    let currentLines = [];

    function flushParagraph() {
      if (!currentLines.length) return;
      const text = currentLines.join(" ").trim();
      if (!text) {
        currentLines = [];
        return;
      }

      // Heading heuristic: single short line ending in ":" or fully uppercase
      const isLikelyHeading =
        currentLines.length === 1 &&
        (/:\s*$/.test(text) || text === text.toUpperCase());

      if (isLikelyHeading) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: text.replace(/:\s*$/, ""),
                bold: true,
                size: 28, // ~14pt
              }),
            ],
            spacing: { after: 200 },
          })
        );
      } else {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text,
                size: 22, // ~11pt
              }),
            ],
            spacing: { after: 120 },
          })
        );
      }

      currentLines = [];
    }

    for (const line of lines) {
      if (!line.trim()) {
        flushParagraph();
      } else {
        currentLines.push(line.trim());
      }
    }
    flushParagraph();

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs.length
            ? paragraphs
            : [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: tailoredResume,
                      size: 22,
                    }),
                  ],
                }),
              ],
        },
      ],
    });

    const timestamp = Date.now();
    const tailoredFileName = `tailored_${userId}_${timestamp}.docx`;
    const tailoredPath = path.join(__dirname, "uploads", tailoredFileName);

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(tailoredPath, buffer);

    const downloadUrl = `/uploads/${tailoredFileName}`;

    return res.json({
      success: true,
      tailoredResume,
      downloadUrl,
    });
  } catch (err) {
    console.error("[reformatter] Unexpected error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while generating your tailored resume.",
    });
  }
});

module.exports = router;