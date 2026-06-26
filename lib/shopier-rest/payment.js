'use strict';

const { ShopierApiClient, ShopierPaymentFlow, buildHostedCheckoutHtml } = require('@nopeion/shopier');
const { ShopierApiError } = require('./http');
const { getShopierPat, getShopierShopSlug, getProductCurrency } = require('./config');
const {
  wrapCheckoutHtml,
  resolveProductImageUrl,
  extractShopierErrorMessage,
} = require('../shopier');

function splitBuyerName(fullName) {
  const parts = String(fullName || 'Valentine Customer').trim().split(/\s+/);
  if (parts.length === 1) {
    return { buyer_name: parts[0], buyer_surname: 'Customer' };
  }
  return {
    buyer_name: parts.slice(0, -1).join(' '),
    buyer_surname: parts[parts.length - 1],
  };
}

function formatAmount(value, fieldName = 'amount') {
  const num = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) {
    throw new ShopierApiError(`${fieldName} must be a positive number`);
  }
  return num.toFixed(2);
}

function normalizeItem(item, index) {
  if (!item || typeof item !== 'object') {
    throw new ShopierApiError(`items[${index}] must be an object`);
  }

  const id = item.id ?? item.product_id ?? item.productId;
  const name = item.name ?? item.title ?? item.product_name;
  const price = item.price ?? item.unit_price ?? item.unitPrice;
  const quantity = Number(item.quantity ?? item.qty ?? 1);

  if (!id) {
    throw new ShopierApiError(`items[${index}].id is required`);
  }
  if (!name || !String(name).trim()) {
    throw new ShopierApiError(`items[${index}].name is required`);
  }
  if (price === undefined || price === null || price === '') {
    throw new ShopierApiError(`items[${index}].price is required`);
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new ShopierApiError(`items[${index}].quantity must be a positive integer`);
  }

  return {
    id: String(id),
    name: String(name).trim(),
    price: formatAmount(price, `items[${index}].price`),
    quantity: Math.floor(quantity),
  };
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ShopierApiError('items must be a non-empty array of { id, name, price, quantity }');
  }
  return items.map(normalizeItem);
}

function sumItemTotals(items) {
  return items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
}

function buildProductTitle(items) {
  if (items.length === 1) {
    return items[0].name;
  }
  return items.map((item) => `${item.name} x${item.quantity}`).join(', ');
}

/** Shop home URLs must never be used as checkout redirects (causes error=303). */
function isShopProfileUrl(url, shopSlug) {
  if (!url || !shopSlug) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, '').toLowerCase();
    const slug = String(shopSlug).trim().toLowerCase();
    return path === `/${slug}` || path === `/${slug}&error=303`;
  } catch {
    return false;
  }
}

/**
 * Real checkout target: product page or hosted shipping endpoint — not the shop profile.
 */
function resolveProductCheckoutUrl(payment, shopSlug) {
  const productId = String(payment?.productId || payment?.product?.id || '').trim();
  const rawUrl = String(payment?.paymentUrl || payment?.product?.url || '').trim();

  if (rawUrl && !isShopProfileUrl(rawUrl, shopSlug)) {
    return rawUrl;
  }

  if (productId && shopSlug) {
    return `https://www.shopier.com/${shopSlug}/${productId}`;
  }

  return null;
}

function buildHostedCheckoutDocument(payment, shopSlug) {
  const productId = payment?.productId;
  if (!productId || !shopSlug) {
    throw new ShopierApiError('Shopier did not return a product id for hosted checkout');
  }

  const rawHtml =
    payment.checkoutHtml ||
    payment.hostedCheckoutHtml ||
    buildHostedCheckoutHtml({
      productId: String(productId),
      shopSlug: String(shopSlug),
      quantity: 1,
    });

  if (!rawHtml || typeof rawHtml !== 'string') {
    throw new ShopierApiError('Could not build Shopier hosted checkout form');
  }

  return wrapCheckoutHtml(rawHtml);
}

/**
 * Normalized checkout input from request body / database record.
 */
function buildPaymentTriggerPayload(input = {}) {
  const items = normalizeItems(input.items);

  const computedTotal = sumItemTotals(items);
  const totalAmount = input.total_amount ?? input.totalAmount;
  const formattedTotal =
    totalAmount !== undefined && totalAmount !== null && totalAmount !== ''
      ? formatAmount(totalAmount, 'total_amount')
      : formatAmount(computedTotal, 'total_amount');

  if (Math.abs(Number(formattedTotal) - computedTotal) > 0.01) {
    throw new ShopierApiError(
      `total_amount (${formattedTotal}) does not match items sum (${computedTotal.toFixed(2)})`
    );
  }

  const names = splitBuyerName(
    input.buyer_name && input.buyer_surname
      ? `${input.buyer_name} ${input.buyer_surname}`
      : input.buyerName || input.senderName
  );

  return {
    buyer_name: input.buyer_name || names.buyer_name,
    buyer_surname: input.buyer_surname || names.buyer_surname,
    buyer_email: input.buyer_email || input.buyerEmail || '',
    buyer_id: String(input.buyer_id || input.buyerId || input.draftId || input.orderId || ''),
    total_amount: formattedTotal,
    currency: (input.currency || getProductCurrency() || 'TRY').toUpperCase(),
    product_type: (input.product_type || input.productType || 'DIGITAL').toUpperCase(),
    items,
    return_url: input.return_url || input.returnUrl || undefined,
    callback_url: input.callback_url || input.callbackUrl || undefined,
  };
}

/**
 * Start Shopier checkout using the official PAT API (products + hosted checkout).
 * Dynamic name/price come from the request items[] — no Shopier panel product required.
 */
async function initializePayment(checkoutInput = {}) {
  const payload = buildPaymentTriggerPayload(checkoutInput);

  if (!payload.buyer_id) {
    throw new ShopierApiError('buyer_id (or draftId) is required');
  }
  if (!payload.buyer_email) {
    throw new ShopierApiError('buyer_email is required');
  }

  const shopSlug = getShopierShopSlug();
  if (!shopSlug) {
    throw new ShopierApiError('SHOPIER_SHOP_SLUG is required');
  }

  const baseUrl = process.env.BASE_URL || '';
  const imageUrl = resolveProductImageUrl(process.env.SHOPIER_PRODUCT_IMAGE_URL, baseUrl);

  const flow = new ShopierPaymentFlow({
    client: new ShopierApiClient({ pat: getShopierPat() }),
    shopSlug,
    defaultImageUrl: imageUrl,
    autoDeleteProduct: false,
  });

  console.info('[shopier] creating dynamic checkout product', {
    draftId: payload.buyer_id,
    amount: payload.total_amount,
    currency: payload.currency,
    title: buildProductTitle(payload.items),
  });

  try {
    const linkOptions = {
      title: buildProductTitle(payload.items),
      description: `Custom surprise page (${payload.buyer_id})`,
      amount: payload.total_amount,
      currency: payload.currency,
      orderId: payload.buyer_id,
      customNote: `draft:${payload.buyer_id}`,
      hostedCheckout: true,
      shopSlug,
      imageUrl,
      productType: 'digital',
      stockQuantity: 1,
      customListing: true,
    };

    const payment = await flow.createPaymentLink(linkOptions);

    const checkoutHtml = buildHostedCheckoutDocument(payment, shopSlug);
    const paymentUrl = resolveProductCheckoutUrl(payment, shopSlug);

    if (!checkoutHtml) {
      throw new ShopierApiError('Shopier checkout form could not be created');
    }

    return {
      payment_url: paymentUrl,
      payment_id: payment.productId,
      product_id: payment.productId,
      checkout_html: checkoutHtml,
      redirect_via: 'checkout_html',
      payload,
    };
  } catch (err) {
    const message = extractShopierErrorMessage(err);
    console.error('[shopier] initializePayment failed', {
      message,
      status: err.details?.status,
      body: err.details?.body,
    });
    throw new ShopierApiError(message, {
      status: err.details?.status,
      body: err.details?.body,
    });
  }
}

function buildPayloadFromDraft(draft, requestBody = {}) {
  const body = requestBody || {};

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new ShopierApiError(
      'items is required. Send [{ id, name, price, quantity }] in the request body.'
    );
  }

  const items = body.items.map((item, index) =>
    normalizeItem(
      {
        ...item,
        id: item.id ?? draft.id,
      },
      index
    )
  );

  return buildPaymentTriggerPayload({
    draftId: draft.id,
    buyerId: draft.id,
    buyerEmail: body.buyer_email || body.buyerEmail || draft.buyerEmail,
    buyerName: body.buyer_name || body.buyerName || draft.senderName,
    senderName: draft.senderName,
    buyer_name: body.buyer_name,
    buyer_surname: body.buyer_surname,
    total_amount: body.total_amount ?? body.totalAmount,
    currency: body.currency,
    items,
    product_type: body.product_type || body.productType,
    return_url: body.return_url || body.returnUrl,
    callback_url: body.callback_url || body.callbackUrl,
  });
}

module.exports = {
  buildPaymentTriggerPayload,
  buildPayloadFromDraft,
  initializePayment,
  normalizeItems,
};
