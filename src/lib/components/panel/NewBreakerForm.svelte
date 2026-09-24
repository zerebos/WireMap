<script lang="ts" module>
	import type { Numbering, Protection } from '$lib/constants';

	/**
	 * A new breaker; with `tandem` a pair of halves (A uses label/amps, B labelB/ampsB); with `quad` a
	 * quad (§5.18): outer pair label/amps, and either the inner pair labelB/ampsB or, when `mixed`,
	 * two 1-poles in the middle halves (labelB/ampsB upper, labelC/ampsC lower).
	 */
	export type NewBreaker = {
		label: string;
		amps: number;
		kind: Protection;
		poles: 1 | 2;
		tandem: boolean;
		labelB: string;
		ampsB: number;
		quad: boolean;
		mixed: boolean;
		labelC: string;
		ampsC: number;
	};
	export const blankBreaker = (amps = 20): NewBreaker => ({
		label: '',
		amps,
		kind: 'standard',
		poles: 1,
		tandem: false,
		labelB: '',
		ampsB: amps,
		quad: false,
		mixed: false,
		labelC: '',
		ampsC: amps
	});
</script>

<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { AMPS, PROTECTIONS, PROTECTION_LABELS } from '$lib/constants';
	import { nextInColumn, slotText, tandemOk, tandemText } from '$lib/panel';

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
		panel: { slotCount: number; numbering: Numbering; tandemSlots: string | null; shortCode?: string | null };
		/** Why a 2-pole breaker can't go here, or null if it can. */
		no2Why: string | null;
		directoryHref: string;
		oncancel: () => void;
		onadd: (next: boolean) => void;
	} = $props();

	const noTandemWhy = $derived(tandemOk(slot, panel) ? null : `Slot ${slot} isn’t rated for tandems (${tandemText(panel)}).`);
	const below = $derived(nextInColumn(slot, panel));
	// A quad needs this slot and the one below free, both rated for half-width breakers (§5.18).
	const noQuadWhy = $derived(
		no2Why ? null : tandemOk(slot, panel) && tandemOk(below, panel) ? null : `Slots ${slot}–${below} aren’t rated for quads (${tandemText(panel)}).`
	);
	const quad = $derived(form.quad && !no2Why && !noQuadWhy);
	const tandem = $derived(form.tandem && !noTandemWhy && !quad);
	const poles = $derived(no2Why || tandem ? 1 : quad ? 2 : form.poles);
	const size = (poles: 1 | 2, tandem: boolean, quad = false) => {
		form.poles = poles;
		form.tandem = tandem;
		form.quad = quad;
	};
	const pre = $derived(panel.shortCode ?? '');
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
		<span class="mono over">New breaker · {slotText({ slot, poles }, panel)}{quad ? ' · Quad' : ''}</span>
		<button type="button" class="ibtn" aria-label="Cancel new breaker" onclick={oncancel}><Icon name="close" size={16} /></button>
	</div>
	{#if !tandem && !quad}
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
		{#if !tandem && !quad}
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
			<button
				type="button"
				class="sb"
				class:is-on={poles === 1 && !tandem}
				aria-pressed={poles === 1 && !tandem}
				onclick={() => size(1, false)}
			>
				1-pole
			</button>
			<button
				type="button"
				class="sb"
				class:is-on={poles === 2 && !quad}
				aria-pressed={poles === 2 && !quad}
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
				Tandem
			</button>
			{#if !no2Why}
				<button
					type="button"
					class="sb"
					class:is-on={quad}
					aria-pressed={quad}
					disabled={!!noQuadWhy}
					aria-describedby={noQuadWhy ? 'n-noq' : undefined}
					onclick={() => size(2, false, true)}
				>
					Quad (2 × 2-pole)
				</button>
			{/if}
		</div>
	</div>
	{#if quad}
		<div class="seg qmode" role="group" aria-label="Quad layout">
			<button type="button" class="sb" class:is-on={!form.mixed} aria-pressed={!form.mixed} onclick={() => (form.mixed = false)}>Two 2-pole</button>
			<button type="button" class="sb" class:is-on={form.mixed} aria-pressed={form.mixed} onclick={() => (form.mixed = true)}
				>One 2-pole + two 1-poles</button
			>
		</div>
		<div class="halves">
			<div class="half">
				<span class="mono hn">{pre}{slot}A/{below}B</span>
				<label for="n-qo" class="sr">Label for the outer pair</label>
				<input bind:this={labelInput} id="n-qo" class="inp" type="text" bind:value={form.label} placeholder="Outer pair" autocomplete="off" />
				<label for="n-qoa" class="sr">Amperage for the outer pair</label>
				<select id="n-qoa" class="inp amp" bind:value={form.amps}>
					{#each AMPS as a (a)}<option value={a}>{a} A</option>{/each}
				</select>
			</div>
			<div class="half">
				<span class="mono hn">{pre}{slot}B{form.mixed ? '' : `/${below}A`}</span>
				<label for="n-qi" class="sr">Label for {form.mixed ? `${slot}B` : 'the inner pair'}</label>
				<input id="n-qi" class="inp" type="text" bind:value={form.labelB} placeholder={form.mixed ? 'What does it power?' : 'Inner pair'} autocomplete="off" />
				<label for="n-qia" class="sr">Amperage for {form.mixed ? `${slot}B` : 'the inner pair'}</label>
				<select id="n-qia" class="inp amp" bind:value={form.ampsB}>
					{#each AMPS as a (a)}<option value={a}>{a} A</option>{/each}
				</select>
			</div>
			{#if form.mixed}
				<div class="half">
					<span class="mono hn">{pre}{below}A</span>
					<label for="n-qc" class="sr">Label for {below}A</label>
					<input id="n-qc" class="inp" type="text" bind:value={form.labelC} placeholder="What does it power?" autocomplete="off" />
					<label for="n-qca" class="sr">Amperage for {below}A</label>
					<select id="n-qca" class="inp amp" bind:value={form.ampsC}>
						{#each AMPS as a (a)}<option value={a}>{a} A</option>{/each}
					</select>
				</div>
			{/if}
		</div>
	{/if}
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
	{#if noQuadWhy && !noTandemWhy}<span class="why" id="n-noq">{noQuadWhy}</span>{/if}
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
	.qmode .sb {
		flex: 1 1 0;
		justify-content: center;
	}
	.halves {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.half {
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr) 110px;
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
