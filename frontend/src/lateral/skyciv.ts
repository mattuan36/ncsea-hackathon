const API_URL = "https://api.skyciv.com/v3";

const SPECTRUM_KEYS = [
  "multiPeriodDesignSpectrum",
  "multiPeriodMCErSpectrum",
  "twoPeriodDesignSpectrum",
  "twoPeriodMCErSpectrum",
  "verticalDesignSpectrum",
  "verticalMCErSpectrum",
  "underlyingData",
] as const;

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

function scrub(message: string, secret: string): string {
  return secret && message.includes(secret) ? message.replaceAll(secret, "***") : message;
}

export async function fetchSiteReport(input: {
  username: string;
  key: string;
  lat: number;
  lng: number;
  designCode: string;
  riskCategory: string;
  siteClass: string;
}): Promise<SiteReport> {
  const payload = {
    auth: { username: input.username, key: input.key },
    options: { validate_input: true },
    functions: [
      { function: "standalone.loads.start", arguments: { keep_open: false } },
      {
        function: "standalone.loads.getSiteData",
        arguments: {
          site_data: {
            design_code: input.designCode,
            lat: input.lat,
            lng: input.lng,
            risk_category: input.riskCategory,
            site_class: input.siteClass,
          },
          api_version: 2.1,
        },
      },
    ],
  };
  let body: Record<string, unknown>;
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90000),
    });
    const text = await response.text();
    if (!response.ok) throw new SkyCivError(scrub(`HTTP ${response.status}: ${text}`, input.key));
    body = JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SkyCivError) throw error;
    const message = error instanceof Error ? error.message : "Could not reach SkyCiv.";
    throw new SkyCivError(scrub(message, input.key));
  }

  const envelope = body.response && typeof body.response === "object" ? (body.response as Record<string, unknown>) : {};
  const status = envelope.status;
  const message = String(envelope.msg || "").trim();
  const data = envelope.data && typeof envelope.data === "object" ? (envelope.data as Record<string, unknown>) : {};
  const notes: string[] = [];
  if (status !== 0 && status !== 1) throw new SkyCivError(scrub(message || `SkyCiv status ${status}`, input.key));
  if (status === 1 && message) notes.push(message);
  if (!Object.keys(data).length) throw new SkyCivError(scrub(message || "SkyCiv returned no data", input.key));

  const site = record(data.site_data);
  const wind = record(data.wind_data);
  const snow = record(data.snow_data);
  const seismicRaw = record(data.seismic_data);
  const byCategory = record(wind.all_wind_speed);
  const selected = (byCategory[input.riskCategory] ?? wind.wind_speed ?? null) as number | string | null;
  const headline = wind.wind_speed;
  if (selected != null && headline != null && selected !== headline) {
    notes.push(
      `wind_data.wind_speed is ${headline}, which is not risk category ${input.riskCategory}. Reported wind speed is all_wind_speed[${input.riskCategory}] = ${selected}.`,
    );
  }
  const spectra: Record<string, Spectrum> = {};
  const seismic: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(seismicRaw)) {
    if ((SPECTRUM_KEYS as readonly string[]).includes(name)) spectra[name] = (value ?? {}) as Spectrum;
    else seismic[name] = value;
  }
  return {
    latitude: input.lat,
    longitude: input.lng,
    address: typeof site.formatted_address === "string" ? site.formatted_address : null,
    elevationM: typeof site.elevation === "number" ? site.elevation : null,
    country: typeof site.country === "string" ? site.country : null,
    designCode: input.designCode,
    riskCategory: input.riskCategory,
    siteClass: input.siteClass,
    windSpeed: selected,
    windUnit: typeof wind.wind_speed_unit === "string" ? wind.wind_speed_unit : null,
    windByCategory: byCategory as Record<string, number | string>,
    snow,
    seismic,
    spectra,
    notes,
    raw: data,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
