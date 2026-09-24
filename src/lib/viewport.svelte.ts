// Below ~700px wide the desktop layouts are replaced by the phone views (DESIGN.md §5.12).
export const PHONE_QUERY = '(max-width: 699px)';

export const viewport = $state({ phone: false });

if (typeof matchMedia !== 'undefined') {
	const mq = matchMedia(PHONE_QUERY);
	viewport.phone = mq.matches;
	mq.addEventListener('change', () => (viewport.phone = mq.matches));
}
