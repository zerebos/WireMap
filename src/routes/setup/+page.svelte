<script lang="ts">
	import Setup from '$lib/components/setup/Setup.svelte';

	let { data } = $props();
</script>

<Setup house={data.house} />
