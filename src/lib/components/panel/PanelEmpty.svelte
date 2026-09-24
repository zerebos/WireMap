<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/Icon.svelte';

	let { slotCount, directoryHref }: { slotCount: number; directoryHref: string } = $props();
</script>

<div class="empty">
	<div class="intro">
		<h2>Your panel is empty</h2>
		<p>
			{slotCount} open spaces, ready to fill in. Most people copy the label inside the panel door first, then trace with their phone to
			check it and build the map.
		</p>
	</div>
	<div class="cards">
		<a class="acard" href={directoryHref}>
			<span class="ai"><Icon name="directory" size={20} /></span>
			<span class="at">
				<span class="ah"><span class="an">Copy the panel directory</span><span class="tag">FASTEST</span></span>
				<span class="ad">Type in the label from inside the panel door, all slots on one screen.</span>
			</span>
			<span class="chev"><Icon name="next" /></span>
		</a>
		<a class="acard" href={resolve('/trace')}>
			<span class="ai"><Icon name="bolt" size={20} /></span>
			<span class="at">
				<span class="an">Trace with your phone</span>
				<span class="ad">Flip one breaker at a time and tap what goes dark. Fills in the map as you go.</span>
			</span>
			<span class="chev"><Icon name="next" /></span>
		</a>
		<div class="acard info">
			<span class="ai"><Icon name="plus" size={20} /></span>
			<span class="at">
				<span class="an">Add one at a time</span>
				<span class="ad">Click any open slot on the panel.</span>
			</span>
		</div>
	</div>
</div>

<style>
	.empty {
		padding: 40px;
		display: flex;
		flex-direction: column;
		gap: 24px;
		overflow: auto;
	}
	.intro {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	h2 {
		font-size: 30px;
		font-weight: 800;
		font-stretch: 108%;
	}
	p {
		margin: 0;
		font-size: 15px;
		line-height: 1.55;
		color: var(--soft);
		max-width: 560px;
	}
	.cards {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.acard {
		display: flex;
		gap: 16px;
		align-items: flex-start;
		padding: 18px;
		border: 1.5px solid var(--line-2);
		border-radius: var(--r-xl);
		background: var(--surface);
		color: var(--ink);
		text-decoration: none;
	}
	a.acard:hover {
		border-color: var(--btn-bd-h);
		color: var(--ink);
	}
	.acard.info {
		border-style: dashed;
	}
	.ai {
		width: 40px;
		height: 40px;
		border-radius: var(--r-lg);
		background: var(--bg);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.at {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.ah {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.an {
		font-size: 16px;
		font-weight: 700;
	}
	.ad {
		font-size: 14px;
		color: var(--soft);
		line-height: 1.45;
	}
	.chev {
		flex-shrink: 0;
		margin-top: 10px;
		color: var(--muted);
		display: flex;
	}
</style>
