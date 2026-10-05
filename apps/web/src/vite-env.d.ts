/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin, e.g. https://rivalrush-api.onrender.com */
  readonly VITE_API_URL?: string;
  /** Bot username without @, used for t.me invite links. */
  readonly VITE_BOT_USERNAME?: string;
  /** "true" only for local development and automated tests. */
  readonly VITE_DEV_LOGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
