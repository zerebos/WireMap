<script lang="ts">
	// Trace step 1's bottom sheet: where the breaker is, and "flip it off". The scrim isn't
	// clickable (Cancel or Escape closes it); focus stays inside while it's open.
	import type { Breaker, Panel } from '$lib/db/schema';
	import { trapTab } from './trap';
	import { physicalPosition, rowCount, slotAt, slotLabel, spacesOf } from '$lib/panel';

	let {
		breaker,
		panel,
		onstart,
		oncancel
	}: { breaker: Breaker; panel: Panel; onstart: () => void; oncancel: () => void } = $props();

	// Which half of each slot it takes: null = the whole slot (a quad pair takes a half of two slots).
	const hit = $derived(new Map(spacesOf(breaker, panel).map((sp) => [sp.slot, sp.half])));
	const cells = $derived(
		Array.from({ length: rowCount(panel) }, (_, r) =>
			(['left', 'right'] as const).map((side) => slotAt(side, r + 1, panel))
		).flat()
	);

	let sheet: HTMLDivElement;
	let primary: HTMLButtonElement;
	$effect(() => {
		primary.focus();
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			oncancel();
			return;
		}
		trapTab(e, sheet);
	}
</script>

<div class="scrim" aria-hidden="true"></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="sheet" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="sheet-t" aria-describedby="sheet-d" bind:this={sheet} {onkeydown}>
	<div class="grab"></div>
	<div class="top">
		<div class="mini" aria-hidden="true">
			{#each cells as s, i (i)}
				{#if hit.get(s)}
					<!-- A tandem or quad half: only its half of the slot lights. -->
					<span class="cell split"><span class:is-t={hit.get(s) === 'A'}></span><span class:is-t={hit.get(s) === 'B'}></span></span>
				{:else}
					<span class="cell" class:is-t={hit.has(s)}></span>
				{/if}
			{/each}
		</div>
		<div class="txt">
			<span class="ov">Step 1 of 3</span>
			<h2 id="sheet-t">Flip breaker {slotLabel(breaker, panel)} off</h2>
			<span class="pos">{physicalPosition(breaker, panel)}</span>
			<span id="sheet-d" class="desc"
				>{breaker.label || 'Unlabeled breaker'}. Everything it feeds will lose power — save your work on anything plugged in.</span
			>
		</div>
	</div>
	<div class="acts">
		<button type="button" class="btn btn-pri go" bind:this={primary} onclick={onstart}>It’s off — start marking</button>
		<button type="button" class="btn cancel" onclick={oncancel}>Cancel</button>
	</div>
</div>

<style>
	.scrim {
		position: absolute;
		inset: 0;
		background: var(--scrim);
	}
	.sheet {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		background: var(--surface);
		border-radius: 18px 18px 0 0;
		padding: 10px 16px 24px;
		display: flex;
		flex-direction: column;
		gap: 18px;
		box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.3);
		max-height: 100%;
		overflow: auto;
	}
	.grab {
		align-self: center;
		width: 40px;
		height: 4px;
		border-radius: 2px;
		background: var(--line-2);
	}
	.top {
		display: flex;
		gap: 20px;
		align-items: center;
	}
	.mini {
		width: 110px;
		flex-shrink: 0;
		padding: 10px;
		border-radius: var(--r-lg);
		background: var(--bg);
		border: 1px solid var(--line-2);
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 2px 8px;
	}
	.cell {
		height: 6px;
		border-radius: 1px;
		background: var(--line-2);
	}
	.cell.split {
		display: flex;
		flex-direction: column;
		gap: 1px;
		background: none;
	}
	.cell.split span {
		flex: 1;
		border-radius: 1px;
		background: var(--line-2);
	}
	.cell.split span.is-t {
		background: var(--amber);
	}
	.cell.is-t {
		background: var(--amber);
		box-shadow:
			0 0 0 2px var(--surface),
			0 0 0 3.5px var(--amber);
	}
	.txt {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	h2 {
		font-size: 24px;
		font-weight: 800;
		font-stretch: 105%;
		line-height: 1.15;
	}
	.pos {
		font-size: 14px;
		font-weight: 600;
	}
	.desc {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.45;
	}
	.acts {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.go {
		width: 100%;
		height: 52px;
		font-size: 15px;
	}
	.cancel {
		width: 100%;
	}
</style>
