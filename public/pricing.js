function formatPrice(amount, currency) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(Number(amount));
}

async function loadPricing() {
  const message = document.querySelector("#pricing-message");
  const tierList = document.querySelector("#public-tier-list");
  const [configResponse, authResponse] = await Promise.all([
    fetch("/api/paypal/config", { credentials: "same-origin" }),
    fetch("/api/auth/me", { credentials: "same-origin" }),
  ]);
  if (!configResponse.ok) {
    throw new Error("Could not load available tiers.");
  }
  const config = await configResponse.json();
  const isLoggedIn = authResponse.ok;
  tierList.replaceChildren();

  if (!config.tiers?.length) {
    message.textContent = "Paid tiers are not available yet.";
    return;
  }

  message.textContent = config.configured
    ? "Each purchase includes one tier and is charged once."
    : "Tier preview only—PayPal checkout is not configured.";
  for (const tier of config.tiers) {
    const card = document.createElement("article");
    card.className = "public-tier";
    const name = document.createElement("h3");
    name.textContent = tier.name;
    const description = document.createElement("p");
    description.textContent = tier.description;
    const price = document.createElement("strong");
    price.className = "tier-price";
    price.textContent = formatPrice(tier.amount, tier.currency);
    const action = document.createElement(config.configured ? "a" : "span");
    action.className = config.configured ? "button" : "tier-availability";
    if (config.configured) {
      action.href = isLoggedIn
        ? `/dashboard?tier=${encodeURIComponent(tier.id)}`
        : "/register";
      action.textContent = isLoggedIn ? "Choose this tier" : "Create account to purchase";
    } else {
      action.textContent = "Checkout coming soon";
    }
    card.append(name, description, price);
    if (tier.features.length) {
      const features = document.createElement("ul");
      for (const feature of tier.features) {
        const item = document.createElement("li");
        item.textContent = feature;
        features.append(item);
      }
      card.append(features);
    }
    card.append(action);
    tierList.append(card);
  }
}

loadPricing().catch((error) => {
  const message = document.querySelector("#pricing-message");
  message.textContent = error.message;
  message.classList.add("message-error");
});
