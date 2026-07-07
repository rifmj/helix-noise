import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  HelixParticles,
  helixFlowMaterial,
  useHelixField,
  presets,
  type ColorBy,
  type ParticleMode,
} from "helix-noise-r3f";

type Demo = "gpu" | "cpu" | "material";
const TAU = Math.PI * 2;

/** Layer-2 demo: a static point cloud coloured on the GPU by helixFlowMaterial, uTime animated. */
function HelixFlowPoints() {
  const field = useHelixField({ ...presets.kelp, seed: 7 });
  const geometry = useMemo(() => {
    const n = 60000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * TAU - Math.PI;
      pos[i * 3 + 1] = Math.random() * TAU - Math.PI;
      pos[i * 3 + 2] = Math.random() * TAU - Math.PI;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  const material = useMemo(() => helixFlowMaterial(field, { size: 0.06 }), [field]);
  const matRef = useRef(material);
  matRef.current = material;
  useFrame((s) => {
    matRef.current.uniforms.uTime.value = s.clock.elapsedTime;
  });
  return <points geometry={geometry} material={material} />;
}

// A sphere obstacle in sampling space (domain [0, τ]³), with an analytic gradient so the
// bounded field is exact and cheap.
const C: [number, number, number] = [Math.PI, Math.PI, Math.PI];
const R = 1.2;
const sphereSdf = (x: number, y: number, z: number) =>
  Math.hypot(x - C[0], y - C[1], z - C[2]) - R;
// The same sphere as a GLSL SDF, enabling the GPU-native boundary.
const sphereGlsl = `float helixSdf(vec3 p){ return length(p - vec3(${C[0]}, ${C[1]}, ${C[2]})) - ${R}; }`;

function Scene({ demo, count, colorBy, obstacle }: { demo: Demo; count: number; colorBy: ColorBy; obstacle: boolean }) {
  return (
    <Canvas camera={{ position: [0, 0, 9], fov: 50 }} gl={{ antialias: true }}>
      <color attach="background" args={["#070a0e"]} />
      {demo === "material" ? (
        <HelixFlowPoints />
      ) : (
        <HelixParticles
          {...presets.nebula}
          seed={7}
          count={obstacle ? 60000 : count}
          mode={demo as ParticleMode}
          speed={0.6}
          colorBy={colorBy}
          obstacle={obstacle ? sphereSdf : undefined}
          obstacleGlsl={obstacle ? sphereGlsl : undefined}
          boundaryThickness={1.2}
        />
      )}
    </Canvas>
  );
}

function App() {
  const [demo, setDemo] = useState<Demo>("gpu");
  const [count, setCount] = useState(120000);
  const [colorBy, setColorBy] = useState<ColorBy>("helicity");
  const [obstacle, setObstacle] = useState(false);
  const next: Record<Demo, Demo> = { gpu: "cpu", cpu: "material", material: "gpu" };
  return (
    <>
      <div style={{ position: "fixed", top: 10, left: 12, zIndex: 10, font: "12px ui-monospace, monospace", color: "#8a97a2" }}>
        <div>
          demo: <b style={{ color: "#2fd6bf" }}>{demo}</b>
          {demo !== "material" && <> · particles: <b style={{ color: "#2fd6bf" }}>{(obstacle ? 60000 : count).toLocaleString()}</b> · color: <b style={{ color: "#2fd6bf" }}>{String(colorBy)}</b> · obstacle: <b style={{ color: "#2fd6bf" }}>{obstacle ? "sphere" : "off"}</b></>}
        </div>
        <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
          <button onClick={() => setDemo(next[demo])}>next demo</button>
          <button onClick={() => setCount(count === 120000 ? 16000 : 120000)}>toggle count</button>
          <button onClick={() => setColorBy(colorBy === "helicity" ? "speed" : colorBy === "speed" ? 0x66ccff : "helicity")}>cycle color</button>
          <button onClick={() => setObstacle((o) => !o)}>toggle obstacle</button>
        </div>
      </div>
      <Scene demo={demo} count={count} colorBy={colorBy} obstacle={obstacle} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
