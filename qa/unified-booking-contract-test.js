'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];

function check(name, condition) {
  if (condition) console.log(`PASS ${name}`);
  else {
    console.error(`FAIL ${name}`);
    failures.push(name);
  }
}

const index = read('index.html');
const nav = read('site-nav.js');
const portal = read('client-portal.html');
const pay = read('pay.html');
const waiver = read('waiver-esign.html');
const redirects = read('netlify.toml');

function inlineScriptsAreValid(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/type=["']application\/ld\+json["']/i.test(match[1]))
    .map(match => match[2]);
  try {
    scripts.forEach((source, index) => new vm.Script(source, { filename: `index-inline-${index + 1}.js` }));
    return scripts.length > 0;
  } catch (error) {
    console.error(error.message);
    return false;
  }
}

check('canonical form contains the combined customer fields',
  /id="bookingForm"/.test(index) &&
  /id="cf-fname"/.test(index) &&
  /id="cf-lname"/.test(index) &&
  /id="cf-email"/.test(index) &&
  /id="cf-phone"/.test(index) &&
  /id="cf-service"/.test(index) &&
  /id="cf-message"/.test(index));

check('canonical form retains live availability and slot selection',
  /\.netlify\/functions\/availability/.test(index) &&
  /_clientSlot1\.id/.test(index));

check('canonical form submits directly to existing booking backend',
  /fetch\('\/\.netlify\/functions\/booking'/.test(index) &&
  /slot_id:_clientSlot1\.id/.test(index) &&
  /result\.data\.waiver_url/.test(index));

check('homepage inline JavaScript syntax is valid', inlineScriptsAreValid(index));

check('public booking links use the canonical destination',
  !/\/book\.html/.test([index, nav, portal, pay, waiver].join('\n')) &&
  /href=["']\/?#contact["']/.test(index) &&
  /\/#contact/.test(nav));

check('legacy booking URLs redirect to the canonical destination',
  /from = "\/book"[\s\S]*?to = "\/#contact"[\s\S]*?status = 301[\s\S]*?force = true/.test(redirects) &&
  /from = "\/book\.html"[\s\S]*?to = "\/#contact"[\s\S]*?status = 301[\s\S]*?force = true/.test(redirects));

if (failures.length) process.exit(1);
console.log('Unified booking contract: all checks passed.');
