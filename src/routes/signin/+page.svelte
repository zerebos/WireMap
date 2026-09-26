<script lang="ts">
	// Sign in (DESIGN.md §5.14).
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { access, signIn } from '$lib/access.svelte';

	let { data } = $props();

	let user = $state('');
	let pw = $state('');
	let stay = $state(true);
	let err = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!(await signIn(user, pw, stay))) {
			err = true;
			return;
		}
		goto(resolve('/'));
	}
	const cells = Array.from({ length: 20 }, (_, r) => r);
</script>

<svelte:head>
	<title>Sign in · Breakerbook</title>
</svelte:head>

<main class="signin">
	<div class="side">
		<form class="form" onsubmit={submit}>
			<div class="brand">
				<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"
					><rect x="5" y="2.5" width="14" height="19" rx="2" /><rect x="9" y="6" width="6" height="7" rx="1" fill="currentColor" /><path
						d="M9 17h6"
					/></svg
				>
				<span>Breakerbook</span>
			</div>
			<div class="hd">
				<h1>Sign in</h1>
				<span class="home">{data.house?.settings.homeName ?? 'Home'}</span>
			</div>
			{#if err}
				<div class="alert" role="alert">That username and password don’t match.</div>
			{/if}
			<div class="fields">
				<div class="fld">
					<label for="u">Username</label>
					<input id="u" class="inp" type="text" autocomplete="username" bind:value={user} oninput={() => (err = false)} />
				</div>
				<div class="fld">
					<label for="p">Password</label>
					<input id="p" class="inp" type="password" autocomplete="current-password" bind:value={pw} oninput={() => (err = false)} />
				</div>
				<label class="chk"><input type="checkbox" bind:checked={stay} />Stay signed in on this device</label>
				<!-- Accounts come with the server version (README → Roadmap), so signing in is off for now. -->
				<button type="submit" class="btn btn-pri go" disabled aria-describedby="si-d" title="Needs the server version — on the roadmap.">Sign in</button>
				<span class="sr" id="si-d">Needs the server version — on the roadmap.</span>
			</div>
			{#if access.guestEnabled}
				<div class="guest">
					<a class="btn" href={resolve('/panel')}>View the panel without signing in</a>
					<span>Read-only guest view is on for this home.</span>
				</div>
			{/if}
			<span class="foot">Forgot your password? Reset it from the server’s command line — see the docs.</span>
		</form>
	</div>
	<div class="art" aria-hidden="true">
		<div class="mini">
			{#each cells as r (r)}
				<span class="bk" class:a={r === 7}></span>
				<span class="bus"></span>
				<span class="bk"></span>
			{/each}
		</div>
	</div>
</main>

<style>
	.signin {
		flex: 1 1 0;
		min-height: 0;
		display: flex;
		background: var(--bg);
		overflow: auto;
	}
	.side {
		flex: 1 1 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px 16px;
	}
	.form {
		width: 400px;
		max-width: 100%;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--amber);
	}
	.brand span {
		color: var(--ink);
		font-size: 22px;
		font-weight: 800;
		font-stretch: 112%;
		letter-spacing: -0.01em;
	}
	.hd {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	h1 {
		font-size: 32px;
		font-weight: 800;
		font-stretch: 112%;
		letter-spacing: -0.02em;
	}
	.home {
		font-size: 15px;
		color: var(--soft);
	}
	.alert {
		padding: 12px 14px;
		border-radius: var(--r-lg);
		border: 1.5px solid var(--warn);
		color: var(--warn);
		font-size: 14px;
		font-weight: 600;
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.go {
		height: 50px;
		font-size: 15px;
	}
	.guest {
		padding-top: 20px;
		border-top: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.guest span {
		font-size: 12px;
		color: var(--muted);
		text-align: center;
	}
	.foot {
		font-size: 12px;
		color: var(--muted);
		line-height: 1.5;
	}
	.art {
		width: 520px;
		flex-shrink: 0;
		background: var(--enclosure);
		border-left: 1px solid var(--enclosure-bd);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.mini {
		width: 260px;
		padding: 16px;
		border-radius: 10px;
		background: var(--enclosure);
		border: 1px solid var(--enclosure-bd);
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
		display: grid;
		grid-template-columns: 1fr 12px 1fr;
		gap: 4px 6px;
	}
	.bk {
		height: 12px;
		border-radius: 2px;
		background: var(--raised);
		border: 1px solid var(--breaker-bd);
	}
	.bk.a {
		background: var(--amber);
		border-color: var(--amber);
	}
	.bus {
		height: 12px;
		background: var(--bus);
		border-radius: 1px;
	}
	/* On phones the right panel is dropped. */
	@media (max-width: 699px) {
		.art {
			display: none;
		}
	}
</style>
