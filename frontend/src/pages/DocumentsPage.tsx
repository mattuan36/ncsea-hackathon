import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, File, Folder as FolderIcon, Trash2, Upload, X } from 'lucide-react';
import {
  deleteDocument,
  downloadUrl,
  fetchDocuments,
  fetchFolders,
  triggerDownload,
  uploadDocuments,
  type DocumentRow,
  type Folder,
} from '../api';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function DocumentsPage() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [checkedFolders, setCheckedFolders] = useState<Set<number>>(new Set());
  const [checkedDocs, setCheckedDocs] = useState<Set<number>>(new Set());
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DocumentRow[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const children = useMemo(() => {
    const m = new Map<number | null, Folder[]>();
    folders.forEach((f) => m.set(f.parent_id, [...(m.get(f.parent_id) ?? []), f]));
    return m;
  }, [folders]);

  const loadFolders = useCallback(async () => {
    const list = await fetchFolders();
    setFolders(list);
    return list;
  }, []);

  const loadDocs = useCallback(async (folderId: number) => {
    setLoadingDocs(true);
    try {
      setDocs(await fetchDocuments(folderId));
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  // Initial load: select the first second-level folder (e.g. "Project Documents"), expand its ancestors.
  useEffect(() => {
    loadFolders()
      .then((list) => {
        const root = list.find((f) => f.parent_id === null);
        if (!root) return;
        const first = list.find((f) => f.parent_id === root.id) ?? root;
        setSelectedFolderId(first.id);
        setExpanded(new Set([root.id, first.id]));
      })
      .catch((e: Error) => setError(e.message));
  }, [loadFolders]);

  useEffect(() => {
    if (selectedFolderId == null) return;
    setCheckedDocs(new Set());
    loadDocs(selectedFolderId).catch((e: Error) => setError(e.message));
  }, [selectedFolderId, loadDocs]);

  const refresh = async () => {
    await loadFolders();
    if (selectedFolderId != null) await loadDocs(selectedFolderId);
  };

  const breadcrumb = useMemo(() => {
    const path: Folder[] = [];
    let cur = selectedFolderId != null ? byId.get(selectedFolderId) : undefined;
    while (cur) {
      path.unshift(cur);
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
    }
    return path;
  }, [selectedFolderId, byId]);

  const folderPath = (folderId: number) => {
    const names: string[] = [];
    let cur = byId.get(folderId);
    while (cur && cur.id !== selectedFolderId) {
      names.unshift(cur.name);
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
    }
    return names.join(' / ') || '—';
  };

  const toggle = (set: Set<number>, id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  // Resolve the current selection (checked files + every file under checked folders).
  const resolveSelection = async (): Promise<DocumentRow[]> => {
    const all = new Map<number, DocumentRow>();
    docs.filter((d) => checkedDocs.has(d.id)).forEach((d) => all.set(d.id, d));
    for (const fid of checkedFolders) {
      (await fetchDocuments(fid)).forEach((d) => all.set(d.id, d));
    }
    return [...all.values()];
  };

  const selectionCount = checkedDocs.size + checkedFolders.size;

  const handleUpload = async (files: File[]) => {
    if (!files.length || selectedFolderId == null) return;
    setBusy(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    setError(null);
    try {
      await uploadDocuments(selectedFolderId, files);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleBulkDownload = async () => {
    try {
      const rows = await resolveSelection();
      rows.forEach((d, i) => setTimeout(() => triggerDownload(d.id), i * 300));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const askBulkDelete = async () => {
    try {
      const rows = await resolveSelection();
      if (rows.length) setPendingDelete(rows);
      else setError('The checked folders contain no files.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const rows = pendingDelete;
    setPendingDelete(null);
    setBusy(`Deleting ${rows.length} file${rows.length > 1 ? 's' : ''}…`);
    setError(null);
    try {
      for (const d of rows) await deleteDocument(d.id);
      setCheckedDocs(new Set());
      setCheckedFolders(new Set());
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const renderTree = (parentId: number | null, depth: number): JSX.Element[] =>
    (children.get(parentId) ?? []).map((f) => {
      const kids = children.get(f.id) ?? [];
      const isOpen = expanded.has(f.id);
      const isSelected = f.id === selectedFolderId;
      return (
        <div key={f.id} className="tree-node">
          <div
            className={`tree-row${isSelected ? ' selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 20 }}
            onClick={() => setSelectedFolderId(f.id)}
          >
            <input
              type="checkbox"
              className="checkbox"
              aria-label={`Select folder ${f.name}`}
              checked={checkedFolders.has(f.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => setCheckedFolders((s) => toggle(s, f.id))}
            />
            <button
              className={`chevron${kids.length ? '' : ' invisible'}`}
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((s) => toggle(s, f.id));
              }}
            >
              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            <FolderIcon size={20} strokeWidth={1.6} className="folder-icon" />
            <span className="tree-name">{f.name}</span>
            <span className="tree-count">{f.file_count > 0 ? f.file_count : ''}</span>
          </div>
          {isOpen && kids.length > 0 && (
            <div className="tree-children" style={{ marginLeft: 16 + depth * 20 }}>
              {renderTree(f.id, depth + 1)}
            </div>
          )}
        </div>
      );
    });

  // Location only matters when the list spans subfolders.
  const showLocation = docs.some((d) => d.folder_id !== selectedFolderId);
  const allDocsChecked = docs.length > 0 && docs.every((d) => checkedDocs.has(d.id));

  return (
    <div className="page">
      <header className="page-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          {breadcrumb.map((f, i) => (
            <span key={f.id}>
              {i > 0 && <span className="crumb-sep">›</span>}
              <button className="crumb" onClick={() => setSelectedFolderId(f.id)}>
                {f.name}
              </button>
            </span>
          ))}
        </nav>
      </header>

      {error && (
        <div className="banner error">
          <span>{error}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setError(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      <div className="docs-layout">
        <section className="tree-panel" aria-label="Folders">
          {renderTree(null, 0)}
        </section>

        <section
          className={`files-panel${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleUpload([...e.dataTransfer.files]);
          }}
        >
          <div className="toolbar">
            <div className="toolbar-left">
              <h2>{breadcrumb.at(-1)?.name ?? 'Documents'}</h2>
              <span className="muted">
                {docs.length} file{docs.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="toolbar-right">
              {busy && <span className="muted">{busy}</span>}
              {selectionCount > 0 && (
                <>
                  <span className="muted">
                    {[
                      checkedFolders.size && `${checkedFolders.size} folder${checkedFolders.size > 1 ? 's' : ''}`,
                      checkedDocs.size && `${checkedDocs.size} file${checkedDocs.size > 1 ? 's' : ''}`,
                    ]
                      .filter(Boolean)
                      .join(', ')}{' '}
                    selected
                  </span>
                  <button className="btn" onClick={handleBulkDownload} disabled={!!busy}>
                    <Download size={16} /> Download
                  </button>
                  <button className="btn danger" onClick={askBulkDelete} disabled={!!busy}>
                    <Trash2 size={16} /> Delete
                  </button>
                </>
              )}
              <button
                className="btn primary"
                onClick={() => fileInput.current?.click()}
                disabled={!!busy || selectedFolderId == null}
              >
                <Upload size={16} /> Upload
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  handleUpload([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          {selectedFolderId == null ? null : docs.length === 0 && !loadingDocs ? (
            <div className="empty" onClick={() => fileInput.current?.click()}>
              <Upload size={28} strokeWidth={1.5} />
              <p>Drop files here or click to upload</p>
              <p className="muted">Files go into “{breadcrumb.at(-1)?.name}”</p>
            </div>
          ) : (
            <div className="table-wrap">
            <table className="files-table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      className="checkbox"
                      aria-label="Select all files"
                      checked={allDocsChecked}
                      onChange={() => setCheckedDocs(allDocsChecked ? new Set() : new Set(docs.map((d) => d.id)))}
                    />
                  </th>
                  <th>Name</th>
                  {showLocation && <th>Location</th>}
                  <th className="num">Size</th>
                  <th>Uploaded</th>
                  <th className="col-actions" />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className={checkedDocs.has(d.id) ? 'checked' : ''}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        className="checkbox"
                        aria-label={`Select ${d.filename}`}
                        checked={checkedDocs.has(d.id)}
                        onChange={() => setCheckedDocs((s) => toggle(s, d.id))}
                      />
                    </td>
                    <td>
                      <span className="file-name">
                        <File size={16} strokeWidth={1.6} />
                        {d.filename}
                      </span>
                    </td>
                    {showLocation && <td className="muted">{folderPath(d.folder_id)}</td>}
                    <td className="num muted">{formatSize(d.size_bytes)}</td>
                    <td className="muted">{formatDate(d.uploaded_at)}</td>
                    <td className="col-actions">
                      <a className="icon-btn" href={downloadUrl(d.id)} download title="Download" aria-label={`Download ${d.filename}`}>
                        <Download size={16} />
                      </a>
                      <button
                        className="icon-btn danger"
                        title="Delete"
                        aria-label={`Delete ${d.filename}`}
                        onClick={() => setPendingDelete([d])}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {dragging && <div className="drop-overlay">Drop to upload to “{breadcrumb.at(-1)?.name}”</div>}
        </section>
      </div>

      {pendingDelete && (
        <div className="modal-backdrop" onClick={() => setPendingDelete(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>
              Delete {pendingDelete.length === 1 ? `“${pendingDelete[0].filename}”` : `${pendingDelete.length} files`}?
            </h3>
            <p className="muted">This permanently removes the file{pendingDelete.length > 1 ? 's' : ''}. It cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setPendingDelete(null)} autoFocus>
                Cancel
              </button>
              <button className="btn danger-solid" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
