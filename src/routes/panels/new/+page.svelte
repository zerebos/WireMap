<script lang="ts">
	import { enhance } from '$lib/enhance';

	let { form } = $props();
</script>

<svelte:head><title>New panel · Breaker Box</title></svelte:head>

<div class="card narrow">
	<h1>New panel</h1>
	<form method="POST" use:enhance class="stack">
		<label>Name <input name="name" required placeholder="Main panel" /></label>
		<label>Location <input name="location" placeholder="Garage, basement…" /></label>
		<div class="grid-2">
			<label>Main breaker (A) <input name="mainAmps" type="number" min="0" placeholder="200" /></label>
			<label>Slots <input name="slotCount" type="number" min="2" max="84" step="2" value="24" /></label>
		</div>
		{#if form?.error}<p class="error">{form.error}</p>{/if}
		<div><button class="primary">Create panel</button></div>
	</form>
</div>

<style>
	.narrow {
		max-width: 28rem;
	}
</style>
