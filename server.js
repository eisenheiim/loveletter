require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const store = require('./lib/store');
const { generateSiteId } = require('./lib/generateId');
const { createPaymentRequest, parseCallback, isConfigured } = require('./lib/shopier');
const { generateQrForSite } = require('./lib/qr');
const { renderSurprisePage } = require('./lib/renderSurprise');

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

/* Shopier callback must receive urlencoded body */
app.use('/api/payment/callback', express.urlencoded({ extended: false }));

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
        isPaid: false,
        buyerEmail: req.body.buyerEmail || null,
        buyerPhone: req.body.buyerPhone || null,
      });

      return res.status(201).json({
        draftId: draft.id,
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
 * Initializes Shopier checkout for a draft.
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

    /* Dev mock when Shopier credentials are not configured */
    if (!isConfigured() && process.env.NODE_ENV !== 'production') {
      return res.json({
        mock: true,
        message: 'Shopier not configured — using dev checkout.',
        checkoutUrl: `${BASE_URL}/api/payment/dev-confirm/${draftId}`,
      });
    }

    const payment = createPaymentRequest({
      draftId,
      buyerName: draft.senderName,
      buyerEmail: buyerEmail || draft.buyerEmail,
      buyerPhone: buyerPhone || draft.buyerPhone,
    });

    return res.json({
      draftId,
      checkoutUrl: payment.checkoutUrl,
      checkoutHtml: payment.checkoutHtml,
    });
  } catch (err) {
    console.error('[pay]', err);
    return res.status(500).json({ error: 'Failed to initialize payment.' });
  }
});

/**
 * POST /api/payment/callback
 * Shopier OSB notification — verify signature, mark paid, generate QR.
 */
app.post('/api/payment/callback', async (req, res) => {
  try {
    const result = parseCallback(req.body);

    if (!result.verified) {
      console.warn('[payment/callback] Invalid signature:', result.reason);
      return res.status(400).send('Invalid signature');
    }

    if (!result.success) {
      return res.redirect(`${BASE_URL}/payment-failed?draft=${result.draftId}`);
    }

    const site = await fulfillPayment(result.draftId, result.paymentId);
    if (!site) {
      return res.status(404).send('Draft not found');
    }

    /* Shopier expects a redirect after server-side notification handling */
    return res.redirect(`${BASE_URL}/success/${result.draftId}`);
  } catch (err) {
    console.error('[payment/callback]', err);
    return res.status(500).send('Callback processing failed');
  }
});

/**
 * Dev-only: simulate successful Shopier payment without credentials.
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

  return res.json({
    id: site.id,
    partnerName: site.partnerName,
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
    console.log(`\n  Valentine Surprise server running`);
    console.log(`  Local:   ${BASE_URL}`);
    console.log(`  Storage: ${store.mode}`);
    console.log(`  Shopier: ${isConfigured() ? 'configured' : 'not configured (dev mock enabled)'}\n`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
