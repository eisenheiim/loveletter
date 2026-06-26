'use strict';

const { shopierRequest, ShopierApiError } = require('./http');
const { getProductCurrency, getShopierShopSlug } = require('./config');

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

function defaultAddress(overrides = {}) {
  return {
    address: overrides.address || 'Digital delivery',
    district: overrides.district || 'Kadikoy',
    city: overrides.city || 'Istanbul',
    state: overrides.state || 'Istanbul',
    postcode: overrides.postcode || '34000',
    country: overrides.country || 'Turkey',
    ...overrides,
  };
}

/**
 * Build Shopier payment/trigger payload from request body / database record.
 * All line items and amounts must be supplied dynamically — no catalog env vars.
 */
function buildPaymentTriggerPayload(input = {}) {
  const items = normalizeItems(input.items);

  const computedTotal = sumItemTotals(items);
  const totalAmount = input.total_amount ?? input.totalAmount;
  const formattedTotal = totalAmount !== undefined && totalAmount !== null && totalAmount !== ''
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

  const billing = defaultAddress(input.billing || input.billing_address);
  const shipping = defaultAddress(input.shipping || input.shipping_address || billing);

  return {
    buyer_name: input.buyer_name || names.buyer_name,
    buyer_surname: input.buyer_surname || names.buyer_surname,
    buyer_email: input.buyer_email || input.buyerEmail || '',
    buyer_id: String(input.buyer_id || input.buyerId || input.draftId || input.orderId || ''),
    total_amount: formattedTotal,
    currency: (input.currency || getProductCurrency() || 'TRY').toUpperCase(),
    product_type: (input.product_type || input.productType || 'DIGITAL').toUpperCase(),
    items,
    billing_address: billing,
    shipping_address: shipping,
    shop_slug: input.shop_slug || getShopierShopSlug() || undefined,
    return_url: input.return_url || input.returnUrl || undefined,
    callback_url: input.callback_url || input.callbackUrl || undefined,
  };
}

/**
 * POST https://api.shopier.com/v1/payment/trigger
 */
async function initializePayment(checkoutInput = {}) {
  const payload = buildPaymentTriggerPayload(checkoutInput);

  if (!payload.buyer_id) {
    throw new ShopierApiError('buyer_id (or draftId) is required');
  }
  if (!payload.buyer_email) {
    throw new ShopierApiError('buyer_email is required');
  }

  const response = await shopierRequest('/payment/trigger', {
    method: 'POST',
    body: payload,
  });

  const paymentUrl =
    response?.payment_url ||
    response?.paymentUrl ||
    response?.url ||
    response?.data?.payment_url ||
    response?.data?.paymentUrl;

  if (!paymentUrl) {
    throw new ShopierApiError('Shopier did not return payment_url', {
      status: 200,
      body: response,
    });
  }

  return {
    payment_url: paymentUrl,
    payment_id: response?.payment_id || response?.paymentId || response?.id || null,
    raw: response,
    payload,
  };
}

/**
 * Merge a database draft with dynamic payment line items from the request body.
 * Request must include items[] (and optional total_amount / currency).
 */
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
    billing: body.billing || body.billing_address,
    shipping: body.shipping || body.shipping_address,
    product_type: body.product_type || body.productType,
    return_url: body.return_url || body.returnUrl,
    callback_url: body.callback_url || body.callbackUrl,
    shop_slug: body.shop_slug,
  });
}

module.exports = {
  buildPaymentTriggerPayload,
  buildPayloadFromDraft,
  initializePayment,
  normalizeItems,
};
