import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { archiveSiteReport } from "../api";
import { hazardFiles } from "../lateral/hazardExport";
import { saveLocalDocuments } from "../localDocuments";
import MapView from "../lateral/MapView";
import ReportView from "../lateral/ReportView";
import SeismicCsStep from "../lateral/SeismicCsStep";
import SiteClassStep from "../lateral/SiteClassStep";
import type { ClassCache, SeismicInputs } from "../lateral/siteClass";
import { inServiceArea } from "../lateral/coverage";
import { useLtl } from "../ltl/store";
import { LocateError, searchPlaces, type Place } from "../lateral/search";
import { fetchSiteReport, SkyCivError, type SiteReport } from "../lateral/skyciv";

const SAMPLE_REPORT: SiteReport = {
  latitude: 37.795143,
  longitude: -122.404312,
  address: "750 Kearny St, San Francisco, CA 94108, USA",
  elevationM: 7.15,
  country: "United States",
  designCode: "asce7-22",
  riskCategory: "II",
  siteClass: "D",
  windSpeed: 92,
  windUnit: "mph",
  windByCategory: { I: 87, II: 92, III: 99, IV: 103, "10-year": 61, "25-year": 68, "50-year": 73, "100-year": 78 },
  snow: { snow_load: "not available", w2: 0.25 },
  seismic: { ss: 1.5, s1: 0.6, sms: 1.63, sm1: 1.7, sds: 1.09, sd1: 1.13, sdc: "D", pgam: 0.55, ts: 1.04, t0: 0.209, tl: 12 },
  spectra: {},
  notes: ["Sample from the documented Kearny Street check. Generate a SkyCiv report for a live site."],
  raw: {},
};

const DEFAULT_LAT = 37.795143;
const DEFAULT_LNG = -122.404312;

const STEPS = ["Site loads", "Cs and base shear", "Site class comparison"];

const SITE_CLASSES: Record<string, string[]> = {
  "asce7-22": ["A", "B", "BC", "C", "CD", "D", "DE", "E"],
  "asce7-16": ["A", "B", "C", "D", "D-default", "E"],
};

export default function LateralPage() {
  const [query, setQuery] = useState("750 Kearny St, San Francisco");
  const [lat, setLat] = useState(DEFAULT_LAT);
  const [lng, setLng] = useState(DEFAULT_LNG);
  const [label, setLabel] = useState("750 Kearny St, San Francisco");
  const [matches, setMatches] = useState<Place[]>([]);
  const [risk, setRisk] = useState("II");
  const [designCode, setDesignCode] = useState("asce7-22");
  const [siteClass, setSiteClass] = useState("D");
  const [searchError, setSearchError] = useState("");
  const [areaError, setAreaError] = useState("");
  const [reportError, setReportError] = useState("");
  const [busy, setBusy] = useState<"search" | "report" | null>(null);
  const [report, setReport] = useState<SiteReport | null>(null);
  const [archiveNote, setArchiveNote] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const [csInputs, setCsInputs] = useState<SeismicInputs | null>(null);
  const [directionLabels, setDirectionLabels] = useState({ X: "", Y: "" });
  const { projectName, lateralStep: step, setLateralStep: setStep, setHazardReport, siteClassComparison, setSiteClassComparison } = useLtl();
  const [classCache, setClassCache] = useState<ClassCache | null>(() => (
    siteClassComparison?.key
      ? { key: siteClassComparison.key, fingerprint: siteClassComparison.fingerprint, rows: siteClassComparison.rows }
      : null
  ));
  const storeInputs = useCallback((inputs: SeismicInputs, labels: { X: string; Y: string }) => {
    setCsInputs((current) => (JSON.stringify(current) === JSON.stringify(inputs) ? current : inputs));
    setDirectionLabels((current) => (current.X === labels.X && current.Y === labels.Y ? current : labels));
  }, []);
  const go = (n: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, n)));
  const openCs = () => {
    const onSampleSite = Math.abs(lat - DEFAULT_LAT) < 1e-6 && Math.abs(lng - DEFAULT_LNG) < 1e-6
      && designCode === "asce7-22" && risk === "II" && siteClass === "D";
    if (!report && onSampleSite) setReport(SAMPLE_REPORT);
    go(1);
  };

  useEffect(() => {
    if (!SITE_CLASSES[designCode].includes(siteClass)) setSiteClass("D");
  }, [designCode, siteClass]);

  useEffect(() => {
    if (report) setHazardReport(report);
  }, [report, setHazardReport]);

  useEffect(() => {
    try {
      sessionStorage.removeItem("ltl_skyciv_username");
      sessionStorage.removeItem("ltl_skyciv_key");
    } catch {
      /* private mode can block storage */
    }
  }, []);

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
    setBusy("report");
    setArchiveNote("");
    setArchiveError("");
    try {
      const next = await fetchSiteReport({
        lat,
        lng,
        designCode,
        riskCategory: risk,
        siteClass,
      });
      setReport(next);
      await saveReportDocuments(next, projectName, setArchiveNote, setArchiveError);
    } catch (error) {
      setReport(null);
      setReportError(error instanceof SkyCivError ? error.message : "SkyCiv did not return a report.");
    } finally {
      setBusy(null);
    }
  };

  const onSample = async () => {
    setReport(SAMPLE_REPORT);
    setLat(SAMPLE_REPORT.latitude);
    setLng(SAMPLE_REPORT.longitude);
    setLabel(SAMPLE_REPORT.address ?? "750 Kearny St, San Francisco");
    setQuery(SAMPLE_REPORT.address ?? "750 Kearny St, San Francisco");
    setRisk(SAMPLE_REPORT.riskCategory);
    setDesignCode(SAMPLE_REPORT.designCode);
    setSiteClass(SAMPLE_REPORT.siteClass ?? "D");
    setReportError("");
    setAreaError("");
    setArchiveNote("");
    setArchiveError("");
    await saveReportDocuments(SAMPLE_REPORT, projectName, setArchiveNote, setArchiveError);
  };

  return (
    <div className="page page-scroll">
      <header className="page-header">
        <h1>Lateral</h1>
        <p className="muted subtitle">Site loads, then ASCE 7-22 seismic Cs, then Cs across site classes.</p>
      </header>

      <ol className="stepper">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? "current" : i < step ? "done" : ""}>
            <button type="button" onClick={() => (i === 1 ? openCs() : go(i))}>
              <span className="step-num">{i < step ? <Check size={13} /> : i + 1}</span>
              <span>{label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div hidden={step !== 1}>
        <SeismicCsStep
          report={report}
          projectName={projectName}
          onBack={() => go(0)}
          onInputs={storeInputs}
          onCompare={() => go(2)}
          active={step === 1}
        />
      </div>

      {step === 2 && (
        <SiteClassStep
          lat={lat}
          lng={lng}
          designCode={designCode}
          risk={risk}
          report={report}
          inputs={csInputs}
          labels={directionLabels}
          cache={classCache}
          onCache={(cache) => {
            setClassCache(cache);
            setSiteClassComparison({
              key: cache.key,
              fingerprint: cache.fingerprint,
              rows: cache.rows,
              projectClass: csInputs?.site_class.trim() || siteClass,
              risk: csInputs?.risk_category || risk,
            });
          }}
          onBack={() => go(1)}
        />
      )}

      {step === 0 && <>
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
        </div>
        <p className="muted small">Each report uses SkyCiv credits. The API key stays on the server and is not stored in the browser or the repository.</p>
        <div className="row-gap">
          <button className="btn" type="submit" disabled={busy != null}>{busy === "search" ? "Searching…" : "Search"}</button>
          <button className="btn primary" type="button" onClick={onGenerate} disabled={busy != null}>
            {busy === "report" ? "Generating…" : "Generate SkyCiv report"}
          </button>
          <button className="btn" type="button" disabled={busy != null} onClick={onSample}>
            Load sample report
          </button>
        </div>
        {searchError && <p className="banner error">{searchError}</p>}
        {areaError && <p className="banner error">{areaError}</p>}
        {reportError && <p className="banner error">{reportError}</p>}
        {archiveNote && (
          <p className="banner ok">
            {archiveNote}{" "}
            <Link className="link" to="/documents">Open Documents</Link>
          </p>
        )}
        {archiveError && <p className="banner info">{archiveError}</p>}
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
      <div className="step-footer">
        <span />
        <button className="btn primary" type="button" onClick={openCs}>Next: Cs and base shear</button>
      </div>
      </>}
    </div>
  );
}

async function saveReportDocuments(
  report: SiteReport,
  projectName: string,
  setNote: (note: string) => void,
  setError: (error: string) => void,
) {
  const files = hazardFiles(report, projectName);
  const local = await saveLocalDocuments(files);
  try {
    const saved = await archiveSiteReport(files);
    const names = saved.documents.map((doc) => doc.filename).join(" and ");
    setNote(`${names} saved to Documents › ${saved.folder_path.slice(1).join(" › ")}.`);
  } catch {
    const names = local.map((doc) => doc.filename).join(" and ");
    setNote(`${names} saved to Documents › Project Documents › Site Reports.`);
    setError("The Documents API is offline, so the files are stored in this browser until the local API is running.");
  }
}
