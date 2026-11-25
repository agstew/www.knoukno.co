import "dotenv/config";
import pg from "pg";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { createPostgresRepository, initializeDatabase } from "./repository/postgres.js";
import { createEmailService } from "./services/email.js";
import { createPaypalService } from "./services/paypal.js";

const config = loadConfig();
const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ...(config.DATABASE_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
});

await initializeDatabase(pool);

const app = createApp({
  repository: createPostgresRepository(pool),
  emailService: createEmailService({
    apiKey: config.RESEND_API_KEY,
    fromEmail: config.RESEND_FROM_EMAIL,
    publicAppUrl: config.PUBLIC_APP_URL,
  }),
  paypalService: createPaypalService({
    clientId: config.PAYPAL_CLIENT_ID,
    clientSecret: config.PAYPAL_CLIENT_SECRET,
    environment: config.PAYPAL_ENV,
    tiers: config.paypalTiers,
    currency: config.PAYPAL_CURRENCY,
  }),
  jwtSecret: config.JWT_SECRET,
  cookieSecure: config.cookieSecure,
});

const server = app.listen(config.PORT, () => {
  console.log(`Kno U Kno starter listening on port ${config.PORT}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(async (error) => {
    await pool.end();
    if (error) {
      console.error(`Shutdown failed: ${error.message}`);
      process.exitCode = 1;
    }
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
