<script lang="ts">
	// Add subpanel (DESIGN.md §5.17): Name, Short code, Fed by, Spaces, main amps, Location. Used from
	// the Panel page's "+ Subpanel" and from Settings → Panels.
	import Icon from '$lib/components/Icon.svelte';
	import { FEEDER_AMPS, SUB_MAIN_AMPS, SUB_SPACES } from '$lib/constants';
	import type { SubpanelValues } from '$lib/db/ops';
	import type { HouseIndex } from '$lib/house';
	import { checkFit, nextInColumn, panelShort, position, slotLabel } from '$lib/panel';

	let { ix, oncancel, onadd }: { ix: HouseIndex; oncancel: () => void; onadd: (v: SubpanelValues) => void } = $props();

	const house = $derived(ix.house);
	const many = $derived(house.panels.length > 1);
	const where = (panelId: number) => (many ? ` · ${panelShort(ix.panelById.get(panelId)!)}` : '');

	// Existing 2-pole breakers that don't already feed a panel.
	const twoPoles = $derived(house.breakers.filter((b) => b.poles === 2 && !ix.fedPanelOf(b)));
	// Open places a new 2-pole breaker fits, in every panel.
	const openPairs = $derived(
		house.panels.flatMap((p) => {
			const inside = house.breakers.filter((b) => b.panelId === p.id);
			return Array.from({ length: p.slotCount }, (_, i) => i + 1)
				.filter((slot) => {
					const below = nextInColumn(slot, p);
					if (below > p.slotCount || position(below, p).side !== position(slot, p).side) return false;
					return !checkFit({ slot, poles: 2 }, p, inside);
				})
				.map((slot) => ({ key: `${p.id}:${slot}`, panelId: p.id, slot, text: slotLabel({ slot, poles: 2 }, p) + where(p.id) }));
		})
	);

	let name = $state('');
	let code = $state('');
	let fedBy = $state('');
	let openAt = $state('');
	let amps = $state(60);
	let spaces = $state(12);
	let mainAmps = $state('');
	let location = $state('');

	$effect(() => {
		if (!fedBy) fedBy = twoPoles[0] ? String(twoPoles[0].id) : 'new';
	});
	$effect(() => {
		if (!openAt && openPairs[0]) openAt = openPairs[0].key;
	});

	const codeUp = $derived(code.trim().toUpperCase());
	const codeTaken = $derived(house.panels.find((p) => p.shortCode?.toUpperCase() === codeUp) ?? null);
	const codeWhy = $derived(
		!codeUp ? '' : !/^[A-Z]{1,3}$/.test(codeUp) ? 'Use 1–3 letters.' : codeTaken ? `“${codeUp}” is already used by ${codeTaken.name}.` : ''
	);
	const pair = $derived(openPairs.find((o) => o.key === openAt) ?? null);
	const ready = $derived(!!name.trim() && !!codeUp && !codeWhy && (fedBy !== 'new' || !!pair));

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!ready) return;
		onadd({
			name: name.trim(),
			shortCode: codeUp,
			slotCount: spaces,
			mainAmps: mainAmps ? Number(mainAmps) : null,
			location: location.trim() || null,
			fedBy: fedBy === 'new' ? { panelId: pair!.panelId, slot: pair!.slot, amps } : { breakerId: Number(fedBy) }
		});
	}
	let nameInput = $state<HTMLInputElement>();
	export function focus() {
		nameInput?.focus();
	}
</script>

<form class="sf" onsubmit={submit}>
	<div class="row">
		<h2 class="ov">Add subpanel</h2>
		<button type="button" class="ibtn" aria-label="Cancel new subpanel" onclick={oncancel}><Icon name="close" size={16} /></button>
	</div>
	<div class="g">
		<div class="fld">
			<label for="s-name">Name</label>
			<input id="s-name" class="inp" type="text" placeholder="Garage subpanel" bind:value={name} bind:this={nameInput} autocomplete="off" />
		</div>
		<div class="fld">
			<label for="s-code">Short code</label>
			<input
				id="s-code"
				class="inp"
				type="text"
				placeholder="G"
				maxlength="3"
				bind:value={code}
				autocomplete="off"
				aria-invalid={!!codeWhy}
				aria-describedby={codeWhy ? 's-code-e' : undefined}
			/>
		</div>
		<div class="fld">
			<label for="s-fed">Fed by</label>
			<select id="s-fed" class="inp" bind:value={fedBy}>
				{#each twoPoles as b (b.id)}
					<option value={String(b.id)}>{ix.slotOf(b)} — {b.amps}A 2-pole · {b.label.trim() || 'Unlabeled'}{where(b.panelId)}</option>
				{/each}
				<option value="new">New breaker in an open slot…</option>
			</select>
		</div>
		<div class="fld">
			<label for="s-sp">Spaces</label>
			<select id="s-sp" class="inp" bind:value={spaces}>
				{#each SUB_SPACES as n (n)}<option value={n}>{n}</option>{/each}
			</select>
		</div>
		{#if fedBy === 'new'}
			<div class="fld">
				<label for="s-at">Open slot</label>
				<select id="s-at" class="inp" bind:value={openAt} disabled={!openPairs.length}>
					{#each openPairs as o (o.key)}<option value={o.key}>{o.text}</option>{/each}
					{#if !openPairs.length}<option value="">No room for a 2-pole breaker</option>{/if}
				</select>
			</div>
			<div class="fld">
				<label for="s-fa">Feeder</label>
				<select id="s-fa" class="inp" bind:value={amps}>
					{#each FEEDER_AMPS as a (a)}<option value={a}>{a}A 2-pole</option>{/each}
				</select>
			</div>
		{/if}
		<div class="fld">
			<label for="s-ma">Main breaker</label>
			<select id="s-ma" class="inp" bind:value={mainAmps}>
				<option value="">None (main lugs)</option>
				{#each SUB_MAIN_AMPS as a (a)}<option value={String(a)}>{a} A</option>{/each}
			</select>
		</div>
		<div class="fld">
			<label for="s-loc">Location</label>
			<input id="s-loc" class="inp" type="text" placeholder="e.g. detached garage" bind:value={location} autocomplete="off" />
		</div>
	</div>
	{#if codeWhy}<span class="err" id="s-code-e" role="alert">{codeWhy}</span>{/if}
	<p class="hint">
		Short code prefixes every breaker in it (G1, G3/5). The feeder’s label becomes the subpanel’s name. Subpanels usually have main lugs
		instead of a main breaker — the feeder is the shutoff.
	</p>
	<div class="acts">
		<button type="button" class="btn" onclick={oncancel}>Cancel</button>
		<button type="submit" class="btn btn-pri" disabled={!ready}>Add subpanel</button>
	</div>
</form>

<style>
	.sf {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.g {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
		gap: 14px;
	}
	.hint {
		font-size: 13px;
		line-height: 1.5;
		color: var(--soft);
	}
	.err {
		font-size: 13px;
		color: var(--warn);
	}
	.acts {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
	}
</style>
