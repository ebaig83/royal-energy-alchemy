const fs = require('fs');
const read = p => fs.readFileSync(p, 'utf8');
const waiver = read('netlify/functions/send-waiver.js');
const payment = read('netlify/functions/send-payment-link.js');
const checkout = read('netlify/functions/create-stripe-checkout.js');
const dash = read('dashboard.html');
const checks = [
  ['waiver endpoint requires admin auth', /requireAdmin\(event\)/.test(waiver)],
  ['payment endpoint requires admin auth', /requireAdmin\(event\)/.test(payment)],
  ['waiver resolves session server-side', /from\('sessions'\).*select\('id,client_id/.test(waiver)],
  ['payment resolves session server-side', /from\('sessions'\).*select\('id,client_id/.test(payment)],
  ['browser recipient is not accepted', !/body\.recipient|body\.email/.test(waiver+payment)],
  ['browser amount is not accepted', !/body\.(amount|price|currency)/.test(payment)],
  ['waiver completion is not mutated by send', !/waiver_completed\s*:\s*true/.test(waiver)],
  ['paid sessions are blocked', /already_paid/.test(payment)],
  ['waiver-before-payment enforced', /waiver_required/.test(payment)&&/Waiver must be completed/.test(checkout)],
  ['payment uses existing checkout architecture', /create-stripe-checkout/.test(payment)],
  ['transactional mailer reused', /sendTransactional/.test(waiver)&&/sendTransactional/.test(payment)],
  ['existing picker remains available', /dashSchedulePicker/.test(dash)],
  ['explicit reschedule confirmation remains', /confirmSupabaseReschedule/.test(dash)],
  ['existing card controls remain', /openSupabaseReschedulePanel/.test(dash)&&/sendSupabaseReminder/.test(dash)]
  ,['reschedule uses visual picker', /sbPickerRender/.test(dash)&&/sbPickerTimes/.test(dash)]
  ,['reschedule excludes current session', /String\(s\.id\)!==String\(exclude\)/.test(dash)]
  ,['reschedule requires explicit confirmation', /confirmSupabaseReschedule/.test(dash)]
  ,['reschedule preserves session id', /_supabaseSessionAction\(id/.test(dash)]
];
let failed=0; for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)failed++;}
console.log(`${checks.length-failed}/${checks.length} passed`); if(failed)process.exit(1);
