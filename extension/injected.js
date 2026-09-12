/**
 * Injected into the page's MAIN world on flow.google.com (and an old pinned
 * labs.google tab) — has access to window.grecaptcha.
 *
 * The reCAPTCHA site key survived the September 2026 migration unchanged. The
 * TRPC fetch intercept below did not: it belongs to the labs.google frontend
 * and is inert on flow.google.com, where media urls come back inline on the
 * generate call and from the media rpc.
 *
 * TEMP DEBUG: while the front-half branch is diagnosing a Flow wire-contract
 * change, this file also captures ONLY the batchexecute request's `f.req`, the
 * rpcids query value, HTTP status, and a bounded response prefix. It does NOT
 * capture request headers, cookies, the page's `at` token, or other credentials.
 * The content script forwards captures to the local Flow Kit agent only.
 */
const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
const NETLOG_RESPONSE_LIMIT = 250000;

function _flowRequestUrl(input) {
  try {
    if (typeof input === 'string') return new URL(input, window.location.href);
    if (input?.url) return new URL(input.url, window.location.href);
  } catch {}
  return null;
}

async function _extractFReq(input, init) {
  try {
    let body = init?.body;
    if (body == null && input instanceof Request) {
      body = await input.clone().text();
    }
    if (body == null) return null;
    if (body instanceof URLSearchParams) return body.get('f.req');
    if (typeof body === 'string') return new URLSearchParams(body).get('f.req');
    if (body instanceof FormData) return body.get('f.req');
  } catch {}
  return null;
}

function _emitFlowNetlog(detail) {
  try {
    window.dispatchEvent(new CustomEvent('FLOW_NETLOG', { detail }));
  } catch {}
}

// ─── Fetch Monitor ──────────────────────────────────────────
// Keep the legacy TRPC media monitor, and temporarily record the current
// flow.google.com batchexecute wire shape so Flow Kit can be updated from a
// real UI action instead of guessing positional payloads.

const _originalFetch = window.fetch;
window.fetch = async function (...args) {
  const reqUrl = _flowRequestUrl(args[0]);
  const isBatch = !!reqUrl && reqUrl.pathname.includes('/_/AiSandboxAngularFrontend/data/batchexecute');
  const fReq = isBatch ? await _extractFReq(args[0], args[1]) : null;

  const response = await _originalFetch.apply(this, args);

  try {
    const url = reqUrl?.href || (typeof args[0] === 'string' ? args[0] : args[0]?.url || '');

    // TEMP: capture only Flow batchexecute metadata/body. No headers/cookies/tokens.
    if (isBatch) {
      const clone = response.clone();
      clone.text().then(text => {
        _emitFlowNetlog({
          ts: new Date().toISOString(),
          path: reqUrl.pathname,
          rpcids: reqUrl.searchParams.get('rpcids'),
          f_req: typeof fReq === 'string' ? fReq : null,
          status_code: response.status,
          response_text: text.slice(0, NETLOG_RESPONSE_LIMIT),
          response_truncated: text.length > NETLOG_RESPONSE_LIMIT,
        });
      }).catch(() => {
        _emitFlowNetlog({
          ts: new Date().toISOString(),
          path: reqUrl.pathname,
          rpcids: reqUrl.searchParams.get('rpcids'),
          f_req: typeof fReq === 'string' ? fReq : null,
          status_code: response.status,
          response_text: null,
          response_truncated: false,
        });
      });
    }

    // Legacy labs.google TRPC monitor.
    if (url.includes('/fx/api/trpc/') && response.ok) {
      const clone = response.clone();
      clone.text().then(text => {
        if (text.includes('storage.googleapis.com/ai-sandbox-videofx/')) {
          window.dispatchEvent(new CustomEvent('TRPC_MEDIA_URLS', {
            detail: { url, body: text },
          }));
        }
      }).catch(() => {});
    }
  } catch {}
  return response;
};


window.addEventListener('GET_CAPTCHA', async ({ detail }) => {
  const { requestId, pageAction } = detail;
  try {
    await waitForGrecaptcha();
    const token = await window.grecaptcha.enterprise.execute(SITE_KEY, {
      action: pageAction,
    });
    window.dispatchEvent(new CustomEvent('CAPTCHA_RESULT', {
      detail: { requestId, token },
    }));
  } catch (e) {
    window.dispatchEvent(new CustomEvent('CAPTCHA_RESULT', {
      detail: { requestId, error: e.message },
    }));
  }
});

function waitForGrecaptcha(timeout = 22000) {   // it loads lazily; 10s was optimistic
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.grecaptcha?.enterprise?.execute) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('grecaptcha not available'));
      setTimeout(check, 200);
    };
    check();
  });
}
