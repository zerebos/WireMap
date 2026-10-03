<script lang="ts">
	// An item on a phone (DESIGN.md §5.12, Phone · Items): the drawer's content on its own screen
	// inside the shell, under a back button to the list. Mount it inside {#key item.id}.
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import ItemDrawer from '$lib/components/items/ItemDrawer.svelte';
	import { useBack } from '$lib/components/phone/back.svelte';
	import type { HouseIndex, HouseItem } from '$lib/house';

	let {
		item,
		ix,
		breakerOptions,
		listHref
	}: {
		item: HouseItem;
		ix: HouseIndex;
		breakerOptions: { value: number; label: string }[];
		/** The list with its filters, where the back button goes. */
		listHref: string;
	} = $props();

	// Opened from the list in this app: back is a step back in history, so the browser's own Back
	// and this button agree.
	const back = useBack((from, to) => from.pathname === to.pathname && !from.searchParams.has('item'));
	// Once: a second Escape or Save before the list is back would step back past it.
	let leaving = false;
	function leave() {
		if (leaving) return;
		leaving = true;
		if (back.fromApp) history.back();
		else goto(listHref, { replaceState: true });
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && !e.repeat && !e.defaultPrevented) leave();
	}}
/>

<div class="pitem">
	<div class="pback">
		<a class="ibtn" href={listHref} aria-label="Back to items" onclick={back.onclick}><Icon name="prev" /></a>
	</div>
	<ItemDrawer {item} {ix} {breakerOptions} onclose={leave} phone />
</div>

<style>
	.pitem {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: 12px;
		gap: 10px;
	}
	.pback {
		display: flex;
		flex-shrink: 0;
	}
</style>
