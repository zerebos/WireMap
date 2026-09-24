<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import FloorMap, { type MapDevice, type MapMode } from '$lib/components/FloorMap.svelte';
	import PanelView from '$lib/components/PanelView.svelte';
	import { callAction } from '$lib/actions';
	import { keepValues } from '$lib/forms';
	import { DEVICE_KINDS, DEVICE_KIND_INFO, type DeviceKind } from '$lib/constants';
	import {
		DEFAULT_METERS_PER_UNIT,
		FEET_PER_METER,
		dist,
		formatArea,
		formatLength,
		polygonArea,
		roomAt,
		toMeters,
		type LengthUnit,
		type Point
	} from '$lib/geometry';
	import { loadUnitPreference, setLengthUnit, units } from '$lib/units.svelte';

	let { data, form } = $props();

	$effect(loadUnitPreference);

	// ---- Lookups

	const roomById = $derived(new Map(data.rooms.map((r) => [r.id, r])));
	const floorById = $derived(new Map(data.floors.map((f) => [f.id, f])));
	const breakerById = $derived(
		new Map(
			data.panels.flatMap((p) =>
				p.breakers.map((b) => [b.id, { ...b, panelId: p.id, panelName: p.name }] as const)
			)
		)
	);
	type Device = (typeof data.devices)[number];
	const floorOf = (d: Device) => (d.roomId ? (roomById.get(d.roomId)?.floorId ?? null) : null);
	const isPlaced = (d: Device) => d.posX !== null && d.posY !== null && floorOf(d) !== null;
	const breakerName = (id: number | null) => {
		const b = id ? breakerById.get(id) : undefined;
		return b ? `#${b.slot} ${b.label || 'Unlabeled'}` : 'No breaker';
	};

	// ---- Selection lives in the URL: ?floor, ?d (item), ?r (room), ?b (breaker), ?panel

	const num = (key: string) => Number(page.url.searchParams.get(key)) || null;

	function href(changes: Record<string, number | null>) {
		const q = new URLSearchParams(page.url.searchParams);
		for (const [k, v] of Object.entries(changes)) {
			if (v === null) q.delete(k);
			else q.set(k, String(v));
		}
		const s = q.toString();
		return s ? `${resolve('/map')}?${s}` : resolve('/map');
	}
	const nav = (changes: Record<string, number | null>) =>
		goto(href(changes), { noScroll: true, keepFocus: true, replaceState: true });

	const selectedDevice = $derived(data.devices.find((d) => d.id === num('d')) ?? null);
	const selectedRoom = $derived(roomById.get(num('r') ?? 0) ?? null);
	const breakerId = $derived(num('b') ?? selectedDevice?.breakerId ?? null);
	const breaker = $derived(breakerId ? (breakerById.get(breakerId) ?? null) : null);

	/** The floor holding most of a breaker's placed items (or the current one, if it has any). */
	function floorForBreaker(id: number, current: number | null) {
		const counts = new Map<number, number>();
		for (const d of data.devices) {
			if (d.breakerId === id && isPlaced(d)) counts.set(floorOf(d)!, (counts.get(floorOf(d)!) ?? 0) + 1);
		}
		if (current && counts.has(current)) return current;
		return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? current;
	}

	const floor = $derived.by(() => {
		const byParam = floorById.get(num('floor') ?? 0);
		if (byParam) return byParam;
		const follow =
			(selectedDevice && floorOf(selectedDevice)) ||
			selectedRoom?.floorId ||
			(breakerId && floorForBreaker(breakerId, null));
		return floorById.get(follow || 0) ?? data.floors[0] ?? null;
	});
	const mpu = $derived(floor?.metersPerUnit ?? DEFAULT_METERS_PER_UNIT);

	const floorRooms = $derived(floor ? data.rooms.filter((r) => r.floorId === floor.id) : []);
	const mapDevices: MapDevice[] = $derived(
		data.devices
			.filter((d) => isPlaced(d) && floorOf(d) === floor?.id)
			.map((d) => ({
				id: d.id,
				name: d.name,
				kind: d.kind,
				x: d.posX!,
				y: d.posY!,
				breakerId: d.breakerId,
				color: (d.breakerId && breakerById.get(d.breakerId)?.color) || null
			}))
	);
	const unplaced = $derived(
		data.devices.filter((d) => !isPlaced(d) && (floorOf(d) === null || floorOf(d) === floor?.id))
	);

	const shownPanel = $derived(
		data.panels.find((p) => p.id === (num('panel') ?? breaker?.panelId)) ?? data.panels[0] ?? null
	);

	// ---- Map interaction state

	let mode = $state<MapMode>('select');
	let pendingOutline = $state<Point[] | null>(null);
	let pendingPoint = $state<Point | null>(null);
	let measureLine = $state<[Point, Point] | null>(null);
	let placing = $state<Device | null>(null);
	let message = $state<string | null>(null);
	let busy = $state(false);

	function resetDrafts() {
		pendingOutline = null;
		pendingPoint = null;
		measureLine = null;
		placing = null;
	}

	// Start fresh when switching floors (but not when the same floor's data refreshes).
	let shownFloorId: number | null = null;
	$effect(() => {
		const id = floor?.id ?? null;
		if (id === shownFloorId) return;
		shownFloorId = id;
		mode = 'select';
		resetDrafts();
	});
	$effect(() => {
		if (mode !== 'add') pendingPoint = null;
		if (mode !== 'place') placing = null;
	});

	async function run(action: string, values: Record<string, string | number | null | undefined>) {
		busy = true;
		const res = await callAction(action, values);
		busy = false;
		message = res.ok ? null : res.error;
		return res;
	}

	async function moveDevice(id: number, p: Point) {
		await run('placeDevice', { id, floorId: floor!.id, x: p[0], y: p[1] });
	}

	async function saveOutline(roomId: number | null, outline: Point[]) {
		if (roomId === null) {
			pendingOutline = outline;
			newRoomId = String(outlineCandidates[0]?.id ?? '');
			return;
		}
		await run('saveOutline', { floorId: floor!.id, roomId, outline: JSON.stringify(outline) });
	}

	async function pickPoint(p: Point) {
		if (mode === 'place' && placing) {
			const id = placing.id;
			const res = await run('placeDevice', { id, floorId: floor!.id, x: p[0], y: p[1] });
			if (res.ok) {
				mode = 'select';
				nav({ d: id, r: null, b: null });
			}
		} else if (mode === 'add') {
			pendingPoint = p;
			newItemRoomId = String(roomAt(p, floorRooms)?.id ?? '');
		}
	}

	function startPlacing(d: Device) {
		resetDrafts();
		placing = d;
		mode = 'place';
	}

	// ---- New room form

	let newRoomId = $state('');
	let newRoomName = $state('');
	/** Rooms that could take a freshly drawn outline: on this floor (or none) and not drawn yet. */
	const outlineCandidates = $derived(
		data.rooms.filter((r) => !r.outline && (r.floorId === null || r.floorId === floor?.id))
	);

	async function submitNewRoom(e: SubmitEvent) {
		e.preventDefault();
		if (!pendingOutline || !floor) return;
		const res = await run('saveOutline', {
			floorId: floor.id,
			roomId: newRoomId || null,
			name: newRoomId ? null : newRoomName,
			outline: JSON.stringify(pendingOutline)
		});
		if (res.ok) {
			pendingOutline = null;
			newRoomName = '';
			nav({ r: Number(res.data?.roomId) || null, d: null, b: null });
		}
	}

	// ---- New item form. Kind and breaker stick between items for quick mapping.

	let newItem = $state({ name: '', kind: 'outlet' as DeviceKind, breakerId: '', height: '' });
	let newItemRoomId = $state('');
	const newItemRoom = $derived(pendingPoint ? roomAt(pendingPoint, floorRooms) : null);

	async function submitNewItem(e: SubmitEvent) {
		e.preventDefault();
		if (!pendingPoint || !floor) return;
		const res = await run('createDevice', {
			floorId: floor.id,
			x: pendingPoint[0],
			y: pendingPoint[1],
			name: newItem.name,
			kind: newItem.kind,
			breakerId: newItem.breakerId,
			roomId: newItemRoom?.id ?? newItemRoomId,
			height: newItem.height,
			heightUnit: smallUnit
		});
		if (res.ok) {
			pendingPoint = null;
			newItem.name = '';
		}
	}

	// ---- Units

	const smallUnit = $derived(units.length === 'm' ? 'cm' : 'in');
	const heightFromMeters = (m: number | null) =>
		m === null ? '' : String(Math.round(units.length === 'm' ? m * 100 : m * FEET_PER_METER * 12));
	const toDisplay = (meters: number, unit: LengthUnit) =>
		Math.round((unit === 'm' ? meters : meters * FEET_PER_METER) * 10) / 10;

	// ---- Scale form

	let scaleLength = $state('');
	let scaleUnit = $state<LengthUnit>('ft');
	$effect(() => {
		if (measureLine) {
			scaleLength = '';
			scaleUnit = units.length;
		}
	});

	async function submitScale(e: SubmitEvent) {
		e.preventDefault();
		const len = Number(scaleLength);
		if (!measureLine || !floor || !(len > 0)) return;
		const res = await run('setScale', {
			id: floor.id,
			metersPerUnit: toMeters(len, scaleUnit) / dist(...measureLine)
		});
		if (res.ok) measureLine = null;
	}

	// ---- Plan upload: read the image's shape in the browser so the floor keeps its proportions.

	let planAspect = $state('');
	function readAspect(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		planAspect = '';
		if (!file) return;
		const img = new Image();
		img.onload = () => {
			planAspect = String(img.naturalHeight / img.naturalWidth);
			URL.revokeObjectURL(img.src);
		};
		img.src = URL.createObjectURL(file);
	}

	const devicesIn = (roomId: number) => data.devices.filter((d) => d.roomId === roomId);
	const circuitDevices = $derived(breakerId ? data.devices.filter((d) => d.breakerId === breakerId) : []);
	const where = (d: Device) => {
		const room = d.roomId ? roomById.get(d.roomId) : undefined;
		const fl = floorOf(d);
		return [room?.name, fl !== floor?.id && fl ? floorById.get(fl)?.name : null]
			.filter(Boolean)
			.join(' · ');
	};
	const panelHref = (id: number) => resolve('/panels/[id]', { id: String(id) });
	const selectDevice = (d: Device) => nav({ d: d.id, r: null, b: null, floor: floorOf(d) });
</script>

<svelte:head><title>Map · Breaker Box</title></svelte:head>

<div class="top">
	<h1>Map</h1>
	{#if data.floors.length}
		<nav class="tabs" aria-label="Floors">
			{#each data.floors as f (f.id)}
				<a
					href={href({ floor: f.id, d: null, r: null })}
					aria-current={f.id === floor?.id ? 'page' : undefined}
					data-sveltekit-noscroll
					data-sveltekit-replacestate
				>
					{f.name}
				</a>
			{/each}
			<a class="add" href={resolve('/rooms')}>+ Floor</a>
		</nav>
	{/if}
	<div class="unit-toggle" role="group" aria-label="Units">
		{#each ['ft', 'm'] as const as u (u)}
			<button type="button" class:active={units.length === u} onclick={() => setLengthUnit(u)}>{u}</button>
		{/each}
	</div>
</div>

{#if !floor}
	<div class="card">
		<h2>Add a floor to start</h2>
		<p class="muted">The map is drawn one floor at a time. <a href={resolve('/rooms')}>Add a floor</a> on the Rooms page.</p>
	</div>
{:else}
	<div class="layout">
		<FloorMap
			{floor}
			rooms={floorRooms}
			devices={mapDevices}
			selectedDeviceId={selectedDevice?.id ?? null}
			selectedRoomId={selectedRoom?.id ?? null}
			highlightBreakerId={breakerId}
			bind:mode
			{pendingOutline}
			{pendingPoint}
			{measureLine}
			placingLabel={placing?.name ?? null}
			onselectdevice={(id) => nav({ d: id, r: null, b: null })}
			onselectroom={(id) => nav({ r: id, d: null, b: null })}
			onmovedevice={moveDevice}
			onoutline={saveOutline}
			onpoint={pickPoint}
			onmeasure={(line) => {
				resetDrafts();
				measureLine = line;
			}}
			oncancel={() => {
				resetDrafts();
				message = null;
			}}
		/>

		<aside class="stack">
			{#if message || form?.error}
				<p class="error card" role="alert">{message ?? form?.error}</p>
			{/if}

			<section class="card stack">
				{#if pendingOutline}
					<h2>New room</h2>
					<p class="muted">
						{formatArea(polygonArea(pendingOutline) * mpu * mpu, units.length)} on {floor.name}
					</p>
					<form class="stack" onsubmit={submitNewRoom}>
						{#if outlineCandidates.length}
							<label>
								Which room is this?
								<select bind:value={newRoomId}>
									{#each outlineCandidates as r (r.id)}
										<option value={String(r.id)}>{r.name}</option>
									{/each}
									<option value="">A new room…</option>
								</select>
							</label>
						{/if}
						{#if !newRoomId}
							<label>Name <input bind:value={newRoomName} required placeholder="Hallway" /></label>
						{/if}
						<div class="row">
							<button class="primary" disabled={busy}>Save room</button>
							<button type="button" onclick={() => (pendingOutline = null)}>Discard</button>
						</div>
					</form>
				{:else if pendingPoint}
					<h2>New item here</h2>
					<form class="stack" onsubmit={submitNewItem}>
						{#if newItemRoom}
							<p class="muted">In {newItemRoom.name}</p>
						{:else}
							<label>
								Room
								<select bind:value={newItemRoomId} required>
									<option value="" disabled>Pick a room</option>
									{#each floorRooms as r (r.id)}<option value={String(r.id)}>{r.name}</option>{/each}
								</select>
							</label>
							{#if !floorRooms.length}
								<p class="muted">This floor has no rooms yet. Draw one first.</p>
							{/if}
						{/if}
						<div class="grid-2">
							<label>
								Type
								<select bind:value={newItem.kind}>
									{#each DEVICE_KINDS as k (k)}
										<option value={k}>{DEVICE_KIND_INFO[k].icon} {DEVICE_KIND_INFO[k].label}</option>
									{/each}
								</select>
							</label>
							<label>
								Height ({smallUnit})
								<input bind:value={newItem.height} type="number" min="0" step="1" placeholder="Optional" />
							</label>
						</div>
						<label>
							Name
							<!-- svelte-ignore a11y_autofocus -->
							<input bind:value={newItem.name} required placeholder="Outlet by the window" autofocus />
						</label>
						<label>
							Breaker
							<select bind:value={newItem.breakerId}>
								{@render breakerOptions()}
							</select>
						</label>
						<div class="row">
							<button class="primary" disabled={busy}>Add item</button>
							<button type="button" onclick={() => (pendingPoint = null)}>Cancel</button>
						</div>
					</form>
				{:else if measureLine}
					<h2>Set the scale</h2>
					<p class="muted">How long is the red line in real life?</p>
					<form class="row" onsubmit={submitScale}>
						<label class="grow">
							Length
							<input bind:value={scaleLength} type="number" min="0" step="any" required />
						</label>
						<label>
							Unit
							<select bind:value={scaleUnit}>
								<option value="ft">feet</option>
								<option value="m">metres</option>
							</select>
						</label>
						<button class="primary" disabled={busy}>Set scale</button>
						<button type="button" onclick={() => (measureLine = null)}>Cancel</button>
					</form>
				{:else if selectedDevice}
					{@const d = selectedDevice}
					{#key d.id}
						<header class="head">
							<div>
								<h2><span aria-hidden="true">{DEVICE_KIND_INFO[d.kind].icon}</span> {d.name}</h2>
								<p class="muted">
									{DEVICE_KIND_INFO[d.kind].label}{where(d) ? ` · ${where(d)}` : ''}
									{#if d.posZ !== null}· {formatLength(d.posZ, units.length)} up{/if}
								</p>
							</div>
							<a class="button" href={href({ d: null })} data-sveltekit-noscroll data-sveltekit-replacestate aria-label="Close">✕</a>
						</header>

						{#if breaker}
							<p>
								On <strong>{breakerName(breaker.id)}</strong> ({breaker.amps}A, {breaker.panelName}).
								<a href="{panelHref(breaker.panelId)}?b={breaker.id}">Open on panel</a>
							</p>
							{@const mates = circuitDevices.filter((m) => m.id !== d.id)}
							{#if mates.length}
								<div>
									<h3>Also on this circuit</h3>
									{@render deviceList(mates)}
								</div>
							{/if}
						{:else}
							<p class="muted">Not assigned to a breaker yet.</p>
						{/if}

						<details>
							<summary>Edit item</summary>
							<form method="POST" action="?/updateDevice" use:enhance={keepValues} class="stack edit">
								<input type="hidden" name="id" value={d.id} />
								<div class="grid-2">
									<label>
										Type
										<select name="kind" value={d.kind}>
											{#each DEVICE_KINDS as k (k)}
												<option value={k}>{DEVICE_KIND_INFO[k].icon} {DEVICE_KIND_INFO[k].label}</option>
											{/each}
										</select>
									</label>
									<label>
										Height ({smallUnit})
										<input name="height" type="number" min="0" step="any" value={heightFromMeters(d.posZ)} />
									</label>
								</div>
								<input type="hidden" name="heightUnit" value={smallUnit} />
								<label>Name <input name="name" required value={d.name} /></label>
								<label>
									Breaker
									<select name="breakerId" value={d.breakerId ? String(d.breakerId) : ''}>
										{@render breakerOptions()}
									</select>
								</label>
								<label>Notes <textarea name="notes">{d.notes ?? ''}</textarea></label>
								<div><button class="primary">Save</button></div>
							</form>
						</details>

						<div class="row">
							{#if isPlaced(d)}
								<button
									type="button"
									disabled={busy}
									onclick={() => run('unplaceDevice', { id: d.id })}
								>
									Take off the map
								</button>
							{:else}
								<button type="button" onclick={() => startPlacing(d)}>Place on map</button>
							{/if}
						</div>
					{/key}
				{:else if selectedRoom}
					{@const r = selectedRoom}
					{@const items = devicesIn(r.id)}
					{#key r.id}
						<header class="head">
							<div>
								<h2>{r.name}</h2>
								<p class="muted">
									{r.outline ? formatArea(polygonArea(r.outline) * mpu * mpu, units.length) : 'No outline'}
									· {items.length} item{items.length === 1 ? '' : 's'}
								</p>
							</div>
							<a class="button" href={href({ r: null })} data-sveltekit-noscroll data-sveltekit-replacestate aria-label="Close">✕</a>
						</header>
						{#if items.length}{@render deviceList(items)}{/if}
						<form method="POST" action="?/updateRoom" use:enhance={keepValues} class="row">
							<input type="hidden" name="id" value={r.id} />
							<label class="grow">Name <input name="name" required value={r.name} /></label>
							<button>Rename</button>
						</form>
						<div class="row">
							<button type="button" class="danger" disabled={busy} onclick={() => run('clearOutline', { id: r.id })}>
								Remove outline
							</button>
						</div>
					{/key}
				{:else if breaker}
					<header class="head">
						<div>
							<h2>{breakerName(breaker.id)}</h2>
							<p class="muted">
								{breaker.amps}A {breaker.poles === 2 ? '240V' : '120V'} · {breaker.panelName} ·
								{circuitDevices.length} item{circuitDevices.length === 1 ? '' : 's'}
							</p>
						</div>
						<a class="button" href={href({ b: null })} data-sveltekit-noscroll data-sveltekit-replacestate aria-label="Close">✕</a>
					</header>
					{#if circuitDevices.length}
						{@render deviceList(circuitDevices)}
					{:else}
						<p class="muted">Nothing on this circuit yet.</p>
					{/if}
					<p><a href="{panelHref(breaker.panelId)}?b={breaker.id}">Open on panel</a></p>
				{:else}
					<h2>{floor.name}</h2>
					<p class="muted">
						{formatLength(floor.planWidth * mpu, units.length)} × {formatLength(floor.planHeight * mpu, units.length)}
						· {floor.metersPerUnit ? 'scale set' : 'scale not measured yet'}
					</p>
					<p class="muted small">
						Click an item or a breaker to see its circuit. Use <strong>Draw room</strong> to outline rooms and
						<strong>Add item</strong> to drop outlets and lights where they are.
					</p>

					<details>
						<summary>Floor plan image</summary>
						<form
							method="POST"
							action="?/uploadPlan"
							enctype="multipart/form-data"
							use:enhance
							class="stack edit"
						>
							<input type="hidden" name="id" value={floor.id} />
							<input type="hidden" name="aspect" value={planAspect} />
							<label>
								{floor.planImage ? 'Replace the plan' : 'Upload a plan'} (PNG, JPG, WebP)
								<input name="plan" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required onchange={readAspect} />
							</label>
							<p class="muted small">
								The image is stretched over the floor. Afterwards, use <strong>Set scale</strong> on a wall you
								know the length of.
							</p>
							<div class="row">
								<button class="primary">Upload</button>
							</div>
						</form>
						{#if floor.planImage}
							<form method="POST" action="?/removePlan" use:enhance class="edit">
								<input type="hidden" name="id" value={floor.id} />
								<button class="danger">Remove plan image</button>
							</form>
						{/if}
					</details>

					<details>
						<summary>Floor name and size</summary>
						<form
							method="POST"
							action="?/updateFloor"
							use:enhance={keepValues}
							class="stack edit"
						>
							<input type="hidden" name="id" value={floor.id} />
							<input type="hidden" name="unit" value={units.length} />
							<label>Name <input name="name" required value={floor.name} /></label>
							<div class="grid-2">
								<label>
									Width ({units.length})
									<input name="width" type="number" min="0.1" step="any" required value={toDisplay(floor.planWidth * mpu, units.length)} />
								</label>
								<label>
									Depth ({units.length})
									<input name="height" type="number" min="0.1" step="any" required value={toDisplay(floor.planHeight * mpu, units.length)} />
								</label>
							</div>
							{#if floor.planImage}
								<p class="muted small">Changing the size stretches the plan image with it.</p>
							{/if}
							<div><button class="primary">Save floor</button></div>
						</form>
					</details>
				{/if}
			</section>

			{#if unplaced.length}
				<section class="card stack">
					<h3>Not on the map yet</h3>
					<p class="muted small">Pick one, then click where it is.</p>
					<ul class="list">
						{#each unplaced as d (d.id)}
							<li>
								<button
									type="button"
									class="item"
									class:active={placing?.id === d.id}
									onclick={() => (placing?.id === d.id ? (mode = 'select') : startPlacing(d))}
								>
									<span aria-hidden="true">{DEVICE_KIND_INFO[d.kind].icon}</span>
									<span class="name">{d.name}</span>
									<span class="muted small">{where(d) || breakerName(d.breakerId)}</span>
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if shownPanel}
				<section class="card stack">
					<div class="head">
						<h3>Circuits</h3>
						{#if data.panels.length > 1}
							<select
								aria-label="Panel"
								value={shownPanel.id}
								onchange={(e) => nav({ panel: Number(e.currentTarget.value), b: null, d: null })}
							>
								{#each data.panels as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
							</select>
						{/if}
					</div>
					<p class="muted small">Click a breaker to light up everything it feeds.</p>
					<PanelView
						compact
						slotCount={shownPanel.slotCount}
						mainAmps={shownPanel.mainAmps}
						breakers={shownPanel.breakers}
						selectedId={breakerId}
						hrefFor={(b) =>
							b.id === num('b')
								? href({ b: null })
								: href({ b: b.id, d: null, r: null, floor: floorForBreaker(b.id, floor.id) })}
						hrefForSlot={(slot) => `${panelHref(shownPanel.id)}?slot=${slot}`}
					/>
				</section>
			{/if}
		</aside>
	</div>
{/if}

{#snippet breakerOptions()}
	<option value="">No breaker</option>
	{#each data.panels as p (p.id)}
		<optgroup label={p.name}>
			{#each p.breakers as b (b.id)}
				<option value={String(b.id)}>#{b.slot} {b.label || 'Unlabeled'} ({b.amps}A)</option>
			{/each}
		</optgroup>
	{/each}
{/snippet}

{#snippet deviceList(items: Device[])}
	<ul class="list">
		{#each items as d (d.id)}
			<li>
				<button type="button" class="item" onclick={() => (isPlaced(d) ? selectDevice(d) : startPlacing(d))}>
					<span aria-hidden="true">{DEVICE_KIND_INFO[d.kind].icon}</span>
					<span class="name">{d.name}</span>
					<span class="muted small">{isPlaced(d) ? where(d) : 'Place on map'}</span>
				</button>
			</li>
		{/each}
	</ul>
{/snippet}

<style>
	.top {
		display: flex;
		align-items: center;
		gap: 1rem 1.5rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.top h1 {
		margin: 0;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
		flex: 1;
	}
	.tabs a {
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		text-decoration: none;
		color: var(--muted);
		border: 1px solid transparent;
	}
	.tabs a[aria-current='page'] {
		color: var(--text);
		background: var(--surface);
		border-color: var(--border);
	}
	.tabs a.add {
		font-size: 0.85rem;
		align-self: center;
	}
	.unit-toggle {
		display: flex;
	}
	.unit-toggle button {
		border-radius: 0;
		padding: 0.25rem 0.6rem;
	}
	.unit-toggle button:first-child {
		border-radius: 6px 0 0 6px;
	}
	.unit-toggle button:last-child {
		border-radius: 0 6px 6px 0;
		border-left: 0;
	}
	.unit-toggle button.active {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 22rem;
		gap: 1.25rem;
		align-items: start;
	}
	@media (max-width: 960px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}

	.head {
		display: flex;
		justify-content: space-between;
		align-items: start;
		gap: 0.5rem;
	}
	.head p,
	section > p {
		margin: 0;
	}
	.head select {
		width: auto;
	}
	h2 {
		font-size: 1.2rem;
	}
	h3 {
		font-size: 0.95rem;
	}
	.small {
		font-size: 0.8rem;
	}
	.grow {
		flex: 1;
		min-width: 6rem;
	}
	.row label:not(.grow) {
		width: auto;
	}
	details summary {
		cursor: pointer;
		color: var(--accent);
	}
	.edit {
		margin-top: 0.6rem;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 6px;
		max-height: 16rem;
		overflow-y: auto;
	}
	.list li + li {
		border-top: 1px solid var(--border);
	}
	.item {
		width: 100%;
		border: 0;
		border-radius: 0;
		background: none;
		padding: 0.45rem 0.6rem;
		text-align: left;
	}
	.item:hover {
		background: var(--surface-2);
	}
	.item.active {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
	}
	.item .name {
		flex: 1;
	}
</style>
