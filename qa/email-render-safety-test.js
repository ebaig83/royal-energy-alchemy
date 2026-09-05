'use strict';
const assert = require('assert');
const { renderTemplate, humanDate, humanTime, locationLabel } = require('../netlify/functions/lib/email-render');

assert.strictEqual(humanDate('2026-09-07'), 'Monday, September 7, 2026');
assert.strictEqual(humanTime('14:30:00'), '2:30 PM');
assert.strictEqual(locationLabel('distance'), 'Remote session');
assert.strictEqual(locationLabel('distance', 'https://meet.google.com/abc'), 'Remote — Google Meet');

const rendered = renderTemplate({
  subject: 'Confirmed — {{session_date}}',
  html_body: 'Dear {{client_name}}, {{session_time}} {{timezone}} {{#if duration}}for {{duration}}{{/if}}',
  text_body: 'Dear {{client_name}}, {{session_time}} {{timezone}}',
}, { client_name: '', session_date: '2026-09-07', session_time: '10:00', timezone: 'EST', duration_minutes: 60 });
assert(rendered.html.includes('Hello,'));
assert(rendered.html.includes('10:00 AM ET'));
assert(rendered.html.includes('60 minutes'));
assert(rendered.subject.includes('Monday, September 7, 2026'));

assert.throws(() => renderTemplate({
  subject: 'Broken {{missing}}', html_body: '<p>Safe</p>', text_body: '',
}, {}), error => error.code === 'EMAIL_RENDER_INCOMPLETE' && error.unresolvedCount === 1);

assert.throws(() => renderTemplate({
  subject: 'Manage', html_body: '<a href="{{manage_url}}">Manage</a>', text_body: '',
}, { manage_url: '' }), error => error.code === 'EMAIL_INVALID_URL');
assert.throws(() => renderTemplate({
  subject: 'Session', html_body: '<p>{{service}}</p>', text_body: '',
}, { service: '' }), error => error.code === 'EMAIL_RENDER_INCOMPLETE');

console.log('email render safety tests: 11/11 passed');
