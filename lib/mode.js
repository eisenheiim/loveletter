const { isPaymentConfigured, getConfig } = require('./shopier');

function getAppMode() {
  return 'paid';
}

function formatPriceDisplay(price, currency) {
  const amount = String(price || '1.00');
  if (currency === 'EUR') return `€${amount}`;
  if (currency === 'USD') return `$${amount}`;
  return `₺${amount}`;
}

function getPublicConfig() {
  const shopier = getConfig();

  return {
    mode: 'paid',
    shopierConfigured: isPaymentConfigured(),
    price: shopier.price,
    currency: shopier.currency,
    priceDisplay: formatPriceDisplay(shopier.price, shopier.currency),
    checkoutButton: 'Create My Surprise & Pay',
    packageTitle: 'Premium Package',
  };
}

module.exports = {
  getAppMode,
  getPublicConfig,
};
