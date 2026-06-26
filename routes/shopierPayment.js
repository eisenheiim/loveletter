'use strict';

const express = require('express');
const {
  isShopierConfigured,
  isWebhookConfigured,
  initializePayment,
  buildPayloadFromDraft,
  ShopierApiError,
} = require('../lib/shopier-rest');
const {
  verifyWebhookSignature,
  isSuccessfulPaymentEvent,
} = require('../lib/shopier-rest/webhook');

/**
 * Shopier PAT payment routes.
 *
 * POST /api/payment/initialize — start checkout via REST payment/trigger
 * POST /api/payment/webhook     — verify HMAC + process payment events
 */
function createShopierPaymentRouter({ store, fulfillPayment, resolveDraftFromPayment }) {
  const router = express.Router();

  router.post('/initialize', async (req, res) => {
    try {
      if (!isShopierConfigured()) {
        return res.status(503).json({
          error: 'Shopier is not configured. Set SHOPIER_PAT on the server.',
        });
      }

      const body = req.body || {};
      let checkoutInput = { ...body };

      if (body.draftId && store?.findById) {
        const draft = await store.findById(body.draftId);
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

        checkoutInput = buildPayloadFromDraft(draft, {
          ...body,
          return_url: body.return_url || body.returnUrl,
          callback_url: body.callback_url || body.callbackUrl,
        });
      }

      const result = await initializePayment(checkoutInput);

      return res.status(200).json({
        ok: true,
        payment_url: result.payment_url,
        payment_id: result.payment_id,
        product_id: result.product_id,
        checkout_html: result.checkout_html,
        checkoutHtml: result.checkout_html,
        redirect_via: result.redirect_via || 'checkout_html',
        draftId: checkoutInput.buyer_id || body.draftId || null,
      });
    } catch (err) {
      console.error('[payment/initialize]', err);

      if (err instanceof ShopierApiError) {
        const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 400;
        return res.status(status).json({
          error: err.message,
          details: process.env.NODE_ENV === 'production' ? undefined : err.body,
        });
      }

      return res.status(500).json({ error: 'Payment initialization failed.' });
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
