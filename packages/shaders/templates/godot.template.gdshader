// Helix Noise — generated Godot shader include (.gdshader). Divergence-free velocity field.
// 3 modes. Defines vec3 helixNoise(vec3 p, float t) / (vec3 p).
const int helixNoise_N = 3;
const vec3[3] helixNoise_K = {vec3(2.830494, -0.2958638, 1.920245), vec3(-3.087000, 3.786031, 0.3230390), vec3(-0.1629838, -0.9478326, -0.7840150)};
const vec3[3] helixNoise_E1 = {vec3(0.1039609, 0.9945814, 0.000000), vec3(-0.7750259, -0.6319295, 0.000000), vec3(0.9855359, -0.1694671, 0.000000)};
const vec3[3] helixNoise_E2 = {vec3(-0.5562924, 0.05814773, 0.8289497), vec3(0.04169732, -0.05113940, 0.9978207), vec3(-0.1070783, -0.6227140, 0.7750881)};
const float[3] helixNoise_S = {1.000000, 1.000000, 1.000000};
const float[3] helixNoise_A = {0.1389601, 0.07875809, 0.7080549};
const float[3] helixNoise_PH = {2.479466, 1.199294, -2.573703};
const float[3] helixNoise_OM = {-2.275774, -2.883215, -1.154708};
const float helixNoise_SCALE = 1.378888;

vec3 helixNoise(vec3 p, float t) {
  vec3 u = vec3(0.0);
  for (int j = 0; j < helixNoise_N; j++) {
    float phi = dot(helixNoise_K[j], p) + helixNoise_PH[j] + helixNoise_OM[j] * t;
    u += (helixNoise_A[j]) * (cos(phi) * helixNoise_E1[j] - helixNoise_S[j] * sin(phi) * helixNoise_E2[j]);
  }
  return u * helixNoise_SCALE;
}
vec3 helixNoise(vec3 p) { return helixNoise(p, 0.0); }

vec3 helixNoiseCurl(vec3 p, float t) {
  vec3 w = vec3(0.0);
  for (int j = 0; j < helixNoise_N; j++) {
    float phi = dot(helixNoise_K[j], p) + helixNoise_PH[j] + helixNoise_OM[j] * t;
    vec3 tv = (helixNoise_A[j]) * (cos(phi) * helixNoise_E1[j] - helixNoise_S[j] * sin(phi) * helixNoise_E2[j]);
    w += helixNoise_S[j] * length(helixNoise_K[j]) * tv;
  }
  return w * helixNoise_SCALE;
}
vec3 helixNoiseCurl(vec3 p) { return helixNoiseCurl(p, 0.0); }

vec3 helixNoisePot(vec3 p, float t) {
  vec3 A = vec3(0.0);
  for (int j = 0; j < helixNoise_N; j++) {
    float phi = dot(helixNoise_K[j], p) + helixNoise_PH[j] + helixNoise_OM[j] * t;
    vec3 tv = (helixNoise_A[j]) * (cos(phi) * helixNoise_E1[j] - helixNoise_S[j] * sin(phi) * helixNoise_E2[j]);
    A += (helixNoise_S[j] / length(helixNoise_K[j])) * tv;
  }
  return A * helixNoise_SCALE;
}
vec3 helixNoisePot(vec3 p) { return helixNoisePot(p, 0.0); }
