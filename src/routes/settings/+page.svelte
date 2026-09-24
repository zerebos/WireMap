<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { replaceState } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import { mutate, plural } from '$lib/house';
	import {
		createFloor,
		deleteFloor,
		moveFloor,
		setFloorPlan,
		updateFloor,
		updatePanel,
		updateSettings
	} from '$lib/db/ops';
	import { exportDatabase, importDatabase, resetDatabase } from '$lib/db';
	import { checkFit, occupiedSlots, slotLabel, spacesUsed } from '$lib/panel';
	import { MAIN_AMPS, SPACES, type Numbering, type Theme } from '$lib/constants';
	import { query } from '$lib/search.svelte';
	import { itemsCsv } from '$lib/csv';

	let { data } = $props();

	const house = $derived(data.house);
	const settings = $derived(house.settings);
	const panel = $derived(house.panel);

	// ---- Sections, and what the header search matches in each row

	const SECTIONS = [
		{ id: 'general', label: 'General' },
		{ id: 'appearance', label: 'Appearance' },
		{ id: 'panels', label: 'Panels' },
		{ id: 'floors', label: 'Floors' },
		{ id: 'data', label: 'Data & backups' },
		{ id: 'access', label: 'Access' }
	] as const;
	type SectionId = (typeof SECTIONS)[number]['id'];

	const ROWS: Record<SectionId, Record<string, string>> = $derived({
		general: {
			home: 'Home name. Shown in the browser tab and on exports.',
			start: 'Open to. The page you land on when you open Breakerbook. Panel Map Items'
		},
		appearance: {
			theme: 'Theme. System, match this device. Light, best in bright rooms. Dark, easy on the eyes.',
			legs: 'Show leg markers on the panel. Labels each row L1 or L2 so you can balance load across both legs.',
			fade: 'Fade other items on the map. When a circuit is selected, everything it doesn’t feed fades back.'
		},
		panels: {
			panel: 'Main panel. Add subpanel. Main breaker. Spaces. Slot numbering, odd left, even right, down the left, then the right. Location'
		},
		floors: {
			floors: `Floors. Top to bottom, the way the house stacks. Add floor. Floor plan image. Upload image. Replace image. Delete. ${house.floors.map((f) => f.name).join(' ')}`
		},
		data: {
			export: 'Export. Download backup. Export CSV. Everything: panels, breakers, items, floors, rooms and plan images.',
			import: 'Import. Restore from backup. Replaces everything here with the file’s contents.',
			storage: 'Keep data in this browser. Storage. Keep permanently.',
			auto: 'Automatic backups. A nightly snapshot.',
			keep: 'Keep backups for. Older snapshots are deleted automatically.',
			erase: 'Erase all data. Deletes every panel, item and floor. Load example house. Start over.'
		},
		access: {
			auth: 'Require sign-in. Turn off only if Breakerbook is reachable on your home network alone.',
			guest: 'Read-only guest view. Anyone on the network can see the panel and map without signing in. Tablet.',
			users: 'Users. People who can sign in and make changes. Add user. Change password. admin'
		}
	});

	const q = $derived(query());
	const sectionLabel = (id: SectionId) => SECTIONS.find((s) => s.id === id)!.label;
	/** Whether a row matches the search. Matching a section's name shows all of it. */
	const shows = (sec: SectionId, row: string) =>
		!q || sectionLabel(sec).toLowerCase().includes(q) || ROWS[sec][row].toLowerCase().includes(q);
	const sectionShows = (sec: SectionId) => Object.keys(ROWS[sec]).some((row) => shows(sec, row));
	const visibleSections = $derived(SECTIONS.filter((s) => sectionShows(s.id)));

	// ---- Section nav follows the scroll position

	let scroller = $state<HTMLElement>();
	let active = $state<SectionId>('general');
	let ignoreScrollUntil = 0;

	function onScroll() {
		if (!scroller || performance.now() < ignoreScrollUntil) return;
		const els = visibleSections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
		if (!els.length) return;
		const top = scroller.scrollTop;
		let current = els[0].id;
		for (const el of els) if (el.offsetTop - 40 <= top) current = el.id;
		if (top + scroller.clientHeight >= scroller.scrollHeight - 2) current = els[els.length - 1].id;
		active = current as SectionId;
	}

	function jump(e: MouseEvent, id: SectionId) {
		e.preventDefault();
		const el = document.getElementById(id);
		if (!el) return;
		ignoreScrollUntil = performance.now() + 250;
		active = id;
		el.scrollIntoView({ block: 'start' });
		replaceState(`#${id}`, {});
	}

	onMount(() => {
		const id = location.hash.slice(1);
		const el = SECTIONS.some((s) => s.id === id) ? document.getElementById(id) : null;
		if (el) {
			ignoreScrollUntil = performance.now() + 250;
			active = id as SectionId;
			el.scrollIntoView({ block: 'start' });
		}
	});

	$effect(() => {
		void q;
		tick().then(onScroll);
	});

	// ---- General

	function saveHome(e: Event & { currentTarget: HTMLInputElement }) {
		const name = e.currentTarget.value.trim();
		if (!name) return void (e.currentTarget.value = settings.homeName);
		if (name !== settings.homeName) mutate(() => updateSettings({ homeName: name }));
	}

	// ---- Appearance

	const THEME_CARDS: { value: Theme; label: string; sub: string; halves: ('l' | 'd')[] }[] = [
		{ value: 'system', label: 'System', sub: 'Match this device', halves: ['l', 'd'] },
		{ value: 'light', label: 'Light', sub: 'Best in bright rooms', halves: ['l'] },
		{ value: 'dark', label: 'Dark', sub: 'Easy on the eyes', halves: ['d'] }
	];

	// ---- Panels

	const mainBreakers = $derived(panel ? house.breakers.filter((b) => b.panelId === panel.id) : []);
	// A spaces or numbering choice that doesn't fit the breakers isn't saved; it waits here.
	let spacesPick = $state<number | null>(null);
	let numberingPick = $state<Numbering | null>(null);
	const shape = $derived(
		panel
			? { slotCount: spacesPick ?? panel.slotCount, numbering: numberingPick ?? panel.numbering }
			: { slotCount: 0, numbering: 'odd_left_even_right' as Numbering }
	);

	function fitProblem(s: { slotCount: number; numbering: Numbering }): string | null {
		const used = spacesUsed(mainBreakers);
		if (used > s.slotCount) {
			return `${used} spaces are in use. Move or remove breakers above slot ${s.slotCount} first.`;
		}
		const bad = mainBreakers.find((b) => checkFit(b, s, []));
		if (!bad) return null;
		if (occupiedSlots(bad, s).some((slot) => slot > s.slotCount)) {
			return `Breaker ${slotLabel(bad, s)} sits past slot ${s.slotCount}. Move or remove breakers above slot ${s.slotCount} first.`;
		}
		return `With this numbering, the 2-pole breaker at slot ${bad.slot} would span both columns. Move it first.`;
	}
	const problem = $derived(panel ? fitProblem(shape) : null);

	function tryShape(next: { slotCount?: number; numbering?: Numbering }) {
		if (!panel) return;
		if (next.slotCount !== undefined) spacesPick = next.slotCount;
		if (next.numbering !== undefined) numberingPick = next.numbering;
		const s = { slotCount: spacesPick ?? panel.slotCount, numbering: numberingPick ?? panel.numbering };
		if (fitProblem(s)) return;
		spacesPick = null;
		numberingPick = null;
		if (s.slotCount !== panel.slotCount || s.numbering !== panel.numbering) {
			const id = panel.id;
			mutate(() => updatePanel(id, s));
		}
	}

	function saveLocation(e: Event & { currentTarget: HTMLInputElement }) {
		if (!panel) return;
		const location = e.currentTarget.value.trim() || null;
		const id = panel.id;
		if (location !== panel.location) mutate(() => updatePanel(id, { location }));
	}

	// ---- Floors (top floor first)

	const floorsTopDown = $derived([...house.floors].reverse());
	const roomCount = (floorId: number) => house.rooms.filter((r) => r.floorId === floorId).length;
	const itemCount = (floorId: number) => house.items.filter((i) => i.floorId === floorId).length;
	let floorError = $state('');
	let planInput = $state<HTMLInputElement>();
	let planFor: number | null = null;
	const PLAN_OK = ['image/png', 'image/jpeg', 'image/webp'];

	function renameFloor(e: Event & { currentTarget: HTMLInputElement }, id: number, name: string) {
		const next = e.currentTarget.value.trim();
		if (!next) return void (e.currentTarget.value = name);
		if (next !== name) mutate(() => updateFloor(id, { name: next }));
	}

	function pickPlan(id: number) {
		planFor = id;
		floorError = '';
		planInput?.click();
	}

	async function uploadPlan(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		const id = planFor;
		if (!file || id === null) return;
		if (!PLAN_OK.includes(file.type)) {
			floorError = 'Floor plans can be PNG, JPG or WebP images.';
			return;
		}
		const url = URL.createObjectURL(file);
		try {
			const img = new Image();
			img.src = url;
			await img.decode();
			await mutate(() => setFloorPlan(id, file, { width: img.naturalWidth, height: img.naturalHeight }));
		} catch {
			floorError = "Couldn't read that image.";
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	async function removeFloor(id: number, name: string) {
		const rooms = roomCount(id);
		const items = itemCount(id);
		const what = rooms || items ? ` Its ${plural(rooms, 'room')} and ${plural(items, 'item')} are deleted too.` : '';
		if (!confirm(`Delete ${name}?${what}`)) return;
		await mutate(() => deleteFloor(id));
	}

	async function addFloor() {
		const id = await mutate(() => createFloor('New floor', { planWidth: 820, planHeight: 760 }));
		await tick();
		const input = document.getElementById(`floor-${id}`) as HTMLInputElement | null;
		input?.focus();
		input?.select();
	}

	// ---- Data & backups

	let busy = $state(false);
	let dataMsg = $state<{ text: string; error?: boolean } | null>(null);
	let restoreInput = $state<HTMLInputElement>();

	const today = () => {
		const d = new Date();
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	};
	const fileBase = () => settings.homeName.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Breakerbook';

	function save(blob: Blob, name: string) {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
	}

	async function downloadBackup() {
		busy = true;
		dataMsg = null;
		try {
			const bytes = await exportDatabase();
			save(new Blob([bytes as BlobPart], { type: 'application/vnd.sqlite3' }), `${fileBase()}-${today()}.sqlite`);
		} catch (e) {
			dataMsg = { text: e instanceof Error ? e.message : "Couldn't make a backup.", error: true };
		} finally {
			busy = false;
		}
	}

	function exportCsv() {
		save(new Blob([itemsCsv(house)], { type: 'text/csv' }), `${fileBase()}-items-${today()}.csv`);
	}

	async function restore(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		if (!file) return;
		if (!confirm(`Replace everything here with “${file.name}”? What's here now is deleted.`)) return;
		busy = true;
		dataMsg = null;
		try {
			await importDatabase(new Uint8Array(await file.arrayBuffer()));
			location.assign(resolve('/'));
		} catch (err) {
			dataMsg = { text: err instanceof Error ? err.message : "Couldn't restore that file.", error: true };
			busy = false;
		}
	}

	async function reset(example: boolean) {
		const question = example
			? 'Replace everything with the example house?'
			: 'Erase all data? Every panel, breaker, item and floor in this browser is deleted.';
		if (!confirm(`${question} Download a backup first if you might want it back.`)) return;
		busy = true;
		await resetDatabase({ example });
		location.assign(resolve('/'));
	}

	// Browser storage: ask the browser not to clear the data when space runs low.
	let persisted = $state<boolean | null>(null);
	let usage = $state<number | null>(null);
	let storageMsg = $state<{ text: string; error?: boolean } | null>(null);
	const canPersist = typeof navigator !== 'undefined' && !!navigator.storage?.persist;
	const size = (bytes: number) =>
		bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

	async function refreshStorage() {
		persisted = (await navigator.storage?.persisted?.()) ?? null;
		usage = (await navigator.storage?.estimate?.())?.usage ?? null;
	}
	onMount(() => void refreshStorage());

	async function keepPermanently() {
		const granted = await navigator.storage.persist();
		await refreshStorage();
		storageMsg = granted
			? { text: "Done. The browser won't clear this data to free up space." }
			: {
					text: 'The browser said no. Installing the app or using it more often usually changes that. Keep backups either way.',
					error: true
				};
	}
</script>


{#snippet preview(half: 'l' | 'd')}
	<div class="pv pv-{half}">
		<div class="pv-hdr"></div>
		<div class="pv-body">
			<div class="pv-side">
				<div class="pv-row"></div>
				<div class="pv-row on"></div>
				<div class="pv-row"></div>
				<div class="pv-row"></div>
			</div>
			<div class="pv-card">
				<div class="pv-line strong"></div>
				<div class="pv-line a"></div>
				<div class="pv-line b"></div>
			</div>
		</div>
	</div>
{/snippet}

{#snippet sw(on: boolean, labelledby: string, toggle?: () => void, disabled = false)}
	<button
		type="button"
		role="switch"
		class="sw"
		class:is-on={on}
		aria-checked={on}
		aria-labelledby={labelledby}
		onclick={toggle}
		{disabled}><span class="kn"></span></button
	>
{/snippet}

<div class="page">
	<aside>
		<h1>Settings</h1>
		<nav aria-label="Settings sections">
			{#each visibleSections as s (s.id)}
				<a
					class="snav"
					class:is-on={active === s.id}
					href="#{s.id}"
					aria-current={active === s.id ? 'true' : undefined}
					onclick={(e) => jump(e, s.id)}>{s.label}</a
				>
			{/each}
		</nav>
		<div class="grow"></div>
		<span class="saved"><span class="dot"></span>Changes save automatically</span>
	</aside>

	<div class="scroll" bind:this={scroller} onscroll={onScroll}>
		<div class="content">
			{#if !visibleSections.length}
				<p class="sd">No settings match “{q}”.</p>
			{/if}

			{#if sectionShows('general')}
				<section id="general">
					<h2 class="h2">General</h2>
					<div class="card">
						{#if shows('general', 'home')}
							<div class="row">
								<div class="lab">
									<label class="sl" for="s-home">Home name</label>
									<span class="sd">Shown in the browser tab and on exports.</span>
								</div>
								<input id="s-home" class="inp w280" type="text" value={settings.homeName} onchange={saveHome} />
							</div>
						{/if}
						{#if shows('general', 'start')}
							<div class="row">
								<div class="lab">
									<label class="sl" for="s-start">Open to</label>
									<span class="sd">The page you land on when you open Breakerbook.</span>
								</div>
								<select
									id="s-start"
									class="inp w280"
									value={settings.startPage}
									onchange={(e) =>
										mutate(() =>
											updateSettings({ startPage: e.currentTarget.value as typeof settings.startPage })
										)}
								>
									<option value="panel">Panel</option>
									<option value="map">Map</option>
									<option value="items">Items</option>
								</select>
							</div>
						{/if}
					</div>
				</section>
			{/if}

			{#if sectionShows('appearance')}
				<section id="appearance">
					<h2 class="h2">Appearance</h2>
					<div class="card" class:appear={shows('appearance', 'theme')}>
						{#if shows('appearance', 'theme')}
							<div class="themes">
								<span class="sl" id="theme-label">Theme</span>
								<div role="group" aria-labelledby="theme-label" class="tgrid">
									{#each THEME_CARDS as t (t.value)}
										<button
											type="button"
											class="tcard"
											class:is-on={settings.theme === t.value}
											aria-pressed={settings.theme === t.value}
											onclick={() => mutate(() => updateSettings({ theme: t.value }))}
										>
											<div class="pvs" aria-hidden="true">
												{#each t.halves as h (h)}{@render preview(h)}{/each}
											</div>
											<span class="tlab">
												<span class="radio"></span>
												<span class="tname">
													<span class="tn">{t.label}</span>
													<span class="ts">{t.sub}</span>
												</span>
											</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
						{#if shows('appearance', 'legs')}
							<div class="row">
								<div class="lab">
									<span class="sl" id="l-legs">Show leg markers on the panel</span>
									<span class="sd">Labels each row L1 or L2 so you can balance load across both legs.</span>
								</div>
								{@render sw(settings.showLegs, 'l-legs', () =>
									mutate(() => updateSettings({ showLegs: !settings.showLegs }))
								)}
							</div>
						{/if}
						{#if shows('appearance', 'fade')}
							<div class="row">
								<div class="lab">
									<span class="sl" id="l-dim">Fade other items on the map</span>
									<span class="sd">When a circuit is selected, everything it doesn’t feed fades back.</span>
								</div>
								{@render sw(settings.mapFadeOthers, 'l-dim', () =>
									mutate(() => updateSettings({ mapFadeOthers: !settings.mapFadeOthers }))
								)}
							</div>
						{/if}
					</div>
				</section>
			{/if}

			{#if sectionShows('panels')}
				<section id="panels">
					<div class="shead">
						<h2 class="h2">Panels</h2>
						<button type="button" class="btn" disabled title="Subpanels aren't designed yet">
							<Icon name="plus" size={16} stroke={2.2} />Add subpanel
						</button>
					</div>
					{#if panel}
						<div class="card pcard">
							<div class="pname">
								<span>{panel.name}</span>
								{#if panel.fedByBreakerId === null}<span class="tag">MAIN</span>{/if}
							</div>
							<div class="pgrid">
								<div class="fld">
									<label for="p-amp">Main breaker</label>
									<select
										id="p-amp"
										class="inp"
										value={panel.mainAmps ?? ''}
										onchange={(e) => {
											const id = panel.id;
											const v = e.currentTarget.value;
											mutate(() => updatePanel(id, { mainAmps: v ? Number(v) : null }));
										}}
									>
										{#if panel.mainAmps === null}<option value="">Not set</option>{/if}
										{#if panel.mainAmps !== null && !MAIN_AMPS.includes(panel.mainAmps)}
											<option value={panel.mainAmps}>{panel.mainAmps} A</option>
										{/if}
										{#each MAIN_AMPS as a (a)}<option value={a}>{a} A</option>{/each}
									</select>
								</div>
								<div class="fld">
									<label for="p-sp">Spaces</label>
									<select
										id="p-sp"
										class="inp"
										value={shape.slotCount}
										onchange={(e) => tryShape({ slotCount: Number(e.currentTarget.value) })}
									>
										{#if !SPACES.includes(panel.slotCount)}<option value={panel.slotCount}>{panel.slotCount}</option>{/if}
										{#each SPACES as n (n)}<option value={n}>{n}</option>{/each}
									</select>
								</div>
								<div class="fld">
									<label for="p-num">Slot numbering</label>
									<select
										id="p-num"
										class="inp"
										value={shape.numbering}
										onchange={(e) => tryShape({ numbering: e.currentTarget.value as Numbering })}
									>
										<option value="odd_left_even_right">Odd left, even right</option>
										<option value="down_left_then_right">Down the left, then the right</option>
									</select>
								</div>
							</div>
							<div class="fld">
								<label for="p-loc">Location</label>
								<input
									id="p-loc"
									class="inp"
									type="text"
									placeholder="Where the panel is, e.g. basement utility room"
									value={panel.location ?? ''}
									onchange={saveLocation}
								/>
							</div>
							{#if problem}
								<div class="shrink" role="status">
									<strong>Some breakers won’t fit.</strong>
									{problem} This change isn’t saved until they fit.
								</div>
							{/if}
						</div>
					{:else}
						<div class="card">
							<div class="row">
								<div class="lab">
									<span class="sl">No panel yet</span>
									<span class="sd"
										>Setting up a panel here isn’t available yet. Load the example house or restore a backup under Data
										&amp; backups.</span
									>
								</div>
							</div>
						</div>
					{/if}
				</section>
			{/if}

			{#if sectionShows('floors')}
				<section id="floors">
					<div class="shead">
						<div class="lab">
							<h2 class="h2">Floors</h2>
							<span class="sd">Top to bottom, the way the house stacks. The map’s floor tabs follow this order.</span>
						</div>
						<button type="button" class="btn" onclick={addFloor}><Icon name="plus" size={16} stroke={2.2} />Add floor</button>
					</div>
					<div class="card">
						{#each floorsTopDown as f, idx (f.id)}
							<div class="frow">
								<div class="moves">
									<button
										type="button"
										class="ibtn sm"
										aria-label="Move {f.name} up"
										disabled={idx === 0}
										onclick={() => mutate(() => moveFloor(f.id, 1))}><Icon name="up" size={14} stroke={2.2} /></button
									>
									<button
										type="button"
										class="ibtn sm"
										aria-label="Move {f.name} down"
										disabled={idx === floorsTopDown.length - 1}
										onclick={() => mutate(() => moveFloor(f.id, -1))}><Icon name="down" size={14} stroke={2.2} /></button
									>
								</div>
								<div class="fmain">
									<label class="sr" for="floor-{f.id}">Floor name</label>
									<input
										id="floor-{f.id}"
										class="rname"
										type="text"
										value={f.name}
										onchange={(e) => renameFloor(e, f.id, f.name)}
									/>
									<span class="fmeta">{plural(roomCount(f.id), 'room')} · {plural(itemCount(f.id), 'item')}</span>
								</div>
								<div class="fplan">
									{#if f.planImage}
										<span class="mono pfile">{f.planImage}</span>
									{:else}
										<span class="nop">No floor plan image</span>
									{/if}
									<button type="button" class="btn sm" onclick={() => pickPlan(f.id)}
										>{f.planImage ? 'Replace image' : 'Upload image'}</button
									>
									<button type="button" class="ibtn del" aria-label="Delete {f.name}" onclick={() => removeFloor(f.id, f.name)}
										><Icon name="trash" size={16} /></button
									>
								</div>
							</div>
						{:else}
							<div class="frow"><span class="nop">No floors yet.</span></div>
						{/each}
					</div>
					{#if floorError}<p class="err" role="alert">{floorError}</p>{/if}
					<input
						bind:this={planInput}
						class="sr"
						type="file"
						accept="image/png,image/jpeg,image/webp"
						tabindex="-1"
						aria-hidden="true"
						onchange={uploadPlan}
					/>
				</section>
			{/if}

			{#if sectionShows('data')}
				<section id="data">
					<h2 class="h2">Data &amp; backups</h2>
					<div class="card">
						{#if shows('data', 'export')}
							<div class="row">
								<div class="lab">
									<span class="sl">Export</span>
									<span class="sd"
										>A backup file has everything: panels, breakers, items, floors, rooms and plan images. The CSV lists your
										items for a spreadsheet.</span
									>
								</div>
								<div class="acts">
									<button type="button" class="btn" onclick={downloadBackup} disabled={busy}>Download backup</button>
									<button type="button" class="btn" onclick={exportCsv} disabled={busy}>Export CSV</button>
								</div>
							</div>
						{/if}
						{#if shows('data', 'import')}
							<div class="row">
								<div class="lab">
									<span class="sl">Import</span>
									<span class="sd">Replaces everything here with the backup’s contents. Download a backup first if you want a copy.</span>
								</div>
								<button type="button" class="btn" onclick={() => restoreInput?.click()} disabled={busy}>Restore from backup…</button>
							</div>
						{/if}
						{#if dataMsg && (shows('data', 'export') || shows('data', 'import'))}
							<p class="err" class:ok={!dataMsg.error} role="status">{dataMsg.text}</p>
						{/if}
						{#if shows('data', 'storage')}
							<div class="row">
								<div class="lab">
									<span class="sl">Keep data in this browser</span>
									<span class="sd">
										Everything is saved in this browser, on this device.
										{#if persisted}
											The browser keeps it until you delete it.
										{:else}
											The browser may clear it if the device runs low on space, and Safari clears it after a week without a visit
											unless the app is on your home screen.
										{/if}
										{#if usage !== null}Using {size(usage)}.{/if}
									</span>
									{#if storageMsg}<span class="sd" class:warn={storageMsg.error} role="status">{storageMsg.text}</span>{/if}
								</div>
								{#if canPersist && persisted === false}
									<button type="button" class="btn" onclick={keepPermanently}>Keep permanently</button>
								{:else if persisted}
									<span class="kept"><Icon name="check" size={16} />Kept permanently</span>
								{/if}
							</div>
						{/if}
						{#if shows('data', 'auto')}
							<div class="row">
								<div class="lab">
									<span class="sl" id="l-bk">Automatic backups</span>
									<span class="sd">A nightly snapshot, written to the backups folder in the app’s data volume.</span>
									<span class="soon">Needs the server version — on the roadmap.</span>
								</div>
								{@render sw(false, 'l-bk', undefined, true)}
							</div>
						{/if}
						{#if shows('data', 'keep')}
							<div class="row">
								<div class="lab">
									<label class="sl" for="s-keep">Keep backups for</label>
									<span class="sd">Older snapshots are deleted automatically.</span>
								</div>
								<select id="s-keep" class="inp w200" value="14" disabled>
									<option value="7">7 days</option>
									<option value="14">14 days</option>
									<option value="30">30 days</option>
									<option value="90">90 days</option>
								</select>
							</div>
						{/if}
						{#if shows('data', 'erase')}
							<div class="row">
								<div class="lab">
									<span class="sl warn">Erase all data</span>
									<span class="sd"
										>Deletes every panel, item and floor in this browser. Or start over with the example house.</span
									>
								</div>
								<div class="acts">
									<button type="button" class="btn" onclick={() => reset(true)} disabled={busy}>Load example house</button>
									<button type="button" class="btn btn-warn" onclick={() => reset(false)} disabled={busy}>Erase…</button>
								</div>
							</div>
						{/if}
					</div>
					<input
						bind:this={restoreInput}
						class="sr"
						type="file"
						accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3,application/x-sqlite3"
						tabindex="-1"
						aria-hidden="true"
						onchange={restore}
					/>
				</section>
			{/if}

			{#if sectionShows('access')}
				<section id="access">
					<h2 class="h2">Access</h2>
					<div class="card">
						<p class="soon top">Needs the server version — on the roadmap.</p>
						{#if shows('access', 'auth')}
							<div class="row">
								<div class="lab">
									<span class="sl" id="l-auth">Require sign-in</span>
									<span class="sd">Turn off only if Breakerbook is reachable on your home network alone.</span>
								</div>
								{@render sw(false, 'l-auth', undefined, true)}
							</div>
						{/if}
						{#if shows('access', 'guest')}
							<div class="row">
								<div class="lab">
									<span class="sl" id="l-guest">Read-only guest view</span>
									<span class="sd"
										>Anyone on the network can see the panel and map without signing in — handy for a tablet mounted by the
										panel. Editing still needs an account.</span
									>
								</div>
								{@render sw(false, 'l-guest', undefined, true)}
							</div>
						{/if}
						{#if shows('access', 'users')}
							<div class="row start">
								<div class="lab">
									<span class="sl">Users</span>
									<span class="sd">People who can sign in and make changes.</span>
								</div>
								<button type="button" class="btn" disabled>Add user</button>
							</div>
							<div class="user">
								<span class="avatar" aria-hidden="true">A</span>
								<span class="uname">
									<span class="un">admin</span>
									<span class="ur">Owner</span>
								</span>
								<button type="button" class="btn sm" disabled>Change password</button>
							</div>
						{/if}
					</div>
				</section>
			{/if}
		</div>
	</div>
</div>

<style>
	.page {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		background: var(--bg);
	}
	aside {
		width: 260px;
		flex-shrink: 0;
		padding: 28px 20px;
		border-right: 1px solid var(--line-2);
		background: var(--raised);
		display: flex;
		flex-direction: column;
		gap: 20px;
		overflow: auto;
	}
	h1 {
		margin: 0 12px;
		font-size: 28px;
		font-weight: 800;
		font-stretch: 112%;
		letter-spacing: -0.02em;
	}
	nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.snav {
		display: flex;
		align-items: center;
		height: 40px;
		padding: 0 12px;
		border-radius: var(--r-md);
		font-size: 14px;
		font-weight: 600;
		color: var(--soft);
		text-decoration: none;
	}
	.snav:hover {
		background: var(--hover);
		color: var(--ink);
	}
	.snav.is-on {
		background: var(--surface);
		color: var(--ink);
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.grow {
		flex-grow: 1;
	}
	.saved {
		margin: 0 12px;
		font-size: 12px;
		color: var(--muted);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ok);
	}

	.scroll {
		flex-grow: 1;
		min-width: 0;
		overflow: auto;
		position: relative;
	}
	.content {
		max-width: 860px;
		padding: 32px 48px 80px;
		display: flex;
		flex-direction: column;
		gap: 40px;
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 14px;
		scroll-margin-top: 32px;
	}
	.h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 800;
		font-stretch: 108%;
	}
	.shead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--line-2);
		border-radius: var(--r-2xl);
		padding: 0 24px;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		column-gap: 32px;
		padding: 18px 0;
		border-top: 1px solid var(--line);
	}
	.card > .row:first-child {
		border-top: 0;
	}
	.row.start {
		align-items: start;
	}
	.lab {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.sl {
		font-size: 15px;
		font-weight: 600;
	}
	.sl.warn,
	.sd.warn {
		color: var(--warn);
	}
	.sd {
		font-size: 13px;
		color: var(--muted);
		line-height: 1.45;
		max-width: 500px;
	}
	.w280 {
		width: 280px;
	}
	.w200 {
		width: 200px;
	}
	.acts {
		display: flex;
		gap: 8px;
	}
	.btn.sm {
		height: var(--control-h-sm);
		padding: 0 12px;
	}
	.soon {
		font-size: 12px;
		color: var(--muted);
		font-style: italic;
	}
	.soon.top {
		margin: 0;
		padding: 18px 0 0;
	}
	.soon.top + .row {
		border-top: 0;
		padding-top: 12px;
	}
	.err {
		margin: 0 0 14px;
		font-size: 13px;
		color: var(--warn);
	}
	.err.ok {
		color: var(--muted);
	}
	.kept {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
	}

	/* Appearance */
	.card.appear {
		padding-top: 20px;
		padding-bottom: 4px;
	}
	.themes {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-bottom: 20px;
	}
	.tgrid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.tcard {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 10px 10px 12px;
		border: 1.5px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
		cursor: pointer;
		font: inherit;
		color: var(--ink);
		text-align: left;
	}
	.tcard:hover {
		border-color: var(--btn-bd-h);
	}
	.tcard.is-on {
		border-color: var(--amber);
		box-shadow: 0 0 0 2px var(--amber);
	}
	.tlab {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.tname {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.tn {
		font-size: 14px;
		font-weight: 700;
	}
	.ts {
		font-size: 12px;
		color: var(--muted);
	}
	.radio {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid var(--field);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.tcard.is-on .radio {
		border-color: var(--amber);
	}
	.tcard.is-on .radio::after {
		content: '';
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--amber);
	}
	.pvs {
		height: 96px;
		border-radius: var(--r-md);
		overflow: hidden;
		display: flex;
		box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.3);
	}
	.pv {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		background: var(--p-bg);
	}
	.pv-l {
		--p-bg: var(--pv-l-bg);
		--p-hdr: var(--pv-l-hdr);
		--p-side: var(--pv-l-side);
		--p-row: var(--pv-l-row);
		--p-card: var(--pv-l-card);
		--p-ink: var(--pv-l-ink);
		--p-dim: var(--pv-l-dim);
	}
	.pv-d {
		--p-bg: var(--pv-d-bg);
		--p-hdr: var(--pv-d-hdr);
		--p-side: var(--pv-d-side);
		--p-row: var(--pv-d-row);
		--p-card: var(--pv-d-card);
		--p-ink: var(--pv-d-ink);
		--p-dim: var(--pv-d-dim);
	}
	.pv-hdr {
		height: 12px;
		background: var(--p-hdr);
	}
	.pv-body {
		flex-grow: 1;
		display: flex;
		gap: 6px;
		padding: 8px;
	}
	.pv-side {
		width: 42%;
		background: var(--p-side);
		border-radius: var(--r-xs);
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 4px;
	}
	.pv-row {
		height: 6px;
		background: var(--p-row);
		border-radius: 1px;
	}
	.pv-row.on {
		background: var(--amber);
	}
	.pv-card {
		flex-grow: 1;
		background: var(--p-card);
		border-radius: var(--r-xs);
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.pv-line {
		height: 4px;
		border-radius: 1px;
		background: var(--p-dim);
	}
	.pv-line.strong {
		height: 6px;
		width: 70%;
		background: var(--p-ink);
	}
	.pv-line.a {
		width: 50%;
	}
	.pv-line.b {
		width: 60%;
	}

	/* Panels */
	.pcard {
		padding-top: 20px;
		padding-bottom: 20px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.pname {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 17px;
		font-weight: 700;
	}
	.pgrid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.shrink {
		background: var(--amber-soft);
		border: 1px solid var(--amber);
		border-radius: var(--r-lg);
		padding: 12px 14px;
		font-size: 13px;
		line-height: 1.45;
	}
	.shrink strong {
		color: var(--amber-ink);
	}

	/* Floors */
	.frow {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 0;
		border-top: 1px solid var(--line);
	}
	.frow:first-child {
		border-top: 0;
	}
	.moves {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.fmain {
		flex-grow: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.rname {
		align-self: flex-start;
		width: 100%;
		max-width: 320px;
		margin: -3px 0 -3px -6px;
		padding: 2px 6px;
		border: 1px solid transparent;
		border-radius: var(--r-sm);
		background: transparent;
		font: inherit;
		font-size: 16px;
		font-weight: 700;
		color: var(--ink);
	}
	.rname:hover {
		border-color: var(--field);
	}
	.rname:focus {
		outline: 2px solid var(--amber);
		outline-offset: 0;
		border-color: var(--ink);
		background: var(--surface);
	}
	.fmeta,
	.nop {
		font-size: 13px;
		color: var(--muted);
	}
	.fplan {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-shrink: 0;
	}
	.pfile {
		font-size: 12px;
		color: var(--soft);
	}
	.ibtn.del {
		width: var(--control-h-sm);
		height: var(--control-h-sm);
	}

	/* Access */
	.user {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 0 18px;
	}
	.avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--line);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 14px;
	}
	.uname {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.un {
		font-size: 14px;
		font-weight: 600;
	}
	.ur {
		font-size: 12px;
		color: var(--muted);
	}
</style>
