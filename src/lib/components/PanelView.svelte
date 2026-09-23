<script lang="ts">
	import { occupiedSlots, slotColumn, slotRow } from '$lib/panel';
	import { BREAKER_KIND_LABELS, type BreakerKind } from '$lib/constants';

	type PanelBreaker = {
		id: number;
		slot: number;
		poles: number;
		amps: number;
		kind: BreakerKind;
		label: string;
		color: string | null;
		devices: unknown[];
	};

	let {
		slotCount,
		mainAmps,
		breakers,
		selectedId = null,
		selectedSlot = null,
		hrefFor,
		hrefForSlot
	}: {
		slotCount: number;
		mainAmps: number | null;
		breakers: PanelBreaker[];
		selectedId?: number | null;
		selectedSlot?: number | null;
		hrefFor: (b: PanelBreaker) => string;
		hrefForSlot: (slot: number) => string;
	} = $props();

	const rows = $derived(Math.ceil(slotCount / 2));
	const taken = $derived(new Set(breakers.flatMap(occupiedSlots)));
	const empty = $derived(
		Array.from({ length: slotCount }, (_, i) => i + 1).filter((s) => !taken.has(s))
	);

	const place = (slot: number, span = 1) =>
		`grid-row: ${slotRow(slot) + 1} / span ${span}; grid-column: ${slotColumn(slot) === 'left' ? 2 : 4};`;
</script>

<div class="panel" aria-label="Breaker panel">
	<div class="main">
		<span class="handle"></span>
		<span>MAIN {mainAmps ? `${mainAmps}A` : ''}</span>
	</div>

	<div class="grid" style="grid-template-rows: repeat({rows}, var(--slot-h));">
		{#each { length: rows }, r (r)}
			<span class="num left" style="grid-row: {r + 1}">{r * 2 + 1}</span>
			<span class="num right" style="grid-row: {r + 1}">{r * 2 + 2}</span>
		{/each}
		<span class="spine" style="grid-row: 1 / span {rows}"></span>

		{#each empty as slot (slot)}
			<a
				class="empty {slotColumn(slot)}"
				class:selected={selectedSlot === slot}
				style={place(slot)}
				href={hrefForSlot(slot)}
				data-sveltekit-noscroll
				aria-label="Add breaker in slot {slot}"
			>
				+
			</a>
		{/each}

		{#each breakers as b (b.id)}
			<a
				class="breaker {slotColumn(b.slot)}"
				class:selected={selectedId === b.id}
				class:double={b.poles === 2}
				style="{place(b.slot, b.poles)} --tag: {b.color ?? 'transparent'}"
				href={hrefFor(b)}
				data-sveltekit-noscroll
				aria-label="Slot {b.slot}: {b.label || 'unlabeled'}, {b.amps} amps"
			>
				<span class="label">
					<span class="text">{b.label || 'Unlabeled'}</span>
					<span class="meta">
						{b.devices.length} item{b.devices.length === 1 ? '' : 's'}
						{#if b.kind !== 'standard'}
							<span class="badge" title={BREAKER_KIND_LABELS[b.kind]}>{b.kind.toUpperCase()}</span>
						{/if}
					</span>
				</span>
				<span class="toggle">
					<span class="lever"></span>
					<span class="amps">{b.amps}</span>
				</span>
			</a>
		{/each}
	</div>
</div>

<style>
	.panel {
		--slot-h: 2.6rem;
		background: linear-gradient(160deg, var(--metal), var(--metal-dark));
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem;
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.25),
			0 4px 14px rgb(0 0 0 / 0.12);
	}

	.main {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		margin: 0 auto 0.8rem;
		width: 12rem;
		padding: 0.5rem;
		background: var(--breaker);
		color: var(--breaker-text);
		border-radius: 6px;
		font-weight: 700;
		letter-spacing: 0.05em;
		font-size: 0.85rem;
	}
	.main .handle {
		width: 2.6rem;
		height: 0.9rem;
		border-radius: 3px;
		background: #555c66;
	}

	.grid {
		display: grid;
		grid-template-columns: 1.6rem minmax(0, 1fr) 0.8rem minmax(0, 1fr) 1.6rem;
		gap: 3px 4px;
	}

	.num {
		align-self: center;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		color: var(--muted);
	}
	.num.left {
		grid-column: 1;
		text-align: right;
	}
	.num.right {
		grid-column: 5;
	}
	.spine {
		grid-column: 3;
		background: repeating-linear-gradient(to bottom, #8b939e 0 3px, transparent 3px 8px);
		border-radius: 2px;
		opacity: 0.6;
	}

	.empty {
		display: grid;
		place-items: center;
		border: 1px dashed color-mix(in srgb, var(--text) 30%, transparent);
		border-radius: 5px;
		color: var(--muted);
		text-decoration: none;
		opacity: 0.55;
	}
	.empty:hover,
	.empty.selected {
		opacity: 1;
		border-color: var(--accent);
		color: var(--accent);
	}

	.breaker {
		display: flex;
		align-items: stretch;
		min-width: 0;
		background: var(--breaker);
		color: var(--breaker-text);
		border-radius: 5px;
		text-decoration: none;
		overflow: hidden;
		outline: 2px solid transparent;
		outline-offset: 1px;
		transition: outline-color 0.1s;
		box-shadow: inset 4px 0 0 var(--tag);
	}
	.breaker.right {
		flex-direction: row-reverse;
		box-shadow: inset -4px 0 0 var(--tag);
	}
	.breaker:hover {
		outline-color: color-mix(in srgb, var(--accent) 50%, transparent);
	}
	.breaker.selected {
		outline-color: var(--accent);
	}

	.label {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 0.2rem 0.55rem 0.2rem 0.7rem;
		line-height: 1.15;
	}
	.right .label {
		text-align: right;
		padding: 0.2rem 0.7rem 0.2rem 0.55rem;
	}
	.text {
		font-size: 0.85rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font-size: 0.7rem;
		opacity: 0.7;
	}
	.badge {
		margin-left: 0.25rem;
		padding: 0 0.25rem;
		border: 1px solid currentColor;
		border-radius: 3px;
		font-size: 0.62rem;
	}

	.toggle {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		width: 2.8rem;
		background: #3a3f47;
		flex-shrink: 0;
	}
	.lever {
		width: 1.6rem;
		height: 0.7rem;
		border-radius: 2px;
		background: linear-gradient(#6b737e, #4a5058);
	}
	.double .lever {
		height: 2.8rem;
	}
	.amps {
		font-size: 0.7rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 520px) {
		.panel {
			--slot-h: 2.9rem;
			padding: 0.6rem;
		}
		.toggle {
			width: 2.1rem;
		}
		.lever {
			width: 1.1rem;
		}
		.label {
			padding-inline: 0.45rem;
		}
	}
</style>
