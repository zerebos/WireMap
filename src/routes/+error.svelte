<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
</script>

<svelte:head><title>{page.status === 404 ? 'Not found' : 'Error'} · Breaker Box</title></svelte:head>

<div class="card stack narrow">
	<h1>{page.status === 404 ? 'Not found' : 'Something went wrong'}</h1>
	<p>{page.error?.message}</p>
	<div class="row">
		<button class="primary" onclick={() => location.reload()}>Try again</button>
		<a class="button" href={resolve('/')}>Go to the panel</a>
	</div>
</div>

<style>
	.narrow {
		max-width: 32rem;
	}
</style>
