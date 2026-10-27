import { useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { archiveSiteReport } from "../api";
import { saveLocalDocuments } from "../localDocuments";
import { csReportFile, type CsReportData } from "./csReport";
import { hazardFiles } from "./hazardExport";
import type { SiteReport } from "./skyciv";

type Combination = "single" | "horizontal" | "vertical";

interface SystemOption {
  id: string;
  category: string;
  name: string;
  R: number;
  omega0: number;
  Cd: number;
}

interface DirectionForm {
  combination: Combination;
  systems: [string, string, string, string];
  period: string;
  periodType: string;
  momentFrames: boolean;
}

interface HazardPayload {
  project_number: string;
  source_status: string;
  sds: number | string | null;
  sd1: number | string | null;
  s1: number | string | null;
  tl: number | string | null;
  risk_category: string;
  site_class: string;
  part1_sdc: string;
  weight_kips: number | null;
  exchange_rows?: unknown[];
  warnings?: string[];
}

interface DirectionResult {
  system_ids: string[];
  cs: number;
  governing: string;
  base_shear_kips: number | null;
  base_shear_lbs: number | null;
  symbolic_base_shear: string;
  T_used: number;
  T_basis: string;
  combination: string;
  R: number;
  omega0: number;
  Cd: number;
  period_type_label: string;
  Ta: number;
  CuTa: number;
  sds_used: number;
  cs_upper_system: number | null;
  upper_system: { R: number } | null;
  transfer_amplification: number | null;
  system_limits: { id: string; status: string }[];
  combination_rule: string;
  sds_cap_status: string;
}

interface CalcResult {
  ie: number;
  sdc: string;
  sdc_basis: string;
  cu: number;
  weight_kips: number | null;
  directions: Record<"X" | "Y", DirectionResult>;
  warnings: string[];
  notes: string[];
}

const SITE_CLASSES = ["A", "B", "BC", "C", "CD", "D", "DE", "E", "F"];

const SOURCE_LABEL: Record<string, string> = {
  SKYCIV_GETSITEDATA: "Site report",
  SYNTHETIC_DEMO: "Sample data, not for design",
  ASCE_API_UNVERIFIED: "Imported file, not verified",
  MANUAL_OVERRIDE_UNVERIFIED: "Edited after import",
  MANUAL_UNVERIFIED: "Entered by hand",
};

function sourceLabel(status: string): string {
  return SOURCE_LABEL[status] ?? status.replaceAll("_", " ").toLowerCase();
}

function pageDefaults(): { X: DirectionForm; Y: DirectionForm } {
  return {
    X: { combination: "single", systems: ["C1", "", "", ""], period: "1.2", periodType: "", momentFrames: true },
    Y: { combination: "single", systems: ["B2", "", "", ""], period: "", periodType: "", momentFrames: false },
  };
}

function num(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function textNumber(value: number | string | null | undefined): string {
  if (value == null || value === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

function fmt(value: number | null | undefined, digits = 5): string {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

async function readError(response: Response): Promise<string> {
  const data = await response.json().catch(() => ({}));
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const row = item as { loc?: unknown[]; msg?: string };
        const loc = Array.isArray(row.loc) ? row.loc.slice(1).join(".") : "";
        return loc ? `${loc}: ${row.msg ?? "invalid"}` : (row.msg ?? "invalid");
      })
      .join(" ");
  }
  return `Request failed (${response.status}).`;
}

async function seismicJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/seismic${path}`, init);
  } catch {
    throw new Error("The seismic calculation service is not running.");
  }
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<T>;
}

export default function SeismicCsStep({
  report,
  projectName,
  onBack,
}: {
  report: SiteReport | null;
  projectName: string;
  onBack: () => void;
}) {
  const [systems, setSystems] = useState<SystemOption[]>([]);
  const [periodTypes, setPeriodTypes] = useState<Record<string, string>>({});
  const [project, setProject] = useState(projectName);
  const [source, setSource] = useState("MANUAL_UNVERIFIED");
  const [rows, setRows] = useState<unknown[]>([]);
  const [sds, setSds] = useState("");
  const [sd1, setSd1] = useState("");
  const [s1, setS1] = useState("");
  const [tl, setTl] = useState("");
  const [risk, setRisk] = useState("II");
  const [siteClass, setSiteClass] = useState("D");
  const [part1Sdc, setPart1Sdc] = useState("");
  const [hn, setHn] = useState("60");
  const [stories, setStories] = useState("4");
  const [weight, setWeight] = useState("");
  const [cap, setCap] = useState(false);
  const [regular, setRegular] = useState(false);
  const [rho, setRho] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [dirs, setDirs] = useState(pageDefaults);
  const [note, setNote] = useState("");
  const [fromStep1, setFromStep1] = useState(false);
  const [pendingStep1, setPendingStep1] = useState(Boolean(report));
  const [hazardFile, setHazardFile] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"calc" | "export" | "import" | "save" | null>(null);
  const [result, setResult] = useState<CalcResult | null>(null);
  const loaded = useRef(false);
  const appliedReport = useRef<SiteReport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const applyHazard = (hazard: HazardPayload, message: string) => {
    setProject(hazard.project_number || projectName);
    setSource(hazard.source_status || "MANUAL_UNVERIFIED");
    setRows(hazard.exchange_rows ?? []);
    setSds(textNumber(hazard.sds));
    setSd1(textNumber(hazard.sd1));
    setS1(textNumber(hazard.s1));
    setTl(textNumber(hazard.tl));
    setRisk(hazard.risk_category || "II");
    setSiteClass(hazard.site_class || "D");
    setPart1Sdc(hazard.part1_sdc || "");
    setWeight(hazard.weight_kips == null ? "" : String(hazard.weight_kips));
    setReviewed(false);
    setResult(null);
    setNote(message);
    setError("");
  };

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        if (!loaded.current) {
          const catalog = await seismicJson<{ systems: SystemOption[]; period_types: Record<string, string> }>("/systems");
          if (cancel) return;
          setSystems(catalog.systems);
          setPeriodTypes(catalog.period_types);
          setDirs(pageDefaults());
          setHn("60");
          setStories("4");
          loaded.current = true;
        }
        if (report && report !== appliedReport.current) {
          if (report.designCode !== "asce7-22") {
            setFromStep1(false);
            setPendingStep1(false);
            setError("This step calculates ASCE 7-22 only. The site report on step 1 uses another edition, so its hazard model was not loaded.");
            return;
          }
          const csv = hazardFiles(report, projectName)[0];
          const form = new FormData();
          form.append("xlsx", csv);
          const hazard = await seismicJson<HazardPayload>("/import", { method: "POST", body: form });
          if (cancel) return;
          appliedReport.current = report;
          applyHazard(hazard, "");
          setFromStep1(true);
          setHazardFile(csv.name);
          setPendingStep1(false);
          return;
        }
        if (!report && !appliedReport.current) {
          const hazard = await seismicJson<HazardPayload>("/default-hazard");
          if (cancel) return;
          applyHazard(hazard, "");
          setFromStep1(false);
          setHazardFile("");
        }
        if (!cancel) setPendingStep1(false);
      } catch (err) {
        if (!cancel) {
          setPendingStep1(false);
          setError(err instanceof Error ? err.message : "Could not load the hazard model.");
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [report, projectName]);

  const editHazard = (apply: () => void) => {
    apply();
    if (fromStep1 || rows.length) {
      setRows([]);
      setSource("MANUAL_OVERRIDE_UNVERIFIED");
      setFromStep1(false);
      setNote("Hazard values from the previous step were edited. The saved report will not stay linked to that file.");
    }
  };

  const setDir = (axis: "X" | "Y", patch: Partial<DirectionForm>) => {
    setDirs((current) => ({ ...current, [axis]: { ...current[axis], ...patch } }));
  };

  const payload = () => ({
    project_number: project.trim(),
    asce_edition: "7-22",
    source_status: source,
    sds: num(sds),
    sd1: num(sd1),
    s1: num(s1),
    tl: num(tl),
    risk_category: risk || null,
    site_class: siteClass.trim(),
    part1_sdc: part1Sdc.trim(),
    hn_ft: num(hn),
    stories_above_base: num(stories),
    weight_kips: num(weight),
    directions: (["X", "Y"] as const).map((axis) => {
      const dir = dirs[axis];
      const count = dir.combination === "single" ? 1 : dir.combination === "vertical" ? 2 : 4;
      return {
        direction: axis,
        combination: dir.combination,
        system_ids: dir.systems.slice(0, count).filter(Boolean),
        period_analysis_sec: num(dir.period),
        period_type_override: dir.periodType || null,
        moment_frames_resist_100pct: dir.momentFrames,
      };
    }),
    apply_sds_cap_12_8_1_3: cap,
    confirm_regular_no_irregularities: regular,
    confirm_rho_equals_1: rho,
    engineer_reviewed: reviewed,
  });

  const onCalculate = async () => {
    setBusy("calc");
    setError("");
    try {
      setResult(await seismicJson<CalcResult>("/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      }));
      setNote("Calculated. Review all warnings.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calculation failed.");
    } finally {
      setBusy(null);
    }
  };

  const onExport = async () => {
    setBusy("export");
    setError("");
    try {
      const data = await seismicJson<{ results: CalcResult; xlsx_base64: string; filename: string }>("/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: payload(), exchange_rows: rows }),
      });
      setResult(data.results);
      const bytes = Uint8Array.from(atob(data.xlsx_base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setNote("Workbook exported. Formulas recalculate in Excel. Warning text does not.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  };

  const onSaveReport = async () => {
    if (!result) return;
    setBusy("save");
    setError("");
    setSavedPath("");
    const data = buildReport(result);
    const file = csReportFile(data);
    try {
      const local = await saveLocalDocuments([file]);
      try {
        const saved = await archiveSiteReport([file]);
        const names = saved.documents.map((doc) => doc.filename).join(" and ");
        setSavedPath(saved.folder_path.slice(1).join(" › "));
        setNote(`${names} saved to Documents › ${saved.folder_path.slice(1).join(" › ")}.`);
      } catch {
        const names = local.map((doc) => doc.filename).join(" and ");
        setSavedPath("Project Documents › Site Reports");
        setNote(`${names} saved to Documents › Project Documents › Site Reports.`);
        setError("The Documents API is offline, so the file is stored in this browser until the local API is running.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the report.");
    } finally {
      setBusy(null);
    }
  };

  const buildReport = (calculated: CalcResult): CsReportData => ({
    project,
    source: sourceLabel(source),
    risk,
    siteClass,
    sds,
    sd1,
    s1,
    tl,
    reportedSdc: part1Sdc,
    hn,
    stories,
    weight,
    ie: calculated.ie,
    sdc: calculated.sdc,
    sdcBasis: calculated.sdc_basis,
    cu: calculated.cu,
    warnings: calculated.warnings,
    notes: calculated.notes,
    directions: (["X", "Y"] as const).map((axis) => {
      const direction = calculated.directions[axis];
      const form = dirs[axis];
      const shear = direction.base_shear_kips == null
        ? direction.symbolic_base_shear
        : `${direction.base_shear_kips.toLocaleString(undefined, { maximumFractionDigits: 1 })} kips`;
      return {
        axis,
        combination: form.combination,
        systemIds: direction.system_ids,
        systemNames: direction.system_ids.map((id) => systems.find((system) => system.id === id)?.name ?? ""),
        period: form.period,
        momentFrames: form.momentFrames,
        cs: direction.cs,
        governing: direction.governing,
        baseShear: shear,
        tUsed: direction.T_used,
        tBasis: direction.T_basis,
        r: direction.R,
        omega0: direction.omega0,
        cd: direction.Cd,
        periodType: direction.period_type_label,
        ta: direction.Ta,
        cuTa: direction.CuTa,
        sdsUsed: direction.sds_used,
        limit: direction.system_limits.map((limit) => `${limit.id}: ${limit.status}`).join("; "),
        rule: direction.combination_rule,
        capStatus: direction.sds_cap_status,
      };
    }),
  });

  const onImport = async (file: File) => {
    setBusy("import");
    setError("");
    const form = new FormData();
    form.append("xlsx", file);
    try {
      const hazard = await seismicJson<HazardPayload>("/import", { method: "POST", body: form });
      applyHazard(hazard, `Imported ${file.name}. ${(hazard.warnings ?? []).join(" ")}`.trim());
      setFromStep1(false);
      setHazardFile(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  };

  const groups = systems.reduce<Record<string, SystemOption[]>>((acc, system) => {
    (acc[system.category] ??= []).push(system);
    return acc;
  }, {});

  return (
    <>
      <section className="card">
        <h2 className="card-title">Hazard data</h2>
        {fromStep1 ? (
          <p className="banner ok">
            Hazard model is done from the previous step. {hazardFile || "The site report"} is already loaded. SDS, SD1, S1, and TL come from that document. Height, stories, and the lateral systems are not in the hazard model, so set them here.
          </p>
        ) : pendingStep1 ? (
          <p className="banner info">Loading the hazard model from the previous step.</p>
        ) : (
          <p className="banner info">
            The hazard model comes from Site loads, the previous step. Load or generate that report and these values fill in from that document.
          </p>
        )}
        <div className="row-gap" style={{ margin: "12px 0" }}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onImport(file);
              event.target.value = "";
            }}
          />
          <button className="btn" type="button" disabled={busy != null} onClick={() => fileRef.current?.click()}>
            {busy === "import" ? "Importing…" : "Import Excel or CSV"}
          </button>
          <span className="cs-choice">{sourceLabel(source)}</span>
        </div>
        <div className="form-grid">
          <label className="span-2">
            Project
            <input value={project} onChange={(event) => setProject(event.target.value)} />
          </label>
          <label>
            Risk category
            <select value={risk} onChange={(event) => setRisk(event.target.value)}>
              {["I", "II", "III", "IV"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            Site class
            <select value={siteClass} onChange={(event) => setSiteClass(event.target.value)}>
              {!SITE_CLASSES.includes(siteClass) && siteClass && <option>{siteClass}</option>}
              {SITE_CLASSES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            SDS
            <input value={sds} inputMode="decimal" onChange={(event) => editHazard(() => setSds(event.target.value))} />
          </label>
          <label>
            SD1
            <input value={sd1} inputMode="decimal" onChange={(event) => editHazard(() => setSd1(event.target.value))} />
          </label>
          <label>
            S1
            <input value={s1} inputMode="decimal" onChange={(event) => editHazard(() => setS1(event.target.value))} />
          </label>
          <label>
            TL (s)
            <input value={tl} inputMode="decimal" onChange={(event) => editHazard(() => setTl(event.target.value))} />
          </label>
          <label>
            Reported SDC
            <input value={part1Sdc} onChange={(event) => setPart1Sdc(event.target.value)} />
          </label>
          <label>
            hn (ft)
            <input value={hn} inputMode="decimal" onChange={(event) => setHn(event.target.value)} />
          </label>
          <label>
            Stories above base
            <input value={stories} inputMode="numeric" onChange={(event) => setStories(event.target.value)} />
          </label>
          <label>
            W (kips)
            <input value={weight} inputMode="decimal" placeholder="Blank until supplied" onChange={(event) => setWeight(event.target.value)} />
          </label>
        </div>
      </section>

      <div className="two-col">
        {(["X", "Y"] as const).map((axis) => (
          <DirectionCard
            key={axis}
            axis={axis}
            dir={dirs[axis]}
            groups={groups}
            periodTypes={periodTypes}
            onChange={(patch) => setDir(axis, patch)}
          />
        ))}
      </div>

      <section className="card">
        <h2 className="card-title">Section 12.8.1.3</h2>
        <div className="form-grid">
          <label className="check span-2">
            <input className="checkbox" type="checkbox" checked={cap} onChange={(event) => setCap(event.target.checked)} />
            <span>Apply the SDS cap. This value is not verified against the ASCE 7-22 text.</span>
          </label>
          <label className="check span-2">
            <input className="checkbox" type="checkbox" checked={regular} onChange={(event) => setRegular(event.target.checked)} />
            <span>Structure is regular, with no horizontal or vertical irregularities.</span>
          </label>
          <label className="check span-2">
            <input className="checkbox" type="checkbox" checked={rho} onChange={(event) => setRho(event.target.checked)} />
            <span>Redundancy factor ρ = 1.0.</span>
          </label>
          <label className="check span-2">
            <input className="checkbox" type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
            <span>An engineer has reviewed these inputs.</span>
          </label>
        </div>
        <div className="row-gap" style={{ marginTop: 12 }}>
          <button className="btn primary" type="button" disabled={busy != null} onClick={() => void onCalculate()}>
            {busy === "calc" ? "Calculating…" : "Calculate Cs"}
          </button>
          <button className="btn" type="button" disabled={busy != null} onClick={() => void onExport()}>
            {busy === "export" ? "Exporting…" : "Download workbook"}
          </button>
          <button className="btn" type="button" disabled={busy != null || !result} onClick={() => void onSaveReport()}>
            {busy === "save" ? "Saving…" : "Save report to Documents"}
          </button>
        </div>
        {note && <p className="banner info">{note}{savedPath && <>{" "}<Link className="link" to="/documents">Open Documents</Link></>}</p>}
        {error && <p className="banner error">{error}</p>}
      </section>

      {result && <ResultView result={result} />}

      <div className="step-footer">
        <button className="btn" type="button" onClick={onBack}>Back</button>
        <span />
      </div>
    </>
  );
}

function DirectionCard({
  axis,
  dir,
  groups,
  periodTypes,
  onChange,
}: {
  axis: "X" | "Y";
  dir: DirectionForm;
  groups: Record<string, SystemOption[]>;
  periodTypes: Record<string, string>;
  onChange: (patch: Partial<DirectionForm>) => void;
}) {
  const chosen = (id: string) => Object.values(groups).flat().find((system) => system.id === id);
  const count = dir.combination === "single" ? 1 : dir.combination === "vertical" ? 2 : 4;
  const labelFor = (index: number) => {
    if (dir.combination === "vertical") return index === 0 ? "Upper system" : "Lower system";
    if (dir.combination === "horizontal") return `System ${index + 1}${index > 1 ? " (optional)" : ""}`;
    return "Lateral system";
  };
  const options = (
    <>
      <option value="">Select a system</option>
      {Object.entries(groups).map(([category, items]) => (
        <optgroup key={category} label={category}>
          {items.map((system) => (
            <option key={system.id} value={system.id}>
              {system.id} — {system.name} (R {system.R})
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
  return (
    <section className="card cs-dir">
      <h2 className="card-title">Direction {axis}</h2>
      <div className="form-grid">
        <label className="span-2">
          Combination (Section 12.2.3)
          <select
            value={dir.combination}
            onChange={(event) => onChange({ combination: event.target.value as Combination })}
          >
            <option value="single">Single system</option>
            <option value="horizontal">Horizontal — multiple systems, same direction</option>
            <option value="vertical">Vertical — upper over lower</option>
          </select>
        </label>
        {dir.systems.map((value, index) => (
          index < count ? (
            <label className="span-2" key={index}>
              {labelFor(index)}
              <select
                value={value}
                onChange={(event) => {
                  const systems = [...dir.systems] as DirectionForm["systems"];
                  systems[index] = event.target.value;
                  onChange({ systems });
                }}
              >
                {options}
              </select>
              {chosen(value) && (
                <span className="cs-choice">{chosen(value)?.name}. R {chosen(value)?.R}, Omega0 {chosen(value)?.omega0}, Cd {chosen(value)?.Cd}.</span>
              )}
            </label>
          ) : null
        ))}
        <label>
          Analysis period T (s)
          <input
            value={dir.period}
            inputMode="decimal"
            placeholder="Blank = use Ta"
            onChange={(event) => onChange({ period: event.target.value })}
          />
        </label>
        <label>
          Table 12.8-2 type
          <select value={dir.periodType} onChange={(event) => onChange({ periodType: event.target.value })}>
            <option value="">Auto (from system)</option>
            {Object.entries(periodTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="check span-2">
          <input
            className="checkbox"
            type="checkbox"
            checked={dir.momentFrames}
            onChange={(event) => onChange({ momentFrames: event.target.checked })}
          />
          <span>Moment frames resist 100% of the seismic force and are not enclosed by more rigid components.</span>
        </label>
      </div>
    </section>
  );
}

function ResultView({ result }: { result: CalcResult }) {
  return (
    <section className="card">
      <h2 className="card-title">Results</h2>
      <div className="kpis">
        <div className="kpi"><span>Ie</span><strong>{result.ie}</strong><span>Table 1.5-2</span></div>
        <div className="kpi"><span>SDC</span><strong>{result.sdc}</strong><span>{result.sdc_basis}</span></div>
        <div className="kpi"><span>Cu</span><strong>{fmt(result.cu, 3)}</strong><span>Table 12.8-1</span></div>
        <div className="kpi">
          <span>W</span>
          <strong>{result.weight_kips == null ? "—" : result.weight_kips.toLocaleString()}</strong>
          <span>{result.weight_kips == null ? "Engineer input required" : "kips"}</span>
        </div>
      </div>
      <div className="two-col" style={{ marginTop: 16 }}>
        {(["X", "Y"] as const).map((axis) => {
          const direction = result.directions[axis];
          const shear = direction.base_shear_kips == null
            ? direction.symbolic_base_shear
            : `${direction.base_shear_kips.toLocaleString(undefined, { maximumFractionDigits: 1 })} kips`;
          return (
            <div key={axis}>
              <h3 className="card-title">Direction {axis} · {direction.system_ids.join(" + ")}</h3>
              <div className="kpis">
                <div className="kpi"><span>Cs</span><strong>{fmt(direction.cs)}</strong><span>{direction.governing}</span></div>
                <div className="kpi">
                  <span>Base shear</span>
                  <strong>{shear}</strong>
                  <span>{direction.base_shear_lbs == null ? "Weight not entered" : `${Math.round(direction.base_shear_lbs).toLocaleString()} lb`}</span>
                </div>
                <div className="kpi"><span>Period used</span><strong>{fmt(direction.T_used, 3)} s</strong></div>
                <div className="kpi"><span>R / Omega0 / Cd</span><strong>{direction.R} / {direction.omega0} / {direction.Cd}</strong></div>
              </div>
              <p className="cs-read">{direction.T_basis}. {direction.combination_rule}</p>
              <p className="cs-read">Section 12.8.1.3: {direction.sds_cap_status}.</p>
              <table className="data-table">
                <tbody>
                  <tr><td>Approximate period Ta ({direction.period_type_label})</td><td className="num">{fmt(direction.Ta, 3)} s</td></tr>
                  <tr><td>Upper limit Cu times Ta</td><td className="num">{fmt(direction.CuTa, 3)} s</td></tr>
                  <tr><td>SDS used for Cs</td><td className="num">{fmt(direction.sds_used, 3)}</td></tr>
                  {direction.cs_upper_system != null && (
                    <>
                      <tr><td>Cs of the upper system (R = {direction.upper_system?.R})</td><td className="num">{fmt(direction.cs_upper_system)}</td></tr>
                      <tr><td>Transfer amplification</td><td className="num">{fmt(direction.transfer_amplification, 3)}</td></tr>
                    </>
                  )}
                  {direction.system_limits.map((limit) => (
                    <tr key={limit.id}><td>{limit.id} height limit, SDC {result.sdc}</td><td className="num">{limit.status}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      {(result.warnings.length ? result.warnings : ["None"]).map((warning) => (
        <p className="banner warn" key={warning}>{warning}</p>
      ))}
      {result.notes.map((item) => <p className="banner info" key={item}>{item}</p>)}
    </section>
  );
}
