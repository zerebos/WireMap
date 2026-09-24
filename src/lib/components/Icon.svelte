<script lang="ts" module>
	// Inline stroke icons from the design mockups (docs/design/DESIGN.md §2 Icons).
	const PATHS = {
		outlet: '<rect x="4.5" y="3" width="15" height="18" rx="3"/><path d="M9.5 8.5v3M14.5 8.5v3"/><circle cx="12" cy="16" r="1.1"/>',
		light: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
		switch: '<rect x="6" y="3" width="12" height="18" rx="2"/><rect x="10" y="7" width="4" height="6" rx="1"/>',
		appliance: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13.5" r="4"/><path d="M7.5 6.5h2"/>',
		search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
		sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
		moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
		bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
		prev: '<path d="m15 6-6 6 6 6"/>',
		next: '<path d="m9 6 6 6-6 6"/>',
		up: '<path d="m6 15 6-6 6 6"/>',
		down: '<path d="m6 9 6 6 6-6"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		close: '<path d="M6 6l12 12M18 6 6 18"/>',
		check: '<path d="m5 12 5 5 9-10"/>',
		map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
		cursor: '<path d="M5 3l14 8-6 1.5L10 19z"/>',
		room: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2.5"/>',
		pin: '<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
		image: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
		arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
		fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
		trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
		warning: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.01"/>',
		power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>'
	} as const;
	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	let { name, size = 18, stroke = 2 }: { name: IconName; size?: number; stroke?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true">{@html PATHS[name]}</svg
>
