<script lang="ts">
	// Trace a breaker (docs/design/DESIGN.md §5.6): pick & flip → mark what died → name & save.
	// /trace?b=<breakerId> opens the flip sheet for that breaker.
	import { compareBreakers, panelShort } from '$lib/panel';
	import { onDestroy, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import PhoneFrame from '$lib/components/phone/PhoneFrame.svelte';
	import TraceSheet from '$lib/components/phone/TraceSheet.svelte';
	import TraceMark from '$lib/components/phone/TraceMark.svelte';
	import TraceName from '$lib/components/phone/TraceName.svelte';
	import { useBack } from '$lib/components/phone/back.svelte';
	import { index, mutate, plural } from '$lib/house';
	import { saveTrace } from '$lib/db/ops';
	import type { Breaker } from '$lib/db/schema';
	import { viewport } from '$lib/viewport.svelte';
	import { traceFlow } from '$lib/trace.svelte';
	import { search } from '$lib/search.svelte';

	let { data } = $props();
	const ix = $derived(index(data.house));
	const back = useBack();

	let step = $state<'pick' | 'mark' | 'name'>('pick');
	let sheetFor = $state<number | null>(null);
	let tbId = $state<number | null>(null);
	const marked = new SvelteSet<number>();
	/** Marked items that stay on their other breakers too ("On both", DESIGN.md §5.11). */
	const keep = new SvelteSet<number>();
	let floor = $state<number | null>(null);
	let label = $state('');
	let backOn = $state(false);
	let toast = $state('');
	let busy = $state(false);

	const order = (a: Breaker, b: Breaker) => compareBreakers(a, b);
	// Feeders aren't traceable: flipping one kills a whole subpanel (DESIGN.md §5.17).
	const all = $derived([...data.house.breakers].filter((b) => !ix.fedPanelOf(b)).sort(order));
	const feeders = $derived(data.house.breakers.filter((b) => ix.fedPanelOf(b)).sort(order));
	const tree = $derived(ix.panelTree());
	/** A list split by panel, in tree order. One panel: one group with no heading. */
	const byPanel = (list: Breaker[], withFeeders = false) =>
		tree
			.map((t) => ({
				panel: t.panel,
				bs: list.filter((b) => b.panelId === t.panel.id),
				fs: withFeeders ? feeders.filter((b) => b.panelId === t.panel.id) : []
			}))
			.filter((g) => g.bs.length || g.fs.length);
	const isChecked = (b: Breaker) => b.lastCheckedAt !== null;
	const todo = $derived(all.filter((b) => !isChecked(b)).sort((a, b) => (a.label ? 1 : 0) - (b.label ? 1 : 0) || order(a, b)));
	const done = $derived(all.filter(isChecked));
	const pct = $derived(all.length ? Math.round((done.length / all.length) * 100) : 0);

	// ?b=<id> opens the sheet for that breaker.
	const bParam = $derived(page.url.searchParams.get('b'));
	// Desktop starts on the hand-off card (DESIGN.md §5.16); picking a breaker there hands off to the flow.
	const card = $derived(!viewport.phone && !traceFlow.handoff && bParam === null);
	onDestroy(() => (traceFlow.handoff = false));
	const q = $derived(search.q.trim().toLowerCase());
	const hit = (b: Breaker) => !q || ix.slotOf(b).toLowerCase().includes(q) || ix.labelOf(b).toLowerCase().includes(q);
	function handoff(b: Breaker) {
		traceFlow.handoff = true;
		opener = null;
		toast = '';
		sheetFor = b.id;
	}

	const sheetB = $derived(sheetFor === null ? null : (ix.breakerById.get(sheetFor) ?? null));
	const tb = $derived(tbId === null ? null : (ix.breakerById.get(tbId) ?? null));
	const markedItems = $derived(data.house.items.filter((i) => marked.has(i.id)));

	$effect(() => {
		const id = bParam && /^\d+$/.test(bParam) ? +bParam : null;
		untrack(() => {
			if (id !== null && ix.breakerById.has(id) && !ix.fedPanelOf(ix.breakerById.get(id)!)) {
				step = 'pick';
				sheetFor = id;
				opener = null;
			}
		});
	});
	function clearParam() {
		if (!page.url.searchParams.has('b')) return;
		const url = new URL(page.url);
		url.searchParams.delete('b');
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	// Focus: back to the row that opened the sheet; to the new step's title on step changes.
	let opener: HTMLElement | null = null;
	function openSheet(b: Breaker, e: MouseEvent) {
		opener = e.currentTarget as HTMLElement;
		toast = '';
		sheetFor = b.id;
	}
	async function closeSheet() {
		sheetFor = null;
		clearParam();
		await tick();
		opener?.focus();
	}
	async function focusTitle() {
		await tick();
		document.querySelector<HTMLElement>('.phone h1')?.focus();
	}
	function go(s: typeof step) {
		step = s;
		focusTitle();
	}

	function startMark() {
		if (!sheetB) return;
		const b = sheetB;
		const on = ix.itemsOf(b.id);
		marked.clear();
		keep.clear();
		for (const i of on) marked.add(i.id);
		// Start on the floor it's known to feed; otherwise the floor with the most items.
		const counts = data.house.floors.map((f) => ({ id: f.id, n: data.house.items.filter((i) => i.floorId === f.id).length }));
		floor = on.find((i) => i.floorId !== null)?.floorId ?? counts.sort((a, b) => b.n - a.n)[0]?.id ?? null;
		label = b.label;
		backOn = false;
		tbId = b.id;
		sheetFor = null;
		clearParam();
		go('mark');
	}

	async function save(finalLabel: string, next: boolean) {
		if (!tb || busy) return;
		busy = true;
		const b = tb;
		try {
			await mutate(() => saveTrace(b.id, finalLabel, [...marked], [...keep].filter((id) => marked.has(id))));
		} finally {
			busy = false;
		}
		if (next) {
			toast = `Breaker ${ix.slotOf(b)} saved as “${finalLabel}”`;
			tbId = null;
			marked.clear();
			keep.clear();
			go('pick');
		} else {
			goto(resolve('/panel') + `?b=${b.id}`);
		}
	}
</script>

<svelte:head>
	<title>Trace circuits · Breakerbook</title>
</svelte:head>

{#if card}
	<main class="desk">
		<section class="dcard" aria-labelledby="dt-t">
			<div class="dtop">
				<div class="ttl">
					<h1 id="dt-t">Trace circuits</h1>
					<span class="subt">Flip one breaker, tap what goes dark.</span>
				</div>
				<div class="qr">
					<span class="code" aria-hidden="true">QR code</span>
					<span class="qt">
						<span class="qh">Open this on your phone</span>
						<span class="mono qa">[this server’s address]/trace</span>
						<span class="hint">Tracing from a second device needs the server version — on the roadmap.</span>
					</span>
				</div>
				<div class="prog">
					<div class="progt">
						<span class="pt">{done.length} of {plural(all.length, 'breaker')} checked</span>
						<span class="mono pm">{data.house.panel?.name ?? ''}</span>
					</div>
					<div class="bar"><span style:width="{pct}%"></span></div>
				</div>
			</div>
			<div class="dlist">
				<h2 class="ov">Not checked yet · {todo.length}</h2>
				{#each byPanel(todo.filter(hit), true) as g (g.panel.id)}
					{#if tree.length > 1}<h3 class="ov pg">{g.panel.name}</h3>{/if}
					{#each g.bs as b (b.id)}
						{@render drow(b, false)}
					{/each}
					{#each g.fs as b (b.id)}
						{@render feed(b)}
					{/each}
				{/each}
				<h2 class="ov later">Checked · {done.length}</h2>
				{#each byPanel(done.filter(hit)) as g (g.panel.id)}
					{#if tree.length > 1}<h3 class="ov pg">{g.panel.name}</h3>{/if}
					{#each g.bs as b (b.id)}
						{@render drow(b, true)}
					{/each}
				{/each}
			</div>
		</section>
	</main>
{:else}
<PhoneFrame>
	{#if step === 'mark' && tb}
		<TraceMark {ix} {tb} {marked} {keep} bind:floor onback={() => go('pick')} onreview={() => go('name')} />
	{:else if step === 'name' && tb}
		<TraceName {ix} {tb} items={markedItems} {keep} bind:label bind:backOn {busy} onback={() => go('mark')} onsave={save} />
	{:else}
		<div class="pick" inert={!!sheetB}>
			<header class="top">
				<div class="row">
					<a class="ibtn" href={resolve('/panel')} onclick={back.onclick} aria-label="Back to panel"><Icon name="prev" /></a>
					<div class="ttl">
						<h1 tabindex="-1">Trace circuits</h1>
						<span class="subt">Flip one breaker, tap what goes dark.</span>
					</div>
				</div>
				<div class="prog">
					<div class="progt">
						<span class="pt">{done.length} of {plural(all.length, 'breaker')} checked</span>
						<span class="mono pm">{data.house.panel?.name ?? ''}</span>
					</div>
					<div class="bar"><span style:width="{pct}%"></span></div>
				</div>
			</header>
			<div class="toastslot" role="status">
				{#if toast}
					<div class="toast inv"><Icon name="check" size={16} stroke={2.4} />{toast}</div>
				{/if}
			</div>
			<div class="scroll">
				<h2 class="ov">Not checked yet · {todo.length}</h2>
				{#each byPanel(todo, true) as g (g.panel.id)}
					{#if tree.length > 1}<h3 class="ov pg">{g.panel.name}</h3>{/if}
					{#each g.bs as b (b.id)}
						{@render row(b, false)}
					{/each}
					{#each g.fs as b (b.id)}
						{@render feed(b)}
					{/each}
				{/each}
				<h2 class="ov later">Checked · {done.length}</h2>
				{#each byPanel(done) as g (g.panel.id)}
					{#if tree.length > 1}<h3 class="ov pg">{g.panel.name}</h3>{/if}
					{#each g.bs as b (b.id)}
						{@render row(b, true)}
					{/each}
				{/each}
			</div>
		</div>

		{#if sheetB}
			<TraceSheet breaker={sheetB} panel={ix.panelOf(sheetB)} onstart={startMark} oncancel={closeSheet} />
		{/if}
	{/if}
</PhoneFrame>
{/if}

{#snippet drow(b: Breaker, checked: boolean)}
	<button type="button" class="drw" class:is-unl={!b.label} onclick={() => handoff(b)}>
		<span class="bnum">{ix.slotOf(b)}</span>
		<span class="ln">{ix.labelOf(b)}</span>
		<span class="sub">{checked ? 'Checked' : 'Not checked'} · {plural(ix.itemsOf(b.id).length, 'item')}</span>
	</button>
{/snippet}

{#snippet feed(b: Breaker)}
	{@const sub = panelShort(ix.fedPanelOf(b)!)}
	<div class="frow">
		<span class="bnum big">{ix.slotOf(b)}</span>
		<span class="lm">
			<span class="ln">{ix.fedPanelOf(b)!.name} feeder</span>
			<span class="sub">Flipping this kills the whole {sub} panel. Trace its breakers from the {sub} panel instead.</span>
		</span>
	</div>
{/snippet}

{#snippet row(b: Breaker, checked: boolean)}
	<button type="button" class="lrow" class:is-unl={!b.label} onclick={(e) => openSheet(b, e)}>
		<span class="bnum big">{ix.slotOf(b)}</span>
		<span class="lm">
			<span class="ln">{ix.labelOf(b)}</span>
			<span class="sub">{checked ? 'Checked' : 'Not checked'} · {plural(ix.itemsOf(b.id).length, 'item')}</span>
		</span>
		<span class="chev"><Icon name="next" /></span>
	</button>
{/snippet}

<style>
	.desk {
		flex: 1 1 0;
		min-height: 0;
		overflow: auto;
		padding: 32px;
		display: flex;
		justify-content: center;
		align-items: flex-start;
	}
	.dcard {
		width: 720px;
		max-width: 100%;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-xl);
		display: flex;
		flex-direction: column;
	}
	.dtop {
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 18px;
		border-bottom: 1px solid var(--line);
	}
	.qr {
		display: flex;
		gap: 16px;
		align-items: center;
		padding: 12px;
		border-radius: var(--r-lg);
		background: var(--bg);
	}
	.code {
		width: 96px;
		height: 96px;
		flex-shrink: 0;
		border: 1.5px dashed var(--field);
		border-radius: var(--r-md);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		color: var(--muted);
	}
	.qt {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.qh {
		font-size: 15px;
		font-weight: 700;
	}
	.qa {
		font-size: 13px;
	}
	.qt .hint {
		font-size: 12px;
		color: var(--muted);
	}
	.dlist {
		padding: 16px 24px 24px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.drw {
		display: grid;
		grid-template-columns: 56px minmax(0, 1fr) auto;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 6px 10px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-lg);
		background: var(--raised);
		font: inherit;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.drw:hover {
		border-color: var(--btn-bd-h);
	}
	.drw .ln {
		font-size: 14px;
	}
	.drw.is-unl .ln {
		font-style: italic;
		color: var(--warn);
	}
	.pick {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.top {
		flex-shrink: 0;
		padding: 12px 16px 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-bottom: 1px solid var(--line);
		background: var(--raised);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.ttl {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	/* Focused on step changes so screen readers follow; not interactive, so no ring. */
	h1:focus {
		outline: none;
	}
	h1 {
		font-size: 20px;
		font-weight: 800;
		font-stretch: 108%;
	}
	.subt {
		font-size: 13px;
		color: var(--muted);
	}
	.prog {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.progt {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
	}
	.pt {
		font-weight: 700;
	}
	.pm {
		color: var(--muted);
	}
	.toastslot:empty {
		display: none;
	}
	.toast {
		margin: 12px 16px 0;
		padding: 10px 14px;
		border-radius: var(--r-lg);
		font-size: 13px;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.scroll {
		flex: 1 1 0;
		min-height: 0;
		overflow: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	h2.ov {
		margin: 0;
	}
	h2.later {
		margin-top: 10px;
	}
	.lrow {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 60px;
		padding: 8px 12px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
		font: inherit;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		flex-shrink: 0;
	}
	.pg {
		margin: 6px 0 0;
		color: var(--soft);
	}
	.frow {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		flex-shrink: 0;
	}
	.frow .sub {
		line-height: 1.4;
	}
	.lrow:hover {
		border-color: var(--btn-bd-h);
	}
	.bnum.big {
		height: 32px;
		min-width: 48px;
		font-size: 13px;
	}
	.lm {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.ln {
		font-size: 15px;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lrow.is-unl .ln {
		font-style: italic;
		color: var(--warn);
	}
	.sub {
		font-size: 12px;
		color: var(--muted);
	}
	.chev {
		display: flex;
		color: var(--muted);
		flex-shrink: 0;
	}
</style>
