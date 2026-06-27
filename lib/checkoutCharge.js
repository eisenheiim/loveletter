'use strict';

const CHECKOUT_CHARGE_AMOUNT = (process.env.CHECKOUT_CHARGE_AMOUNT || '42.00').trim();
const CHECKOUT_CHARGE_CURRENCY = (process.env.CHECKOUT_CHARGE_CURRENCY || 'TRY').trim().toUpperCase();
const CHECKOUT_ITEM_NAME = (process.env.CHECKOUT_ITEM_NAME || 'Personalized Love Letter Webpage').trim();

function getCheckoutChargeAmount() {
  return CHECKOUT_CHARGE_AMOUNT;
}

function getCheckoutChargeCurrency() {
  return CHECKOUT_CHARGE_CURRENCY;
}

function getCheckoutItemName() {
  return CHECKOUT_ITEM_NAME;
}

module.exports = {
  CHECKOUT_CHARGE_AMOUNT,
  CHECKOUT_CHARGE_CURRENCY,
  CHECKOUT_ITEM_NAME,
  getCheckoutChargeAmount,
  getCheckoutChargeCurrency,
  getCheckoutItemName,
};
