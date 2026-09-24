<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import NewBreakerForm, { blankBreaker, type NewBreaker } from '$lib/components/panel/NewBreakerForm.svelte';
	import ShutoffDrawer from '$lib/components/ShutoffDrawer.svelte';
	import PhonePanel from '$lib/components/panel/PhonePanel.svelte';
	import PhoneShell from '$lib/components/phone/PhoneShell.svelte';
	import { viewport } from '$lib/viewport.svelte';
	import { access } from '$lib/access.svelte';
	import PanelEmpty from '$lib/components/panel/PanelEmpty.svelte';
	import RemoveBreakerDialog from '$lib/components/panel/RemoveBreakerDialog.svelte';
	import SubpanelForm from '$lib/components/panel/SubpanelForm.svelte';
	import { tick } from 'svelte';
	import { AMPS, ITEM_TYPES, ITEM_TYPE_LABELS, MIN_WIRE, PROTECTIONS, PROTECTION_LABELS, PROTECTION_TAGS } from '$lib/constants';
	import type { Half, Protection } from '$lib/constants';
	import type { Breaker, Panel } from '$lib/db/schema';
	import {
		createBreaker,
		createItem,
		createQuad,
		createSubpanel,
		deleteBreaker,
		makeQuad,
		makeTandem,
		setSpaces,
		swapQuadPairs,
		updateBreaker,
		type SubpanelValues
	} from '$lib/db/ops';
	import { index, mutate, plural, type HouseBreaker } from '$lib/house';
	import { checkFit, faceColumns, legOf, legOfRow, tandemOk, tandemText, nextInColumn, occupiedSlots, position, rowCount, slotLabel, slotText, spaceLabel, panelShort, compareBreakers, quadLayout, quadPair, quadTopOf, spacesOf, spacesUsed, tiedBelow, tiedTogether, type Cell as FaceCell } from '$lib/panel';
	import { query, search } from '$lib/search.svelte';

	let { data } = $props();

	const house = $derived(data.house);
	const ix = $derived(index(house));
	// Which panel (DESIGN.md §5.17): ?p=<id>, else the selected breaker's panel, else the main panel.
	const pParam = $derived(Number(page.url.searchParams.get('p')) || null);
	const bPanel = $derived(ix.breakerById.get(Number(page.url.searchParams.get('b')))?.panelId ?? null);
	const panel = $derived(house.panels.find((p) => p.id === pParam) ?? house.panels.find((p) => p.id === bPanel) ?? house.panel);
	const tree = $derived(ix.panelTree());
	/** A panel's amps: its main breaker, or for main lugs the feeder's. */
	const ampsOf = (p: Panel) => p.mainAmps ?? ix.feederOf(p)?.amps ?? null;
	const feeder = $derived(panel ? ix.feederOf(panel) : null);
	const subsHere = $derived(
		panel ? house.panels.filter((p) => p.fedByBreakerId !== null && ix.breakerById.get(p.fedByBreakerId)?.panelId === panel.id) : []
	);
	const panelHref = (p: Panel) => resolve('/panel') + `?p=${p.id}`;

	// ---- Add subpanel (?add=sub) in the detail pane.
	const adding = $derived(!access.guest && page.url.searchParams.get('add') === 'sub');
	let subForm = $state<ReturnType<typeof SubpanelForm>>();
	async function openAdd() {
		const url = new URL(page.url);
		url.searchParams.set('add', 'sub');
		url.searchParams.delete('slot');
		await goto(url, { replaceState: true, keepFocus: true, noScroll: true });
		await tick();
		subForm?.focus();
	}
	function cancelAdd() {
		const url = new URL(page.url);
		url.searchParams.delete('add');
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}
	async function addSub(v: SubpanelValues) {
		const id = await mutate(() => createSubpanel(v));
		goto(resolve('/panel') + `?p=${id}`);
	}

	const breakers = $derived(panel ? house.breakers.filter((b) => b.panelId === panel.id) : []);

	// ---- Unsaved edits, per breaker. The breaker face shows them live.
	type Draft = { label: string; amps: number; kind: Protection; poles: number; notes: string };
	let drafts = $state<Record<number, Draft>>({});
	let savedJustNow = $state(false);

	const view = (b: Breaker): Breaker => {
		const d = drafts[b.id];
		if (!d) return b;
		// A pole change re-derives the spaces it takes (the stored ones are for the saved size).
		const spaces = d.poles === b.poles ? (b as HouseBreaker).spaces : undefined;
		return { ...b, label: d.label, amps: d.amps, kind: d.kind, poles: d.poles, notes: d.notes, spaces } as Breaker;
	};
	const isChanged = (b: Breaker, d: Draft) =>
		d.label.trim() !== b.label ||
		d.amps !== b.amps ||
		d.kind !== b.kind ||
		d.poles !== b.poles ||
		(d.notes.trim() || null) !== (b.notes ?? null);
	const dirty = $derived(breakers.some((b) => drafts[b.id] && isChanged(b, drafts[b.id])));

	function edit(b: Breaker, patch: Partial<Draft>) {
		const current = drafts[b.id] ?? { label: b.label, amps: b.amps, kind: b.kind, poles: b.poles, notes: b.notes ?? '' };
		drafts[b.id] = { ...current, ...patch };
		savedJustNow = false;
	}

	async function save() {
		const changed = breakers.filter((b) => drafts[b.id] && isChanged(b, drafts[b.id]));
		await mutate(async () => {
			for (const b of changed) {
				const d = drafts[b.id];
				await updateBreaker(b.id, {
					label: d.label.trim(),
					amps: d.amps,
					kind: d.kind,
					poles: d.poles,
					notes: d.notes.trim() || null
				});
			}
		});
		drafts = {};
		savedJustNow = true;
	}

	// ---- Selection lives in the URL (?b=<id>).
	const selId = $derived(Number(page.url.searchParams.get('b')) || breakers[0]?.id);
	const selRaw = $derived(breakers.find((b) => b.id === selId) ?? breakers[0]);
	const sel = $derived(selRaw ? view(selRaw) : undefined);

	// On a phone, ?b= opens that breaker's sheet, and &edit=1 its details.
	const phoneSel = $derived(page.url.searchParams.has('b') && selRaw?.id === selId ? view(selRaw) : null);
	const phoneEdit = $derived(page.url.searchParams.get('edit') === '1');
	// Shut off on desktop (DESIGN.md §5.16): &shutoff=1 opens the drawer for the selected breaker.
	const shutoffOpen = $derived(page.url.searchParams.get('shutoff') === '1');
	function closeShutoff() {
		const url = new URL(page.url);
		url.searchParams.delete('shutoff');
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}
	function closeSheet() {
		const url = new URL(page.url);
		url.searchParams.delete('b');
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function pick(id: number) {
		moving = false;
		const url = new URL(page.url);
		url.searchParams.set('b', String(id));
		url.searchParams.delete('slot');
		return goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	// The Directory screen (§5.8).
	const directoryHref = resolve('/directory');

	// ---- A new breaker in an open slot (?slot=<n>). While it's open, ?b= is kept so Cancel goes back.
	const newSlot = $derived.by(() => {
		const n = Number(page.url.searchParams.get('slot'));
		if (access.guest || !panel || !Number.isInteger(n) || n < 1 || n > panel.slotCount || cover.has(n)) return null;
		return n;
	});
	let form = $state<NewBreaker>(blankBreaker());
	let formEl = $state<ReturnType<typeof NewBreakerForm>>();

	/** Why a 2-pole breaker (the breaker `id`, or a new one) can't start at `slot`, or null if it can. */
	function why2(slot: number, id?: number): string | null {
		if (!panel || !checkFit({ id, slot, poles: 2 }, panel, placed)) return null;
		const below = nextInColumn(slot, panel);
		if (below > panel.slotCount || position(below, panel).side !== position(slot, panel).side) {
			return 'A 2-pole breaker needs the slot below, and this is the bottom row.';
		}
		return `A 2-pole breaker needs slot ${below}, which is taken.`;
	}
	const no2Why = $derived(newSlot === null ? null : why2(newSlot));
	const newQuad = $derived(
		!!panel && newSlot !== null && form.quad && !no2Why && tandemOk(newSlot, panel) && tandemOk(nextInColumn(newSlot, panel), panel)
	);
	const newTandem = $derived(!!panel && newSlot !== null && !newQuad && form.tandem && tandemOk(newSlot, panel));
	const newPoles = $derived(no2Why || newTandem ? 1 : newQuad ? 2 : form.poles);
	const newSlots = $derived(panel && newSlot !== null ? occupiedSlots({ slot: newSlot, poles: newPoles }, panel) : []);

	async function openSlot(slot: number, amps = 20) {
		form = blankBreaker(amps);
		const url = new URL(page.url);
		url.searchParams.set('slot', String(slot));
		await goto(url, { replaceState: true, keepFocus: true, noScroll: true });
		await tick();
		formEl?.focus();
	}
	async function cancelSlot() {
		const slot = newSlot;
		const url = new URL(page.url);
		url.searchParams.delete('slot');
		await goto(url, { replaceState: true, keepFocus: true, noScroll: true });
		await tick();
		if (slot !== null) document.querySelector<HTMLElement>(`[data-slot="${slot}"]`)?.focus();
	}
	async function addBreaker(next: boolean) {
		if (!panel || newSlot === null) return;
		const slot = newSlot;
		const poles = newPoles;
		const amps = form.amps;
		const f = form;
		const quad = newQuad;
		const id = await mutate(async () => {
			if (quad) {
				const kind = f.kind;
				const outer = { label: f.label.trim(), amps, kind };
				const b = { label: f.labelB.trim(), amps: f.ampsB, kind };
				const below = nextInColumn(slot, panel);
				return createQuad(panel.id, slot, below, outer, f.mixed ? { b, c: { label: f.labelC.trim(), amps: f.ampsC, kind } } : b);
			}
			if (!newTandem) return createBreaker({ panelId: panel.id, slot, poles, amps, kind: f.kind, label: f.label.trim() });
			const a = await createBreaker({ panelId: panel.id, slot, half: 'A', poles: 1, amps, kind: f.kind, label: f.label.trim() });
			await createBreaker({ panelId: panel.id, slot, half: 'B', poles: 1, amps: f.ampsB, kind: f.kind, label: f.labelB.trim() });
			return a;
		});
		// The next free slot in slot order after this one (then from the top).
		const taken = new Set([...cover.keys(), ...occupiedSlots({ slot, poles }, panel)]);
		const order = Array.from({ length: panel.slotCount }, (_, i) => ((slot + i) % panel.slotCount) + 1);
		const free = order.find((s) => !taken.has(s));
		if (next && free !== undefined) {
			await pick(id);
			await openSlot(free, amps);
		} else {
			await pick(id);
		}
	}

	// ---- Moving the selected breaker: every open slot it fits in becomes a target.
	let moving = $state(false);
	// A tandem half moves on its own and keeps its letter, unless it goes into the other half of a tandem slot.
	const fits = (slot: number, half: Half | null = sel?.half ?? null) =>
		!!sel && !!panel && (half === null || sel.half !== null) && !checkFit({ id: sel.id, slot, poles: sel.poles, half }, panel, placed);
	async function moveTo(slot: number, half: Half | null = sel?.half ?? null) {
		if (!sel) return;
		const id = sel.id;
		moving = false;
		await mutate(() => updateBreaker(id, { slot, half }));
		await tick();
		document.querySelector<HTMLElement>(`[data-breaker="${id}"]`)?.focus();
	}

	// ---- Removing the selected breaker. Its items stay, with no breaker if it was their only one.
	let removeDlg = $state<ReturnType<typeof RemoveBreakerDialog>>();
	const removeQuestion = $derived.by(() => {
		if (!sel || !panel) return '';
		const label = sel.label.trim();
		return `Remove breaker ${slotLabel(sel, panel)}${label ? ` “${label}”` : ''}?`;
	});
	const removeDetail = $derived.by(() => {
		const orphans = selItems.filter((i) => i.breakerIds.length === 1).length;
		if (!orphans) return '';
		const n = plural(selItems.length, 'item');
		return orphans === selItems.length
			? `Its ${n} will be left with no breaker.`
			: `${orphans} of its ${n} will be left with no breaker.`;
	});
	async function removeSelected() {
		if (!sel) return;
		const id = sel.id;
		const i = breakers.findIndex((b) => b.id === id);
		const neighbor = breakers[i + 1] ?? breakers[i - 1];
		await mutate(() => deleteBreaker(id));
		delete drafts[id];
		if (neighbor) {
			await pick(neighbor.id);
		} else {
			const url = new URL(page.url);
			url.searchParams.delete('b');
			await goto(url, { replaceState: true, keepFocus: true, noScroll: true });
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		if (moving) moving = false;
		else if (newSlot !== null) cancelSlot();
	}
	function step(by: number) {
		if (!sel) return;
		const i = breakers.findIndex((b) => b.id === sel.id);
		pick(breakers[(i + by + breakers.length) % breakers.length].id);
	}

	// ---- Header search: label, slot number, or any item name/room on the breaker.
	const q = $derived(query());
	const matches = (b: Breaker) => {
		if (!q) return true;
		const v = view(b);
		if ((v.label || 'unlabeled').toLowerCase().includes(q) || String(b.slot) === q || (panel && slotLabel(b, panel).toLowerCase() === q)) return true;
		return ix.itemsOf(b.id).some((i) => `${i.name} ${ix.roomName(i.roomId)}`.toLowerCase().includes(q));
	};
	const matchCount = $derived(breakers.filter(matches).length);

	// ---- The panel face: each column top to bottom; a 2-pole breaker fills two rows.
	type Cell = FaceCell<Breaker>;
	// Breakers as shown, with unsaved edits (a pole change moves the face live).
	const placed = $derived(breakers.map(view));
	const cover = $derived.by(() => {
		const m = new Map<number, Breaker>();
		if (panel) for (const b of placed) for (const s of occupiedSlots(b, panel)) m.set(s, b);
		return m;
	});
	const rows = $derived(panel ? rowCount(panel) : 0);
	const face = $derived(panel ? faceColumns(panel, placed) : { left: [], right: [] });
	// A 2-pole new breaker shows as one tall selection.
	const column = (cells: Cell[]) => (newSlots.length === 2 ? cells.filter((c) => c.breaker || c.slot !== newSlots[1]) : cells);
	const left = $derived(column(face.left));
	const right = $derived(column(face.right));

	// ---- Handle-tied breakers (a multi-wire circuit) that have been moved apart.
	const tiedApart = $derived.by(() => {
		if (!sel || sel.tieGroup === null || !panel) return null;
		const group = placed.filter((b) => b.tieGroup === sel.tieGroup);
		if (group.length < 2 || tiedTogether(group, panel)) return null;
		return group.filter((b) => b.id !== sel.id).map((b) => slotLabel(b, panel));
	});

	// ---- Power path (DESIGN.md §5.17): Main 200A › 30/32 · 60A › Garage › G6.
	/** The subpanel the selected breaker feeds. */
	const selSub = $derived(sel ? ix.fedPanelOf(sel) : null);
	const selDown = $derived(sel && selSub ? ix.downstream(sel) : null);
	const subBreakers = $derived(selSub ? house.breakers.filter((b) => b.panelId === selSub.id).sort(compareBreakers) : []);
	const path = $derived.by(() => {
		if (!sel || !panel) return [];
		const above = ix.feedersAbove(panel);
		const root = above.length ? ix.panelOf(above[0]) : panel;
		const chips: { t: string; cur?: boolean }[] = [{ t: `${panelShort(root)}${root.mainAmps ? ` ${root.mainAmps}A` : ''}` }];
		for (const f of above) chips.push({ t: `${ix.slotOf(f)} · ${f.amps}A` }, { t: panelShort(ix.fedPanelOf(f)!) });
		chips.push({ t: slotLabel(sel, panel), cur: true });
		if (selSub) chips.push({ t: selSub.name });
		return chips;
	});

	// ---- What the selected breaker powers.
	const selItems = $derived(sel ? ix.itemsOf(sel.id) : []);
	const selNo2 = $derived(sel ? why2(sel.slot, sel.id) : null);

	// ---- Tandem halves (DESIGN.md §5.15): the other half of the selected breaker's slot.
	const selMate = $derived(sel?.half ? (placed.find((b) => b.slot === sel.slot && b.half && b.id !== sel.id) ?? null) : null);
	// ---- Quads (DESIGN.md §5.18): the quad the selected breaker is part of, and what else is in it.
	const selQuad = $derived(sel && panel ? quadTopOf(sel, placed, panel) : null);
	const selPair = $derived(sel && panel ? quadPair(sel, panel) : null);
	const quadBelow = $derived(selQuad !== null && panel ? nextInColumn(selQuad, panel) : null);
	const quadRows = $derived.by(() => {
		if (selQuad === null || quadBelow === null || !panel) return [];
		const keys: [number, Half][] = [
			[selQuad, 'A'],
			[selQuad, 'B'],
			[quadBelow, 'A'],
			[quadBelow, 'B']
		];
		return keys.map(([slot, half]) => ({
			key: `${slot}${half}`,
			b: placed.find((b) => spacesOf(b, panel).some((x) => x.slot === slot && x.half === half)) ?? null
		}));
	});
	const quadMates = $derived([...new Set(quadRows.map((r) => r.b).filter((b): b is Breaker => !!b && b.id !== sel?.id))]);
	/** Why the selected 2-pole breaker can't become a quad, or null if it can. */
	const noQuadWhy = $derived.by(() => {
		if (!sel || !panel) return 'x';
		if (selQuad !== null) return null;
		if (sel.poles !== 2 || sel.half) return 'Only a full-size 2-pole breaker can become a quad.';
		return null;
	});
	async function toQuad() {
		if (!sel || !panel || selQuad !== null || noQuadWhy) return;
		const id = sel.id;
		const below = nextInColumn(sel.slot, panel);
		const inner = await mutate(() => makeQuad(id, below));
		await pick(inner);
	}
	async function toTwoPole() {
		if (!sel) return;
		if (selQuad === null) return edit(selRaw!, { poles: 2 });
		if (quadMates.length) return;
		const id = sel.id;
		await mutate(() => setSpaces(id, undefined).then(() => updateBreaker(id, { half: null })));
	}
	async function swapPairs() {
		if (selQuad === null || quadBelow === null) return;
		const ids = [sel!.id, ...quadMates.map((b) => b.id)];
		const below = quadBelow;
		await mutate(() => swapQuadPairs(ids, below));
	}

	async function toTandem() {
		if (!sel || sel.half || sel.poles !== 1 || selQuad !== null) return;
		const id = sel.id;
		const b = await mutate(() => makeTandem(id));
		await pick(b);
	}
	async function toFull() {
		if (!sel) return;
		if (sel.poles === 2) return edit(selRaw!, { poles: 1 });
		if (!sel.half || selMate) return;
		const id = sel.id;
		await mutate(() => updateBreaker(id, { half: null }));
	}
	const summary = $derived.by(() => {
		if (!selItems.length) return 'No items yet';
		const floors = house.floors.filter((f) => selItems.some((i) => i.floorId === f.id)).map((f) => f.name);
		return [plural(selItems.length, 'item'), floors.join(', ')].filter(Boolean).join(' · ');
	});
	const groups = $derived(
		ITEM_TYPES.map((type) => ({ type, name: ITEM_TYPE_LABELS[type].many, items: selItems.filter((i) => i.type === type) })).filter(
			(g) => g.items.length
		)
	);

	async function addItem() {
		if (!sel) return;
		const id = await mutate(() => createItem({ name: 'New item', floorId: house.floors[0]?.id ?? null }, [sel.id]));
		goto(resolve('/items') + `?item=${id}`);
	}
</script>

<svelte:window {onkeydown} />

{#if !panel}
	<main class="empty-app">
		<h1>No panel yet</h1>
		<p>Setting up a panel from scratch isn't designed yet. Load the example house from Settings to look around.</p>
		<a class="btn" href={resolve('/settings') + '#data'}>Open Settings</a>
	</main>
{:else if viewport.phone}
	<PhoneShell title={panel.name} sub="{panel.mainAmps ? `${panel.mainAmps}A · ` : ''}{spacesUsed(breakers, panel)} of {panel.slotCount} spaces">
		{#if phoneEdit && sel && !access.guest}
			<div class="pedit">
				<div class="pback">
					<a class="ibtn" href={resolve('/panel') + `?b=${sel.id}`} aria-label="Back to panel"><Icon name="prev" /></a>
				</div>
				{@render detail(panel)}
			</div>
		{:else}
			<PhonePanel {ix} {panel} breakers={placed} selected={phoneSel} showLegs={house.settings.showLegs} {matches} onpick={(b) => pick(b.id)} onclose={closeSheet} />
		{/if}
	</PhoneShell>
	<RemoveBreakerDialog bind:this={removeDlg} question={removeQuestion} detail={removeDetail} onremove={removeSelected} />
{:else}
	<main>
		<section class="panel" aria-label="Breaker panel">
			{#if tree.length > 1}
				<div class="ptabs" role="group" aria-label="Panel">
					{#each tree as t (t.panel.id)}
						{@const a = ampsOf(t.panel)}
						<a
							class="ptab"
							class:is-on={t.panel.id === panel.id}
							href={panelHref(t.panel)}
							aria-current={t.panel.id === panel.id ? 'page' : undefined}
						>
							{#if t.depth}<span class="br"><Icon name="branch" size={14} /></span>{/if}
							<span class="pt">
								<span class="pn">{t.panel.name}</span>
								<span class="mono pm"
									>{a ? `${a}A · ` : ''}{spacesUsed(
										house.breakers.filter((b) => b.panelId === t.panel.id),
										t.panel
									)}/{t.panel.slotCount} spaces</span
								>
							</span>
						</a>
					{/each}
					{#if !access.guest}<button type="button" class="btn addsub" aria-pressed={adding} onclick={openAdd}
						><Icon name="plus" size={14} stroke={2.2} />Subpanel</button
					>{/if}
				</div>
			{/if}
			<div class="top">
				<div class="title">
					<h1>{panel.name}</h1>
					<span class="mono meta">
						{#if feeder}
							Fed by {panelShort(ix.panelOf(feeder))} {ix.slotOf(feeder)} · {ampsOf(panel)}A · {spacesUsed(breakers, panel)} of {panel.slotCount}
							spaces{panel.location ? ` · ${panel.location}` : ''}
						{:else}
							{panel.mainAmps ? `${panel.mainAmps}A main · ` : ''}{spacesUsed(breakers, panel)} of {panel.slotCount} spaces · {plural(
								breakers.length,
								'breaker'
							)}{subsHere.length ? ` · ${plural(subsHere.length, 'subpanel')}` : ''}
						{/if}
					</span>
				</div>
				{#if feeder}
					<a class="btn fedby" href={resolve('/panel') + `?p=${feeder.panelId}&b=${feeder.id}`}
						><Icon name="arrowup" size={14} stroke={2.2} />Fed by {panelShort(ix.panelOf(feeder))} · {ix.slotOf(feeder)}</a
					>
				{/if}
				{#if breakers.length}
					<div class="legend">
						<span><span class="tag">GF</span>GFCI</span>
						<span><span class="tag">AF</span>AFCI</span>
						<span><span class="tag">DF</span>Dual function</span>
						{#if breakers.some((b) => b.half)}
							<span><span class="tdk" aria-hidden="true"><span></span><span></span></span>Tandem (A/B)</span>
						{/if}
						{#if tandemText(panel)}<span class="mono">Tandem / quad slots {tandemText(panel)}</span>{/if}
						{#if !access.guest}<a class="btn trace" href={resolve('/trace')}><Icon name="bolt" size={14} />Trace</a>{/if}
						<a class="btn trace" href={resolve('/print') + `?p=${panel.id}`}><Icon name="print" size={14} />Print</a>
					</div>
				{/if}
			</div>

			{#if q}
				<div class="results inv" role="status">
					<span>{matchCount} of {breakers.length} breakers match “{search.q.trim()}”</span>
					<button type="button" class="chipbtn" onclick={() => (search.q = '')}>Clear</button>
				</div>
			{/if}

			{#if moving && sel}
				<div class="results inv" role="status">
					<span>Moving breaker {slotLabel(sel, panel)} · click an open slot · Esc to cancel</span>
					<button type="button" class="chipbtn" onclick={() => (moving = false)}>Cancel</button>
				</div>
			{/if}

			<div class="enclosure">
				<div class="main-bk">
					<div class="main-hdl"><span></span><span></span></div>
					<div class="main-txt">
						<span class="mono">{feeder && panel.mainAmps === null ? 'MAIN LUGS' : 'MAIN'}</span>
						<strong>{ampsOf(panel) ? `${ampsOf(panel)}A` : '—'}</strong>
					</div>
				</div>

				<!-- One CSS grid row per panel row: left · leg strip · right. A 2-pole breaker spans two
				     rows; a row holding a tandem grows, and its neighbour and leg label grow with it. -->
				<div class="face">
					{#each { length: rows }, r (r)}
						<div class="leg mono" style:grid-row={r + 1} aria-hidden="true">{house.settings.showLegs ? legOfRow(r + 1) : ''}</div>
					{/each}
					{#snippet col(cells: Cell[], side: 'l' | 'r')}
						{#each cells as cell (cell.slot)}
							{@const at = position(cell.slot, panel)}
							{#if cell.quad}
								{@const lay = quadLayout(cell.quad.map((b) => (b ? view(b) : null)), cell.slot, panel)}
								{@const below = nextInColumn(cell.slot, panel)}
								<div
									class="quad"
									class:r={side === 'r'}
									class:bad={!tandemOk(cell.slot, panel)}
									style:grid-row="{at.row} / span 2"
									style:grid-column={side === 'l' ? 1 : 3}
									role="group"
									aria-label="Quad breaker in slots {spaceLabel({ slot: cell.slot, half: null }, panel)} and {spaceLabel(
										{ slot: below, half: null },
										panel
									)}"
								>
									{#each lay.segs as g (g.key)}
										{#if g.b}
											{@const b = g.b}
											<button
												type="button"
												class="th"
												class:r={side === 'r'}
												class:cont={!g.first}
												class:is-sel={newSlot === null && b.id === sel?.id}
												class:is-dim={!matches(b) || moving}
												class:is-unl={!b.label.trim()}
												style:grid-row="{g.row} / span {g.span}"
												aria-label="Breaker {slotLabel(b, panel)}, {b.label.trim() || 'unlabeled'}, {b.amps} amp{g.first ? '' : ', lower handle'}"
												data-breaker={g.first ? b.id : undefined}
												onclick={() => pick(b.id)}
											>
												<span class="num">{g.first ? slotLabel(b, panel) : '↳'}</span>
												<span class="lbl">{g.first ? b.label.trim() || 'Unlabeled' : `same breaker · ${slotLabel(b, panel)}`}</span>
												<span class="amp">{g.first ? b.amps : ''}</span>
												<span class="hdl"></span>
											</button>
										{:else}
											<div class="th th-open" class:r={side === 'r'} style:grid-row={g.row}>
												<span class="num">{(panel.shortCode ?? '') + g.key}</span>
												<span class="lbl">Open</span>
											</div>
										{/if}
									{/each}
									{#each lay.ties as t (t.b.id)}
										<span
											class="tie"
											class:o={t.pair === 'outer'}
											class:i={t.pair !== 'outer'}
											class:is-sel={newSlot === null && t.b.id === sel?.id}
											style:top="{t.lo * 25 + 12}%"
											style:bottom="{(3 - t.hi) * 25 + 12}%"
										></span>
									{/each}
								</div>
							{:else if cell.halves}
								<div
									class="tdm"
									class:bad={!tandemOk(cell.slot, panel)}
									style:grid-row={at.row}
									style:grid-column={side === 'l' ? 1 : 3}
									role="group"
									aria-label="Tandem slot {cell.slot}"
								>
									{#each cell.halves as h, i (i)}
										{#if h}
											{@const b = view(h)}
											<button
												type="button"
												class="th"
												class:r={side === 'r'}
												class:is-sel={newSlot === null && b.id === sel?.id}
												class:is-moving={moving && b.id === sel?.id}
												class:is-dim={!matches(h) || (moving && b.id !== sel?.id)}
												class:is-unl={!b.label.trim()}
												aria-pressed={newSlot === null && b.id === sel?.id}
												aria-label="Breaker {slotLabel(b, panel)}, {b.label.trim() || 'unlabeled'}, {b.amps} amp"
												data-breaker={b.id}
												onclick={() => pick(b.id)}
											>
												<span class="num">{slotLabel(b, panel)}</span>
												<span class="lbl">{b.label.trim() || 'Unlabeled'}</span>
												<span class="amp">{b.amps}</span>
												<span class="hdl"></span>
											</button>
										{:else if access.guest}
											<div class="th th-open" class:r={side === 'r'}>
												<span class="num">{spaceLabel({ slot: cell.slot, half: i === 0 ? 'A' : 'B' }, panel)}</span>
												<span class="lbl">Open</span>
											</div>
										{:else}
											{@const half = i === 0 ? ('A' as const) : ('B' as const)}
											{@const ok = moving && fits(cell.slot, half)}
											<button
												type="button"
												class="th th-open"
												class:r={side === 'r'}
												class:is-target={ok}
												disabled={moving ? !ok : true}
												aria-label={ok ? `Move here: slot ${cell.slot}${half}` : `Slot ${cell.slot}${half}, open`}
												onclick={() => moveTo(cell.slot, half)}
											>
												<span class="num">{spaceLabel({ slot: cell.slot, half }, panel)}</span>
												<span class="lbl">{ok ? 'Move here' : 'Open'}</span>
											</button>
										{/if}
									{/each}
								</div>
							{:else if !cell.breaker && moving}
								{@const ok = fits(cell.slot)}
								<button
									type="button"
									class="bk bk-1 bk-open"
									class:bk-r={side === 'r'}
									class:is-target={ok}
									class:is-dim={!ok}
									style:grid-row={at.row}
									style:grid-column={side === 'l' ? 1 : 3}
									data-slot={cell.slot}
									disabled={!ok}
									aria-label="Move here: slot {cell.slot}"
									onclick={() => moveTo(cell.slot)}
								>
									<span class="num">{spaceLabel({ slot: cell.slot, half: null }, panel)}</span>
									<span class="lbl">{ok ? 'Move here' : 'Open'}</span>
								</button>
							{:else if !cell.breaker && access.guest}
								<div class="bk bk-1 bk-open" class:bk-r={side === 'r'} style:grid-row={at.row} style:grid-column={side === 'l' ? 1 : 3}>
									<span class="num">{spaceLabel({ slot: cell.slot, half: null }, panel)}</span>
									<span class="lbl"><span class="opn">Open</span></span>
								</div>
							{:else if !cell.breaker}
								{@const isNew = cell.slot === newSlot}
								{@const two = isNew && newSlots.length === 2}
								<button
									type="button"
									class="bk bk-{two ? 2 : 1} bk-open"
									class:bk-r={side === 'r'}
									class:is-sel={isNew}
									style:grid-row="{at.row} / span {two ? 2 : 1}"
									style:grid-column={side === 'l' ? 1 : 3}
									data-slot={cell.slot}
									aria-pressed={isNew}
									aria-label="Open slot {two ? newSlots.join(' and ') : cell.slot}, add a breaker"
									onclick={() => (isNew ? formEl?.focus() : openSlot(cell.slot))}
								>
									<span class="num">{spaceLabel({ slot: cell.slot, half: null }, panel)}{two ? `/${newSlots[1]}` : ''}</span>
									<span class="lbl"><span class="opn">Open</span><span class="add">{isNew ? 'New breaker…' : '+ Add breaker'}</span></span>
								</button>
							{:else}
								{@const b = view(cell.breaker)}
								{@const sub = ix.fedPanelOf(b)}
								{@const tag = sub ? 'SUB' : PROTECTION_TAGS[b.kind]}
								{@const tie = tiedBelow(b, placed, panel)}
								<button
									type="button"
									class="bk bk-{b.poles === 2 ? 2 : 1}"
									class:tie-down={!!tie}
									style:--tie-rows={tie ? b.poles / 2 + tie.poles / 2 : undefined}
									class:bk-r={side === 'r'}
									class:is-sel={newSlot === null && b.id === sel?.id}
									class:is-moving={moving && b.id === sel?.id}
									class:is-dim={!matches(cell.breaker) || (moving && b.id !== sel?.id)}
									class:is-unl={!b.label.trim() && !sub}
									class:feed={!!sub}
									style:grid-row="{at.row} / span {b.poles === 2 ? 2 : 1}"
									style:grid-column={side === 'l' ? 1 : 3}
									aria-pressed={newSlot === null && b.id === sel?.id}
									aria-label="Breaker {slotLabel(b, panel)}, {b.label.trim() || 'unlabeled'}, {b.amps} amp"
									data-breaker={b.id}
									onclick={() => pick(b.id)}
								>
									<span class="num">{slotLabel(b, panel)}</span>
									<span class="lbl">{sub ? `→ ${sub.name}` : b.label.trim() || 'Unlabeled'}</span>
									{#if tag}<span class="tag">{tag}</span>{/if}
									<span class="amp">{b.amps}</span>
									<span class="hdl"><span class="tog"></span><span class="tog tog2"></span></span>
								</button>
							{/if}
						{/each}
					{/snippet}
					{@render col(left, 'l')}
					{@render col(right, 'r')}
				</div>
			</div>
		</section>

		{@render detail(panel)}
	</main>
	<RemoveBreakerDialog bind:this={removeDlg} question={removeQuestion} detail={removeDetail} onremove={removeSelected} />
	{#if shutoffOpen && sel}
		<ShutoffDrawer {ix} want={{ room: null, breaker: sel.id, item: null }} onclose={closeShutoff} />
	{/if}
{/if}

{#snippet detail(panel: Panel)}
	<section class="detail" aria-label={adding ? 'Add subpanel' : newSlot !== null ? 'New breaker' : sel ? 'Breaker details' : 'Getting started'}>
		{#if adding}
			<div class="addpane"><SubpanelForm bind:this={subForm} {ix} oncancel={cancelAdd} onadd={addSub} /></div>
		{:else if newSlot !== null}
			<NewBreakerForm
				bind:this={formEl}
				bind:form
				slot={newSlot}
				{panel}
				{no2Why}
				{directoryHref}
				oncancel={cancelSlot}
				onadd={addBreaker}
			/>
		{:else if !sel && access.guest}
			<div></div>
		{:else if !sel}
			<PanelEmpty slotCount={panel.slotCount} {directoryHref} />
		{:else}
			<div class="dhead">
				<div class="row">
					<span class="mono slot">{feeder ? `${panelShort(panel)} · ` : ''}{selQuad !== null && !selPair
								? `Slot ${spaceLabel({ slot: sel.slot, half: sel.half ?? null }, panel)} · Leg ${legOf(sel.slot, panel)} · Quad`
								: slotText(sel, panel)}{selSub ? ' · Feeder' : ''}</span>
					<div class="nav">
						{#if !access.guest}<button
								type="button"
								class="btn"
								aria-pressed={moving}
								disabled={selQuad !== null}
								title={selQuad !== null ? 'Part of a quad: move or remove the whole quad’s breakers instead.' : undefined}
								onclick={() => (moving = !moving)}>Move…</button
							>{/if}
						<button type="button" class="ibtn" aria-label="Previous breaker" onclick={() => step(-1)}><Icon name="prev" /></button>
						<button type="button" class="ibtn" aria-label="Next breaker" onclick={() => step(1)}><Icon name="next" /></button>
					</div>
				</div>
				{#if access.guest}
					<h2 class="ttl ro">{sel.label.trim() || 'Unlabeled'}</h2>
				{:else}
				<label for="f-label" class="sr">Breaker label</label>
				<input
					id="f-label"
					class="ttl"
					type="text"
					value={sel.label}
					oninput={(e) => edit(selRaw!, { label: e.currentTarget.value })}
					placeholder="Unlabeled — what does it power?"
				/>
				{/if}
				{#if house.panels.length > 1}
				<div class="path" aria-label="Power path">
					<span class="ov">Power path</span>
					{#each path as c, i (i)}
						{#if i}<Icon name="next" size={14} stroke={2.2} />{/if}
						<span class="pchip" class:cur={c.cur}>{c.t}</span>
					{/each}
				</div>
				{/if}
				{#if access.guest}
					<div class="grid4">
						<div class="fld"><span class="k">Amperage</span><span class="v">{sel.amps} A</span></div>
						<div class="fld"><span class="k">Protection</span><span class="v">{PROTECTION_LABELS[sel.kind]}</span></div>
						<div class="fld">
							<span class="k">Size</span>
							<span class="v"
								>{selQuad !== null ? 'Quad' : sel.half ? 'Tandem' : sel.poles === 2 ? '2-pole' : '1-pole'}</span
							>
						</div>
						<div class="fld"><span class="k">Min. wire (copper)</span><span class="v">{MIN_WIRE[sel.amps] ?? '—'}</span></div>
					</div>
				{:else}
				<div class="grid4">
					<div class="fld">
						<label for="f-amp">Amperage</label>
						<select
							id="f-amp"
							class="inp"
							value={sel.amps}
							onchange={(e) => edit(selRaw!, { amps: Number(e.currentTarget.value) })}
						>
							{#each AMPS.includes(sel.amps) ? AMPS : [...AMPS, sel.amps].sort((a, b) => a - b) as a (a)}
								<option value={a}>{a} A</option>
							{/each}
						</select>
					</div>
					<div class="fld">
						<label for="f-type">Protection</label>
						<select
							id="f-type"
							class="inp"
							value={sel.kind}
							onchange={(e) => edit(selRaw!, { kind: e.currentTarget.value as Protection })}
						>
							{#each PROTECTIONS as p (p)}
								<option value={p}>{PROTECTION_LABELS[p]}</option>
							{/each}
						</select>
					</div>
					<div class="fld size">
						<span class="k" id="f-sz">Size</span>
						<div class="seg" role="group" aria-labelledby="f-sz">
							<button
								type="button"
								class="sb"
								class:is-on={sel.poles === 1 && !sel.half}
								aria-pressed={sel.poles === 1 && !sel.half}
								disabled={!!selMate || selQuad !== null}
								aria-describedby={selMate ? 'f-nofull' : undefined}
								onclick={toFull}>1-pole</button
							>
							<button
								type="button"
								class="sb"
								class:is-on={sel.poles === 2 && selQuad === null}
								aria-pressed={sel.poles === 2 && selQuad === null}
								disabled={selQuad !== null ? quadMates.length > 0 || sel.poles !== 2 : !!selNo2 || !!sel.half}
								aria-describedby={selQuad !== null && quadMates.length ? 'f-noq' : selNo2 && !sel.half ? 'f-no2' : undefined}
								onclick={toTwoPole}>2-pole</button
							>
							<button
								type="button"
								class="sb"
								class:is-on={!!sel.half && selQuad === null}
								aria-pressed={!!sel.half && selQuad === null}
								disabled={sel.poles === 2 || selQuad !== null}
								onclick={toTandem}>Tandem</button
							>
							<button
								type="button"
								class="sb"
								class:is-on={selQuad !== null}
								aria-pressed={selQuad !== null}
								disabled={!!noQuadWhy}
								title={noQuadWhy ?? undefined}
								onclick={toQuad}>Quad</button
							>
						</div>
					</div>
					<div class="fld">
						<span class="k">Min. wire (copper)</span>
						<span class="v">{MIN_WIRE[sel.amps] ?? '—'}</span>
					</div>
				</div>
				{/if}
				{#if selNo2 && !sel.half && !access.guest}<span class="why" id="f-no2">{selNo2}</span>{/if}
				{#if tiedApart}
					<div class="warnbox" role="note">
						<strong>Handle-tied with {tiedApart.join(' + ')}, but not next to {tiedApart.length > 1 ? 'them' : 'it'}</strong>
						<span>They share a neutral (multi-wire circuit), so they need to sit side by side with their handles tied.</span>
					</div>
				{/if}
			</div>

			<div class="dbody">
				{#if selQuad !== null}
					<div class="qcard">
						<div class="qmini" aria-hidden="true">
							{#each quadRows as r (r.key)}
								<span class="qh" class:on={r.b?.id === sel.id}
									>{(panel.shortCode ?? '') + r.key}{r.b ? ` · ${spaceLabel(spacesOf(r.b, panel)[0], panel)}` : ''}</span
								>
							{/each}
						</div>
						<div class="qt">
							<strong
								>{selPair
									? `The ${selPair} pair of a quad in slots ${selQuad}–${quadBelow}`
									: `Half of a quad in slots ${selQuad}–${quadBelow}`}</strong
							>
							{#if quadMates.length}
								<span
									>Shares the quad with {quadMates.map((m) => `${slotLabel(m, panel)} ${m.label.trim() || 'Unlabeled'}`).join(', ')}. Both
									slots are one physical breaker; replacing it affects all of them.</span
								>
							{/if}
							<div class="qacts">
								{#each quadMates as m (m.id)}
									<button type="button" class="btn" onclick={() => pick(m.id)}>Select {slotLabel(m, panel)}</button>
								{/each}
								{#if !access.guest}<button type="button" class="btn" onclick={swapPairs}>Swap outer and inner</button>{/if}
							</div>
						</div>
					</div>
					{#if !access.guest}<span class="why"
						>Brands differ on which handles pair up. If yours ties the top-and-bottom handles, that’s the outer pair; the middle two are
						the inner pair. Swap them if the panel is labelled the other way.</span
					>{/if}
					{#if quadMates.length && sel.poles === 2 && !access.guest}
						<span class="why" id="f-noq"
							>To go back to one full-size 2-pole breaker, remove {quadMates.map((m) => slotLabel(m, panel)).join(' and ')} first.</span
						>
					{/if}
					{#if !tandemOk(selQuad, panel) || !tandemOk(quadBelow ?? selQuad, panel)}
						<div class="badt" role="alert">
							<strong>Slots {selQuad}–{quadBelow} aren’t rated for quads.</strong> Your panel label allows them in slots {tandemText(panel)}
							only. It may still be installed this way — worth checking with an electrician.
						</div>
					{/if}
				{:else if sel.half}
					{#if selMate}
						{@const mate = selMate}
						<div class="mate">
							<span class="mhh" aria-hidden="true"><span class:on={sel.half === 'A'}></span><span class:on={sel.half === 'B'}></span></span>
							<span class="mt">
								<strong>Shares slot {sel.slot} with {slotLabel(mate, panel)}</strong>
								<span>{mate.label.trim() || 'Unlabeled'} · both halves are on leg {legOf(sel.slot, panel)}</span>
							</span>
							<button type="button" class="btn" onclick={() => pick(mate.id)}>Select {slotLabel(mate, panel)}</button>
						</div>
					{/if}
					{#if !tandemOk(sel.slot, panel)}
						<div class="badt" role="alert">
							<strong>Slot {sel.slot} isn’t rated for tandems.</strong> Your panel label allows them in slots {tandemText(panel)} only. It
							may still be installed this way — worth checking with an electrician.
						</div>
					{/if}
					{#if selMate && !access.guest}
						<span class="why" id="f-nofull">To go back to one full-size breaker, remove or move {slotLabel(selMate, panel)} first.</span>
					{/if}
				{/if}
				{#if selSub && selDown}
					{@const crit = selDown.items.filter((i) => i.critical).map((i) => i.name)}
					<div class="feedcard">
						<div class="fh">
							<span class="tag">SUBPANEL</span>
							<span class="ft">Feeds the {selSub.name}</span>
							<a class="btn" href={panelHref(selSub)}>Open {panelShort(selSub)} →</a>
						</div>
						<span class="fm"
							>{sel.amps}A {sel.poles === 2 ? '2-pole ' : ''}feeder · {plural(subBreakers.length, 'breaker')} · {plural(
								new Set(subBreakers.flatMap((b) => ix.itemsOf(b.id).map((i) => i.id))).size,
								'item'
							)}{selSub.location ? ` · ${selSub.location}` : ''}</span
						>
						{#if subBreakers.length}
							<div class="fgrid">
								{#each subBreakers as g (g.id)}
									<a class="frow" href={resolve('/panel') + `?p=${selSub.id}&b=${g.id}`}>
										<span class="bnum">{ix.slotOf(g)}</span>
										<span class="fl">{ix.fedPanelOf(g) ? `→ ${ix.fedPanelOf(g)?.name}` : ix.labelOf(g)}</span>
										<span class="mono fc">{ix.itemsOf(g.id).length}</span>
									</a>
								{/each}
							</div>
						{/if}
					</div>
					<div class="kill" role="note">
						<strong>Turning this off kills the whole {selSub.name}</strong> — {plural(selDown.breakers.length, 'breaker')} and {plural(
							selDown.items.length,
							'item'
						)}{crit.length ? `, including ${crit.join(', ')}` : ''}.
					</div>
				{:else}
				<div class="powers">
					<div class="ph">
						<h2>Powers</h2>
						<span>{summary}</span>
					</div>
					{#if !access.guest}<button type="button" class="btn" onclick={addItem}><Icon name="plus" size={16} stroke={2.2} />Add item</button>{/if}
				</div>

				{#each groups as g (g.type)}
					<div class="group">
						<div class="gname">{g.name} · {g.items.length}</div>
						<div class="grid2">
							{#each g.items as i (i.id)}
								<div class="irow">
									<span class="ico"><Icon name={i.type} stroke={1.9} /></span>
									<span class="itxt"><span class="in">{i.name}</span><span class="iw">{ix.whereOf(i)}</span></span>
									{#if i.breakerIds.length > 1}<span class="plus" title="Also on {ix.plusOf(i, sel.id).slice(1)}">{ix.plusOf(i, sel.id)}</span>{/if}
									{#if i.x !== null}
										<a class="loc" href={resolve('/map') + `?item=${i.id}`}>Locate</a>
									{:else if !access.guest}
										<a class="loc" href={resolve('/items') + `?item=${i.id}`}>Place</a>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<div class="none">
						<span class="nt">Nothing mapped to this breaker yet</span>
						{#if !access.guest}
						<span class="nd">Flip it off, walk the house, and add whatever went dark. Anything you add here shows up on the map too.</span>
						<div class="nb">
							<button type="button" class="btn btn-pri" onclick={addItem}>Add the first item</button>
							<a class="btn" href={resolve('/trace') + `?b=${sel.id}`}>Trace it</a>
						</div>
						{/if}
					</div>
				{/each}
				{#if feeder}
					<span class="up">This breaker is also dead whenever {panelShort(ix.panelOf(feeder))} {ix.slotOf(feeder)} is off.</span>
				{/if}
				{/if}

				{#if access.guest}
					{#if sel.notes?.trim()}
						<div class="fld"><span class="k">Notes</span><p class="note">{sel.notes}</p></div>
					{/if}
				{:else}
				<div class="fld">
					<label for="f-notes">Notes</label>
					<textarea
						id="f-notes"
						class="inp"
						rows="3"
						placeholder="Anything worth knowing when this one trips"
						value={sel.notes ?? ''}
						oninput={(e) => edit(selRaw!, { notes: e.currentTarget.value })}
					></textarea>
				</div>
				{/if}
			</div>

			<div class="dfoot" class:solo={access.guest}>
				{#if !access.guest}
				<div class="fleft">
					<button
						type="button"
						class="rm"
						disabled={!!selSub}
						title={selSub ? `It feeds the ${selSub.name}. Delete the subpanel in Settings first.` : undefined}
						onclick={() => removeDlg?.open()}>Remove breaker</button
					>
					<span class="status" role="status">
						<span class="dot" class:is-dirty={dirty}></span>
						{dirty ? 'Unsaved changes' : savedJustNow ? 'Saved just now' : 'All changes saved'}
					</span>
				</div>
				{/if}
				<div class="acts">
					<a class="btn" href={resolve('/map') + `?circuit=${sel.id}`}><Icon name="map" size={16} />Show on map</a>
					<a class="btn" href={resolve('/panel') + `?b=${sel.id}&shutoff=1`}><Icon name="power" size={16} />Shut off</a>
					{#if !access.guest}<button type="button" class="btn btn-pri" onclick={save} disabled={!dirty}>Save changes</button>{/if}
				</div>
			</div>
		{/if}
	</section>
{/snippet}

<style>
	main {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		gap: 32px;
		padding: 28px 32px;
	}
	.empty-app {
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
	}
	.empty-app h1 {
		font-size: 28px;
		font-weight: 800;
		font-stretch: 112%;
	}
	.empty-app p {
		color: var(--muted);
		font-size: 14px;
	}

	/* ---- Left: the panel */
	.panel {
		width: 640px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-height: 0;
		overflow: auto;
		/* Room for the selected breaker's ring and focus outlines. */
		padding: 3px;
		margin: -3px;
	}
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px 16px;
	}
	.title {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	h1 {
		font-size: 28px;
		font-weight: 800;
		font-stretch: 112%;
		letter-spacing: -0.02em;
	}
	.meta {
		font-size: 12px;
		color: var(--muted);
	}
	.legend {
		display: flex;
		gap: 14px;
		align-items: center;
		font-size: 12px;
		color: var(--soft);
	}
	.legend > span {
		display: flex;
		gap: 6px;
		align-items: center;
		white-space: nowrap;
	}
	.tdk {
		width: 18px;
		height: 14px;
		border: 1px solid var(--breaker-bd);
		border-radius: 2px;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 1px;
	}
	.tdk span {
		flex: 1;
		background: var(--handle);
		border-radius: 1px;
	}
	.trace {
		height: 36px;
		padding: 0 12px;
		font-size: 13px;
	}
	.results {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 6px 6px 14px;
		border-radius: var(--r-lg);
		font-size: 13px;
	}
	.results .chipbtn {
		height: 32px;
	}
	.enclosure {
		background: var(--enclosure);
		border: 1px solid var(--enclosure-bd);
		border-radius: var(--r-2xl);
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		box-shadow: inset 0 1px 0 var(--enclosure-hi);
	}
	.main-bk {
		align-self: center;
		display: flex;
		align-items: center;
		gap: 14px;
		background: var(--raised);
		border: 1px solid var(--enclosure-bd);
		border-radius: var(--r-md);
		padding: 8px 18px 8px 8px;
	}
	.main-hdl {
		width: 64px;
		height: 44px;
		background: var(--handle);
		border-radius: var(--r-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
	}
	.main-hdl span {
		width: 18px;
		height: 26px;
		background: var(--toggle);
		border-radius: 2px;
	}
	.main-txt {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.main-txt .mono {
		font-size: 11px;
		color: var(--muted);
		letter-spacing: 0.08em;
	}
	.main-txt strong {
		font-size: 20px;
		font-weight: 800;
		font-stretch: 112%;
	}
	.face {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr);
		grid-auto-rows: minmax(var(--breaker-h), auto);
		column-gap: 8px;
		row-gap: var(--breaker-gap);
	}
	.leg {
		grid-column: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 9px;
		font-weight: 600;
		color: var(--bus-ink);
		background: var(--bus);
	}

	/* ---- Tandem slot: two stacked half-height breakers (DESIGN.md §5.15). */
	.tdm {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--breaker-bd);
		border-radius: var(--r-sm);
		background: var(--enclosure-hi);
		min-height: 46px;
	}
	.tdm.bad {
		border-color: var(--warn);
		border-style: dashed;
	}
	.th {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1 1 0;
		min-height: 20px;
		padding: 0 4px 0 6px;
		border: 1px solid var(--breaker-bd);
		border-radius: 3px;
		background: var(--raised);
		font: inherit;
		color: var(--ink);
		cursor: pointer;
		text-align: left;
	}
	.th.r {
		flex-direction: row-reverse;
		padding: 0 6px 0 4px;
		text-align: right;
	}
	.th .num {
		font-size: 10px;
		width: 30px;
	}
	.th.r .num {
		text-align: right;
	}
	.th .lbl {
		font-stretch: 78%;
		font-size: 12px;
	}
	.th .amp {
		font-size: 11px;
		width: 20px;
	}
	.th .hdl {
		width: 30px;
		height: 12px;
		border-radius: 2px;
		align-items: center;
		justify-content: center;
	}
	.th .hdl::after {
		content: '';
		width: 10px;
		height: 5px;
		border-radius: 1px;
		background: var(--toggle);
	}
	.th:hover {
		border-color: var(--ink);
	}
	.th.is-sel {
		background: var(--amber);
		color: var(--on-amber);
		border-color: var(--on-amber);
		box-shadow: 0 0 0 2px var(--fed-bd);
	}
	.th.is-sel .num,
	.th.is-sel.is-unl .lbl {
		color: var(--on-amber);
	}
	.th.is-unl .lbl {
		color: var(--warn);
		font-style: italic;
	}
	.th.is-dim {
		opacity: 0.3;
	}
	.th.is-moving {
		box-shadow: none;
		outline: 2px dashed var(--amber);
		outline-offset: 1px;
	}
	.th-open {
		border-style: dashed;
		border-color: var(--enclosure-bd);
		background: transparent;
		cursor: default;
	}
	.th-open .lbl {
		font-style: italic;
		color: var(--muted);
	}
	.th-open.is-target {
		border-color: var(--ink);
		cursor: pointer;
	}
	.th-open.is-target .lbl {
		font-style: normal;
		font-weight: 600;
		color: var(--ink);
	}

	/* ---- Breaker */
	.bk {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 0 6px 0 8px;
		border: 1px solid var(--breaker-bd);
		border-radius: var(--r-sm);
		background: var(--raised);
		font: inherit;
		color: var(--ink);
		cursor: pointer;
		text-align: left;
		transition:
			opacity 0.2s,
			background 0.15s;
	}
	.bk-1 {
		min-height: var(--breaker-h);
	}
	.bk-2 {
		min-height: calc(var(--breaker-h) * 2 + var(--breaker-gap));
	}
	.bk-r {
		flex-direction: row-reverse;
		padding: 0 8px 0 6px;
		text-align: right;
	}
	.num {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted);
		width: 34px;
		flex-shrink: 0;
	}
	.bk-r .num {
		text-align: right;
	}
	.lbl {
		flex: 1 1 auto;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-stretch: 80%;
		font-size: 14px;
		font-weight: 500;
	}
	.amp {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		width: 22px;
		text-align: center;
		flex-shrink: 0;
	}
	.hdl {
		width: 30px;
		height: 22px;
		background: var(--handle);
		border-radius: var(--r-xs);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: space-around;
		flex-shrink: 0;
		position: relative;
	}
	.bk-2 .hdl {
		height: 54px;
	}
	/* Handle-tied to the breaker below (a multi-wire circuit): a tie bar joins the handles. */
	.bk.tie-down {
		position: relative;
		z-index: 1;
	}
	.bk.tie-down .hdl::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 3px;
		margin-left: -1.5px;
		height: calc((var(--breaker-h) + var(--breaker-gap)) * var(--tie-rows));
		background: var(--tie);
		border-radius: 2px;
		z-index: 2;
	}
	.bk-2 .hdl::after {
		content: '';
		position: absolute;
		left: 4px;
		right: 4px;
		top: 50%;
		height: 3px;
		margin-top: -1.5px;
		background: var(--tie);
		border-radius: 1px;
	}
	.tog {
		width: 14px;
		height: 8px;
		background: var(--toggle);
		border-radius: 2px;
	}
	.bk-1 .tog2 {
		display: none;
	}
	.bk:hover {
		border-color: var(--btn-bd-h);
	}
	.bk.is-sel {
		background: var(--amber);
		border-color: var(--on-amber);
		box-shadow: 0 0 0 2px var(--fed-bd);
	}
	.bk.is-sel,
	.bk.is-sel .num,
	.bk.is-sel .lbl {
		color: var(--on-amber);
	}
	.bk.is-dim {
		opacity: 0.3;
	}
	.bk.is-moving {
		box-shadow: none;
		outline: 2px dashed var(--amber);
		outline-offset: 2px;
	}
	.bk-open:disabled {
		cursor: default;
	}
	.bk-open.is-target .lbl {
		font-style: normal;
		font-weight: 600;
		color: var(--ink);
	}
	.bk-open.is-target {
		border-color: var(--ink);
	}
	.bk.is-unl .lbl {
		color: var(--warn);
		font-style: italic;
	}
	.bk.is-sel.is-unl .lbl {
		color: var(--on-amber);
	}
	/* Open slot: dashed; hover/focus offers to add a breaker. */
	.bk-open {
		border: 1px dashed var(--enclosure-bd);
		background: transparent;
	}
	.bk-open .lbl {
		font-style: italic;
		color: var(--muted);
	}
	.bk-open .add {
		display: none;
	}
	.bk-open:hover,
	.bk-open:focus-visible {
		border-style: solid;
		border-color: var(--ink);
		background: var(--raised);
	}
	.bk-open:hover .opn,
	.bk-open:focus-visible .opn,
	.bk-open.is-sel .opn {
		display: none;
	}
	.bk-open:hover .add,
	.bk-open:focus-visible .add {
		display: inline;
		font-style: normal;
		color: var(--ink);
		font-weight: 600;
	}
	.bk-open.is-sel {
		border-style: solid;
		border-color: var(--on-amber);
		background: var(--amber);
	}
	.bk-open.is-sel .lbl,
	.bk-open.is-sel .add {
		display: inline;
		color: var(--on-amber);
		font-style: normal;
		font-weight: 700;
	}

	/* ---- Right: breaker detail */
	/* Phone: the details on their own screen, under a back button. */
	.pedit {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: 12px;
		gap: 10px;
	}
	.pback {
		display: flex;
		flex-shrink: 0;
	}
	.pedit .detail :global(.grid4) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	/* Moving happens on the panel face, which isn't on this screen. */
	.pedit .dhead .nav {
		display: none;
	}
	.pedit .grid2 {
		grid-template-columns: minmax(0, 1fr);
	}
	.pedit .dhead,
	.pedit .dbody {
		padding-left: 16px;
		padding-right: 16px;
	}
	.pedit .dfoot {
		flex-wrap: wrap;
		padding-left: 16px;
		padding-right: 16px;
	}
	.detail {
		flex: 1 1 0;
		min-width: 0;
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-2xl);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.dhead {
		padding: 22px 28px;
		border-bottom: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.dhead .row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.slot {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--muted);
		text-transform: uppercase;
	}
	.nav {
		display: flex;
		gap: 6px;
	}
	.nav .btn[aria-pressed='true'] {
		border-color: var(--ink);
		background: var(--hover);
	}
	.dhead .seg .sb {
		flex: 1 1 0;
		justify-content: center;
	}
	.dhead .sb:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.dhead .sb:disabled:hover {
		color: var(--soft);
	}
	.why {
		font-size: 13px;
		color: var(--muted);
		margin-top: -6px;
	}
	.ttl {
		width: 100%;
		border: 0;
		border-bottom: 2px solid transparent;
		padding: 2px 0 6px;
		background: transparent;
		font-family: inherit;
		font-size: 32px;
		font-weight: 800;
		font-stretch: 108%;
		letter-spacing: -0.02em;
		color: var(--ink);
	}
	.ttl:hover {
		border-bottom-color: var(--line-2);
	}
	h2.ttl:hover {
		border-bottom-color: transparent;
	}
	.note {
		font-size: 14px;
		line-height: 1.5;
		white-space: pre-wrap;
	}
	.ttl:focus {
		outline: none;
		border-bottom-color: var(--amber);
	}
	.ttl::placeholder {
		color: var(--warn);
		font-style: italic;
		font-weight: 600;
	}
	.grid4 {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}
	.fld.size {
		grid-column: span 2;
	}
	.fld.size .sb {
		flex: 1 1 0;
		justify-content: center;
	}
	/* The other half of a tandem slot. */
	.mate {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 16px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--raised);
	}
	.mhh {
		width: 34px;
		height: 34px;
		border: 1px solid var(--breaker-bd);
		border-radius: var(--r-sm);
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 3px;
		flex-shrink: 0;
	}
	.mhh span {
		flex: 1;
		border-radius: 1px;
		background: var(--handle);
	}
	.mhh span.on {
		background: var(--amber);
	}
	.mt {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 13px;
		color: var(--muted);
	}
	.mt strong {
		font-size: 14px;
		font-weight: 700;
		color: var(--ink);
	}
	.mate .btn {
		height: 38px;
	}
	.badt {
		padding: 12px 14px;
		border-radius: var(--r-lg);
		border: 1.5px solid var(--warn);
		font-size: 13px;
		line-height: 1.45;
	}
	.badt strong {
		color: var(--warn);
	}
	.dbody {
		flex-grow: 1;
		min-height: 0;
		overflow: auto;
		padding: 22px 28px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.powers {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.ph {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.ph h2 {
		font-size: 20px;
		font-weight: 800;
		font-stretch: 108%;
	}
	.ph span {
		font-size: 13px;
		color: var(--muted);
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.gname {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}
	.irow {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--surface);
		min-width: 0;
	}
	.irow .ico {
		width: 34px;
		height: 34px;
	}
	.itxt {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.loc {
		font-size: 13px;
		font-weight: 600;
		flex-shrink: 0;
		padding: 6px 2px;
	}
	.none {
		border: 1.5px dashed var(--dash);
		border-radius: var(--r-xl);
		padding: 28px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: flex-start;
	}
	.nt {
		font-size: 17px;
		font-weight: 700;
	}
	.nd {
		font-size: 14px;
		color: var(--muted);
		max-width: 460px;
		line-height: 1.5;
	}
	.nb {
		display: flex;
		gap: 8px;
	}
	.dfoot {
		padding: 14px 28px;
		border-top: 1px solid var(--line);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.dfoot.solo {
		justify-content: flex-end;
	}
	.fleft {
		display: flex;
		align-items: center;
		gap: 20px;
	}
	.rm {
		height: 44px;
		padding: 0 2px;
		border: 0;
		background: none;
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		color: var(--warn);
		cursor: pointer;
	}
	.rm:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.status {
		font-size: 13px;
		color: var(--muted);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ok);
	}
	.dot.is-dirty {
		background: var(--dirty);
	}
	.acts {
		display: flex;
		gap: 8px;
	}
	.acts .btn:disabled {
		opacity: 1;
	}
	/* ---- Subpanels (DESIGN.md §5.17) */
	.ptabs {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
	}
	.ptab {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 52px;
		padding: 0 16px 0 12px;
		border: 1.5px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
		color: var(--ink);
		text-decoration: none;
	}
	.ptab:hover {
		color: var(--ink);
		border-color: var(--btn-bd-h);
	}
	.ptab.is-on {
		border-color: var(--amber);
		box-shadow: 0 0 0 2px var(--amber);
	}
	.ptab .br {
		display: flex;
		color: var(--muted);
	}
	.pt {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.pn {
		font-size: 14px;
		font-weight: 700;
	}
	.pm {
		font-size: 11px;
		color: var(--muted);
	}
	.addsub {
		height: 52px;
		border-style: dashed;
	}
	.fedby {
		height: 38px;
	}
	.bk.feed {
		border: 1.5px solid var(--tag-fg);
	}
	.bk.feed .lbl {
		font-weight: 700;
	}
	.bk.is-sel.feed {
		border-color: var(--on-amber);
	}
	.path {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		color: var(--muted);
	}
	.path .ov {
		margin-right: 4px;
	}
	.pchip {
		display: inline-flex;
		align-items: center;
		height: 30px;
		padding: 0 10px;
		border-radius: var(--r-md);
		background: var(--bg);
		border: 1px solid var(--line-2);
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
	}
	.pchip.cur {
		background: var(--amber);
		border-color: var(--amber);
		color: var(--on-amber);
	}
	.feedcard {
		border: 1.5px solid var(--tag-fg);
		border-radius: var(--r-xl);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		background: var(--raised);
	}
	.fh {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.fh .tag {
		font-size: 11px;
		padding: 3px 6px;
	}
	.fh .btn {
		height: 38px;
	}
	.ft {
		flex-grow: 1;
		font-size: 16px;
		font-weight: 700;
	}
	.fm {
		font-size: 14px;
		color: var(--soft);
	}
	.fgrid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 6px;
	}
	.frow {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		color: var(--ink);
		text-decoration: none;
	}
	.frow:hover {
		color: var(--ink);
		border-color: var(--btn-bd-h);
	}
	.fl {
		flex-grow: 1;
		min-width: 0;
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.fc {
		font-size: 11px;
		color: var(--muted);
	}
	.kill {
		padding: 12px 14px;
		border-radius: var(--r-lg);
		background: var(--amber-soft);
		border: 1px solid var(--amber);
		font-size: 13px;
		line-height: 1.5;
	}
	.kill strong {
		color: var(--amber-ink);
	}
	.up {
		font-size: 13px;
		line-height: 1.5;
		color: var(--muted);
	}
	.addpane {
		flex-grow: 1;
		min-height: 0;
		overflow: auto;
		padding: 28px 32px;
	}
	.rm:disabled {
		opacity: 0.4;
		cursor: default;
	}
	/* ---- Quad (DESIGN.md §5.18): four half-rows over two slots, tie bars over the handles. */
	.quad {
		position: relative;
		display: grid;
		grid-template-rows: repeat(4, minmax(0, 1fr));
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--breaker-bd);
		border-radius: var(--r-sm);
		background: var(--enclosure-hi);
		min-height: 94px;
	}
	.quad.bad {
		border-color: var(--warn);
		border-style: dashed;
	}
	.quad .th {
		min-height: 20px;
	}
	.quad .th .num {
		width: auto;
		min-width: 30px;
		flex-shrink: 0;
	}
	.quad .th.cont .lbl {
		color: var(--muted);
		font-style: italic;
	}
	.quad .th.is-sel.cont .lbl {
		color: var(--on-amber);
	}
	.tie {
		position: absolute;
		width: 3px;
		border-radius: 2px;
		background: var(--tie);
		pointer-events: none;
		z-index: 2;
	}
	.tie.o {
		right: 12px;
	}
	.tie.i {
		right: 26px;
	}
	.quad.r .tie.o {
		right: auto;
		left: 12px;
	}
	.quad.r .tie.i {
		right: auto;
		left: 26px;
	}
	.tie.is-sel {
		background: var(--ink);
	}
	:global([data-theme='dark']) .tie.is-sel {
		background: var(--amber);
	}
	.qcard {
		display: flex;
		gap: 18px;
		align-items: center;
		padding: 16px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--raised);
	}
	.qmini {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--breaker-bd);
		border-radius: 5px;
		background: var(--enclosure);
		width: 120px;
		flex-shrink: 0;
	}
	.qh {
		height: 18px;
		border-radius: 2px;
		background: var(--raised);
		border: 1px solid var(--breaker-bd);
		display: flex;
		align-items: center;
		padding: 0 6px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--soft);
	}
	.qh.on {
		background: var(--amber);
		border-color: var(--amber);
		color: var(--on-amber);
	}
	.qt {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.qt strong {
		font-size: 15px;
	}
	.qt span {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.5;
	}
	.qacts {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.qacts .btn {
		height: 36px;
	}
</style>
