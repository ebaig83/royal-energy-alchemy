'use strict';
// Temporary, read-only observer for the one already-created controlled session.
const crypto = require('crypto');
const { getClient } = require('./lib/supabase');
const { refreshAccessToken, eventId, meetUrl } = require('./lib/google-calendar');
const SESSION_ID = '7eb69bdf-479e-48f9-848b-953dbc1a1368';
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
exports.handler = async event => {
  const expected = process.env.GOOGLE_MEET_TEST_AUTH || '';
  const supplied = event.headers?.['x-google-meet-test-auth'] || '';
  const expires = Date.parse(process.env.GOOGLE_MEET_TEST_EXPIRES_AT || '');
  if (event.httpMethod !== 'GET' || !expected || !supplied || !Number.isFinite(expires) || Date.now() >= expires) return reply(404, {});
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return reply(404, {});
  try {
    const sb = getClient();
    const { data: session, error } = await sb.from('sessions').select('id,client_id,client_name,source,service').eq('id', SESSION_ID).single();
    if (error || session?.source !== 'controlled_google_meet_test' || session.client_name !== 'Google Meet Test' || session.service !== 'Distance Energy Session') return reply(404, {});
    const [{ data: client }, { count }] = await Promise.all([
      sb.from('clients').select('email').eq('id', session.client_id).single(),
      sb.from('audit_logs').select('id', { count: 'exact', head: true }).eq('action', 'controlled_google_meet_test_booking').eq('record_id', SESSION_ID),
    ]);
    if (client?.email?.toLowerCase() !== 'droyal168@gmail.com' || count !== 1) return reply(404, {});
    const { accessToken } = await refreshAccessToken();
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(process.env.GOOGLE_CALENDAR_ID)}/events`;
    const read = async url => {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
      if ([404, 410].includes(response.status)) return { absent: true };
      if (!response.ok) throw new Error('Google read failed');
      return response.json();
    };
    const id = eventId(SESSION_ID);
    const [googleEvent, matches] = await Promise.all([
      read(`${base}/${id}`),
      read(`${base}?privateExtendedProperty=${encodeURIComponent(`reaSessionId=${SESSION_ID}`)}&showDeleted=true&maxResults=10`),
    ]);
    return reply(200, {
      expected_event_id: id,
      matches: (matches.items || []).map(item => ({ id: item.id, status: item.status })),
      event: {
        absent: googleEvent.absent === true, id: googleEvent.id || null, status: googleEvent.status || null,
        summary: googleEvent.summary || null, start: googleEvent.start || null, end: googleEvent.end || null,
        meet_url: meetUrl(googleEvent), has_description: Boolean(googleEvent.description), has_location: Boolean(googleEvent.location),
        attendee_count: (googleEvent.attendees || []).length, attachment_count: (googleEvent.attachments || []).length,
        private_keys: Object.keys(googleEvent.extendedProperties?.private || {}),
      },
    });
  } catch { return reply(502, { error: 'controlled_observation_failed' }); }
};
