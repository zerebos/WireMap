<script lang="ts">
	import Directory from '$lib/components/setup/Directory.svelte';

	let { data } = $props();
</script>

{#if data.house.panel}
	<Directory house={data.house} panel={data.house.panel} />
{/if}
