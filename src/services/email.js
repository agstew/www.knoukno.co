import { Resend } from "resend";

export function createEmailService({ apiKey, fromEmail, publicAppUrl }) {
  const client = apiKey ? new Resend(apiKey) : null;

  async function send({ to, subject, html }) {
    if (!client || !fromEmail) {
      throw new Error("Email delivery is not configured");
    }
    const { error } = await client.emails.send({ from: fromEmail, to, subject, html });
    if (error) {
      throw new Error(`Email delivery failed: ${error.message}`);
    }
  }

  return {
    sendVerificationEmail({ email, name, token }) {
      const link = new URL("/verify-email", publicAppUrl);
      link.searchParams.set("token", token);
      return send({
        to: email,
        subject: "Verify your Kno U Kno account",
        html: `<p>Hi ${escapeHtml(name)},</p><p><a href="${link}">Verify your email address</a></p><p>This link expires in 24 hours.</p>`,
      });
    },
    sendPasswordResetEmail({ email, name, token }) {
      const link = new URL("/reset-password", publicAppUrl);
      link.searchParams.set("token", token);
      return send({
        to: email,
        subject: "Reset your Kno U Kno password",
        html: `<p>Hi ${escapeHtml(name)},</p><p><a href="${link}">Reset your password</a></p><p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>`,
      });
    },
  };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}
