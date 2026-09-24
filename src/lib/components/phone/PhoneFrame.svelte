<script lang="ts">
	// The column the phone flows (shut off, trace) live in. Designed at 390 wide; on a wider
	// window it stays a centered column up to 480px on the page background.
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<div class="phone">
	{@render children()}
</div>

<style>
	.phone {
		position: relative;
		flex: 1 1 0;
		min-height: 0;
		width: 100%;
		max-width: 480px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--ink);
		overflow: hidden;
	}
	@media (min-width: 481px) {
		.phone {
			border-left: 1px solid var(--line);
			border-right: 1px solid var(--line);
		}
	}
</style>
