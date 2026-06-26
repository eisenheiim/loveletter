const { isConfigured, getConfig } = require('./shopier');

/**
 * App billing mode:
 * - free  → no Shopier; surprise is published immediately
 * - paid  → Shopier checkout required before the site goes live
 */
function getAppMode() {
  const explicit = String(process.env.APP_MODE || '').toLowerCase().trim();
  if (explicit === 'free' || explicit === 'paid') return explicit;
  return isConfigured() ? 'paid' : 'free';
}

function isFreeMode() {
  return getAppMode() === 'free';
}

function isPaidMode() {
  return getAppMode() === 'paid';
}

function getPublicConfig() {
  const mode = getAppMode();
  const shopier = getConfig();

  return {
    mode,
    isFree: mode === 'free',
    isPaid: mode === 'paid',
    shopierConfigured: isConfigured(),
    price: shopier.price,
    currency: shopier.currency,
    priceDisplay: mode === 'free' ? 'Ücretsiz' : `₺${shopier.price}`,
    checkoutButton:
      mode === 'free'
        ? 'Sürprizimi Oluştur & QR Kod Al'
        : 'Sürprizimi Oluştur & Öde',
    packageTitle: mode === 'free' ? 'Ücretsiz Paket' : 'Premium Paket',
  };
}

module.exports = {
  getAppMode,
  isFreeMode,
  isPaidMode,
  getPublicConfig,
};
