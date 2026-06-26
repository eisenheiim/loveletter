require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const store = require('./lib/store');
const { generateSiteId } = require('./lib/generateId');
const { createPaymentRequest, handleWebhook, extractDraftIdFromOrder, isPaymentConfigured } = require('./lib/shopier');
const { generateQrForSite } = require('./lib/qr');
const { renderSurprisePage } = require('./lib/renderSurprise');
const { getAppMode, isFreeMode, isPaidMode, getPublicConfig } = require('./lib/mode');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ROOT = __dirname;

/* ─── Ensure upload directories exist ─── */
for (const dir of ['uploads/images', 'uploads/qr', 'data']) {
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
}

/* ─── Middleware ─── */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use('/uploads', express.static(path.join(ROOT, 'uploads')));

/* Shopier PAT webhook — raw body required for signature verification */
app.post(
  '/api/payment/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (isFreeMode()) {
      return res.status(400).json({ error: 'Webhooks disabled in free mode' });
    }

    try {
      const result = await handleWebhook(req.body, req.headers, async (info) => {
        const { order, productId } = info;
        let draftId = extractDraftIdFromOrder(order, productId);

        if (!draftId) {
          const byProduct = await store.findByShopierProductId(productId);
          if (byProduct) draftId = byProduct.id;
        }

        if (!draftId) {
          console.warn('[payment/webhook] Could not resolve draft for product', productId);
          return;
        }

        await fulfillPayment(draftId, order.id || productId);
        console.log('[payment/webhook] Fulfilled draft', draftId);
      });

      return res.status(200).json({
        received: true,
        processed: result.processed,
        event: result.event.type,
      });
    } catch (err) {
      console.error('[payment/webhook]', err);
      return res.status(400).json({ error: 'Webhook verification failed' });
    }
  }
);

/* Legacy OSB callback — redirect users to webhook-based PAT flow */
app.post('/api/payment/callback', express.urlencoded({ extended: false }), (_req, res) => {
  res.status(410).send(
    'Legacy OSB callback is disabled. Configure Shopier PAT webhooks at /api/payment/webhook'
  );
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

/* ─── Multer: image uploads tied to generated draft id ─── */
function createImageUploader() {
  return multer({
    storage: multer.diskStorage({
      destination(req, _file, cb) {
        const dir = path.join(ROOT, 'uploads', 'images', req.generatedId);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename(_req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`);
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024, files: 3 },
    fileFilter(_req, file, cb) {
      if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Only image uploads are allowed'));
      }
      cb(null, true);
    },
  });
}

const upload = createImageUploader();

function assignDraftId(req, _res, next) {
  req.generatedId = generateSiteId();
  next();
}

/* ─── Payment fulfillment (idempotent) ─── */
async function fulfillPayment(draftId, shopierPaymentId) {
  const site = await store.findById(draftId);
  if (!site) return null;

  if (site.isPaid && site.qrCodePath) {
    return site;
  }

  await store.markPaid(draftId, { shopierPaymentId });

  const { relativePath } = await generateQrForSite(draftId, BASE_URL);
  return store.updateById(draftId, { qrCodePath: relativePath });
}

/* ═══════════════════════════════════════ */
/* API ROUTES                              */
/* ═══════════════════════════════════════ */

/**
 * GET /api/config — Public billing mode for dashboard UI.
 */
app.get('/api/config', (_req, res) => {
  res.json(getPublicConfig());
});

/**
 * POST /api/create-draft
 * Saves form data + uploaded images as an unpaid draft.
 */
app.post(
  '/api/create-draft',
  assignDraftId,
  upload.array('images', 3),
  async (req, res) => {
    try {
      const senderName = String(req.body.senderName || req.body.userName || '').trim();
      const partnerName = String(req.body.partnerName || '').trim();
      const mainMessage = String(req.body.mainMessage || '').trim();
      const musicTrack = String(req.body.musicTrack || req.body.music || 'romantic-piano').trim();

      let lovePoints = [];
      if (req.body.lovePoints) {
        try {
          lovePoints = JSON.parse(req.body.lovePoints);
        } catch {
          lovePoints = String(req.body.lovePoints)
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
        }
      }

      if (!senderName || !partnerName || !mainMessage) {
        return res.status(400).json({
          error: 'senderName, partnerName, and mainMessage are required.',
        });
      }

      const imagePaths = (req.files || []).map((file) =>
        path.join('uploads', 'images', req.generatedId, file.filename).replace(/\\/g, '/')
      );

      const draft = await store.create({
        id: req.generatedId,
        senderName,
        partnerName,
        mainMessage,
        lovePoints,
        images: imagePaths,
        musicTrack,
        plan: getAppMode(),
        isPaid: false,
        buyerEmail: req.body.buyerEmail || null,
        buyerPhone: req.body.buyerPhone || null,
      });

      return res.status(201).json({
        draftId: draft.id,
        mode: getAppMode(),
        message: 'Draft created successfully.',
        previewUrl: `${BASE_URL}/s/${draft.id}?preview=unpaid`,
      });
    } catch (err) {
      console.error('[create-draft]', err);
      return res.status(500).json({ error: 'Failed to create draft.' });
    }
  }
);

/**
 * POST /api/pay
 * Free mode: publish immediately + QR. Paid mode: Shopier checkout.
 */
app.post('/api/pay', async (req, res) => {
  try {
    const { draftId, buyerEmail, buyerPhone } = req.body || {};
    if (!draftId) {
      return res.status(400).json({ error: 'draftId is required.' });
    }

    const draft = await store.findById(draftId);
    if (!draft) {
      return res.status(404).json({ error: 'Draft not found.' });
    }
    if (draft.isPaid) {
      return res.json({
        alreadyPaid: true,
        mode: getAppMode(),
        successUrl: `${BASE_URL}/success/${draftId}`,
        siteUrl: `${BASE_URL}/s/${draftId}`,
        qrCodeUrl: draft.qrCodePath ? `${BASE_URL}/${draft.qrCodePath}` : null,
      });
    }

    if (buyerEmail || buyerPhone) {
      await store.updateById(draftId, {
        buyerEmail: buyerEmail || draft.buyerEmail,
        buyerPhone: buyerPhone || draft.buyerPhone,
      });
    }

    /* ─── FREE MODE: skip Shopier, publish right away ─── */
    if (isFreeMode()) {
      const site = await fulfillPayment(draftId, `free-${Date.now()}`);
      if (!site) {
        return res.status(404).json({ error: 'Draft not found.' });
      }
      return res.json({
        free: true,
        mode: 'free',
        message: 'Surprise published for free.',
        successUrl: `${BASE_URL}/success/${draftId}`,
        siteUrl: `${BASE_URL}/s/${draftId}`,
        qrCodeUrl: site.qrCodePath ? `${BASE_URL}/${site.qrCodePath}` : null,
      });
    }

    /* ─── PAID MODE: Shopier checkout ─── */
    if (!isPaymentConfigured()) {
      return res.status(503).json({
        error:
          'Shopier ödeme ayarları eksik. Render\'da SHOPIER_PAT ve SHOPIER_SHOP_SLUG kontrol edin. (Client Secret ödeme başlatmak için gerekmez.)',
        mode: 'paid',
        shopierConfigured: false,
        hint: 'PAT = Kişisel Erişim Anahtarı (Client ID değil)',
      });
    }

    const payment = await createPaymentRequest({ draftId });

    await store.updateById(draftId, {
      shopierProductId: payment.productId,
    });

    return res.json({
      mode: 'paid',
      draftId,
      successUrl: `${BASE_URL}/success/${draftId}`,
      checkoutUrl: payment.checkoutUrl,
      checkoutHtml: payment.checkoutHtml,
    });
  } catch (err) {
    console.error('[pay]', err);

    let message = 'Ödeme başlatılamadı. Shopier ayarlarını kontrol edin.';
    if (err.message) {
      if (/invalid media url|media\[0\]\.url/i.test(err.message)) {
        message =
          'Ürün görseli URL\'si Shopier formatına uymuyor. Render\'da SHOPIER_PRODUCT_IMAGE_URL değişkenini silin veya .jpg/.png ile biten bir adres yazın (ör. https://site.com/image.jpg). Varsayılan: BASE_URL/product-cover.jpg';
      } else if (err.message.includes('401') || err.message.includes('Unauthorized') || err.message.includes('PAT')) {
        message = 'Shopier PAT geçersiz. SHOPIER_PAT alanına Kişisel Erişim Anahtarını yazın (Client ID değil).';
      } else if (err.message.includes('shopSlug') || err.message.includes('shop')) {
        message = 'Mağaza slug hatalı. SHOPIER_SHOP_SLUG değerini kontrol edin.';
      } else {
        message = err.message;
      }
    }

    if (typeof err.toSafeJSON === 'function') {
      console.error('[pay] details', err.toSafeJSON());
    }

    return res.status(500).json({ error: message });
  }
});

/**
 * Dev-only: simulate successful payment without Shopier (paid mode local testing).
 */
if (process.env.NODE_ENV !== 'production' && isPaidMode()) {
  app.get('/api/payment/dev-confirm/:draftId', async (req, res) => {
    try {
      const site = await fulfillPayment(req.params.draftId, `dev-${Date.now()}`);
      if (!site) return res.status(404).send('Draft not found');
      return res.redirect(`${BASE_URL}/success/${req.params.draftId}`);
    } catch (err) {
      console.error('[dev-confirm]', err);
      return res.status(500).send('Dev confirm failed');
    }
  });
}

/**
 * GET /api/success/:id — JSON payload for success screen.
 */
app.get('/api/success/:id', async (req, res) => {
  const site = await store.findById(req.params.id);
  if (!site) return res.status(404).json({ error: 'Not found' });
  if (!site.isPaid) return res.status(402).json({ error: 'Payment required' });

  return res.json({
    id: site.id,
    partnerName: site.partnerName,
    plan: site.plan || getAppMode(),
    siteUrl: `${BASE_URL}/s/${site.id}`,
    qrCodeUrl: site.qrCodePath ? `${BASE_URL}/${site.qrCodePath}` : null,
    createdAt: site.createdAt,
  });
});

/* ═══════════════════════════════════════ */
/* PUBLIC SURPRISE PAGE                    */
/* ═══════════════════════════════════════ */

/**
 * GET /s/:id — Dynamic romantic page (paid only).
 */
app.get('/s/:id', async (req, res) => {
  try {
    const site = await store.findById(req.params.id);
    if (!site) {
      return res.status(404).sendFile(path.join(ROOT, 'not-found.html'));
    }

    const allowPreview = req.query.preview === 'unpaid' && process.env.NODE_ENV !== 'production';

    if (!site.isPaid && !allowPreview) {
      return res.redirect(`${BASE_URL}/payment-pending?id=${site.id}`);
    }

    const html = await renderSurprisePage(site, BASE_URL);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    console.error('[s/:id]', err);
    return res.status(500).send('Failed to render surprise page.');
  }
});

/* ═══════════════════════════════════════ */
/* STATIC PAGES                            */
/* ═══════════════════════════════════════ */

app.get('/success/:id', (_req, res) => {
  res.sendFile(path.join(ROOT, 'success.html'));
});

app.get('/payment-return', (req, res) => {
  const draftId =
    req.query.platform_order_id ||
    req.query.order_id ||
    req.query.draft ||
    req.query.id;

  if (draftId && /^v2026-[a-f0-9]+$/i.test(String(draftId))) {
    return res.redirect(`${BASE_URL}/success/${draftId}`);
  }

  res.sendFile(path.join(ROOT, 'payment-return.html'));
});

app.get('/payment-pending', (_req, res) => {
  res.sendFile(path.join(ROOT, 'payment-pending.html'));
});

app.get('/payment-failed', (_req, res) => {
  res.sendFile(path.join(ROOT, 'payment-failed.html'));
});

app.get('/', (_req, res) => {
  res.redirect('/dashboard.html');
});

app.use(express.static(ROOT));

/* ─── Error handler ─── */
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: err.message || 'Internal server error' });
});

/* ─── Boot ─── */
async function start() {
  await store.connect();
  app.listen(PORT, () => {
    const config = getPublicConfig();
    console.log(`\n  Valentine Surprise server running`);
    console.log(`  Local:   ${BASE_URL}`);
    console.log(`  Storage: ${store.mode}`);
    console.log(`  Mode:    ${config.mode} (${config.priceDisplay})`);
    console.log(`  Shopier: ${isPaymentConfigured() ? 'payment ready' : 'payment not configured'}\n`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
