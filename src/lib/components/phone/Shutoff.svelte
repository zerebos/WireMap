<script lang="ts" module>
	/** What to shut off: a room, a breaker (circuit) or one item, by id. */
	export type ShutoffTarget = { room: number | null; breaker: number | null; item: number | null };
</script>

<script lang="ts">
	// Shut off a room, a circuit or one item, standing at the panel (docs/design/DESIGN.md §5.5).
	// Full-screen on a phone (/shutoff); in a 420px drawer on desktop (§5.16). Which breakers are
	// off is only on-screen state: nothing here is saved.
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/Icon.svelte';
	import { plural, type HouseIndex, type HouseItem } from '$lib/house';
	import { physicalPosition, compareBreakers } from '$lib/panel';
	import type { Breaker } from '$lib/db/schema';

	let {
		ix,
		want,
		onbackclick,
		onclose
	}: {
		ix: HouseIndex;
		want: ShutoffTarget;
		/** Phone: the back link's click handler (goes back in history when it can). */
		onbackclick?: (e: MouseEvent) => void;
		/** Drawer: closes it. The header shows a close button instead of back. */
		onclose?: () => void;
	} = $props();
	const data = $derived({ house: ix.house });

	type Target =
		| { kind: 'room'; id: number; name: string; floorId: number | null }
		| { kind: 'breaker'; b: Breaker }
		| { kind: 'item'; item: HouseItem };

	const target = $derived.by((): Target | null => {
		const roomId = want.room;
		const breakerId = want.breaker;
		const itemId = want.item;
		if (roomId !== null) {
			const r = ix.roomById.get(roomId);
			return r ? { kind: 'room', id: r.id, name: r.name, floorId: r.floorId } : null;
		}
		if (breakerId !== null) {
			const b = ix.breakerById.get(breakerId);
			return b ? { kind: 'breaker', b } : null;
		}
		if (itemId !== null) {
			const item = data.house.items.find((i) => i.id === itemId);
			return item ? { kind: 'item', item } : null;
		}
		return null;
	});
	const targetKey = $derived(`${want.room}/${want.breaker}/${want.item}`);

	/** Items "here": the room's items, the one item, or nothing for a circuit. */
	const inScope = (i: HouseItem) =>
		target?.kind === 'room' ? i.roomId === target.id : target?.kind === 'item' ? i.id === target.item.id : false;
	const scope = $derived(target ? data.house.items.filter(inScope) : []);
	/** Items the "shared with" note counts: those in scope, or those on the breaker for a circuit. */
	const here = $derived(target?.kind === 'breaker' ? ix.itemsOf(target.b.id) : scope);

	const breakers = $derived.by(() => {
		if (!target) return [];
		// A shared item pulls in every breaker it's on (§5.11), and a handle-tied breaker brings its partners.
		const ids = new Set(
			target.kind === 'breaker' ? [target.b.id, ...ix.itemsOf(target.b.id).flatMap((i) => i.breakerIds)] : scope.flatMap((i) => i.breakerIds)
		);
		const ties = new Set([...ids].map((id) => ix.breakerById.get(id)?.tieGroup ?? null).filter((t) => t !== null));
		for (const b of data.house.breakers) if (b.tieGroup !== null && ties.has(b.tieGroup)) ids.add(b.id);
		return [...ids]
			.map((id) => ix.breakerById.get(id))
			.filter((b): b is Breaker => !!b)
			.sort(compareBreakers);
	});
	const ids = $derived(new Set(breakers.map((b) => b.id)));
	const unknown = $derived(scope.filter((i) => i.breakerIds.length === 0));
	const affected = $derived(data.house.items.filter((i) => i.breakerIds.some((id) => ids.has(id))));
	/** The breakers being shut off that feed an item: "12", "14 + 21". */
	const slotsFor = (i: HouseItem) =>
		ix
			.breakersOf(i)
			.filter((b) => ids.has(b.id))
			.map((b) => ix.slotOf(b))
			.join(' + ');

	const refFloor = $derived(
		target?.kind === 'room' ? target.floorId : target?.kind === 'item' ? target.item.floorId : undefined
	);
	const crit = $derived(
		affected
			.filter((i) => i.critical)
			.map((i) => ({
				item: i,
				where: `${ix.breakersOf(i).filter((b) => ids.has(b.id)).length > 1 ? 'breakers' : 'breaker'} ${slotsFor(i)}${inScope(i) ? '' : ` · ${ix.roomName(i.roomId)}`}`
			}))
	);
	const elsewhere = $derived.by(() => {
		const groups = new Map<string, string[]>();
		for (const i of affected) {
			if (inScope(i)) continue;
			const key = ix.roomName(i.roomId) + (i.floorId !== refFloor && i.floorId !== null ? ` · ${ix.floorName(i.floorId)}` : '');
			groups.set(key, [...(groups.get(key) ?? []), `${i.name} (${slotsFor(i)})`]);
		}
		return [...groups].map(([room, list]) => ({ room, list: list.join(', ') }));
	});

	// On-screen state only.
	let restoring = $state(false);
	let off = $state<Record<number, boolean>>({});
	let on = $state<Record<number, boolean>>({});
	$effect(() => {
		void targetKey;
		restoring = false;
		off = {};
		on = {};
	});
	const isDone = (id: number) => (restoring ? !!on[id] : !!off[id]);
	function toggle(ids: number[]) {
		const v = !ids.every(isDone);
		for (const id of ids) {
			if (restoring) on[id] = v;
			else off[id] = v;
		}
	}

	/** One row per breaker, except handle-tied breakers, which are one row: "turn off together". */
	const rows = $derived.by(() => {
		const out: Breaker[][] = [];
		const byTie = new Map<number, Breaker[]>();
		for (const b of breakers) {
			if (b.tieGroup === null) out.push([b]);
			else if (byTie.has(b.tieGroup)) byTie.get(b.tieGroup)!.push(b);
			else {
				const g = [b];
				byTie.set(b.tieGroup, g);
				out.push(g);
			}
		}
		return out;
	});
	/** " · 1 shared with 21": items here on this breaker that other breakers in the list also feed. */
	function sharedText(bs: Breaker[]) {
		const mine = new Set(bs.map((b) => b.id));
		const shared = here.filter((i) => i.breakerIds.some((id) => mine.has(id)) && i.breakerIds.some((id) => ids.has(id) && !mine.has(id)));
		if (!shared.length) return '';
		const others = breakers.filter((b) => !mine.has(b.id) && shared.some((i) => i.breakerIds.includes(b.id)));
		return ` · ${shared.length} shared with ${others.map((b) => ix.slotOf(b)).join(' + ')}`;
	}
	function rowSub(bs: Breaker[]) {
		const here =
			target?.kind === 'breaker'
				? plural(new Set(bs.flatMap((b) => ix.itemsOf(b.id).map((i) => i.id))).size, 'item')
				: `${plural(scope.filter((i) => bs.some((b) => i.breakerIds.includes(b.id))).length, 'item')} here`;
		if (bs.length === 1) return `${physicalPosition(bs[0], ix.panelOf(bs[0]))} · ${here}${sharedText(bs)}`;
		return `${bs.map((b) => ix.slotOf(b)).join(' + ')} · turn off together · ${here}${sharedText(bs)}`;
	}

	const total = $derived(breakers.length);
	const nDone = $derived(breakers.filter((b) => isDone(b.id)).length);
	const allDone = $derived(total > 0 && nDone === total);

	const name = $derived(
		!target
			? ''
			: target.kind === 'room'
				? target.name
				: target.kind === 'item'
					? target.item.name
					: target.b.label || `breaker ${ix.slotOf(target.b)}`
	);
	const title = $derived(target ? `${restoring ? 'Restore' : 'Shut off'} ${name}` : 'Shut off');
	const panelNames = $derived([...new Set(breakers.map((b) => ix.panelOf(b).name))].join(', ') || data.house.panel?.name || '');
	const subtitle = $derived.by(() => {
		if (!target) return '';
		if (target.kind === 'breaker') return `Breaker ${ix.slotOf(target.b)} · ${panelNames}`;
		const where = target.kind === 'room' ? ix.floorName(target.floorId) : ix.whereOf(target.item);
		return [where, plural(total, 'breaker'), panelNames].filter(Boolean).join(' · ');
	});

	const progressText = $derived(
		restoring
			? nDone === total
				? 'Everything is back on'
				: `${nDone} of ${total} back on`
			: allDone
				? `All ${total} off — now test`
				: `${nDone} of ${total} off`
	);
	const progressSub = $derived(restoring ? 'Restoring' : allDone ? 'Tester first' : 'Tap each as you flip it');
	const pct = $derived(total ? Math.round((nDone / total) * 100) : 0);

	const mapHref = $derived(
		!target
			? resolve('/map')
			: target.kind === 'room'
				? resolve('/map') + `?room=${target.id}`
				: target.kind === 'breaker'
					? resolve('/map') + `?circuit=${target.b.id}`
					: resolve('/map') + `?item=${target.item.id}`
	);
	function startRestore() {
		restoring = true;
		on = {};
	}
</script>

<svelte:head>
	<title>{title} · Breakerbook</title>
</svelte:head>

<div class="so">
	<header class="top">
		{#if onclose}
			<button type="button" class="ibtn" onclick={onclose} aria-label="Close"><Icon name="close" size={16} /></button>
		{:else}
			<a class="ibtn" href={resolve('/map')} onclick={onbackclick} aria-label="Back"><Icon name="prev" /></a>
		{/if}
		<div class="ttl">
			<h1>{title}</h1>
			{#if subtitle}<span class="subt">{subtitle}</span>{/if}
		</div>
	</header>

	<div class="scroll">
		<div class="tester">
			<span class="bolt"><Icon name="bolt" /></span>
			<span><strong>Test before you touch.</strong> Labels can be wrong — confirm with a non-contact tester every time.</span>
		</div>

		{#if !target}
			<p class="empty">
				Nothing to shut off here. Pick a room on the <a href={resolve('/map')}>map</a> first.
			</p>
		{:else}
			{#if unknown.length}
				<div class="unk">
					<span class="unk-t">{plural(unknown.length, 'item')} could still be live</span>
					<span class="unk-b">{unknown.map((i) => i.name).join(', ')} — no breaker on record. Treat as live until you trace it.</span>
					<a href={resolve('/trace')}>Trace it now →</a>
				</div>
			{/if}

			<section class="sec" aria-labelledby="list-t">
				<div class="sech">
					<h2 id="list-t" class="ov">{restoring ? 'Turn these back on' : 'Turn these off'}</h2>
					<span class="mono hint">In panel order</span>
				</div>
				{#each rows as bs (bs[0].id)}
					{@const done = bs.every((b) => isDone(b.id))}
					<button type="button" class="brow" class:is-done={done} aria-pressed={done} onclick={() => toggle(bs.map((b) => b.id))}>
						<span class="bnum big">{bs.map((b) => ix.slotOf(b)).join('+')}</span>
						<span class="bmain">
							<span class="bname">{[...new Set(bs.map((b) => ix.labelOf(b)))].join(' + ')}</span>
							<span class="bsub">{rowSub(bs)}</span>
						</span>
						<span
							class="pill mono"
							class:is-off={restoring ? !done : done}
							class:is-on={restoring && done}>{restoring ? (done ? 'ON' : 'OFF') : done ? 'OFF' : 'ON'}</span
						>
					</button>
				{:else}
					<p class="empty">No breaker on record feeds {target.kind === 'item' ? 'this item' : 'this room'} yet.</p>
				{/each}
			</section>

			{#if crit.length}
				<section class="sec" aria-labelledby="crit-t">
					<h2 id="crit-t" class="ov">Heads up</h2>
					{#each crit as c (c.item.id)}
						<div class="crit">
							<span class="ico"><Icon name={c.item.type} size={16} /></span>
							<span class="crit-m">
								<span class="crit-n">{c.item.name} <span class="mono crit-w">· {c.where}</span></span>
								{#if c.item.criticalNote}<span class="crit-note">{c.item.criticalNote}</span>{/if}
							</span>
						</div>
					{/each}
				</section>
			{/if}

			{#if elsewhere.length}
				<section class="sec" aria-labelledby="else-t">
					<h2 id="else-t" class="ov">{target.kind === 'breaker' ? 'Goes dark' : 'Also goes dark elsewhere'}</h2>
					<div class="elsebox">
						{#each elsewhere as g (g.room)}
							<div class="eg">
								<span class="eg-r">{g.room}</span>
								<span class="eg-l">{g.list}</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		{/if}
	</div>

	{#if target}
		<footer class="foot">
			<div class="prog">
				<span class="prog-t" role="status">{progressText}</span>
				<span class="mono hint">{progressSub}</span>
			</div>
			<div class="bar"><span style:width="{pct}%"></span></div>
			{#if !restoring && allDone}
				<button type="button" class="btn btn-pri big-btn" onclick={startRestore}>Done working — restore power</button>
			{/if}
			{#if restoring && nDone === total}
				{#if onclose}
					<button type="button" class="btn btn-pri big-btn" onclick={onclose}>Power restored — close</button>
				{:else}
					<a class="btn btn-pri big-btn" href={mapHref}>Power restored — back to map</a>
				{/if}
			{/if}
		</footer>
	{/if}
</div>

<style>
	.so {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--ink);
	}
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
		min-width: 0;
	}
	h1 {
		font-size: 20px;
		font-weight: 800;
		font-stretch: 108%;
		line-height: 1.15;
	}
	.subt {
		font-size: 13px;
		color: var(--muted);
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
	.tester {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 12px 14px;
		border-radius: var(--r-xl);
		border: 1px solid var(--line-2);
		background: var(--surface);
		font-size: 13px;
		line-height: 1.45;
	}
	.bolt {
		display: flex;
		flex-shrink: 0;
		margin-top: 1px;
		color: var(--amber);
	}
	.unk {
		padding: 12px 14px;
		border-radius: var(--r-xl);
		border: 1.5px solid var(--warn);
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		line-height: 1.45;
	}
	.unk-t {
		font-size: 14px;
		font-weight: 700;
		color: var(--warn);
	}
	.unk a {
		font-weight: 600;
	}
	.empty {
		font-size: 14px;
		color: var(--muted);
		line-height: 1.45;
	}
	.sec {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.sech {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	h2.ov {
		margin: 0;
	}
	.hint {
		font-size: 12px;
		color: var(--muted);
	}
	.brow {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 68px;
		padding: 10px 12px;
		border: 1.5px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
		font: inherit;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s;
	}
	.brow:hover {
		border-color: var(--btn-bd-h);
	}
	.brow.is-done {
		background: var(--amber-soft);
		border-color: var(--amber);
	}
	.bnum.big {
		min-width: 48px;
		height: 32px;
		font-size: 13px;
	}
	.bmain {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.bname {
		font-size: 15px;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bsub {
		font-size: 12px;
		color: var(--muted);
	}
	.pill {
		min-width: 52px;
		height: 30px;
		padding: 0 10px;
		border-radius: 15px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		font-weight: 600;
		flex-shrink: 0;
		border: 1.5px solid var(--field);
		color: var(--soft);
	}
	.pill.is-off {
		background: var(--on-amber);
		border-color: var(--on-amber);
		color: var(--amber);
	}
	.pill.is-on {
		background: var(--amber);
		border-color: var(--amber);
		color: var(--on-amber);
	}
	.crit {
		display: flex;
		gap: 12px;
		padding: 12px 14px;
		border-radius: var(--r-xl);
		background: var(--amber-soft);
		border: 1px solid var(--amber);
	}
	.crit .ico {
		background: var(--surface);
	}
	.crit-m {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.crit-n {
		font-size: 14px;
		font-weight: 700;
	}
	.crit-w {
		font-size: 11px;
		font-weight: 600;
		color: var(--amber-ink);
	}
	.crit-note {
		font-size: 13px;
		line-height: 1.45;
	}
	.elsebox {
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
		padding: 4px 14px;
	}
	.eg {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 10px 0;
		border-top: 1px solid var(--line);
	}
	.eg:first-child {
		border-top: 0;
	}
	.eg-r {
		font-size: 14px;
		font-weight: 700;
	}
	.eg-l {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.45;
	}
	.foot {
		flex-shrink: 0;
		padding: 14px 16px 20px;
		border-top: 1px solid var(--line);
		background: var(--raised);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.prog {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.prog-t {
		font-size: 15px;
		font-weight: 700;
	}
	.big-btn {
		width: 100%;
		height: 50px;
		font-size: 15px;
	}
	@media (prefers-reduced-motion: reduce) {
		.brow {
			transition: none;
		}
	}
</style>
