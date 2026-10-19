// Service worker do MeuCT (CT Integrado).
// 1) Permite "Adicionar a tela inicial" (inclusive no iPhone/Safari) e guarda um cache basico do app.
// 2) Recebe as notificacoes dos avisos da equipe (Firebase Cloud Messaging), mesmo com o app fechado.
// Nao faz cache agressivo de dados: o app sempre busca os dados reais no Firebase pela rede.

importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyARvBxwWERljcaAaJsqLZdMstSVIi-6j2g",
  authDomain: "meurh-23fad.firebaseapp.com",
  projectId: "meurh-23fad",
  storageBucket: "meurh-23fad.firebasestorage.app",
  messagingSenderId: "241699999089",
  appId: "1:241699999089:web:cc50293405d6c17db73ad0",
});
// O SDK mostra sozinho a notificacao (titulo, texto, icone) e, ao tocar nela,
// abre o MeuCT direto na pagina de Avisos.
firebase.messaging();

const CACHE_NAME = "ct-integrado-cache-v2";
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
