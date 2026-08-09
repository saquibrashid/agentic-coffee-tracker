/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /**
   * Switches sign-in on. Off unless this is exactly `'true'`, because sign-in
   * needs an identity provider registered in Azure first — see
   * `services/auth/index.ts` and `docs/deployment.md`.
   */
  readonly VITE_AUTH_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
