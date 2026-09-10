'use strict';

const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/public-service-catalog');
const { SERVICES, findService } = require('../netlify/functions/lib/services');

(async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'public, max-age=300');
  const body = JSON.parse(response.body);
  assert.equal(body.source, 'canonical');
  assert.equal(body.version, 'v1');
  assert.equal(body.services.length, 11);
  assert.deepEqual(body.services.map(service => service.id), SERVICES.map(service => service.id));
  assert.deepEqual(body.services.map(service => service.price), SERVICES.map(service => service.price));
  assert.deepEqual(body.services.map(service => service.duration), SERVICES.map(service => service.duration));
  assert.ok(body.services.every(service => service.publicBookable === true));
  assert.notEqual(body.services.find(service => service.id === 'heavy-duty-removal'), body.services.find(service => service.id === 'exorcism-session'));
  assert.ok(body.services.some(service => service.id === 'emergency-removal-session'));
  for (const service of body.services) {
    assert.deepEqual(Object.keys(service).sort(), ['duration', 'id', 'label', 'price', 'priceNote', 'publicBookable']);
    assert.equal(Object.prototype.hasOwnProperty.call(service, 'aliases'), false);
  }
  const invalid = findService('not-a-canonical-service');
  assert.equal(invalid, null);
  const bookingSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'netlify/functions/booking.js'), 'utf8');
  assert.match(bookingSource, /const serviceInfo = findService\(service\)/);
  assert.match(bookingSource, /amount_due:\s*serviceInfo\.price/);
  const methodResponse = await handler({ httpMethod: 'POST' });
  assert.equal(methodResponse.statusCode, 405);
  console.log('PASS public canonical service catalog contract and server-side booking price authority');
})().catch(error => { console.error(error); process.exitCode = 1; });
