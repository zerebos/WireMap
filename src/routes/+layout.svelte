<script lang="ts">
	import '../app.css';
	import { asset, resolve } from '$app/paths';
	import { page } from '$app/state';

	let { data, children } = $props();

	const route = $derived(page.route.id ?? '');
	const links = [
		{ href: resolve('/'), label: 'Panels', match: (r: string) => r === '/' || r.startsWith('/panels') },
		{ href: resolve('/map'), label: 'Map', match: (r: string) => r === '/map' },
		{ href: resolve('/devices'), label: 'Devices', match: (r: string) => r === '/devices' },
		{ href: resolve('/rooms'), label: 'Rooms', match: (r: string) => r === '/rooms' },
		{ href: resolve('/backup'), label: 'Backup', match: (r: string) => r === '/backup' }
	];
</script>

<svelte:head>
	<link rel="icon" href={asset('/icon.svg')} type="image/svg+xml" />
	<title>Breaker Box</title>
</svelte:head>

<header>
	<a class="brand" href={resolve('/')}>⚡ Breaker Box</a>
	<nav>
		{#each links as link (link.href)}
			<a href={link.href} aria-current={link.match(route) ? 'page' : undefined}>
				{link.label}
			</a>
		{/each}
	</nav>
</header>

{#if data.storage && !data.storage.persistent}
	<p class="warning" role="status">
		This browser can't store data for Breaker Box, so changes are lost when you close the tab.
		<a href={resolve('/backup')}>Download a backup</a> before you leave.
	</p>
{/if}

<!-- The map wants the full width of the window. -->
<main class:wide={route === '/map'}>
	{@render children()}
</main>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 0.75rem 1.25rem;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		flex-wrap: wrap;
	}
	.brand {
		font-weight: 700;
		color: var(--text);
		text-decoration: none;
	}
	nav {
		display: flex;
		gap: 1rem;
	}
	nav a {
		color: var(--muted);
		text-decoration: none;
		padding: 0.2rem 0;
		border-bottom: 2px solid transparent;
	}
	nav a[aria-current='page'] {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
	.warning {
		margin: 0;
		padding: 0.6rem 1.25rem;
		background: var(--warning-bg, #fff4d6);
		color: var(--text);
		border-bottom: 1px solid var(--border);
	}
	main {
		padding: 1.25rem;
		max-width: 1200px;
		margin: 0 auto;
	}
	main.wide {
		max-width: 1600px;
	}
</style>
