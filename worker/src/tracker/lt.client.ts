import { CHECKOUT_HOSTS } from './checkout-hosts';

/**
 * Esta função é serializada em string e servida em /lt.js.
 * Roda no browser. Evite usar features do worker runtime.
 */
export const LT_CLIENT_SOURCE = `
(function () {
  if (window.__LT_INIT__) return;
  window.__LT_INIT__ = true;

  function getScriptTag() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      if (s.src && s.src.indexOf('/lt.js') !== -1 && s.dataset && s.dataset.workspace) return s;
    }
    return null;
  }

  function uuidv4() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function setCookie(name, value, maxAgeSec) {
    var s = name + '=' + encodeURIComponent(value) + '; path=/; max-age=' + maxAgeSec + '; SameSite=Lax';
    if (location.protocol === 'https:') s += '; Secure';
    document.cookie = s;
  }

  var tag = getScriptTag();
  if (!tag) return;
  var workspaceId = tag.dataset.workspace;
  var workerOrigin = (function () {
    try { return new URL(tag.src).origin; } catch (e) { return ''; }
  })();
  if (!workspaceId || !workerOrigin) return;

  var qs = new URLSearchParams(location.search);
  // Aliases iOS LTP: lt_gci/lt_wbr/lt_gbr são versões "unknown" dos canônicos pra escapar de
  // strippers que removem nomes conhecidos (gclid/wbraid/gbraid) em forwarding/sharing.
  // Resolvidos pra canônico antes do payload (canonical sempre ganha).
  var aliasMap = { gclid: 'lt_gci', wbraid: 'lt_wbr', gbraid: 'lt_gbr' };
  function getParam(canonical) {
    return qs.get(canonical) || qs.get(aliasMap[canonical]) || null;
  }
  var trackingFields = ['gclid','wbraid','gbraid','gclsrc','gad_source','gad_campaignid','utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  var hasAnyTracking = trackingFields.some(function (f) {
    return qs.has(f) || (aliasMap[f] && qs.has(aliasMap[f]));
  });

  // visitor cookie sempre
  var visitorId = getCookie('_lt_visitor');
  if (!visitorId) {
    visitorId = uuidv4();
    setCookie('_lt_visitor', visitorId, 540 * 86400);
  }

  var clickId = getCookie('_lt_click');
  if (hasAnyTracking) {
    clickId = uuidv4();
    setCookie('_lt_click', clickId, 90 * 86400);
    if (!getCookie('_lt_first_click')) {
      setCookie('_lt_first_click', clickId, 540 * 86400);
    }

    var payload = {
      workspace_id: workspaceId,
      click_id: clickId,
      visitor_id: visitorId,
      landing_url: location.href,
      referrer: document.referrer || null,
    };
    trackingFields.forEach(function (f) {
      var v = getParam(f);
      if (v) payload[f] = v;
    });

    try {
      var body = JSON.stringify(payload);
      // Design: sendBeacon usa text/plain (MIME CORS-safelisted) para evitar preflight.
      // Capturamos o retorno: false significa que o browser bloqueou (ex. body muito grande,
      // ou sem permissão). Nesse caso fazemos fallback para fetch com keepalive:true,
      // que dispara preflight mas garante a entrega mesmo em navegação.
      var sent = navigator.sendBeacon
        ? navigator.sendBeacon(workerOrigin + '/track/click', new Blob([body], { type: 'text/plain' }))
        : false;
      if (!sent) {
        fetch(workerOrigin + '/track/click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
          credentials: 'omit',
        });
      }
    } catch (e) {}
  }

  // Reescrita de links de checkout pra propagar xcod
  if (clickId) {
    var hosts = ${JSON.stringify(CHECKOUT_HOSTS)};
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      try {
        var u = new URL(a.href, location.href);
        for (var i = 0; i < hosts.length; i++) {
          if (u.hostname === hosts[i] || u.hostname.endsWith('.' + hosts[i])) {
            if (!u.searchParams.has('xcod')) {
              u.searchParams.set('xcod', clickId);
              a.href = u.toString();
            }
            break;
          }
        }
      } catch (err) {}
    }, true);
  }
})();
`.trim();
