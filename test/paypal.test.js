import assert from "node:assert/strict";
import { test } from "node:test";
import { createPaypalService } from "../src/services/paypal.js";

test("PayPal order amount and label come from the selected server tier", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      async json() {
        return requests.length === 1
          ? { access_token: "test-access-token" }
          : { id: "PAYPAL-ORDER-1" };
      },
    };
  };
  try {
    const paypal = createPaypalService({
      clientId: "test-client",
      clientSecret: "test-secret",
      environment: "sandbox",
      currency: "USD",
      tiers: [{
        id: "growth",
        name: "Growth",
        description: "Growth tier",
        amount: "29.99",
        features: ["More questions"],
      }],
    });

    assert.equal(paypal.isConfigured, true);
    const order = await paypal.createOrder({ userId: 7, tierId: "growth" });
    assert.deepEqual(order, {
      id: "PAYPAL-ORDER-1",
      tierId: "growth",
      tierName: "Growth",
      amount: "29.99",
      currency: "USD",
    });
    const paypalPayload = JSON.parse(requests[1].options.body);
    assert.equal(paypalPayload.purchase_units[0].amount.value, "29.99");
    assert.equal(paypalPayload.purchase_units[0].description, "Growth");
    assert.equal(paypalPayload.purchase_units[0].reference_id, "7");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
