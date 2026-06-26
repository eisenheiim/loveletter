'use strict';

/**
 * Shopier REST credentials and defaults.
 * PAT and webhook secret must only exist on the server.
 * Product name/price/id come from each payment request — not from env.
 */
function getShopierPat() {
  return (process.env.SHOPIER_PAT || process.env.SHOPIER_API_KEY || '').trim();
}

function getShopierWebhookSecret() {
  return (
    process.env.SHOPIER_WEBHOOK_SECRET ||
    process.env.SHOPIER_WEBHOOK_TOKEN ||
    process.env.SHOPIER_CLIENT_SECRET ||
    process.env.SHOPIER_API_SECRET ||
    ''
  ).trim();
}

function getShopierApiBaseUrl() {
  return (process.env.SHOPIER_API_BASE_URL || 'https://api.shopier.com/v1').replace(/\/$/, '');
}

function getShopierShopSlug() {
  return (process.env.SHOPIER_SHOP_SLUG || '').trim();
}

/** Default charge currency when the client omits currency in the request body. */
function getProductCurrency() {
  return (process.env.PRODUCT_CURRENCY || 'TRY').toUpperCase();
}

function isShopierConfigured() {
  const pat = getShopierPat();
  return Boolean(pat && pat !== 'your-personal-access-token' && !pat.startsWith('your-'));
}

function isWebhookConfigured() {
  const secret = getShopierWebhookSecret();
  return Boolean(secret && !secret.startsWith('your-'));
}

module.exports = {
  getShopierPat,
  getShopierWebhookSecret,
  getShopierApiBaseUrl,
  getShopierShopSlug,
  getProductCurrency,
  isShopierConfigured,
  isWebhookConfigured,
};
