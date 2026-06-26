const { isPaymentConfigured, getConfig } = require('./shopier');

function getAppMode() {
  return 'paid';
}

function getPublicConfig() {
  const shopier = getConfig();

  return {
    mode: 'paid',
    shopierConfigured: isPaymentConfigured(),
    price: shopier.price,
    currency: shopier.currency,
    priceDisplay: `₺${shopier.price}`,
    checkoutButton: 'Sürprizimi Oluştur & Öde',
    packageTitle: 'Premium Paket',
  };
}

module.exports = {
  getAppMode,
  getPublicConfig,
};
