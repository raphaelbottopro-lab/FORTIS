/* Fortis — service worker
   Rôle : garder une copie permanente de l'appli pour qu'elle démarre sans réseau.
   Ne touche jamais aux données : elles vivent dans le stockage du navigateur.

   Stratégie : on sert d'abord le cache (démarrage instantané, même hors ligne),
   puis on va chercher la dernière version en arrière-plan. Si elle a changé,
   l'appli affiche une bannière « Mise à jour disponible ».

   Ce fichier n'a pas besoin d'être modifié quand tu mets à jour index.html.
*/
const CACHE = 'fortis-v1';
const RACINE = new URL('./', self.location).pathname;

// Installation : on met l'appli en cache immédiatement
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll([RACINE, RACINE + 'index.html']).catch(() => {}))
  );
});

// Activation : on supprime les caches d'anciennes versions
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Une page vaut-elle la peine d'être mise en cache ?
const estPage = req =>
  req.method === 'GET' &&
  req.destination !== 'video' &&
  new URL(req.url).origin === self.location.origin;

self.addEventListener('fetch', e => {
  const req = e.request;
  if (!estPage(req)) return;

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const enCache = await cache.match(req, { ignoreSearch: true });

      // Récupération réseau en arrière-plan
      const reseau = fetch(req).then(async rep => {
        if (rep && rep.ok) {
          const copie = rep.clone();
          // On ne prévient que si le contenu a réellement changé
          if (enCache) {
            const [a, b] = await Promise.all([enCache.clone().text(), rep.clone().text()]);
            if (a !== b) prevenir('maj');
          }
          cache.put(req, copie);
        }
        return rep;
      }).catch(() => null);

      // Cache d'abord, réseau en secours
      if (enCache) return enCache;
      const rep = await reseau;
      if (rep) return rep;
      // Ni cache ni réseau : on tente la page d'accueil
      return (await cache.match(RACINE + 'index.html')) ||
             new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })
  );
});

// Signale un évènement à toutes les fenêtres ouvertes
function prevenir(type) {
  self.clients.matchAll({ type: 'window' }).then(cs =>
    cs.forEach(c => c.postMessage({ fortis: type }))
  );
}

// Permet à l'appli de forcer une vérification
self.addEventListener('message', e => {
  if (e.data === 'verifier') {
    caches.open(CACHE).then(async cache => {
      const cle = RACINE + 'index.html';
      const enCache = await cache.match(cle, { ignoreSearch: true });
      try {
        const rep = await fetch(cle + '?v=' + Date.now(), { cache: 'no-store' });
        if (rep && rep.ok) {
          const neuf = await rep.clone().text();
          const vieux = enCache ? await enCache.clone().text() : null;
          await cache.put(cle, rep);
          prevenir(vieux !== null && vieux !== neuf ? 'maj' : 'ajour');
        }
      } catch (err) { prevenir('horsligne'); }
    });
  }
});
