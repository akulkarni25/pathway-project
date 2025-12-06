const request = require("supertest");
const { app } = require("./helpers");

describe("Login & Authentication", () => {
  test("TC-LOGIN-01: Valid registered email + correct password → login successful", async () => {
    const res = await request(app)
      .post("/login")
      .send({
        email: "testuser@example.com",
        password: "ValidPass123!"
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message.toLowerCase()).toMatch(/login successful/);
  });

  test("TC-LOGIN-02: Valid email + incorrect password → error 'Incorrect password'", async () => {
    const res = await request(app)
      .post("/login")
      .send({
        email: "testuser@example.com",
        password: "WrongPass123!"
      });

    expect(res.statusCode).toBe(200);
    expect(res.text.toLowerCase()).toMatch(/incorrect password|invalid email or password/i);
  });

  test("TC-LOGIN-03: Unregistered email → error 'Invalid email or password'", async () => {
    const res = await request(app)
      .post("/login")
      .send({
        email: "not_exist@example.com",
        password: "Whatever"
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.message.toLowerCase()).toMatch(/invalid email or password/);
  });
});