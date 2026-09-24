<script lang="ts">
	// Setup step 3: the floors, top to bottom, each with an optional plan image.
	import { tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { floorDraft, type SetupDraft } from './draft';

	let { draft = $bindable(), removed = $bindable() }: { draft: SetupDraft; removed: number[] } = $props();

	const QUICK = ['Basement', 'Upstairs', 'Attic', 'Detached garage'];
	const PLAN_OK = ['image/png', 'image/jpeg', 'image/webp'];
	const quick = $derived(QUICK.filter((q) => !draft.floors.some((f) => f.name.trim() === q)));
	let error = $state('');

	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= draft.floors.length) return;
		const f = draft.floors;
		[f[i], f[j]] = [f[j], f[i]];
	}

	function remove(i: number) {
		const [f] = draft.floors.splice(i, 1);
		if (f.id !== null) removed.push(f.id);
	}

	function add(name: string) {
		// Basement and a detached garage go at the bottom, Upstairs and Attic at the top.
		if (name === 'Upstairs' || name === 'Attic') draft.floors.unshift(floorDraft(name));
		else draft.floors.push(floorDraft(name));
	}

	async function addOther() {
		const f = floorDraft('New floor');
		draft.floors.push(f);
		await tick();
		const input = document.getElementById(`fl-${f.key}`) as HTMLInputElement | null;
		input?.focus();
		input?.select();
	}

	let planInput = $state<HTMLInputElement>();
	let planFor: number | null = null;
	function pickPlan(key: number) {
		planFor = key;
		error = '';
		planInput?.click();
	}
	function choosePlan(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		const f = draft.floors.find((x) => x.key === planFor);
		if (!file || !f) return;
		if (!PLAN_OK.includes(file.type)) return void (error = 'Floor plans can be PNG, JPG or WebP images.');
		f.plan = file;
	}
</script>

<div class="wrap">
	<div class="intro">
		<h1 tabindex="-1">Which floors does the house have?</h1>
		<p class="lead">Each floor gets its own map. List them top to bottom. Floor plan images are optional and can be added later.</p>
	</div>
	<ul class="list">
		{#each draft.floors as f, i (f.key)}
			{@const label = f.name.trim() || 'this floor'}
			<li class="frow">
				<div class="updown">
					<button type="button" class="ibtn sm" aria-label="Move {label} up" onclick={() => move(i, -1)} disabled={i === 0}>
						<Icon name="up" size={14} stroke={2.2} />
					</button>
					<button
						type="button"
						class="ibtn sm"
						aria-label="Move {label} down"
						onclick={() => move(i, 1)}
						disabled={i === draft.floors.length - 1}
					>
						<Icon name="down" size={14} stroke={2.2} />
					</button>
				</div>
				<label class="sr" for="fl-{f.key}">Floor name</label>
				<input id="fl-{f.key}" class="inp name" type="text" bind:value={f.name} />
				<button
					type="button"
					class="btn plan"
					onclick={() => pickPlan(f.key)}
					title={f.plan ? f.plan.name : undefined}
					aria-label={f.plan || f.hasPlan ? `Plan image for ${label}: added. Replace` : undefined}
				>
					<Icon name={f.plan || f.hasPlan ? 'check' : 'image'} size={16} />{f.plan || f.hasPlan ? 'Plan added' : 'Plan image'}
				</button>
				<button type="button" class="ibtn" aria-label="Remove {label}" onclick={() => remove(i)} disabled={draft.floors.length === 1}>
					<Icon name="trash" size={16} />
				</button>
			</li>
		{/each}
	</ul>
	{#if error}<p class="err" role="alert">{error}</p>{/if}
	<input
		bind:this={planInput}
		class="sr"
		type="file"
		tabindex="-1"
		aria-hidden="true"
		accept="image/png,image/jpeg,image/webp"
		onchange={choosePlan}
	/>
	<div class="add">
		<span class="k">Add a floor</span>
		<div class="chips">
			{#each quick as q (q)}
				<button type="button" class="chip" onclick={() => add(q)}><Icon name="plus" size={14} stroke={2.4} />{q}</button>
			{/each}
			<button type="button" class="chip" onclick={addOther}><Icon name="plus" size={14} stroke={2.4} />Other…</button>
		</div>
		<span class="hint">A detached garage or shed can be its own “floor”.</span>
	</div>
</div>

<style>
	.wrap {
		max-width: 640px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.frow {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
	}
	.updown {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.name {
		flex-grow: 1;
		font-size: 15px;
		font-weight: 600;
	}
	.plan {
		padding: 0 12px;
	}
	.err {
		font-size: 13px;
		color: var(--warn);
	}
	.add {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.k {
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
	}
	.chips {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
</style>
