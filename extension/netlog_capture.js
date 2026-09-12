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

// Match every request on flow.google.com, then narrow by pathname below.
// Some accounts are routed through /u/<n>/... URLs, so filtering only /_/* can
// miss UI requests before we even get a chance to inspect them.
const FLOW_NETLOG_FILTER = { urls: ['https://flow.google.com/*'] };
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
  if (Array.isArray(fReq)) fReq = fReq[0];
  if (typeof fReq !== 'string' || !fReq) return null;
  try {
    const parsed = JSON.parse(fReq);
    return JSON.stringify(redactLongJsonStrings(parsed));
  } catch {
    return '__UNPARSEABLE_F_REQ__';
  }
}

function extractFReq(details) {
  try {
    // Chrome exposes application/x-www-form-urlencoded bodies as formData on
    // some builds, while others leave the original bytes under raw. Support both.
    const formData = details.requestBody?.formData;
    if (formData && Object.prototype.hasOwnProperty.call(formData, 'f.req')) {
      const fromForm = sanitizeFReq(formData['f.req']);
      if (fromForm) return fromForm;
    }

    const raw = details.requestBody?.raw;
    if (raw?.length) {
      const chunks = [];
      for (const part of raw) {
        if (part?.bytes) chunks.push(new Uint8Array(part.bytes));
      }
      if (chunks.length) {
        let total = 0;
        for (const chunk of chunks) total += chunk.length;
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        const text = new TextDecoder().decode(merged);
        const params = new URLSearchParams(text);
        const fromRaw = sanitizeFReq(params.get('f.req'));
        if (fromRaw) return fromRaw;
      }
    }
  } catch {}
  return null;
}

function isFlowBatchPath(pathname) {
  return pathname.includes('/AiSandboxAngularFrontend/data/batchexecute');
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      const url = new URL(details.url);
      if (!isFlowBatchPath(url.pathname)) return;
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
