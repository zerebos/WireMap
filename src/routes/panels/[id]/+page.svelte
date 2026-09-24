<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import PanelView from '$lib/components/PanelView.svelte';
	import BreakerFields from '$lib/components/BreakerFields.svelte';
	import DeviceFields from '$lib/components/DeviceFields.svelte';
	import { keepValues } from '$lib/forms';
	import { BREAKER_KIND_LABELS, DEVICE_KIND_INFO } from '$lib/constants';

	let { data, form } = $props();

	const selectedId = $derived(Number(page.url.searchParams.get('b')) || null);
	const selectedSlot = $derived(Number(page.url.searchParams.get('slot')) || null);
	const selected = $derived(data.breakers.find((b) => b.id === selectedId) ?? null);

	const here = $derived(resolve('/panels/[id]', { id: String(data.panel.id) }));
	const deviceCount = $derived(data.breakers.reduce((n, b) => n + b.devices.length, 0));
	const usedSlots = $derived(data.breakers.reduce((n, b) => n + b.poles, 0));

	// On narrow screens the details sit below the panel, so bring them into view on select.
	let aside: HTMLElement | undefined = $state();
	$effect(() => {
		if ((selectedId || selectedSlot) && matchMedia('(max-width: 860px)').matches) {
			aside?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	});

	const confirmSubmit =
		(message: string) =>
		({ cancel }: { cancel: () => void }) => {
			if (!confirm(message)) cancel();
		};
</script>

<svelte:head><title>{data.panel.name} · Breaker Box</title></svelte:head>

<div class="top">
	<div>
		<h1>{data.panel.name}</h1>
		<p class="muted">
			{[data.panel.location, data.panel.mainAmps ? `${data.panel.mainAmps}A main` : null]
				.filter(Boolean)
				.join(' · ')}
			{data.panel.location || data.panel.mainAmps ? '·' : ''}
			{usedSlots}/{data.panel.slotCount} slots used · {deviceCount} items mapped
		</p>
	</div>
	<div class="row">
		{#if data.panels.length > 1}
			<select
				aria-label="Switch panel"
				value={data.panel.id}
				onchange={(e) => goto(resolve('/panels/[id]', { id: e.currentTarget.value }))}
			>
				{#each data.panels as p (p.id)}
					<option value={p.id}>{p.name}</option>
				{/each}
			</select>
		{/if}
		<a class="button" href={resolve('/panels/new')}>New panel</a>
	</div>
</div>

<div class="layout">
	<PanelView
		slotCount={data.panel.slotCount}
		mainAmps={data.panel.mainAmps}
		breakers={data.breakers}
		{selectedId}
		{selectedSlot}
		hrefFor={(b) => (b.id === selectedId ? here : `${here}?b=${b.id}`)}
		hrefForSlot={(slot) => (slot === selectedSlot ? here : `${here}?slot=${slot}`)}
	/>

	<aside class="card" bind:this={aside}>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

		{#if selected}
			{#key selected.id}
				<header class="detail-head">
					<div>
						<h2>{selected.label || 'Unlabeled breaker'}</h2>
						<p class="muted">
							Slot {selected.poles === 2 ? `${selected.slot} + ${selected.slot + 2}` : selected.slot}
							· {selected.amps}A {selected.poles === 2 ? '240V' : '120V'}
							· {BREAKER_KIND_LABELS[selected.kind]}
						</p>
					</div>
					<a class="button" href={here} data-sveltekit-noscroll aria-label="Close">✕</a>
				</header>

				<section>
					<div class="section-head">
						<h3>On this circuit</h3>
						{#if selected.devices.some((d) => d.posX !== null)}
							<a href="{resolve('/map')}?b={selected.id}">Show on map</a>
						{/if}
					</div>
					{#if selected.devices.length === 0}
						<p class="muted">Nothing mapped yet. Add the outlets, switches and appliances this breaker feeds.</p>
					{:else}
						<ul class="devices">
							{#each selected.devices as d (d.id)}
								{@const room = data.rooms.find((r) => r.id === d.roomId)}
								<li>
									<details>
										<summary>
											<span class="icon" aria-hidden="true">{DEVICE_KIND_INFO[d.kind].icon}</span>
											<span class="name">{d.name}</span>
											<span class="muted">{room?.name ?? ''}</span>
										</summary>
										<form method="POST" action="?b={selected.id}&/updateDevice" use:enhance={keepValues} class="stack">
											<input type="hidden" name="id" value={d.id} />
											<DeviceFields device={d} rooms={data.rooms} />
											<label>
												Breaker
												<select name="breakerId" value={d.breakerId}>
													{#each data.breakers as b (b.id)}
														<option value={b.id}>#{b.slot} {b.label || 'Unlabeled'}</option>
													{/each}
												</select>
											</label>
											<div class="row">
												<button class="primary">Save</button>
												<button
													class="danger"
													formaction="?b={selected.id}&/deleteDevice"
													formnovalidate
												>
													Delete
												</button>
											</div>
										</form>
									</details>
								</li>
							{/each}
						</ul>
					{/if}

					<form method="POST" action="?b={selected.id}&/addDevice" use:enhance class="stack add-device">
						<input type="hidden" name="breakerId" value={selected.id} />
						<DeviceFields rooms={data.rooms} compact />
						<div><button class="primary">Add item</button></div>
					</form>
				</section>

				<details class="section">
					<summary><h3>Breaker details</h3></summary>
					<form method="POST" action="?b={selected.id}&/updateBreaker" use:enhance={keepValues} class="stack">
						<input type="hidden" name="id" value={selected.id} />
						<BreakerFields breaker={selected} slotCount={data.panel.slotCount} />
						<div class="row">
							<button class="primary">Save breaker</button>
						</div>
					</form>
					<form
						method="POST"
						action="?/deleteBreaker"
						use:enhance={confirmSubmit(
							'Remove this breaker? Its items stay in the device list, unassigned.'
						)}
					>
						<input type="hidden" name="id" value={selected.id} />
						<button class="danger">Remove breaker</button>
					</form>
				</details>
			{/key}
		{:else if selectedSlot}
			{#key selectedSlot}
				<header class="detail-head">
					<h2>New breaker in slot {selectedSlot}</h2>
					<a class="button" href={here} data-sveltekit-noscroll aria-label="Close">✕</a>
				</header>
				<form method="POST" action="?slot={selectedSlot}&/createBreaker" use:enhance class="stack">
					<BreakerFields slot={selectedSlot} slotCount={data.panel.slotCount} />
					<div><button class="primary">Add breaker</button></div>
				</form>
			{/key}
		{:else}
			<h2>Click a breaker</h2>
			<p class="muted">
				Select a breaker to see and edit what it powers, or click an empty slot to add one.
			</p>

			<details class="section">
				<summary><h3>Panel settings</h3></summary>
				<form method="POST" action="?/updatePanel" use:enhance={keepValues} class="stack">
					<label>Name <input name="name" required value={data.panel.name} /></label>
					<label>Location <input name="location" value={data.panel.location ?? ''} /></label>
					<div class="grid-2">
						<label>
							Main breaker (A)
							<input name="mainAmps" type="number" min="0" value={data.panel.mainAmps ?? ''} />
						</label>
						<label>
							Slots
							<input name="slotCount" type="number" min="2" max="84" step="2" value={data.panel.slotCount} />
						</label>
					</div>
					<label>Notes <textarea name="notes">{data.panel.notes ?? ''}</textarea></label>
					<div><button class="primary">Save panel</button></div>
				</form>
				<form
					method="POST"
					action="?/deletePanel"
					use:enhance={confirmSubmit('Delete this panel and all of its breakers?')}
				>
					<button class="danger">Delete panel</button>
				</form>
			</details>
		{/if}
	</aside>
</div>

<style>
	.top {
		display: flex;
		justify-content: space-between;
		align-items: start;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.top p {
		margin: 0;
	}
	.top select {
		width: auto;
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1.25fr) minmax(18rem, 1fr);
		gap: 1.25rem;
		align-items: start;
	}
	@media (max-width: 860px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}

	aside {
		position: sticky;
		top: 1rem;
		display: grid;
		gap: 1rem;
	}
	.detail-head {
		display: flex;
		justify-content: space-between;
		align-items: start;
		gap: 0.5rem;
	}
	.detail-head p {
		margin: 0;
	}

	.devices {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.devices li + li {
		border-top: 1px solid var(--border);
	}
	.devices summary {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		padding: 0.5rem 0.6rem;
		cursor: pointer;
		list-style: none;
	}
	.devices summary::-webkit-details-marker {
		display: none;
	}
	.devices .name {
		flex: 1;
	}
	.devices form {
		padding: 0 0.6rem 0.7rem;
	}
	.icon {
		width: 1.4rem;
		text-align: center;
	}

	.section-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}

	.add-device {
		padding-top: 0.25rem;
	}

	.section summary {
		cursor: pointer;
	}
	.section summary h3 {
		display: inline;
	}
	.section form {
		margin-top: 0.75rem;
	}
</style>
