/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TMDB_READ_ACCESS_TOKEN?: string;
  readonly VITE_TMDB_READ_ACCESS_TOKEN_STANDBY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
