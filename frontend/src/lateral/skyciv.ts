export interface Spectrum {
  periods?: number[];
  ordinates?: number[];
}

export interface SiteReport {
  latitude: number;
  longitude: number;
  address: string | null;
  elevationM: number | null;
  country: string | null;
  designCode: string;
  riskCategory: string;
  siteClass: string | null;
  windSpeed: number | string | null;
  windUnit: string | null;
  windByCategory: Record<string, number | string>;
  snow: Record<string, unknown>;
  seismic: Record<string, unknown>;
  spectra: Record<string, Spectrum>;
  notes: string[];
  raw: unknown;
}

export class SkyCivError extends Error {}

export function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE;
  return (configured || "").replace(/\/$/, "");
}

export async function fetchSiteReport(input: {
  lat: number;
  lng: number;
  designCode: string;
  riskCategory: string;
  siteClass: string;
}): Promise<SiteReport> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/api/site-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: input.lat,
        lng: input.lng,
        designCode: input.designCode,
        riskCategory: input.riskCategory,
        siteClass: input.siteClass,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach the site API.";
    throw new SkyCivError(message);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const body = JSON.parse(text) as { detail?: string };
      detail = body.detail ?? text;
    } catch {
      if (text.includes("<")) detail = "The site API is not connected to this page.";
    }
    throw new SkyCivError(detail || `The site API returned HTTP ${response.status}.`);
  }
  return JSON.parse(text) as SiteReport;
}
