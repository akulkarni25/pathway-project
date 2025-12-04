require("dotenv").config();

const express = require("express");
const OpenAI = require("openai");

const router = express.Router();

// ---------- OpenAI client ----------
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ---------- Helper: build prompt for project ideas ----------
function buildProjectIdeasPrompt(goals, level, languages, timePerWeek) {
    const levelText = level ? `The user identifies as ${level} level.` : "";
    const langsText = languages
        ? `The user prefers to work in: ${languages}.`
        : "You may suggest common languages like Python, JavaScript, or Java if appropriate.";
    const timeText = timePerWeek
        ? `They have about ${timePerWeek} hours per week to practice.`
        : "Assume they have a few hours per week to practice.";

    return `
The user wants help improving their coding skills.

User goals / areas to improve:
"${goals}"

${levelText}
${langsText}
${timeText}

Your job:
- Suggest 5–7 concrete coding project ideas OR problem sets.
- Tailor them to the user’s level and goals.
- Prefer projects that can be built progressively (MVP first, then extensions).
- Focus on depth of learning, not just “build a to-do app”.

For each idea, include:
1. A short, descriptive TITLE.
2. One-paragraph DESCRIPTION.
3. DIFFICULTY (Beginner/Intermediate/Advanced).
4. KEY SKILLS practiced (e.g., recursion, dynamic programming, REST APIs, React, SQL, data structures).
5. OPTIONAL EXTENSIONS to make it harder once the basics work.

Respond in clear plain text as a numbered list of ideas.
`;
}

// ---------- POST /api/learning/recommend-projects ----------
router.post("/learning/recommend-projects", async (req, res) => {
    try {
        const { goals, level, languages, timePerWeek } = req.body || {};

        if (!goals || !goals.trim()) {
            return res
                .status(400)
                .json({ error: "Please describe what you want to improve." });
        }

        const prompt = buildProjectIdeasPrompt(
            goals.trim(),
            level?.trim(),
            languages?.trim(),
            timePerWeek?.trim()
        );

        const completion = await openai.chat.completions.create({
            model: "gpt-4.1-mini", // or "gpt-4o-mini" if you prefer
            messages: [
                {
                    role: "system",
                    content:
                        "You are a senior software engineer and mentor. You design focused, realistic coding projects to improve specific skills.",
                },
                { role: "user", content: prompt },
            ],
            temperature: 0.7,
        });

        const content =
            completion.choices?.[0]?.message?.content ||
            "Sorry, I couldn't generate ideas right now.";

        res.json({ ideas: content });
    } catch (err) {
        console.error("Error in /api/learning/recommend-projects:", err);
        if (err.status === 429 || err.code === "insufficient_quota") {
            return res.status(429).json({
                error:
                    "Your AI usage quota has been exceeded. Please try again later or adjust billing.",
            });
        }
        res.status(500).json({
            error: "Server error while generating project ideas.",
        });
    }
});

module.exports = router;