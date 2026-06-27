'use strict';

const express = require('express');
const { isPaymentConfigured } = require('../lib/shopier');
const { isWebhookConfigured } = require('../lib/shopier-rest');
const { createPaymentRequest } = require('../lib/shopier');
const {
  verifyWebhookSignature,
  isSuccessfulPaymentEvent,
} = require('../lib/shopier-rest/webhook');

/**
 * Shopier PAT payment routes.
 *
 * POST /api/payment/initialize — open checkout for the shared Shopier product
 * POST /api/payment/webhook     — verify HMAC + process payment events
 */
function createShopierPaymentRouter({ store, fulfillPayment, resolveDraftFromPayment }) {
  const router = express.Router();

  router.post('/initialize', async (req, res) => {
    try {
      if (!isPaymentConfigured()) {
        return res.status(503).json({
          error: 'Shopier is not configured. Set SHOPIER_PAT on the server.',
        });
      }

      const body = req.body || {};
      const draftId = body.draftId;

      if (!draftId) {
        return res.status(400).json({ error: 'draftId is required.' });
      }

      if (store?.findById) {
        const draft = await store.findById(draftId);
        if (!draft) {
          return res.status(404).json({ error: 'Draft not found.' });
        }
        if (draft.isPaid) {
          return res.json({
            alreadyPaid: true,
            draftId: draft.id,
          });
        }

        if (body.buyerEmail || body.buyer_email) {
          await store.updateById(draft.id, {
            buyerEmail: body.buyerEmail || body.buyer_email,
          });
        }

        await store.updateById(draft.id, {
          checkoutStartedAt: new Date().toISOString(),
        });
      }

      if (process.env.NODE_ENV === 'production' && !(process.env.SHOPIER_PRODUCT_ID || '').trim()) {
        return res.status(503).json({
          error: 'SHOPIER_PRODUCT_ID is required. Create one digital product in Shopier and add its id to Render.',
        });
      }

      const result = await createPaymentRequest({ draftId });

      if (store?.updateById) {
        await store.updateById(draftId, {
          shopierProductId: result.product_id || result.productId,
        });
      }

      return res.status(200).json({
        ok: true,
        payment_url: result.payment_url,
        payment_id: result.payment_id,
        product_id: result.product_id,
        checkout_html: result.checkout_html,
        checkoutHtml: result.checkout_html,
        redirect_via: result.redirect_via || 'checkout_html',
        draftId,
      });
    } catch (err) {
      console.error('[payment/initialize]', err);
      return res.status(500).json({ error: err.message || 'Payment initialization failed.' });
    }
  });

  return router;
}

/**
 * Webhook handler factory — mount with express.raw() BEFORE express.json().
 */
function createShopierWebhookHandler({ store, fulfillPayment, resolveDraftFromPayment }) {
  return async function shopierWebhookHandler(req, res) {
    if (!isWebhookConfigured()) {
      return res.status(503).json({ error: 'SHOPIER_WEBHOOK_SECRET is not configured.' });
    }

    const verification = verifyWebhookSignature({
      rawBody: req.body,
      headers: req.headers,
    });

    if (!verification.ok) {
      console.warn('[payment/webhook] rejected:', verification.reason);
      const status = verification.reason?.includes('not configured') ? 503 : 401;
      return res.status(status).json({ error: verification.reason || 'Unauthorized' });
    }

    const { payload, meta } = verification;
    const eventType = meta?.event || payload?.type || payload?.event;

    console.log('[payment/webhook] verified event:', eventType);

    if (!isSuccessfulPaymentEvent(eventType, payload)) {
      return res.status(200).json({ received: true, processed: false, event: eventType });
    }

    try {
      const order = payload?.data || payload?.order || payload;

      if (resolveDraftFromPayment && store) {
        const draftId = await resolveDraftFromPayment(order, store);
        if (draftId && fulfillPayment) {
          await fulfillPayment(draftId, order?.id || meta?.webhookId);
          console.log('[payment/webhook] fulfilled draft', draftId);
        } else {
          console.warn('[payment/webhook] could not map order to draft', order?.id);
        }
      }

      return res.status(200).json({
        received: true,
        processed: true,
        event: eventType,
      });
    } catch (err) {
      console.error('[payment/webhook] handler error', err);
      return res.status(500).json({ error: 'Webhook processing failed.' });
    }
  };
}

module.exports = {
  createShopierPaymentRouter,
  createShopierWebhookHandler,
};
