<script lang="ts">
	// Shut off on desktop (DESIGN.md §5.16): the phone screen in a 420px drawer on the right, over
	// the Map or the Panel. Escape or the close button closes it.
	import { tick } from 'svelte';
	import Shutoff, { type ShutoffTarget } from '$lib/components/phone/Shutoff.svelte';
	import type { HouseIndex } from '$lib/house';

	let { ix, want, onclose }: { ix: HouseIndex; want: ShutoffTarget; onclose: () => void } = $props();

	let el: HTMLElement;
	$effect(() => {
		tick().then(() => el.querySelector<HTMLElement>('.top .ibtn')?.focus());
	});
	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && !e.defaultPrevented) {
			e.preventDefault();
			onclose();
		}
	}
</script>

<svelte:window {onkeydown} />

<aside class="drawer" aria-label="Shut off" bind:this={el}>
	<Shutoff {ix} {want} {onclose} />
</aside>

<style>
	.drawer {
		position: fixed;
		top: var(--header-h);
		right: 0;
		bottom: 0;
		width: 420px;
		max-width: 100%;
		z-index: 30;
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--line-2);
		box-shadow: -10px 0 30px rgba(0, 0, 0, 0.18);
	}
</style>
