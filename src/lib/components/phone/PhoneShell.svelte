<script lang="ts">
	// The phone layout around Panel, Map, Items and Settings (DESIGN.md §5.12): a 56px header
	// and a 64px bottom tab bar in place of the desktop header.
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import { access } from '$lib/access.svelte';

	let { title, sub = '', children }: { title: string; sub?: string; children: Snippet } = $props();

	const route = $derived(page.route.id ?? '');
	type Tab = { href: ReturnType<typeof resolve>; label: string; icon: 'panel' | 'map' | 'list' | 'bolt'; on: boolean };
	const tabs: Tab[] = $derived([
		{ href: resolve('/panel'), label: 'Panel', icon: 'panel' as const, on: route === '/panel' || route === '/directory' },
		{ href: resolve('/map'), label: 'Map', icon: 'map' as const, on: route === '/map' },
		{ href: resolve('/items'), label: 'Items', icon: 'list' as const, on: route === '/items' },
		...(access.guest ? [] : [{ href: resolve('/trace'), label: 'Trace', icon: 'bolt' as const, on: route === '/trace' }])
	]);
</script>

<div class="pshell">
	<header>
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"
			><rect x="5" y="2.5" width="14" height="19" rx="2" /><rect x="9" y="6" width="6" height="7" rx="1" fill="currentColor" /><path
				d="M9 17h6"
			/></svg
		>
		<div class="ttl">
			<h1>{title}</h1>
			{#if sub}<span class="mono sub">{sub}</span>{/if}
		</div>
		<div class="grow"></div>
		{#if access.guest}
			<span class="mono ro">READ-ONLY</span>
			<a class="btn signin" href={resolve('/signin')}>Sign in</a>
		{:else}
			<a class="tgl" href={resolve('/settings')} aria-label="Settings" aria-current={route === '/settings' ? 'page' : undefined}
				><Icon name="gear" size={18} /></a
			>
		{/if}
	</header>

	<div class="pbody">
		{@render children()}
	</div>

	<nav aria-label="Primary">
		{#each tabs as t (t.href)}
			<a class="tab" class:is-on={t.on} href={t.href} aria-current={t.on ? 'page' : undefined}><Icon name={t.icon} size={22} />{t.label}</a>
		{/each}
	</nav>
</div>

<style>
	.pshell {
		position: relative;
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		overflow: hidden;
	}
	header {
		flex-shrink: 0;
		height: 56px;
		padding: 0 10px 0 14px;
		display: flex;
		align-items: center;
		gap: 10px;
		background: var(--hdr);
		color: var(--hdr-fg);
		border-bottom: 1px solid var(--hdr-bd);
	}
	header > svg {
		color: var(--amber);
		flex-shrink: 0;
	}
	.ttl {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	h1 {
		font-size: 16px;
		font-weight: 800;
		font-stretch: 108%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 11px;
		color: var(--hdr-nav);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.grow {
		flex-grow: 1;
	}
	.ro {
		font-size: 11px;
		font-weight: 600;
		color: var(--amber);
		border: 1px solid var(--amber);
		border-radius: 10px;
		padding: 2px 8px;
		flex-shrink: 0;
	}
	.signin {
		height: 36px;
		padding: 0 10px;
		background: transparent;
		color: var(--hdr-fg);
		border-color: var(--hdr-field-bd);
	}
	.signin:hover {
		background: var(--hdr-field);
		color: var(--hdr-fg);
		border-color: var(--hdr-field-bd);
	}
	.tgl {
		width: 40px;
		height: 40px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--hdr-field-bd);
		border-radius: var(--r-lg);
		color: var(--hdr-fg);
		flex-shrink: 0;
	}
	.tgl:hover {
		background: var(--hdr-field);
		color: var(--hdr-fg);
	}
	/* Sheets inside cover the whole screen, header and tab bar included. */
	.pbody {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	nav {
		flex-shrink: 0;
		height: 64px;
		display: flex;
		border-top: 1px solid var(--line-2);
		background: var(--raised);
	}
	.tab {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		font-size: 11px;
		font-weight: 600;
		color: var(--muted);
		text-decoration: none;
	}
	.tab:hover,
	.tab.is-on {
		color: var(--ink);
	}
	.tab.is-on :global(svg) {
		color: var(--amber);
	}
	.tab:focus-visible {
		outline: 3px solid var(--focus);
		outline-offset: -3px;
	}
</style>
