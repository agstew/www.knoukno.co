async function loadPayPalCheckout() {
  const message = document.querySelector("#payment-message");
  const response = await fetch("/api/paypal/config", { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error("Could not load paid tiers.");
  }
  const config = await response.json();
  const tierList = document.querySelector("#tier-list");
  if (!config.tiers?.length) {
    message.textContent = "No paid tiers are configured yet.";
    return;
  }

  for (const [index, tier] of config.tiers.entries()) {
    const option = document.createElement("label");
    option.className = "tier-option";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "tierId";
    radio.value = tier.id;
    const requestedTierId = new URLSearchParams(window.location.search).get("tier");
    radio.checked = requestedTierId
      ? tier.id === requestedTierId
      : index === 0;
    option.classList.toggle("selected", radio.checked);
    radio.addEventListener("change", () => {
      for (const card of tierList.querySelectorAll(".tier-option")) {
        card.classList.toggle("selected", card.querySelector('input[name="tierId"]').checked);
      }
    });
    const details = document.createElement("span");
    details.className = "tier-details";
    const title = document.createElement("strong");
    title.textContent = tier.name;
    const description = document.createElement("span");
    description.textContent = tier.description;
    const price = document.createElement("span");
    price.className = "tier-price";
    price.textContent = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: tier.currency,
    }).format(Number(tier.amount));
    details.append(title, description, price);
    if (tier.features.length) {
      const features = document.createElement("ul");
      for (const feature of tier.features) {
        const item = document.createElement("li");
        item.textContent = feature;
        features.append(item);
      }
      details.append(features);
    }
    option.append(radio, details);
    tierList.append(option);
  }
  if (!tierList.querySelector('input[name="tierId"]:checked')) {
    tierList.querySelector('input[name="tierId"]').checked = true;
    tierList.querySelector(".tier-option").classList.add("selected");
  }

  if (!config.configured) {
    message.textContent = "Tier information is available, but PayPal checkout is not enabled.";
    return;
  }

  const script = document.createElement("script");
  script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.clientId)}&currency=${encodeURIComponent(config.currency)}&intent=capture`;
  script.onload = () => {
    window.paypal.Buttons({
      createOrder: async () => {
        const selectedTier = document.querySelector('input[name="tierId"]:checked');
        if (!selectedTier) {
          throw new Error("Choose a tier before continuing.");
        }
        const result = await apiRequest("/api/paypal/orders", {
          method: "POST",
          body: { tierId: selectedTier.value },
        });
        return result.id;
      },
      onApprove: async (data) => {
        try {
          await apiRequest("/api/paypal/capture", {
            method: "POST",
            body: { orderId: data.orderID },
          });
          message.textContent = "Payment completed.";
        } catch (error) {
          message.textContent = error.message;
          message.classList.add("message-error");
        }
      },
      onError: () => {
        message.textContent = "PayPal checkout could not be completed. Please try again.";
        message.classList.add("message-error");
      },
    }).render("#paypal-button-container");
  };
  script.onerror = () => {
    message.textContent = "Could not load PayPal checkout.";
    message.classList.add("message-error");
  };
  document.head.append(script);
}

loadPayPalCheckout().catch((error) => {
  const message = document.querySelector("#payment-message");
  message.textContent = error.message;
  message.classList.add("message-error");
});
