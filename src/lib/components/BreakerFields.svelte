<script lang="ts">
	import { untrack } from 'svelte';
	import { BREAKER_KINDS, BREAKER_KIND_LABELS, COMMON_AMPS, type BreakerKind } from '$lib/constants';

	let {
		breaker,
		slot,
		slotCount
	}: {
		breaker?: {
			slot: number;
			poles: number;
			amps: number;
			kind: BreakerKind;
			label: string;
			color: string | null;
			notes: string | null;
		};
		slot?: number;
		slotCount: number;
	} = $props();

	// The parent re-mounts this per breaker, so the initial value is all we need.
	let hasColor = $state(untrack(() => !!breaker?.color));
</script>

<label>Label <input name="label" value={breaker?.label ?? ''} placeholder="Kitchen counter" /></label>
<div class="grid-2">
	<label>
		Slot
		<input name="slot" type="number" min="1" max={slotCount} required value={breaker?.slot ?? slot} />
	</label>
	<label>
		Poles
		<select name="poles" value={breaker?.poles ?? 1}>
			<option value={1}>1-pole (120V)</option>
			<option value={2}>2-pole (240V)</option>
		</select>
	</label>
	<label>
		Amps
		<input name="amps" type="number" min="1" list="common-amps" required value={breaker?.amps ?? 15} />
		<datalist id="common-amps">
			{#each COMMON_AMPS as a (a)}<option value={a}></option>{/each}
		</datalist>
	</label>
	<label>
		Type
		<select name="kind" value={breaker?.kind ?? 'standard'}>
			{#each BREAKER_KINDS as k (k)}
				<option value={k}>{BREAKER_KIND_LABELS[k]}</option>
			{/each}
		</select>
	</label>
</div>
<div class="color">
	<label class="check"><input type="checkbox" bind:checked={hasColor} /> Color tag</label>
	{#if hasColor}
		<input name="color" type="color" value={breaker?.color ?? '#e8a33d'} aria-label="Tag color" />
	{/if}
</div>
<label>Notes <textarea name="notes">{breaker?.notes ?? ''}</textarea></label>

<style>
	.color {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.check input {
		width: auto;
	}
	input[type='color'] {
		width: 3rem;
		height: 2rem;
		padding: 0.1rem;
	}
</style>
