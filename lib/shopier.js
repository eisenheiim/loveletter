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

function wrapCheckoutHtml(checkoutHtml, priceLabel = '€1.00') {
  if (!checkoutHtml || typeof checkoutHtml !== 'string') return checkoutHtml;

  const banner = `
  <div id="checkout-price-banner" style="min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:2rem;background:linear-gradient(180deg,#fff5f7,#ffe8ec);font-family:system-ui,sans-serif;text-align:center;">
    <div>
      <p style="margin:0 0 0.5rem;font-size:0.75rem;letter-spacing:0.2em;text-transform:uppercase;color:#9b1b30;">Payment total</p>
      <p style="margin:0 0 0.75rem;font-size:3rem;font-weight:600;color:#7f0a1e;">${priceLabel}</p>
      <p style="margin:0;font-size:0.95rem;color:#9b1b30;">Redirecting to secure payment&hellip;</p>
    </div>
  </div>`;

  let html = checkoutHtml.replace('<body>', `<body>${banner}`);
  html = html.replace(
    /<script>\s*document\.getElementById\('shopier-hosted-checkout'\)\.submit\(\);\s*<\/script>/,
    `<script>
      setTimeout(function () {
        var banner = document.getElementById('checkout-price-banner');
        if (banner) banner.style.display = 'none';
        document.getElementById('shopier-hosted-checkout').submit();
      }, 2200);
    </script>`
  );

  return html;
}

function extractShopierErrorMessage(err) {
  if (!err) return 'Unknown Shopier error';

  const details = err.details || {};
  const body = details.body;

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const direct = body.message || body.error_description || body.error;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();

    if (Array.isArray(body.errors)) {
      const joined = body.errors
        .map((item) => (typeof item === 'string' ? item : item?.message))
        .filter(Boolean)
        .join('; ');
      if (joined) return joined;
    }
  }

  if (err.name === 'ShopierUnauthorizedPatError') {
    return 'Shopier PAT is invalid or expired. Use your Personal Access Token (not Client ID) with products:read and products:write permissions.';
  }
  if (err.name === 'ShopierInvalidMediaUrlError') {
    return 'Shopier rejected the product image URL. Ensure BASE_URL/product-cover.jpg is publicly accessible and ends with .jpg.';
  }
  if (err.name === 'ShopierHostedCheckoutListingError') {
    return 'Shopier hosted checkout requires an active product listing on your shop.';
  }

  const status = details.status;
  if (status === 401 || status === 403) {
    return 'Shopier PAT unauthorized. Check SHOPIER_PAT and API permissions.';
  }

  if (err.message && !/response was not successful/i.test(err.message)) {
    return err.message;
  }

  if (status) {
    return `Shopier API error (HTTP ${status}). Check PAT, shop slug, currency, and product image URL.`;
  }

  return 'Shopier API connection failed.';
}

async function testShopierConnection() {
  if (!isPaymentConfigured()) {
    return {
      ok: false,
      error: 'SHOPIER_PAT and SHOPIER_SHOP_SLUG are required.',
    };
  }

  try {
    const client = getApiClient();
    const owner = await client.shop.getOwner();
    return {
      ok: true,
      shopSlug: getShopSlug(),
      currency: getConfig().currency,
      owner: owner?.name || owner?.email || null,
    };
  } catch (err) {
    return {
      ok: false,
      error: extractShopierErrorMessage(err),
      status: err.details?.status || null,
    };
  }
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
    price: process.env.PRODUCT_PRICE || '1.00',
    currency: process.env.PRODUCT_CURRENCY || 'TRY',
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
      autoDeleteProduct: false,
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

  console.info('[shopier] creating product', {
    draftId,
    currency: config.currency,
    price: config.price,
    imageUrl: config.productImageUrl,
    shopSlug: config.shopSlug,
  });

  try {
    const payment = await flow.createPaymentLink({
      title: 'Personalized Love Letter Webpage',
      description: `Custom romantic surprise page (${draftId})`,
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
      checkoutHtml: wrapCheckoutHtml(
        payment.checkoutHtml || payment.hostedCheckoutHtml
      ),
      productId: payment.productId,
      draftId,
    };
  } catch (err) {
    const message = extractShopierErrorMessage(err);
    console.error('[shopier] createPaymentRequest failed', {
      message,
      status: err.details?.status,
      body: err.details?.body,
      name: err.name,
    });

    const wrapped = new Error(message);
    wrapped.cause = err;
    wrapped.shopierStatus = err.details?.status;
    throw wrapped;
  }
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

function getApiClient() {
  const config = getConfig();
  return new ShopierApiClient({ pat: config.pat });
}

async function deleteShopierProduct(productId) {
  if (!productId || !isPaymentConfigured()) return false;
  try {
    const client = getApiClient();
    await client.products.delete(String(productId));
    return true;
  } catch (err) {
    console.warn('[shopier] delete product failed', productId, err.message);
    return false;
  }
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
  deleteShopierProduct,
  testShopierConnection,
  extractShopierErrorMessage,
  wrapCheckoutHtml,
};
