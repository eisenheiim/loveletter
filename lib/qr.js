const fs = require('fs/promises');
const path = require('path');
const QRCode = require('qrcode');

const QR_DIR = path.join(__dirname, '..', 'uploads', 'qr');

async function ensureQrDir() {
  await fs.mkdir(QR_DIR, { recursive: true });
}

/**
 * Generate a high-quality QR PNG for the live surprise URL.
 * Returns the relative path stored in the database (e.g. uploads/qr/v2026-abc.png).
 */
async function generateQrForSite(siteId, baseUrl) {
  await ensureQrDir();
  const liveUrl = `${baseUrl.replace(/\/$/, '')}/s/${siteId}`;
  const fileName = `${siteId}.png`;
  const absolutePath = path.join(QR_DIR, fileName);
  const relativePath = path.join('uploads', 'qr', fileName).replace(/\\/g, '/');

  await QRCode.toFile(absolutePath, liveUrl, {
    type: 'png',
    width: 1024,
    margin: 2,
    color: {
      dark: '#7f0a1e',
      light: '#fff5f5',
    },
    errorCorrectionLevel: 'H',
  });

  return { relativePath, absolutePath, liveUrl };
}

module.exports = { generateQrForSite };
