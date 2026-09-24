<script lang="ts">
	// Trace a breaker (docs/design/DESIGN.md §5.6): pick & flip → mark what died → name & save.
	// /trace?b=<breakerId> opens the flip sheet for that breaker.
	import { tick, untrack } from 'svelte';
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

	const order = (a: Breaker, b: Breaker) => a.panelId - b.panelId || a.slot - b.slot;
	const all = $derived([...data.house.breakers].sort(order));
	const isChecked = (b: Breaker) => b.lastCheckedAt !== null;
	const todo = $derived(all.filter((b) => !isChecked(b)).sort((a, b) => (a.label ? 1 : 0) - (b.label ? 1 : 0) || order(a, b)));
	const done = $derived(all.filter(isChecked));
	const pct = $derived(all.length ? Math.round((done.length / all.length) * 100) : 0);

	const sheetB = $derived(sheetFor === null ? null : (ix.breakerById.get(sheetFor) ?? null));
	const tb = $derived(tbId === null ? null : (ix.breakerById.get(tbId) ?? null));
	const markedItems = $derived(data.house.items.filter((i) => marked.has(i.id)));

	// ?b=<id> opens the sheet for that breaker.
	const bParam = $derived(page.url.searchParams.get('b'));
	$effect(() => {
		const id = bParam && /^\d+$/.test(bParam) ? +bParam : null;
		untrack(() => {
			if (id !== null && ix.breakerById.has(id)) {
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
				{#each todo as b (b.id)}
					{@render row(b, false)}
				{/each}
				<h2 class="ov later">Checked · {done.length}</h2>
				{#each done as b (b.id)}
					{@render row(b, true)}
				{/each}
			</div>
		</div>

		{#if sheetB}
			<TraceSheet breaker={sheetB} panel={ix.panelOf(sheetB)} onstart={startMark} oncancel={closeSheet} />
		{/if}
	{/if}
</PhoneFrame>

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
