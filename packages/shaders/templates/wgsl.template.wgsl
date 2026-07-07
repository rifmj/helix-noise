// Helix Noise — generated WGSL (WebGPU). Divergence-free velocity field.
// 3 modes. Defines fn helixNoise(p, t) / helixNoise0(p).
const helixNoise_N: i32 = 3;
const helixNoise_K = array<vec3f, 3>(vec3f(2.830494, -0.2958638, 1.920245), vec3f(-3.087000, 3.786031, 0.3230390), vec3f(-0.1629838, -0.9478326, -0.7840150));
const helixNoise_E1 = array<vec3f, 3>(vec3f(0.1039609, 0.9945814, 0.000000), vec3f(-0.7750259, -0.6319295, 0.000000), vec3f(0.9855359, -0.1694671, 0.000000));
const helixNoise_E2 = array<vec3f, 3>(vec3f(-0.5562924, 0.05814773, 0.8289497), vec3f(0.04169732, -0.05113940, 0.9978207), vec3f(-0.1070783, -0.6227140, 0.7750881));
const helixNoise_S = array<f32, 3>(1.000000, 1.000000, 1.000000);
const helixNoise_A = array<f32, 3>(0.1389601, 0.07875809, 0.7080549);
const helixNoise_PH = array<f32, 3>(2.479466, 1.199294, -2.573703);
const helixNoise_OM = array<f32, 3>(-2.275774, -2.883215, -1.154708);
const helixNoise_SCALE: f32 = 1.378888;

fn helixNoise(p: vec3f, t: f32) -> vec3f {
  var u = vec3f(0.0);
  for (var j: i32 = 0; j < helixNoise_N; j = j + 1) {
    let phi = dot(helixNoise_K[j], p) + helixNoise_PH[j] + helixNoise_OM[j] * t;
    u = u + (helixNoise_A[j]) * (cos(phi) * helixNoise_E1[j] - helixNoise_S[j] * sin(phi) * helixNoise_E2[j]);
  }
  return u * helixNoise_SCALE;
}
fn helixNoise0(p: vec3f) -> vec3f { return helixNoise(p, 0.0); }

fn helixNoiseCurl(p: vec3f, t: f32) -> vec3f {
  var w = vec3f(0.0);
  for (var j: i32 = 0; j < helixNoise_N; j = j + 1) {
    let phi = dot(helixNoise_K[j], p) + helixNoise_PH[j] + helixNoise_OM[j] * t;
    let tv = (helixNoise_A[j]) * (cos(phi) * helixNoise_E1[j] - helixNoise_S[j] * sin(phi) * helixNoise_E2[j]);
    w = w + helixNoise_S[j] * length(helixNoise_K[j]) * tv;
  }
  return w * helixNoise_SCALE;
}
fn helixNoiseCurl0(p: vec3f) -> vec3f { return helixNoiseCurl(p, 0.0); }

fn helixNoisePot(p: vec3f, t: f32) -> vec3f {
  var a = vec3f(0.0);
  for (var j: i32 = 0; j < helixNoise_N; j = j + 1) {
    let phi = dot(helixNoise_K[j], p) + helixNoise_PH[j] + helixNoise_OM[j] * t;
    let tv = (helixNoise_A[j]) * (cos(phi) * helixNoise_E1[j] - helixNoise_S[j] * sin(phi) * helixNoise_E2[j]);
    a = a + (helixNoise_S[j] / length(helixNoise_K[j])) * tv;
  }
  return a * helixNoise_SCALE;
}
fn helixNoisePot0(p: vec3f) -> vec3f { return helixNoisePot(p, 0.0); }
