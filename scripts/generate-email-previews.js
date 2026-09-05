'use strict';

// Local-only preview generator. It never initializes Supabase or Resend.
const fs = require('fs');
const path = require('path');
const { renderTemplate } = require('../netlify/functions/lib/email-render');

const outDir = path.join(__dirname, '..', 'qa', 'email-previews', '2026-09-05');
const sample = {
  client_name: 'Preview Client', service: 'Distance Energy Session',
  session_date: '2026-09-07', appointment_date: '2026-09-07',
  session_time: '10:00', appointment_time: '10:00', timezone: 'ET',
  duration_minutes: 60, duration: '60 minutes', location: 'Remote — Google Meet',
  old_date: '2026-09-07', old_time: '10:00', new_date: '2026-09-09', new_time: '14:30',
  manage_url: '#preview-only', intake_url: '#preview-only', waiver_url: '#preview-only',
  payment_url: '#preview-only', retry_url: '#preview-only', followup_url: '#preview-only',
  google_meet_url: '#preview-only', dashboard_url: '#preview-only',
  contact_email: 'droyal168@gmail.com', session_reference: 'PREVIEW-SESSION',
  payment_reference: 'PREVIEW-PAYMENT', refund_reference: 'PREVIEW-REFUND',
  amount_paid: '165.00', refunded_amount: '165.00',
  refund_summary: 'Full refund approved.',
  policy_line_1: '72+ hours notice: Full refund or session credit',
  policy_line_2: '24–72 hours notice: 50% refund or session credit',
  policy_line_3: 'Less than 24 hours: Non-refundable',
  policy_line_4: 'No-show: Non-refundable — must prepay to rebook',
  message_body: 'Daron is checking in after your session.',
  recommendations_list: '<ul><li>Rest and hydrate.</li><li>Notice changes gently.</li></ul>',
  notes: 'Reply to this email if you have questions.', subject: 'A note from Daron',
  invoice_number: 'PREVIEW-1001', amount_due: '$165.00', due_date: '2026-09-06',
  package_name: 'Three Session Package', sessions_remaining: '2', expiration_date: '2026-12-31',
};

const shell = (title, content) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>a[href="#preview-only"]{pointer-events:none;display:inline-block;background:#e8b84b;color:#160a00!important;text-decoration:none;padding:13px 20px;margin:8px 4px 8px 0;font:700 10px Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;border:1px solid #f4d77a}</style></head><body style="margin:0;background:#04020e;color:#f0ecff;font-family:Georgia,serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#04020e"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#100b20;border:1px solid #8b6a2d;box-shadow:0 18px 60px rgba(0,0,0,.55)"><tr><td align="center" style="padding:12px;background:#281e09;color:#f4d77a;font:10px Arial,sans-serif;letter-spacing:.25em">LOCAL PREVIEW ONLY · ACTIONS DISABLED</td></tr><tr><td align="center" style="padding:34px 38px 28px;border-bottom:1px solid rgba(232,184,75,.28)"><p style="margin:0 0 14px;color:#e8b84b;font-size:11px;letter-spacing:.42em">ROYAL ENERGY ALCHEMY</p><div style="width:62px;height:2px;background:#e8b84b;margin:auto"></div><h1 style="margin:22px 0 0;color:#e8b84b;font-size:30px;font-weight:normal;line-height:1.25">${title}</h1></td></tr><tr><td style="padding:34px 40px;color:#d8d4f0;font-size:16px;line-height:1.75">${content}<div style="height:1px;background:rgba(232,184,75,.24);margin:30px 0 24px"></div><p style="margin:0">Questions? Contact Daron at <a style="color:#e8b84b" href="mailto:{{contact_email}}">{{contact_email}}</a><br>814-392-2095</p></td></tr><tr><td align="center" style="padding:24px;border-top:1px solid rgba(232,184,75,.2);color:#8f88aa;font-size:12px;line-height:1.7"><span style="color:#e8b84b;letter-spacing:.18em">ROYAL ENERGY ALCHEMY LLC</span><br>Erie, Pennsylvania</td></tr></table></td></tr></table></body></html>`;
const cta = (label, url) => `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#e8b84b;color:#160a00;text-decoration:none;padding:14px 22px;font:700 11px Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase">${label} · Preview only</a></p>`;
const details = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:#0a0715;border:1px solid rgba(232,184,75,.32)"><tr><td style="padding:20px 24px"><p style="margin:0 0 14px;color:#e8b84b;font:10px Arial,sans-serif;letter-spacing:.3em">YOUR SESSION</p><p style="margin:6px 0"><span style="color:#938aaa">Service</span><br><strong>{{service}}</strong></p><p style="margin:12px 0 6px"><span style="color:#938aaa">Date</span><br>{{session_date}}</p><p style="margin:12px 0 6px"><span style="color:#938aaa">Time</span><br>{{session_time}} {{timezone}}</p><p style="margin:12px 0 6px"><span style="color:#938aaa">Duration</span><br>{{duration}}</p><p style="margin:12px 0 0"><span style="color:#938aaa">Location</span><br>{{location}}</p></td></tr></table>';
const templates = [
  ['booking_received_pending_payment','Booking received — complete waiver and payment','Client','Online booking before payment',shell('Booking Received','<p>Dear {{client_name}},</p><p>We received your request.</p>'+details+'<p>Your appointment is not confirmed yet.</p><p><a href="{{waiver_url}}">Complete waiver and payment</a></p>')],
  ['intake_invitation','Please complete your intake — Royal Energy Alchemy','Client','Online booking created',shell('Complete Your Intake','<p>Dear {{client_name}},</p><p>Please complete your intake for {{service}}.</p><p><a href="{{intake_url}}">Complete intake form</a></p>')],
  ['intake_received','Intake received — Royal Energy Alchemy','Client','Intake submitted',shell('Intake Received','<p>Dear {{client_name}},</p><p>Your intake for {{service}} has been received. No further action is needed.</p>')],
  ['appointment_confirmation','Your appointment is confirmed — Royal Energy Alchemy','Client','Session created/confirmed',shell('Appointment Confirmed','<p>Dear {{client_name}},</p>'+details+'<p>Duration: {{duration}}<br>Location: {{location}}</p><p><a href="{{manage_url}}">Manage appointment</a></p>')],
  ['stripe_payment_confirmed_client','Payment received — appointment confirmed','Client','Stripe payment succeeded',shell('Payment Confirmed','<p>Dear {{client_name}},</p>'+details+'<p>Amount paid: ${{amount_paid}}</p><p><a href="{{manage_url}}">Manage appointment</a></p>')],
  ['stripe_payment_confirmed_practitioner','New paid booking — {{client_name}}','Daron','Stripe payment succeeded',shell('New Paid Booking','<p>Client: {{client_name}}</p>'+details+'<p>Amount: ${{amount_paid}}</p><p><a href="{{dashboard_url}}">Open dashboard</a></p>')],
  ['session_google_meet_ready','Your Google Meet link — Royal Energy Alchemy','Client','Calendar/Meet sync ready',shell('Google Meet Ready','<p>Hi {{client_name}},</p>'+details+'<p><a href="{{google_meet_url}}">Join Google Meet</a></p>')],
  ['appointment_reminder','Appointment reminder — Royal Energy Alchemy','Client','Scheduled or dashboard reminder',shell('Appointment Reminder','<p>Hi {{client_name}},</p>'+details+'{{#if google_meet_url}}<p><a href="{{google_meet_url}}">Join Google Meet</a></p>{{/if}}<p><a href="{{manage_url}}">Manage appointment</a></p>')],
  ['session_30_minute_reminder','Your session starts in 30 minutes','Client','Scheduled 30-minute reminder',shell('Starting Soon','<p>Hi {{client_name}},</p>'+details+'{{#if google_meet_url}}<p><a href="{{google_meet_url}}">Join Google Meet</a></p>{{/if}}')],
  ['appointment_rescheduled','Appointment rescheduled — Royal Energy Alchemy','Client','Client reschedules',shell('Appointment Rescheduled','<p>Dear {{client_name}},</p><p>Previous: {{old_date}} at {{old_time}} {{timezone}}<br>New: {{new_date}} at {{new_time}} {{timezone}}</p><p><a href="{{manage_url}}">Manage appointment</a></p>')],
  ['appointment_cancelled','Appointment cancelled — Royal Energy Alchemy','Client','Client cancels',shell('Appointment Cancelled','<p>Dear {{client_name}},</p>'+details+'<p>{{refund_summary}}</p><p>{{policy_line_1}}<br>{{policy_line_2}}<br>{{policy_line_3}}<br>{{policy_line_4}}</p>')],
  ['stripe_refund_confirmed_client','Refund confirmed — Royal Energy Alchemy','Client','Stripe refund confirmed',shell('Refund Confirmed','<p>Dear {{client_name}},</p><p>Refunded: ${{refunded_amount}}<br>Reference: {{refund_reference}}</p>')],
  ['stripe_refund_confirmed_practitioner','Refund processed — {{client_name}}','Daron','Stripe refund confirmed',shell('Refund Processed','<p>Client: {{client_name}}<br>Refunded: ${{refunded_amount}}<br>Reference: {{refund_reference}}</p>')],
  ['stripe_payment_failed_client','Payment was not completed — retry securely','Client','Stripe payment failed',shell('Payment Not Completed','<p>Dear {{client_name}},</p><p>Your payment for {{service}} was not completed.</p><p><a href="{{retry_url}}">Return to secure payment</a></p>')],
  ['practitioner_waiver_link','Your Royal Energy Alchemy waiver is ready','Client','Dashboard Send Waiver',shell('Complete Your Waiver','<p>Hi {{client_name}},</p>'+details+'<p><a href="{{waiver_url}}">Complete waiver</a></p>')],
  ['practitioner_payment_link','Your Royal Energy Alchemy payment link is ready','Client','Dashboard Send Payment Link',shell('Complete Payment','<p>Hi {{client_name}},</p>'+details+'<p><a href="{{payment_url}}">Complete secure payment</a></p>')],
  ['followup_scheduled','Following up — Royal Energy Alchemy','Client','Aftercare created',shell('Following Up','<p>Dear {{client_name}},</p><p>{{message_body}}</p><p><a href="{{followup_url}}">Complete private follow-up</a></p>')],
  ['session_72_hour_followup','How are you feeling after your session?','Client','Scheduled 72-hour follow-up',shell('How Are You Feeling?','<p>Hi {{client_name}},</p><p><a href="{{followup_url}}">Complete your private follow-up</a></p>')],
  ['recommendation_delivery','Your personalized recommendations — Royal Energy Alchemy','Client','Dashboard template send',shell('Your Recommendations','<p>Hello {{client_name}},</p>{{recommendations_list}}<p>{{notes}}</p>')],
  ['invoice_notification','Invoice {{invoice_number}} — Royal Energy Alchemy','Client','Dashboard template send',shell('Invoice {{invoice_number}}','<p>Hello {{client_name}},</p><p>Amount due: {{amount_due}}<br>Due: {{due_date}}</p>')],
  ['package_expiration_warning','Your session package expires soon','Client','Dashboard template send',shell('Package Expiring','<p>Hello {{client_name}},</p><p>{{package_name}} expires {{expiration_date}}.<br>Sessions remaining: {{sessions_remaining}}</p>')],
  ['general_message','{{subject}} — Royal Energy Alchemy','Client','Dashboard template/freeform send',shell('{{subject}}','<p>Hello {{client_name}},</p><p>{{message_body}}</p>')],
];

fs.mkdirSync(outDir, { recursive: true });
const rows = [];
for (const [name, subject, recipient, trigger, html] of templates) {
  const template = { subject, html_body: html, text_body: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
  const rendered = renderTemplate(template, sample);
  fs.writeFileSync(path.join(outDir, `${name}.html`), rendered.html);
  fs.writeFileSync(path.join(outDir, `${name}.txt`), `Subject: ${rendered.subject}\nRecipient type: ${recipient}\n\n${rendered.text}\n`);
  rows.push(`<tr><td>${name}</td><td>${trigger}</td><td>${recipient}</td><td><a href="${name}.html">HTML</a> · <a href="${name}.txt">Text</a></td></tr>`);
}
const index = `<!doctype html><html><head><meta charset="utf-8"><title>Email Preview Inventory</title><style>body{font:16px system-ui;background:#faf8f2;color:#20172e;padding:32px}table{border-collapse:collapse;width:100%}th,td{padding:10px;border:1px solid #bbb;text-align:left}th{background:#2b173f;color:white}</style></head><body><h1>Royal Energy Alchemy — Safe Email Previews</h1><p>Fictional data only. No messages were sent.</p><table><thead><tr><th>Email</th><th>Trigger</th><th>Recipient</th><th>Preview</th></tr></thead><tbody>${rows.join('')}</tbody></table></body></html>`;
fs.writeFileSync(path.join(outDir, 'index.html'), index);
console.log(`Generated ${templates.length} email previews in ${outDir}`);
