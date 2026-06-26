const mongoose = require('mongoose');
const SurpriseSite = require('../models/SurpriseSite');
const jsonStore = require('./jsonStore');

let mode = 'json';

async function connect() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    mode = 'json';
    console.log('[store] Using local JSON storage (data/surprises.json)');
    return;
  }

  await mongoose.connect(uri);
  mode = 'mongo';
  console.log('[store] Connected to MongoDB');
}

function toPlain(doc) {
  if (!doc) return null;
  if (typeof doc.toObject === 'function') {
    return doc.toObject();
  }
  return doc;
}

const store = {
  get mode() {
    return mode;
  },

  connect,

  async create(data) {
    if (mode === 'mongo') {
      const doc = await SurpriseSite.create(data);
      return toPlain(doc);
    }
    return jsonStore.create(data);
  },

  async findById(id) {
    if (mode === 'mongo') {
      const doc = await SurpriseSite.findOne({ id });
      return toPlain(doc);
    }
    return jsonStore.findById(id);
  },

  async findByShopierProductId(productId) {
    if (mode === 'mongo') {
      const doc = await SurpriseSite.findOne({ shopierProductId: productId });
      return toPlain(doc);
    }
    return jsonStore.findByShopierProductId(productId);
  },

  async findUnpaidByBuyerEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return null;

    if (mode === 'mongo') {
      const doc = await SurpriseSite.findOne({
        isPaid: false,
        buyerEmail: { $regex: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      }).sort({ checkoutStartedAt: -1, createdAt: -1 });
      return toPlain(doc);
    }
    return jsonStore.findUnpaidByBuyerEmail(normalized);
  },

  async findMostRecentPendingCheckout({ maxAgeMs = 2 * 60 * 60 * 1000 } = {}) {
    const cutoff = Date.now() - maxAgeMs;

    if (mode === 'mongo') {
      const doc = await SurpriseSite.findOne({
        isPaid: false,
        checkoutStartedAt: { $gte: new Date(cutoff) },
      }).sort({ checkoutStartedAt: -1 });
      return toPlain(doc);
    }
    return jsonStore.findMostRecentPendingCheckout({ maxAgeMs });
  },

  async updateById(id, patch) {
    if (mode === 'mongo') {
      const doc = await SurpriseSite.findOneAndUpdate({ id }, patch, {
        new: true,
        runValidators: true,
      });
      return toPlain(doc);
    }
    return jsonStore.updateById(id, patch);
  },

  async markPaid(id, { shopierPaymentId } = {}) {
    const existing = await this.findById(id);
    if (!existing) return null;

    const patch = { isPaid: true };
    if (shopierPaymentId) patch.shopierPaymentId = shopierPaymentId;

    return this.updateById(id, patch);
  },
};

module.exports = store;
