const mongoose = require('mongoose');

const surpriseSiteSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    senderName: { type: String, required: true, trim: true },
    partnerName: { type: String, required: true, trim: true },
    mainMessage: { type: String, required: true, trim: true },
    lovePoints: { type: [String], default: [] },
    images: { type: [String], default: [] },
    musicTrack: { type: String, default: 'romantic-piano' },
    isPaid: { type: Boolean, default: false },
    plan: { type: String, enum: ['free', 'paid'], default: 'free' },
    qrCodePath: { type: String, default: null },
    shopierPaymentId: { type: String, default: null },
    buyerEmail: { type: String, default: null },
    buyerPhone: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    versionKey: false,
  }
);

module.exports =
  mongoose.models.SurpriseSite || mongoose.model('SurpriseSite', surpriseSiteSchema);
