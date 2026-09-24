<script lang="ts">
	// Shut off, full-screen on a phone (docs/design/DESIGN.md §5.5): /shutoff?room=|breaker=|item=.
	import { page } from '$app/state';
	import PhoneFrame from '$lib/components/phone/PhoneFrame.svelte';
	import Shutoff from '$lib/components/phone/Shutoff.svelte';
	import { useBack } from '$lib/components/phone/back.svelte';
	import { index } from '$lib/house';

	let { data } = $props();
	const ix = $derived(index(data.house));
	const back = useBack();

	const num = (v: string | null) => (v && /^\d+$/.test(v) ? +v : null);
	const params = $derived(page.url.searchParams);
	const want = $derived({ room: num(params.get('room')), breaker: num(params.get('breaker')), item: num(params.get('item')) });
</script>

<PhoneFrame>
	<Shutoff {ix} {want} onbackclick={back.onclick} />
</PhoneFrame>
