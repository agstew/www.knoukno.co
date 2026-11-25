import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const schemaPath = new URL("../../db/schema.sql", import.meta.url);

export async function initializeDatabase(pool) {
  await pool.query(await readFile(fileURLToPath(schemaPath), "utf8"));
}

export function createPostgresRepository(pool) {
  return {
    async createUser({ name, email, passwordHash, verificationTokenHash, verificationExpiresAt }) {
      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash, verification_token_hash, verification_expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, email, email_verified, token_version, created_at`,
        [name, email, passwordHash, verificationTokenHash, verificationExpiresAt],
      );
      return result.rows[0];
    },
    async findUserByEmail(email) {
      const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
      return result.rows[0] ?? null;
    },
    async findUserById(id) {
      const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
      return result.rows[0] ?? null;
    },
    async setVerificationToken(userId, tokenHash, expiresAt) {
      await pool.query(
        "UPDATE users SET verification_token_hash = $2, verification_expires_at = $3 WHERE id = $1",
        [userId, tokenHash, expiresAt],
      );
    },
    async verifyEmail(tokenHash) {
      const result = await pool.query(
        `UPDATE users
         SET email_verified = TRUE, verification_token_hash = NULL, verification_expires_at = NULL
         WHERE verification_token_hash = $1 AND verification_expires_at > NOW()
         RETURNING id`,
        [tokenHash],
      );
      return result.rowCount > 0;
    },
    async setPasswordResetToken(userId, tokenHash, expiresAt) {
      await pool.query(
        "UPDATE users SET password_reset_token_hash = $2, password_reset_expires_at = $3 WHERE id = $1",
        [userId, tokenHash, expiresAt],
      );
    },
    async resetPassword(tokenHash, passwordHash) {
      const result = await pool.query(
        `UPDATE users
         SET password_hash = $2, token_version = token_version + 1,
             password_reset_token_hash = NULL, password_reset_expires_at = NULL
         WHERE password_reset_token_hash = $1 AND password_reset_expires_at > NOW()
         RETURNING id`,
        [tokenHash, passwordHash],
      );
      return result.rowCount > 0;
    },
    async revokeSessions(userId) {
      await pool.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [userId]);
    },
    async createPaymentOrder({ userId, paypalOrderId, tierId, tierName, amount, currency }) {
      const result = await pool.query(
        `INSERT INTO payment_orders (user_id, paypal_order_id, tier_id, tier_name, amount, currency)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, user_id, paypal_order_id, tier_id, tier_name, amount, currency, status`,
        [userId, paypalOrderId, tierId, tierName, amount, currency],
      );
      return result.rows[0];
    },
    async findPaymentOrder({ userId, paypalOrderId }) {
      const result = await pool.query(
        "SELECT * FROM payment_orders WHERE user_id = $1 AND paypal_order_id = $2",
        [userId, paypalOrderId],
      );
      return result.rows[0] ?? null;
    },
    async completePaymentOrder({ userId, paypalOrderId }) {
      const result = await pool.query(
        `UPDATE payment_orders SET status = 'COMPLETED', completed_at = NOW()
         WHERE user_id = $1 AND paypal_order_id = $2 AND status = 'PENDING'
         RETURNING paypal_order_id, amount, currency, status`,
        [userId, paypalOrderId],
      );
      if (result.rowCount) {
        return result.rows[0];
      }
      return this.findPaymentOrder({ userId, paypalOrderId });
    },
  };
}
