'use strict';

const TOKEN_PATTERN = /\{\{[^{}]+\}\}/g;

function humanDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [year, month, day] = raw.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function humanTime(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return raw;
  const hour = Number(match[1]);
  if (hour > 23) return raw;
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function locationLabel(value, meetUrl) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase().replace(/[ _]/g, '-');
  if (['distance', 'remote', 'online'].includes(normalized)) {
    return meetUrl ? 'Remote — Google Meet' : 'Remote session';
  }
  if (['in-person', 'inperson'].includes(normalized)) return 'In person — Erie, Pennsylvania';
  if (normalized === 'house-cleansing-blessing') return 'On site — address confirmed separately';
  return raw;
}

function prepareVariables(input) {
  const vars = { ...(input || {}) };
  ['session_date', 'appointment_date', 'old_date', 'new_date', 'due_date', 'expiration_date', 'scheduled_for']
    .forEach(key => { if (vars[key]) vars[key] = humanDate(vars[key]); });
  ['session_time', 'appointment_time', 'old_time', 'new_time']
    .forEach(key => { if (vars[key]) vars[key] = humanTime(vars[key]); });
  if (vars.timezone) vars.timezone = 'ET';
  if (!vars.duration && Number(vars.duration_minutes) > 0) {
    vars.duration = `${Number(vars.duration_minutes)} minutes`;
  }
  if (!vars.location && vars.location_type) vars.location = locationLabel(vars.location_type, vars.google_meet_url);
  if (typeof vars.client_name === 'string') vars.client_name = vars.client_name.trim();
  return vars;
}

function unresolvedTokens(...values) {
  return [...new Set(values.flatMap(value => String(value || '').match(TOKEN_PATTERN) || []))];
}

function assertRenderSafe(rendered) {
  const unresolved = unresolvedTokens(rendered.subject, rendered.html, rendered.text);
  if (unresolved.length) {
    const error = new Error(`Email rendering incomplete (${unresolved.length} unresolved token(s))`);
    error.code = 'EMAIL_RENDER_INCOMPLETE';
    error.unresolvedCount = unresolved.length;
    throw error;
  }
}

function brandEmailFragment(html) {
  const source = String(html || '').trim();
  if (!source || /<!doctype|<html[\s>]/i.test(source)) return source;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#04020e;color:#f0ecff;font-family:Georgia,serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#04020e"><tr><td align="center" style="padding:42px 16px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#100b20;border:1px solid #8b6a2d;box-shadow:0 18px 60px rgba(0,0,0,.45)"><tr><td align="center" style="padding:34px 34px 25px;border-bottom:1px solid rgba(232,184,75,.3)"><p style="margin:0 0 12px;color:#e8b84b;font-size:11px;letter-spacing:.42em;text-transform:uppercase">Royal Energy Alchemy</p><div style="width:64px;height:2px;background:#e8b84b"></div></td></tr><tr><td style="padding:32px 38px;font-size:16px;line-height:1.75;color:#d8d4f0">${source}</td></tr><tr><td align="center" style="padding:24px 30px;border-top:1px solid rgba(232,184,75,.22);color:#8f88aa;font-size:12px;line-height:1.7"><span style="color:#e8b84b;letter-spacing:.18em;text-transform:uppercase">Royal Energy Alchemy LLC</span><br>Erie, Pennsylvania · 814-392-2095</td></tr></table></td></tr></table></body></html>`;
}

function renderTemplate(template, input) {
  const vars = prepareVariables(input);
  let html = template.html_body || '';
  let text = template.text_body || '';
  let subject = template.subject || '';

  const conditionals = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  const applyConditionals = value => value.replace(conditionals, (_, key, inner) => {
    const present = vars[key] != null && vars[key] !== '' && vars[key] !== false;
    return present ? inner : '';
  });
  html = applyConditionals(html);
  text = applyConditionals(text);
  subject = applyConditionals(subject);

  const activeTemplate = `${subject}\n${html}\n${text}`;
  if (/\{\{service(?:_name)?\}\}/.test(activeTemplate) && !String(vars.service || vars.service_name || '').trim()) {
    const error = new Error('Email rendering incomplete (service is required)');
    error.code = 'EMAIL_RENDER_INCOMPLETE';
    throw error;
  }
  const urlKeys = [...new Set([...activeTemplate.matchAll(/\{\{(\w+_url)\}\}/g)].map(match => match[1]))];
  for (const key of urlKeys) {
    const value = String(vars[key] || '').trim();
    if (!/^(https:\/\/|http:\/\/127\.0\.0\.1(?::\d+)?\/|#preview-only$)/i.test(value)) {
      const error = new Error(`Email rendering blocked (invalid ${key})`);
      error.code = 'EMAIL_INVALID_URL';
      throw error;
    }
  }

  Object.keys(vars).forEach(key => {
    const expression = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    const value = String(vars[key] == null ? '' : vars[key]);
    html = html.replace(expression, value);
    text = text.replace(expression, value);
    subject = subject.replace(expression, value);
  });

  html = html.replace(/Dear\s*,/gi, 'Hello,').replace(/Hi\s*,/gi, 'Hello,');
  text = text.replace(/Dear\s*,/gi, 'Hello,').replace(/Hi\s*,/gi, 'Hello,');
  html = brandEmailFragment(html);
  assertRenderSafe({ html, text, subject });
  return { html, text, subject };
}

module.exports = {
  TOKEN_PATTERN, humanDate, humanTime, locationLabel, prepareVariables,
  unresolvedTokens, assertRenderSafe, brandEmailFragment, renderTemplate,
};
