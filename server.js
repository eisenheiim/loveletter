require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const store = require('./lib/store');
const { generateSiteId } = require('./lib/generateId');
const { createPaymentRequest, handleWebhook, extractDraftIdFromOrder, isPaymentConfigured, deleteShopierProduct, listCheckoutListingProducts, deleteAllCheckoutListingProducts } = require('./lib/shopier');
const { generateQrForSite, buildWhatsAppShareUrl } = require('./lib/qr');
const { renderSurprisePage } = require('./lib/renderSurprise');
const { getAppMode, getPublicConfig } = require('./lib/mode');

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
    limits: { fileSize: 8 * 1024 * 1024, files: 5 },
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
  const updated = await store.updateById(draftId, { qrCodePath: relativePath });

  if (site.shopierProductId) {
    deleteShopierProduct(site.shopierProductId).catch((err) => {
      console.warn('[shopier] post-payment product cleanup failed', site.shopierProductId, err.message);
    });
  }

  return updated;
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
 * GET /api/shopier/listing-products — leftover custom-listing products in Shopier.
 */
app.get('/api/shopier/listing-products', async (_req, res) => {
  if (!isPaymentConfigured()) {
    return res.status(503).json({ error: 'Shopier is not configured.' });
  }
  try {
    const products = await listCheckoutListingProducts();
    return res.json({
      products: products.map((p) => ({
        id: p.id,
        title: p.title,
        dateCreated: p.dateCreated || null,
      })),
    });
  } catch (err) {
    console.error('[shopier/listing-products]', err);
    return res.status(500).json({ error: 'Could not load Shopier products.' });
  }
});

/**
 * DELETE /api/shopier/listing-products/:id
 */
app.delete('/api/shopier/listing-products/:id', async (req, res) => {
  if (!isPaymentConfigured()) {
    return res.status(503).json({ error: 'Shopier is not configured.' });
  }
  try {
    await deleteShopierProduct(req.params.id);
    return res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    console.error('[shopier/delete-product]', err);
    return res.status(500).json({ error: 'Could not delete Shopier product.' });
  }
});

/**
 * POST /api/shopier/listing-products/cleanup — delete all custom-listing products.
 */
app.post('/api/shopier/listing-products/cleanup', async (_req, res) => {
  if (!isPaymentConfigured()) {
    return res.status(503).json({ error: 'Shopier is not configured.' });
  }
  try {
    const result = await deleteAllCheckoutListingProducts();
    return res.json(result);
  } catch (err) {
    console.error('[shopier/cleanup]', err);
    return res.status(500).json({ error: 'Could not clean up Shopier products.' });
  }
});

/**
 * POST /api/create-draft
 * Saves form data + uploaded images as an unpaid draft.
 */
app.post(
  '/api/create-draft',
  assignDraftId,
  upload.array('images', 5),
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
 * POST /api/pay — Shopier checkout.
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

    if (!isPaymentConfigured()) {
      return res.status(503).json({
        error:
          'Shopier payment is not configured. Set SHOPIER_PAT and SHOPIER_SHOP_SLUG on the server.',
        mode: 'paid',
        shopierConfigured: false,
        hint: 'PAT = Personal Access Token (not Client ID)',
      });
    }

    if (draft.shopierProductId) {
      deleteShopierProduct(draft.shopierProductId).catch(() => {});
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

    let message = 'Payment could not be started. Check your Shopier settings.';
    if (err.message) {
      if (/invalid media url|media\[0\]\.url/i.test(err.message)) {
        message =
          'Product image URL is invalid for Shopier. Remove SHOPIER_PRODUCT_IMAGE_URL or use a URL ending in .jpg or .png. Default: BASE_URL/product-cover.jpg';
      } else if (err.message.includes('401') || err.message.includes('Unauthorized') || err.message.includes('PAT')) {
        message = 'Invalid Shopier PAT. Set SHOPIER_PAT to your Personal Access Token (not Client ID).';
      } else if (err.message.includes('shopSlug') || err.message.includes('shop')) {
        message = 'Invalid shop slug. Check SHOPIER_SHOP_SLUG.';
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
if (process.env.NODE_ENV !== 'production') {
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

  const siteUrl = `${BASE_URL}/s/${site.id}`;
  const qrCodeUrl = site.qrCodePath ? `${BASE_URL}/${site.qrCodePath}` : null;

  return res.json({
    id: site.id,
    partnerName: site.partnerName,
    plan: site.plan || getAppMode(),
    siteUrl,
    qrCodeUrl,
    whatsappShareUrl: buildWhatsAppShareUrl(siteUrl, site.partnerName),
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
