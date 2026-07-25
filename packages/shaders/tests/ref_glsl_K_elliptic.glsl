// Helix Noise — generated GLSL (GLSL ES 3.00 / WebGL2). Divergence-free velocity field.
// 6 modes. Defines vec3 helixNoise(vec3 p) / (vec3 p, float t) and vec3 helixNoiseCurl — same pair.
const int helixNoise_N = 6;
const vec3 helixNoise_K[6] = vec3[6](vec3(2.979655,-0.9795064,0.03151952),vec3(-0.4779668,-2.748077,-4.836309),vec3(0.7579669,1.370835,0.1378715),vec3(-0.1589679,-1.612474,0.9507703),vec3(-3.004055,1.787340,-1.638205),vec3(-1.885857,1.742194,4.572138));
const vec3 helixNoise_E1[6] = vec3[6](vec3(0.3122905,0.9499866,0.000000),vec3(0.9852093,-0.1713552,0.000000),vec3(-0.8751333,0.4838819,0.000000),vec3(0.9951755,-0.09811067,0.000000),vec3(-0.5113175,-0.8593919,0.000000),vec3(-0.6785751,-0.7345311,0.000000));
const vec3 helixNoise_E2[6] = vec3[6](vec3(-0.009546116,0.003138109,0.9999495),vec3(-0.1484366,-0.8534386,0.4996089),vec3(-0.04242552,-0.07672944,0.9961489),vec3(0.04965318,0.5036520,0.8624786),vec3(-0.3646932,0.2169837,0.9054926),vec3(0.6404623,-0.5916724,0.4896241));
const float helixNoise_S[6] = float[6](0.5000000,0.5000000,0.5000000,0.5000000,0.5000000,-0.5000000);
const float helixNoise_A[6] = float[6](0.1605637,0.06382746,0.4846870,0.3646266,0.1151832,0.07056390);
const float helixNoise_PH[6] = float[6](-6.916823,26.76525,-6.132289,11.85034,18.79286,-6.417957);
const float helixNoise_OM[6] = float[6](1.863168,-3.263546,-0.6015352,0.8275399,-1.908750,2.704599);
const float helixNoise_SCALE = 1.972008;

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
    vec3 tw = (helixNoise_A[j]) * (helixNoise_S[j] * cos(phi) * helixNoise_E1[j] - sin(phi) * helixNoise_E2[j]);
    w += length(helixNoise_K[j]) * tw;
  }
  return w * helixNoise_SCALE;
}
vec3 helixNoiseCurl(vec3 p) { return helixNoiseCurl(p, 0.0); }

vec3 helixNoisePot(vec3 p, float t) {
  vec3 A = vec3(0.0);
  for (int j = 0; j < helixNoise_N; j++) {
    float phi = dot(helixNoise_K[j], p) + helixNoise_PH[j] + helixNoise_OM[j] * t;
    vec3 tw = (helixNoise_A[j]) * (helixNoise_S[j] * cos(phi) * helixNoise_E1[j] - sin(phi) * helixNoise_E2[j]);
    A += tw / length(helixNoise_K[j]);
  }
  return A * helixNoise_SCALE;
}
vec3 helixNoisePot(vec3 p) { return helixNoisePot(p, 0.0); }