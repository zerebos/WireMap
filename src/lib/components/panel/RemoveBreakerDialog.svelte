<script lang="ts">
	// Confirms removing a breaker (DESIGN.md §5.1.1): Cancel / Remove.
	let { question, detail, onremove }: { question: string; detail: string; onremove: () => void } = $props();

	let dlg = $state<HTMLDialogElement>();

	export function open() {
		if (!dlg) return;
		dlg.returnValue = '';
		dlg.showModal();
	}
	function onclose() {
		if (dlg?.returnValue === 'remove') onremove();
	}
</script>

<dialog bind:this={dlg} aria-labelledby="rm-q" aria-describedby={detail ? 'rm-d' : undefined} {onclose}>
	<form method="dialog">
		<p id="rm-q" class="q">{question}</p>
		{#if detail}<p id="rm-d" class="d">{detail}</p>{/if}
		<div class="acts">
			<button class="btn" value="cancel">Cancel</button>
			<button class="btn btn-warn" value="remove">Remove</button>
		</div>
	</form>
</dialog>

<style>
	dialog {
		width: 440px;
		max-width: calc(100vw - 32px);
		padding: 24px;
		border: 1px solid var(--line-2);
		border-radius: var(--r-2xl);
		background: var(--surface);
		color: var(--ink);
	}
	dialog::backdrop {
		background: var(--scrim);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.q {
		margin: 0;
		font-size: 17px;
		font-weight: 700;
		line-height: 1.35;
	}
	.d {
		margin: 0;
		font-size: 14px;
		color: var(--soft);
		line-height: 1.5;
	}
	.acts {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}
</style>
