const path = require("path");
const fs = require("fs");
const { loginAsTestUser } = require("./helpers");
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function getUserByEmail(email) {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, skills, resume_url")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

describe("Resume Upload via /api/resume_upload (Requirement 3)", () => {
  let agent;
  const TEST_EMAIL = "testuser@example.com";

  beforeAll(async () => {
    agent = await loginAsTestUser();
  });

  test("TC-RESUME-01: Upload valid PDF → skills extracted + resume_url stored in users table", async () => {
    const filePath = path.join(__dirname, "fixtures", "resume_valid.pdf");
    expect(fs.existsSync(filePath)).toBe(true);

    const res = await agent
      .post("/api/resume_upload")
      .attach("resume", filePath);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message.toLowerCase()).toMatch(
      /skills extracted|resume saved|profile/
    );
    expect(res.body.resumeUrl || res.body.resume_url).toBeTruthy();

    const userRow = await getUserByEmail(TEST_EMAIL);

    expect(userRow).toBeTruthy();
    expect(userRow.resume_url).toBeTruthy();
    expect(userRow.resume_url).toMatch(/^\/uploads\//);

    expect(userRow.skills).toBeTruthy();
    expect(userRow.skills.length).toBeGreaterThan(5);
  });

  test("TC-RESUME-02: No file uploaded → 400 + 'No resume file uploaded.'", async () => {
    const res = await agent.post("/api/resume_upload");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message.toLowerCase()).toMatch(/no resume file uploaded/);
  });

  test("TC-RESUME-03: Upload JPG → error (no skills saved)", async () => {
    const filePath = path.join(__dirname, "fixtures", "resume_invalid.jpg");
    expect(fs.existsSync(filePath)).toBe(true);

    const res = await agent
      .post("/api/resume_upload")
      .attach("resume", filePath);

    expect([400, 500]).toContain(res.statusCode);
    expect(res.body.success).toBe(false);
    const userRow = await getUserByEmail(TEST_EMAIL);
  });
});