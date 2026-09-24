<script lang="ts">
	// The Panel on a phone (DESIGN.md §5.12): search, then the enclosure at full width with the
	// physical two columns. Tapping a breaker opens its sheet.
	import { tick } from 'svelte';
	import type { Breaker, Panel } from '$lib/db/schema';
	import type { HouseIndex } from '$lib/house';
	import { faceColumns, legOfRow, rowCount, slotLabel, spaceLabel, tandemOk, type Cell } from '$lib/panel';
	import { PROTECTION_TAGS } from '$lib/constants';
	import { search } from '$lib/search.svelte';
	import BreakerSheet from '$lib/components/phone/BreakerSheet.svelte';

	let {
		ix,
		panel,
		breakers,
		selected,
		showLegs,
		matches,
		onpick,
		onclose
	}: {
		ix: HouseIndex;
		panel: Panel;
		breakers: Breaker[];
		/** The breaker whose sheet is open. */
		selected: Breaker | null;
		showLegs: boolean;
		matches: (b: Breaker) => boolean;
		onpick: (b: Breaker) => void;
		onclose: () => void;
	} = $props();

	const face = $derived(faceColumns(panel, breakers));
	const rows = $derived(rowCount(panel));

	async function close() {
		const id = selected?.id;
		onclose();
		await tick();
		if (id !== undefined) document.querySelector<HTMLElement>(`[data-breaker="${id}"]`)?.focus();
	}
</script>

<div class="pp" inert={!!selected}>
	<div class="sbar">
		<label for="pq" class="sr">Search breakers and items</label>
		<input id="pq" class="inp" type="search" placeholder="Search breakers, items, rooms" bind:value={search.q} />
	</div>
	<div class="scroll">
		<div class="enc">
			<div class="main mono"><span class="mh"></span>MAIN {panel.mainAmps ? `${panel.mainAmps}A` : '—'}</div>
			<div class="cols">
				{#snippet col(cells: Cell<Breaker>[], r: boolean)}
					<div class="col">
						{#each cells as c (c.slot)}
							{#if c.halves}
								<div class="tdm" class:bad={!tandemOk(c.slot, panel)} role="group" aria-label="Tandem slot {c.slot}">
									{#each c.halves as h, i (i)}
										{#if h}
											<button
												type="button"
												class="pch"
												class:r
												class:is-sel={selected?.id === h.id}
												class:is-unl={!h.label.trim()}
												class:is-dim={!matches(h)}
												data-breaker={h.id}
												aria-label="Breaker {slotLabel(h, panel)}, {h.label.trim() || 'unlabeled'}, {h.amps} amp"
												onclick={() => onpick(h)}><span class="n">{slotLabel(h, panel)}</span><span class="pl">{h.label.trim() || 'Unlabeled'}</span></button
											>
										{:else}
											<div class="pch open" class:r><span class="n">{spaceLabel({ slot: c.slot, half: i === 0 ? 'A' : 'B' }, panel)}</span><span class="pl">Open</span></div>
										{/if}
									{/each}
								</div>
							{:else if c.breaker}
								{@const b = c.breaker}
								{@const tag = PROTECTION_TAGS[b.kind]}
								<button
									type="button"
									class="pb pb-{b.poles === 2 ? 2 : 1}"
									class:r
									class:is-sel={selected?.id === b.id}
									class:is-unl={!b.label.trim()}
									class:is-dim={!matches(b)}
									data-breaker={b.id}
									aria-label="Breaker {slotLabel(b, panel)}, {b.label.trim() || 'unlabeled'}, {b.amps} amp"
									onclick={() => onpick(b)}
								>
									<span class="n">{slotLabel(b, panel)} · {b.amps}A{#if tag}<span class="tg">{tag}</span>{/if}</span>
									<span class="l">{ix.fedPanelOf(b) ? `→ ${ix.fedPanelOf(b)?.name}` : b.label.trim() || 'Unlabeled'}</span>
								</button>
							{:else}
								<div class="pb pb-1 pb-open" class:r>
									<span class="n">{spaceLabel({ slot: c.slot, half: null }, panel)}</span>
									<span class="l">Open</span>
								</div>
							{/if}
						{/each}
					</div>
				{/snippet}
				{@render col(face.left, false)}
				<div class="legs" aria-hidden="true">
					{#each { length: rows }, i (i)}
						<div class="mono">{showLegs ? legOfRow(i + 1) : ''}</div>
					{/each}
				</div>
				{@render col(face.right, true)}
			</div>
		</div>
	</div>
</div>

{#if selected}
	<BreakerSheet {ix} breaker={selected} {panel} onclose={close} {onpick} />
{/if}

<style>
	.pp {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.sbar {
		flex-shrink: 0;
		padding: 10px 12px;
		border-bottom: 1px solid var(--line);
		background: var(--raised);
	}
	.sbar .inp {
		height: 42px;
	}
	.scroll {
		flex: 1 1 0;
		min-height: 0;
		overflow: auto;
		padding: 12px;
	}
	.enc {
		background: var(--enclosure);
		border: 1px solid var(--enclosure-bd);
		border-radius: 10px;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.main {
		align-self: center;
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--raised);
		border: 1px solid var(--enclosure-bd);
		border-radius: 5px;
		padding: 4px 10px 4px 4px;
		font-size: 12px;
		font-weight: 600;
	}
	.mh {
		width: 34px;
		height: 24px;
		border-radius: 3px;
		background: var(--handle);
	}
	.cols {
		display: flex;
		gap: 6px;
	}
	.col {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.legs {
		width: 16px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: var(--bus);
		border-radius: 3px;
	}
	.legs div {
		height: 46px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 8px;
		color: var(--bus-ink);
		writing-mode: vertical-rl;
	}
	.pb {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 1px;
		width: 100%;
		padding: 4px 14px 4px 8px;
		border: 1px solid var(--breaker-bd);
		border-radius: var(--r-sm);
		background: var(--raised);
		font: inherit;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		overflow: hidden;
	}
	.pb.r {
		padding: 4px 8px 4px 14px;
		text-align: right;
	}
	/* The handle strip, on the inner edge. */
	.pb::after {
		content: '';
		position: absolute;
		top: 6px;
		bottom: 6px;
		right: 3px;
		width: 5px;
		border-radius: 2px;
		background: var(--handle);
	}
	.pb.r::after {
		right: auto;
		left: 3px;
	}
	.pb-1 {
		height: 46px;
	}
	.pb-2 {
		height: 94px;
	}
	.n {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--muted);
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.pb.r .n {
		justify-content: flex-end;
	}
	.l {
		font-size: 13px;
		font-weight: 600;
		font-stretch: 78%;
		line-height: 1.15;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.pb.is-unl .l {
		color: var(--warn);
		font-style: italic;
	}
	.pb.is-sel {
		background: var(--amber);
		color: var(--on-amber);
		border-color: var(--on-amber);
	}
	.pb.is-sel .n,
	.pb.is-sel.is-unl .l {
		color: var(--on-amber);
	}
	.pb.is-dim {
		opacity: 0.3;
	}
	.pb-open {
		border-style: dashed;
		background: transparent;
		cursor: default;
	}
	.pb-open::after {
		display: none;
	}
	.pb-open .l {
		color: var(--muted);
		font-style: italic;
		font-weight: 500;
	}
	.tg {
		font-size: 9px;
		font-weight: 700;
		padding: 1px 3px;
		border-radius: 2px;
		background: var(--tag-bg);
		color: var(--tag-fg);
	}
	/* Tandem slot: the same 46px, split into two 20px halves (DESIGN.md §5.15). */
	.tdm {
		height: 46px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--breaker-bd);
		border-radius: var(--r-sm);
	}
	.tdm.bad {
		border-color: var(--warn);
		border-style: dashed;
	}
	.pch {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 20px;
		padding: 0 6px;
		border: 1px solid var(--breaker-bd);
		border-radius: 3px;
		background: var(--raised);
		font: inherit;
		font-size: 12px;
		font-stretch: 78%;
		font-weight: 600;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		min-width: 0;
	}
	.pch.r {
		flex-direction: row-reverse;
		text-align: right;
	}
	.pch .n {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--muted);
		font-stretch: 100%;
		font-weight: 400;
		flex-shrink: 0;
	}
	.pl {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pch.is-unl .pl {
		color: var(--warn);
		font-style: italic;
	}
	.pch.is-sel {
		background: var(--amber);
		color: var(--on-amber);
		border-color: var(--on-amber);
	}
	.pch.is-sel .n,
	.pch.is-sel.is-unl .pl {
		color: var(--on-amber);
	}
	.pch.is-dim {
		opacity: 0.3;
	}
	.pch.open {
		border-style: dashed;
		background: transparent;
		cursor: default;
	}
	.pch.open .pl {
		color: var(--muted);
		font-style: italic;
		font-weight: 500;
	}
</style>
