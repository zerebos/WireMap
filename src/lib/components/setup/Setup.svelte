<script lang="ts">
	// First-run setup (docs/design/DESIGN.md §5.7): a step rail, one step at a time, and a footer.
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { importDatabase } from '$lib/db';
	import Icon from '$lib/components/Icon.svelte';
	import { mutate, type House } from '$lib/house';
	import { createFloor, createPanel, deleteFloor, setFloorPlan, updateFloor, updatePanel, updateSettings } from '$lib/db/ops';
	import { STEPS, floorDraft, type SetupDraft, type StepKey } from './draft';
	import StepHome from './StepHome.svelte';
	import StepPanel from './StepPanel.svelte';
	import StepFloors from './StepFloors.svelte';
	import StepStart from './StepStart.svelte';

	let { house }: { house: House } = $props();

	// Start from what's there. Normally nothing; if a panel already exists (setup was left and
	// reopened), its values fill the steps and saving updates it.
	const start = untrack(() => house);
	let panelId = $state<number | null>(start.panel?.id ?? null);
	let draft = $state<SetupDraft>({
		home: start.panel ? start.settings.homeName : '',
		panelName: start.panel?.name ?? 'Main panel',
		amps: start.panel?.mainAmps ?? 200,
		spaces: start.panel?.slotCount ?? 40,
		numbering: start.panel?.numbering ?? 'odd_left_even_right',
		floors: start.floors.length
			? [...start.floors].reverse().map((f) => floorDraft(f.name, f.id, f.planImage !== null))
			: [floorDraft('Main floor')]
	});
	/** Saved floors the user removed; deleted on the next save. */
	let removed = $state<number[]>([]);
	let step = $state<StepKey>(start.panel ? 'start' : 'home');
	let busy = $state(false);
	let error = $state('');

	// Step 4: how to fill it in.
	type Choice = 'dir' | 'trace' | 'imp';
	let choice = $state<Choice>('dir');
	let restoreInput = $state<HTMLInputElement>();

	async function restore(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		if (!file) return;
		if (!confirm(`Restore “${file.name}”? It replaces the panel and floors you just set up.`)) return;
		busy = true;
		error = '';
		try {
			await importDatabase(new Uint8Array(await file.arrayBuffer()));
			location.assign(resolve('/'));
		} catch (err) {
			error = err instanceof Error ? err.message : "Couldn't restore that file.";
			busy = false;
		}
	}

	const idx = $derived(STEPS.findIndex((s) => s.key === step));

	let content = $state<HTMLElement>();
	function go(k: StepKey) {
		step = k;
		error = '';
		content?.scrollTo(0, 0);
		// Put focus on the new step's heading for screen readers and keyboards.
		queueMicrotask(() => content?.querySelector('h1')?.focus());
	}

	const imageSize = async (file: File) => {
		const url = URL.createObjectURL(file);
		try {
			const img = new Image();
			img.src = url;
			await img.decode();
			return { width: img.naturalWidth, height: img.naturalHeight };
		} finally {
			URL.revokeObjectURL(url);
		}
	};

	/** Writes the panel, settings and floors in one go, creating or updating. */
	async function save() {
		const panel = {
			name: draft.panelName.trim() || 'Main panel',
			mainAmps: draft.amps,
			slotCount: draft.spaces,
			numbering: draft.numbering
		};
		await mutate(async () => {
			if (panelId === null) panelId = await createPanel(panel);
			else await updatePanel(panelId, panel);
			await updateSettings({ homeName: draft.home.trim() || 'Home' });
			for (const id of removed) await deleteFloor(id);
			removed = [];
			const n = draft.floors.length;
			for (const [i, f] of draft.floors.entries()) {
				const name = f.name.trim() || 'Floor';
				const level = n - 1 - i;
				if (f.id === null) f.id = await createFloor(name, { planWidth: 820, planHeight: 760 });
				await updateFloor(f.id, { name, level });
				if (f.plan) {
					await setFloorPlan(f.id, f.plan, await imageSize(f.plan));
					f.plan = null;
					f.hasPlan = true;
				}
			}
		});
	}

	async function next() {
		if (step === 'floors') {
			busy = true;
			error = '';
			try {
				await save();
			} catch (e) {
				console.error(e);
				error = "Couldn't save. Try again.";
				return;
			} finally {
				busy = false;
			}
		}
		go(STEPS[Math.min(STEPS.length - 1, idx + 1)].key);
	}
</script>

<main class="setup">
	<aside class="rail">
		<nav aria-label="Setup steps">
			{#each STEPS as s, i (s.key)}
				{#if i < idx}
					<button type="button" class="step is-done" onclick={() => go(s.key)}>
						<span class="sn"><Icon name="check" size={14} stroke={3} /></span>
						<span class="stx"><span class="st">{s.title}</span><span class="sd">{s.desc}</span></span>
					</button>
				{:else}
					<div class="step" class:is-cur={i === idx} aria-current={i === idx ? 'step' : undefined}>
						<span class="sn">{i + 1}</span>
						<span class="stx"><span class="st">{s.title}</span><span class="sd">{s.desc}</span></span>
					</div>
				{/if}
			{/each}
		</nav>
		<div class="grow"></div>
		<span class="hint foot">Everything is stored in this browser. Nothing is sent anywhere.</span>
	</aside>

	<section class="main">
		<div class="content" bind:this={content}>
			{#if step === 'home'}
				<StepHome bind:draft />
			{:else if step === 'panel'}
				<StepPanel bind:draft />
			{:else if step === 'floors'}
				<StepFloors bind:draft bind:removed />
			{:else}
				<StepStart spaces={draft.spaces} bind:choice />
			{/if}
		</div>

		<footer>
			{#if idx > 0}
				<button type="button" class="btn" onclick={() => go(STEPS[idx - 1].key)}>Back</button>
			{/if}
			<span class="mono stepn">Step {idx + 1} of {STEPS.length}</span>
			{#if error}<span class="err" role="alert">{error}</span>{/if}
			<div class="grow"></div>
			{#if step !== 'start'}
				<button type="button" class="btn btn-pri cont" onclick={next} disabled={busy}>Continue</button>
			{:else if choice === 'dir'}
				<a class="btn btn-pri start" href={resolve('/directory')}>Open the directory</a>
			{:else if choice === 'trace'}
				<a class="btn btn-pri start" href={resolve('/trace')}>Start tracing</a>
			{:else}
				<button type="button" class="btn btn-pri start" onclick={() => restoreInput?.click()} disabled={busy}>
					Choose backup file…
				</button>
				<input
					bind:this={restoreInput}
					class="sr"
					type="file"
					tabindex="-1"
					aria-hidden="true"
					accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3,application/x-sqlite3"
					onchange={restore}
				/>
			{/if}
		</footer>
	</section>
</main>

<style>
	.setup {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
	}
	.rail {
		width: 320px;
		flex-shrink: 0;
		padding: 32px 20px;
		border-right: 1px solid var(--line-2);
		background: var(--raised);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	nav {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.step {
		display: flex;
		gap: 14px;
		align-items: flex-start;
		width: 100%;
		padding: 12px;
		border: 0;
		border-radius: var(--r-xl);
		background: transparent;
		font: inherit;
		color: var(--muted);
		text-align: left;
	}
	button.step {
		cursor: pointer;
	}
	button.step:hover {
		background: var(--hover);
	}
	.sn {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		border: 1.5px solid var(--field);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 600;
		flex-shrink: 0;
	}
	.step.is-cur {
		background: var(--surface);
		color: var(--ink);
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.step.is-cur .sn {
		background: var(--amber);
		border-color: var(--amber);
		color: var(--on-amber);
	}
	.step.is-done {
		color: var(--ink);
	}
	.step.is-done .sn {
		background: var(--handle);
		border-color: var(--handle);
		color: var(--hdr-fg);
	}
	.stx {
		display: flex;
		flex-direction: column;
	}
	.st {
		font-size: 15px;
		font-weight: 700;
	}
	.sd {
		font-size: 13px;
		color: var(--muted);
		margin-top: 2px;
	}
	.grow {
		flex-grow: 1;
	}
	.foot {
		padding: 0 12px;
	}
	.main {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.content {
		flex-grow: 1;
		min-height: 0;
		overflow: auto;
		padding: 48px 64px;
	}
	footer {
		flex-shrink: 0;
		padding: 16px 64px;
		border-top: 1px solid var(--line);
		background: var(--raised);
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.stepn {
		font-size: 12px;
		color: var(--muted);
	}
	.err {
		font-size: 13px;
		color: var(--warn);
	}
	.cont {
		min-width: 160px;
	}
	.start {
		min-width: 200px;
	}

	/* Shared by the steps. */
	.setup :global(.hint) {
		font-size: 12px;
		color: var(--muted);
		line-height: 1.45;
	}
	.content :global(.intro) {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.content :global(h1) {
		font-size: 34px;
		font-weight: 800;
		font-stretch: 112%;
		letter-spacing: -0.02em;
	}
	.content :global(h1:focus) {
		outline: none;
	}
	.content :global(.lead) {
		font-size: 16px;
		line-height: 1.5;
		color: var(--soft);
	}
	.content :global(.rcard) {
		display: flex;
		gap: 14px;
		align-items: flex-start;
		width: 100%;
		padding: 16px;
		border: 1.5px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
		font: inherit;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.content :global(.rcard:hover) {
		border-color: var(--btn-bd-h);
	}
	.content :global(.rcard.is-on) {
		border-color: var(--amber);
		box-shadow: 0 0 0 2px var(--amber);
	}
	.content :global(.radio) {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 2px solid var(--field);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: 2px;
	}
	.content :global(.rcard.is-on .radio) {
		border-color: var(--amber);
	}
	.content :global(.rcard.is-on .radio::after) {
		content: '';
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--amber);
	}
</style>
