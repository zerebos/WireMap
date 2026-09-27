<script lang="ts">
	// The breaker sheet on the phone Panel (DESIGN.md §5.12): where it is, what it is, three
	// actions, and what it powers. Close (or Escape) returns to the panel.
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/Icon.svelte';
	import type { Breaker, Panel } from '$lib/db/schema';
	import type { HouseIndex } from '$lib/house';
	import { PROTECTION_LABELS } from '$lib/constants';
	import { legsText, physicalPosition, quadTopOf, slotLabel } from '$lib/panel';
	import { access } from '$lib/access.svelte';
	import { trapTab } from './trap';

	let {
		ix,
		breaker,
		panel,
		onclose,
		onpick
	}: { ix: HouseIndex; breaker: Breaker; panel: Panel; onclose: () => void; onpick: (b: Breaker) => void } = $props();

	const items = $derived(ix.itemsOf(breaker.id));
	const inPanel = $derived(ix.house.breakers.filter((b) => b.panelId === breaker.panelId));
	const quadTop = $derived(quadTopOf(breaker, inPanel, panel));
	/** The other breakers in the same quad (§5.18), or the other half of a tandem slot (§5.15). */
	const mates = $derived(
		quadTop !== null
			? inPanel.filter((b) => b.id !== breaker.id && quadTopOf(b, inPanel, panel) === quadTop)
			: breaker.half
				? inPanel.filter((b) => b.slot === breaker.slot && b.half && b.id !== breaker.id)
				: []
	);
	const spec = $derived(
		breaker.poles === 2 ? `${breaker.amps}A · 2-pole · 240V` : `${breaker.amps}A · ${PROTECTION_LABELS[breaker.kind]} · 120V`
	);

	let sheet: HTMLDivElement;
	let closeBtn: HTMLButtonElement;
	$effect(() => {
		closeBtn.focus();
	});
	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
			return;
		}
		trapTab(e, sheet);
	}
</script>

<div class="scrim" aria-hidden="true"></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t" tabindex="-1" bind:this={sheet} {onkeydown}>
	<div class="top">
		<div class="grab"></div>
		<div class="hrow">
			<span class="bnum big">{slotLabel(breaker, panel)}</span>
			<div class="ttl">
				<span class="ov">{physicalPosition(breaker, panel)} · {legsText(breaker, panel)}</span>
				<h2 id="sh-t" class:is-unl={!breaker.label.trim()}>{breaker.label.trim() || 'Unlabeled'}</h2>
				<span class="spec">{spec}</span>
			</div>
			<button type="button" class="ibtn" aria-label="Close" bind:this={closeBtn} onclick={onclose}><Icon name="close" size={16} /></button>
		</div>
		{#each mates as mate (mate.id)}
			<button type="button" class="mate" onclick={() => onpick(mate)}>
				<span
					>{quadTop !== null ? 'Shares the quad with' : `Shares slot ${breaker.slot} with`} <strong>{slotLabel(mate, panel)}</strong> · {ix.labelOf(
						mate
					)}</span
				>
				<span aria-hidden="true">→</span>
			</button>
		{/each}
		<div class="acts" class:two={access.guest}>
			<a class="btn" href={resolve('/map') + `?circuit=${breaker.id}`}>Show on map</a>
			<a class="btn" href={resolve('/shutoff') + `?breaker=${breaker.id}`}>Shut off</a>
			{#if !access.guest}
				<a class="btn" href={resolve('/panel') + `?b=${breaker.id}&edit=1`}>Edit</a>
			{/if}
		</div>
	</div>
	<div class="list">
		<h3 class="ov">Powers · {items.length}</h3>
		{#each items as i (i.id)}
			<div class="row">
				<span class="ico"><Icon name={i.type} size={16} /></span>
				<span class="txt"><span class="in">{i.name}</span><span class="iw">{ix.whereOf(i)}</span></span>
				{#if i.breakerIds.length > 1}<span class="plus">{ix.plusOf(i, breaker.id)}</span>{/if}
			</div>
		{:else}
			<span class="none">Nothing mapped yet. Trace it to find out.</span>
		{/each}
	</div>
</div>

<style>
	.scrim {
		position: absolute;
		inset: 0;
		background: var(--scrim);
		z-index: 10;
	}
	.sheet {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		max-height: 78%;
		z-index: 11;
		background: var(--surface);
		border-radius: 18px 18px 0 0;
		display: flex;
		flex-direction: column;
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.3);
	}
	.top {
		padding: 10px 16px 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-bottom: 1px solid var(--line);
	}
	.grab {
		align-self: center;
		width: 40px;
		height: 4px;
		border-radius: 2px;
		background: var(--line-2);
	}
	.hrow {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.bnum.big {
		height: 40px;
		min-width: 52px;
		font-size: 15px;
		background: var(--amber);
		color: var(--on-amber);
	}
	.ttl {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	h2 {
		font-size: 22px;
		font-weight: 800;
		font-stretch: 105%;
		line-height: 1.15;
	}
	h2.is-unl {
		color: var(--warn);
		font-style: italic;
	}
	.spec {
		font-size: 13px;
		color: var(--muted);
	}
	.acts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}
	.acts.two {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.acts .btn {
		padding: 0 8px;
	}
	.list {
		flex-grow: 1;
		min-height: 0;
		overflow: auto;
		padding: 12px 16px 24px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	h3.ov {
		padding: 4px 0 6px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 48px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}
	.txt {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.none {
		font-size: 14px;
		color: var(--muted);
		padding: 8px 0;
	}
	.mate {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-height: 40px;
		padding: 0 12px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-lg);
		background: var(--raised);
		font: inherit;
		font-size: 13px;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.mate:hover {
		border-color: var(--btn-bd-h);
	}
</style>
