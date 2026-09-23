<script lang="ts">
	import { DEVICE_KINDS, DEVICE_KIND_INFO, type DeviceKind } from '$lib/constants';

	let { data } = $props();

	let query = $state('');
	let kind = $state<DeviceKind | ''>('');

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.devices.filter(
			(d) =>
				(!kind || d.kind === kind) &&
				(!q ||
					[d.name, d.room, d.breakerLabel, d.panel, d.notes].some((v) => v?.toLowerCase().includes(q)))
		);
	});
</script>

<svelte:head><title>Devices · Breaker Box</title></svelte:head>

<h1>Devices</h1>
<p class="muted">Everything mapped to a circuit. Add items from a breaker on the panel view.</p>

<div class="row filters">
	<label>Search <input type="search" bind:value={query} placeholder="Name, room, circuit…" /></label>
	<label>
		Type
		<select bind:value={kind}>
			<option value="">All types</option>
			{#each DEVICE_KINDS as k (k)}
				<option value={k}>{DEVICE_KIND_INFO[k].label}</option>
			{/each}
		</select>
	</label>
</div>

<div class="card table-wrap">
	<table>
		<thead>
			<tr><th>Item</th><th>Room</th><th>Circuit</th></tr>
		</thead>
		<tbody>
			{#each shown as d (d.id)}
				<tr>
					<td>
						<span aria-hidden="true">{DEVICE_KIND_INFO[d.kind].icon}</span>
						{d.name}
						<span class="muted small">{DEVICE_KIND_INFO[d.kind].label}</span>
					</td>
					<td>
						{d.room ?? '—'}{#if d.floor}<span class="muted small"> {d.floor}</span>{/if}
						{#if d.placed}<a class="small" href="/map?d={d.id}">Map</a>{/if}
					</td>
					<td>
						{#if d.breakerId}
							<a href="/panels/{d.panelId}?b={d.breakerId}">
								#{d.breakerSlot} {d.breakerLabel || 'Unlabeled'}
							</a>
							<span class="muted small">{d.amps}A · {d.panel}</span>
						{:else}
							<span class="muted">Unassigned</span>
						{/if}
					</td>
				</tr>
			{:else}
				<tr><td colspan="3" class="muted">No matching items.</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.filters {
		margin: 1rem 0;
	}
	.filters label {
		width: 14rem;
	}
	.table-wrap {
		padding: 0;
		overflow-x: auto;
	}
	.small {
		font-size: 0.8rem;
		margin-left: 0.25rem;
	}
</style>
