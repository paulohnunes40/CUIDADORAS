/* Service worker — faz o app abrir e funcionar sem internet.
   Os dados continuam sincronizando pelo cache offline do próprio Firestore. */
'use strict';

const VERSAO = 'evolucao-v3';

// Arquivos do próprio app: sempre disponíveis offline.
const LOCAIS = [
  './',
  './index.html',
  './styles.css',
  './js/app.js',
  './js/dados.js',
  './manifest.json',
  './icone.svg',
  './icone-192.png',
  './icone-180.png',
  './icone-32.png'
];

// Bibliotecas e fontes externas: guardadas no primeiro acesso com internet.
const EXTERNOS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/12.15.0/firebase-app-compat.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/12.15.0/firebase-firestore-compat.min.js',
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap'
];

self.addEventListener('install', evento => {
  evento.waitUntil((async () => {
    const cache = await caches.open(VERSAO);
    await cache.addAll(LOCAIS);
    // Externos não podem derrubar a instalação se a rede falhar.
    await Promise.allSettled(EXTERNOS.map(url => cache.add(url)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', evento => {
  evento.waitUntil((async () => {
    const chaves = await caches.keys();
    await Promise.all(chaves.filter(c => c !== VERSAO).map(c => caches.delete(c)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', evento => {
  const req = evento.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca interceptar o Firestore: ele tem o próprio mecanismo offline.
  if(/firestore\.googleapis\.com|googleapis\.com\/google\.firestore/.test(url.host + url.pathname)) return;

  const ehExterno = url.origin !== self.location.origin;

  // Bibliotecas, fontes e arquivos estáticos: cache primeiro (rápido e offline).
  if(ehExterno || /\.(css|js|png|svg|woff2?)$/.test(url.pathname)){
    evento.respondWith((async () => {
      const cacheado = await caches.match(req, { ignoreVary: true });
      if(cacheado) return cacheado;
      try{
        const resposta = await fetch(req);
        if(resposta.ok || resposta.type === 'opaque'){
          const cache = await caches.open(VERSAO);
          cache.put(req, resposta.clone());
        }
        return resposta;
      }catch(e){
        return cacheado || Response.error();
      }
    })());
    return;
  }

  // Páginas: rede primeiro, caindo para o cache quando offline.
  evento.respondWith((async () => {
    try{
      const resposta = await fetch(req);
      const cache = await caches.open(VERSAO);
      cache.put(req, resposta.clone());
      return resposta;
    }catch(e){
      return (await caches.match(req)) || (await caches.match('./index.html'));
    }
  })());
});
