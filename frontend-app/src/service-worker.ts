/// <reference lib="webworker" />

export {};

type ManifestEntry = { url: string };

const manifestEntries = ((self as unknown as { __WB_MANIFEST?: ManifestEntry[] }).__WB_MANIFEST ?? []) as ManifestEntry[];
const sw = self as unknown as ServiceWorkerGlobalScope;

const PRECACHE = 'chatterpals-precache-v1';
const RUNTIME = 'chatterpals-runtime-v1';
const PRECACHE_URLS = manifestEntries.map((entry: ManifestEntry) => entry.url);

sw.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(['/', ...PRECACHE_URLS]))
      .catch((error) => {
        console.warn('Precache failed', error);
      })
  );
  void sw.skipWaiting();
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== PRECACHE && key !== RUNTIME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event: FetchEvent) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/share-capture') {
    event.respondWith(handleShareTarget(event));
    return;
  }

  if (request.method !== 'GET' || url.origin !== sw.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  event.respondWith(handleAssetRequest(request));
});

sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void sw.skipWaiting();
  }
});

async function handleNavigationRequest(request: Request): Promise<Response> {
  try {
    const networkResponse = await fetch(request);
    void cacheRuntimeResource(request, networkResponse.clone());
    return networkResponse;
  } catch (error) {
    const cache = await caches.open(PRECACHE);
    const fallback = await cache.match('/');
    if (fallback) {
      return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function handleAssetRequest(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) {
    void fetch(request)
      .then((response) => {
        void cacheRuntimeResource(request, response.clone());
      })
      .catch(() => undefined);
    return cached;
  }

  try {
    const response = await fetch(request);
    void cacheRuntimeResource(request, response.clone());
    return response;
  } catch (error) {
    return Response.error();
  }
}

async function cacheRuntimeResource(request: Request, response: Response) {
  if (!response || response.status !== 200 || response.type !== 'basic') {
    return;
  }
  const cache = await caches.open(RUNTIME);
  await cache.put(request, response);
}

async function handleShareTarget(event: FetchEvent): Promise<Response> {
  const formData = await event.request.formData();
  const text = formData.get('text');
  const decoded = typeof text === 'string' ? text : '';
  const targetUrl = `/share-capture?text=${encodeURIComponent(decoded)}`;

  const allClients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (allClients.length > 0) {
    const client = allClients[0];
    client.postMessage({ type: 'SHARE_TARGET', text: decoded });
    void client.navigate(targetUrl);
  } else {
    void sw.clients.openWindow(targetUrl);
  }

  return Response.redirect(targetUrl, 303);
}
