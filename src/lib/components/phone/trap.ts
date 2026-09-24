// Keeps Tab inside a modal sheet: from the last control back to the first, and the reverse.
export function trapTab(e: KeyboardEvent, root: HTMLElement) {
	if (e.key !== 'Tab') return;
	const focusable = [...root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')];
	if (!focusable.length) return;
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (e.shiftKey && document.activeElement === first) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && document.activeElement === last) {
		e.preventDefault();
		first.focus();
	}
}
