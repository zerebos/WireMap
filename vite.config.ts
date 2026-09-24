import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// A static single-page app: every URL gets index.html and the app takes it from there.
			adapter: adapter({ fallback: 'index.html' }),
			// Set BASE_PATH when the app isn't at the root of its site, e.g. /WireMap on GitHub Pages.
			paths: { base: (process.env.BASE_PATH ?? '') as '' | `/${string}`, relative: false }
		})
	],
	// sqlite-wasm loads its .wasm file itself; Vite's dependency pre-bundling would break that.
	optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
	worker: { format: 'es' }
});
