<script lang="ts">
	// Setup step 2: the panel's name, main breaker, spaces and slot numbering, with a live preview.
	import { MAIN_AMPS, type Numbering } from '$lib/constants';
	import { rowCount, slotAt } from '$lib/panel';
	import { SETUP_SPACES, type SetupDraft } from './draft';

	let { draft = $bindable() }: { draft: SetupDraft } = $props();

	const shape = $derived({ slotCount: draft.spaces, numbering: draft.numbering });
	const rows = $derived(
		Array.from({ length: rowCount(shape) }, (_, i) => ({ l: slotAt('left', i + 1, shape), r: slotAt('right', i + 1, shape) }))
	);
	const half = $derived(rowCount(shape));
	const seqHint = $derived(`1 · ${half + 1} / 2 · ${half + 2} / 3 · ${half + 3}`);

	const schemes: { key: Numbering; title: string; hint: string }[] = [
		{ key: 'odd_left_even_right', title: 'Odd left, even right', hint: 'Most US panels.' },
		{ key: 'down_left_then_right', title: 'Down the left, then the right', hint: 'Some older and smaller panels.' }
	];
</script>

<div class="wrap">
	<div class="form">
		<div class="intro">
			<h1 tabindex="-1">Tell us about your panel</h1>
			<p class="lead">Open the panel door. You only need what you can see — no cover removal.</p>
		</div>
		<div class="fld">
			<label for="p-name">Panel name</label>
			<input id="p-name" class="inp" type="text" bind:value={draft.panelName} />
		</div>
		<div class="two">
			<div class="fld">
				<label for="p-amp">Main breaker</label>
				<select id="p-amp" class="inp" bind:value={draft.amps}>
					{#each MAIN_AMPS as a (a)}<option value={a}>{a} A</option>{/each}
				</select>
				<span class="hint">Printed on the big breaker at the top.</span>
			</div>
			<div class="fld">
				<label for="p-sp">Spaces</label>
				<select id="p-sp" class="inp" bind:value={draft.spaces}>
					{#each SETUP_SPACES as n (n)}<option value={n}>{n}</option>{/each}
				</select>
				<span class="hint">Count both sides, including empty slots and knockouts.</span>
			</div>
		</div>
		<div class="numq">
			<span class="k" id="num-l">How are the slots numbered?</span>
			<div class="two" role="radiogroup" aria-labelledby="num-l">
				{#each schemes as s (s.key)}
					<button
						type="button"
						class="rcard"
						class:is-on={draft.numbering === s.key}
						role="radio"
						aria-checked={draft.numbering === s.key}
						onclick={() => (draft.numbering = s.key)}
					>
						<span class="radio"></span>
						<span class="rc">
							<span class="rt">{s.title}</span>
							<span class="mono ex">{s.key === 'odd_left_even_right' ? '1 · 2 / 3 · 4 / 5 · 6' : seqHint}</span>
							<span class="hint">{s.hint}</span>
						</span>
					</button>
				{/each}
			</div>
		</div>
	</div>

	<div class="preview" role="img" aria-label="Preview of a {draft.spaces}-space panel">
		<span class="ov">Preview · {draft.amps}A · {draft.spaces} spaces</span>
		<div class="enc">
			<div class="main"><span class="hd"></span><span class="mono">MAIN {draft.amps}A</span></div>
			<div class="rows">
				{#each rows as r (r.l)}
					<div class="row"><span class="slot">{r.l}</span><span class="slot r">{r.r}</span></div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.wrap {
		display: flex;
		gap: 56px;
		align-items: flex-start;
	}
	.form {
		flex: 1 1 0;
		max-width: 560px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}
	.numq {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.k {
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
	}
	.numq .two {
		gap: 12px;
	}
	.rc {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.rt {
		font-size: 15px;
		font-weight: 700;
	}
	.ex {
		font-size: 12px;
		color: var(--muted);
	}
	.preview {
		width: 300px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.enc {
		height: 560px;
		background: var(--enclosure);
		border: 1px solid var(--enclosure-bd);
		border-radius: var(--r-2xl);
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.main {
		align-self: center;
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--raised);
		border: 1px solid var(--enclosure-bd);
		border-radius: 5px;
		padding: 5px 10px 5px 5px;
		font-size: 12px;
		font-weight: 600;
	}
	.hd {
		width: 36px;
		height: 24px;
		border-radius: var(--r-xs);
		background: var(--handle);
	}
	.rows {
		flex-grow: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.row {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		gap: 20px;
	}
	.slot {
		flex: 1 1 0;
		min-height: 0;
		border: 1px dashed var(--enclosure-bd);
		border-radius: var(--r-xs);
		display: flex;
		align-items: center;
		padding: 0 6px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--bus-ink);
	}
	.slot.r {
		justify-content: flex-end;
	}
</style>
