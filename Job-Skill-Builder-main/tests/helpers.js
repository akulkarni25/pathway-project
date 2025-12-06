require("dotenv").config({ path: ".env" });
const request = require("supertest");
const app = require("../server");

async function loginAsTestUser() {
  const agent = request.agent(app);

  await agent.post("/login").send({
    email: "testuser@example.com",
    password: "ValidPass123!"
  });

  return agent;
}

module.exports = { app, loginAsTestUser };