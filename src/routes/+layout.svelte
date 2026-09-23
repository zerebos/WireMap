<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';

	let { children } = $props();

	const links = [
		{ href: '/', label: 'Panels', match: (p: string) => p === '/' || p.startsWith('/panels') },
		{ href: '/devices', label: 'Devices', match: (p: string) => p.startsWith('/devices') },
		{ href: '/rooms', label: 'Rooms', match: (p: string) => p.startsWith('/rooms') }
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Breaker Box</title>
</svelte:head>

<header>
	<a class="brand" href="/">⚡ Breaker Box</a>
	<nav>
		{#each links as link (link.href)}
			<a href={link.href} aria-current={link.match(page.url.pathname) ? 'page' : undefined}>
				{link.label}
			</a>
		{/each}
	</nav>
</header>

<main>
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
	main {
		padding: 1.25rem;
		max-width: 1200px;
		margin: 0 auto;
	}
</style>
