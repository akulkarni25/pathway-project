const express = require("express");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

/** -------- Supabase Client -------- **/
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Supabase configuration missing. Please set SUPABASE_URL and SUPABASE_KEY."
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

/** -------- Auth middleware (same idea as your other routes) -------- **/
// ★ NEW
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Not logged in." });
  }
  next();
}

/** -------- Helpers: DB <-> API mapping -------- **/

function mapDbEventToApi(ev) {
  if (!ev) return null;
  return {
    id: ev.id,
    name: ev.name,
    startTime: ev.start_time || ev.startTime,
    notify: ev.notify,
    notes: ev.notes,
    userEmail: ev.user_email || ev.userEmail,
    notifiedOneDay:
      typeof ev.notified_one_day === "boolean"
        ? ev.notified_one_day
        : ev.notifiedOneDay || false,
    notifiedOneHour:
      typeof ev.notified_one_hour === "boolean"
        ? ev.notified_one_hour
        : ev.notifiedOneHour || false,
  };
}

/** -------- USER EMAIL (for the *logged-in* user) -------- **/
// ★ CHANGED: instead of “first row with email”, use the current user’s id
async function getCurrentUserEmail(userId) {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("email")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("Error querying Supabase users table:", error.message);
      return null;
    }

    if (!data || !data.email || !data.email.trim()) {
      return null;
    }

    return data.email.trim();
  } catch (err) {
    console.error("getCurrentUserEmail error:", err.message);
    return null;
  }
}

/** -------- EVENT STORAGE -------- **/

// Used by the CRON job to see all events for all users
async function loadAllEventsFromDb() {
  try {
    const { data, error } = await supabase.from("events").select("*");
    if (error) {
      console.error("Error loading events from Supabase:", error.message);
      return [];
    }
    return (data || []).map(mapDbEventToApi);
  } catch (err) {
    console.error("loadAllEventsFromDb error:", err.message);
    return [];
  }
}

// ★ NEW: load events for a specific user within a date range
async function loadEventsByDateRangeForUser(startIso, endIso, userEmail) {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .gte("start_time", startIso)
      .lt("start_time", endIso)
      .eq("user_email", userEmail) // ★ filter to this user only
      .order("start_time", { ascending: true });

    if (error) {
      console.error("Error loading events by date range:", error.message);
      return [];
    }

    return (data || []).map(mapDbEventToApi);
  } catch (err) {
    console.error("loadEventsByDateRangeForUser error:", err.message);
    return [];
  }
}

async function insertEventToDb(event) {
  try {
    const dbRow = {
      name: event.name,
      start_time: event.startTime,
      notify: event.notify,
      notes: event.notes,
      user_email: event.userEmail,
      notified_one_day: !!event.notifiedOneDay,
      notified_one_hour: !!event.notifiedOneHour,
    };

    const { data, error } = await supabase
      .from("events")
      .insert(dbRow)
      .select("*")
      .single();

    if (error) {
      console.error("Error inserting event into Supabase:", error.message);
      return null;
    }

    return mapDbEventToApi(data);
  } catch (err) {
    console.error("insertEventToDb error:", err.message);
    return null;
  }
}

// ★ CHANGED: delete only the current user’s event
async function deleteEventById(id, userEmail) {
  try {
    const { data, error } = await supabase
      .from("events")
      .delete()
      .eq("id", id)
      .eq("user_email", userEmail) // ★ ensure user owns it
      .select("id");

    if (error) {
      console.error("Error deleting event from Supabase:", error.message);
      return { success: false, notFound: false };
    }

    if (!data || data.length === 0) {
      return { success: false, notFound: true };
    }

    return { success: true, notFound: false };
  } catch (err) {
    console.error("deleteEventById error:", err.message);
    return { success: false, notFound: false };
  }
}

async function updateNotificationFlags(ev) {
  try {
    const payload = {
      notified_one_day: !!ev.notifiedOneDay,
      notified_one_hour: !!ev.notifiedOneHour,
    };

    const { error } = await supabase
      .from("events")
      .update(payload)
      .eq("id", ev.id);

    if (error) {
      console.error(
        `Error updating notification flags for event ${ev.id}:`,
        error.message
      );
    }
  } catch (err) {
    console.error(
      `updateNotificationFlags error for event ${ev.id}:`,
      err.message
    );
  }
}

/** -------- EMAIL TRANSPORT -------- **/
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT || 587),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendNotificationEmail(event, whenLabel) {
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const startDate = new Date(event.startTime);
  const formattedTime = startDate.toLocaleString("en-US", {
    dateStyle: "full",
    timeStyle: "short",
  });

  const mailOptions = {
    from,
    to: event.userEmail,
    subject: `Reminder (${whenLabel}): ${event.name}`,
    text:
      `This is a reminder for your event:\n\n` +
      `Event: ${event.name}\n` +
      `When: ${formattedTime}\n\n` +
      (event.notes ? `Notes:\n${event.notes}\n\n` : "") +
      `- Job Skill Builder Scheduler`,
  };

  await transporter.sendMail(mailOptions);
}

/** -------- CRON JOB -------- **/
cron.schedule("* * * * *", async () => {
  const now = new Date();

  try {
    const events = await loadAllEventsFromDb(); // all users
    const toUpdate = [];

    for (const ev of events) {
      if (!ev.notify) continue;

      const start = new Date(ev.startTime);
      const diffMs = start.getTime() - now.getTime();
      const diffMin = diffMs / (1000 * 60);

      if (!ev.notifiedOneDay && diffMin <= 1441 && diffMin >= 1439) {
        try {
          await sendNotificationEmail(ev, "1 day before");
          ev.notifiedOneDay = true;
          toUpdate.push(ev);
        } catch (e) {
          console.error("Error sending 1-day email:", e.message);
        }
      }

      if (!ev.notifiedOneHour && diffMin <= 61 && diffMin >= 59) {
        try {
          await sendNotificationEmail(ev, "1 hour before");
          ev.notifiedOneHour = true;
          toUpdate.push(ev);
        } catch (e) {
          console.error("Error sending 1-hour email:", e.message);
        }
      }
    }

    for (const ev of toUpdate) {
      await updateNotificationFlags(ev);
    }
  } catch (err) {
    console.error("Scheduler CRON error:", err.message);
  }
});

/** -------- ROUTES -------- **/

// POST /api/events
// ★ Protected: only logged-in user, email comes from that user
router.post("/events", requireAuth, async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: "Request body is missing." });
    }

    const { name, date, time, notify, notes } = req.body;

    const userId = req.session.user.id; // ★ from session
    const userEmail = await getCurrentUserEmail(userId);
    if (!userEmail) {
      return res.status(500).json({
        error:
          "Could not determine user email from Supabase users table for this account.",
      });
    }

    if (!name || !date || !time || typeof notify === "undefined") {
      return res.status(400).json({ error: "Missing required fields." });
    }

    if (name.length > 300) {
      return res
        .status(400)
        .json({ error: "Event name must be 300 characters or less." });
    }

    if (notes && notes.length > 2000) {
      return res
        .status(400)
        .json({ error: "Additional notes must be 2000 characters or less." });
    }

    const [monthStr, dayStr, yearStr] = date.split("/");
    const month = Number(monthStr) - 1;
    const day = Number(dayStr);
    const year = Number(yearStr);

    if (
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      !Number.isInteger(year)
    ) {
      return res.status(400).json({ error: "Invalid date format." });
    }

    let hours = 0;
    let minutes = 0;
    let timeString = time.trim().toUpperCase();

    if (timeString.includes("AM") || timeString.includes("PM")) {
      const meridian = timeString.endsWith("PM") ? "PM" : "AM";
      timeString = timeString.replace("AM", "").replace("PM", "").trim();
      const [hStr, mStr] = timeString.split(":");
      hours = Number(hStr);
      minutes = Number(mStr || "0");

      if (meridian === "PM" && hours !== 12) hours += 12;
      if (meridian === "AM" && hours === 12) hours = 0;
    } else {
      const [hStr, mStr] = timeString.split(":");
      hours = Number(hStr);
      minutes = Number(mStr || "0");
    }

    if (
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return res.status(400).json({ error: "Invalid time format." });
    }

    const startTimeDate = new Date(year, month, day, hours, minutes, 0, 0);
    const startTimeIso = startTimeDate.toISOString();

    const newEvent = {
      name,
      startTime: startTimeIso,
      notify: !!notify,
      notes: notes || "",
      userEmail, // ★ per-user
      notifiedOneDay: false,
      notifiedOneHour: false,
    };

    const saved = await insertEventToDb(newEvent);
    if (!saved) {
      return res.status(500).json({ error: "Failed to save event." });
    }

    return res.status(201).json(saved);
  } catch (err) {
    console.error("POST /api/events error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// GET /api/events?month=YYYY-MM
// ★ Protected + per-user filter
router.get("/events", requireAuth, async (req, res) => {
  try {
    const monthParam = req.query.month;
    if (!monthParam) {
      return res.status(400).json({ error: "month query parameter required." });
    }

    const [yearStr, monthStr] = monthParam.split("-");
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(monthIndex) ||
      monthIndex < 0 ||
      monthIndex > 11
    ) {
      return res.status(400).json({ error: "Invalid month format." });
    }

    const userId = req.session.user.id;
    const userEmail = await getCurrentUserEmail(userId);
    if (!userEmail) {
      return res.status(500).json({
        error:
          "Could not determine user email from Supabase users table for this account.",
      });
    }

    const monthStart = new Date(year, monthIndex, 1, 0, 0, 0, 0);
    const monthEnd = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);

    const events = await loadEventsByDateRangeForUser(
      monthStart.toISOString(),
      monthEnd.toISOString(),
      userEmail
    );

    return res.json(events);
  } catch (err) {
    console.error("GET /api/events error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// DELETE /api/events/:id
// ★ Protected + per-user delete
router.delete("/events/:id", requireAuth, async (req, res) => {
  try {
    const idParam = req.params.id;
    if (!idParam) {
      return res.status(400).json({ error: "Event id is required." });
    }

    const id = Number(idParam);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid event id." });
    }

    const userId = req.session.user.id;
    const userEmail = await getCurrentUserEmail(userId);
    if (!userEmail) {
      return res.status(500).json({
        error:
          "Could not determine user email from Supabase users table for this account.",
      });
    }

    const result = await deleteEventById(id, userEmail);
    if (result.notFound) {
      return res.status(404).json({ error: "Event not found." });
    }

    if (!result.success) {
      return res.status(500).json({ error: "Failed to delete event." });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("DELETE /api/events/:id error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
