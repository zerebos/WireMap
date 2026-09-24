// Access (DESIGN.md §5.13–5.14). `guestEnabled` is Settings → Access → "Read-only guest view";
// `guest` is whether this viewer is in it: every edit control is removed, not disabled.
//
// There is no server yet (README → Roadmap), so this is a lock on this device, not security:
// turning guest view on locks the device, and Sign in unlocks it without checking a password.
import { mutate } from './house';
import { updateSettings } from './db/ops';

const KEY = 'breakerbook:signed-in';

function readSignedIn(): boolean {
	try {
		return sessionStorage.getItem(KEY) === '1' || localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

export const access = $state({ guestEnabled: false, signedIn: readSignedIn(), guest: false });

/** Called by the layout whenever the house loads. */
export function syncAccess(guestReadOnly: boolean) {
	access.guestEnabled = guestReadOnly;
	access.guest = guestReadOnly && !access.signedIn;
}

function setSignedIn(on: boolean, stay = false) {
	access.signedIn = on;
	try {
		sessionStorage.removeItem(KEY);
		localStorage.removeItem(KEY);
		if (on) (stay ? localStorage : sessionStorage).setItem(KEY, '1');
	} catch {
		// Storage blocked: the unlock lasts until the page reloads.
	}
	access.guest = access.guestEnabled && !on;
}

/** Settings → Access → Read-only guest view. Turning it on locks this device straight away. */
export async function setGuestView(on: boolean) {
	await mutate(() => updateSettings({ guestReadOnly: on }));
	setSignedIn(false);
}

/** Signs in on this device. Without a server there are no accounts, so any username and password unlock it. */
export async function signIn(user: string, password: string, stay: boolean): Promise<boolean> {
	void user;
	void password;
	setSignedIn(true, stay);
	return true;
}
