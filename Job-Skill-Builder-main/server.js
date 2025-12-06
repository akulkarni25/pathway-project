// ---------- ENV + IMPORTS ----------
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const OpenAI = require("openai");

const schedulerRoutes = require("./schedulerRoutes");
const elevatorRoutes = require("./elevatorRoutes");
const codingCoachRoutes = require("./codingCoachRoutes");
const resumeUploadRoutes = require("./resumeUploadRoutes");
const resumeReformatterRoutes = require("./resumeReformatterRoutes");

const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const app = express();

// ---------- SUPABASE CONFIG ----------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("🔗 Supabase Dashboard:", supabaseUrl);

// ---------- UPLOADS (MULTER) ----------
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

// ---------- MIDDLEWARE ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: process.env.SESSION_SECRET || "dev_secret_change_me",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24, // 1 day
        },
    })
);

// Static files (public) + uploads
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadsDir));

// ---------- AUTH MIDDLEWARE ----------
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect("/login.html");
    }
    next();
}

// ---------- API ROUTES (scheduler + elevator) ----------
app.use("/api", schedulerRoutes);
app.use("/api", elevatorRoutes);
app.use("/api", codingCoachRoutes);
app.use("/api", resumeUploadRoutes);
app.use("/api", resumeReformatterRoutes);

// ---------- BASIC PAGES ----------
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Make /register redirect to the personal step (for convenience)
app.get("/register", (req, res) => {
    res.redirect("/register-personal");
});

// Step 1 – personal info
app.get("/register-personal", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "register_personal_information.html")
    );
});

// Step 2 – address
app.get("/register-address", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "register_address.html"));
});

// Step 3 – college / education
app.get("/register-college", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "register_college.html"));
});

// Dashboard + Jobs + Elevator + Scheduler + Resume (protected)
app.get("/dashboard", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/jobs", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "jobs.html"));
});

app.get("/elevator", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "elevator.html"));
});

app.get("/scheduler", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "scheduler.html"));
});

// Resume upload page
app.get("/resume_upload", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "resume_upload.html"));
});
// AI Resume page
app.get("/resume", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "resume.html"));
});
// Skills Coach page
app.get("/skills", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "skills.html"));
});

// ---------- API: CURRENT USER (NO requireAuth HERE) ----------
app.get("/api/me", async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(200).json({
                success: false,
                message: "Not logged in",
            });
        }

        const userId = req.session.user.id;

        const { data, error } = await supabase
            .from("users")
            .select(
                "id, firstname, lastname, fullname, birthday, email, occupation, street, city, state, zip, college, certificate, graddate, resume_url, created_at"
            )
            .eq("id", userId)
            .maybeSingle();

        if (error) {
            console.error("Supabase /api/me error:", error);
            return res.status(500).json({
                success: false,
                message: "Database error",
            });
        }

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        res.json({ success: true, user: data });
    } catch (err) {
        console.error("/api/me unexpected error:", err);
        res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
});

// ---------- API: REGISTER ----------
app.post("/register", async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            birthday,
            email,
            occupation,
            password,
            street,
            city,
            state,
            zip,
            college,
            certificate,
            gradDate,
        } = req.body;

        if (
            !firstName ||
            !lastName ||
            !birthday ||
            !email ||
            !occupation ||
            !password
        ) {
            return res.json({
                success: false,
                message: "Please fill in all required fields.",
            });
        }

        const { data: existing, error: existingErr } = await supabase
            .from("users")
            .select("id")
            .eq("email", email)
            .maybeSingle();

        if (existingErr) {
            console.error("Supabase existingErr:", existingErr);
            return res.json({
                success: false,
                message: "Database error. Try again.",
            });
        }

        if (existing) {
            return res.json({
                success: false,
                message: "Email already exists.",
            });
        }

        const hashed = await bcrypt.hash(password, 10);

        const { error: insertErr } = await supabase
            .from("users")
            .insert({
                firstname: firstName,
                lastname: lastName,
                fullname: `${firstName} ${lastName}`,
                birthday,
                email,
                occupation,
                password_hash: hashed,
                street,
                city,
                state,
                zip,
                college,
                certificate,
                graddate: gradDate,
            })
            .select()
            .single();

        if (insertErr) {
            console.error("Supabase insertErr:", insertErr);
            return res.json({
                success: false,
                message: "Server error. Try again.",
            });
        }

        return res.json({
            success: true,
            message: "Registration successful. You can now log in.",
        });
    } catch (err) {
        console.error("/register unexpected error:", err);
        return res.json({
            success: false,
            message: "Server error. Try again.",
        });
    }
});

// ---------- API: LOGIN ----------
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.json({
                success: false,
                message: "Please enter email and password.",
            });
        }

        const { data: user, error } = await supabase
            .from("users")
            .select("id, fullname, password_hash")
            .eq("email", email)
            .maybeSingle();

        if (error) {
            console.error("Supabase login error:", error);
            return res.json({
                success: false,
                message: "Database error. Try again.",
            });
        }

        if (!user) {
            return res.json({
                success: false,
                message: "Invalid email or password.",
            });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.json({
                success: false,
                message: "Invalid email or password.",
            });
        }

        req.session.user = {
            id: user.id,
            fullname: user.fullname,
            email,
        };

        return res.json({
            success: true,
            message: "Login successful.",
        });
    } catch (err) {
        console.error("/login unexpected error:", err);
        return res.json({
            success: false,
            message: "Server error. Try again.",
        });
    }
});

// ---------- API: LOGOUT ----------
app.post("/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true, message: "Logged out." });
    });
});

// ---------- FILE UPLOAD ENDPOINTS (Dashboard) ----------

app.get("/resume_reformatter", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "resume_reformatter.html"));
});

// --------- API: NETWORKING (Ticketmaster Discovery) ----------
const TM_API_KEY = process.env.TICKETMASTER_API_KEY;

function haversineMiles(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 3958.8; // miles

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.get("/api/networking-events", async (req, res) => {
    if (!TM_API_KEY) {
        return res
            .status(500)
            .json({ error: "TICKETMASTER_API_KEY is not set on the server" });
    }

    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const maxDistance = parseInt(req.query.maxDistance || "25", 10);   // miles
    const maxDaysAhead = parseInt(req.query.maxDaysAhead || "7", 10);  // days

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res
            .status(400)
            .json({ error: "lat and lng query params are required" });
    }

    const now = new Date();
    const end = new Date(now.getTime() + maxDaysAhead * 86400000);

    function toTicketmasterDate(date) {
        return date.toISOString().replace(/\.\d{3}Z$/, "Z");
    }

    const startIso = toTicketmasterDate(now);
    const endIso = toTicketmasterDate(end);


    const params = new URLSearchParams({
        apikey: TM_API_KEY,
        latlong: `${lat},${lng}`,
        radius: String(maxDistance),
        unit: "miles",
        sort: "date,asc",
        startDateTime: startIso,
        endDateTime: endIso,
        size: "50",

        // Networking-specific filters
        keyword: "",
    });

    const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`;

    try {
        const resp = await fetch(url);
        const text = await resp.text();

        if (!resp.ok) {
            console.error("Ticketmaster API error:", resp.status, text);
            return res
                .status(500)
                .json({ error: "Ticketmaster API error", status: resp.status });
        }

        const json = JSON.parse(text);
        const eventsRaw = json._embedded?.events || [];

        const events = eventsRaw.map((ev) => {
            const venue = ev._embedded?.venues?.[0];

            return {
                id: ev.id,
                title: ev.name,
                description: ev.info || ev.pleaseNote || "",
                startDate:
                    ev.dates?.start?.dateTime || ev.dates?.start?.localDate,
                locationName: venue?.name || "",
                address: [
                    venue?.address?.line1,
                    venue?.city?.name,
                    venue?.state?.stateCode,
                    venue?.postalCode,
                ]
                    .filter(Boolean)
                    .join(", "),
                distanceMiles:
                    typeof ev.distance === "number" ? ev.distance : null,
                url: ev.url,
            };
        });

        res.json(events);
    } catch (err) {
        console.error("Error contacting Ticketmaster:", err);
        res.status(500).json({ error: "Failed to fetch events" });
    }
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`✅ Server running on http://localhost:${PORT}`);
    });
}
module.exports = app;