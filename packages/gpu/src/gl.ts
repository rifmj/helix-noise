// Thin WebGL2 helpers: compile a shader, link a program (optionally with transform-feedback
// varyings). Both throw with the driver's info log on failure, so misconfigured shaders surface a
// readable error rather than a silent black screen.

/** Compile a single shader stage, throwing the info log on failure. */
export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("helix-noise-gpu: gl.createShader returned null (context lost?)");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("helix-noise-gpu: shader compile failed:\n" + log);
  }
  return sh;
}

/**
 * Link a program from vertex + fragment sources. If `tfVaryings` is non-empty the program is set
 * up to capture them via `INTERLEAVED_ATTRIBS` (must happen before linking, which is why this is a
 * single call rather than compile-then-configure).
 */
export function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSrc: string,
  fragmentSrc: string,
  tfVaryings?: readonly string[],
): WebGLProgram {
  const prog = gl.createProgram();
  if (!prog) throw new Error("helix-noise-gpu: gl.createProgram returned null (context lost?)");
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  if (tfVaryings && tfVaryings.length > 0) {
    gl.transformFeedbackVaryings(prog, tfVaryings as string[], gl.INTERLEAVED_ATTRIBS);
  }
  gl.linkProgram(prog);
  // Once linked, the shader objects are no longer needed on their own.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error("helix-noise-gpu: program link failed:\n" + log);
  }
  return prog;
}
