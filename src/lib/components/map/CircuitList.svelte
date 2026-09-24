<script lang="ts">
	import type { Breaker } from '$lib/db/schema';
	import { plural, type HouseIndex } from '$lib/house';

	let {
		ix,
		q,
		lit,
		onpick,
		empty = false
	}: {
		ix: HouseIndex;
		/** The floor on show has no rooms or placed items yet. */
		empty?: boolean;
		/** Trimmed, lower-cased header search. */
		q: string;
		/** Breakers the current selection lights. */
		lit: Set<number>;
		onpick: (b: Breaker) => void;
	} = $props();

	const all = $derived(ix.house.breakers);
	const shown = $derived(
		all.filter((b) => {
			if (!q) return true;
			if (ix.labelOf(b).toLowerCase().includes(q) || String(b.slot) === q || ix.slotOf(b) === q) return true;
			return ix.itemsOf(b.id).some((i) => `${i.name} ${ix.roomName(i.roomId)}`.toLowerCase().includes(q));
		})
	);
</script>

<aside aria-label="Circuits" class="circuits">
	<div class="head">
		<h2>Circuits</h2>
		<span class="mono count">{shown.length} of {all.length}</span>
	</div>
	<p class="hint">
		{empty ? 'Nothing placed yet, so nothing lights up. Add rooms and items first.' : 'Pick one to light up everything it feeds.'}
	</p>
	<div class="list">
		{#each shown as b (b.id)}
			{@const sel = lit.has(b.id)}
			<button type="button" class="circ" class:is-sel={sel} class:is-unl={!b.label} aria-pressed={sel} onclick={() => onpick(b)}>
				<span class="cn">{ix.slotOf(b)}</span>
				<span class="txt">
					<span class="cl">{ix.labelOf(b)}</span>
					<span class="cm">{b.amps}A · {plural(ix.itemsOf(b.id).length, 'item')}</span>
				</span>
				{#if ix.tagOf(b)}<span class="tag">{ix.tagOf(b)}</span>{/if}
			</button>
		{:else}
			<p class="empty">No circuits match “{q}”.</p>
		{/each}
	</div>
</aside>

<style>
	.circuits {
		width: 300px;
		flex-shrink: 0;
		background: var(--raised);
		border-right: 1px solid var(--line-2);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.head {
		padding: 20px 20px 6px;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	h2 {
		font-size: 20px;
		font-weight: 800;
		font-stretch: 108%;
	}
	.count {
		font-size: 12px;
		color: var(--muted);
	}
	.hint {
		margin: 0 20px 12px;
		font-size: 13px;
		color: var(--muted);
		line-height: 1.45;
	}
	.list {
		flex-grow: 1;
		min-height: 0;
		overflow: auto;
		padding: 0 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.empty {
		padding: 8px 10px;
		font-size: 13px;
		color: var(--muted);
	}
	.circ {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 52px;
		padding: 8px 10px;
		border: 1px solid transparent;
		border-radius: var(--r-lg);
		background: transparent;
		font: inherit;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		flex-shrink: 0;
	}
	.circ:hover {
		background: var(--bg);
	}
	.cn {
		min-width: 44px;
		height: 28px;
		padding: 0 5px;
		border-radius: var(--r-sm);
		background: var(--handle);
		color: var(--hdr-fg);
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.txt {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.cl {
		font-size: 14px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cm {
		font-size: 12px;
		color: var(--muted);
	}
	.circ.is-unl .cl {
		font-style: italic;
		color: var(--warn);
	}
	.circ.is-sel {
		background: var(--amber);
		border-color: var(--fed-bd);
		color: var(--on-amber);
	}
	.circ.is-sel .cl {
		color: var(--on-amber);
	}
	.circ.is-sel .cm {
		color: var(--on-amber-muted);
	}
</style>
