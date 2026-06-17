// /.netlify/functions/client-account
//
// PUBLIC helper for the portal account flow (Sprint 17, Phase A).
//
// POST { action: 'check_email', email }
//   → { eligible: bool, duplicate: bool }
//   Confirms an email belongs to exactly one existing booked client before the
//   browser calls Supabase Auth signUp. Prevents unrelated accounts and flags
//   duplicate emails for practitioner review (never auto-linked).
//
// Account linking + login tracking happen in client-portal (on first
// authenticated request), so no separate link endpoint is needed here.

'use strict';

const { respond }   = require('./lib/auth');
const { getClient } = require('./lib/supabase');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method not allowed.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return respond(400, { error: 'Invalid request body.' }); }

  if (body.action !== 'check_email') return respond(400, { error: 'Unknown action.' });

  const email = String(body.email || '').toLowerCase().trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return respond(400, { error: 'Please enter a valid email address.' });
  }

  const sb = getClient();
  const { data, error } = await sb.from('clients').select('id, duplicate_flag').eq('email', email);
  if (error) return respond(500, { error: 'Could not verify your email right now. Please try again.' });

  if (!data || data.length === 0) {
    return respond(200, {
      eligible: false, duplicate: false,
      message: 'We could not find a booking for that email. Please use the email you booked with, or book a session first.',
    });
  }
  if (data.length > 1) {
    // Flag for practitioner review; never auto-link duplicate emails.
    await sb.from('clients').update({ duplicate_flag: true }).eq('email', email);
    return respond(200, {
      eligible: false, duplicate: true,
      message: 'Multiple records share this email. Daron has been notified to review and merge your account.',
    });
  }

  return respond(200, { eligible: true, duplicate: false });
};
