<script lang="ts" module>
	export type Paper = 'letter' | 'a4' | 'card';
	export type PrintOptions = { amps: boolean; tags: boolean; blanks: boolean; qr: boolean; date: boolean; large: boolean };

	/** Sheet sizes in CSS px (96 per inch) and the matching @page size. */
	export const PAPERS: Record<Paper, { w: number; h: number; pad: number; qr: number; label: string; page: string }> = {
		letter: { w: 816, h: 1056, pad: 56, qr: 64, label: 'Letter · 8.5 × 11 in', page: '8.5in 11in' },
		a4: { w: 794, h: 1123, pad: 56, qr: 64, label: 'A4 · 210 × 297 mm', page: '210mm 297mm' },
		card: { w: 480, h: 768, pad: 28, qr: 48, label: 'Door card · 5 × 8 in', page: '5in 8in' }
	};
</script>

<script lang="ts">
	// The printed panel directory (DESIGN.md §5.19, PrintSheet.dc.html). Always light and ink-only,
	// laid out like the panel: numbers on the outer edges, rows filling the page.
	import type { Panel } from '$lib/db/schema';
	import type { HouseBreaker, HouseIndex } from '$lib/house';
	import { faceColumns, nextInColumn, panelShort, position, rowCount, slotLabel, spaceLabel, type Cell, type Space } from '$lib/panel';
	import { PROTECTION_TAGS } from '$lib/constants';

	let { ix, panel, paper, o }: { ix: HouseIndex; panel: Panel; paper: Paper; o: PrintOptions } = $props();

	const size = $derived(PAPERS[paper]);
	const breakers = $derived(ix.house.breakers.filter((b) => b.panelId === panel.id));
	const feeder = $derived(ix.feederOf(panel));
	const amps = $derived(panel.mainAmps ?? feeder?.amps ?? null);
	const title = $derived(`${panel.name}${amps ? ` · ${amps}A` : ''}`);
	const sub = $derived(
		[feeder ? `Fed by ${panelShort(ix.panelOf(feeder))} ${ix.slotOf(feeder)}` : ix.house.settings.homeName, panel.location]
			.filter(Boolean)
			.join(' · ')
	);
	const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

	type Line = { key: string; num: string; label: string; meta: string; two: boolean; cls: 'open' | 'unl' | 'write' | '' };
	type Row = { key: string; side: 'left' | 'right'; row: number; span: number; lines: Line[] };

	const open = (s: Space): Line => ({ key: `o${s.slot}${s.half ?? ''}`, num: spaceLabel(s, panel), label: o.blanks ? '' : 'Open', meta: '', two: false, cls: o.blanks ? 'write' : 'open' });
	function line(b: HouseBreaker): Line {
		const fed = ix.fedPanelOf(b);
		const label = fed ? `→ ${fed.name}` : b.label.trim();
		const meta = [o.amps ? `${b.amps}A` : '', o.tags && !fed ? PROTECTION_TAGS[b.kind] : ''].filter(Boolean).join(' ');
		return { key: `b${b.id}`, num: slotLabel(b, panel), label: label || (o.blanks ? '' : 'Unlabeled'), meta, two: b.poles === 2, cls: label ? '' : o.blanks ? 'write' : 'unl' };
	}
	function rowOf(c: Cell<HouseBreaker>, side: 'left' | 'right'): Row {
		const at = position(c.slot, panel).row;
		if (c.quad) {
			// A quad prints each breaker once, in physical order; an open half gets its own line.
			const below = nextInColumn(c.slot, panel);
			const seen = new Set<number>();
			const lines: Line[] = [];
			c.quad.forEach((b, i) => {
				if (!b) lines.push(open({ slot: i < 2 ? c.slot : below, half: i % 2 ? 'B' : 'A' }));
				else if (!seen.has(b.id)) {
					seen.add(b.id);
					lines.push(line(b));
				}
			});
			return { key: `q${c.slot}`, side, row: at, span: 2, lines };
		}
		if (c.halves) {
			const lines = (['A', 'B'] as const).map((h, i) => (c.halves![i] ? line(c.halves![i]!) : open({ slot: c.slot, half: h })));
			return { key: `h${c.slot}`, side, row: at, span: 1, lines };
		}
		if (c.breaker) return { key: `b${c.slot}`, side, row: at, span: c.breaker.poles === 2 ? 2 : 1, lines: [line(c.breaker)] };
		return { key: `o${c.slot}`, side, row: at, span: 1, lines: [open({ slot: c.slot, half: null })] };
	}
	const rows = $derived.by(() => {
		const f = faceColumns(panel, breakers);
		return [...f.left.map((c) => rowOf(c, 'left')), ...f.right.map((c) => rowOf(c, 'right'))];
	});
	const n = $derived(rowCount(panel));
	const legend = $derived(`${o.tags ? 'GF GFCI · AF AFCI · DF Dual function · ' : ''}Thick edge = 2-pole`);
</script>

<div
	class="sheet"
	class:sh-l={o.large}
	class:sh-c={!o.large && paper === 'card'}
	style:width="{size.w}px"
	style:height="{size.h}px"
	style:padding="{size.pad}px"
>
	<div class="hd">
		<div class="hl">
			<span class="ov">PANEL DIRECTORY</span>
			<span class="pt">{title}</span>
			<span class="sub">{sub}</span>
		</div>
		<div class="hr">
			{#if o.date}<span class="date">Printed<br />{date}</span>{/if}
			{#if o.qr}
				<span class="qr"><span class="qb" style:width="{size.qr}px" style:height="{size.qr}px">QR</span><span>Live map</span></span>
			{/if}
		</div>
	</div>
	<div class="grid" style:grid-template-rows="repeat({n}, minmax(0, 1fr))">
		{#each rows as r (r.key)}
			<div
				class="cell"
				class:r={r.side === 'right'}
				style:grid-row="{r.row} / span {r.span}"
				style:grid-column={r.side === 'right' ? 3 : 1}
			>
				{#each r.lines as l (l.key)}
					<div class="prc {l.cls}" class:two={l.two}>
						<span class="pn">{l.num}</span>
						<span class="pl">{l.label}</span>
						{#if l.meta}<span class="pm">{l.meta}</span>{/if}
					</div>
				{/each}
			</div>
		{/each}
		{#each { length: n } as _, i (i)}
			<div class="gut" style:grid-row={i + 1}></div>
		{/each}
	</div>
	<div class="ft">
		<span>{legend}</span>
		<strong>Test before you touch. Labels can be wrong.</strong>
	</div>
</div>

<style>
	.sheet {
		box-sizing: border-box;
		background: var(--print-paper);
		color: var(--print-ink);
		display: flex;
		flex-direction: column;
		gap: 14px;
		font-family: var(--font-ui);
	}
	.hd {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 16px;
		padding-bottom: 12px;
		border-bottom: 2px solid var(--print-ink);
	}
	.hl {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.ov {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: var(--print-soft);
	}
	.pt {
		font-size: 26px;
		font-weight: 800;
		font-stretch: 108%;
		letter-spacing: -0.01em;
		line-height: 1.1;
	}
	.sh-c .pt {
		font-size: 18px;
	}
	.sub {
		font-size: 12px;
		color: var(--print-soft);
	}
	.hr {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		flex-shrink: 0;
	}
	.date {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--print-soft);
		text-align: right;
		line-height: 1.4;
	}
	.qr {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		font-size: 12px;
		color: var(--print-soft);
	}
	.qb {
		box-sizing: border-box;
		border: 1.5px dashed var(--print-soft);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.grid {
		flex-grow: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 14px minmax(0, 1fr);
		border: 1.5px solid var(--print-ink);
	}
	.cell {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.gut {
		grid-column: 2;
		background: var(--print-gutter);
		border-bottom: 1px solid var(--print-rule);
	}
	.prc {
		flex: 1 1 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 10px;
		border-bottom: 1px solid var(--print-rule);
		min-width: 0;
		min-height: 0;
		box-sizing: border-box;
	}
	.r .prc {
		flex-direction: row-reverse;
		text-align: right;
	}
	.prc.two {
		border-left: 4px solid var(--print-ink);
	}
	.r .prc.two {
		border-left: 0;
		border-right: 4px solid var(--print-ink);
	}
	.pn {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: 16px;
		min-width: 40px;
		flex-shrink: 0;
	}
	.pl {
		flex: 1 1 auto;
		min-width: 0;
		font-size: 15px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pm {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--print-meta);
		flex-shrink: 0;
		white-space: nowrap;
	}
	.open .pl {
		color: var(--print-dim);
		font-weight: 400;
	}
	.write .pl {
		border-bottom: 1px dotted var(--print-dim);
		height: 1px;
		align-self: flex-end;
		margin-bottom: 8px;
	}
	.unl .pl {
		font-style: italic;
		font-weight: 400;
		color: var(--print-soft);
	}
	.sh-l .pn {
		font-size: 19px;
		min-width: 46px;
	}
	.sh-l .pl {
		font-size: 18px;
	}
	.sh-l .pm {
		font-size: 14px;
	}
	.sh-c .prc {
		gap: 6px;
		padding: 0 6px;
	}
	.sh-c .pn {
		font-size: 13px;
		min-width: 30px;
	}
	.sh-c .pl,
	.sh-c .pm {
		font-size: 12px;
	}
	.ft {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		font-size: 12px;
		color: var(--print-meta);
		line-height: 1.4;
	}
	.ft strong {
		text-align: right;
	}
</style>
