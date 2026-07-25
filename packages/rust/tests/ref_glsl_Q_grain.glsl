// Helix Noise — generated GLSL (GLSL ES 3.00 / WebGL2). Divergence-free velocity field.
// 6 modes. Defines vec3 helixNoise(vec3 p) / (vec3 p, float t) and vec3 helixNoiseCurl — same pair.
const int helixNoise_N = 6;
const vec3 helixNoise_K[6] = vec3[6](vec3(1.168135,-0.1003608,0.4207202),vec3(-0.5934639,-2.424553,1.631619),vec3(1.357163,-0.08543942,-2.308726),vec3(-0.2284585,3.232165,4.630186),vec3(-4.089085,-1.812252,-2.286067),vec3(-1.039017,3.736562,-1.695880));
const vec3 helixNoise_E1[6] = vec3[6](vec3(-0.01579288,0.7840505,0.2308806),vec3(0.3832551,-0.2114714,-0.1748420),vec3(0.3987290,-0.3239724,0.2463785),vec3(0.4816737,0.3484149,-0.2194495),vec3(0.3011706,-0.09302318,-0.4649604),vec3(-0.08588073,0.3911860,0.9145239));
const vec3 helixNoise_E2[6] = vec3[6](vec3(-0.03531291,0.7116101,0.2677979),vec3(-0.1729045,0.7020732,0.9803765),vec3(-0.1540177,0.8610561,-0.1224032),vec3(-0.2987741,-0.08381790,0.04376839),vec3(-0.05302768,-0.1035790,0.1769615),vec3(-0.2118680,0.1175174,0.3887336));
const float helixNoise_S[6] = float[6](1.000000,1.000000,1.000000,1.000000,1.000000,1.000000);
const float helixNoise_A[6] = float[6](0.7036755,0.1740875,0.2065995,0.06259751,0.07558799,0.09939828);
const float helixNoise_PH[6] = float[6](-3.139819,17.76098,3.923279,-16.70404,19.90585,-2.453150);
const float helixNoise_OM[6] = float[6](-1.157697,2.071795,1.929136,3.172741,2.932995,2.616729);
const float helixNoise_SCALE = 1.681047;

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
    vec3 tv2 = (helixNoise_A[j]) * (-sin(phi) * helixNoise_E1[j] - cos(phi) * helixNoise_E2[j]);
    w += cross(helixNoise_K[j], tv2);
  }
  return w * helixNoise_SCALE;
}
vec3 helixNoiseCurl(vec3 p) { return helixNoiseCurl(p, 0.0); }

vec3 helixNoisePot(vec3 p, float t) {
  vec3 A = vec3(0.0);
  for (int j = 0; j < helixNoise_N; j++) {
    float phi = dot(helixNoise_K[j], p) + helixNoise_PH[j] + helixNoise_OM[j] * t;
    vec3 tv2 = (helixNoise_A[j]) * (-sin(phi) * helixNoise_E1[j] - cos(phi) * helixNoise_E2[j]);
    A += cross(helixNoise_K[j], tv2) / dot(helixNoise_K[j], helixNoise_K[j]);
  }
  return A * helixNoise_SCALE;
}
vec3 helixNoisePot(vec3 p) { return helixNoisePot(p, 0.0); }