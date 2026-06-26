'use strict';

const crypto = require('crypto');
const { getShopierWebhookSecret } = require('./config');

/**
 * HMAC verification (Shopier REST webhooks)
 * -----------------------------------------
 * Shopier signs the *raw* JSON request body with HMAC-SHA256.
 *
 *   expected = HMAC_SHA256(key = SHOPIER_WEBHOOK_SECRET, message = rawBody)
 *
 * The digest is sent in the `Shopier-Signature` header (hex or base64).
 * We compare using crypto.timingSafeEqual to prevent timing attacks.
 *
 * Important: parse JSON only AFTER the signature is verified.
 */
function normalizeRawBody(body) {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8');
  return String(body ?? '');
}

function getHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function timingSafeEqualStrings(expected, received) {
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function computeWebhookSignature(secret, rawBody, encoding = 'hex') {
  return crypto.createHmac('sha256', secret).update(rawBody).digest(encoding);
}

function verifyWebhookSignature({ rawBody, headers, secret = getShopierWebhookSecret() }) {
  if (!secret) {
    return { ok: false, reason: 'SHOPIER_WEBHOOK_SECRET is not configured' };
  }

  const received = getHeader(headers, 'shopier-signature');
  if (!received) {
    return { ok: false, reason: 'Missing Shopier-Signature header' };
  }

  const body = normalizeRawBody(rawBody);
  const expectedHex = computeWebhookSignature(secret, body, 'hex');
  const expectedBase64 = computeWebhookSignature(secret, body, 'base64');

  const valid =
    timingSafeEqualStrings(expectedHex, received) ||
    timingSafeEqualStrings(expectedBase64, received);

  if (!valid) {
    return { ok: false, reason: 'Signature mismatch' };
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'Webhook body is not valid JSON' };
  }

  return {
    ok: true,
    payload,
    meta: {
      event: getHeader(headers, 'shopier-event'),
      webhookId: getHeader(headers, 'shopier-webhook-id'),
      timestamp: getHeader(headers, 'shopier-timestamp'),
    },
  };
}

function isSuccessfulPaymentEvent(eventType, payload) {
  const type = String(eventType || payload?.type || payload?.event || '').toLowerCase();
  if (type === 'order.created') return true;

  const status = String(
    payload?.data?.paymentStatus ||
      payload?.paymentStatus ||
      payload?.data?.status ||
      payload?.status ||
      ''
  ).toLowerCase();

  return status === 'paid' || status === 'success' || status === 'succeeded';
}

module.exports = {
  verifyWebhookSignature,
  computeWebhookSignature,
  isSuccessfulPaymentEvent,
  normalizeRawBody,
};
