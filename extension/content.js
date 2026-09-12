/** Content script bridge for Flow Kit. */
(function () {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();

chrome.runtime.onMessage.addListener((msg, _, reply) => {
  if (msg.type !== 'GET_CAPTCHA') return;
  const { requestId, pageAction } = msg;
  const handler = (e) => {
    if (e.detail?.requestId === requestId) {
      window.removeEventListener('CAPTCHA_RESULT', handler);
      clearTimeout(timer);
      reply({ token: e.detail.token, error: e.detail.error });
    }
  };
  const timer = setTimeout(() => {
    window.removeEventListener('CAPTCHA_RESULT', handler);
    reply({ error: 'CONTENT_TIMEOUT' });
  }, 25000);
  window.addEventListener('CAPTCHA_RESULT', handler);
  window.dispatchEvent(new CustomEvent('GET_CAPTCHA', { detail: { requestId, pageAction } }));
  return true;
});

window.addEventListener('FLOW_NETLOG', (e) => {
  fetch('http://127.0.0.1:8100/api/active-project/netlog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(e.detail || {}),
  }).catch(() => {});
});

window.addEventListener('TRPC_MEDIA_URLS', (e) => {
  const { url, body } = e.detail || {};
  if (!body) return;
  chrome.runtime.sendMessage({ type: 'TRPC_MEDIA_URLS', trpcUrl: url, body }).catch(() => {});
});
