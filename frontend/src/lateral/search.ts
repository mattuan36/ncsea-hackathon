import { inServiceArea } from "./coverage";

export class LocateError extends Error {}

export interface Place {
  lat: number;
  lng: number;
  label: string;
}

const COORD_RE = /^([+-]?\d+(?:\.\d+)?)\s*([NnSs])?\s*[, ]\s*([+-]?\d+(?:\.\d+)?)\s*([EeWw])?$/;
const ZIP_RE = /^\d{5}(?:-\d{4})?$/;
const DIRECTIONS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

const STATE_ABBR: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
  Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY",
  Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
  "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Puerto Rico": "PR", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

export function parseCoordinates(query: string): [number, number] | null {
  const match = COORD_RE.exec(query.trim().replace(/[()]/g, "").replace(/\s+/g, " "));
  if (!match) return null;
  let lat = Number(match[1]);
  let lng = Number(match[3]);
  if (match[2]) lat = match[2].toUpperCase() === "N" ? Math.abs(lat) : -Math.abs(lat);
  if (match[4]) lng = match[4].toUpperCase() === "E" ? Math.abs(lng) : -Math.abs(lng);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [round6(lat), round6(lng)];
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function titleWord(word: string): string {
  return DIRECTIONS.has(word.toUpperCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function censusLabel(matched: string): string {
  const parts = matched.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 4) return matched.split(/\s+/).map(titleWord).join(" ");
  const [street, city, state, zip] = parts;
  return `${street.split(/\s+/).map(titleWord).join(" ")}, ${city.split(/\s+/).map(titleWord).join(" ")}, ${state.toUpperCase()} ${zip}`;
}

async function census(query: string): Promise<Place[]> {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${new URLSearchParams({
    address: query,
    benchmark: "Public_AR_Current",
    format: "json",
  })}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const payload = (await response.json()) as { result?: { addressMatches?: unknown[] } };
    const places: Place[] = [];
    for (const match of payload.result?.addressMatches ?? []) {
      if (!match || typeof match !== "object") continue;
      const record = match as { coordinates?: { x?: unknown; y?: unknown }; matchedAddress?: unknown };
      const lat = round6(Number(record.coordinates?.y));
      const lng = round6(Number(record.coordinates?.x));
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inServiceArea(lat, lng)) continue;
      places.push({ lat, lng, label: censusLabel(String(record.matchedAddress || query)) });
    }
    return places;
  } catch {
    return [];
  }
}

function nominatimLabel(hit: { address?: Record<string, string>; display_name?: string }): string {
  const address = hit.address ?? {};
  const street = [address.house_number, address.road || address.pedestrian].filter(Boolean).join(" ");
  const city = address.city || address.town || address.village || address.hamlet || address.municipality || address.county;
  let state = STATE_ABBR[address.state] || address.state || "";
  if (address.state === "Puerto Rico" || address.country_code === "pr") state = "PR";
  let locality = city && state ? `${city}, ${state}` : city || state;
  if (locality && address.postcode && street) locality = `${locality} ${address.postcode}`;
  return [street, locality].filter(Boolean).join(", ") || hit.display_name || "Site";
}

async function nominatim(query: string): Promise<Place[]> {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "6",
    addressdetails: "1",
    countrycodes: "us,pr",
  })}`;
  let payload: unknown;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new LocateError("Could not reach the address search.");
    payload = await response.json();
  } catch (error) {
    if (error instanceof LocateError) throw error;
    throw new LocateError("Could not reach the address search.");
  }
  if (!Array.isArray(payload)) return [];
  const ranked = payload
    .filter((hit): hit is { lat: string; lon: string; importance?: string; address?: Record<string, string>; display_name?: string } => !!hit && typeof hit === "object")
    .sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0));
  const places: Place[] = [];
  for (const hit of ranked) {
    const lat = round6(Number(hit.lat));
    const lng = round6(Number(hit.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inServiceArea(lat, lng)) continue;
    places.push({ lat, lng, label: nominatimLabel(hit) });
  }
  return places;
}

function dedupe(places: Place[]): Place[] {
  const seen = new Set<string>();
  const kept: Place[] = [];
  for (const place of places) {
    const key = `${place.lat.toFixed(3)},${place.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(place);
  }
  return kept;
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const text = query.trim().replace(/\s+/g, " ");
  if (!text) throw new LocateError("Enter a street address, city, or latitude and longitude.");
  const coords = parseCoordinates(text);
  if (coords) {
    const [lat, lng] = coords;
    if (!inServiceArea(lat, lng)) {
      throw new LocateError("That coordinate is outside the United States and Puerto Rico. Alaska is included.");
    }
    return [{ lat, lng, label: `${lat.toFixed(6)}, ${lng.toFixed(6)}` }];
  }
  const street = !ZIP_RE.test(text) && /\d/.test(text);
  let places = street ? await census(text) : [];
  if (!places.length) places = await nominatim(text);
  places = dedupe(places).slice(0, 6);
  if (!places.length) {
    throw new LocateError(`No place in the United States, Alaska, or Puerto Rico matched “${text}”.`);
  }
  return places;
}
