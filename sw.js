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

const CACHE_NAME = "ct-integrado-cache-v4";
const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: "reload" }))))
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

// Rede primeiro: sempre busca a versao mais nova publicada; o cache so e usado sem internet.
// Assim ninguem precisa limpar o cache para receber atualizacoes.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const navegacao = req.mode === "navigate";
  const doShell = APP_SHELL.some((path) => url.pathname.endsWith(path.replace("./", "")));
  if (!navegacao && !doShell) return;

  event.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((response) => {
        if (response && response.ok && !url.search) {
          const clone = response.clone();
          const chave = navegacao ? "./index.html" : req;
          caches.open(CACHE_NAME).then((cache) => cache.put(chave, clone));
        }
        return response;
      })
      .catch(() => caches.match(navegacao ? "./index.html" : req).then((c) => c || caches.match(req)))
  );
});
