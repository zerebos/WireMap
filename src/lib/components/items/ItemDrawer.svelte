<script lang="ts">
	// Item editor drawer (DESIGN.md §5.3). Edits are a local draft and apply on Save.
	// Mount it inside {#key item.id} so the draft starts fresh for each item.
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/Icon.svelte';
	import { access } from '$lib/access.svelte';
	import { ITEM_TYPES, ITEM_TYPE_LABELS, type ItemType } from '$lib/constants';
	import { mutate, type HouseIndex, type HouseItem } from '$lib/house';
	import { deleteItems, swapItemBreaker, updateItem } from '$lib/db/ops';

	let {
		item,
		ix,
		breakerOptions,
		onclose
	}: {
		item: HouseItem;
		ix: HouseIndex;
		breakerOptions: { value: number; label: string }[];
		onclose: () => void;
	} = $props();

	const init = untrack(() => item);
	const initBreakers = untrack(() => ix.breakersOf(init));
	// The breaker the select edits. Any others the item is on are kept.
	const firstBreaker = initBreakers[0]?.id ?? null;
	const otherBreakers = initBreakers.slice(1);

	let name = $state(init.name);
	let type = $state<ItemType>(init.type);
	let floorId = $state<number | null>(init.floorId);
	let roomId = $state<number | null>(init.roomId);
	let breakerId = $state<number | null>(firstBreaker);
	let notes = $state(init.notes ?? '');
	let critical = $state(init.critical);
	let criticalNote = $state(init.criticalNote ?? '');
	let saving = $state(false);

	const floors = $derived(ix.house.floors);
	const rooms = $derived(ix.house.rooms.filter((r) => r.floorId === floorId));
	// Changing floor takes the item off the map.
	const placed = $derived(floorId === item.floorId && item.x !== null && item.y !== null);
	const floorLabel = $derived(ix.floorName(floorId));
	const heading = $derived([ITEM_TYPE_LABELS[type].one, floorLabel].filter(Boolean).join(' · '));
	const mapHref = $derived(resolve('/map') + '?item=' + item.id);

	function changeFloor(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value;
		floorId = v === '' ? null : Number(v);
		roomId = null;
	}

	let nameInput: HTMLInputElement | undefined = $state();
	$effect(() => {
		// A new blank item: start typing its name.
		if (untrack(() => init.name === '')) nameInput?.focus();
	});

	async function save() {
		saving = true;
		try {
			const floorChanged = floorId !== item.floorId;
			await mutate(async () => {
				await updateItem(item.id, {
					name: name.trim(),
					type,
					floorId,
					roomId,
					notes: notes.trim() || null,
					critical,
					criticalNote: criticalNote.trim() || null,
					...(floorChanged ? { x: null, y: null } : {})
				});
				if (breakerId !== firstBreaker) await swapItemBreaker(item.id, firstBreaker, breakerId);
			});
			onclose();
		} finally {
			saving = false;
		}
	}

	async function remove() {
		if (!confirm(`Delete “${item.name || 'Untitled item'}”? This can’t be undone.`)) return;
		await mutate(() => deleteItems([item.id]));
		onclose();
	}
</script>

<aside class="drawer" aria-label="Item details">
	<div class="dhead">
		<div class="dtitle">
			<span class="ov">{heading}</span>
			<h2>{name.trim() || 'Untitled item'}</h2>
		</div>
		<button type="button" class="ibtn" aria-label="Close item details" onclick={onclose}>
			<Icon name="close" size={16} />
		</button>
	</div>

	{#if access.guest}
		<!-- Read-only guest view (DESIGN.md §5.13): the same facts, no edit controls. -->
		<div class="dbody">
			<dl class="ro">
				<div class="fld"><dt class="k">Room</dt><dd class="v">{ix.roomName(item.roomId)}</dd></div>
				<div class="fld">
					<dt class="k">Breaker</dt>
					<dd class="v">
						{#each ix.breakersOf(item) as b (b.id)}<span class="rob"><span class="bnum">{ix.slotOf(b)}</span>{ix.labelOf(b)}</span>{:else}No breaker{/each}
					</dd>
				</div>
				{#if item.critical}
					<div class="fld"><dt class="k">Critical</dt><dd class="v">{item.criticalNote?.trim() || 'Warn before cutting its power'}</dd></div>
				{/if}
				{#if item.notes?.trim()}
					<div class="fld"><dt class="k">Notes</dt><dd class="v note">{item.notes}</dd></div>
				{/if}
			</dl>
			{#if placed}
				<div class="mapcard">
					<span class="ico"><Icon name="map" size={16} /></span>
					<span class="mtext">
						<span class="mt">Placed on {floorLabel}</span>
						<span class="ms">{ix.roomName(roomId)}</span>
					</span>
					<a class="btn mbtn" href={mapHref}>Locate</a>
				</div>
			{/if}
		</div>
		<div class="dfoot">
			<div class="grow"></div>
			<button type="button" class="btn" onclick={onclose}>Close</button>
		</div>
	{:else}
	<div class="dbody">
		{#if firstBreaker === null && breakerId === null}
			<div class="callout">
				<strong>Not on a breaker yet</strong>
				<span>Flip breakers off one at a time until this goes dead, then pick that breaker below.</span>
			</div>
		{/if}

		<div class="fld">
			<label for="d-name">Name</label>
			<input
				id="d-name"
				class="inp"
				type="text"
				bind:value={name}
				bind:this={nameInput}
				placeholder="e.g. Outlet by the couch" />
		</div>
		<div class="two">
			<div class="fld">
				<label for="d-type">Type</label>
				<select id="d-type" class="inp" bind:value={type}>
					{#each ITEM_TYPES as t (t)}<option value={t}>{ITEM_TYPE_LABELS[t].one}</option>{/each}
				</select>
			</div>
			<div class="fld">
				<label for="d-floor">Floor</label>
				<select id="d-floor" class="inp" value={floorId ?? ''} onchange={changeFloor}>
					{#if floorId === null}<option value="">Choose a floor</option>{/if}
					{#each floors as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
				</select>
			</div>
		</div>
		<div class="fld">
			<label for="d-room">Room</label>
			<select id="d-room" class="inp" bind:value={roomId}>
				{#each rooms as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
				<option value={null}>Not in a room</option>
			</select>
		</div>
		<div class="fld">
			<label for="d-brk">Breaker</label>
			<select id="d-brk" class="inp" bind:value={breakerId}>
				<option value={null}>— No breaker —</option>
				{#each breakerOptions as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
			</select>
			{#if otherBreakers.length}
				<span class="also">
					Also on {otherBreakers.map((b) => ix.slotOf(b)).join(' + ')}{' '}·{' '}
					{otherBreakers.map((b) => ix.labelOf(b)).join(', ')}. Changing this keeps that.
				</span>
			{/if}
		</div>

		<div class="mapcard">
			<span class="ico"><Icon name="map" size={16} /></span>
			<span class="mtext">
				<span class="mt">{placed ? `Placed on ${floorLabel}` : 'Not on the map yet'}</span>
				<span class="ms">{placed ? ix.roomName(roomId) : 'Drop it where it really is'}</span>
			</span>
			<a class="btn mbtn" href={mapHref}>{placed ? 'Locate' : 'Place on map'}</a>
		</div>

		<div class="crit">
			<span class="ctext" id="d-crit-l">
				<span class="mt">Critical</span>
				<span class="ms">Warn before cutting its power</span>
			</span>
			<button
				type="button"
				class="sw"
				class:is-on={critical}
				role="switch"
				aria-checked={critical}
				aria-labelledby="d-crit-l"
				onclick={() => (critical = !critical)}><span class="kn"></span></button>
		</div>
		{#if critical}
			<div class="fld">
				<label for="d-cnote">What to know when it loses power</label>
				<input
					id="d-cnote"
					class="inp"
					type="text"
					bind:value={criticalNote}
					placeholder="e.g. Food stays safe about 4 hours if the door stays shut" />
			</div>
		{/if}

		<div class="fld">
			<label for="d-notes">Notes</label>
			<textarea
				id="d-notes"
				class="inp"
				rows="3"
				bind:value={notes}
				placeholder="Wiring quirks, fixture model, anything useful"></textarea>
		</div>
	</div>

	<div class="dfoot">
		<button type="button" class="btn btn-warn" onclick={remove}>Delete</button>
		<div class="grow"></div>
		<button type="button" class="btn" onclick={onclose}>Close</button>
		<button type="button" class="btn btn-pri" onclick={save} disabled={saving}>Save</button>
	</div>
	{/if}
</aside>

<style>
	.ro {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin: 0;
	}
	.ro dd {
		margin: 0;
	}
	.ro .v {
		height: auto;
		min-height: var(--control-h);
		padding: 10px 12px;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		font-family: var(--font-ui);
		font-size: 14px;
		white-space: normal;
	}
	.rob {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.rob + .rob {
		margin-top: 6px;
	}
	.note {
		white-space: pre-wrap;
		line-height: 1.5;
	}
	.drawer {
		width: 380px;
		flex-shrink: 0;
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-2xl);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.dhead {
		padding: 18px 20px;
		border-bottom: 1px solid var(--line);
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	.dtitle {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	h2 {
		font-size: 22px;
		font-weight: 800;
		font-stretch: 105%;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.dbody {
		flex: 1 1 0;
		min-height: 0;
		overflow: auto;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.callout {
		font-size: 13px;
	}
	.callout > strong {
		font-size: 14px;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.also {
		font-size: 12px;
		color: var(--muted);
	}
	.mapcard,
	.crit {
		border: 1px solid var(--line-2);
		border-radius: var(--r-lg);
		padding: 12px 14px;
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.mtext,
	.ctext {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.mt {
		font-size: 14px;
		font-weight: 600;
	}
	.ms {
		font-size: 12px;
		color: var(--muted);
	}
	.mbtn {
		height: var(--control-h-sm);
		padding: 0 12px;
	}
	.dfoot {
		padding: 14px 20px;
		border-top: 1px solid var(--line);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.grow {
		flex-grow: 1;
	}
</style>
