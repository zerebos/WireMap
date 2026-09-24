// Access (DESIGN.md §5.13–5.14). `guestEnabled` is Settings → Access → "Read-only guest view";
// `guest` is whether this viewer is in it: every edit control is removed, not disabled.
export const access = $state({ guestEnabled: false, guest: false });

/**
 * Checks a username and password. There are no accounts until there is a server version of the
 * app (README → Roadmap), so nothing matches yet.
 */
export async function signIn(user: string, password: string, stay: boolean): Promise<boolean> {
	void user;
	void password;
	void stay;
	return false;
}
