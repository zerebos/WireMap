<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import CircuitList from '$lib/components/map/CircuitList.svelte';
	import Inspector from '$lib/components/map/Inspector.svelte';
	import MapView from '$lib/components/map/MapView.svelte';
	import MapEditor from '$lib/components/map/edit/MapEditor.svelte';
	import { NONE, defaultFloor, floorOfCircuit, floorSteps, litBreakers, type Sel, type Tool } from '$lib/components/map/model';
	import type { Breaker, Room } from '$lib/db/schema';
	import { index, type HouseItem } from '$lib/house';
	import { query } from '$lib/search.svelte';

	let { data } = $props();
	const ix = $derived(index(data.house));

	// Selection lives in the URL: ?floor=<id>&circuit=<breakerId> | item=<id> | room=<id>.
	const params = $derived(page.url.searchParams);
	const num = (k: string) => {
		const v = params.get(k);
		const n = v === null ? NaN : Number(v);
		return Number.isInteger(n) ? n : null;
	};
	const sel: Sel = $derived.by(() => {
		const item = num('item');
		if (item !== null && ix.house.items.some((i) => i.id === item)) return { kind: 'item', id: item };
		const circuit = num('circuit');
		if (circuit !== null && ix.breakerById.has(circuit)) return { kind: 'circuit', id: circuit };
		const room = num('room');
		if (room !== null && ix.roomById.has(room)) return { kind: 'room', id: room };
		return NONE;
	});
	const floorId = $derived.by(() => {
		const f = num('floor');
		if (f !== null && ix.floorById.has(f)) return f;
		// Links from other screens name only the thing; show the floor it's on.
		let want: number | null = null;
		if (sel.kind === 'item') want = ix.house.items.find((i) => i.id === sel.id)?.floorId ?? null;
		else if (sel.kind === 'room') want = ix.roomById.get(sel.id)?.floorId ?? null;
		else if (sel.kind === 'circuit') want = floorOfCircuit(ix, sel.id);
		return want !== null && ix.floorById.has(want) ? want : defaultFloor(ix);
	});

	function go(next: Sel, floor: number | null = floorId) {
		const q = new URLSearchParams();
		if (floor !== null) q.set('floor', String(floor));
		if (next.kind !== 'none') q.set(next.kind, String(next.id));
		hovB = null;
		if (next.kind !== 'item' || next.id !== moving) moving = null;
		goto(`${resolve('/map')}?${q}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	let tool = $state<Tool>('select');
	let hovB = $state<number | null>(null);
	let moving = $state<number | null>(null);

	const steps = $derived(floorSteps(ix, floorId));
	const lit = $derived(new Set(litBreakers(ix, sel).map((b) => b.id)));
	function pickCircuit(b: Breaker) {
		go(lit.has(b.id) ? NONE : { kind: 'circuit', id: b.id });
	}
	function startMove(i: HouseItem) {
		moving = moving === i.id ? null : i.id;
		if (moving !== null) tool = 'select';
	}
	/** Layout editing (DESIGN.md §5.10): ?edit=1, optionally opening on a room. */
	const editing = $derived(params.get('edit') === '1' && floorId !== null);
	function edit(room: Room | null = null) {
		const q = new URLSearchParams({ edit: '1', floor: String(room?.floorId ?? floorId) });
		if (room) q.set('room', String(room.id));
		moving = null;
		tool = 'select';
		goto(`${resolve('/map')}?${q}`, { replaceState: false, keepFocus: true, noScroll: true });
	}
	function doneEditing() {
		go(NONE);
	}
</script>

<div class="map">
	{#if editing && floorId !== null}
		{#key floorId}
			<MapEditor {ix} {floorId} initialRoom={sel.kind === 'room' ? sel.id : null} ondone={doneEditing} />
		{/key}
	{:else}
		<CircuitList {ix} q={query()} {lit} onpick={pickCircuit} empty={floorId !== null && !steps.placed} />
		<MapView {ix} {sel} {floorId} fade={data.house.settings.mapFadeOthers} bind:tool bind:hovB bind:moving {go} onedit={() => edit()} />
		<Inspector {ix} {sel} {floorId} bind:hovB {moving} {go} onmove={startMove} onshape={(r) => edit(r)} />
	{/if}
</div>

<style>
	.map {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
	}
</style>
