// Moving backgrounds for full-screen lyrics, drawn on the GPU (one WebGL shader, 8 scenes).
// Rendered at reduced resolution and ~30 fps, paused when the tab is hidden.

export const SCENES = [
  { id: 'ocean', icon: '🌊', label: 'Ocean' },
  { id: 'clouds', icon: '☁️', label: 'Clouds' },
  { id: 'aurora', icon: '🌌', label: 'Aurora' },
  { id: 'stars', icon: '✨', label: 'Stars' },
  { id: 'flow', icon: '🎨', label: 'Cover glow' },
  { id: 'beach', icon: '🏖️', label: 'Beach' },
  { id: 'sunset', icon: '🌅', label: 'Sunset' },
  { id: 'milkyway', icon: '🌠', label: 'Milky Way' },
];

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uScene;
uniform vec3 uCol;
uniform float uPulse;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

// ---------- ocean ----------
// One layer of sea: sharp-crested swells (1 - |sin| gives pointed tops), wobbled by noise
float seaLayer(vec2 uv){
  uv += noise(uv) * 1.2;
  float a = 1.0 - abs(sin(uv.x));
  float b = 1.0 - abs(sin(uv.y * 0.8 + uv.x * 0.3));
  return pow(a * b, 0.6);
}
// Sea height: a few layers, each smaller, rotated and moving with the wind
float seaH(vec2 p, float t, int layers){
  float h = 0.0;
  float amp = 1.5;
  float freq = 0.085;
  mat2 rot = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    if (i >= layers) break;
    h += (seaLayer(p * freq + vec2(t, t * 0.6)) + seaLayer(p * freq * 1.3 - vec2(t * 0.8, -t * 0.3))) * amp;
    p = rot * p;
    freq *= 1.9;
    amp *= 0.2;
  }
  return h - 1.5;
}
vec3 skyCol(vec3 d, float t){
  float y = max(d.y, 0.0);
  vec3 base = mix(vec3(0.56, 0.6, 0.63), vec3(0.3, 0.34, 0.38), pow(y, 0.5));
  vec2 cp = d.xz / (d.y + 0.12) * 1.2 + vec2(t * 0.03, t * 0.012);
  float c = fbm(cp * 1.5);
  float c2 = fbm(cp * 3.0 + 3.1);
  float cl = smoothstep(0.35, 0.8, c * 0.7 + c2 * 0.4);
  vec3 cloud = mix(vec3(0.76, 0.79, 0.81), vec3(0.27, 0.3, 0.34), smoothstep(0.4, 0.9, c2));
  return mix(base, cloud, cl * smoothstep(0.0, 0.15, d.y + 0.02));
}
// sunset sky: warm horizon, low sun, glowing cloud edges
const vec3 SUN = vec3(0.0, 0.035, 1.0);
vec3 sunsetSky(vec3 d, float t){
  float y = max(d.y, 0.0);
  vec3 col = mix(vec3(1.0, 0.52, 0.22), vec3(0.98, 0.72, 0.42), smoothstep(0.0, 0.06, y));
  col = mix(col, vec3(0.55, 0.35, 0.55), smoothstep(0.05, 0.3, y));
  col = mix(col, vec3(0.12, 0.13, 0.32), smoothstep(0.25, 0.8, y));
  float s = max(dot(normalize(d), normalize(SUN)), 0.0);
  col += vec3(1.0, 0.78, 0.5) * smoothstep(0.9993, 0.9997, s) * 1.6;  // the sun disc
  col += vec3(1.0, 0.5, 0.2) * (pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12); // its glow
  vec2 cp = d.xz / (d.y + 0.1) * 1.1 + vec2(t * 0.02, 0.0);
  float c = smoothstep(0.5, 0.85, fbm(cp * 1.4));
  vec3 cloud = mix(vec3(0.35, 0.18, 0.25), vec3(1.0, 0.6, 0.4), pow(s, 3.0));
  return mix(col, cloud, c * smoothstep(0.02, 0.12, d.y) * 0.85);
}
vec3 skyP(vec3 d, float t, float pal){ return pal < 0.5 ? skyCol(d, t) : sunsetSky(d, t); }

vec3 ocean(vec2 uv, float t, float pal){
  float st = t * 0.55; // sea time
  vec3 ro = vec3(0.0, 3.2 + sin(t * 0.35) * 0.3, t * 3.5);
  float roll = sin(t * 0.25) * 0.03;
  uv = mat2(cos(roll), -sin(roll), sin(roll), cos(roll)) * uv;
  vec3 dir = normalize(vec3(uv.x, uv.y - 0.14 + sin(t * 0.4) * 0.015, 1.5));

  // where does the view ray meet the sea? (bisection between a point above and one below)
  float tm = 0.0;
  float tx = 900.0;
  float hx = (ro + dir * tx).y - seaH((ro + dir * tx).xz, st, 3);
  if (hx > 0.0) return skyP(dir, t, pal);
  float hm = ro.y - seaH(ro.xz, st, 3);
  float d = 0.0;
  for (int i = 0; i < 10; i++) {
    d = mix(tm, tx, hm / (hm - hx));
    vec3 q = ro + dir * d;
    float hq = q.y - seaH(q.xz, st, 3);
    if (hq < 0.0) { tx = d; hx = hq; } else { tm = d; hm = hq; }
  }
  vec3 p = ro + dir * d;

  // surface normal from the detailed sea
  float e = 0.02 + d * 0.004;
  float h0 = seaH(p.xz, st, 5);
  vec3 n = normalize(vec3(h0 - seaH(p.xz + vec2(e, 0.0), st, 5), e, h0 - seaH(p.xz + vec2(0.0, e), st, 5)));

  vec3 L = normalize(vec3(0.0, 0.7, 0.9));
  float fres = clamp(1.0 - dot(n, -dir), 0.0, 1.0);
  fres = min(pow(fres, 3.0), 0.55);
  vec3 refl = skyP(vec3(reflect(dir, n).x, abs(reflect(dir, n).y) + 0.02, reflect(dir, n).z), t, pal);
  vec3 base = pal < 0.5 ? vec3(0.03, 0.06, 0.08) : vec3(0.06, 0.03, 0.06);
  vec3 tint = pal < 0.5 ? vec3(0.42, 0.52, 0.55) : vec3(0.7, 0.35, 0.25);
  vec3 refr = base + pow(dot(n, L) * 0.4 + 0.6, 60.0) * tint * 0.14;
  vec3 col = mix(refr, refl, fres);
  float atten = max(1.0 - d * d * 0.0004, 0.0);
  col += tint * (p.y + 0.3) * 0.16 * atten; // lighter on the crests
  col += vec3(0.5) * pow(max(dot(reflect(dir, n), L), 0.0), 40.0) * 0.12 * atten;
  if (pal > 0.5) {
    // the sun's golden path on the water
    vec3 r = reflect(dir, n);
    col += vec3(1.0, 0.62, 0.3) * pow(max(dot(r, normalize(SUN)), 0.0), 90.0) * 1.6;
  }
  float fog = 1.0 - exp(-d * 0.009);
  col = mix(col, skyP(vec3(dir.x, 0.01, dir.z), t, pal) * 0.92, fog);
  // soft horizon blend
  return mix(skyP(dir, t, pal), col, pow(smoothstep(0.0, -0.03, dir.y), 0.3));
}

// ---------- beach ----------
vec3 beachSky(vec3 d, float t){
  float y = max(d.y, 0.0);
  vec3 col = mix(vec3(0.78, 0.88, 0.95), vec3(0.25, 0.55, 0.88), pow(y, 0.6));
  float s = max(dot(d, normalize(vec3(0.5, 0.35, 1.0))), 0.0);
  col += vec3(1.0, 0.95, 0.85) * (pow(s, 600.0) * 2.0 + pow(s, 8.0) * 0.25);
  vec2 cp = d.xz / (d.y + 0.15) + vec2(t * 0.015, 0.0);
  float c = smoothstep(0.55, 0.85, fbm(cp * 1.3));
  return mix(col, vec3(1.0), c * 0.8 * smoothstep(0.02, 0.2, d.y));
}
vec3 beach(vec2 uv, float t){
  vec3 ro = vec3(0.0, 1.7, 0.0);
  vec3 dir = normalize(vec3(uv.x, uv.y - 0.1, 1.3));
  if (dir.y > -0.0015) return beachSky(dir, t);
  float d = ro.y / -dir.y;
  vec2 g = (ro + dir * d).xz;            // ground point (z = distance out to sea)
  // the waterline washes up and back, with a wobbly edge
  float wash = sin(t * 0.55 + g.x * 0.03) * 0.5 + 0.5;
  float shore = 13.0 - wash * 5.5 + (noise(vec2(g.x * 0.12, t * 0.2)) - 0.5) * 2.5;
  float wetLine = 13.5 + (noise(vec2(g.x * 0.1, 3.0)) - 0.5) * 2.0;
  float grain = fbm(g * 3.0);
  vec3 sand = mix(vec3(0.86, 0.76, 0.58), vec3(0.95, 0.87, 0.7), grain);
  sand = mix(sand, sand * 0.62, smoothstep(wetLine - 6.0, wetLine - 3.0, g.y)); // darker wet sand
  vec3 col = sand;
  if (g.y > shore) {
    float far = smoothstep(0.0, 120.0, g.y - shore);
    vec3 water = mix(vec3(0.25, 0.78, 0.78), vec3(0.04, 0.32, 0.55), sqrt(far));
    // small waves: moving lines parallel to the beach, plus glitter from the sun
    float w = sin(g.y * 0.9 - t * 2.0 + noise(g * 0.2) * 3.0);
    water += vec3(0.08) * smoothstep(0.7, 1.0, w) * (1.0 - far);
    float glit = step(0.985, noise(g * 6.0 + t * 2.0)) * (1.0 - far * 0.5);
    water += vec3(1.0) * glit * 0.6;
    // see-through near the edge
    water = mix(sand * 0.85, water, smoothstep(0.0, 1.5, g.y - shore));
    col = water;
    // the foam at the edge of each wave
    float foamEdge = smoothstep(1.2, 0.0, g.y - shore) * smoothstep(0.25, 0.65, fbm(g * 1.8 + t * 0.3));
    float breaker = smoothstep(0.92, 1.0, sin(g.y * 0.35 - t * 1.1)) * smoothstep(40.0, 15.0, g.y);
    col = mix(col, vec3(0.97), clamp(foamEdge + breaker * 0.6, 0.0, 1.0));
  }
  float fog = 1.0 - exp(-d * 0.006);
  return mix(col, beachSky(vec3(dir.x, 0.01, dir.z), t), fog);
}

// ---------- milky way ----------
vec3 milkyway(vec2 uv, float t){
  float a = t * 0.01; // the sky turns slowly
  vec2 r = mat2(cos(a), -sin(a), sin(a), cos(a)) * uv;
  vec3 col = mix(vec3(0.02, 0.03, 0.07), vec3(0.0, 0.0, 0.02), uv.y + 0.5);
  // stars: many small, a few bright, twinkling
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 sp = r * (120.0 + fi * 90.0) + fi * 17.0;
    vec2 id = floor(sp);
    float h = hash(id);
    vec2 f = fract(sp) - 0.5 - (vec2(hash(id + 1.3), hash(id + 2.7)) - 0.5) * 0.6;
    float star = smoothstep(0.12 - fi * 0.03, 0.0, length(f)) * step(0.93 + fi * 0.02, h);
    col += star * (0.6 + 0.4 * sin(t * 2.0 + h * 50.0)) * mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash(id + 5.0));
  }
  // the galaxy band, with dark dust lanes
  float band = r.y * 0.9 + r.x * 0.45 + 0.05;
  float core = exp(-band * band * 18.0);
  float dust = fbm(r * 5.0 + 3.0);
  float glow = core * (0.55 + 0.6 * fbm(r * 3.0)) * smoothstep(0.25, 0.65, dust + 0.2);
  col += glow * mix(vec3(0.45, 0.4, 0.62), vec3(0.95, 0.8, 0.62), smoothstep(0.3, 0.0, abs(r.x + 0.1)));
  col -= core * smoothstep(0.55, 0.75, fbm(r * 9.0 - 2.0)) * 0.12;
  // dense little stars inside the band
  vec2 bs = r * 300.0;
  col += step(0.97, hash(floor(bs))) * core * 0.7;
  // hills on the horizon, with a last faint glow behind them
  float hill = -0.32 + 0.05 * sin(uv.x * 3.0 + 1.0) + 0.04 * fbm(vec2(uv.x * 4.0, 1.0));
  col += vec3(0.05, 0.08, 0.16) * smoothstep(0.25, 0.0, uv.y - hill);
  col = mix(col, vec3(0.004, 0.006, 0.012), smoothstep(0.004, -0.004, uv.y - hill));
  return max(col, 0.0);
}

// ---------- clouds ----------
vec3 clouds(vec2 uv, float t){
  vec3 col = mix(vec3(0.55, 0.62, 0.72), vec3(0.16, 0.25, 0.4), clamp(uv.y * 0.8 + 0.5, 0.0, 1.0));
  col = mix(col, col * (0.6 + uCol), 0.25);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 p = uv * (1.2 + fi * 0.8) + vec2(t * (0.02 + fi * 0.015), fi * 3.7);
    float c = fbm(p * 2.0 + fbm(p * 1.5 + t * 0.02));
    float a = smoothstep(0.45 - fi * 0.04, 0.8, c);
    col = mix(col, mix(vec3(0.96), vec3(0.55, 0.6, 0.68), fi * 0.35), a * 0.75);
  }
  return col;
}

// ---------- aurora ----------
vec3 aurora(vec2 uv, float t){
  vec3 col = mix(vec3(0.01, 0.02, 0.05), vec3(0.02, 0.06, 0.11), uv.y + 0.5);
  vec2 g = floor((uv + 1.0) * 260.0);
  float s = step(0.996, hash(g));
  col += s * 0.8 * (0.5 + 0.5 * sin(t * 3.0 + hash(g + 1.0) * 30.0));
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float y0 = 0.12 + fi * 0.07 + 0.12 * sin(uv.x * 1.5 + t * 0.15 + fi) + 0.1 * (fbm(vec2(uv.x * 2.0 + t * 0.05, fi)) - 0.5);
    float band = exp(-abs(uv.y - y0) * (9.0 + fi * 4.0));
    float streak = fbm(vec2(uv.x * 18.0 + t * 0.3, fi * 5.0)) * 0.8 + 0.2;
    vec3 c = mix(vec3(0.1, 1.0, 0.55), vec3(0.55, 0.3, 1.0), fi / 3.0);
    col += c * band * streak * 0.55 * smoothstep(-0.25, 0.15, uv.y - y0 + 0.2);
  }
  return col;
}

// ---------- stars ----------
vec3 stars(vec2 uv, float t){
  vec3 col = vec3(0.0, 0.0, 0.02);
  float neb = fbm(uv * 2.0 + t * 0.02);
  col += uCol * 0.35 * smoothstep(0.4, 0.9, neb) + vec3(0.1, 0.05, 0.2) * neb * 0.4;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float z = fract(t * 0.05 + fi * 0.25);
    float sc = mix(18.0, 2.0, z);
    vec2 p = uv * sc + fi * 13.1;
    vec2 id = floor(p);
    vec2 f = fract(p) - 0.5;
    vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
    float d = length(f - o * 0.7);
    float star = smoothstep(0.06 * (1.0 - z) + 0.012, 0.0, d) * step(0.75, hash(id + fi));
    col += star * smoothstep(0.0, 0.3, z) * smoothstep(1.0, 0.8, z) * vec3(0.9, 0.95, 1.0) * 1.6;
  }
  return col;
}

// ---------- cover glow ----------
vec3 flow(vec2 uv, float t){
  vec2 q = vec2(fbm(uv * 1.5 + t * 0.05), fbm(uv * 1.5 + vec2(5.2, 1.3) - t * 0.04));
  float f = fbm(uv * 1.8 + q * 1.6 + t * 0.03);
  vec3 col = mix(vec3(0.02), uCol, smoothstep(0.2, 0.8, f));
  col = mix(col, uCol.zxy * 0.6 + 0.1, smoothstep(0.5, 0.95, q.x) * 0.6);
  return col * 1.1;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime;
  vec3 col;
  if (uScene < 0.5) col = ocean(uv, t, 0.0);
  else if (uScene < 1.5) col = clouds(uv, t);
  else if (uScene < 2.5) col = aurora(uv, t);
  else if (uScene < 3.5) col = stars(uv, t);
  else if (uScene < 4.5) col = flow(uv, t);
  else if (uScene < 5.5) col = beach(uv, t);
  else if (uScene < 6.5) col = ocean(uv, t, 1.0);
  else col = milkyway(uv, t);
  col *= 1.0 + uPulse * 0.045;
  float v = smoothstep(1.25, 0.35, length(uv * vec2(0.85, 1.1)));
  col *= mix(0.55, 1.0, v);
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.95)), 1.0);
}
`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader failed');
  return s;
}

// Start drawing into a canvas. Returns { setScene, setColor, pulse, stop } or null (no WebGL).
export function startScene(canvas, { scene = 0, color = [0.3, 0.4, 0.5], scale = 0.5 } = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return null;
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link failed');
  } catch {
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(prog, n);
  const uRes = u('uRes');
  const uTime = u('uTime');
  const uScene = u('uScene');
  const uCol = u('uCol');
  const uPulse = u('uPulse');

  const st = { scene, color, pulse: 0, scale };
  let raf = 0;
  let last = 0;
  const t0 = performance.now();
  const resize = () => {
    const w = Math.max(2, Math.round(canvas.clientWidth * st.scale));
    const h = Math.max(2, Math.round(canvas.clientHeight * st.scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (document.hidden || now - last < 32) return; // ~30 fps is plenty for slow motion
    last = now;
    resize();
    st.pulse *= 0.95; // a slow, soft glow (no flash)
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - t0) / 1000);
    gl.uniform1f(uScene, st.scene);
    gl.uniform3f(uCol, st.color[0], st.color[1], st.color[2]);
    gl.uniform1f(uPulse, st.pulse);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  raf = requestAnimationFrame(frame);
  return {
    setScene: (i) => (st.scene = i),
    setColor: (c) => (st.color = c),
    setScale: (s) => (st.scale = s),
    pulse: () => (st.pulse = 1),
    stop: () => {
      cancelAnimationFrame(raf);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
