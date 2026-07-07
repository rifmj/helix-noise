import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Field, FlowField, HelixNoiseOptions, Sdf } from "helix-noise";
import { useHelixField } from "./useHelixField";
import { GpuParticleSim } from "./gpu";

export type ColorBy = "helicity" | "speed" | THREE.ColorRepresentation;
export type ParticleMode = "cpu" | "gpu" | "auto";

/** The subset of a field the CPU engine samples — satisfied by both `Field` and `BoundedField`. */
type SamplerField = Pick<FlowField, "sample" | "helicityDensity" | "sampleUW">;

export interface HelixParticlesProps extends HelixNoiseOptions {
  /** Use a prebuilt field instead of constructing one from the option props. */
  field?: Field;
  /** Particle count. Default 16000. */
  count?: number;
  /** Sampling-domain extents [x, y, z]; particles wrap within this box. Default [τ, τ, τ]. */
  bounds?: [number, number, number];
  /** Advection speed multiplier (world units per unit velocity per second). Default 1. */
  speed?: number;
  /** Point size in world units. Default 0.045. */
  pointSize?: number;
  /**
   * Colouring: `"helicity"` (teal/amber by sign of u·ω, default), `"speed"` (by |u|), or a
   * fixed colour.
   */
  colorBy?: ColorBy;
  /** Render engine. `"auto"` (default) picks GPU for large counts when supported, else CPU. */
  mode?: ParticleMode;
  /** Particle lifetime range in seconds [min, max]; respawned when it expires. Default [1, 3]. */
  lifespan?: [number, number];
  /**
   * Constrain the flow with an obstacle: a signed-distance function (> 0 outside, < 0 inside).
   * The field slides along the wall (free-slip) and stays exactly divergence-free. Forces the
   * **CPU** engine — the GPU path has no boundary support yet, so setting this with `mode="gpu"`
   * falls back to CPU with a one-time notice.
   */
  obstacle?: Sdf;
  /** Width of the obstacle's influence band (see `withBoundary`). Default 1. */
  boundaryThickness?: number;
  /** Called once with the resolved field (imperative escape hatch). */
  onField?: (field: Field) => void;
}

const TAU = Math.PI * 2;
const TEAL = new THREE.Color(0x2fd6bf);
const AMBER = new THREE.Color(0xf4a13c);

/** Does this GL context support the float render targets the GPU compute path needs? */
function supportsGpuPath(gl: THREE.WebGLRenderer): boolean {
  const ctx = gl.getContext();
  const isWebGL2 =
    typeof WebGL2RenderingContext !== "undefined" && ctx instanceof WebGL2RenderingContext;
  return isWebGL2 && !!gl.extensions.get("EXT_color_buffer_float");
}

let gpuFallbackNotified = false;

/**
 * A declarative cloud of particles advected by a divergence-free Helix Noise field.
 *
 * ```tsx
 * <Canvas>
 *   <HelixParticles count={40000} helicity={0.8} coherence={0.5} colorBy="helicity" />
 * </Canvas>
 * ```
 *
 * The field comes from the `field` prop or is built from the `HelixNoiseOptions` props via
 * {@link useHelixField}. `mode` selects the engine: the CPU path (`field.sampleUW`) runs
 * everywhere; the GPU path advects on-device via the injected `field.glsl()`. `"auto"`
 * (default) uses GPU for large counts when float render targets are available, else CPU —
 * and the fallback is logged once, never silent.
 */
export function HelixParticles(props: HelixParticlesProps): JSX.Element {
  const {
    field: fieldProp,
    count = 16000,
    bounds = [TAU, TAU, TAU],
    speed = 1,
    pointSize = 0.045,
    colorBy = "helicity",
    mode = "auto",
    lifespan = [1, 3],
    obstacle,
    boundaryThickness = 1,
    onField,
    ...fieldOptions
  } = props;

  const builtField = useHelixField(fieldProp ? undefined : fieldOptions);
  const field = fieldProp ?? builtField;

  // Effective sampler for the CPU engine: the raw field, or one constrained by the obstacle.
  const cpuField = useMemo<SamplerField>(
    () => (obstacle ? field.withBoundary(obstacle, { thickness: boundaryThickness }) : field),
    [field, obstacle, boundaryThickness],
  );

  const gl = useThree((s) => s.gl);

  // Fire onField once per resolved field, regardless of callback identity churn (so an inline
  // arrow does not re-invoke it every render).
  const onFieldRef = useRef(onField);
  onFieldRef.current = onField;
  useEffect(() => {
    onFieldRef.current?.(field);
  }, [field]);

  // Resolve the engine. The GPU path needs WebGL2 float render targets and has no obstacle
  // support; when either blocks it (or GPU init later throws) we fall back to CPU with a
  // one-time notice — never silently.
  const wantGpu = !obstacle && (mode === "gpu" || (mode === "auto" && count > 50000));
  const gpuCapable = wantGpu && supportsGpuPath(gl);
  const [gpuFailed, setGpuFailed] = useState(false);
  const useGpu = gpuCapable && !gpuFailed;

  useEffect(() => {
    if (gpuFallbackNotified) return;
    if (obstacle && mode === "gpu") {
      gpuFallbackNotified = true;
      // eslint-disable-next-line no-console
      console.info("[helix-noise-r3f] obstacle has no GPU path yet; rendering on the CPU.");
    } else if (wantGpu && !gpuCapable) {
      gpuFallbackNotified = true;
      // eslint-disable-next-line no-console
      console.info(
        `[helix-noise-r3f] GPU path requested but WebGL2 float render targets are unavailable; ` +
          `rendering ${count} particles on the CPU.`,
      );
    }
  }, [wantGpu, gpuCapable, count, obstacle, mode]);

  const shared = { count, bounds, speed, pointSize, colorBy, lifespan };
  return useGpu ? (
    <GpuParticles field={field} {...shared} onFailure={() => setGpuFailed(true)} />
  ) : (
    <CpuParticles field={cpuField} {...shared} />
  );
}

interface SharedProps {
  count: number;
  bounds: [number, number, number];
  speed: number;
  pointSize: number;
  colorBy: ColorBy;
  lifespan: [number, number];
}
type CpuProps = SharedProps & { field: SamplerField };
type GpuProps = SharedProps & { field: Field; onFailure: () => void };

/** The GPU engine: advect on-device via the injected `field.glsl()` (see {@link GpuParticleSim}). */
function GpuParticles({
  field,
  count,
  bounds,
  speed,
  pointSize,
  colorBy,
  lifespan,
  onFailure,
}: GpuProps): JSX.Element | null {
  const gl = useThree((s) => s.gl);
  const optsKey = `${count}|${bounds.join(",")}|${speed}|${pointSize}|${String(colorBy)}|${lifespan.join(",")}`;

  const sim = useMemo(() => {
    try {
      return new GpuParticleSim(gl, field, { count, bounds, speed, pointSize, colorBy, lifespan });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[helix-noise-r3f] GPU init failed; falling back to CPU.", e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, field, optsKey]);

  useEffect(() => {
    if (!sim) onFailure();
    return () => sim?.dispose();
  }, [sim, onFailure]);

  useFrame((state, delta) => {
    sim?.step(Math.min(delta, 0.05), state.clock.elapsedTime);
  });

  return sim ? <primitive object={sim.points} /> : null;
}

/** The CPU engine: advect each particle with `field.sampleUW`, colour it, respawn on death. */
function CpuParticles({
  field,
  count,
  bounds,
  speed,
  pointSize,
  colorBy,
  lifespan,
}: CpuProps): JSX.Element {
  const [bx, by, bz] = bounds;
  const [lmin, lmax] = lifespan;

  // Persistent per-particle state, reallocated when count changes.
  const state = useMemo(() => {
    const pos = new Float32Array(count * 3); // world position, centred on origin
    const col = new Float32Array(count * 3);
    const dom = new Float32Array(count * 3); // sampling position in [0, b)
    const life = new Float32Array(count);
    const fixed =
      colorBy === "helicity" || colorBy === "speed"
        ? null
        : new THREE.Color(colorBy as THREE.ColorRepresentation);
    const out6 = [0, 0, 0, 0, 0, 0];

    const spawn = (i: number, fresh: boolean) => {
      const x = Math.random() * bx;
      const y = Math.random() * by;
      const z = Math.random() * bz;
      dom[i * 3] = x;
      dom[i * 3 + 1] = y;
      dom[i * 3 + 2] = z;
      pos[i * 3] = x - bx / 2;
      pos[i * 3 + 1] = y - by / 2;
      pos[i * 3 + 2] = z - bz / 2;
      let c: THREE.Color;
      if (fixed) c = fixed;
      else if (colorBy === "speed") {
        const s = Math.hypot(...(field.sample(x, y, z) as [number, number, number]));
        c = TEAL.clone().lerp(AMBER, Math.min(1, s / 2));
      } else {
        c = field.helicityDensity(x, y, z) >= 0 ? TEAL : AMBER;
      }
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      life[i] = (fresh ? Math.random() : 1) * (lmin + Math.random() * (lmax - lmin));
    };

    for (let i = 0; i < count; i++) spawn(i, true);
    return { pos, col, dom, life, out6, spawn };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, count, bx, by, bz, colorBy, lmin, lmax]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(state.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(state.col, 3));
    return g;
  }, [state]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
  const time = useRef(0);

  useFrame((_s, delta) => {
    const dt = Math.min(delta, 0.05); // clamp to survive tab-switch spikes
    time.current += dt;
    const { pos, dom, life, out6, spawn } = state;
    const step = speed * dt;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      if ((life[i] -= dt) <= 0) {
        spawn(i, false);
        continue;
      }
      const x = dom[i3];
      const y = dom[i3 + 1];
      const z = dom[i3 + 2];
      field.sampleUW(x, y, z, out6, time.current);
      const nx = ((x + out6[0] * step) % bx + bx) % bx;
      const ny = ((y + out6[1] * step) % by + by) % by;
      const nz = ((z + out6[2] * step) % bz + bz) % bz;
      dom[i3] = nx;
      dom[i3 + 1] = ny;
      dom[i3 + 2] = nz;
      pos[i3] = nx - bx / 2;
      pos[i3 + 1] = ny - by / 2;
      pos[i3 + 2] = nz - bz / 2;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  });

  return (
    <points geometry={geometry}>
      <pointsMaterial
        size={pointSize}
        vertexColors
        transparent
        opacity={0.85}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
