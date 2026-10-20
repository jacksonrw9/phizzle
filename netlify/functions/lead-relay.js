/**
 * Lead relay for the conference get-in-touch page (last resort).
 *
 * The page sends leads straight to HubSpot and to the backup Google Form. Some
 * corporate networks, privacy browsers and ad blockers block those services.
 * They almost never block phizzle.com itself, so when the page can't reach one
 * of them it hands the lead to this function, which sends it on from Netlify's
 * servers, where the visitor's network can't interfere.
 *
 * File location in the site repo: netlify/functions/lead-relay.js
 * The page calls it at: /.netlify/functions/lead-relay
 * No API keys or settings needed. Node 18+ (Netlify's default) provides fetch.
 */

const HUBSPOT_PORTAL_ID = '8070371';
const LEAD_FORM_ID = '24515c9a-c453-4d31-af1a-7c28742d5b44';
const BACKUP_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfLG4keTbK34yn_DIKp8uD4hLb34dcjYQXczEptqzNLSg0GDw/formResponse';
const BACKUP_FORM_FIELDS = {
  form: 'entry.516863202',
  hubspot: 'entry.1581862950',
  firstname: 'entry.1323290399',
  lastname: 'entry.953833378',
  email: 'entry.2060112685',
  company: 'entry.102944365',
  jobtitle: 'entry.1516065853',
  phone: 'entry.580761313',
  project_stage: 'entry.1342341611',
  solutions_of_interest: 'entry.1650683835',
  message: 'entry.1502109527',
  marketing_opt_in: 'entry.2012500422',
  page: 'entry.1260589540',
  id: 'entry.392642089'
};

// Only accept leads sent from Phizzle's own pages
const ALLOWED_ORIGINS = [/^https:\/\/(www\.)?phizzle\.com$/i, /^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/i, /^https:\/\/[a-z0-9-]+\.netlify\.app$/i];

// HubSpot properties the page sends; anything else is ignored
const HUBSPOT_FIELDS = ['firstname', 'lastname', 'email', 'phone', 'project_stage', 'message', 'marketing_opt_in', 'hs_lead_status', 'lifecyclestage'];

function reply(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {})
    },
    body: JSON.stringify(body)
  };
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

async function sendToHubSpot(fields, context) {
  try {
    const response = await withTimeout(fetch(
      `https://api.hsforms.com/submissions/v3/integration/submit/${HUBSPOT_PORTAL_ID}/${LEAD_FORM_ID}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields, context }) }
    ), 12000);
    if (response.ok) return { ok: true, detail: 'accepted (via phizzle.com relay)' };
    const data = await response.json().catch(() => ({}));
    const reasons = (data.errors || []).map(e => e.message).join(' | ');
    return { ok: false, detail: `rejected (${response.status}) via relay: ${reasons || data.message || 'no details'}` };
  } catch (error) {
    return { ok: false, detail: 'relay could not reach HubSpot: ' + error.message };
  }
}

async function saveToBackup(values) {
  const body = new URLSearchParams();
  Object.keys(BACKUP_FORM_FIELDS).forEach(key => {
    if (values[key] !== undefined && values[key] !== '') {
      body.append(BACKUP_FORM_FIELDS[key], String(values[key]).slice(0, 5000));
    }
  });
  try {
    const response = await withTimeout(fetch(BACKUP_FORM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual'
    }), 12000);
    // Google answers 200 (or a redirect to the "response recorded" page) when the row is saved
    return response.status === 200 || (response.status >= 300 && response.status < 400);
  } catch (error) {
    return false;
  }
}

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const allowed = ALLOWED_ORIGINS.some(re => re.test(origin));

  if (event.httpMethod === 'OPTIONS') {
    return allowed
      ? { statusCode: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' }, body: '' }
      : { statusCode: 403, body: '' };
  }
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  if (origin && !allowed) return reply(403, { error: 'origin not allowed' });
  if ((event.body || '').length > 20000) return reply(413, { error: 'too large' });

  let payload;
  try {
    payload = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : (event.body || '{}'));
  } catch (error) {
    return reply(400, { error: 'invalid JSON' }, allowed ? origin : '');
  }

  // Spam trap filled in: say OK, do nothing
  if (payload.website) return reply(200, { hubspot: { ok: true, detail: 'ignored' }, backup: true }, allowed ? origin : '');

  const fieldMap = {};
  (Array.isArray(payload.fields) ? payload.fields : []).forEach(f => {
    if (f && HUBSPOT_FIELDS.includes(f.name) && f.value !== undefined && f.value !== '') {
      fieldMap[f.name] = String(f.value).slice(0, 5000);
    }
  });
  if (!fieldMap.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fieldMap.email)) {
    return reply(400, { error: 'email missing or invalid' }, allowed ? origin : '');
  }

  const id = String(payload.id || '').slice(0, 64) || 'relay-' + Date.now().toString(36);
  const page = String(payload.page || '').slice(0, 500);
  const formName = String(payload.form || 'Get in Touch').slice(0, 100);

  // 1. HubSpot, unless the page already got it there
  let hubspot = { ok: !!payload.hubspotAlreadyAccepted, detail: payload.hubspotAlreadyAccepted ? 'accepted' : '' };
  if (!payload.hubspotAlreadyAccepted) {
    const context = { pageUri: page, pageName: String(payload.pageName || 'Lead Capture') };
    if (payload.hutk) context.hutk = String(payload.hutk).slice(0, 100);
    const ip = event.headers['x-nf-client-connection-ip'] || '';
    if (ip) context.ipAddress = ip;
    hubspot = await sendToHubSpot(Object.keys(fieldMap).map(name => ({ name, value: fieldMap[name] })), context);
  }

  // 2. Backup row with the final HubSpot result, unless the page already saved one
  let backup = true;
  if (payload.needBackup) {
    backup = await saveToBackup(Object.assign({}, fieldMap, {
      form: formName,
      hubspot: hubspot.ok ? 'accepted' : hubspot.detail,
      page: page,
      id: id
    }));
  }

  console.log(`lead-relay ${id}: hubspot=${hubspot.ok ? 'ok' : hubspot.detail} backup=${backup}`);
  return reply(200, { hubspot, backup }, allowed ? origin : '');
};
