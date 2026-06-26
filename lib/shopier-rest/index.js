'use strict';

const config = require('./config');
const http = require('./http');
const payment = require('./payment');
const webhook = require('./webhook');

module.exports = {
  ...config,
  ...http,
  ...payment,
  ...webhook,
};
