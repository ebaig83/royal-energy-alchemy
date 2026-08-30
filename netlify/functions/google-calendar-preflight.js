'use strict';

const { refreshAccessToken } = require('./lib/google-calendar');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { Allow: 'GET' }, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_CALENDAR_ID'];
  const credentials_complete = required.every(name => Boolean(process.env[name]));
  let token_refresh_ok = false;
  let calendar_read_ok = false;
  let failure_stage = null;

  if (credentials_complete) {
    try {
      const { accessToken } = await refreshAccessToken();
      token_refresh_ok = Boolean(accessToken);
      if (token_refresh_ok) {
        const calendarId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID);
        const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        calendar_read_ok = response.ok;
        if (!response.ok) failure_stage = 'calendar_read';
      }
    } catch (error) {
      failure_stage = error?.code === 'authorization_error' ? 'token_refresh' : 'google_request';
    }
  } else {
    failure_stage = 'configuration';
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ credentials_complete, token_refresh_ok, calendar_read_ok, failure_stage }),
  };
};
