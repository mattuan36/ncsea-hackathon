export interface Folder {
  id: number;
  parent_id: number | null;
  name: string;
  position: number;
  file_count: number;
}

export interface DocumentRow {
  id: number;
  folder_id: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

async function check(res: Response): Promise<Response> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res;
}

const rawApiBase = import.meta.env.VITE_API_BASE?.trim();
const apiBase = rawApiBase ? rawApiBase.replace(/\/+$/, '') : '';

function apiUrl(path: string): string {
  if (!apiBase) return path;
  return `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function fetchFolders(): Promise<Folder[]> {
  return (await check(await fetch(apiUrl('/api/folders')))).json();
}

export async function fetchDocuments(folderId: number, recursive = true): Promise<DocumentRow[]> {
  const qs = new URLSearchParams({ folder_id: String(folderId), recursive: String(recursive) });
  return (await check(await fetch(apiUrl(`/api/documents?${qs}`)))).json();
}

export async function uploadDocuments(folderId: number, files: File[]): Promise<DocumentRow[]> {
  const body = new FormData();
  body.append('folder_id', String(folderId));
  files.forEach((f) => body.append('files', f));
  return (await check(await fetch(apiUrl('/api/documents'), { method: 'POST', body }))).json();
}

export interface SiteReportArchive {
  folder_id: number;
  folder_path: string[];
  documents: DocumentRow[];
}

export async function archiveSiteReport(files: File[]): Promise<SiteReportArchive> {
  const body = new FormData();
  files.forEach((file) => body.append('files', file));
  return (await check(await fetch(apiUrl('/api/site-reports/archive'), { method: 'POST', body }))).json();
}

export async function deleteDocument(id: number): Promise<void> {
  await check(await fetch(apiUrl(`/api/documents/${id}`), { method: 'DELETE' }));
}

export const downloadUrl = (id: number) => apiUrl(`/api/documents/${id}/download`);

export function triggerDownload(id: number): void {
  const a = document.createElement('a');
  a.href = downloadUrl(id);
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------- materials DB

/** One materials-DB row (Kim's dead load spreadsheet, proposed rows, or user-added). */
export interface MaterialRow {
  id: string;
  t_in: number | null;
  material: string;
  orientation: string;
  use: string;
  info: string;
  psf: number | null;
  psf_per_in: number | null;
  psf_text: string | null;
  source: string;
  custom: boolean;
  edited: boolean;
  position: number;
}

export type MaterialInput = Partial<Omit<MaterialRow, 'id' | 'custom' | 'edited' | 'position' | 'psf_text'>> & { material: string };

const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchMaterialRows(): Promise<MaterialRow[]> {
  return (await check(await fetch(apiUrl('/api/materials')))).json();
}

export async function createMaterialRow(m: MaterialInput): Promise<MaterialRow> {
  return (await check(await fetch(apiUrl('/api/materials'), { method: 'POST', ...json(m) }))).json();
}

export async function patchMaterialRow(id: string, patch: Partial<MaterialInput>): Promise<MaterialRow> {
  return (await check(await fetch(apiUrl(`/api/materials/${encodeURIComponent(id)}`), { method: 'PATCH', ...json(patch) }))).json();
}

export async function deleteMaterialRow(id: string): Promise<void> {
  await check(await fetch(apiUrl(`/api/materials/${encodeURIComponent(id)}`), { method: 'DELETE' }));
}

// ---------------------------------------------------------------- IFC models

export type ModelStatus = 'queued' | 'running' | 'ready' | 'failed';

export interface ModelRow {
  id: number;
  filename: string;
  document_id: number | null;
  size_bytes: number;
  status: ModelStatus;
  stage: string;
  progress: number;
  error: string | null;
  settings: { project_name?: string; allowance_options?: string[] };
  created_at: string;
  finished_at: string | null;
}

/** gravity_ifc JSON, schema_version 1 (see gravity_ifc/README.md). Only the fields the app reads are typed. */
export interface IfcLayer {
  material: string;
  thickness_in: number | null;
  match?: { status: string; row_id: string | null; psf: number | null; candidates?: string[]; note?: string };
}

export interface IfcType {
  id: string;
  kind: 'wall' | 'curtain_wall' | 'floor' | 'roof' | 'ceiling';
  name: string;
  instances: number;
  layers: IfcLayer[];
  qty: { length_lf?: number; net_area_sf?: number; gross_area_sf?: number; avg_height_ft?: number; plan_area_sf?: number; top_area_sf?: number };
  structural_guess?: { layer_index: number; class: string; material: string; reason: string } | null;
  group?: string;
  flags?: string[];
}

type XY = [number, number];

export interface IfcResult {
  schema_version: number;
  source: { file: string; ifc_schema: string };
  levels: { id: number; name: string; elevation_ft: number; floor_area_sf?: number; minor?: boolean }[];
  types: IfcType[];
  plan: Record<string, {
    zones: { composite_id: string; type_ids: string[]; area_sf: number; polygons: { outer: XY[]; holes: XY[][] }[]; label_xy: XY | null }[];
    walls: { element_id: number; type_id: string; points: XY[]; length_lf: number; height_ft: number; net_area_sf: number }[];
  }>;
}

export interface ModelData extends ModelRow {
  result: IfcResult;
  decisions: Record<string, Record<string, unknown>>;
}

export async function fetchModels(): Promise<ModelRow[]> {
  return (await check(await fetch(apiUrl('/api/models')))).json();
}

export async function fetchModel(id: number): Promise<ModelRow> {
  return (await check(await fetch(apiUrl(`/api/models/${id}`)))).json();
}

export async function fetchModelData(id: number): Promise<ModelData> {
  return (await check(await fetch(apiUrl(`/api/models/${id}/data`)))).json();
}

export async function uploadModel(file: File): Promise<ModelRow> {
  const body = new FormData();
  body.append('file', file);
  return (await check(await fetch(apiUrl('/api/models'), { method: 'POST', body }))).json();
}

export async function modelFromDocument(docId: number): Promise<ModelRow> {
  return (await check(await fetch(apiUrl(`/api/models/from-document/${docId}`), { method: 'POST' }))).json();
}

export async function saveTypeDecision(modelId: number, typeId: string, decision: Record<string, unknown>): Promise<void> {
  await check(await fetch(apiUrl(`/api/models/${modelId}/types/${encodeURIComponent(typeId)}`), { method: 'PUT', ...json(decision) }));
}

export async function patchModelSettings(modelId: number, patch: ModelRow['settings']): Promise<void> {
  await check(await fetch(apiUrl(`/api/models/${modelId}/settings`), { method: 'PATCH', ...json(patch) }));
}
