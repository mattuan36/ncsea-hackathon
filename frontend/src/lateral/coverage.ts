import coverageText from "./us_service_area.geojson?raw";

type Ring = number[][];
type Polygon = Ring[];

/** The outline is simplified, so a waterfront block can sit just outside the line. */
const TOLERANCE_KM = 2;

function loadPolygons(): Polygon[] {
  const data = JSON.parse(coverageText) as {
    features?: { geometry?: { type?: string; coordinates?: unknown } }[];
  };
  const polygons: Polygon[] = [];
  for (const feature of data.features ?? []) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === "Polygon") polygons.push(geometry.coordinates as Polygon);
    else if (geometry.type === "MultiPolygon") polygons.push(...(geometry.coordinates as Polygon[]));
  }
  return polygons;
}

const POLYGONS = loadPolygons();

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  const positions = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  let inside = false;
  let previous = positions.length - 1;
  for (let index = 0; index < positions.length; index += 1) {
    const [xi, yi] = positions[index];
    const [xj, yj] = positions[previous];
    if (yi > lat !== yj > lat) {
      const cross = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (lng < cross) inside = !inside;
    }
    previous = index;
  }
  return inside;
}

function contains(lng: number, lat: number): boolean {
  return POLYGONS.some(
    (polygon) =>
      polygon.length > 0 &&
      pointInRing(lng, lat, polygon[0]) &&
      !polygon.slice(1).some((hole) => pointInRing(lng, lat, hole)),
  );
}

function nearestKm(lng: number, lat: number): number {
  if (contains(lng, lat)) return 0;
  const scaleX = Math.cos((lat * Math.PI) / 180) * 6371;
  const xy = (lon: number, la: number) => [(lon * Math.PI) / 180 * scaleX, (la * Math.PI) / 180 * 6371];
  const [px, py] = xy(lng, lat);
  let best = Number.POSITIVE_INFINITY;
  for (const polygon of POLYGONS) {
    for (const ring of polygon) {
      for (let index = 1; index < ring.length; index += 1) {
        const [ax, ay] = xy(ring[index - 1][0], ring[index - 1][1]);
        const [bx, by] = xy(ring[index][0], ring[index][1]);
        const dx = bx - ax;
        const dy = by - ay;
        const share = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
        const distance = Math.hypot(px - (ax + share * dx), py - (ay + share * dy));
        if (distance < best) best = distance;
      }
    }
  }
  return best;
}

export function inServiceArea(lat: number, lng: number): boolean {
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return nearestKm(lng, lat) <= TOLERANCE_KM;
}
