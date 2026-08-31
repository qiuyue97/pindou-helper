/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHOW_ADVANCED_METRICS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
