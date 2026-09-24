<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import type { HouseItem } from '$lib/house';

	// .srow (inspector lists) or the compact .irow2 (room circuit cards).
	let {
		item,
		where = '',
		compact = false,
		plus = '',
		onclick
	}: {
		item: HouseItem;
		where?: string;
		compact?: boolean;
		/** The item's other breakers, "+21", when it's on more than one (DESIGN.md §5.11). */
		plus?: string;
		onclick: () => void;
	} = $props();
</script>

{#if compact}
	<button type="button" class="irow2" {onclick}>
		<span class="ico"><Icon name={item.type} size={16} /></span>
		<span class="n">{item.name}</span>
		{#if plus}<span class="plus" title="Also on {plus.slice(1)}">{plus}</span>{/if}
	</button>
{:else}
	<button type="button" class="srow" {onclick}>
		<span class="ico"><Icon name={item.type} size={16} /></span>
		<span class="txt"><span class="in">{item.name}</span><span class="iw">{where}</span></span>
		{#if plus}<span class="plus" title="Also on {plus.slice(1)}">{plus}</span>{/if}
	</button>
{/if}

<style>
	.srow {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--surface);
		font: inherit;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		min-height: 48px;
	}
	.srow:hover {
		border-color: var(--btn-bd-h);
	}
	.txt {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.irow2 {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 40px;
		padding: 4px 6px;
		border: 0;
		border-radius: var(--r-md);
		background: transparent;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.irow2:hover {
		background: var(--bg);
	}
	.irow2 .ico {
		width: 26px;
		height: 26px;
	}
	.n {
		font-size: 13px;
		font-weight: 600;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
