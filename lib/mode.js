const { isPaymentConfigured, getConfig } = require('./shopier');

const PUBLIC_PRICE_AMOUNT = '1.00';
const PUBLIC_PRICE_DISPLAY = '€1.00';

function getAppMode() {
  return 'paid';
}

function getPublicPriceDisplay() {
  return PUBLIC_PRICE_DISPLAY;
}

function getPublicConfig() {
  const shopier = getConfig();

  return {
    mode: 'paid',
    shopierConfigured: isPaymentConfigured(),
    price: shopier.price,
    currency: shopier.currency,
    displayPrice: PUBLIC_PRICE_AMOUNT,
    displayCurrency: 'EUR',
    priceDisplay: PUBLIC_PRICE_DISPLAY,
    priceNote: `Payment total: ${PUBLIC_PRICE_DISPLAY}`,
    checkoutButton: `Pay ${PUBLIC_PRICE_DISPLAY} & Create Surprise`,
    packageTitle: 'Premium Package',
  };
}

module.exports = {
  getAppMode,
  getPublicConfig,
  getPublicPriceDisplay,
};
