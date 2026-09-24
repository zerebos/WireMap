<script lang="ts">
	// A subpanel breaker's power path, for "Fed by" rows (DESIGN.md §5.17): Main 30/32 › Garage ›
	// G6 · Freezer. Nothing for a breaker in the main panel.
	import Icon from '$lib/components/Icon.svelte';
	import type { Breaker } from '$lib/db/schema';
	import type { HouseIndex } from '$lib/house';
	import { panelShort } from '$lib/panel';

	let { ix, breaker }: { ix: HouseIndex; breaker: Breaker } = $props();

	const above = $derived(ix.feedersAbove(ix.panelOf(breaker)));
</script>

{#if above.length}
	<div class="fp" aria-label="Power path">
		{#each above as f (f.id)}
			<span class="pc">{panelShort(ix.panelOf(f))} {ix.slotOf(f)}</span>
			<Icon name="next" size={14} stroke={2.2} />
			<span class="pc">{panelShort(ix.fedPanelOf(f)!)}</span>
			<Icon name="next" size={14} stroke={2.2} />
		{/each}
		<span class="pc cur">{ix.slotOf(breaker)} · {ix.labelOf(breaker)}</span>
	</div>
{/if}

<style>
	.fp {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		color: var(--muted);
	}
	.pc {
		display: inline-flex;
		align-items: center;
		height: 28px;
		padding: 0 10px;
		border-radius: var(--r-md);
		background: var(--bg);
		border: 1px solid var(--line-2);
		font-size: 12px;
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
	}
	.pc.cur {
		background: var(--amber);
		border-color: var(--amber);
		color: var(--on-amber);
	}
</style>
