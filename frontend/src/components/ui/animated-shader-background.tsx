import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { getPerfProfile } from "../../utils/perfProfile";

/** AnoAI 原版 fragment shader；右侧用 uv 遮罩平铺补全（不改公式、不用 max 合成） */
const FRAGMENT_SHADER = `
uniform float iTime;
uniform vec2 iResolution;
uniform float uStreakMax;
uniform float uExtraWeight;

#define NUM_OCTAVES 3

float rand(vec2 n) {
  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 ip = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);

  float res = mix(
    mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x),
    mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x),
    u.y
  );
  return res * res;
}

float fbm(vec2 x) {
  float v = 0.0;
  float a = 0.3;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < NUM_OCTAVES; ++i) {
    v += a * noise(x);
    x = rot * x * 2.0 + shift;
    a *= 0.4;
  }
  return v;
}

vec4 auroraPass(vec2 p, float timeShift) {
  float t = iTime + timeShift;
  vec2 v;
  vec4 o = vec4(0.0);
  float f = 2.0 + fbm(p + vec2(t * 5.0, 0.0)) * 0.5;

  for (float i = 0.0; i < 35.0; i++) {
    if (i >= uStreakMax) break;
    float phase = i * 2.513 + sin(i * 0.91) * 3.17;
    vec2 streakDir = normalize(vec2(0.74, -0.62));
    vec2 perpDir = vec2(-streakDir.y, streakDir.x);
    float alongDrift =
      sin(t * 2.05 + phase) * 0.024 +
      sin(t * 0.92 + phase * 1.73) * 0.014;
    float crossDrift = cos(t * 2.65 + phase * 1.41) * 0.006;
    vec2 wobble = streakDir * alongDrift + perpDir * crossDrift;

    v =
      p +
      cos(i * i + (t + p.x * 0.08) * 0.025 + i * vec2(13.0, 11.0)) * 4.2 +
      wobble;
    float tailNoise = fbm(v + vec2(t * 0.5, i)) * 0.3 * (1.0 - (i / 35.0));
    vec4 auroraColors = vec4(
      0.1 + 0.3 * sin(i * 0.2 + t * 0.4),
      0.3 + 0.5 * cos(i * 0.3 + t * 0.5),
      0.7 + 0.3 * sin(i * 0.4 + t * 0.3),
      1.0
    );
    vec4 currentContribution =
      auroraColors *
      exp(sin(i * i + t * 0.8)) /
      length(max(v, vec2(v.x * f * 0.011, v.y * 1.15)));
    float thinnessFactor = smoothstep(0.0, 1.0, i / 35.0) * 0.6;
    o += currentContribution * (1.0 + tailNoise * 0.8) * thinnessFactor;
  }

  return o;
}

vec3 planetArcGlow(vec2 uv, vec2 res, float aspect, float t) {
  /* 距右上角像素坐标，画正圆 quarter 弧 */
  float rPx = res.y * 0.30;
  vec2 fc = vec2((1.0 - uv.x) * res.x, (1.0 - uv.y) * res.y);
  vec2 center = vec2(rPx, rPx);
  vec2 p = fc - center;
  float dist = length(p);

  float ring = abs(dist - rPx);
  float rim = smoothstep(4.5, 0.8, ring);
  float halo = exp(-ring * ring / 36.0) * 0.38;

  float ang = atan(p.y, p.x);
  float inArc = step(-1.571 - 0.05, ang) * step(ang, 3.142 + 0.05);
  float inCorner =
    step(-0.5, fc.x) * step(-0.5, fc.y) *
    step(fc.x, rPx + 5.0) * step(fc.y, rPx + 5.0);

  vec2 n = p / max(dist, 0.001);
  float lit = smoothstep(-0.15, 0.55, dot(n, normalize(vec2(-0.82, -0.58))));
  rim *= mix(0.72, 1.0, lit);

  float pulse = 0.93 + 0.07 * sin(t * 0.45 + 1.2);
  vec3 rimCol = mix(vec3(0.28, 0.58, 1.0), vec3(0.92, 0.96, 1.0), lit);

  return (rimCol * rim * 1.35 + vec3(0.2, 0.48, 0.95) * halo) * inArc * inCorner * pulse;
}

void main() {
  /* 极轻全屏抖动，避免所有流星同步往同一方向漂 */
  vec2 shake = vec2(sin(iTime * 1.2) * 0.0025, cos(iTime * 2.1) * 0.003);
  vec2 p =
    ((gl_FragCoord.xy + shake * iResolution.xy) - iResolution.xy * 0.5) /
    iResolution.y *
    mat2(6.0, -4.0, 4.0, 6.0);

  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;
  float tile = aspect * 0.72 + 0.52;

  /* 中心：与 AnoAI 源码完全一致的单层采样 */
  vec4 o = auroraPass(p, 0.0);

  /* 全屏补层：仅右半屏叠加，保留原版柔长拖尾质感 */
  o += auroraPass(p - vec2(tile * 1.05, 0.14), 1.7) * smoothstep(0.3, 0.55, uv.x) * uExtraWeight;
  o += auroraPass(p - vec2(tile * 2.05, 0.1), 3.4) * smoothstep(0.45, 0.75, uv.x) * uExtraWeight;
  float edgeShift = smoothstep(0.62, 1.0, uv.x) * (aspect * 0.45);
  o += auroraPass(p - vec2(tile * 2.35 + edgeShift, 0.12), 6.4) * smoothstep(0.5, 0.98, uv.x) * 0.78 * uExtraWeight;
  o += auroraPass(p - vec2(tile * 3.05 + edgeShift, 0.06), 8.0) * smoothstep(0.78, 1.0, uv.x) * 0.62 * uExtraWeight;

  o = tanh(pow(o / 100.0, vec4(1.6)));
  vec3 col = o.rgb * 1.5;
  col += planetArcGlow(uv, iResolution, aspect, iTime);
  gl_FragColor = vec4(col, 1.0);
}
`;

const VERTEX_SHADER = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

/** AnoAI 极光背景（原版动态 + 宽屏右侧补全） */
const AnimatedShaderBackground: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReducedMotion) return;

    let frameId = 0;
    let disposed = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cleanupGpu: (() => void) | undefined;

    const start = () => {
      if (disposed || !containerRef.current) return;
      const mount = containerRef.current;
      const perf = getPerfProfile();

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const renderer = new THREE.WebGLRenderer({
        antialias: perf.tier === "full",
        alpha: false,
        powerPreference: "high-performance"
      });
      renderer.setPixelRatio(perf.maxDpr);

      const canvas = renderer.domElement;
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      mount.appendChild(canvas);

      const material = new THREE.ShaderMaterial({
        uniforms: {
          iTime: { value: 0 },
          iResolution: {
            value: new THREE.Vector2(window.innerWidth, window.innerHeight)
          },
          uStreakMax: { value: perf.shaderStreakMax },
          uExtraWeight: { value: perf.shaderExtraPassWeight }
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER
      });

      const geometry = new THREE.PlaneGeometry(2, 2);
      scene.add(new THREE.Mesh(geometry, material));

      const syncSize = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h);
        material.uniforms.iResolution.value.set(w, h);
      };

      syncSize();

      let visible = document.visibilityState === "visible";
      const frameInterval = 1000 / perf.shaderFps;
      let lastFrame = 0;

      const onVisibility = () => {
        visible = document.visibilityState === "visible";
      };
      document.addEventListener("visibilitychange", onVisibility);

      const animate = (now: number) => {
        frameId = requestAnimationFrame(animate);
        if (!visible) return;
        if (now - lastFrame < frameInterval) return;
        const dt = (now - lastFrame) / 1000;
        lastFrame = now;
        material.uniforms.iTime.value += dt;
        renderer.render(scene, camera);
      };
      requestAnimationFrame(animate);

      window.addEventListener("resize", syncSize);

      cleanupGpu = () => {
        cancelAnimationFrame(frameId);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("resize", syncSize);
        if (mount.contains(canvas)) {
          mount.removeChild(canvas);
        }
        geometry.dispose();
        material.dispose();
        renderer.dispose();
      };
    };

    const scheduleStart = () => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(() => start(), { timeout: 500 });
      } else {
        timeoutId = window.setTimeout(() => start(), 0);
      }
    };
    scheduleStart();

    return () => {
      disposed = true;
      if (idleId !== undefined && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      cleanupGpu?.();
    };
  }, []);

  return (
    <div ref={containerRef} className="animated-shader-backdrop" aria-hidden />
  );
};

export default AnimatedShaderBackground;
