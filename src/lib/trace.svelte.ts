// Desktop "Trace" is a hand-off card (DESIGN.md §5.16). Picking a breaker on it hands off to the
// trace flow, which then runs full-screen like on a phone. The layout reads this to drop its header.
export const traceFlow = $state({ handoff: false });
