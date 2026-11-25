import { Router } from "express";
import { z } from "zod";
import { AppError } from "../errors.js";
import { createRequireAuth } from "../auth/middleware.js";

const captureSchema = z.object({
  orderId: z.string().min(1).max(80),
});
const createOrderSchema = z.object({
  tierId: z.string().min(1).max(40),
}).strict();

export function createPaymentsRouter({ repository, paypalService, jwtSecret }) {
  const router = Router();
  const requireAuth = createRequireAuth({ repository, jwtSecret });

  router.get("/config", (_req, res) => {
    return res.json({
      configured: paypalService.isConfigured,
      tiers: paypalService.settings.tiers,
      ...(paypalService.isConfigured ? { clientId: paypalService.settings.clientId } : {}),
      currency: paypalService.settings.currency,
    });
  });

  router.post("/orders", requireAuth, async (req, res, next) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Select one available tier" });
    }
    if (!paypalService.isConfigured) {
      return next(new AppError(503, "PayPal checkout is not configured"));
    }
    const tier = paypalService.getTier(parsed.data.tierId);
    if (!tier) {
      return res.status(400).json({ error: "The selected tier is not available" });
    }
    let created;
    try {
      created = await paypalService.createOrder({
        userId: req.auth.user.id,
        tierId: tier.id,
      });
    } catch (error) {
      return next(new AppError(502, error.message));
    }
    await repository.createPaymentOrder({
      userId: req.auth.user.id,
      paypalOrderId: created.id,
      tierId: created.tierId,
      tierName: created.tierName,
      amount: created.amount,
      currency: created.currency,
    });
    return res.status(201).json({ id: created.id });
  });

  router.post("/capture", requireAuth, async (req, res, next) => {
    const parsed = captureSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "A valid PayPal order ID is required" });
    }
    const order = await repository.findPaymentOrder({
      userId: req.auth.user.id,
      paypalOrderId: parsed.data.orderId,
    });
    if (!order) {
      return res.status(404).json({ error: "PayPal order not found" });
    }
    if (order.status === "COMPLETED") {
      return res.json({ status: "COMPLETED" });
    }

    let captured;
    try {
      captured = await paypalService.captureOrder(order.paypal_order_id);
    } catch (error) {
      return next(new AppError(502, error.message));
    }
    const expectedAmount = Number(order.amount).toFixed(2);
    if (
      captured.status !== "COMPLETED" ||
      captured.referenceId !== String(req.auth.user.id) ||
      captured.amount !== expectedAmount ||
      captured.currency !== order.currency
    ) {
      return next(new AppError(400, "PayPal payment details did not match the order"));
    }
    const completed = await repository.completePaymentOrder({
      userId: req.auth.user.id,
      paypalOrderId: order.paypal_order_id,
    });
    if (!completed || completed.status !== "COMPLETED") {
      return next(new AppError(409, "Could not confirm payment"));
    }
    return res.json({ status: "COMPLETED" });
  });

  return router;
}
