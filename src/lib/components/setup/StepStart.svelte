<script lang="ts">
	// Setup step 4: how to fill the panel in. The primary button in the footer follows the choice.
	import { resolve } from '$app/paths';

	type Choice = 'dir' | 'trace' | 'imp';
	let { spaces, choice = $bindable() }: { spaces: number; choice: Choice } = $props();
</script>

<div class="wrap">
	<div class="intro">
		<h1 tabindex="-1">How do you want to fill it in?</h1>
		<p class="lead">Your {spaces}-space panel is ready. Pick a starting point — you can mix them later.</p>
	</div>
	<div class="cards" role="radiogroup" aria-label="Starting point">
		<button type="button" class="rcard" class:is-on={choice === 'dir'} role="radio" aria-checked={choice === 'dir'} onclick={() => (choice = 'dir')}>
			<span class="radio"></span>
			<span class="rc">
				<span class="th"><span class="rt">Copy the panel directory</span><span class="tag">FASTEST</span></span>
				<span class="rd">Type in what’s written on the label inside the panel door, slot by slot. Best if the label is filled in and roughly right.</span>
			</span>
		</button>
		<button
			type="button"
			class="rcard"
			class:is-on={choice === 'trace'}
			role="radio"
			aria-checked={choice === 'trace'}
			onclick={() => (choice = 'trace')}
		>
			<span class="radio"></span>
			<span class="rc">
				<span class="rt">Trace it breaker by breaker</span>
				<span class="rd">Flip one breaker at a time and mark everything that goes dark. Best when the label is missing or wrong.</span>
				{#if choice === 'trace'}
					<span class="qr">
						<span class="code" aria-hidden="true">QR code</span>
						<span class="qt">
							<span class="qh">Trace from your phone</span>
							<span class="hint">Tracing from a second device needs the server version — on the roadmap.</span>
						</span>
					</span>
				{/if}
			</span>
		</button>
		<button type="button" class="rcard" class:is-on={choice === 'imp'} role="radio" aria-checked={choice === 'imp'} onclick={() => (choice = 'imp')}>
			<span class="radio"></span>
			<span class="rc">
				<span class="rt">Restore a backup</span>
				<span class="rd">Import a Breakerbook backup (.sqlite). Replaces the panel and floors you just set up.</span>
			</span>
		</button>
	</div>
	<a class="skip" href={resolve('/panel')}>Skip — take me to the empty panel</a>
</div>

<style>
	.wrap {
		max-width: 680px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.cards {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.rc {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 100%;
	}
	.th {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.rt {
		font-size: 17px;
		font-weight: 700;
	}
	.rd {
		font-size: 14px;
		line-height: 1.5;
		color: var(--soft);
	}
	/* Placeholder: handing off to a phone needs the server version. */
	.qr {
		display: flex;
		gap: 16px;
		align-items: center;
		margin-top: 8px;
		padding: 12px;
		border-radius: var(--r-lg);
		background: var(--bg);
	}
	.code {
		width: 72px;
		height: 72px;
		flex-shrink: 0;
		border: 1.5px dashed var(--field);
		border-radius: var(--r-md);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		color: var(--muted);
		opacity: 0.5;
	}
	.qt {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.qh {
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
	}
	.skip {
		align-self: flex-start;
		font-size: 14px;
		font-weight: 600;
	}
</style>
