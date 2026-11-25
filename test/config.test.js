import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://localhost/test",
  JWT_SECRET: "test-only-signing-secret-with-more-than-32-characters",
};

test("configuration normalizes currency and parses server-controlled tier definitions", () => {
  const config = loadConfig({ ...baseEnv, PAYPAL_CURRENCY: "usd" });
  assert.equal(config.PAYPAL_CURRENCY, "USD");
  assert.equal(config.paypalConfigured, false);
  assert.deepEqual(config.paypalTiers, []);

  const configured = loadConfig({
    ...baseEnv,
    PAYPAL_CURRENCY: "usd",
    PAYPAL_TIERS: JSON.stringify([{
      id: "starter",
      name: "Starter",
      amount: "9.9",
      features: ["Core access"],
    }]),
  });
  assert.equal(configured.paypalTiers[0].amount, "9.90");
  assert.equal(configured.PAYPAL_CURRENCY, "USD");
  assert.equal(configured.paypalConfigured, false);
});

test("production requires HTTPS and complete email/payment configuration", () => {
  assert.throws(() => loadConfig({
    ...baseEnv,
    NODE_ENV: "production",
    PUBLIC_APP_URL: "http://example.com",
    RESEND_API_KEY: "resend-key",
    RESEND_FROM_EMAIL: "noreply@example.com",
  }), /HTTPS/);
  assert.throws(() => loadConfig({
    ...baseEnv,
    PAYPAL_CLIENT_ID: "client-id",
  }), /PAYPAL_TIERS must be configured together/);
  assert.throws(() => loadConfig({
    ...baseEnv,
    PAYPAL_TIERS: "not json",
  }), /PAYPAL_TIERS must be valid JSON/);
});
