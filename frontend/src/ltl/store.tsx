import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ELEMENT_TYPES, MATERIALS, uid, type ElementType, type Material } from './data';

export interface ModelSource {
  kind: 'ifc' | 'revit';
  label: string;
}

interface LtlState {
  projectName: string;
  setProjectName: (name: string) => void;
  model: ModelSource | null;
  setModel: (m: ModelSource | null) => void;
  gravityStep: number;
  setGravityStep: (n: number) => void;
  materials: Material[];
  addMaterial: (m: Omit<Material, 'id'>) => Material;
  updateMaterial: (id: string, patch: Partial<Material>) => void;
  removeMaterial: (id: string) => void;
  types: ElementType[];
  updateType: (id: string, patch: Partial<ElementType>) => void;
  copyLayers: (fromId: string, toId: string) => void;
  /** Merge two assemblies; the non-governing one becomes a sub-assembly of the governing one. */
  mergeTypes: (aId: string, bId: string, governingId: string) => void;
  unmerge: (id: string) => void;
}

const Ctx = createContext<LtlState | null>(null);

// Wireframe store: in-memory only, resets on page reload.
export function LtlProvider({ children }: { children: ReactNode }) {
  const [projectName, setProjectName] = useState('Riverside Office Building');
  const [model, setModel] = useState<ModelSource | null>(null);
  const [gravityStep, setGravityStep] = useState(0);
  const [materials, setMaterials] = useState<Material[]>(MATERIALS);
  const [types, setTypes] = useState<ElementType[]>(ELEMENT_TYPES);

  const addMaterial = useCallback((m: Omit<Material, 'id'>) => {
    const created = { ...m, id: uid('m'), custom: true };
    setMaterials((list) => [...list, created]);
    return created;
  }, []);

  const updateMaterial = useCallback((id: string, patch: Partial<Material>) => {
    setMaterials((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const removeMaterial = useCallback((id: string) => {
    setMaterials((list) => list.filter((m) => m.id !== id));
  }, []);

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
      projectName, setProjectName, model, setModel, gravityStep, setGravityStep,
      materials, addMaterial, updateMaterial, removeMaterial,
      types, updateType, copyLayers, mergeTypes, unmerge,
    }),
    [projectName, model, gravityStep, materials, addMaterial, updateMaterial, removeMaterial, types, updateType, copyLayers, mergeTypes, unmerge],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLtl(): LtlState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLtl must be used inside LtlProvider');
  return ctx;
}
