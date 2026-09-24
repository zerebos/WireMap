<script lang="ts">
	// Setup step 1: the home's name. The owner account needs the server version, so its fields are
	// shown as the design has them but can't be filled in.
	import type { SetupDraft } from './draft';

	let { draft = $bindable() }: { draft: SetupDraft } = $props();
</script>

<div class="wrap">
	<div class="intro">
		<h1 tabindex="-1">Welcome to Breakerbook</h1>
		<p class="lead">Four quick steps and your panel is ready to fill in.</p>
	</div>
	<div class="fld">
		<label for="s-home">Home name</label>
		<input id="s-home" class="inp" type="text" bind:value={draft.home} placeholder="e.g. The house on Elm St." />
		<span class="hint">Shown in the browser tab and on exports.</span>
	</div>
	<fieldset class="acct" disabled>
		<div class="ah">
			<legend>Your owner account</legend>
			<span class="hint">Sign-in needs the server version — on the roadmap.</span>
		</div>
		<div class="fld">
			<label for="s-user">Username</label>
			<input id="s-user" class="inp" type="text" value="admin" autocomplete="username" />
		</div>
		<div class="two">
			<div class="fld">
				<label for="s-pw">Password</label>
				<input id="s-pw" class="inp" type="password" autocomplete="new-password" />
			</div>
			<div class="fld">
				<label for="s-pw2">Confirm password</label>
				<input id="s-pw2" class="inp" type="password" autocomplete="new-password" />
			</div>
		</div>
	</fieldset>
</div>

<style>
	.wrap {
		max-width: 560px;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.acct {
		margin: 0;
		padding: 8px 0 0;
		border: 0;
		border-top: 1px solid var(--line);
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.ah {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: 16px;
	}
	legend {
		padding: 0;
		font-size: 16px;
		font-weight: 700;
	}
	.two {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}
</style>
