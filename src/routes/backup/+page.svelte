<script lang="ts">
	import { resolve } from '$app/paths';
	import { exportDatabase, importDatabase, resetDatabase } from '$lib/db';

	let { data } = $props();

	let message = $state<{ text: string; error?: boolean } | null>(null);
	let busy = $state(false);

	const size = (bytes: number) =>
		bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

	// ---- Browser storage status

	let persisted = $state<boolean | null>(null);
	let usage = $state<number | null>(null);
	const canPersist = typeof navigator !== 'undefined' && !!navigator.storage?.persist;

	async function refreshStorage() {
		persisted = (await navigator.storage?.persisted?.()) ?? null;
		usage = (await navigator.storage?.estimate?.())?.usage ?? null;
	}
	$effect(() => {
		refreshStorage();
	});

	async function keepPermanently() {
		const granted = await navigator.storage.persist();
		await refreshStorage();
		message = granted
			? { text: "Done. The browser won't clear this data to free up space." }
			: {
					text: "The browser said no. Installing the app (Add to Home Screen) or using it more often usually changes that. Keep backups either way.",
					error: true
				};
	}

	// ---- Backup and restore

	async function download() {
		busy = true;
		try {
			const bytes = await exportDatabase();
			const a = document.createElement('a');
			a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.sqlite3' }));
			a.download = `breaker-box-${new Date().toISOString().slice(0, 10)}.sqlite`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
			message = { text: 'Backup downloaded.' };
		} catch (e) {
			message = { text: e instanceof Error ? e.message : "Couldn't make a backup.", error: true };
		} finally {
			busy = false;
		}
	}

	let restoreFile = $state<File | null>(null);

	async function restore(e: SubmitEvent) {
		e.preventDefault();
		if (!restoreFile) return;
		if (!confirm('Replace everything in this browser with this backup?')) return;
		busy = true;
		try {
			await importDatabase(new Uint8Array(await restoreFile.arrayBuffer()));
			// Start over from the restored data.
			location.assign(resolve('/'));
		} catch (err) {
			message = { text: err instanceof Error ? err.message : "Couldn't restore that file.", error: true };
			busy = false;
		}
	}

	async function reset(example: boolean) {
		const question = example
			? 'Delete everything and load the example house?'
			: 'Delete everything and start with an empty house?';
		if (!confirm(`${question} Download a backup first if you might want it back.`)) return;
		busy = true;
		await resetDatabase({ example });
		location.assign(resolve('/'));
	}
</script>

<svelte:head><title>Backup · Breaker Box</title></svelte:head>

<h1>Backup</h1>
<p class="muted">
	Everything is saved in this browser, on this device. Nothing is sent anywhere. A backup is a single
	file with your panels, items, rooms and floor plans, and it's also how you move to another device.
</p>

{#if message}
	<p class={message.error ? 'error' : 'note'} role="status">{message.text}</p>
{/if}

<div class="cols">
	<section class="card stack">
		<h2>Download a backup</h2>
		<p class="muted">
			{data.counts.panels} panel{data.counts.panels === 1 ? '' : 's'}, {data.counts.breakers} breakers,
			{data.counts.items} items, {data.counts.rooms} rooms on {data.counts.floors} floor{data.counts.floors === 1
				? ''
				: 's'}{#if data.counts.plans}, {data.counts.plans} floor plan{data.counts.plans === 1 ? '' : 's'} ({size(
					data.counts.planBytes
				)}){/if}.
		</p>
		<div><button class="primary" onclick={download} disabled={busy}>Download backup</button></div>
	</section>

	<form class="card stack" onsubmit={restore}>
		<h2>Restore a backup</h2>
		<p class="muted">Replaces everything in this browser with the backup's contents.</p>
		<input
			type="file"
			accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3,application/x-sqlite3"
			aria-label="Backup file"
			onchange={(e) => (restoreFile = e.currentTarget.files?.[0] ?? null)}
		/>
		<div><button disabled={busy || !restoreFile}>Restore</button></div>
	</form>

	<section class="card stack">
		<h2>Storage</h2>
		<p class="muted">
			{#if persisted}
				This browser keeps the data until you delete it.
			{:else}
				The browser may clear this data if the device runs low on space, and Safari clears it after a
				week without a visit unless the app is on your home screen.
			{/if}
			{#if usage !== null}Using {size(usage)}.{/if}
		</p>
		{#if canPersist && persisted === false}
			<div><button onclick={keepPermanently}>Keep data permanently</button></div>
		{/if}
	</section>

	<section class="card stack">
		<h2>Start over</h2>
		<div class="row">
			<button class="danger" onclick={() => reset(false)} disabled={busy}>Start empty</button>
			<button onclick={() => reset(true)} disabled={busy}>Load the example house</button>
		</div>
	</section>
</div>

<style>
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
		gap: 1rem;
		align-items: start;
	}
	h2 {
		margin: 0;
	}
	p {
		margin: 0;
	}
	.note {
		padding: 0.6rem 0.8rem;
		border-radius: var(--radius);
		background: var(--surface-2);
	}
</style>
