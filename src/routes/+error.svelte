<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
</script>

<svelte:head><title>{page.status === 404 ? 'Not found' : 'Error'} · Breakerbook</title></svelte:head>

<main>
	<h1>{page.status === 404 ? 'Not found' : 'Something went wrong'}</h1>
	<p>{page.error?.message}</p>
	<div class="acts">
		<button type="button" class="btn btn-pri" onclick={() => location.reload()}>Try again</button>
		<a class="btn" href={resolve('/')}>Go to the panel</a>
	</div>
</main>

<style>
	main {
		max-width: 520px;
		padding: 28px 32px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	h1 {
		font-size: 28px;
		font-weight: 800;
		font-stretch: 112%;
		letter-spacing: -0.02em;
	}
	p {
		color: var(--muted);
		font-size: 14px;
		line-height: 1.5;
	}
	.acts {
		display: flex;
		gap: 8px;
	}
</style>
