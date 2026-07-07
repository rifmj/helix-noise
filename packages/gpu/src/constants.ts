/** 2π — the period of a `tileable` Helix Noise field, and the default domain box. */
export const TAU = 6.283185307179586;

/** Floats per particle in the interleaved VBO: position (x,y,z) + aux (hue, speed). */
export const PARTICLE_STRIDE_FLOATS = 5;

/** Bytes per particle (`PARTICLE_STRIDE_FLOATS * 4`). The transform-feedback output matches it. */
export const PARTICLE_STRIDE_BYTES = PARTICLE_STRIDE_FLOATS * 4;

/** Vertex-attribute location of the particle position (`vec3`), shared by the update + render VAOs. */
export const ATTRIB_POS = 0;

/** Vertex-attribute location of the particle aux channel (`vec2` = hue, speed). */
export const ATTRIB_AUX = 1;
