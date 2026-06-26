const { isPaymentConfigured } = require('./shopier');

const PUBLIC_PRICE_AMOUNT = '1.00';
const PUBLIC_PRICE_DISPLAY = '€1.00';

/** Shopier charge sent in payment/trigger (display stays €1.00 on the site). */
const CHECKOUT_CHARGE_AMOUNT = '42.00';
const CHECKOUT_CHARGE_CURRENCY = 'TRY';
const CHECKOUT_ITEM_NAME = 'Personalized Love Letter Webpage';

function getAppMode() {
  return 'paid';
}

function getPublicPriceDisplay() {
  return PUBLIC_PRICE_DISPLAY;
}

function isDevQrAllowed() {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_QR === 'true';
}

function getCheckoutPaymentTemplate() {
  return {
    currency: CHECKOUT_CHARGE_CURRENCY,
    total_amount: CHECKOUT_CHARGE_AMOUNT,
    product_type: 'DIGITAL',
    items: [
      {
        id: 'draft-placeholder',
        name: CHECKOUT_ITEM_NAME,
        price: CHECKOUT_CHARGE_AMOUNT,
        quantity: 1,
      },
    ],
  };
}

function getPublicConfig() {
  const paymentTemplate = getCheckoutPaymentTemplate();

  return {
    mode: 'paid',
    shopierConfigured: isPaymentConfigured(),
    shopSlug: process.env.SHOPIER_SHOP_SLUG || '',
    displayPrice: PUBLIC_PRICE_AMOUNT,
    displayCurrency: 'EUR',
    priceDisplay: PUBLIC_PRICE_DISPLAY,
    priceNote: `Payment total: ${PUBLIC_PRICE_DISPLAY}`,
    checkoutButton: `Pay ${PUBLIC_PRICE_DISPLAY} & Create Surprise`,
    packageTitle: 'Premium Package',
    payment: paymentTemplate,
    allowDevQr: isDevQrAllowed(),
    previewKeyRequired:
      process.env.NODE_ENV === 'production' &&
      Boolean((process.env.PREVIEW_SECRET || '').trim()),
  };
}

module.exports = {
  getAppMode,
  getPublicConfig,
  getPublicPriceDisplay,
  getCheckoutPaymentTemplate,
  isDevQrAllowed,
};
