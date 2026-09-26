<script lang="ts">
	// Print the directory (DESIGN.md §5.19, PrintSetup.dc.html): options on the left, a scaled live
	// preview on the right. Printing shows only the sheet, at the paper's size.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import PrintSheet, { PAPERS, type Paper, type PrintOptions } from '$lib/components/print/PrintSheet.svelte';
	import { index } from '$lib/house';

	let { data } = $props();
	const house = $derived(data.house);
	const ix = $derived(index(house));
	const tree = $derived(ix.panelTree());

	const pParam = $derived(Number(page.url.searchParams.get('p')) || null);
	const panel = $derived(house.panels.find((p) => p.id === pParam) ?? house.panel);
	const ampsOf = (p: { mainAmps: number | null; fedByBreakerId: number | null }) =>
		p.mainAmps ?? (p.fedByBreakerId !== null ? ix.breakerById.get(p.fedByBreakerId)?.amps : null) ?? null;

	function pickPanel(e: Event & { currentTarget: HTMLSelectElement }) {
		const url = new URL(page.url);
		url.searchParams.set('p', e.currentTarget.value);
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	let paper = $state<Paper>('letter');
	let o = $state<PrintOptions>({ amps: true, tags: true, blanks: false, qr: true, date: true, large: false });
	const includes: { key: keyof PrintOptions; label: string; hint?: string }[] = [
		{ key: 'amps', label: 'Amps' },
		{ key: 'tags', label: 'GFCI / AFCI tags' },
		{ key: 'blanks', label: 'Write-in lines', hint: 'Open and unlabeled slots print as blank lines to fill in by hand.' },
		{ key: 'qr', label: 'QR code to the live map', hint: 'Only useful on your home network.' },
		{ key: 'date', label: 'Printed date' },
		{ key: 'large', label: 'Large text', hint: 'Easier to read with a flashlight.' }
	];

	const size = $derived(PAPERS[paper]);
	const k = $derived(Math.min(760 / size.w, 800 / size.h, 1));
	const pageCss = $derived(`<style>@page { size: ${size.page}; margin: 0; }</style>`);
</script>

<svelte:head>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html pageCss}
</svelte:head>

{#if panel}
	<div class="print">
		<aside aria-label="Print options">
			<div class="opts">
				<div class="intro">
					<a class="back" href={resolve('/panel') + `?p=${panel.id}`}>← Back to panel</a>
					<h1>Print the directory</h1>
					<span class="lede">A fresh label for the inside of the panel door, laid out like the panel.</span>
				</div>
				<div class="fld">
					<label for="pp">Panel</label>
					<select id="pp" class="inp" value={String(panel.id)} onchange={pickPanel}>
						{#each tree as t (t.panel.id)}
							{@const a = ampsOf(t.panel)}
							<option value={String(t.panel.id)}>{t.panel.name}{a ? ` · ${a}A` : ''}</option>
						{/each}
					</select>
				</div>
				<div class="fld">
					<span class="k" id="pz">Paper</span>
					<div class="seg" role="group" aria-labelledby="pz">
						{#each [['letter', 'Letter'], ['a4', 'A4'], ['card', 'Door card']] as [key, label] (key)}
							<button type="button" class="sb" class:is-on={paper === key} aria-pressed={paper === key} onclick={() => (paper = key as Paper)}
								>{label}</button
							>
						{/each}
					</div>
					<span class="h">Door card fits the clear sleeve many panel doors have.</span>
				</div>
				<div class="inc">
					<span class="k">Include</span>
					{#each includes as c (c.key)}
						<label class="chk"
							><input type="checkbox" bind:checked={o[c.key]} /><span
								>{c.label}{#if c.hint}<span class="h">{c.hint}</span>{/if}</span
							></label
						>
					{/each}
				</div>
			</div>
			<div class="foot">
				<button type="button" class="btn btn-pri go" onclick={() => window.print()}><Icon name="print" size={18} />Print</button>
				<button type="button" class="btn" disabled aria-describedby="pdf-d" title="Needs the server version — on the roadmap.">Download PDF</button>
				<span class="sr" id="pdf-d">Needs the server version — on the roadmap.</span>
				<span class="note">Print at 100% scale (“Actual size”), not “Fit to page”.</span>
			</div>
		</aside>
		<section class="pv" aria-label="Preview">
			<div class="frame" style:width="{Math.round(size.w * k)}px" style:height="{Math.round(size.h * k)}px">
				<div class="scaler" style:transform="scale({k})">
					<PrintSheet {ix} {panel} {paper} {o} />
				</div>
			</div>
			<span class="mono cap">{size.label} · preview at {Math.round(k * 100)}%</span>
		</section>
	</div>
{/if}

<style>
	.print {
		height: 100%;
		min-height: 0;
		display: flex;
	}
	aside {
		width: 380px;
		flex-shrink: 0;
		box-sizing: border-box;
		background: var(--surface);
		border-right: 1px solid var(--line-2);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.opts {
		flex-grow: 1;
		min-height: 0;
		overflow: auto;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.intro {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.back {
		font-size: 13px;
		font-weight: 600;
		align-self: flex-start;
	}
	h1 {
		margin: 0;
		font-size: 26px;
		font-weight: 800;
		font-stretch: 112%;
		letter-spacing: -0.02em;
	}
	.lede {
		font-size: 14px;
		color: var(--soft);
		line-height: 1.5;
	}
	.k {
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
	}
	.sb {
		flex: 1 1 0;
		justify-content: center;
	}
	.h {
		display: block;
		font-size: 12px;
		color: var(--muted);
	}
	.inc {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.inc .chk {
		font-size: 14px;
		line-height: 1.4;
	}
	.foot {
		padding: 16px 24px 20px;
		border-top: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.go {
		height: 50px;
		font-size: 15px;
	}
	.note {
		font-size: 12px;
		color: var(--muted);
		text-align: center;
	}
	.pv {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 24px;
	}
	.frame {
		box-shadow: var(--print-shadow);
		flex-shrink: 0;
		overflow: hidden;
	}
	.scaler {
		transform-origin: 0 0;
		width: max-content;
	}
	.cap {
		font-size: 12px;
		color: var(--muted);
	}

	/* Only the sheet prints, at actual size in the page's top-left corner. */
	@media print {
		:global(body *) {
			visibility: hidden;
		}
		.scaler,
		.scaler :global(*) {
			visibility: visible;
		}
		:global(html),
		:global(body) {
			background: var(--print-paper);
		}
		.frame {
			box-shadow: none;
			overflow: visible;
		}
		.scaler {
			position: fixed;
			left: 0;
			top: 0;
			transform: none !important;
		}
	}
</style>
