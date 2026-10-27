interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  glob<T = unknown>(pattern: string, options: { eager: true; import: string }): Record<string, T>;
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
