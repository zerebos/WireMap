<script lang="ts" module>
	import type { Numbering, Protection } from '$lib/constants';

	/** A new breaker, or with `tandem` a pair of halves (A uses label/amps, B labelB/ampsB). */
	export type NewBreaker = { label: string; amps: number; kind: Protection; poles: 1 | 2; tandem: boolean; labelB: string; ampsB: number };
	export const blankBreaker = (amps = 20): NewBreaker => ({
		label: '',
		amps,
		kind: 'standard',
		poles: 1,
		tandem: false,
		labelB: '',
		ampsB: amps
	});
</script>

<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { AMPS, PROTECTIONS, PROTECTION_LABELS } from '$lib/constants';
	import { slotText, tandemOk, tandemText } from '$lib/panel';

	let {
		form = $bindable(),
		slot,
		panel,
		no2Why,
		directoryHref,
		oncancel,
		onadd
	}: {
		form: NewBreaker;
		slot: number;
		panel: { slotCount: number; numbering: Numbering; tandemSlots: string | null };
		/** Why a 2-pole breaker can't go here, or null if it can. */
		no2Why: string | null;
		directoryHref: string;
		oncancel: () => void;
		onadd: (next: boolean) => void;
	} = $props();

	const noTandemWhy = $derived(tandemOk(slot, panel) ? null : `Slot ${slot} isn’t rated for tandems (${tandemText(panel)}).`);
	const tandem = $derived(form.tandem && !noTandemWhy);
	const poles = $derived(no2Why || tandem ? 1 : form.poles);
	const size = (poles: 1 | 2, tandem: boolean) => {
		form.poles = poles;
		form.tandem = tandem;
	};
	let labelInput = $state<HTMLInputElement>();

	/** Puts the cursor in the label field (after picking a slot, or after "Add & next"). */
	export function focus() {
		labelInput?.focus();
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		onadd(false);
	}
</script>

<form class="nb" onsubmit={submit}>
	<div class="row">
		<span class="mono over">New breaker · {slotText({ slot, poles }, panel)}</span>
		<button type="button" class="ibtn" aria-label="Cancel new breaker" onclick={oncancel}><Icon name="close" size={16} /></button>
	</div>
	{#if !tandem}
		<div>
			<label for="n-label" class="sr">Label</label>
			<input
				bind:this={labelInput}
				id="n-label"
				class="ttl"
				type="text"
				bind:value={form.label}
				placeholder="What does it power?"
				autocomplete="off"
			/>
		</div>
	{/if}
	<div class="grid2">
		{#if !tandem}
			<div class="fld">
				<label for="n-amp">Amperage</label>
				<select id="n-amp" class="inp" bind:value={form.amps}>
					{#each AMPS as a (a)}
						<option value={a}>{a} A</option>
					{/each}
				</select>
			</div>
		{/if}
		<div class="fld">
			<label for="n-type">Protection</label>
			<select id="n-type" class="inp" bind:value={form.kind}>
				{#each PROTECTIONS as p (p)}
					<option value={p}>{PROTECTION_LABELS[p]}</option>
				{/each}
			</select>
		</div>
	</div>
	<div class="fld">
		<span class="k" id="n-sz">Size</span>
		<div class="seg" role="group" aria-labelledby="n-sz">
			<button type="button" class="sb" class:is-on={poles === 1 && !tandem} aria-pressed={poles === 1 && !tandem} onclick={() => size(1, false)}>
				1-pole
			</button>
			<button
				type="button"
				class="sb"
				class:is-on={poles === 2}
				aria-pressed={poles === 2}
				disabled={!!no2Why}
				aria-describedby={no2Why ? 'n-no2' : undefined}
				onclick={() => size(2, false)}
			>
				2-pole
			</button>
			<button
				type="button"
				class="sb"
				class:is-on={tandem}
				aria-pressed={tandem}
				disabled={!!noTandemWhy}
				aria-describedby={noTandemWhy ? 'n-not' : undefined}
				onclick={() => size(1, true)}
			>
				Tandem A+B
			</button>
		</div>
	</div>
	{#if tandem}
		<div class="halves">
			{#each ['A', 'B'] as h (h)}
				<div class="half">
					<span class="mono hn">{slot}{h}</span>
					<label for="n-l{h}" class="sr">Label for {slot}{h}</label>
					{#if h === 'A'}
						<input bind:this={labelInput} id="n-lA" class="inp" type="text" bind:value={form.label} placeholder="What does it power?" autocomplete="off" />
					{:else}
						<input id="n-lB" class="inp" type="text" bind:value={form.labelB} placeholder="What does it power?" autocomplete="off" />
					{/if}
					<label for="n-a{h}" class="sr">Amperage for {slot}{h}</label>
					{#if h === 'A'}
						<select id="n-aA" class="inp amp" bind:value={form.amps}>
							{#each AMPS as a (a)}<option value={a}>{a} A</option>{/each}
						</select>
					{:else}
						<select id="n-aB" class="inp amp" bind:value={form.ampsB}>
							{#each AMPS as a (a)}<option value={a}>{a} A</option>{/each}
						</select>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
	{#if noTandemWhy}<span class="why" id="n-not">{noTandemWhy}</span>{/if}
	{#if no2Why}<span class="why" id="n-no2">{no2Why}</span>{/if}
	<div class="acts">
		<button type="submit" class="btn btn-pri">Add breaker</button>
		<button type="button" class="btn" onclick={() => onadd(true)}>Add &amp; next slot</button>
	</div>
	<div class="foot">
		Adding a lot? <a href={directoryHref}>Copy the whole panel directory</a> on one screen instead.
	</div>
</form>

<style>
	.nb {
		flex-grow: 1;
		min-height: 0;
		overflow: auto;
		padding: 28px 32px;
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.over {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--muted);
		text-transform: uppercase;
	}
	.ttl {
		width: 100%;
		border: 0;
		border-bottom: 2px solid var(--line-2);
		padding: 2px 0 6px;
		background: transparent;
		font-family: inherit;
		font-size: 28px;
		font-weight: 800;
		font-stretch: 108%;
		color: var(--ink);
	}
	.ttl:focus {
		outline: none;
		border-bottom-color: var(--amber);
	}
	.ttl::placeholder {
		color: var(--muted);
		font-weight: 600;
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}
	.halves {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.half {
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr) 110px;
		align-items: center;
		gap: 12px;
	}
	.hn {
		font-size: 13px;
		font-weight: 600;
		color: var(--soft);
		text-align: right;
	}
	.seg .sb {
		flex: 1 1 0;
		justify-content: center;
	}
	.sb:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.sb:disabled:hover {
		color: var(--soft);
	}
	.why {
		font-size: 13px;
		color: var(--muted);
	}
	.acts {
		display: flex;
		gap: 8px;
	}
	.foot {
		margin-top: auto;
		padding-top: 16px;
		border-top: 1px solid var(--line);
		font-size: 13px;
		color: var(--muted);
		line-height: 1.5;
	}
	.foot a {
		font-weight: 600;
	}
</style>
