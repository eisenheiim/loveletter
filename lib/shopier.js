const crypto = require('crypto');

const SHOPIER_PAYMENT_URL = 'https://www.shopier.com/ShowProduct/api_pay4.php';

function getConfig() {
  return {
    apiKey: process.env.SHOPIER_API_KEY || '',
    apiSecret: process.env.SHOPIER_API_SECRET || '',
    websiteIndex: Number(process.env.SHOPIER_WEBSITE_INDEX || 1),
    price: process.env.PRODUCT_PRICE || '699.90',
    currency: Number(process.env.PRODUCT_CURRENCY || 0),
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  };
}

function isConfigured() {
  const { apiKey, apiSecret } = getConfig();
  return Boolean(apiKey && apiSecret && apiKey !== 'your_api_key');
}

function signPayload(randomNr, platformOrderId, totalOrderValue, currency, secret) {
  const data = `${randomNr}${platformOrderId}${totalOrderValue}${currency}`;
  return crypto.createHmac('sha256', secret).update(data).digest('base64');
}

function verifyCallbackSignature(body, secret) {
  const required = ['random_nr', 'platform_order_id', 'total_order_value', 'currency', 'signature'];
  for (const key of required) {
    if (body[key] === undefined || body[key] === null || body[key] === '') {
      return { valid: false, reason: `Missing field: ${key}` };
    }
  }

  const data = `${body.random_nr}${body.platform_order_id}${body.total_order_value}${body.currency}`;
  const expected = crypto.createHmac('sha256', secret).update(data).digest();
  const received = Buffer.from(body.signature, 'base64');

  if (received.length !== expected.length) {
    return { valid: false, reason: 'Signature length mismatch' };
  }

  if (!crypto.timingSafeEqual(received, expected)) {
    return { valid: false, reason: 'Invalid signature' };
  }

  return { valid: true };
}

function splitName(fullName) {
  const parts = String(fullName || 'Valentine Customer').trim().split(/\s+/);
  if (parts.length === 1) {
    return { name: parts[0], surname: 'Surprise' };
  }
  return {
    name: parts[0],
    surname: parts.slice(1).join(' '),
  };
}

/**
 * Build Shopier OSB payment form fields + auto-submit HTML.
 */
function createPaymentRequest({ draftId, buyerName, buyerEmail, buyerPhone }) {
  const config = getConfig();
  const randomNr = Math.floor(100000 + Math.random() * 900000);
  const { name, surname } = splitName(buyerName);
  const email = buyerEmail || process.env.SHOPIER_DEFAULT_EMAIL || 'customer@example.com';
  const phone = buyerPhone || process.env.SHOPIER_DEFAULT_PHONE || '5550000000';
  const callbackUrl = `${config.baseUrl}/api/payment/callback`;

  const fields = {
    API_key: config.apiKey,
    website_index: config.websiteIndex,
    platform_order_id: draftId,
    product_name: 'Premium Valentine Surprise Webpage',
    product_type: 1,
    buyer_name: name,
    buyer_surname: surname,
    buyer_email: email,
    buyer_account_age: 0,
    buyer_id_nr: phone.replace(/\D/g, '').slice(-10) || '1000000000',
    buyer_phone: phone,
    billing_address: 'Digital Product',
    billing_city: 'Istanbul',
    billing_country: 'Turkey',
    billing_postcode: '34000',
    shipping_address: 'Digital Product',
    shipping_city: 'Istanbul',
    shipping_country: 'Turkey',
    shipping_postcode: '34000',
    total_order_value: config.price,
    currency: config.currency,
    platform: 0,
    is_in_frame: 0,
    current_language: 0,
    modul_version: '1.0.4',
    random_nr: randomNr,
    callback: callbackUrl,
    signature: signPayload(randomNr, draftId, config.price, config.currency, config.apiSecret),
  };

  const inputs = Object.entries(fields)
    .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtml(String(value))}" />`)
    .join('\n');

  const checkoutHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Redirecting to Shopier…</title>
  <style>
    body { font-family: system-ui, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; background:#fff5f5; color:#7f0a1e; }
  </style>
</head>
<body>
  <p>Redirecting to secure Shopier checkout…</p>
  <form id="shopier_payment_form" method="post" action="${SHOPIER_PAYMENT_URL}">
    ${inputs}
  </form>
  <script>document.getElementById('shopier_payment_form').submit();</script>
</body>
</html>`;

  return {
    checkoutUrl: SHOPIER_PAYMENT_URL,
    checkoutHtml,
    fields,
  };
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseCallback(body) {
  const verification = verifyCallbackSignature(body, getConfig().apiSecret);
  const status = String(body.status || '').toLowerCase();

  return {
    verified: verification.valid,
    reason: verification.reason,
    success: verification.valid && status === 'success',
    draftId: body.platform_order_id,
    paymentId: body.payment_id,
    status,
    installment: body.installment,
  };
}

module.exports = {
  SHOPIER_PAYMENT_URL,
  createPaymentRequest,
  verifyCallbackSignature,
  parseCallback,
  isConfigured,
  getConfig,
};
