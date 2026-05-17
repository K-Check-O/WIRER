import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_HOSTS = ['nicovideo.jp', 'nimg.jp', 'dmc.nico', 'nicovideo.cdn.nimg.jp'];
const EMBED_BASE = 'https://embed.nicovideo.jp';

function isAllowed(hostname: string) {
  return ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));
}

// プレイヤーの fetch/XHR を横取りしてプロキシ経由にするスクリプト
// - credentials を 'omit' に強制（wildcard CORS との競合を回避）
// - sendBeacon もパッチ
const INTERCEPTOR_SCRIPT = `
<script>
(function() {
  // ⚠️ 相対URLは <base href> で embed.nicovideo.jp に解決されてしまうため、
  //    location.origin で絶対URLにする
  const PROXY = location.origin + '/api/nico-proxy?url=';
  const NICO = ['nicovideo.jp', 'dmc.nico', 'nimg.jp'];

  function needsProxy(url) {
    try {
      const u = new URL(url, location.href);
      return NICO.some(d => u.hostname === d || u.hostname.endsWith('.' + d));
    } catch { return false; }
  }
  function toProxyUrl(url) {
    try { return PROXY + encodeURIComponent(new URL(url, location.href).href); }
    catch { return url; }
  }

  // --- fetch patch ---
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    let url = typeof input === 'string' ? input
            : input instanceof Request ? input.url
            : String(input);
    if (needsProxy(url)) {
      const pUrl = toProxyUrl(url);
      // credentials:'include' は wildcard CORS と非互換なので 'omit' に
      const newInit = Object.assign({}, init, { credentials: 'omit', mode: 'cors' });
      if (typeof input !== 'string' && input instanceof Request) {
        // Request オブジェクトはそのままコピーして URL だけ差し替え
        return _fetch(new Request(pUrl, { method: input.method, headers: input.headers, body: input.body, credentials: 'omit', mode: 'cors' }));
      }
      return _fetch(pUrl, newInit);
    }
    return _fetch(input, init);
  };

  // --- XHR patch ---
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
    const target = needsProxy(String(url)) ? toProxyUrl(String(url)) : url;
    return _open.call(this, method, target, async !== undefined ? async : true, user, pass);
  };

  // --- sendBeacon patch ---
  if (navigator.sendBeacon) {
    const _sb = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      if (needsProxy(String(url))) {
        _fetch(toProxyUrl(String(url)), { method: 'POST', body: data, credentials: 'omit' });
        return true;
      }
      return _sb(url, data);
    };
  }

  console.log('[nico-proxy] interceptor active');
})();
</script>
`;

async function proxyFetch(targetUrl: string, req: NextRequest) {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'ja,en;q=0.9',
    'Referer': EMBED_BASE + '/',
    'Origin': EMBED_BASE,
    // NicoNico APIが必要とするカスタムヘッダー
    'X-Frontend-Id': '6',
    'X-Frontend-Version': '0.0.0',
    'X-Request-With': 'nicovideo',
    'X-Niconico-Language': 'ja-jp',
  };

  const accept = req.headers.get('accept');
  if (accept) headers['Accept'] = accept;
  const ct = req.headers.get('content-type');
  if (ct) headers['Content-Type'] = ct;

  // クライアントから forwarded されたカスタムヘッダーを転送
  const xReqWith = req.headers.get('x-request-with');
  if (xReqWith) headers['X-Request-With'] = xReqWith;

  const isPost = req.method === 'POST';
  const body = isPost ? await req.arrayBuffer() : undefined;

  const res = await fetch(targetUrl, { method: req.method, headers, body });
  console.log(`[nico-proxy] ${req.method} ${targetUrl} → ${res.status}`);
  return res;
}

function buildResHeaders(req: NextRequest, ct: string) {
  // credentials:'include' との互換性のため Origin を echo する
  const requestOrigin = req.headers.get('origin');
  const allowOrigin = requestOrigin || '*';

  const h = new Headers({
    'Content-Type': ct,
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Frontend-Request',
    'Access-Control-Allow-Credentials': 'true',
    // CSP を上書きしてインターセプタースクリプトを許可
    'Content-Security-Policy': "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: mediastream:;",
    // X-Frame-Options を無効化（一部ブラウザ用）
    'X-Frame-Options': 'ALLOWALL',
  });
  if (requestOrigin) h.set('Vary', 'Origin');
  return h;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: buildResHeaders(req, '') });
}
export async function GET(req: NextRequest) { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }

async function handler(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const rawUrl = searchParams.get('url');

  let targetUrl: string;

  if (id) {
    targetUrl = `${EMBED_BASE}/watch/${id}?w=640&h=360`;
  } else if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (!isAllowed(u.hostname)) {
        return new NextResponse('Forbidden', { status: 403 });
      }
      targetUrl = rawUrl;
    } catch {
      return new NextResponse('Invalid URL', { status: 400 });
    }
  } else {
    return new NextResponse('Missing id or url', { status: 400 });
  }

  try {
    const upstream = await proxyFetch(targetUrl, req);
    const ct = upstream.headers.get('content-type') || '';
    const resHeaders = buildResHeaders(req, ct);

    // バイナリはそのままストリーム
    if (/image|video|audio|font|octet/.test(ct)) {
      const buf = await upstream.arrayBuffer();
      return new NextResponse(buf, { status: upstream.status, headers: resHeaders });
    }

    let text = await upstream.text();

    // HTML: インターセプタースクリプトを最優先で注入 + base href
    if (ct.includes('html')) {
      const inject = `${INTERCEPTOR_SCRIPT}<base href="${EMBED_BASE}/"><meta name="referrer" content="no-referrer">`;
      if (/<head>/i.test(text)) {
        text = text.replace(/<head>/i, `<head>${inject}`);
      } else if (/<html/i.test(text)) {
        text = text.replace(/(<html[^>]*>)/i, `$1<head>${inject}</head>`);
      } else {
        text = inject + text;
      }
    }

    return new NextResponse(text, { status: upstream.status, headers: resHeaders });
  } catch (err) {
    console.error('[nico-proxy] error:', err);
    return new NextResponse('Proxy error', { status: 502 });
  }
}
