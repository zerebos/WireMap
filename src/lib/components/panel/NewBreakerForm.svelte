<script lang="ts" module>
	import type { Numbering, Protection } from '$lib/constants';

	export type NewBreaker = { label: string; amps: number; kind: Protection; poles: 1 | 2 };
	export const blankBreaker = (amps = 20): NewBreaker => ({ label: '', amps, kind: 'standard', poles: 1 });
</script>

<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { AMPS, PROTECTIONS, PROTECTION_LABELS } from '$lib/constants';
	import { slotText } from '$lib/panel';

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
		panel: { slotCount: number; numbering: Numbering };
		/** Why a 2-pole breaker can't go here, or null if it can. */
		no2Why: string | null;
		directoryHref: string;
		oncancel: () => void;
		onadd: (next: boolean) => void;
	} = $props();

	const poles = $derived(no2Why ? 1 : form.poles);
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
	<div class="grid3">
		<div class="fld">
			<label for="n-amp">Amperage</label>
			<select id="n-amp" class="inp" bind:value={form.amps}>
				{#each AMPS as a (a)}
					<option value={a}>{a} A</option>
				{/each}
			</select>
		</div>
		<div class="fld">
			<label for="n-type">Protection</label>
			<select id="n-type" class="inp" bind:value={form.kind}>
				{#each PROTECTIONS as p (p)}
					<option value={p}>{PROTECTION_LABELS[p]}</option>
				{/each}
			</select>
		</div>
		<div class="fld">
			<span class="k" id="n-pl">Poles</span>
			<div class="seg" role="group" aria-labelledby="n-pl">
				<button type="button" class="sb" class:is-on={poles === 1} aria-pressed={poles === 1} onclick={() => (form.poles = 1)}>
					1-pole
				</button>
				<button
					type="button"
					class="sb"
					class:is-on={poles === 2}
					aria-pressed={poles === 2}
					disabled={!!no2Why}
					aria-describedby={no2Why ? 'n-no2' : undefined}
					onclick={() => (form.poles = 2)}
				>
					2-pole
				</button>
			</div>
		</div>
	</div>
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
	.grid3 {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
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
