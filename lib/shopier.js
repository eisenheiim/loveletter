const { ShopierApiClient, ShopierPaymentFlow } = require('@nopeion/shopier');

const DEFAULT_PRODUCT_IMAGE =
  'https://images.unsplash.com/photo-1518199266791-5375a32590dc?w=800&q=80';

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
  return {
    pat: getPat(),
    shopSlug: getShopSlug(),
    webhookToken: getWebhookToken(),
    price: process.env.PRODUCT_PRICE || '699.90',
    currency: 'TRY',
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    productImageUrl: process.env.SHOPIER_PRODUCT_IMAGE_URL || DEFAULT_PRODUCT_IMAGE,
  };
}

function isConfigured() {
  const { pat, shopSlug } = getConfig();
  const hasPaymentCreds = Boolean(
    pat &&
    shopSlug &&
    pat !== 'your_api_key' &&
    pat !== 'your-personal-access-token'
  );
  const hasWebhookSecret = Boolean(
    getWebhookToken() &&
    getWebhookToken() !== 'your_api_secret' &&
    getWebhookToken() !== 'your-client-secret'
  );
  return hasPaymentCreds && hasWebhookSecret;
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
  getConfig,
  getPat,
  getShopSlug,
};
