/* 코치룸 홈 화면 앱 서비스워커 (20261101k · 범위 /marathon-hub/admin/ — 러닝노트는 ../sw.js)
   화면 · 기록을 저장하지 않는다. 페이지를 열 때 인터넷이 끊겼으면 안내 한 장만 보여 준다. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(function () {
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>코치룸</title>' +
      '<body style="font-family:sans-serif;padding:40px 20px;text-align:center;color:#333"><p style="font-size:40px;margin:0">📶</p><h2>인터넷 연결을 확인해 주세요</h2><p>연결된 뒤 다시 열면 바로 보여요.</p></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});
