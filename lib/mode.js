const { isPaymentConfigured } = require('./shopier');
const {
  CHECKOUT_CHARGE_AMOUNT,
  CHECKOUT_CHARGE_CURRENCY,
  CHECKOUT_ITEM_NAME,
} = require('./checkoutCharge');

const PUBLIC_PRICE_AMOUNT = '1.00';
const PUBLIC_PRICE_DISPLAY = '€1.00';

function normalizeAppMode(raw) {
  const value = String(raw || 'paid').trim().toLowerCase();
  return value === 'free' ? 'free' : 'paid';
}

function getAppMode() {
  return normalizeAppMode(process.env.APP_MODE);
}

function isFreeMode() {
  return getAppMode() === 'free';
}

function isPaidMode() {
  return getAppMode() === 'paid';
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
  const mode = getAppMode();
  const paymentTemplate = getCheckoutPaymentTemplate();

  if (mode === 'free') {
    return {
      mode: 'free',
      shopierConfigured: false,
      shopSlug: process.env.SHOPIER_SHOP_SLUG || '',
      displayPrice: '0',
      displayCurrency: 'EUR',
      priceDisplay: 'Free',
      priceNote: 'No payment required',
      checkoutButton: 'Create My Surprise & Get QR',
      packageTitle: 'Free Package',
      payment: null,
      sharedProductCheckout: false,
      allowDevQr: false,
      previewKeyRequired: false,
    };
  }

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
    sharedProductCheckout: true,
    checkoutChargeAmount: CHECKOUT_CHARGE_AMOUNT,
    checkoutChargeCurrency: CHECKOUT_CHARGE_CURRENCY,
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
  isFreeMode,
  isPaidMode,
};
