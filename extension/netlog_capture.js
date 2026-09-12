/**
 * TEMPORARY Flow batchexecute wire recorder.
 *
 * Captures only the f.req form field + rpcids + status. It deliberately omits
 * request headers, cookies, the `at` CSRF field and every other form field.
 * Very long JSON strings (e.g. single-use CAPTCHA tokens) are redacted before
 * the record is sent to the local Flow Kit agent.
 *
 * Remove this file and restore manifest.json after the wire contract is fixed.
 */

const FLOW_NETLOG_FILTER = { urls: ['https://flow.google.com/_/*'] };
const flowNetlogPending = new Map();

function redactLongJsonStrings(value) {
  if (Array.isArray(value)) return value.map(redactLongJsonStrings);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactLongJsonStrings(v);
    return out;
  }
  if (typeof value === 'string' && value.length > 400) return '__REDACTED_LONG_TOKEN__';
  return value;
}

function sanitizeFReq(fReq) {
  if (typeof fReq !== 'string' || !fReq) return null;
  try {
    const parsed = JSON.parse(fReq);
    return JSON.stringify(redactLongJsonStrings(parsed));
  } catch {
    // If Flow ever stops sending JSON here, do not persist opaque raw data.
    return '__UNPARSEABLE_F_REQ__';
  }
}

function extractFReq(details) {
  try {
    const raw = details.requestBody?.raw;
    if (!raw?.length || !raw[0]?.bytes) return null;
    const text = new TextDecoder().decode(new Uint8Array(raw[0].bytes));
    const params = new URLSearchParams(text);
    return sanitizeFReq(params.get('f.req'));
  } catch {
    return null;
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      const url = new URL(details.url);
      if (!url.pathname.includes('/_/AiSandboxAngularFrontend/data/batchexecute')) return;
      const fReq = extractFReq(details);
      if (!fReq) return;
      flowNetlogPending.set(details.requestId, {
        ts: new Date().toISOString(),
        path: url.pathname,
        rpcids: url.searchParams.get('rpcids'),
        f_req: fReq,
      });
    } catch {}
  },
  FLOW_NETLOG_FILTER,
  ['requestBody'],
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const rec = flowNetlogPending.get(details.requestId);
    if (!rec) return;
    flowNetlogPending.delete(details.requestId);
    fetch('http://127.0.0.1:8100/api/active-project/netlog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...rec,
        status_code: details.statusCode,
        response_text: null,
        response_truncated: false,
      }),
    }).catch(() => {});
  },
  FLOW_NETLOG_FILTER,
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    flowNetlogPending.delete(details.requestId);
  },
  FLOW_NETLOG_FILTER,
);
