<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import CircuitList from '$lib/components/map/CircuitList.svelte';
	import Inspector from '$lib/components/map/Inspector.svelte';
	import MapView from '$lib/components/map/MapView.svelte';
	import { NONE, defaultFloor, floorOfCircuit, litBreakers, type Sel, type Tool } from '$lib/components/map/model';
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
		if (next.kind !== 'room' || next.id !== shaping) shaping = null;
		if (next.kind !== 'item' || next.id !== moving) moving = null;
		goto(`${resolve('/map')}?${q}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	let tool = $state<Tool>('select');
	let hovB = $state<number | null>(null);
	let shaping = $state<number | null>(null);
	let moving = $state<number | null>(null);

	const lit = $derived(new Set(litBreakers(ix, sel).map((b) => b.id)));
	function pickCircuit(b: Breaker) {
		go(lit.has(b.id) ? NONE : { kind: 'circuit', id: b.id });
	}
	function startMove(i: HouseItem) {
		moving = moving === i.id ? null : i.id;
		if (moving !== null) tool = 'select';
	}
	function startShape(r: Room) {
		shaping = shaping === r.id ? null : r.id;
		if (shaping !== null) tool = 'select';
	}
</script>

<div class="map">
	<CircuitList {ix} q={query()} {lit} onpick={pickCircuit} />
	<MapView {ix} {sel} {floorId} fade={data.house.settings.mapFadeOthers} bind:tool bind:hovB bind:shaping bind:moving {go} />
	<Inspector {ix} {sel} {floorId} bind:hovB {shaping} {moving} {go} onmove={startMove} onshape={startShape} />
</div>

<style>
	.map {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
	}
</style>
