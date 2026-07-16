// Helix Noise — generated GLSL (GLSL ES 3.00 / WebGL2). Divergence-free velocity field.
// 6 modes. Defines vec3 helixNoise(vec3 p) / (vec3 p, float t) and vec3 helixNoiseCurl — same pair.
const int helixNoise_N = 6;
const vec3 helixNoise_K[6] = vec3[6](vec3(1.580370,-0.1791048,0.3004478),vec3(-0.7614249,-5.038512,3.036497),vec3(1.759676,0.1314162,-4.406996),vec3(0.3177672,1.748708,2.923335),vec3(-3.835616,-1.403684,-1.532601),vec3(-0.6561357,2.076942,-0.6733710));
const vec3 helixNoise_E1[6] = vec3[6](vec3(0.1126100,0.9936393,0.000000),vec3(0.9887732,-0.1494244,0.000000),vec3(-0.9287034,0.000000,-0.3708234),vec3(-0.9838877,0.1787876,0.000000),vec3(0.3436700,-0.9390905,0.000000),vec3(-0.9535485,-0.3012397,0.000000));
const vec3 helixNoise_E2[6] = vec3[6](vec3(-0.1844395,0.02090270,0.9826216),vec3(0.07649007,0.5061513,0.8590461),vec3(-0.01026559,0.9996167,0.02570951),vec3(-0.1527683,-0.8407006,0.5195040),vec3(-0.3299165,-0.1207364,0.9362574),vec3(-0.08897417,0.2816401,0.9553860));
const float helixNoise_S[6] = float[6](1.000000,-1.000000,-1.000000,-1.000000,1.000000,-1.000000);
const float helixNoise_A[6] = float[6](0.4627751,0.05792916,0.08273869,0.1397357,0.09471702,0.2675197);
const float helixNoise_PH[6] = float[6](-2.456775,20.16733,12.83511,-10.23302,18.59161,-2.671793);
const float helixNoise_OM[6] = float[6](-1.378571,3.276872,2.824585,-2.270502,2.669859,1.732215);
const float helixNoise_SCALE = 1.822267;
const float helixNoise_NU = 0.02000000;

vec3 helixNoise(vec3 p, float t) {
  vec3 u = vec3(0.0);
  for (int j = 0; j < helixNoise_N; j++) {
    float phi = dot(helixNoise_K[j], p) + helixNoise_PH[j] + helixNoise_OM[j] * t;
    u += (helixNoise_A[j] * exp(-helixNoise_NU * dot(helixNoise_K[j], helixNoise_K[j]) * t)) * (cos(phi) * helixNoise_E1[j] - helixNoise_S[j] * sin(phi) * helixNoise_E2[j]);
  }
  return u * helixNoise_SCALE;
}
vec3 helixNoise(vec3 p) { return helixNoise(p, 0.0); }

vec3 helixNoiseCurl(vec3 p, float t) {
  vec3 w = vec3(0.0);
  for (int j = 0; j < helixNoise_N; j++) {
    float phi = dot(helixNoise_K[j], p) + helixNoise_PH[j] + helixNoise_OM[j] * t;
    vec3 tv = (helixNoise_A[j] * exp(-helixNoise_NU * dot(helixNoise_K[j], helixNoise_K[j]) * t)) * (cos(phi) * helixNoise_E1[j] - helixNoise_S[j] * sin(phi) * helixNoise_E2[j]);
    w += helixNoise_S[j] * length(helixNoise_K[j]) * tv;
  }
  return w * helixNoise_SCALE;
}
vec3 helixNoiseCurl(vec3 p) { return helixNoiseCurl(p, 0.0); }