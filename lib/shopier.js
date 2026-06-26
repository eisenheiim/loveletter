const { ShopierApiClient, ShopierPaymentFlow } = require('@nopeion/shopier');

/** Shopier rejects URLs without a real file extension (e.g. Unsplash ?w=800). */
const SHOPIER_IMAGE_URL_REGEX =
  /^https?:\/\/.*\.(jpg|jpeg|png|tiff|tif|webp)$/i;

const REMOTE_FALLBACK_IMAGE =
  'https://picsum.photos/id/431/800/600.jpg';

function resolveDefaultProductImage(baseUrl) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (base.startsWith('https://')) {
    return `${base}/product-cover.jpg`;
  }
  return REMOTE_FALLBACK_IMAGE;
}

function resolveProductImageUrl(url, baseUrl) {
  const fallback = resolveDefaultProductImage(baseUrl);
  if (!url || typeof url !== 'string') return fallback;

  let cleaned = url.trim().split('?')[0].split('#')[0].trim();
  if (SHOPIER_IMAGE_URL_REGEX.test(cleaned)) {
    // Unsplash and similar CDNs often fail Shopier's media validation
    if (/images\.unsplash\.com/i.test(cleaned)) {
      return fallback;
    }
    return cleaned;
  }

  if (/images\.unsplash\.com\/photo-[\w-]+$/i.test(cleaned)) {
    cleaned = `${cleaned}.jpg`;
    if (SHOPIER_IMAGE_URL_REGEX.test(cleaned)) return cleaned;
  }

  if (cleaned.startsWith('/')) {
    const base = String(baseUrl || '').replace(/\/$/, '');
    if (base.startsWith('https://')) {
      cleaned = `${base}${cleaned}`;
      if (SHOPIER_IMAGE_URL_REGEX.test(cleaned)) return cleaned;
    }
  }

  return fallback;
}

let paymentFlow = null;

function getPat() {
  return (
    process.env.SHOPIER_PAT ||
    process.env.SHOPIER_API_KEY ||
    ''
  ).trim();
}

function getShopSlug() {
  return (process.env.SHOPIER_SHOP_SLUG || '').trim();
}

function getWebhookToken() {
  return (
    process.env.SHOPIER_WEBHOOK_TOKEN ||
    process.env.SHOPIER_WEBHOOK_SECRET ||
    process.env.SHOPIER_CLIENT_SECRET ||
    process.env.SHOPIER_API_SECRET ||
    ''
  ).trim();
}

function getConfig() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const productImageUrl = resolveProductImageUrl(
    process.env.SHOPIER_PRODUCT_IMAGE_URL,
    baseUrl
  );

  return {
    pat: getPat(),
    shopSlug: getShopSlug(),
    webhookToken: getWebhookToken(),
    price: process.env.PRODUCT_PRICE || '699.90',
    currency: 'TRY',
    baseUrl,
    productImageUrl,
  };
}

function isPaymentConfigured() {
  const { pat, shopSlug } = getConfig();
  return Boolean(
    pat &&
    shopSlug &&
    pat !== 'your_api_key' &&
    pat !== 'your-personal-access-token' &&
    !pat.startsWith('your-')
  );
}

function isWebhookConfigured() {
  const token = getWebhookToken();
  return Boolean(
    token &&
    token !== 'your_api_secret' &&
    token !== 'your-client-secret' &&
    !token.startsWith('your-')
  );
}

/** Full Shopier setup (payment + webhook). */
function isConfigured() {
  return isPaymentConfigured() && isWebhookConfigured();
}

function getPaymentFlow() {
  if (!paymentFlow) {
    const config = getConfig();
    paymentFlow = new ShopierPaymentFlow({
      client: new ShopierApiClient({ pat: config.pat }),
      webhookToken: config.webhookToken || undefined,
      shopSlug: config.shopSlug,
      defaultImageUrl: config.productImageUrl,
      autoDeleteProduct: true,
    });
  }
  return paymentFlow;
}

/**
 * Create a Shopier PAT hosted checkout for a draft.
 */
async function createPaymentRequest({ draftId }) {
  const config = getConfig();
  const flow = getPaymentFlow();

  console.info('[shopier] product image URL:', config.productImageUrl);

  const payment = await flow.createPaymentLink({
    title: 'Premium Valentine Surprise Webpage',
    description: `Personalized romantic surprise (${draftId})`,
    amount: config.price,
    currency: config.currency,
    orderId: draftId,
    customNote: `draft:${draftId}`,
    hostedCheckout: true,
    shopSlug: config.shopSlug,
    imageUrl: config.productImageUrl,
    productType: 'digital',
    stockQuantity: 1,
    customListing: true,
  });

  return {
    checkoutUrl: payment.paymentUrl,
    checkoutHtml: payment.checkoutHtml || payment.hostedCheckoutHtml,
    productId: payment.productId,
    draftId,
  };
}

/**
 * Verify Shopier PAT webhook and run payment handler.
 */
async function handleWebhook(rawBody, headers, onPaymentCompleted) {
  const flow = getPaymentFlow();
  const config = getConfig();

  if (!config.webhookToken) {
    throw new Error('SHOPIER_WEBHOOK_TOKEN or SHOPIER_API_SECRET is not configured');
  }

  return flow.handleWebhookPayload(
    rawBody,
    headers,
    onPaymentCompleted,
    { webhookToken: config.webhookToken }
  );
}

function extractDraftIdFromOrder(order, productId) {
  const note = String(order?.note || order?.customNote || '');
  const draftMatch = note.match(/draft:(v2026-[a-f0-9]+)/i);
  if (draftMatch) return draftMatch[1];

  const description = String(order?.description || '');
  const descMatch = description.match(/(v2026-[a-f0-9]+)/i);
  if (descMatch) return descMatch[1];

  for (const item of order?.lineItems || []) {
    if (item.productId === productId) {
      const itemNote = String(item.note || item.customNote || '');
      const itemMatch = itemNote.match(/draft:(v2026-[a-f0-9]+)/i);
      if (itemMatch) return itemMatch[1];
    }
  }

  return null;
}

module.exports = {
  createPaymentRequest,
  handleWebhook,
  extractDraftIdFromOrder,
  isConfigured,
  isPaymentConfigured,
  isWebhookConfigured,
  getConfig,
  getPat,
  getShopSlug,
};
