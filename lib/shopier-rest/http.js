'use strict';

const { getShopierPat, getShopierApiBaseUrl } = require('./config');

class ShopierApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'ShopierApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Minimal Shopier REST client (Bearer PAT).
 */
async function shopierRequest(path, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  const pat = getShopierPat();
  if (!pat) {
    throw new ShopierApiError('SHOPIER_PAT is not configured');
  }

  const url = `${getShopierApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }

    if (!response.ok) {
      const message =
        parsed?.message ||
        parsed?.error_description ||
        parsed?.error ||
        `Shopier API request failed (${response.status})`;
      throw new ShopierApiError(message, { status: response.status, body: parsed });
    }

    return parsed;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ShopierApiError('Shopier API request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  ShopierApiError,
  shopierRequest,
};
