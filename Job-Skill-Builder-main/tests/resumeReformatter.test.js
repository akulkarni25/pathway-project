process.env.SUPABASE_URL = "http://example.com";
process.env.SUPABASE_KEY = "test-service-key";
process.env.OPENAI_API_KEY = "test-openai-key";

const express = require("express");
const request = require("supertest");

jest.mock("@supabase/supabase-js");
jest.mock("openai");
jest.mock("pdf-parse");
jest.mock("mammoth");
jest.mock("docx");
jest.mock("fs");

const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const fs = require("fs");
const docx = require("docx");

const mockSupabase = { from: jest.fn() };
createClient.mockReturnValue(mockSupabase);

const mockChatCompletionsCreate = jest.fn().mockResolvedValue({
  choices: [{ message: { content: "TAILORED RESUME CONTENT" } }],
});
OpenAI.mockImplementation(() => ({
  chat: {
    completions: {
      create: mockChatCompletionsCreate,
    },
  },
}));

pdfParse.mockResolvedValue({ text: "ORIGINAL RESUME TEXT" });

mammoth.extractRawText = jest.fn().mockResolvedValue({ value: "DOCX TEXT" });

const mockToBuffer = jest.fn().mockResolvedValue(Buffer.from("DOCX_FILE"));
docx.Document.mockImplementation(() => ({}));
docx.Paragraph.mockImplementation(() => ({}));
docx.TextRun.mockImplementation(() => ({}));
docx.Packer.toBuffer = mockToBuffer;

let writtenFiles = {};
fs.existsSync.mockImplementation(() => true);
fs.readFileSync.mockImplementation(() => Buffer.from("dummy resume file"));
fs.writeFileSync.mockImplementation((filePath, buffer) => {
  writtenFiles[filePath] = buffer;
});

const resumeRoutes = require("../resumeReformatterRoutes");

function makeApp(userId = 1) {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.session = { user: { id: userId } };
    next();
  });

  app.use("/api", resumeRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.from.mockReset();
  writtenFiles = {};
});

test("POST /api/resume/reformatter – successful tailoring", async () => {
  mockSupabase.from.mockImplementation((table) => {
    if (table === "users") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: 1,
                  resume_url: "/uploads/resume.pdf",
                  fullname: "Test User",
                  occupation: "Engineer",
                },
                error: null,
              }),
          }),
        }),
      };
    }
    throw new Error("Unexpected table: " + table);
  });

  const app = makeApp(1);

  const res = await request(app)
    .post("/api/resume/reformatter")
    .send({
      jobDescription: "We need a great software engineer.",
      preferences: "Highlight Python and backend experience.",
      tone: "Professional but enthusiastic",
    });

  expect(res.statusCode).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.tailoredResume).toBe("TAILORED RESUME CONTENT");
  expect(typeof res.body.downloadUrl).toBe("string");
  expect(res.body.downloadUrl).toMatch(/^\/uploads\/tailored_/);

  expect(pdfParse).toHaveBeenCalledTimes(1);
  expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
  expect(mockToBuffer).toHaveBeenCalledTimes(1);
  expect(Object.keys(writtenFiles).length).toBe(1);
});

test("POST /api/resume/reformatter – missing jobDescription returns 400", async () => {
  mockSupabase.from.mockImplementation((table) => {
    if (table === "users") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: 1,
                  resume_url: "/uploads/resume.pdf",
                },
                error: null,
              }),
          }),
        }),
      };
    }
    throw new Error("Unexpected table: " + table);
  });

  const app = makeApp(1);

  const res = await request(app)
    .post("/api/resume/reformatter")
    .send({
      preferences: "Any",
      tone: "Any",
    });

  expect(res.statusCode).toBe(400);
  expect(res.body.success).toBe(false);
  expect(res.body.message).toMatch(/target job description/i);

  expect(mockChatCompletionsCreate).not.toHaveBeenCalled();
  expect(mockToBuffer).not.toHaveBeenCalled();
});

test("POST /api/resume/reformatter – no resume_url for user returns 400", async () => {
  mockSupabase.from.mockImplementation((table) => {
    if (table === "users") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: 1,
                  resume_url: null,
                },
                error: null,
              }),
          }),
        }),
      };
    }
    throw new Error("Unexpected table: " + table);
  });

  const app = makeApp(1);

  const res = await request(app)
    .post("/api/resume/reformatter")
    .send({
      jobDescription: "Some job",
      preferences: "",
      tone: "",
    });

  expect(res.statusCode).toBe(400);
  expect(res.body.success).toBe(false);
  expect(res.body.message).toMatch(/upload a resume first/i);

  expect(pdfParse).not.toHaveBeenCalled();
  expect(mockChatCompletionsCreate).not.toHaveBeenCalled();
  expect(mockToBuffer).not.toHaveBeenCalled();
});
