<script lang="ts">
	// Trace step 3: flip the breaker back on, name it, review what it feeds, save.
	import Icon from '$lib/components/Icon.svelte';
	import { plural, type HouseIndex, type HouseItem } from '$lib/house';
	import { ITEM_TYPE_LABELS } from '$lib/constants';
	import { physicalPosition } from '$lib/panel';
	import type { Breaker } from '$lib/db/schema';

	let {
		ix,
		tb,
		items,
		label = $bindable(),
		backOn = $bindable(),
		busy,
		onback,
		onsave
	}: {
		ix: HouseIndex;
		tb: Breaker;
		/** The marked items. */
		items: HouseItem[];
		label: string;
		backOn: boolean;
		busy: boolean;
		onback: () => void;
		onsave: (label: string, next: boolean) => void;
	} = $props();

	const num = $derived(ix.slotOf(tb));

	const suggestions = $derived.by(() => {
		if (!items.length) return ['Spare'];
		const count = new Map<string, number>();
		for (const i of items) {
			const r = ix.roomName(i.roomId);
			count.set(r, (count.get(r) ?? 0) + 1);
		}
		const rooms = [...count].sort((a, b) => b[1] - a[1]).map(([r]) => r);
		const out = [rooms.length === 1 ? rooms[0] : rooms.slice(0, 2).join(' & ')];
		const types = new Set(items.map((i) => i.type));
		if (types.size === 1) out.push(`${rooms[0]} ${ITEM_TYPE_LABELS[items[0].type].many.toLowerCase()}`);
		const fl = items[0].floorId;
		if (fl !== null && items.every((i) => i.floorId === fl)) out.push(ix.floorName(fl));
		return [...new Set(out.filter(Boolean))];
	});

	function tagOf(i: HouseItem): { text: string; cls: string } {
		if (i.breakerIds.includes(tb.id)) return { text: 'Same', cls: '' };
		if (!i.breakerIds.length) return { text: 'New', cls: 'new' };
		return { text: `From ${ix.breakersOf(i).map((b) => ix.slotOf(b)).join(' + ')}`, cls: 'mv' };
	}
	const moves = $derived(items.filter((i) => i.breakerIds.length && !i.breakerIds.includes(tb.id)));
	const movedFrom = $derived([...new Set(moves.flatMap((i) => ix.breakersOf(i).map((b) => ix.slotOf(b))))]);
	const finalLabel = $derived(label.trim() || suggestions[0]);
</script>

<header class="top">
	<button type="button" class="ibtn" aria-label="Back to marking" onclick={onback}><Icon name="prev" /></button>
	<div class="ttl">
		<span class="ov">Step 3 of 3</span>
		<h1 tabindex="-1">Save breaker {num}</h1>
	</div>
</header>

<div class="scroll">
	<div class="backc" class:is-done={backOn}>
		<span class="bt">
			<span id="l-back" class="btt">{backOn ? `${num} is back on` : `Flip ${num} back on`}</span>
			<span class="bts">{backOn ? 'Thanks — nothing left dark.' : physicalPosition(tb, ix.panelOf(tb))}</span>
		</span>
		<button type="button" role="switch" class="sw" class:is-on={backOn} aria-checked={backOn} aria-labelledby="l-back" onclick={() => (backOn = !backOn)}
			><span class="kn"></span></button
		>
	</div>

	<div class="fld">
		<label for="t-label" class="lbl">What does it power?</label>
		<input id="t-label" class="inp big" type="text" bind:value={label} placeholder={suggestions[0]} />
		<div class="sugg">
			{#each suggestions as s (s)}
				<button type="button" class="chip" class:is-on={label.trim() === s} aria-pressed={label.trim() === s} onclick={() => (label = s)}>{s}</button>
			{/each}
		</div>
	</div>

	<section class="feeds" aria-labelledby="feeds-t">
		<h2 id="feeds-t" class="ov">Feeds {plural(items.length, 'item')}</h2>
		{#each items as i (i.id)}
			{@const t = tagOf(i)}
			<div class="frow">
				<span class="ico"><Icon name={i.type} size={16} /></span>
				<span class="fm">
					<span class="fn">{i.name}</span>
					<span class="sub">{ix.whereOf(i)}</span>
				</span>
				<span class="tagx mono {t.cls}">{t.text}</span>
			</div>
		{/each}
		{#if !items.length}
			<p class="note">Nothing marked. It’ll be saved as a spare so you don’t trace it again.</p>
		{/if}
		{#if moves.length}
			<p class="note">
				{plural(moves.length, 'item')} will move off {movedFrom.join(', ')}. Worth re-tracing {movedFrom.length === 1 ? 'that breaker' : 'those'} next.
			</p>
		{/if}
	</section>
</div>

<footer class="foot">
	<button type="button" class="btn btn-pri go" disabled={busy} onclick={() => onsave(finalLabel, true)}>Save &amp; trace the next one</button>
	<button type="button" class="btn wide" disabled={busy} onclick={() => onsave(finalLabel, false)}>Save and finish</button>
</footer>

<style>
	.top {
		flex-shrink: 0;
		padding: 12px 16px;
		display: flex;
		align-items: center;
		gap: 10px;
		border-bottom: 1px solid var(--line);
		background: var(--raised);
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
	.scroll {
		flex: 1 1 0;
		min-height: 0;
		overflow: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.backc {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px;
		border-radius: var(--r-xl);
		border: 1.5px solid var(--amber);
		background: var(--amber-soft);
	}
	.backc.is-done {
		border: 1px solid var(--line-2);
		background: var(--surface);
	}
	.bt {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.btt {
		font-size: 15px;
		font-weight: 700;
	}
	.bts {
		font-size: 13px;
		color: var(--muted);
	}
	.fld .lbl {
		font-size: 14px;
		color: var(--ink);
	}
	.inp.big {
		height: 50px;
		font-size: 16px;
	}
	.sugg {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-top: 2px;
	}
	.sugg .chip {
		height: 36px;
	}
	.feeds {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	h2.ov {
		margin: 0;
	}
	.frow {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
	}
	.fm {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.fn {
		font-size: 14px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 12px;
		color: var(--muted);
	}
	.tagx {
		font-size: 11px;
		font-weight: 600;
		padding: 3px 6px;
		border-radius: var(--r-sm);
		background: var(--line);
		color: var(--soft);
		white-space: nowrap;
	}
	.tagx.new {
		background: var(--amber);
		color: var(--on-amber);
	}
	.tagx.mv {
		background: transparent;
		border: 1px solid var(--warn);
		color: var(--warn);
	}
	.note {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.45;
	}
	.foot {
		flex-shrink: 0;
		padding: 12px 16px 20px;
		border-top: 1px solid var(--line);
		background: var(--raised);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.go {
		width: 100%;
		height: 52px;
		font-size: 15px;
	}
	.wide {
		width: 100%;
	}
</style>
