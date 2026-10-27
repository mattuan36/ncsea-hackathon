import type { DocumentRow, Folder } from "./api";

const KEY = "ltl_site_reports";

export interface LocalDocument {
  id: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  data_base64: string;
}

export const LOCAL_FOLDERS: Folder[] = [
  { id: -1, parent_id: null, name: "My Project", position: 0, file_count: 0 },
  { id: -2, parent_id: -1, name: "Project Documents", position: 0, file_count: 0 },
  { id: -3, parent_id: -2, name: "Site Reports", position: 0, file_count: 0 },
];

export const LOCAL_SITE_REPORTS_ID = -3;

export function loadLocalDocuments(): LocalDocument[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalDocument[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveLocalDocuments(files: File[]): Promise<LocalDocument[]> {
  const existing = loadLocalDocuments();
  let stamp = Date.now();
  const created: LocalDocument[] = [];
  for (const file of files) {
    const row: LocalDocument = {
      id: -(++stamp),
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      uploaded_at: new Date().toISOString(),
      data_base64: await fileToBase64(file),
    };
    created.push(row);
    existing.push(row);
  }
  localStorage.setItem(KEY, JSON.stringify(existing));
  return created;
}

export function deleteLocalDocument(id: number): void {
  localStorage.setItem(KEY, JSON.stringify(loadLocalDocuments().filter((row) => row.id !== id)));
}

export function downloadLocalDocument(id: number): void {
  const row = loadLocalDocuments().find((item) => item.id === id);
  if (!row) return;
  const bytes = Uint8Array.from(atob(row.data_base64), (ch) => ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: row.content_type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = row.filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function toDocumentRows(rows: LocalDocument[], folderId = LOCAL_SITE_REPORTS_ID): DocumentRow[] {
  return rows.map((row) => ({
    id: row.id,
    folder_id: folderId,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    uploaded_at: row.uploaded_at,
  }));
}

export function withLocalCounts(folders: Folder[], localCount: number): Folder[] {
  if (!localCount) return folders;
  const site = folders.find((folder) => folder.name === "Site Reports");
  if (!site) return folders;
  const bump = new Set<number>([site.id]);
  let parent = site.parent_id;
  while (parent != null) {
    bump.add(parent);
    parent = folders.find((folder) => folder.id === parent)?.parent_id ?? null;
  }
  return folders.map((folder) => (bump.has(folder.id) ? { ...folder, file_count: folder.file_count + localCount } : folder));
}

export function folderShowsLocalReports(folder: Folder | undefined, folders: Folder[]): boolean {
  if (!folder) return false;
  if (folder.name === "Site Reports" || folder.id === LOCAL_SITE_REPORTS_ID) return true;
  const children = folders.filter((item) => item.parent_id === folder.id);
  return children.some((child) => folderShowsLocalReports(child, folders));
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
