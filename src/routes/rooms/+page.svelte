<script lang="ts">
	import { enhance } from '$app/forms';
	import { keepValues } from '$lib/forms';

	let { data, form } = $props();

	const groups = $derived([
		...data.floors.map((f) => ({ floor: f, rooms: data.rooms.filter((r) => r.floorId === f.id) })),
		{ floor: null, rooms: data.rooms.filter((r) => r.floorId === null) }
	]);
</script>

<svelte:head><title>Rooms · Breaker Box</title></svelte:head>

<h1>Rooms</h1>
<p class="muted">Floors and rooms give each item a place in the house, ready for the map view later.</p>

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

<div class="cols">
	<div class="stack">
		{#each groups as g (g.floor?.id ?? 'none')}
			{#if g.floor || g.rooms.length}
				<section class="card">
					<header>
						<h2>{g.floor?.name ?? 'No floor'}</h2>
						{#if g.floor}
							<form method="POST" action="?/deleteFloor" use:enhance>
								<input type="hidden" name="id" value={g.floor.id} />
								<button class="danger" title="Rooms on this floor are kept">Delete floor</button>
							</form>
						{/if}
					</header>
					{#if g.rooms.length === 0}
						<p class="muted">No rooms yet.</p>
					{/if}
					<ul>
						{#each g.rooms as r (r.id)}
							<li>
								<form method="POST" action="?/renameRoom" use:enhance={keepValues} class="room">
									<input type="hidden" name="id" value={r.id} />
									<input name="name" value={r.name} aria-label="Room name" required />
									<select name="floorId" value={r.floorId ?? ''} aria-label="Floor">
										<option value="">No floor</option>
										{#each data.floors as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
									</select>
									<span class="muted count">{r.deviceCount} item{r.deviceCount === 1 ? '' : 's'}</span>
									<button>Save</button>
									<button class="danger" formaction="?/deleteRoom" formnovalidate>Delete</button>
								</form>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/each}
	</div>

	<div class="stack">
		<form method="POST" action="?/addRoom" use:enhance class="card stack">
			<h3>Add room</h3>
			<label>Name <input name="name" required /></label>
			<label>
				Floor
				<select name="floorId">
					<option value="">No floor</option>
					{#each data.floors as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
				</select>
			</label>
			<div><button class="primary">Add room</button></div>
		</form>
		<form method="POST" action="?/addFloor" use:enhance class="card stack">
			<h3>Add floor</h3>
			<div class="grid-2">
				<label>Name <input name="name" required placeholder="Basement" /></label>
				<label>Level <input name="level" type="number" value={data.floors.length} /></label>
			</div>
			<div><button class="primary">Add floor</button></div>
		</form>
	</div>
</div>

<style>
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
		gap: 1.25rem;
		align-items: start;
		margin-top: 1rem;
	}
	@media (max-width: 860px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.4rem;
	}
	.room {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 1.2fr) auto auto auto;
		gap: 0.4rem;
		align-items: center;
	}
	.count {
		font-size: 0.8rem;
		white-space: nowrap;
	}
	@media (max-width: 520px) {
		.room {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
