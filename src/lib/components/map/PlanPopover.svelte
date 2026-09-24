<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { mutate } from '$lib/house';
	import { removeFloorPlan, updateFloor } from '$lib/db/ops';
	import type { Floor } from '$lib/db/schema';
	import { PLAN_ACCEPT, uploadPlan } from './model';

	let {
		floor,
		src,
		traced,
		opacity = $bindable(),
		onclose
	}: {
		floor: Floor;
		/** Object URL of the plan image, once loaded. */
		src: string | null;
		/** Rooms on this floor that have a shape. */
		traced: number;
		/** Live opacity 0–1 while the slider moves. */
		opacity: number;
		onclose: () => void;
	} = $props();

	let input: HTMLInputElement | undefined = $state();
	let error = $state('');
	let busy = $state(false);
	let over = $state(false);

	const pct = $derived(Math.round(opacity * 100));

	let timer: ReturnType<typeof setTimeout> | undefined;
	function onOpacity(e: Event) {
		opacity = Number((e.currentTarget as HTMLInputElement).value) / 100;
		clearTimeout(timer);
		const id = floor.id;
		const v = opacity;
		timer = setTimeout(() => mutate(() => updateFloor(id, { planOpacity: v })), 300);
	}

	async function useFile(file: File | undefined) {
		if (!file) return;
		busy = true;
		error = await uploadPlan(floor.id, file);
		busy = false;
		if (input) input.value = '';
	}

	async function remove() {
		if (!confirm(`Remove the ${floor.name} plan image? Rooms and items stay where they are.`)) return;
		const id = floor.id;
		await mutate(() => removeFloorPlan(id));
	}

	function ondrop(e: DragEvent) {
		e.preventDefault();
		over = false;
		useFile(e.dataTransfer?.files[0]);
	}
</script>

<div class="pop" role="dialog" aria-label="Floor plan · {floor.name}">
	<div class="ph">
		<span class="pt">Floor plan · {floor.name}</span>
		<button type="button" class="ibtn sm" aria-label="Close floor plan settings" onclick={onclose}><Icon name="close" size={16} /></button>
	</div>
	<input bind:this={input} class="sr" type="file" accept={PLAN_ACCEPT.join(',')} tabindex="-1" aria-hidden="true" onchange={(e) => useFile(e.currentTarget.files?.[0])} />
	{#if floor.planImage}
		<div class="col">
			<div class="file">
				<div class="thumb">
					{#if src}<img {src} alt="" />{/if}
				</div>
				<div class="fn">
					<span class="mono name">{floor.planImage}</span>
					<span class="sub">Rooms traced over it: {traced}</span>
				</div>
			</div>
			<div class="op">
				<div class="opl"><label for="plan-op">Image opacity</label><span class="mono">{pct}%</span></div>
				<input id="plan-op" type="range" min="0" max="100" step="5" value={pct} oninput={onOpacity} />
			</div>
			<div class="acts">
				<button type="button" class="btn" disabled={busy} onclick={() => input?.click()}>Replace image</button>
				<button type="button" class="btn" disabled={busy} onclick={remove}>Remove</button>
			</div>
		</div>
	{:else}
		<div
			class="drop"
			class:over
			role="group"
			aria-label="Drop a plan image"
			ondragover={(e) => {
				e.preventDefault();
				over = true;
			}}
			ondragleave={() => (over = false)}
			{ondrop}
		>
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
				><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg
			>
			<span>Drop a PNG or JPG of the {floor.name} plan to trace rooms over it.</span>
			<button type="button" class="btn" disabled={busy} onclick={() => input?.click()}>Choose file</button>
		</div>
	{/if}
	{#if error}<span class="err" role="alert">{error}</span>{/if}
</div>

<style>
	.pop {
		background: var(--surface);
		border: 1px solid var(--ink);
		border-radius: var(--r-xl);
		padding: 14px 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
	}
	.ph {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.pt {
		font-size: 15px;
		font-weight: 700;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.file {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.thumb {
		width: 56px;
		height: 44px;
		flex-shrink: 0;
		border-radius: var(--r-sm);
		background: var(--bg);
		border: 1px solid var(--line-2);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}
	.thumb img {
		max-width: 48px;
		max-height: 38px;
	}
	.fn {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.name {
		font-size: 13px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		font-size: 12px;
		color: var(--muted);
	}
	.op {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.opl {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
	}
	.opl label {
		font-weight: 600;
		color: var(--muted);
	}
	input[type='range'] {
		width: 100%;
		accent-color: var(--ink);
	}
	.acts {
		display: flex;
		gap: 8px;
	}
	.acts .btn {
		flex-grow: 1;
	}
	.drop {
		border: 1.5px dashed var(--enclosure-bd);
		border-radius: var(--r-lg);
		padding: 18px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		text-align: center;
		background: var(--raised);
		font-size: 14px;
		line-height: 1.4;
	}
	.drop svg {
		color: var(--soft);
	}
	.drop.over {
		border-color: var(--ink);
	}
	.err {
		font-size: 13px;
		color: var(--warn);
	}
</style>
