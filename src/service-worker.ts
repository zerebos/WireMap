/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Keeps the app working offline: the whole app is cached when it's installed, and every page
// falls back to the cached shell when the network is gone (a tripped breaker can take the
// Wi-Fi with it). The data itself already lives in the browser.
import { base, build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `breakerbook-${version}`;
const SHELL = `${base}/index.html`;
// sqlite-wasm ships helper workers for storage modes the app doesn't use; no need to cache them.
const unused = /sqlite3-(worker1|opfs-async-proxy)/;
const ASSETS = [...build.filter((f) => !unused.test(f)), ...files, SHELL];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE).then(async (cache) => {
			await cache.addAll(ASSETS.filter((a) => a !== SHELL));
			// The dev server has no index.html; offline use only matters for a real build.
			await cache.add(SHELL).catch(() => {});
		})
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);
	if (request.method !== 'GET' || url.origin !== sw.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			// Every page is the same app shell. Prefer a fresh copy so updates arrive.
			if (request.mode === 'navigate') {
				try {
					const res = await fetch(request);
					if (res.ok) return res;
				} catch {
					// Offline.
				}
				return (await cache.match(SHELL)) ?? Response.error();
			}
			// Built files have hashed names and never change, so the cached copy is always right.
			if (ASSETS.includes(url.pathname)) {
				const hit = await cache.match(url.pathname);
				if (hit) return hit;
			}
			try {
				return await fetch(request);
			} catch {
				return (await cache.match(request)) ?? Response.error();
			}
		})()
	);
});
