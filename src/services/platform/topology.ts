/**
 * Which hosting topology this build is talking to.
 *
 * The app supports two, and the difference is a security boundary rather than a
 * deployment detail:
 *
 * - **Linked backend** (`VITE_API_BASE_URL` empty). The browser calls `/api/*`
 *   on the Static Web Apps origin, SWA forwards to the Function App over a
 *   private channel, and SWA injects `x-ms-client-principal` itself. The header
 *   is trustworthy because nothing else can reach the Function App.
 * - **Direct** (`VITE_API_BASE_URL` set). The browser calls the Function App
 *   URL. This is what the Free tier allows, and there the Function App is
 *   publicly reachable, so anyone can send whatever principal header they like.
 *
 * `specs/sync.md` → Identity treats the second case as blocking for anything
 * that depends on identity. This predicate is the single place that decides, so
 * auth and sync cannot end up disagreeing about which world they are in.
 */
export function isLinkedBackendTopology(): boolean {
  return (import.meta.env.VITE_API_BASE_URL ?? '') === '';
}
