// Service worker minimo do CT Integrado.
// Objetivo: permitir "Adicionar a tela inicial" de forma confiavel (inclusive no iPhone/Safari)
// e manter um cache basico do proprio HTML para abrir mais rapido.
// Nao faz cache agressivo de dados: o app sempre busca os dados reais no Firebase pela rede.

const CACHE_NAME = "ct-integrado-cache-v1";
const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // So intercepta navegacao/arquivos do proprio app shell.
  // Chamadas ao Firebase (Firestore/Auth) e a Cloud Function do chat passam direto pela rede.
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isAppShellFile = APP_SHELL.some((path) => url.pathname.endsWith(path.replace("./", "")));

  if (!isSameOrigin || !isAppShellFile) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
