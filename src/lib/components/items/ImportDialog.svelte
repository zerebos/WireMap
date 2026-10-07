<script lang="ts">
	// Import items from CSV (DESIGN.md §5.20, mockups/ImportCsv.dc.html and ImportCsvStates.dc.html):
	// match columns, check values, import, done. File problems use the same shell without the stepper.
	// Nothing is written before the Import button, and then in one all-or-nothing write.
	import { onMount, tick, untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { mutate, plural, type House } from '$lib/house';
	import { importItems } from '$lib/db/ops';
	import { ITEM_TYPES, ITEM_TYPE_LABELS, type ItemType } from '$lib/constants';
	import {
		CsvError,
		MAX_ROWS,
		TARGETS,
		guessColumns,
		looksLikeHeader,
		parse,
		plan,
		toImport,
		type Choices,
		type CsvProblem,
		type FloorChoice,
		type Target,
		type TypeChoice
	} from '$lib/csv';
	import { viewport } from '$lib/viewport.svelte';

	let {
		house,
		file,
		onclose,
		onchoose,
		onshowmissing
	}: {
		house: House;
		/** The chosen file; `text` is null when it isn't a CSV at all. */
		file: { name: string; text: string | null };
		onclose: () => void;
		/** Opens the file picker again ("Choose a different file"). */
		onchoose: () => void;
		/** "Show the N without a breaker": closes and turns on Needs attention. */
		onshowmissing: () => void;
	} = $props();

	// The dialog is remounted for each file, so the file is read once.
	const loaded = untrack((): { rows: string[][] } | { problem: CsvProblem; count: number } => {
		if (file.text === null) return { problem: 'unreadable', count: 0 };
		try {
			return { rows: parse(file.text) };
		} catch (e) {
			return e instanceof CsvError ? { problem: e.problem, count: e.rows } : { problem: 'unreadable', count: 0 };
		}
	});
	const rows = 'rows' in loaded ? loaded.rows : [];
	const width = rows[0]?.length ?? 0;

	let dlg = $state<HTMLDialogElement>();
	onMount(() => dlg?.showModal());

	// ---- Step 1: match columns
	let step = $state<1 | 2 | 3 | 4>(1);
	const guessFor = (on: boolean): Target[] => (on ? guessColumns(rows[0]) : rows[0].map(() => 'ignore'));
	const header0 = rows.length > 0 && looksLikeHeader(rows[0]);
	let header = $state(header0);
	/** What each column was guessed as, so a change can say "Changed by you". */
	let guessed = $state<Target[]>(rows.length ? guessFor(header0) : []);
	let columns = $state<Target[]>(rows.length ? guessFor(header0) : []);
	const data = $derived(header ? rows.slice(1) : rows);

	function setHeader(on: boolean) {
		header = on;
		guessed = guessFor(on);
		columns = [...guessed];
	}
	/** Each target goes to one column: picking it again moves it. */
	function pick(i: number, t: Target) {
		columns = columns.map((c, n) => (n === i ? t : t !== 'ignore' && c === t ? 'ignore' : c));
	}
	const colName = (i: number) => (header && rows[0][i]?.trim()) || `Column ${i + 1}`;
	const samples = (i: number) =>
		data
			.slice(0, 3)
			.map((r) => r[i]?.trim().replace(/\s+/g, ' ') || '—')
			.join(' · ');
	const colNote = (i: number) =>
		columns[i] === 'ignore' ? 'Not imported' : columns[i] === guessed[i] ? 'Matched from the column name' : 'Changed by you';
	const noName = $derived(!columns.includes('name'));
	const noType = $derived(!columns.includes('type'));

	// ---- Step 2: check values
	let choices = $state<Choices>({ types: {}, floors: {}, duplicates: 'skip' });
	const p = $derived(plan(house, rows, { header, columns }, choices));
	const unmatched = $derived(p.types.filter((t) => t.match === 'none' && t.choice === 'skip'));
	const quoted = (vs: string[]) => {
		const q = vs.map((v) => `“${v}”`);
		return q.length > 1 ? `${q.slice(0, -1).join(', ')} or ${q[q.length - 1]}` : q[0];
	};
	const few = (vs: string[], n: number) => (vs.length > n ? `${vs.slice(0, n).join(', ')} and ${vs.length - n} more` : vs.join(', '));
	const typeOf = (key: string, v: string) => (choices.types = { ...choices.types, [key]: v as TypeChoice });
	const floorOf = (key: string, v: string) =>
		(choices.floors = { ...choices.floors, [key]: (v === 'new' || v === 'none' ? v : Number(v)) as FloorChoice });
	const typeHint = (match: string, choice: TypeChoice) =>
		match === 'none'
			? choice === 'skip'
				? 'Not a type Breakerbook knows. Pick one, or these rows are skipped.'
				: 'Picked by you'
			: match === 'guess'
				? 'Best guess, check it'
				: '';
	const floorHint = (match: string, choice: FloorChoice) =>
		choice === 'none'
			? 'Items come in with no floor and no room.'
			: match === 'none'
				? choice === 'new'
					? 'No floor by that name. A new floor tab will be added.'
					: 'Picked by you'
				: match === 'guess'
					? 'Best guess from the name, check it'
					: '';
	const floorName = (c: FloorChoice, value: string) =>
		c === 'new' ? 'New floor' : c === 'none' ? 'No floor' : (house.floors.find((f) => f.id === c)?.name ?? value);
	const shown = $derived(p.rows.slice(0, 8));
	const typeLabel = (t: ItemType) => ITEM_TYPE_LABELS[t].one;

	// ---- Step 3: import
	const yourChoices = $derived([
		...(p.noType ? [{ k: 'Every row', v: typeLabel(p.allType) }] : []),
		// Values Breakerbook couldn't match come first; floors guessed from their names aren't repeated here.
		...[...p.types.filter((t) => t.match === 'none'), ...p.types.filter((t) => t.match === 'guess')].map((t) => ({
			k: `“${t.value}”`,
			v: t.choice === 'skip' ? `Skipped (${plural(t.rows, 'row')})` : typeLabel(t.choice)
		})),
		...p.floors
			.filter((f) => f.match === 'none' || typeof f.choice !== 'number')
			.map((f) => ({ k: `“${f.value}”`, v: floorName(f.choice, f.value) })),
		...(p.dupes.rows ? [{ k: 'Possible duplicates', v: p.duplicates === 'skip' ? `Skipped (${p.dupes.rows})` : 'Imported anyway' }] : [])
	]);
	let busy = $state(false);
	let failed = $state('');
	let done = $state<{ items: number; rooms: number; floors: string[]; noBreaker: number } | null>(null);
	async function runImport() {
		busy = true;
		failed = '';
		const result = { items: p.counts.items, rooms: p.counts.rooms, floors: [...p.newFloors], noBreaker: p.counts.noBreaker };
		try {
			await mutate(() => importItems(toImport(p)));
			done = result;
			step = 4;
		} catch (e) {
			failed = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
	const doneLine = $derived.by(() => {
		if (!done) return '';
		const added = [
			...(done.rooms ? [plural(done.rooms, 'new room')] : []),
			...(done.floors.length === 1
				? [`a new floor (${done.floors[0]})`]
				: done.floors.length
					? [`${done.floors.length} new floors (${done.floors.join(', ')})`]
					: [])
		];
		const total = done.rooms + done.floors.length;
		const a = added.length ? `${added.join(' and ')} ${total === 1 ? 'was' : 'were'} added.` : '';
		const b = done.noBreaker
			? `${plural(done.noBreaker, 'item')} ${done.noBreaker === 1 ? 'has' : 'have'} no breaker yet: trace them, or pick one in the item.`
			: '';
		return [a, b].filter(Boolean).join(' ');
	});

	// ---- Shell
	const STEPS = ['Match columns', 'Check values', 'Import'];
	const problem = 'problem' in loaded ? loaded : null;
	const fileName = untrack(() => file.name);
	const problemText = problem
		? {
				unreadable: [
					`Couldn’t read “${fileName}”`,
					'Breakerbook imports CSV files. In your spreadsheet app, use File › Download or Export › CSV, then choose that file.'
				],
				empty: [`“${fileName}” has no rows`, 'The file is empty, or holds only the column names.'],
				'too-big': [
					'That’s more than one import can take',
					`“${fileName}” has ${problem.count.toLocaleString('en-US')} rows. The limit is ${MAX_ROWS.toLocaleString('en-US')}. Split it into smaller files and import them one after another.`
				]
			}[problem.problem]
		: null;
	const foot = $derived(
		problem
			? ''
			: step === 1
				? noName
					? 'A name column is required.'
					: `${plural(width, 'column')} · ${columns.filter((c) => c !== 'ignore').length} imported`
				: step === 2
					? unmatched.length
						? `${plural(unmatched.reduce((n, t) => n + t.rows, 0), 'row')} will be skipped unless you pick a type for ${quoted(unmatched.map((t) => t.value || '(empty)'))}.`
						: 'Everything has a match.'
					: step === 3
						? 'Nothing is saved until you import.'
						: 'They’re on the Items page now.'
	);
	const primary = $derived(
		step === 1 ? 'Next: check values' : step === 2 ? 'Next: review' : step === 3 ? `Import ${plural(p.counts.items, 'item')}` : 'Done'
	);
	function next() {
		if (step === 3) return void runImport();
		if (step === 4) return onclose();
		step = (step + 1) as 2 | 3;
	}
	/** Back to step 2, with focus on its first choice (the link itself goes away). */
	async function changeThese() {
		step = 2;
		await tick();
		dlg?.querySelector<HTMLElement>('.s2 select')?.focus();
	}
	function oncancel(e: Event) {
		e.preventDefault();
		if (!busy) onclose();
	}
</script>

{#snippet preview()}
	<div class="ptbl">
		<div class="prow phead" aria-hidden="true"><span>Row</span><span>Name</span><span>Type</span><span>Floor</span><span>Room</span><span>Breaker</span></div>
		<ul aria-label="Preview">
			{#each shown as r (r.line)}
				<li class="prow" class:is-skip={r.skip}>
					<span class="mono dim">{r.line}<span class="sr">{r.skip ? ', skipped' : ''}</span></span>
					<span class="pc nm" class:pw={!r.name}>{r.name || 'No name'}</span>
					<span class="pc" class:pw={!r.type}>{r.type ? typeLabel(r.type) : `“${r.typeValue}”`}</span>
					<span class="pc" class:pw={r.floorDropped}>{r.floor ?? (r.floorDropped ? 'No floor' : '—')}</span>
					<span class="pc"
						><span class="ell">{r.room ?? '—'}</span>{#if r.roomNew && !r.skip}<span class="tag new">NEW</span>{/if}</span>
					<span class="pc mono" class:pw={r.breakerMissing}>{r.breakers || '—'}</span>
				</li>
			{/each}
		</ul>
	</div>
{/snippet}

<dialog bind:this={dlg} class="imp" class:small={!!problem} aria-labelledby="imp-t" {oncancel}>
	<div class="dh">
		{#if viewport.phone && !problem}
			<div class="ttl">
				<h2 id="imp-t" class="pt">Import · {step === 4 ? 'Done' : `${step} of 3`}</h2>
			</div>
		{:else}
			<div class="ttl">
				<span class="ov">Import items</span>
				<h2 id="imp-t">{problemText ? problemText[0] : file.name}</h2>
				{#if !problem}
					<span class="mono meta"
						>{plural(data.length, 'row')} · {plural(width, 'column')} · <button type="button" class="lnk" onclick={onchoose}
							>Choose a different file</button></span>
				{/if}
			</div>
			{#if !problem}
				<ol class="steps" aria-label="Steps">
					{#each STEPS as label, i (label)}
						{@const n = i + 1}
						{@const isDone = n < step}
						<li class="st" class:is-on={n === step} class:is-done={isDone} aria-current={n === step ? 'step' : undefined}>
							<span class="sn">{#if isDone}✓<span class="sr">Done:</span>{:else}{n}{/if}</span>{label}
						</li>
					{/each}
				</ol>
			{/if}
		{/if}
		<button type="button" class="ibtn" aria-label="Close import" disabled={busy} onclick={onclose}><Icon name="close" size={18} stroke={2.2} /></button>
	</div>

	{#if problemText}
		<div class="db prob"><p class="eb">{problemText[1]}</p></div>
	{:else if step === 1}
		<div class="db s1">
			<div class="intro">
				<p>Tell Breakerbook what each column holds. We guessed from the column names; change anything that’s wrong.</p>
				<label class="chk"
					><input type="checkbox" checked={header} onchange={(e) => setHeader(e.currentTarget.checked)} /><span
						>First row is column names</span></label>
			</div>
			<div class="mtbl">
				<div class="mrow mhead" aria-hidden="true"><span>Column in your file</span><span>Sample values</span><span>Use as</span></div>
				{#each columns as c, i (i)}
					<div class="mrow" class:is-off={c === 'ignore'}>
						<span class="cn"><span class="cnm">{colName(i)}</span><span class="mono cnote">{colNote(i)}</span></span>
						<span class="mono samp">{samples(i)}</span>
						<span>
							<label class="sr" for="imp-c{i}">Use column {colName(i)} as</label>
							<select id="imp-c{i}" class="inp" value={c} onchange={(e) => pick(i, e.currentTarget.value as Target)}>
								{#each TARGETS as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
							</select>
						</span>
					</div>
				{/each}
			</div>
			{#if noName}
				<div class="alert" role="alert">
					<Icon name="warning" size={18} /><span>Pick the column that holds each item’s <strong>name</strong>. It’s the only one that’s required.</span>
				</div>
			{/if}
			{#if noType}<div class="note">No type column: on the next step you’ll pick one type for every row.</div>{/if}
			<div class="note">
				Breakers can be slot numbers (<span class="mono">16</span>, <span class="mono">1/3</span>, <span class="mono">17A</span>,
				<span class="mono">G6</span>), several joined with + (<span class="mono">14 + 21</span>), or a breaker’s label. Each “Use
				as” can be picked once; picking it again moves it.
			</div>
		</div>
	{:else if step === 2}
		<div class="db s2">
			<div class="groups">
				<section class="grp" aria-labelledby="imp-gt">
					<div class="gh">
						<h3 id="imp-gt" class="gt">Types</h3>
						<span class="mono gc"
							>{p.noType
								? 'No type column'
								: `${plural(p.types.length, 'value')} · ${unmatched.length ? `${unmatched.length} to pick` : 'all matched'}`}</span>
					</div>
					{#if p.noType}
						<div class="vrow one">
							<span class="vv"><span class="vn">Every row is a</span><span class="mono vc">{plural(data.length, 'row')}</span></span>
							<span>
								<label class="sr" for="imp-all">Type for every row</label>
								<select
									id="imp-all"
									class="inp vsel"
									value={p.allType}
									onchange={(e) => (choices.allType = e.currentTarget.value as ItemType)}>
									{#each ITEM_TYPES as t (t)}<option value={t}>{typeLabel(t)}</option>{/each}
								</select>
							</span>
						</div>
					{:else}
						{#each p.types as t, i (t.key)}
							{@const hint = typeHint(t.match, t.choice)}
							<div class="vrow">
								<span class="vv"><span class="vn">{t.value ? `“${t.value}”` : '(empty)'}</span><span class="mono vc">{plural(t.rows, 'row')}</span></span>
								<span class="arr" aria-hidden="true">→</span>
								<span class="vs">
									<label class="sr" for="imp-t{i}">Type for {t.value ? `“${t.value}”` : 'empty cells'}</label>
									<select
										id="imp-t{i}"
										class="inp vsel"
										class:is-warn={t.match === 'none' && t.choice === 'skip'}
										value={t.choice}
										aria-describedby={hint ? `imp-th${i}` : undefined}
										onchange={(e) => typeOf(t.key, e.currentTarget.value)}>
										{#each ITEM_TYPES as o (o)}<option value={o}>{typeLabel(o)}</option>{/each}
										<option value="skip">Skip these rows</option>
									</select>
									{#if hint}<span class="hintl" id="imp-th{i}">{hint}</span>{/if}
								</span>
							</div>
						{/each}
					{/if}
				</section>

				{#if !p.noFloor}
					<section class="grp" aria-labelledby="imp-gf">
						<div class="gh">
							<h3 id="imp-gf" class="gt">Floors</h3>
							{#if p.floors.length}
								{@const nNew = p.floors.filter((f) => f.choice === 'new').length}
								<span class="mono gc">{plural(p.floors.length, 'value')} · {nNew ? `${nNew} new` : 'all existing'}</span>
							{/if}
						</div>
						{#each p.floors as f, i (f.key)}
							{@const hint = floorHint(f.match, f.choice)}
							<div class="vrow">
								<span class="vv"><span class="vn">“{f.value}”</span><span class="mono vc">{plural(f.rows, 'row')}</span></span>
								<span class="arr" aria-hidden="true">→</span>
								<span class="vs">
									<label class="sr" for="imp-f{i}">Floor for “{f.value}”</label>
									<select
										id="imp-f{i}"
										class="inp vsel"
										value={String(f.choice)}
										aria-describedby={hint ? `imp-fh${i}` : undefined}
										onchange={(e) => floorOf(f.key, e.currentTarget.value)}>
										{#each house.floors as o (o.id)}<option value={String(o.id)}>{o.name}</option>{/each}
										<option value="new">New floor “{f.value}”</option>
										<option value="none">No floor</option>
									</select>
									{#if hint}<span class="hintl" id="imp-fh{i}">{hint}</span>{/if}
								</span>
							</div>
						{/each}
					</section>
				{/if}

				{#if p.newRooms.length || p.missing.rows || p.dupes.rows}
					<section class="grp" aria-labelledby="imp-gh">
						<div class="gh"><h3 id="imp-gh" class="gt">Heads up</h3></div>
						{#if p.newRooms.length}
							<div class="hu">
								<span class="hi ok" aria-hidden="true">+</span><span
									><strong>{plural(p.newRooms.length, 'new room')}</strong>
									will be created: {few(
										p.newRooms.map((r) => r.name),
										8
									)}. They start without a shape; draw them in Edit layout.</span>
							</div>
						{/if}
						{#if p.missing.rows}
							<div class="hu">
								<span class="hi warn" aria-hidden="true">!</span><span
									><strong>{plural(p.missing.rows, 'row')}</strong>
									{p.missing.rows === 1 ? 'names' : 'name'} a breaker we can’t find ({few(
										p.missing.values.map((v) => `“${v}”`),
										4
									)}). {p.missing.rows === 1 ? 'It’ll' : 'They’ll'} come in with no breaker and show under Needs attention.</span>
							</div>
						{/if}
						{#if p.dupes.rows}
							<div class="hu">
								<span class="hi warn" aria-hidden="true">!</span>
								<span class="hud">
									<span
										><strong>{plural(p.dupes.rows, 'row')}</strong>
										{p.dupes.rows === 1 ? 'looks like an item' : 'look like items'} you already have (same name and room): {few(
											p.dupes.names,
											5
										)}.</span>
									<span class="seg" role="group" aria-label="Duplicates">
										<button
											type="button"
											class="sb"
											class:is-on={p.duplicates === 'skip'}
											aria-pressed={p.duplicates === 'skip'}
											onclick={() => (choices.duplicates = 'skip')}>Skip them</button>
										<button
											type="button"
											class="sb"
											class:is-on={p.duplicates === 'add'}
											aria-pressed={p.duplicates === 'add'}
											onclick={() => (choices.duplicates = 'add')}>Import anyway</button>
									</span>
								</span>
							</div>
						{/if}
					</section>
				{/if}

				{#if viewport.phone}
					<details class="pdet">
						<summary>Preview ({plural(shown.length, 'row')})</summary>
						{@render preview()}
					</details>
				{/if}
			</div>

			{#if !viewport.phone}
				<div class="prev">
					<div class="ph">
						<h3 class="gt">Preview</h3>
						<span class="mono gc"
							>{data.length > shown.length ? `First ${shown.length} of ${data.length} rows` : plural(data.length, 'row')}, as they’ll be imported</span>
					</div>
					<div class="pscroll">{@render preview()}</div>
					<div class="legend">
						<span class="lg"><span class="hi warn sm" aria-hidden="true">!</span>needs a look</span><span>Struck-through rows are skipped.</span>
					</div>
				</div>
			{/if}
		</div>
	{:else if step === 3}
		<div class="db s3">
			<div class="sum-l">
				<h3 class="rt">Ready to import {plural(p.counts.items, 'item')}</h3>
				<div class="sumgrid">
					{#each [[p.counts.items, p.counts.items === 1 ? 'item added' : 'items added'], [p.counts.rooms, p.counts.rooms === 1 ? 'new room' : 'new rooms'], [p.counts.floors, p.counts.floors === 1 || p.counts.floors === 0 ? 'new floor' : 'new floors'], [p.counts.noBreaker, 'without a breaker'], [p.counts.skipped, p.counts.skipped === 1 ? 'row skipped' : 'rows skipped']] as const as [n, l] (l)}
						<div class="sum"><span class="sv">{n}</span><span class="sl">{l}</span></div>
					{/each}
				</div>
				<ul class="bul">
					<li>Imported items aren’t on the map yet. Place them from <strong>Not placed</strong> in Edit layout.</li>
					<li>Items are only added. Nothing you already have is changed or removed.</li>
					<li>The import is all or nothing: if something fails, nothing is saved.</li>
				</ul>
			</div>
			{#if yourChoices.length}
				<div class="sum-r">
					<h3 class="gt">Your choices</h3>
					{#each yourChoices as c, i (i)}
						<div class="ch"><span class="chk-k">{c.k}</span><span class="chk-v">{c.v}</span></div>
					{/each}
					<button type="button" class="lnk sm" onclick={changeThese}>Change these</button>
				</div>
			{/if}
		</div>
	{:else if done}
		<div class="db s4">
			<span class="disc" aria-hidden="true"><Icon name="check" size={30} stroke={2.4} /></span>
			<h3 class="dt" role="status">Imported {plural(done.items, 'item')}</h3>
			{#if doneLine}<p class="dl">{doneLine}</p>{/if}
		</div>
	{/if}

	<div class="df">
		{#if failed}
			<span class="fs warn" role="alert">Couldn’t import, so nothing was saved. {failed}</span>
		{:else}
			<span class="fs">{foot}</span>
		{/if}
		{#if problem}
			<button type="button" class="btn ghost" onclick={onclose}>Cancel</button>
			<button type="button" class="btn btn-pri" onclick={onchoose}>Choose another file</button>
		{:else}
			{#if step === 2 || step === 3}<button type="button" class="btn" disabled={busy} onclick={() => (step = (step - 1) as 1 | 2)}>Back</button>{/if}
			{#if step !== 4}<button type="button" class="btn ghost" disabled={busy} onclick={onclose}>Cancel</button>{/if}
			{#if step === 4 && done?.noBreaker}
				<button type="button" class="btn" onclick={onshowmissing}>Show the {done.noBreaker} without a breaker</button>
			{/if}
			<button
				type="button"
				class="btn btn-pri"
				disabled={busy || (step === 1 && noName) || (step === 3 && p.counts.items === 0)}
				onclick={next}>{primary}</button>
		{/if}
	</div>
</dialog>

<style>
	.imp {
		width: 1040px;
		height: 820px;
		max-width: calc(100vw - 32px);
		max-height: calc(100vh - 32px);
		padding: 0;
		border: 1px solid var(--line-2);
		border-radius: var(--r-2xl);
		background: var(--surface);
		color: var(--ink);
		box-shadow: var(--shadow-dialog);
		overflow: hidden;
	}
	.imp[open] {
		display: flex;
		flex-direction: column;
	}
	.imp.small {
		width: 640px;
		height: fit-content;
	}
	.imp::backdrop {
		background: var(--scrim);
	}

	/* Header */
	.dh {
		flex-shrink: 0;
		padding: 22px 28px 18px;
		display: flex;
		align-items: flex-start;
		gap: 16px;
		border-bottom: 1px solid var(--line);
	}
	.ttl {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	h2 {
		font-size: 24px;
		font-weight: 800;
		font-stretch: 108%;
		letter-spacing: -0.01em;
		overflow-wrap: anywhere;
	}
	.meta {
		font-size: 12px;
		color: var(--muted);
	}
	.lnk {
		padding: 0;
		border: 0;
		background: transparent;
		font: inherit;
		color: var(--ink);
		text-decoration: underline;
		cursor: pointer;
	}
	.lnk:hover {
		color: var(--amber-ink);
	}
	.lnk.sm {
		align-self: flex-start;
		font-size: 13px;
	}
	.steps {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
		display: flex;
		gap: 6px;
		align-items: center;
		flex-shrink: 0;
	}
	.st {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 34px;
		padding: 0 12px 0 6px;
		border-radius: 17px;
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
		white-space: nowrap;
	}
	.sn {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 1.5px solid var(--line-2);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.st.is-on {
		background: var(--amber-soft);
		color: var(--ink);
	}
	.st.is-on .sn {
		background: var(--amber);
		border-color: var(--amber);
		color: var(--on-amber);
	}
	.st.is-done {
		color: var(--soft);
	}
	.st.is-done .sn {
		border-color: var(--ok);
		color: var(--ok);
	}

	/* Body */
	.db {
		flex-grow: 1;
		min-height: 0;
	}
	.prob {
		padding: 22px 28px;
	}
	.eb {
		font-size: 15px;
		color: var(--soft);
		line-height: 1.5;
	}
	.s1 {
		overflow: auto;
		padding: 22px 28px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.intro {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.intro p {
		font-size: 15px;
		color: var(--soft);
		line-height: 1.5;
		max-width: 620px;
	}
	.intro .chk {
		align-items: center;
		font-size: 14px;
		white-space: nowrap;
	}
	.intro .chk input {
		margin: 0;
	}
	.mtbl {
		flex-shrink: 0;
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		overflow: hidden;
	}
	.mrow {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr) 240px;
		align-items: center;
		column-gap: 20px;
		padding: 10px 16px;
		min-height: 64px;
		border-bottom: 1px solid var(--line);
	}
	.mrow:last-child {
		border-bottom: 0;
	}
	.mrow.is-off {
		background: var(--raised);
	}
	.mrow.is-off .samp {
		opacity: 0.6;
	}
	.mhead {
		min-height: 40px;
		padding: 0 16px;
		background: var(--raised);
		border-bottom: 1px solid var(--line-2);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.cn {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.cnm {
		font-size: 15px;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cnote {
		font-size: 11px;
		color: var(--muted);
	}
	.samp {
		font-size: 12px;
		color: var(--soft);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.alert {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 12px 14px;
		border: 1px solid var(--warn);
		border-radius: var(--r-lg);
		color: var(--warn);
		font-size: 14px;
		line-height: 1.45;
	}
	.alert span {
		color: var(--ink);
	}
	.note {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.5;
	}

	/* Step 2 */
	.s2 {
		display: flex;
	}
	.groups {
		width: 440px;
		flex-shrink: 0;
		overflow: auto;
		padding: 20px 24px 24px 28px;
		display: flex;
		flex-direction: column;
		gap: 18px;
		border-right: 1px solid var(--line);
	}
	.grp {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.gh {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding-bottom: 6px;
		border-bottom: 1px solid var(--line);
	}
	.gt {
		font-size: 15px;
		font-weight: 800;
	}
	h3 {
		margin: 0;
	}
	.gc {
		font-size: 11px;
		color: var(--muted);
	}
	.vrow {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 16px 190px;
		align-items: start;
		column-gap: 10px;
	}
	.vrow.one {
		grid-template-columns: minmax(0, 1fr) 190px;
	}
	.vv {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-top: 9px;
		font-size: 14px;
		min-width: 0;
	}
	.vn {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.vc {
		font-size: 11px;
		color: var(--muted);
	}
	.arr {
		padding-top: 10px;
		color: var(--muted);
		font-size: 14px;
	}
	.vs {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.vsel {
		height: 40px;
	}
	.vsel.is-warn {
		border-color: var(--warn);
		border-width: 1.5px;
	}
	.hintl {
		font-size: 11px;
		color: var(--muted);
		line-height: 1.35;
	}
	.hu {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		font-size: 13px;
		line-height: 1.5;
		color: var(--soft);
	}
	.hu strong {
		color: var(--ink);
	}
	.hud {
		display: flex;
		flex-direction: column;
		gap: 8px;
		flex-grow: 1;
	}
	.hud .seg {
		align-self: flex-start;
	}
	.hi {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		font-weight: 800;
		margin-top: 1px;
	}
	.hi.ok {
		background: var(--tag-bg);
		color: var(--tag-fg);
	}
	.hi.warn {
		background: var(--warn);
		color: var(--surface);
	}
	.hi.sm {
		width: 16px;
		height: 16px;
		font-size: 10px;
		margin: 0;
	}
	.prev {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		padding: 20px 28px 24px 24px;
		gap: 12px;
	}
	.ph {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.pscroll {
		flex-grow: 1;
		min-height: 0;
		overflow: auto;
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
	}
	.ptbl ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.prow {
		display: grid;
		grid-template-columns: 40px minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 0.9fr) minmax(0, 1.1fr) 84px;
		align-items: center;
		column-gap: 10px;
		padding: 0 14px;
		min-height: 44px;
		border-bottom: 1px solid var(--line);
		font-size: 13px;
	}
	.phead {
		min-height: 36px;
		background: var(--raised);
		border-bottom: 1px solid var(--line-2);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
		position: sticky;
		top: 0;
	}
	.pc {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: flex;
		align-items: center;
	}
	.pc.nm {
		font-weight: 600;
		display: block;
	}
	.ell {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dim {
		color: var(--muted);
	}
	.new {
		margin-left: 6px;
	}
	.pw {
		color: var(--warn);
		font-weight: 600;
	}
	.pw::before {
		content: '!';
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--warn);
		color: var(--surface);
		font-size: 9px;
		font-weight: 800;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-right: 6px;
		flex-shrink: 0;
		font-family: var(--font-ui);
	}
	.pc.nm.pw::before {
		display: inline-flex;
		vertical-align: middle;
	}
	.prow.is-skip {
		color: var(--muted);
	}
	.prow.is-skip .pc {
		text-decoration: line-through;
	}
	.prow.is-skip .pw {
		color: var(--muted);
	}
	.prow.is-skip .pw::before {
		display: none;
	}
	.legend {
		display: flex;
		gap: 16px;
		font-size: 12px;
		color: var(--muted);
	}
	.lg {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	/* Step 3 */
	.s3 {
		overflow: auto;
		padding: 28px;
		display: flex;
		gap: 32px;
	}
	.sum-l {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.rt {
		font-size: 22px;
		font-weight: 800;
		font-stretch: 108%;
	}
	.sumgrid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 10px;
	}
	.sum {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 14px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--raised);
	}
	.sv {
		font-family: var(--font-mono);
		font-size: 26px;
		font-weight: 600;
	}
	.sl {
		font-size: 12px;
		color: var(--muted);
	}
	.bul {
		margin: 0;
		padding-left: 18px;
		font-size: 14px;
		line-height: 1.7;
		color: var(--soft);
	}
	.sum-r {
		width: 340px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.ch {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-lg);
		font-size: 13px;
	}
	.chk-k {
		color: var(--muted);
	}
	.chk-v {
		font-weight: 600;
		text-align: right;
	}

	/* Done */
	.s4 {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		padding: 28px;
		text-align: center;
	}
	.disc {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: var(--amber-soft);
		color: var(--amber-ink);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.dt {
		font-size: 26px;
		font-weight: 800;
		font-stretch: 108%;
	}
	.dl {
		font-size: 15px;
		color: var(--soft);
		line-height: 1.5;
		max-width: 520px;
	}

	/* Footer */
	.df {
		flex-shrink: 0;
		padding: 16px 28px;
		display: flex;
		align-items: center;
		gap: 12px;
		border-top: 1px solid var(--line);
		background: var(--raised);
	}
	.fs {
		flex-grow: 1;
		font-size: 13px;
		color: var(--muted);
	}
	.fs.warn {
		color: var(--warn);
		font-weight: 600;
	}
	.ghost {
		border-color: transparent;
		background: transparent;
	}

	/* Phone (DESIGN.md §5.20): full screen, one column, sticky footer above the safe area. */
	@media (max-width: 699px) {
		.imp,
		.imp.small {
			width: 100vw;
			height: 100dvh;
			max-width: none;
			max-height: none;
			margin: 0;
			border: 0;
			border-radius: 0;
		}
		.dh {
			padding: 10px 12px 10px 16px;
			align-items: center;
		}
		h2 {
			font-size: 20px;
		}
		h2.pt {
			font-size: 17px;
		}
		.prob,
		.s1 {
			padding: 16px;
		}
		.intro {
			flex-direction: column;
			align-items: flex-start;
			gap: 12px;
		}
		.mtbl {
			border: 0;
			border-radius: 0;
			display: flex;
			flex-direction: column;
			gap: 10px;
			overflow: visible;
		}
		.mhead {
			display: none;
		}
		.mrow,
		.mrow:last-child {
			grid-template-columns: minmax(0, 1fr);
			row-gap: 6px;
			padding: 12px;
			border: 1px solid var(--line-2);
			border-radius: var(--r-xl);
		}
		.s2 {
			display: block;
			overflow: auto;
		}
		.groups {
			width: auto;
			overflow: visible;
			padding: 16px;
			border-right: 0;
		}
		.vrow {
			grid-template-columns: minmax(0, 1fr) 16px minmax(0, 170px);
		}
		.vrow.one {
			grid-template-columns: minmax(0, 1fr) minmax(0, 170px);
		}
		.pdet summary {
			min-height: var(--control-h);
			display: flex;
			align-items: center;
			font-size: 15px;
			font-weight: 800;
			cursor: pointer;
		}
		.pdet .ptbl {
			overflow-x: auto;
			border: 1px solid var(--line-2);
			border-radius: var(--r-xl);
		}
		.pdet .prow {
			min-width: 560px;
		}
		.s3 {
			flex-direction: column;
			padding: 16px;
			gap: 20px;
		}
		.sumgrid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.sum-r {
			width: auto;
		}
		.df {
			flex-wrap: wrap;
			padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
			gap: 8px;
		}
		.fs {
			flex-basis: 100%;
		}
		.df .btn-pri {
			flex-grow: 1;
		}
	}
</style>
