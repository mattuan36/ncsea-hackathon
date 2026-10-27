import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createMaterialRow, deleteMaterialRow, downloadUrl, fetchMaterialRows, fetchModel, fetchModelData, fetchModels, modelFromDocument,
  patchMaterialRow, patchModelSettings, saveTypeDecision, uploadModel, type ModelRow,
} from '../api';
import { ALLOWANCE_OPTIONS, DEMO_PLAN, ELEMENT_TYPES, uid, type ElementType, type Material, type Plan } from './data';
import { DEMO_MATERIALS, decisionOf, fromModel, materialToRow, rowToMaterial, unitWeightPatch } from './model';

export interface ModelSource {
  kind: 'ifc' | 'revit';
  label: string;
}

/** Demo = the in-memory sample building; model = an uploaded IFC whose data lives in Postgres. */
export type Project = { kind: 'demo' } | { kind: 'model'; id: number; filename: string };

export type IfcLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface IfcModel {
  name: string;
  data: Uint8Array;
}

interface LtlState {
  project: Project;
  isDemo: boolean;
  projectName: string;
  setProjectName: (name: string) => void;
  model: ModelSource | null;
  setModel: (m: ModelSource | null) => void;
  /** Bytes of the imported IFC. In memory only; cleared on reload. */
  ifc: IfcModel | null;
  ifcStatus: IfcLoadStatus;
  ifcError: string | null;
  loadIfcFile: (file: File) => Promise<void>;
  loadIfcFromUrl: (name: string, url: string) => Promise<void>;
  gravityStep: number;
  setGravityStep: (n: number) => void;
  lateralStep: number;
  setLateralStep: (n: number) => void;
  materials: Material[];
  /** 'offline': the materials API could not be reached; the Demo samples are shown instead */
  materialsSource: 'loading' | 'db' | 'offline';
  addMaterial: (m: Omit<Material, 'id'>) => Promise<Material>;
  updateMaterial: (id: string, patch: Partial<Material>) => void;
  removeMaterial: (id: string) => void;
  allowanceOptions: string[];
  /** adds an allowance option (case-insensitive dedupe) and returns the stored name */
  addAllowanceOption: (name: string) => string;
  types: ElementType[];
  plan: Plan;
  updateType: (id: string, patch: Partial<ElementType>) => void;
  copyLayers: (fromId: string, toId: string) => void;
  /** Merge two assemblies; the non-governing one becomes a sub-assembly of the governing one. */
  mergeTypes: (aId: string, bId: string, governingId: string) => void;
  unmerge: (id: string) => void;
  /** uploaded IFC models, newest first */
  models: ModelRow[];
  /** the extraction being watched (queued / running / just failed) */
  job: ModelRow | null;
  startUpload: (file: File) => Promise<void>;
  startFromDocument: (docId: number) => Promise<void>;
  openModel: (id: number) => Promise<void>;
  openDemo: () => void;
  /** last error loading a model or saving a decision */
  error: string | null;
}

const Ctx = createContext<LtlState | null>(null);
const PROJECT_KEY = 'ltl.project';
const DEMO_NAME = 'Riverside Office Building';

function remember(value: string) {
  try {
    localStorage.setItem(PROJECT_KEY, value);
  } catch {
    /* storage blocked: the latest model opens next time */
  }
}

function recalled(): string | null {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

export function LtlProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project>({ kind: 'demo' });
  const [projectName, setProjectNameState] = useState(DEMO_NAME);
  const [model, setModelState] = useState<ModelSource | null>(null);
  const [ifc, setIfc] = useState<IfcModel | null>(null);
  const [ifcStatus, setIfcStatus] = useState<IfcLoadStatus>('idle');
  const [ifcError, setIfcError] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const [gravityStep, setGravityStep] = useState(0);
  const [lateralStep, setLateralStep] = useState(0);
  const [dbMaterials, setDbMaterials] = useState<Material[]>([]);
  const [localMaterials, setLocalMaterials] = useState<Material[]>(DEMO_MATERIALS);
  const [materialsSource, setMaterialsSource] = useState<LtlState['materialsSource']>('loading');
  const [types, setTypes] = useState<ElementType[]>(ELEMENT_TYPES);
  const [plan, setPlan] = useState<Plan>(DEMO_PLAN);
  const [allowanceOptions, setAllowanceOptions] = useState<string[]>(ALLOWANCE_OPTIONS);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [job, setJob] = useState<ModelRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const demoState = useRef<{ types: ElementType[]; name: string; allowances: string[] } | null>(null);
  const saved = useRef<Map<string, string>>(new Map());
  const modelId = project.kind === 'model' ? project.id : null;

  // ---- materials: the DB is the source; the Demo also keeps its own samples
  useEffect(() => {
    fetchMaterialRows()
      .then((rows) => {
        setDbMaterials(rows.map(rowToMaterial));
        setMaterialsSource('db');
      })
      .catch(() => setMaterialsSource('offline'));
  }, []);

  const materials = useMemo(() => {
    if (materialsSource !== 'db') return localMaterials;
    return project.kind === 'demo' ? [...dbMaterials, ...DEMO_MATERIALS] : dbMaterials;
  }, [materialsSource, localMaterials, dbMaterials, project.kind]);

  const addMaterial = useCallback(async (m: Omit<Material, 'id'>) => {
    if (materialsSource !== 'db') {
      const created = { ...m, id: uid('m'), custom: true };
      setLocalMaterials((list) => [...list, created]);
      return created;
    }
    const created = rowToMaterial(await createMaterialRow(materialToRow(m)));
    setDbMaterials((list) => [...list, created]);
    return created;
  }, [materialsSource]);

  const weightTimers = useRef<Map<string, number>>(new Map());
  const updateMaterial = useCallback((id: string, patch: Partial<Material>) => {
    const apply = (list: Material[]) => list.map((m) => (m.id === id ? { ...m, ...patch } : m));
    const target = dbMaterials.find((m) => m.id === id);
    if (!target) {
      setLocalMaterials(apply);
      return;
    }
    setDbMaterials(apply);
    if (patch.unitWeight == null) return;
    // the field fires per keystroke: save the last value
    window.clearTimeout(weightTimers.current.get(id));
    weightTimers.current.set(id, window.setTimeout(() => {
      patchMaterialRow(id, unitWeightPatch(target, patch.unitWeight!))
        .then((row) => setDbMaterials((list) => list.map((m) => (m.id === id ? rowToMaterial(row) : m))))
        .catch((e: Error) => setError(`Saving ${target.name}: ${e.message}`));
    }, 400));
  }, [dbMaterials]);

  const removeMaterial = useCallback((id: string) => {
    if (!dbMaterials.some((m) => m.id === id)) {
      setLocalMaterials((list) => list.filter((m) => m.id !== id));
      return;
    }
    deleteMaterialRow(id)
      .then(() => setDbMaterials((list) => list.filter((m) => m.id !== id)))
      .catch((e: Error) => setError(e.message));
  }, [dbMaterials]);

  const clearIfc = useCallback(() => {
    loadSeq.current += 1;
    setIfc(null);
    setIfcStatus('idle');
    setIfcError(null);
  }, []);

  const setModel = useCallback((m: ModelSource | null) => {
    setModelState(m);
    if (!m || m.kind !== 'ifc') clearIfc();
  }, [clearIfc]);

  const readIfc = useCallback(async (name: string, read: () => Promise<Uint8Array>) => {
    const id = ++loadSeq.current;
    setModelState({ kind: 'ifc', label: name });
    setIfc(null);
    setIfcStatus('loading');
    setIfcError(null);
    try {
      const data = await read();
      if (id !== loadSeq.current) return;
      setIfc({ name, data });
      setIfcStatus('ready');
    } catch (readError) {
      if (id !== loadSeq.current) return;
      setIfc(null);
      setIfcStatus('error');
      setIfcError(readError instanceof Error ? readError.message : 'Could not read the IFC file.');
    }
  }, []);

  const loadIfcFile = useCallback(async (file: File) => {
    if (!/\.ifc$/i.test(file.name)) {
      loadSeq.current += 1;
      setModelState({ kind: 'ifc', label: file.name });
      setIfc(null);
      setIfcStatus('error');
      setIfcError('Choose an .ifc file.');
      return;
    }
    await readIfc(file.name, async () => new Uint8Array(await file.arrayBuffer()));
  }, [readIfc]);

  const loadIfcFromUrl = useCallback(async (name: string, url: string) => {
    await readIfc(name, async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not download ${name} (${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    });
  }, [readIfc]);

  // ---- projects
  const openDemo = useCallback(() => {
    const d = demoState.current;
    setTypes(d?.types ?? ELEMENT_TYPES);
    setProjectNameState(d?.name ?? DEMO_NAME);
    setAllowanceOptions(d?.allowances ?? ALLOWANCE_OPTIONS);
    setPlan(DEMO_PLAN);
    setProject({ kind: 'demo' });
    setModel(null);
    setGravityStep(0);
    remember('demo');
  }, []);

  const openModel = useCallback(async (id: number) => {
    setError(null);
    try {
      const data = await fetchModelData(id);
      const { types: next, plan: nextPlan } = fromModel(data.result, data.decisions);
      saved.current = new Map(next.map((t) => [t.id, JSON.stringify(decisionOf(t))]));
      setProject((p) => {
        if (p.kind === 'demo') demoState.current = { types, name: projectName, allowances: allowanceOptions };
        return { kind: 'model', id, filename: data.filename };
      });
      setTypes(next);
      setPlan(nextPlan);
      setProjectNameState(data.settings.project_name ?? data.filename.replace(/\.ifc(zip)?$/i, ''));
      setAllowanceOptions(data.settings.allowance_options ?? ALLOWANCE_OPTIONS);
      setModel({ kind: 'ifc', label: data.filename });
      if (data.document_id != null) void loadIfcFromUrl(data.filename, downloadUrl(data.document_id));
      remember(String(id));
    } catch (e) {
      setError(`Could not open model ${id}: ${(e as Error).message}`);
    }
  }, [types, projectName, allowanceOptions, setModel, loadIfcFromUrl]);

  const refreshModels = useCallback(() => fetchModels().then(setModels).catch(() => setModels([])), []);

  // first load: the remembered project, else the newest ready model, else the Demo
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    fetchModels()
      .then((list) => {
        setModels(list);
        // a model still being read shows its progress whichever project is open
        const running = list.find((m) => m.status === 'queued' || m.status === 'running');
        if (running) setJob(running);
        const want = recalled();
        if (want === 'demo') return;
        const pick = list.find((m) => String(m.id) === want && m.status === 'ready') ?? list.find((m) => m.status === 'ready');
        if (pick) return openModel(pick.id);
      })
      .catch(() => { /* API offline: stay on the Demo */ });
  }, [openModel]);

  // ---- extraction jobs: poll until ready, then open the model
  const startUpload = useCallback(async (file: File) => {
    setError(null);
    setJob({ id: 0, filename: file.name, document_id: null, size_bytes: file.size, status: 'queued', stage: 'Uploading', progress: 0, error: null, settings: {}, created_at: '', finished_at: null });
    try {
      setJob(await uploadModel(file));
    } catch (e) {
      setJob(null);
      setError(`Upload failed: ${(e as Error).message}`);
    }
  }, []);

  const startFromDocument = useCallback(async (docId: number) => {
    setError(null);
    try {
      setJob(await modelFromDocument(docId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!job || !job.id || job.status === 'ready' || job.status === 'failed') return;
    const timer = window.setTimeout(async () => {
      try {
        const next = await fetchModel(job.id);
        setJob(next);
        if (next.status === 'ready') {
          await openModel(next.id);
          setJob(null);
          refreshModels();
        } else if (next.status === 'failed') {
          refreshModels();
        }
      } catch (e) {
        setJob({ ...job, status: 'failed', error: (e as Error).message });
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [job, openModel, refreshModels]);

  // ---- decisions: save every changed type of an open model
  useEffect(() => {
    if (modelId == null) return;
    const changed = types.filter((t) => saved.current.get(t.id) !== JSON.stringify(decisionOf(t)));
    if (!changed.length) return;
    const timer = window.setTimeout(() => {
      changed.forEach((t) => {
        const body = decisionOf(t);
        saveTypeDecision(modelId, t.id, body)
          .then(() => saved.current.set(t.id, JSON.stringify(body)))
          .catch((e: Error) => setError(`Not saved (${t.name}): ${e.message}`));
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [types, modelId]);

  const nameTimer = useRef<number>();
  const setProjectName = useCallback((name: string) => {
    setProjectNameState(name);
    if (modelId == null) return;
    window.clearTimeout(nameTimer.current);
    nameTimer.current = window.setTimeout(() => {
      patchModelSettings(modelId, { project_name: name }).catch((e: Error) => setError(e.message));
    }, 400);
  }, [modelId]);

  const addAllowanceOption = useCallback((name: string) => {
    const clean = name.trim();
    const existing = allowanceOptions.find((o) => o.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    const next = [...allowanceOptions, clean];
    setAllowanceOptions(next);
    if (modelId != null) patchModelSettings(modelId, { allowance_options: next }).catch((e: Error) => setError(e.message));
    return clean;
  }, [allowanceOptions, modelId]);

  const updateType = useCallback((id: string, patch: Partial<ElementType>) => {
    setTypes((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const copyLayers = useCallback((fromId: string, toId: string) => {
    setTypes((list) => {
      const src = list.find((t) => t.id === fromId);
      if (!src) return list;
      return list.map((t) =>
        t.id === toId ? { ...t, layers: src.layers.map((l) => ({ ...l, id: uid('l') })) } : t,
      );
    });
  }, []);

  const mergeTypes = useCallback((aId: string, bId: string, governingId: string) => {
    const childId = governingId === aId ? bId : aId;
    setTypes((list) =>
      list.map((t) => {
        if (t.id === childId) return { ...t, parentId: governingId, status: 'merged' };
        // anything that hung off the child now hangs off the governing assembly
        if (t.parentId === childId) return { ...t, parentId: governingId };
        if (t.id === governingId) return { ...t, parentId: null };
        return t;
      }),
    );
  }, []);

  const unmerge = useCallback((id: string) => {
    setTypes((list) => list.map((t) => (t.id === id ? { ...t, parentId: null, status: 'todo' } : t)));
  }, []);

  const value = useMemo(
    () => ({
      project, isDemo: project.kind === 'demo',
      projectName, setProjectName, model, setModel, ifc, ifcStatus, ifcError, loadIfcFile, loadIfcFromUrl,
      gravityStep, setGravityStep, lateralStep, setLateralStep,
      materials, materialsSource, addMaterial, updateMaterial, removeMaterial,
      allowanceOptions, addAllowanceOption,
      types, plan, updateType, copyLayers, mergeTypes, unmerge,
      models, job, startUpload, startFromDocument, openModel, openDemo, error,
    }),
    [project, projectName, setProjectName, model, setModel, ifc, ifcStatus, ifcError, loadIfcFile, loadIfcFromUrl, gravityStep, lateralStep, materials, materialsSource, addMaterial, updateMaterial, removeMaterial,
      allowanceOptions, addAllowanceOption, types, plan, updateType, copyLayers, mergeTypes, unmerge,
      models, job, startUpload, startFromDocument, openModel, openDemo, error],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLtl(): LtlState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLtl must be used inside LtlProvider');
  return ctx;
}
