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

export async function fetchFolders(): Promise<Folder[]> {
  return (await check(await fetch('/api/folders'))).json();
}

export async function fetchDocuments(folderId: number, recursive = true): Promise<DocumentRow[]> {
  const qs = new URLSearchParams({ folder_id: String(folderId), recursive: String(recursive) });
  return (await check(await fetch(`/api/documents?${qs}`))).json();
}

export async function uploadDocuments(folderId: number, files: File[]): Promise<DocumentRow[]> {
  const body = new FormData();
  body.append('folder_id', String(folderId));
  files.forEach((f) => body.append('files', f));
  return (await check(await fetch('/api/documents', { method: 'POST', body }))).json();
}

export async function deleteDocument(id: number): Promise<void> {
  await check(await fetch(`/api/documents/${id}`, { method: 'DELETE' }));
}

export const downloadUrl = (id: number) => `/api/documents/${id}/download`;

export function triggerDownload(id: number): void {
  const a = document.createElement('a');
  a.href = downloadUrl(id);
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
