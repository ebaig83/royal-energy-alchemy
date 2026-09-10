'use strict';

const { SERVICES } = require('./lib/services');

const CATALOG_VERSION = 'v1';

function respond(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

function publicCatalog() {
  return SERVICES.map(service => ({
    id: service.id,
    label: service.label,
    price: service.price,
    priceNote: service.priceNote || null,
    duration: service.duration,
    publicBookable: true,
  }));
}

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed.' });
  return respond(200, {
    services: publicCatalog(),
    source: 'canonical',
    version: CATALOG_VERSION,
  }, {
    'Cache-Control': 'public, max-age=300',
  });
};
