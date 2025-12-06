const express = require("express");
const request = require("supertest");

const mockSupabase = {
  from: jest.fn(),
};

const mockSendMail = jest.fn();
const scheduledJobs = [];

// ---- MODULE MOCKS ---- //
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabase,
}));

jest.mock("nodemailer", () => ({
  createTransport: () => ({
    sendMail: mockSendMail,
  }),
}));

jest.mock("node-cron", () => ({
  schedule: (expr, fn) => {
    scheduledJobs.push(fn);
    return { stop: jest.fn() };
  },
}));

const schedulerRoutes = require("../schedulerRoutes");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", schedulerRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.from.mockReset();
});

test("POST /api/events → creates event", async () => {
  mockSupabase.from.mockImplementation((table) => {
    if (table === "users") {
      return {
        select: () => ({
          not: () => ({
            limit: () =>
              Promise.resolve({
                data: [{ email: "test@example.com" }],
                error: null,
              }),
          }),
        }),
      };
    }

    if (table === "events") {
      return {
        insert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  id: 1,
                  name: "Test Event",
                  start_time: new Date().toISOString(),
                  notify: true,
                  notes: "",
                  user_email: "test@example.com",
                  notified_one_day: false,
                  notified_one_hour: false,
                },
                error: null,
              }),
          }),
        }),
      };
    }
  });

  const res = await request(makeApp())
    .post("/api/events")
    .send({
      name: "Test Event",
      date: "12/25/2025",
      time: "10:00 AM",
      notify: true,
    });

  expect(res.statusCode).toBe(201);
  expect(res.body.name).toBe("Test Event");
  expect(res.body.userEmail).toBe("test@example.com");
});

test("GET /api/events → returns monthly events", async () => {
  mockSupabase.from.mockImplementation((table) => {
    if (table === "events") {
      return {
        select: () => ({
          gte: () => ({
            lt: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      id: 1,
                      name: "Monthly Event",
                      start_time: "2025-01-10T10:00:00Z",
                      notify: true,
                      notes: "",
                      user_email: "a@test.com",
                      notified_one_day: false,
                      notified_one_hour: false,
                    },
                  ],
                  error: null,
                }),
            }),
          }),
        }),
      };
    }
  });

  const res = await request(makeApp()).get(
    "/api/events?month=2025-01"
  );

  expect(res.statusCode).toBe(200);
  expect(res.body.length).toBe(1);
  expect(res.body[0].name).toBe("Monthly Event");
});

test("DELETE /api/events/:id → deletes event", async () => {
  mockSupabase.from.mockImplementation((table) => {
    if (table === "events") {
      return {
        delete: () => ({
          eq: () => ({
            select: () =>
              Promise.resolve({
                data: [{ id: 99 }],
                error: null,
              }),
          }),
        }),
      };
    }
  });

  const res = await request(makeApp()).delete(
    "/api/events/99"
  );

  expect(res.statusCode).toBe(200);
  expect(res.body.success).toBe(true);
});

test("CRON → sends 1-hour email reminder", async () => {
  const now = new Date();
  const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

  mockSupabase.from.mockImplementation((table) => {
    if (table === "events") {
      return {
        select: () =>
          Promise.resolve({
            data: [
              {
                id: 1,
                name: "Cron Test",
                start_time: oneHourLater.toISOString(),
                notify: true,
                notes: "",
                user_email: "cron@test.com",
                notified_one_day: false,
                notified_one_hour: false,
              },
            ],
            error: null,
          }),

        update: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      };
    }
  });

  const cronJob = scheduledJobs[0];
  await cronJob();

  expect(mockSendMail).toHaveBeenCalledTimes(1);
  expect(mockSendMail.mock.calls[0][0].to)
    .toBe("cron@test.com");
});