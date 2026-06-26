const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'surprises.json');

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, '[]', 'utf8');
  }
}

async function readAll() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

async function writeAll(records) {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function normalize(record) {
  if (!record) return null;
  return {
    ...record,
    createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
    updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
  };
}

const jsonStore = {
  async create(data) {
    const records = await readAll();
    const now = new Date().toISOString();
    const record = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    records.push(record);
    await writeAll(records);
    return normalize(record);
  },

  async findById(id) {
    const records = await readAll();
    const found = records.find((r) => r.id === id);
    return normalize(found);
  },

  async findByShopierProductId(productId) {
    const records = await readAll();
    const found = records.find((r) => r.shopierProductId === productId);
    return normalize(found);
  },

  async findUnpaidByBuyerEmail(email) {
    const records = await readAll();
    const matches = records
      .filter((r) => !r.isPaid && String(r.buyerEmail || '').trim().toLowerCase() === email)
      .sort((a, b) => {
        const aTime = new Date(a.checkoutStartedAt || a.createdAt).getTime();
        const bTime = new Date(b.checkoutStartedAt || b.createdAt).getTime();
        return bTime - aTime;
      });
    return normalize(matches[0]);
  },

  async findMostRecentPendingCheckout({ maxAgeMs = 2 * 60 * 60 * 1000 } = {}) {
    const cutoff = Date.now() - maxAgeMs;
    const records = await readAll();
    const matches = records
      .filter((r) => {
        if (r.isPaid || !r.checkoutStartedAt) return false;
        return new Date(r.checkoutStartedAt).getTime() >= cutoff;
      })
      .sort(
        (a, b) =>
          new Date(b.checkoutStartedAt).getTime() - new Date(a.checkoutStartedAt).getTime()
      );
    return normalize(matches[0]);
  },

  async updateById(id, patch) {
    const records = await readAll();
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) return null;

    records[index] = {
      ...records[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await writeAll(records);
    return normalize(records[index]);
  },
};

module.exports = jsonStore;
