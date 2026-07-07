// A minimal, dependency-free column-major `mat4` kit — just enough for the built-in renderer and
// the orbit helper. Conventions match gl-matrix and three.js (column-major, right-handed,
// clip-space z ∈ [-1, 1]), so a matrix from here is interchangeable with one from either.

/** A 4×4 matrix in column-major order (16 floats), as WebGL's `uniformMatrix4fv` expects. */
export type Mat4 = Float32Array;

/** A 3-vector. */
export type Vec3 = readonly [number, number, number];

/** Right-handed perspective projection (clip z ∈ [-1, 1]). `fovY` is the vertical field of view in radians. */
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

/** Right-handed view matrix looking from `eye` toward `center` with the given `up`. */
export function lookAt(eye: Vec3, center: Vec3, up: Vec3 = [0, 1, 0]): Mat4 {
  let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
  let len = 1 / Math.hypot(z0, z1, z2);
  z0 *= len; z1 *= len; z2 *= len;

  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  len = Math.hypot(x0, x1, x2);
  if (len === 0) { x0 = 0; x1 = 0; x2 = 0; } else { len = 1 / len; x0 *= len; x1 *= len; x2 *= len; }

  let y0 = z1 * x2 - z2 * x1;
  let y1 = z2 * x0 - z0 * x2;
  let y2 = z0 * x1 - z1 * x0;
  len = Math.hypot(y0, y1, y2);
  if (len === 0) { y0 = 0; y1 = 0; y2 = 0; } else { len = 1 / len; y0 *= len; y1 *= len; y2 *= len; }

  const out = new Float32Array(16);
  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
  return out;
}

/** Matrix product `a · b` (column-major). For a view-projection, call `multiply(proj, view)`. */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[c * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[c * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[c * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

/** Options for {@link orbitViewProjection}. */
export interface OrbitOptions {
  /** Azimuth (radians) around the vertical axis. Default 0. */
  yaw?: number;
  /** Elevation (radians); clamp to roughly ±1.2 to avoid gimbal flip. Default 0. */
  pitch?: number;
  /** Camera distance from `center`. Required. */
  distance: number;
  /** Viewport aspect ratio (width / height). Required. */
  aspect: number;
  /** Vertical field of view (radians). Default ~0.69 (≈40°), framing a 2π box like `million.html`. */
  fovY?: number;
  /** Near plane. Default 0.05. */
  near?: number;
  /** Far plane. Default `max(100, distance × 8)`. */
  far?: number;
  /** Orbit target. Default the origin `[0, 0, 0]` — pair with the renderer's `center = box/2`. */
  center?: Vec3;
}

/**
 * A ready-made orbit view-projection: the camera sits at `distance` from `center`, rotated by
 * `yaw`/`pitch`, looking in. Feed the result straight to `renderer.draw(sim, { viewProjection })`.
 * (Bring your own matrix instead if you already have a camera — three.js, gl-matrix, etc.)
 */
export function orbitViewProjection(opts: OrbitOptions): Mat4 {
  const yaw = opts.yaw ?? 0;
  const pitch = opts.pitch ?? 0;
  const { distance, aspect } = opts;
  const fovY = opts.fovY ?? 0.69;
  const near = opts.near ?? 0.05;
  const far = opts.far ?? Math.max(100, distance * 8);
  const center = opts.center ?? [0, 0, 0];

  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const eye: Vec3 = [
    center[0] + distance * cp * sy,
    center[1] + distance * sp,
    center[2] + distance * cp * cy,
  ];
  return multiply(perspective(fovY, aspect, near, far), lookAt(eye, center, [0, 1, 0]));
}
