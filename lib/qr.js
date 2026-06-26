const fs = require('fs/promises');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');

const QR_DIR = path.join(__dirname, '..', 'uploads', 'qr');

const HEART_PATH =
  'M50,88 C20,65 0,45 0,28 C0,12 12,0 28,0 C38,0 46,6 50,14 C54,6 62,0 72,0 C88,0 100,12 100,28 C100,45 80,65 50,88 Z';

async function ensureQrDir() {
  await fs.mkdir(QR_DIR, { recursive: true });
}

function buildWhatsAppShareUrl(siteUrl, partnerName) {
  const name = partnerName ? String(partnerName).trim() : '';
  const text = name
    ? `${name}, I made a special surprise just for you 💕\n\n${siteUrl}`
    : `I made a special surprise just for you 💕\n\n${siteUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Generate a heart-shaped QR PNG for the live surprise URL.
 * Returns the relative path stored in the database (e.g. uploads/qr/v2026-abc.png).
 */
async function generateQrForSite(siteId, baseUrl) {
  await ensureQrDir();
  const liveUrl = `${baseUrl.replace(/\/$/, '')}/s/${siteId}`;
  const fileName = `${siteId}.png`;
  const absolutePath = path.join(QR_DIR, fileName);
  const relativePath = path.join('uploads', 'qr', fileName).replace(/\\/g, '/');
  const size = 1024;

  const qrBuffer = await QRCode.toBuffer(liveUrl, {
    type: 'png',
    width: size,
    margin: 1,
    color: {
      dark: '#7f0a1e',
      light: '#fff5f5',
    },
    errorCorrectionLevel: 'H',
  });

  const heartMask = Buffer.from(
    `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="black"/>
      <path d="${HEART_PATH}" fill="white"/>
    </svg>`
  );

  await sharp(qrBuffer)
    .resize(size, size)
    .ensureAlpha()
    .composite([{ input: heartMask, blend: 'dest-in' }])
    .png()
    .toFile(absolutePath);

  return { relativePath, absolutePath, liveUrl };
}

module.exports = { generateQrForSite, buildWhatsAppShareUrl };
