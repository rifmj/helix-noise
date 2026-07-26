/**
 * The gradient diagnostics, as free functions of a velocity gradient.
 *
 * Every field in this library — the mode sum, the atom field, the closed-form primitives, the time
 * warps, a boundary-constrained field — answers `sampleGrad`, and from that one 9-float answer the
 * three standard vortex readings follow identically. Keeping them here rather than on one class is
 * what lets `qCriterion` mean the same thing on a tornado as on a noise field.
 *
 * Gradients are row-major `g[3m + n] = ∂u_n/∂x_m`.
 */

/**
 * Middle eigenvalue of a symmetric 3×3 matrix (row-major), by the closed-form trigonometric
 * solution of its characteristic cubic — no iteration, no allocation.
 * @internal
 */
export function eigMid3(m: ArrayLike<number>): number {
  const p1 = m[1] * m[1] + m[2] * m[2] + m[5] * m[5];
  const q = (m[0] + m[4] + m[8]) / 3;
  if (p1 <= 1e-300) { // already diagonal
    const d = [m[0], m[4], m[8]].sort((a, b) => a - b);
    return d[1];
  }
  const d0 = m[0] - q, d4 = m[4] - q, d8 = m[8] - q;
  const p2 = d0 * d0 + d4 * d4 + d8 * d8 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  // det((M − qI)/p) / 2, clamped: rounding can push it a hair outside [−1, 1].
  const b = [d0 / p, m[1] / p, m[2] / p, m[1] / p, d4 / p, m[5] / p, m[2] / p, m[5] / p, d8 / p];
  const det =
    b[0] * (b[4] * b[8] - b[5] * b[7]) -
    b[1] * (b[3] * b[8] - b[5] * b[6]) +
    b[2] * (b[3] * b[7] - b[4] * b[6]);
  const r = Math.min(1, Math.max(-1, det / 2));
  const phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi);                     // largest
  const e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3); // smallest
  return 3 * q - e1 - e3;                                   // trace − largest − smallest
}

/** `Q = ½(|Ω|² − |S|²) = −½ tr(G²)` for divergence-free flow. @internal */
export function qFromGrad(g: ArrayLike<number>): number {
  let tr2 = 0;
  for (let m = 0; m < 3; m++) for (let n = 0; n < 3; n++) tr2 += g[3 * m + n] * g[3 * n + m];
  return -0.5 * tr2;
}

/** Middle eigenvalue of `S² + Ω²`. @internal */
export function lambda2FromGrad(g: ArrayLike<number>): number {
  const s: number[] = [], o: number[] = [];
  for (let m = 0; m < 3; m++) for (let n = 0; n < 3; n++) {
    s[3 * m + n] = 0.5 * (g[3 * m + n] + g[3 * n + m]);
    o[3 * m + n] = 0.5 * (g[3 * m + n] - g[3 * n + m]);
  }
  const M: number[] = [];
  for (let m = 0; m < 3; m++) for (let n = 0; n < 3; n++) {
    let v = 0;
    for (let k = 0; k < 3; k++) v += s[3 * m + k] * s[3 * k + n] + o[3 * m + k] * o[3 * k + n];
    M[3 * m + n] = v;
  }
  return eigMid3(M);
}

/** `ξ̂·S·ξ̂` — the strain along the vorticity direction. Zero where there is no vorticity. @internal */
export function stretchFromGrad(g: ArrayLike<number>, wx: number, wy: number, wz: number): number {
  const wm = Math.hypot(wx, wy, wz);
  if (wm < 1e-300) return 0;
  const e = [wx / wm, wy / wm, wz / wm];
  let v = 0;
  for (let m = 0; m < 3; m++) for (let n = 0; n < 3; n++) {
    v += e[m] * 0.5 * (g[3 * m + n] + g[3 * n + m]) * e[n];
  }
  return v;
}

/**
 * Central-difference velocity gradient — the fallback for fields with no closed form (today only
 * a boundary-constrained field, whose SDF is user-supplied and generally has no analytic
 * derivative). Kept here so the one approximate path in the library is written once and named.
 * @internal
 */
export function fdGrad<T extends { length: number; [i: number]: number }>(
  vel: (x: number, y: number, z: number, out: number[]) => void,
  x: number, y: number, z: number, out9: T, h: number
): T {
  const a: number[] = [0, 0, 0], b: number[] = [0, 0, 0];
  for (let m = 0; m < 3; m++) {
    const p: [number, number, number] = [x, y, z], q: [number, number, number] = [x, y, z];
    p[m] += h; q[m] -= h;
    vel(p[0], p[1], p[2], a); vel(q[0], q[1], q[2], b);
    for (let n = 0; n < 3; n++) out9[3 * m + n] = (a[n] - b[n]) / (2 * h);
  }
  return out9;
}

/**
 * Assemble a Cartesian velocity gradient from the cylindrical partials of an **axisymmetric**
 * field — the shared core behind rings, the `(ψ, Γ)` chassis and the strained column.
 *
 * With `∂_φ = 0` the gradient in the local orthonormal frame `(ê_ρ, ê_φ, ê_z)` is
 *
 * ```
 * L = [ ∂_r u^r   ∂_r u^θ   ∂_r u^z ]
 *     [ −u^θ/r    u^r/r     0       ]      ← the frame's own rotation, not a derivative of anything
 *     [ ∂_z u^r   ∂_z u^θ   ∂_z u^z ]
 * ```
 *
 * The middle row is where an axisymmetric gradient is usually got wrong: nothing varies with `φ`,
 * yet the `φ`-derivative is non-zero because the basis vectors themselves turn. It is also what
 * makes `∇·u = ∂_r u^r + u^r/r + ∂_z u^z` come out right.
 *
 * `e` holds the frame as rows `[ê_ρ, ê_φ, ê_z]`; the world gradient is `Eᵀ L E`.
 * @internal
 */
export function axisymGrad<T extends { length: number; [i: number]: number }>(
  ur: number, ut: number, r: number,
  dur_dr: number, dut_dr: number, duz_dr: number,
  dur_dz: number, dut_dz: number, duz_dz: number,
  e: ArrayLike<number>, out9: T
): T {
  // Near the axis u^r and u^θ both vanish linearly, so the ratios tend to the radial derivatives.
  const inv = r > 1e-9 ? 1 / r : 0;
  const L = [
    dur_dr, dut_dr, duz_dr,
    r > 1e-9 ? -ut * inv : -dut_dr, r > 1e-9 ? ur * inv : dur_dr, 0,
    dur_dz, dut_dz, duz_dz,
  ];
  for (let m = 0; m < 3; m++) {
    for (let n = 0; n < 3; n++) {
      let v = 0;
      for (let a = 0; a < 3; a++) {
        const eam = e[3 * a + m];
        if (eam === 0) continue;
        for (let b = 0; b < 3; b++) v += eam * L[3 * a + b] * e[3 * b + n];
      }
      out9[3 * m + n] = v;
    }
  }
  return out9;
}
