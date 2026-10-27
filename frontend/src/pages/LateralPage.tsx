import { useEffect, useState, type FormEvent } from "react";
import MapView from "../lateral/MapView";
import ReportView from "../lateral/ReportView";
import { inServiceArea } from "../lateral/coverage";
import { LocateError, searchPlaces, type Place } from "../lateral/search";
import { useLtl } from "../ltl/store";
import { fetchSiteReport, SkyCivError, type SiteReport } from "../lateral/skyciv";

const DEFAULT_LAT = 37.795143;
const DEFAULT_LNG = -122.404312;

const SITE_CLASSES: Record<string, string[]> = {
  "asce7-22": ["A", "B", "BC", "C", "CD", "D", "DE", "E"],
  "asce7-16": ["A", "B", "C", "D", "D-default", "E"],
};

function stored(name: string): string {
  try {
    return sessionStorage.getItem(name) ?? "";
  } catch {
    return "";
  }
}

export default function LateralPage() {
  const [query, setQuery] = useState("750 Kearny St, San Francisco");
  const [lat, setLat] = useState(DEFAULT_LAT);
  const [lng, setLng] = useState(DEFAULT_LNG);
  const [label, setLabel] = useState("750 Kearny St, San Francisco");
  const [matches, setMatches] = useState<Place[]>([]);
  const [risk, setRisk] = useState("II");
  const [designCode, setDesignCode] = useState("asce7-22");
  const [siteClass, setSiteClass] = useState("D");
  const [username, setUsername] = useState(() => stored("ltl_skyciv_username"));
  const [apiKey, setApiKey] = useState(() => stored("ltl_skyciv_key"));
  const [searchError, setSearchError] = useState("");
  const [areaError, setAreaError] = useState("");
  const [reportError, setReportError] = useState("");
  const [busy, setBusy] = useState<"search" | "report" | null>(null);
  const [report, setReport] = useState<SiteReport | null>(null);
  const { setSiteInputs, setSiteReport } = useLtl();

  // Mirror inputs and the report into the shared store so the assistant can answer from them.
  useEffect(() => {
    setSiteInputs({ label, lat, lng, riskCategory: risk, designCode, siteClass });
  }, [label, lat, lng, risk, designCode, siteClass, setSiteInputs]);

  useEffect(() => {
    setSiteReport(report);
  }, [report, setSiteReport]);

  useEffect(() => {
    if (!SITE_CLASSES[designCode].includes(siteClass)) setSiteClass("D");
  }, [designCode, siteClass]);

  useEffect(() => {
    try {
      sessionStorage.setItem("ltl_skyciv_username", username);
      sessionStorage.setItem("ltl_skyciv_key", apiKey);
    } catch {
      /* private mode can block storage; the fields still submit */
    }
  }, [username, apiKey]);

  const choose = (place: Place) => {
    setLat(place.lat);
    setLng(place.lng);
    setLabel(place.label);
    setQuery(place.label);
    setMatches([]);
    setSearchError("");
    setAreaError("");
  };

  const onSearch = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("search");
    setSearchError("");
    setMatches([]);
    try {
      const places = await searchPlaces(query);
      if (places.length === 1) choose(places[0]);
      else setMatches(places);
    } catch (error) {
      setSearchError(error instanceof LocateError ? error.message : "Search failed.");
    } finally {
      setBusy(null);
    }
  };

  const onPick = (nextLat: number, nextLng: number) => {
    const roundedLat = Math.round(nextLat * 1e6) / 1e6;
    const roundedLng = Math.round(nextLng * 1e6) / 1e6;
    if (!inServiceArea(roundedLat, roundedLng)) {
      setAreaError("That pin is outside the United States and Puerto Rico. Alaska is included.");
      return;
    }
    setLat(roundedLat);
    setLng(roundedLng);
    setLabel(`${roundedLat.toFixed(6)}, ${roundedLng.toFixed(6)}`);
    setAreaError("");
    setMatches([]);
  };

  const onGenerate = async () => {
    setReportError("");
    if (!inServiceArea(lat, lng)) {
      setAreaError("That coordinate is outside the United States and Puerto Rico. Alaska is included.");
      return;
    }
    if (!username.trim() || !apiKey.trim()) {
      setReportError("Enter the SkyCiv username and API key. They stay in this browser and are not saved in the project.");
      return;
    }
    setBusy("report");
    try {
      setReport(await fetchSiteReport({
        username: username.trim(),
        key: apiKey.trim(),
        lat,
        lng,
        designCode,
        riskCategory: risk,
        siteClass,
      }));
    } catch (error) {
      setReport(null);
      setReportError(error instanceof SkyCivError ? error.message : "SkyCiv did not return a report.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page page-scroll">
      <header className="page-header">
        <h1>Lateral</h1>
        <p className="muted subtitle">Wind, snow, and seismic site loads for the United States, including Alaska and Puerto Rico.</p>
      </header>

      <form className="card" onSubmit={onSearch}>
        <div className="form-grid">
          <label className="span-2">
            Location
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="750 Kearny St, San Francisco  ·  Anchorage, AK  ·  San Juan, PR"
            />
          </label>
          <label>
            Latitude
            <input type="number" step="any" value={lat} onChange={(event) => setLat(Number(event.target.value))} />
          </label>
          <label>
            Longitude
            <input type="number" step="any" value={lng} onChange={(event) => setLng(Number(event.target.value))} />
          </label>
          <label>
            Risk category
            <select value={risk} onChange={(event) => setRisk(event.target.value)}>
              {["I", "II", "III", "IV"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            Design code
            <select value={designCode} onChange={(event) => setDesignCode(event.target.value)}>
              <option value="asce7-22">ASCE 7-22</option>
              <option value="asce7-16">ASCE 7-16</option>
            </select>
          </label>
          <label>
            Site class
            <select value={siteClass} onChange={(event) => setSiteClass(event.target.value)}>
              {SITE_CLASSES[designCode].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            SkyCiv username
            <input value={username} autoComplete="username" onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="span-2">
            SkyCiv API key
            <input type="password" value={apiKey} autoComplete="current-password" onChange={(event) => setApiKey(event.target.value)} />
          </label>
        </div>
        <p className="muted small">Each report uses SkyCiv credits. The key is sent only to api.skyciv.com and is not stored in the repository.</p>
        <div className="row-gap">
          <button className="btn" type="submit" disabled={busy != null}>{busy === "search" ? "Searching…" : "Search"}</button>
          <button className="btn primary" type="button" onClick={onGenerate} disabled={busy != null}>
            {busy === "report" ? "Generating…" : "Generate SkyCiv report"}
          </button>
        </div>
        {searchError && <p className="banner error">{searchError}</p>}
        {areaError && <p className="banner error">{areaError}</p>}
        {reportError && <p className="banner error">{reportError}</p>}
        {matches.length > 1 && (
          <div className="match-grid">
            {matches.map((place) => (
              <button type="button" className="btn" key={`${place.lat}-${place.lng}`} onClick={() => choose(place)}>
                {place.label}
              </button>
            ))}
          </div>
        )}
        <p className="muted small">{label} · {lat.toFixed(6)}, {lng.toFixed(6)}</p>
      </form>

      <div className="site-map">
        <MapView lat={lat} lng={lng} onPick={onPick} />
      </div>
      {report && <ReportView report={report} />}
    </div>
  );
}
