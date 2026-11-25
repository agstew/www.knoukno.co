import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  RESEND_API_KEY: z.string().optional().default(""),
  RESEND_FROM_EMAIL: z.string().optional().default(""),
  PAYPAL_CLIENT_ID: z.string().optional().default(""),
  PAYPAL_CLIENT_SECRET: z.string().optional().default(""),
  PAYPAL_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  PAYPAL_TIERS: z.string().optional().default(""),
  PAYPAL_CURRENCY: z.string().regex(/^[A-Za-z]{3}$/).transform((currency) => currency.toUpperCase()).default("USD"),
});

const tierSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).default(""),
  amount: z.string()
    .max(12)
    .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/)
    .transform((amount) => Number(amount).toFixed(2))
    .refine((amount) => Number(amount) > 0),
  features: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
}).strict();

export function loadConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const config = parsed.data;
  if (config.NODE_ENV === "production" && new URL(config.PUBLIC_APP_URL).protocol !== "https:") {
    throw new Error("PUBLIC_APP_URL must use HTTPS in production");
  }
  let tiers = [];
  if (config.PAYPAL_TIERS.trim()) {
    if (config.PAYPAL_TIERS.length > 32_000) {
      throw new Error("PAYPAL_TIERS must not exceed 32 KB");
    }
    let rawTiers;
    try {
      rawTiers = JSON.parse(config.PAYPAL_TIERS);
    } catch {
      throw new Error("PAYPAL_TIERS must be valid JSON");
    }
    const parsedTiers = z.array(tierSchema).min(1).max(20).safeParse(rawTiers);
    if (!parsedTiers.success) {
      throw new Error(`Invalid PAYPAL_TIERS: ${parsedTiers.error.issues.map((issue) => issue.message).join("; ")}`);
    }
    tiers = parsedTiers.data;
    if (new Set(tiers.map((tier) => tier.id)).size !== tiers.length) {
      throw new Error("PAYPAL_TIERS ids must be unique");
    }
  }
  const hasPaypalCredentials = Boolean(config.PAYPAL_CLIENT_ID || config.PAYPAL_CLIENT_SECRET);
  if (hasPaypalCredentials && (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_CLIENT_SECRET || !tiers.length)) {
    throw new Error("PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_TIERS must be configured together");
  }
  if (config.NODE_ENV === "production" && (!config.RESEND_API_KEY || !config.RESEND_FROM_EMAIL)) {
    throw new Error("RESEND_API_KEY and RESEND_FROM_EMAIL are required in production");
  }

  return {
    ...config,
    paypalTiers: tiers,
    paypalConfigured: Boolean(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET && tiers.length),
    cookieSecure: config.NODE_ENV === "production",
  };
}
