import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadIfcScene, type IfcScene } from './loadIfc';
import type { IfcLoadStatus } from '../ltl/store';

function frameModel(camera: THREE.PerspectiveCamera, controls: OrbitControls, group: THREE.Group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.001) * 0.5;
  const fov = (camera.fov * Math.PI) / 180;
  const distance = (radius / Math.sin(fov / 2)) * 1.15;
  const direction = new THREE.Vector3(0.85, 0.55, 0.85).normalize();
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

export default function IfcViewer({
  data,
  status,
  error,
}: {
  data: Uint8Array | null;
  status: IfcLoadStatus;
  error: string | null;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    const host = mountRef.current;
    if (!host || !data) {
      setParsing(false);
      setParseError(null);
      return;
    }

    let disposed = false;
    let sceneHandle: IfcScene | null = null;
    setParsing(true);
    setParseError(null);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e8eef4');
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(0.6, 1.2, 0.4);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdbe7f5, 0.45);
    fill.position.set(-0.8, 0.4, -0.6);
    scene.add(fill);

    host.appendChild(renderer.domElement);

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    loadIfcScene(data)
      .then((loaded) => {
        if (disposed) {
          loaded.dispose();
          return;
        }
        sceneHandle = loaded;
        scene.add(loaded.group);
        frameModel(camera, controls, loaded.group);
        setParsing(false);
      })
      .catch((reason: unknown) => {
        if (disposed) return;
        setParsing(false);
        setParseError(reason instanceof Error ? reason.message : 'Could not read this IFC file.');
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      if (sceneHandle) scene.remove(sceneHandle.group);
      sceneHandle?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [data]);

  const message = error ?? parseError;
  const showLoading = status === 'loading' || parsing;
  const showEmpty = !data && status !== 'loading' && !message;

  return (
    <div className="ifc-stage" aria-label="IFC model viewer">
      <div className="ifc-canvas" ref={mountRef} />
      {showEmpty && <div className="ifc-empty">Import an IFC file to view the building.</div>}
      {showLoading && <div className="ifc-overlay">Reading IFC…</div>}
      {message && !showLoading && <div className="ifc-overlay ifc-error">{message}</div>}
    </div>
  );
}
