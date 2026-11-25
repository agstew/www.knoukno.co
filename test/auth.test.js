import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";

const jwtSecret = "test-only-signing-secret-with-more-than-32-characters";

function createHarness({ paypalConfigured = false } = {}) {
  const users = new Map();
  const orders = new Map();
  const emails = [];
  let nextUserId = 1;
  const repository = {
    async createUser(input) {
      if ([...users.values()].some((user) => user.email === input.email)) {
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      }
      const user = {
        id: nextUserId++,
        name: input.name,
        email: input.email,
        password_hash: input.passwordHash,
        email_verified: false,
        token_version: 0,
        verification_token_hash: input.verificationTokenHash,
        verification_expires_at: input.verificationExpiresAt,
        password_reset_token_hash: null,
        password_reset_expires_at: null,
      };
      users.set(user.id, user);
      return user;
    },
    async findUserByEmail(email) {
      return [...users.values()].find((user) => user.email === email) ?? null;
    },
    async findUserById(id) {
      return users.get(Number(id)) ?? null;
    },
    async verifyEmail(tokenHash) {
      const user = [...users.values()].find((item) => item.verification_token_hash === tokenHash);
      if (!user || user.verification_expires_at <= new Date()) return false;
      user.email_verified = true;
      user.verification_token_hash = null;
      return true;
    },
    async setVerificationToken(userId, tokenHash, expiresAt) {
      const user = users.get(Number(userId));
      user.verification_token_hash = tokenHash;
      user.verification_expires_at = expiresAt;
    },
    async setPasswordResetToken(userId, tokenHash, expiresAt) {
      const user = users.get(Number(userId));
      user.password_reset_token_hash = tokenHash;
      user.password_reset_expires_at = expiresAt;
    },
    async resetPassword(tokenHash, passwordHash) {
      const user = [...users.values()].find((item) => item.password_reset_token_hash === tokenHash);
      if (!user || user.password_reset_expires_at <= new Date()) return false;
      user.password_hash = passwordHash;
      user.token_version += 1;
      user.password_reset_token_hash = null;
      return true;
    },
    async revokeSessions(userId) {
      users.get(Number(userId)).token_version += 1;
    },
    async createPaymentOrder(input) {
      const order = {
        user_id: input.userId,
        paypal_order_id: input.paypalOrderId,
        tier_id: input.tierId,
        tier_name: input.tierName,
        amount: input.amount,
        currency: input.currency,
        status: "PENDING",
      };
      orders.set(input.paypalOrderId, order);
      return order;
    },
    async findPaymentOrder({ userId, paypalOrderId }) {
      const order = orders.get(paypalOrderId);
      return order?.user_id === userId ? order : null;
    },
    async completePaymentOrder({ userId, paypalOrderId }) {
      const order = await this.findPaymentOrder({ userId, paypalOrderId });
      if (!order) return null;
      order.status = "COMPLETED";
      return order;
    },
  };
  const emailService = {
    async sendVerificationEmail(input) {
      emails.push({ type: "verify", ...input });
    },
    async sendPasswordResetEmail(input) {
      emails.push({ type: "reset", ...input });
    },
  };
  const paypalService = {
    isConfigured: paypalConfigured,
    settings: {
      clientId: "test-client",
      currency: "USD",
      tiers: [{
        id: "starter",
        name: "Starter",
        description: "Entry tier",
        amount: "9.99",
        currency: "USD",
        features: ["Core access"],
      }],
    },
    getTier(tierId) {
      return this.settings.tiers.find((tier) => tier.id === tierId) ?? null;
    },
    async createOrder({ userId, tierId }) {
      const tier = this.getTier(tierId);
      const id = randomBytes(8).toString("hex");
      return {
        id,
        tierId: tier.id,
        tierName: tier.name,
        amount: tier.amount,
        currency: tier.currency,
        userId,
      };
    },
    async captureOrder(orderId) {
      return {
        status: "COMPLETED",
        referenceId: "1",
        amount: "9.99",
        currency: "USD",
        orderId,
      };
    },
  };
  const app = createApp({ repository, emailService, paypalService, jwtSecret });
  return { app, repository, emails, users };
}

async function createAgent(app) {
  const agent = request.agent(app);
  const response = await agent.get("/login");
  const csrfCookie = response.headers["set-cookie"]
    .find((cookie) => cookie.startsWith("csrf_token="))
    .split(";")[0];
  const csrfToken = csrfCookie.slice("csrf_token=".length);
  return { agent, csrfToken };
}

test("registration, verification, login, and logout invalidate the JWT", async () => {
  const harness = createHarness();
  const { agent, csrfToken } = await createAgent(harness.app);

  const registration = await agent
    .post("/api/auth/register")
    .set("x-csrf-token", csrfToken)
    .send({ name: "Test User", email: "TEST@example.com", password: "a-very-long-test-password" });
  assert.equal(registration.status, 201);
  assert.doesNotMatch(JSON.stringify(registration.body), /token/i);
  assert.equal(harness.emails[0].email, "test@example.com");

  const unverifiedLogin = await agent
    .post("/api/auth/login")
    .set("x-csrf-token", csrfToken)
    .send({ email: "test@example.com", password: "a-very-long-test-password" });
  assert.equal(unverifiedLogin.status, 403);

  const verification = await agent
    .post("/api/auth/verify-email")
    .set("x-csrf-token", csrfToken)
    .send({ token: harness.emails[0].token });
  assert.equal(verification.status, 200);

  const login = await agent
    .post("/api/auth/login")
    .set("x-csrf-token", csrfToken)
    .send({ email: "test@example.com", password: "a-very-long-test-password" });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.emailVerified, true);

  const me = await agent.get("/api/auth/me");
  assert.equal(me.status, 200);

  const logout = await agent.post("/api/auth/logout").set("x-csrf-token", csrfToken);
  assert.equal(logout.status, 204);
  assert.equal((await agent.get("/api/auth/me")).status, 401);
});

test("unsafe API requests require a CSRF header", async () => {
  const { app } = createHarness();
  const { agent } = await createAgent(app);
  const response = await agent
    .post("/api/auth/register")
    .send({ name: "Test User", email: "test@example.com", password: "a-very-long-test-password" });
  assert.equal(response.status, 403);
});

test("password reset is one-time and invalidates existing JWTs", async () => {
  const harness = createHarness();
  const { agent, csrfToken } = await createAgent(harness.app);
  const originalPassword = "a-very-long-test-password";
  const newPassword = "another-long-test-password";

  await agent.post("/api/auth/register")
    .set("x-csrf-token", csrfToken)
    .send({ name: "Test User", email: "test@example.com", password: originalPassword });
  await agent.post("/api/auth/verify-email")
    .set("x-csrf-token", csrfToken)
    .send({ token: harness.emails[0].token });
  await agent.post("/api/auth/login")
    .set("x-csrf-token", csrfToken)
    .send({ email: "test@example.com", password: originalPassword });

  const forgot = await agent.post("/api/auth/forgot-password")
    .set("x-csrf-token", csrfToken)
    .send({ email: "test@example.com" });
  assert.equal(forgot.status, 202);
  const reset = await agent.post("/api/auth/reset-password")
    .set("x-csrf-token", csrfToken)
    .send({ token: harness.emails[1].token, password: newPassword });
  assert.equal(reset.status, 200);
  assert.equal((await agent.get("/api/auth/me")).status, 401);

  const oldLogin = await agent.post("/api/auth/login")
    .set("x-csrf-token", csrfToken)
    .send({ email: "test@example.com", password: originalPassword });
  assert.equal(oldLogin.status, 401);
  const newLogin = await agent.post("/api/auth/login")
    .set("x-csrf-token", csrfToken)
    .send({ email: "test@example.com", password: newPassword });
  assert.equal(newLogin.status, 200);

  const replay = await agent.post("/api/auth/reset-password")
    .set("x-csrf-token", csrfToken)
    .send({ token: harness.emails[1].token, password: originalPassword });
  assert.equal(replay.status, 400);
});

test("public pages load and malformed JSON is reported as a client error", async () => {
  const { app } = createHarness();
  for (const route of ["/", "/login", "/register", "/forgot-password", "/verify-email", "/reset-password", "/dashboard"]) {
    const response = await request(app).get(route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers["content-type"], /text\/html/);
  }
  const malformed = await request(app)
    .post("/api/auth/login")
    .set("content-type", "application/json")
    .send("{");
  assert.equal(malformed.status, 400);
});

test("PayPal capture is restricted to the signed-in user and server-priced order", async () => {
  const harness = createHarness({ paypalConfigured: true });
  const { agent, csrfToken } = await createAgent(harness.app);

  await agent.post("/api/auth/register")
    .set("x-csrf-token", csrfToken)
    .send({ name: "Test User", email: "test@example.com", password: "a-very-long-test-password" });
  await agent.post("/api/auth/verify-email")
    .set("x-csrf-token", csrfToken)
    .send({ token: harness.emails[0].token });
  await agent.post("/api/auth/login")
    .set("x-csrf-token", csrfToken)
    .send({ email: "test@example.com", password: "a-very-long-test-password" });

  const config = await agent.get("/api/paypal/config");
  assert.equal(config.body.configured, true);
  assert.deepEqual(config.body.tiers.map((tier) => tier.id), ["starter"]);
  const rejected = await agent.post("/api/paypal/orders")
    .set("x-csrf-token", csrfToken)
    .send({ tierId: "unknown" });
  assert.equal(rejected.status, 400);
  const untrustedPrice = await agent.post("/api/paypal/orders")
    .set("x-csrf-token", csrfToken)
    .send({ tierId: "starter", amount: "0.01" });
  assert.equal(untrustedPrice.status, 400);
  const created = await agent.post("/api/paypal/orders")
    .set("x-csrf-token", csrfToken)
    .send({ tierId: "starter" });
  assert.equal(created.status, 201);
  const storedOrder = await harness.repository.findPaymentOrder({
    userId: 1,
    paypalOrderId: created.body.id,
  });
  assert.equal(storedOrder.tier_id, "starter");
  assert.equal(storedOrder.amount, "9.99");
  const captured = await agent.post("/api/paypal/capture")
    .set("x-csrf-token", csrfToken)
    .send({ orderId: created.body.id });
  assert.equal(captured.status, 200);
  assert.equal(captured.body.status, "COMPLETED");
});
