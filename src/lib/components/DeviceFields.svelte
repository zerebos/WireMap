<script lang="ts">
	import { DEVICE_KINDS, DEVICE_KIND_INFO, type DeviceKind } from '$lib/constants';

	let {
		device,
		rooms,
		compact = false
	}: {
		device?: { name: string; kind: DeviceKind; roomId: number | null; notes: string | null };
		rooms: { id: number; name: string; floor: string | null }[];
		compact?: boolean;
	} = $props();
</script>

<div class="grid-2">
	<label>
		Type
		<select name="kind" value={device?.kind ?? 'outlet'}>
			{#each DEVICE_KINDS as k (k)}
				<option value={k}>{DEVICE_KIND_INFO[k].icon} {DEVICE_KIND_INFO[k].label}</option>
			{/each}
		</select>
	</label>
	<label>
		Room
		<select name="roomId" value={device?.roomId ?? ''}>
			<option value="">No room</option>
			{#each rooms as r (r.id)}
				<option value={r.id}>{r.name}{r.floor ? ` (${r.floor})` : ''}</option>
			{/each}
		</select>
	</label>
</div>
<label>
	Name
	<input name="name" required value={device?.name ?? ''} placeholder="Outlet left of sink" />
</label>
{#if !compact}
	<label>Notes <textarea name="notes">{device?.notes ?? ''}</textarea></label>
{/if}
