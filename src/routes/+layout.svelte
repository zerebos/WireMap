<script lang="ts">
	import '../app.css';
	import { asset, resolve } from '$app/paths';
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import PhoneShell from '$lib/components/phone/PhoneShell.svelte';
	import { mutate, needsSetup } from '$lib/house';
	import { updateSettings } from '$lib/db/ops';
	import { search } from '$lib/search.svelte';
	import { viewport } from '$lib/viewport.svelte';
	import { applyTheme, effectiveTheme } from '$lib/theme';

	let { data, children } = $props();

	const route = $derived(page.route.id ?? '');
	const links = [
		{ href: resolve('/panel'), label: 'Panel', path: '/panel' },
		{ href: resolve('/map'), label: 'Map', path: '/map' },
		{ href: resolve('/items'), label: 'Items', path: '/items' },
		{ href: resolve('/settings'), label: 'Settings', path: '/settings' }
	];
	// What the header search filters on each page.
	const placeholders: Record<string, string> = {
		'/panel': 'Search breakers, items, rooms',
		'/map': 'Filter circuits, items, rooms',
		'/items': 'Search items, rooms, breakers',
		'/settings': 'Search settings'
	};
	// The phone flows are full-screen, with their own back button; Sign in has no header.
	const phone = $derived(route.startsWith('/shutoff') || route.startsWith('/trace') || route === '/signin');

	// First-run setup (minimal header) and the pages that belong to a nav tab.
	const setup = $derived(route === '/setup');
	const tabOf = (r: string) => (r === '/directory' ? '/panel' : r);
	// With no panel yet, every page but Settings leads to setup.
	beforeNavigate((nav) => {
		if (nav.to && data.house && needsSetup(data.house, nav.to.route.id)) {
			nav.cancel();
			goto(resolve('/setup'));
		}
	});

	// Search belongs to the page it was typed on.
	afterNavigate(({ from, to }) => {
		if (from?.route.id !== to?.route.id) search.q = '';
	});

	// On a phone, Panel and Map draw their own phone views; the other tab pages keep their layout
	// inside the phone header and tab bar.
	const shelled = $derived.by(() => {
		if (!viewport.phone || !data.house) return null;
		if (route === '/items') return { title: 'Items', sub: `${data.house.items.length} items` };
		if (route === '/settings') return { title: 'Settings', sub: data.house.settings.homeName };
		if (route === '/directory') return { title: data.house.panel?.name ?? 'Panel', sub: 'Directory' };
		return null;
	});

	const settings = $derived(data.house?.settings);
	$effect(() => {
		if (settings) applyTheme(settings.theme);
	});
	// Follow OS changes while on System.
	let osDark = $state(typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
	$effect(() => {
		const mq = matchMedia('(prefers-color-scheme: dark)');
		const on = () => (osDark = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});
	const shown = $derived.by(() => {
		void osDark;
		return settings ? effectiveTheme(settings.theme) : 'dark';
	});
	const themeLabel = $derived(shown === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
	const toggleTheme = () => mutate(() => updateSettings({ theme: shown === 'dark' ? 'light' : 'dark' }));

	const panel = $derived(data.house?.panel);
</script>

<svelte:head>
	<link rel="icon" href={asset('/icon.svg')} type="image/svg+xml" />
	<title>{settings ? `${settings.homeName} · Breakerbook` : 'Breakerbook'}</title>
</svelte:head>

<div class="app">
	{#if !phone && !(viewport.phone && !setup)}
		<header>
			<a class="brand" href={resolve('/')}>
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"
					><rect x="5" y="2.5" width="14" height="19" rx="2" /><rect x="9" y="6" width="6" height="7" rx="1" fill="currentColor" /><path
						d="M9 17h6"
					/></svg
				>
				<span>Breakerbook</span>
			</a>
			{#if setup}
				<span class="mono step">Setup</span>
			{:else}
				<nav aria-label="Primary">
					{#each links as link (link.href)}
						<a class="nav" class:is-on={tabOf(route) === link.path} href={link.href} aria-current={tabOf(route) === link.path ? 'page' : undefined}>
							{link.label}
						</a>
					{/each}
				</nav>
				<div class="grow"></div>
				<label for="q" class="sr">{placeholders[tabOf(route)] ?? 'Search'}</label>
				<div class="searchbox">
					<Icon name="search" size={16} />
					<input id="q" class="search" type="search" placeholder={placeholders[tabOf(route)] ?? 'Search'} bind:value={search.q} />
				</div>
				<button type="button" class="tgl" onclick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
					<Icon name={shown === 'dark' ? 'sun' : 'moon'} />
				</button>
				{#if panel}
					<span class="mono meta">{panel.name}{panel.mainAmps ? ` · ${panel.mainAmps}A` : ''}</span>
				{/if}
			{/if}
		</header>
	{/if}
	{#if !phone}
		{#if data.storage && !data.storage.persistent}
			<p class="warning" role="status">
				This browser can't store data for Breakerbook, so changes are lost when you close the tab.
				<a href={resolve('/settings') + '#data'}>Download a backup</a> before you leave.
			</p>
		{/if}
	{/if}

	<div class="body">
		{#if shelled}
			<PhoneShell title={shelled.title} sub={shelled.sub}>{@render children()}</PhoneShell>
		{:else}
			{@render children()}
		{/if}
	</div>
</div>

<style>
	/* The window never scrolls; each page scrolls its own regions. */
	.app {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.body {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	header {
		height: var(--header-h);
		flex-shrink: 0;
		background: var(--hdr);
		color: var(--hdr-fg);
		display: flex;
		align-items: center;
		gap: 28px;
		border-bottom: 1px solid var(--hdr-bd);
		padding: 0 24px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--amber);
		text-decoration: none;
	}
	.brand span {
		color: var(--hdr-fg);
		font-size: 18px;
		font-weight: 800;
		font-stretch: 112%;
		letter-spacing: -0.01em;
	}
	nav {
		display: flex;
		gap: 2px;
		align-self: stretch;
	}
	.nav {
		display: flex;
		align-items: center;
		padding: 0 14px;
		color: var(--hdr-nav);
		text-decoration: none;
		font-size: 14px;
		font-weight: 600;
		border-top: 3px solid transparent;
		border-bottom: 3px solid transparent;
	}
	.nav:hover,
	.nav.is-on {
		color: var(--hdr-fg);
	}
	.nav.is-on {
		border-bottom-color: var(--amber);
	}
	.grow {
		flex-grow: 1;
	}
	.searchbox {
		position: relative;
		display: flex;
		align-items: center;
		color: var(--hdr-nav);
	}
	.searchbox :global(svg) {
		position: absolute;
		left: 12px;
		pointer-events: none;
	}
	.search {
		width: 340px;
		height: var(--control-h-sm);
		border: 1px solid var(--hdr-field-bd);
		border-radius: var(--r-lg);
		background: var(--hdr-field);
		color: var(--hdr-fg);
		font: inherit;
		font-size: 14px;
		padding: 0 12px 0 36px;
	}
	.search::placeholder {
		color: var(--hdr-placeholder);
	}
	.search:focus {
		outline: 2px solid var(--amber);
		outline-offset: 1px;
	}
	.tgl {
		width: 40px;
		height: 40px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--hdr-field-bd);
		border-radius: var(--r-lg);
		background: transparent;
		color: var(--hdr-fg);
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}
	.tgl:hover {
		background: var(--hdr-field);
	}
	.meta {
		font-size: 12px;
		color: var(--hdr-nav);
		white-space: nowrap;
	}
	/* Setup: wordmark and "Setup" only. */
	.step {
		font-size: 12px;
		color: var(--hdr-nav);
		margin-left: -6px;
	}
	.warning {
		margin: 0;
		padding: 10px 24px;
		background: var(--amber-soft);
		color: var(--ink);
		border-bottom: 1.5px solid var(--amber);
		font-size: 14px;
	}
</style>
