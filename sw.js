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

const CACHE_NAME = "ct-integrado-cache-v6";
const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-192-maskable.png",
  "./icon-512-maskable.png",
  "./apple-touch-icon.png",
  "./favicon.ico"
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

// Abertura rapida: o app abre pela copia guardada no aparelho e, por tras, busca a versao
// publicada e guarda para a proxima vez. O app confere o versao.json ao abrir; se houver versao
// nova, recarrega com ?v=..., e ai o service worker busca na internet primeiro.
// Sem internet, continua abrindo pela copia guardada.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const navegacao = req.mode === "navigate";
  const doShell = APP_SHELL.some((path) => url.pathname.endsWith(path.replace("./", "")));
  if (!navegacao && !doShell) return;
  const chave = navegacao ? "./index.html" : url.pathname;

  const daRede = () => fetch(req, { cache: "no-cache" }).then((response) => {
    if (response && response.ok && (navegacao || !url.search)) {
      const copia = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(chave, copia));
    }
    return response;
  });

  // Pedido de versao nova (?v=) ou primeira vez: rede primeiro, copia guardada se estiver sem internet.
  if (navegacao && url.searchParams.has("v")) {
    event.respondWith(daRede().catch(() => caches.match(chave)));
    return;
  }
  event.respondWith(
    caches.match(chave).then((guardada) => {
      const atualizar = daRede();
      if (guardada) {
        event.waitUntil(atualizar.catch(() => null));
        return guardada;
      }
      return atualizar.catch(() => caches.match(req));
    })
  );
});
