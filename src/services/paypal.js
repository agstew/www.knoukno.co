const PAYPAL_APIS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  production: "https://api-m.paypal.com",
};

export function createPaypalService({ clientId, clientSecret, environment, tiers = [], currency }) {
  const configured = Boolean(clientId && clientSecret && tiers.length);
  const baseUrl = PAYPAL_APIS[environment];
  const catalog = tiers.map((tier) => ({ ...tier, currency }));

  async function accessToken() {
    if (!configured) {
      throw new Error("PayPal checkout is not configured");
    }
    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) {
      throw new Error("Could not authenticate with PayPal");
    }
    return result.access_token;
  }

  async function paypalRequest(path, { method = "GET", body } = {}) {
    const token = await accessToken();
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(`PayPal request failed with status ${response.status}`);
    }
    return result;
  }

  return {
    isConfigured: configured,
    settings: {
      ...(configured ? { clientId } : {}),
      currency,
      tiers: catalog,
    },
    getTier(tierId) {
      return catalog.find((tier) => tier.id === tierId) ?? null;
    },
    async createOrder({ userId, tierId }) {
      const tier = catalog.find((item) => item.id === tierId);
      if (!tier) {
        throw new Error("The selected tier is not available");
      }
      const order = await paypalRequest("/v2/checkout/orders", {
        method: "POST",
        body: {
          intent: "CAPTURE",
          purchase_units: [{
            reference_id: String(userId),
            description: tier.name,
            amount: {
              currency_code: tier.currency,
              value: tier.amount,
            },
          }],
        },
      });
      if (!order.id) {
        throw new Error("PayPal did not return an order ID");
      }
      return {
        id: order.id,
        tierId: tier.id,
        tierName: tier.name,
        amount: tier.amount,
        currency: tier.currency,
      };
    },
    async captureOrder(orderId) {
      const result = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: "POST",
      });
      const unit = result.purchase_units?.[0];
      const capture = unit?.payments?.captures?.[0];
      return {
        status: result.status,
        referenceId: unit?.reference_id,
        amount: capture?.amount?.value,
        currency: capture?.amount?.currency_code,
      };
    },
  };
}
