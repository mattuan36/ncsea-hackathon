declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.css";

declare module "*.geojson?raw" {
  const content: string;
  export default content;
}
