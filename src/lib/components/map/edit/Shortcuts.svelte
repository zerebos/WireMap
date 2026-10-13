<script lang="ts">
	// The keyboard shortcuts popover (docs/design/DESIGN.md §5.21, mockup MapKeyboard `kb: help`).
	// It sits above the status line; Esc or the close button closes it, and the editor returns focus.
	import Icon from '$lib/components/Icon.svelte';

	let { id, onclose }: { id: string; onclose: () => void } = $props();

	// Focus moves into the dialog, onto its close button; the editor puts it back when it closes.
	let closeBtn: HTMLButtonElement | undefined = $state();
	$effect(() => closeBtn?.focus());

	const SECTIONS: { h: string; rows: { k: string[]; t: string; plus?: boolean }[] }[] = [
		{
			h: 'Tools',
			rows: [
				{ k: ['V'], t: 'Select and move' },
				{ k: ['R', 'P', 'I'], t: 'Room · Polygon · New item. Focus jumps to the canvas with the cursor in view.' }
			]
		},
		{
			h: 'Drawing and placing',
			rows: [
				{ k: ['← ↑ → ↓'], t: 'Move the cursor one grid step (6″)' },
				{ k: ['Shift', 'arrows'], t: 'Move one unit, no snapping', plus: true },
				{ k: ['Page Up/Down'], t: 'Jump 10 steps (5′) up or down; with Shift, left or right' },
				{ k: ['Enter'], t: 'Set a corner · finish the room · drop the item' },
				{ k: ['Backspace'], t: 'Remove the last polygon corner' },
				{ k: ['C'], t: 'Close the polygon (needs 3 corners)' },
				{ k: ['Esc'], t: 'Cancel the shape, then the tool' }
			]
		},
		{
			h: 'Selected room or item',
			rows: [
				{ k: ['Tab'], t: 'Next room, then items, in reading order' },
				{ k: ['arrows'], t: 'Move it one grid step (Shift: one unit)' },
				{ k: ['Alt', 'arrows'], t: 'Resize a room from its right and bottom edges', plus: true },
				{ k: ['Delete'], t: 'Delete the room (asks first) · take the item off the map' },
				{ k: ['Ctrl', 'Z'], t: 'Undo (⌘Z on a Mac)', plus: true }
			]
		}
	];
</script>

<div
	class="khelp ovl"
	{id}
	role="dialog"
	aria-labelledby="{id}-t"
	tabindex="-1"
	onkeydown={(e) => {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		onclose();
	}}
>
	<div class="kh">
		<h2 id="{id}-t">Keyboard shortcuts</h2>
		<button type="button" class="ibtn kx" aria-label="Close shortcuts" bind:this={closeBtn} onclick={onclose}><Icon name="close" size={16} stroke={2.2} /></button>
	</div>
	{#each SECTIONS as s (s.h)}
		<div class="ksec">
			<h3>{s.h}</h3>
			{#each s.rows as r (r.t)}
				<div class="krow">
					<span class="ks"
						>{#each r.k as k, n (k)}{#if r.plus && n}+{/if}<span class="kk">{k}</span>{/each}</span
					><span>{r.t}</span>
				</div>
			{/each}
		</div>
	{/each}
	<span class="kfoot">Exact sizes: type them into Position and Size in the panel on the right.</span>
</div>

<style>
	.khelp {
		position: absolute;
		right: 12px;
		bottom: 66px;
		width: 420px;
		max-height: calc(100% - 90px);
		overflow: auto;
		padding: 16px 18px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
		box-shadow: var(--shadow-dialog);
		z-index: 12;
		display: flex;
		flex-direction: column;
		gap: 12px;
		cursor: default;
	}
	.khelp:focus {
		outline: none;
	}
	.kh {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		font-size: 17px;
		font-weight: 800;
	}
	.kx {
		width: 34px;
		height: 34px;
	}
	.ksec {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	h3 {
		font-size: 11px;
		font-family: var(--font-mono);
		font-weight: 600;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.krow {
		display: grid;
		grid-template-columns: 132px minmax(0, 1fr);
		gap: 10px;
		align-items: baseline;
		font-size: 13px;
		line-height: 1.4;
	}
	.ks {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		align-items: baseline;
	}
	.kfoot {
		font-size: 12px;
		color: var(--muted);
		line-height: 1.45;
	}
</style>
