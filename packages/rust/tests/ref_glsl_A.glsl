// Helix Noise — generated GLSL (GLSL ES 3.00 / WebGL2). Divergence-free velocity field.
// 8 modes. Defines vec3 helixNoise(vec3 p) / (vec3 p, float t) and vec3 helixNoiseCurl — same pair.
const int helixNoise_N = 8;
const vec3 helixNoise_K[8] = vec3[8](vec3(3.081207,-0.2202505,4.128822),vec3(-1.736839,2.672619,2.877001),vec3(0.01722836,-2.787873,1.237954),vec3(2.810394,2.729796,0.01351310),vec3(-6.043975,-0.2150068,0.09973524),vec3(0.7045848,-0.6704708,-0.4927454),vec3(-0.3503793,1.445698,-1.201913),vec3(-0.9854672,-1.032400,-2.004741));
const vec3 helixNoise_E1[8] = vec3[8](vec3(0.07129995,0.9974549,0.000000),vec3(-0.8384958,-0.5449081,0.000000),vec3(0.9999809,0.006179634,0.000000),vec3(-0.6967461,0.7173179,0.000000),vec3(0.03555125,-0.9993679,0.000000),vec3(0.6893519,0.7244266,0.000000),vec3(-0.9718644,-0.2355410,0.000000),vec3(0.7233576,-0.6904736,0.000000));
const vec3 helixNoise_E2[8] = vec3[8](vec3(-0.7986641,0.05709001,0.5990629),vec3(0.3651088,-0.5618236,0.7423272),vec3(-0.002507885,0.4058230,0.9139483),vec3(-0.002474050,-0.002403098,0.9999941),vec3(0.01647850,0.0005862019,0.9998640),vec3(0.3273922,-0.3115408,0.8920520),vec3(-0.1480312,0.6107907,0.7778313),vec3(-0.5624877,-0.5892764,0.5799664));
const float helixNoise_S[8] = float[8](1.000000,-1.000000,1.000000,1.000000,1.000000,1.000000,1.000000,-1.000000);
const float helixNoise_A[8] = float[8](0.07248224,0.09715265,0.1678899,0.1124882,0.05615002,0.8708072,0.3543738,0.2367295);
const float helixNoise_PH[8] = float[8](-20.81011,-11.90082,14.08740,-6.408340,26.08275,5.168880,7.001743,15.98412);
const float helixNoise_OM[8] = float[8](-2.984719,2.641763,-2.103325,2.485262,3.319741,1.059333,1.540722,-1.822755);
const float helixNoise_SCALE = 1.005206;

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