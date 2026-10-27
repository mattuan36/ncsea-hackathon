interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_API_BASE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.css";

declare module "*.geojson?raw" {
  const content: string;
  export default content;
}
