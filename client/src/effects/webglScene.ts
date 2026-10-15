/**
 * Lightweight Three.js background. Purely presentational: it reads game
 * events and a few state flags but never influences rules or timing.
 */
import * as THREE from 'three';

export type Mood = 'calm' | 'play' | 'mutation' | 'danger' | 'gameover' | 'victory';

const ACCENT = new THREE.Color('#ff2e63');
const MOOD_COLORS: Record<Mood, { primary: THREE.Color; secondary: THREE.Color; speed: number }> = {
  calm: { primary: ACCENT.clone(), secondary: new THREE.Color('#2de2ff'), speed: 0.5 },
  play: { primary: ACCENT.clone(), secondary: new THREE.Color('#7a5cff'), speed: 1 },
  mutation: { primary: new THREE.Color('#2de2ff'), secondary: ACCENT.clone(), speed: 2.2 },
  danger: { primary: new THREE.Color('#ff3b3b'), secondary: new THREE.Color('#ff8a00'), speed: 1.4 },
  gameover: { primary: new THREE.Color('#ff1744'), secondary: new THREE.Color('#3a0010'), speed: 0.15 },
  victory: { primary: new THREE.Color('#b6ff3b'), secondary: new THREE.Color('#2de2ff'), speed: 1.6 },
};

const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * (300.0 / max(0.1, -mv.z));
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;
const POINT_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a * a * vAlpha);
  }
`;

const GRID_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const GRID_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOffset;
  uniform float uPulse;
  varying vec3 vPos;
  float line(float coord) {
    float w = fwidth(coord);
    float g = abs(fract(coord - 0.5) - 0.5) / max(w, 1e-4);
    return 1.0 - min(g, 1.0);
  }
  void main() {
    vec2 p = vec2(vPos.x * 0.5, vPos.z * 0.5 - uOffset);
    float l = max(line(p.x), line(p.y));
    float depth = clamp((-vPos.z + 6.0) / 60.0, 0.0, 1.0);
    float fade = (1.0 - depth) * smoothstep(0.0, 0.08, depth + 0.02);
    float side = 1.0 - smoothstep(10.0, 30.0, abs(vPos.x));
    vec3 col = uColor * (0.55 + uPulse * 1.2);
    gl_FragColor = vec4(col, l * fade * side * (0.5 + uPulse * 0.5));
  }
`;

function radialTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Burst {
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
}

export class PanicScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private disposables: Array<{ dispose(): void }> = [];

  private grid: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private sun: THREE.Sprite;
  private core: THREE.Group;
  private coreLines: THREE.LineBasicMaterial;
  private shapes: Array<{ obj: THREE.LineSegments; spin: THREE.Vector3; base: THREE.Vector3; phase: number }> = [];
  private shapeMats: THREE.LineBasicMaterial[] = [];

  private stars: THREE.Points;
  private starPos: Float32Array;

  private burstGeo: THREE.BufferGeometry;
  private burst: Burst;
  private burstCursor = 0;
  private readonly burstCount = 700;

  private mood: Mood = 'calm';
  private primary = ACCENT.clone();
  private secondary = new THREE.Color('#2de2ff');
  private speed = 0.5;
  private pulse = 0;
  private corePulse = 0;
  private spinBoost = 0;
  private shakeAmt = 0;
  private gridOffset = 0;
  private comboHeat = 0;
  private aiThinking = false;
  private pointer = new THREE.Vector2();
  private reducedMotion: boolean;

  constructor(canvas: HTMLCanvasElement) {
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setClearColor('#07070b', 1);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    this.camera.position.set(0, 0.6, 10);
    this.scene.fog = new THREE.FogExp2('#07070b', 0.028);

    // Synthwave floor.
    const gridGeo = new THREE.PlaneGeometry(80, 80, 1, 1);
    const gridMat = new THREE.ShaderMaterial({
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      uniforms: { uColor: { value: this.primary.clone() }, uOffset: { value: 0 }, uPulse: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.grid = new THREE.Mesh(gridGeo, gridMat);
    this.grid.rotation.x = -Math.PI / 2;
    this.grid.position.set(0, -3.4, -24);
    this.scene.add(this.grid);
    this.disposables.push(gridGeo, gridMat);

    // Horizon glow.
    const sunTex = radialTexture('rgba(255,46,99,0.55)', 'rgba(255,46,99,0)');
    const sunMat = new THREE.SpriteMaterial({ map: sunTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.sun = new THREE.Sprite(sunMat);
    this.sun.scale.set(60, 30, 1);
    this.sun.position.set(0, -2, -55);
    this.scene.add(this.sun);
    this.disposables.push(sunTex, sunMat);

    // Central core: nested wireframe solids behind the play area.
    this.core = new THREE.Group();
    this.coreLines = new THREE.LineBasicMaterial({ color: this.primary, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
    this.disposables.push(this.coreLines);
    for (const [geo, s] of [
      [new THREE.IcosahedronGeometry(3.2, 1), 1],
      [new THREE.OctahedronGeometry(2.0, 0), 1],
    ] as const) {
      const edges = new THREE.EdgesGeometry(geo);
      const lines = new THREE.LineSegments(edges, this.coreLines);
      lines.scale.setScalar(s);
      this.core.add(lines);
      this.disposables.push(geo, edges);
    }
    this.core.position.set(0, 0.2, -9);
    this.scene.add(this.core);

    // Floating shapes.
    const geos = [
      new THREE.TetrahedronGeometry(0.9),
      new THREE.OctahedronGeometry(0.8),
      new THREE.IcosahedronGeometry(0.8),
      new THREE.TorusGeometry(0.7, 0.18, 6, 16),
      new THREE.BoxGeometry(1, 1, 1),
    ];
    const edgeGeos = geos.map((g) => new THREE.EdgesGeometry(g));
    this.disposables.push(...geos, ...edgeGeos);
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.LineBasicMaterial({ color: i % 3 === 0 ? this.secondary : this.primary, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      this.shapeMats.push(mat);
      this.disposables.push(mat);
      const obj = new THREE.LineSegments(edgeGeos[i % edgeGeos.length], mat);
      const side = i % 2 === 0 ? -1 : 1;
      const base = new THREE.Vector3(side * (5 + Math.random() * 9), (Math.random() - 0.4) * 8, -4 - Math.random() * 22);
      obj.position.copy(base);
      obj.scale.setScalar(0.6 + Math.random() * 1.1);
      this.scene.add(obj);
      this.shapes.push({
        obj,
        base,
        phase: Math.random() * Math.PI * 2,
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8),
      });
    }

    // Starfield streaming toward the camera.
    const STARS = 900;
    this.starPos = new Float32Array(STARS * 3);
    const starSize = new Float32Array(STARS);
    const starAlpha = new Float32Array(STARS);
    const starColor = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
      this.starPos[i * 3] = (Math.random() - 0.5) * 60;
      this.starPos[i * 3 + 1] = (Math.random() - 0.5) * 36;
      this.starPos[i * 3 + 2] = -Math.random() * 80;
      starSize[i] = 0.05 + Math.random() * 0.12;
      starAlpha[i] = 0.3 + Math.random() * 0.6;
      const c = Math.random() < 0.15 ? ACCENT : new THREE.Color('#cfd3ff');
      starColor.set([c.r, c.g, c.b], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(this.starPos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
    starGeo.setAttribute('aAlpha', new THREE.BufferAttribute(starAlpha, 1));
    starGeo.setAttribute('aColor', new THREE.BufferAttribute(starColor, 3));
    const pointMat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(starGeo, pointMat);
    this.scene.add(this.stars);
    this.disposables.push(starGeo, pointMat);

    // Burst particle pool.
    const n = this.burstCount;
    this.burstGeo = new THREE.BufferGeometry();
    this.burstGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.burstGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.burstGeo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.burstGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.burst = {
      vx: new Float32Array(n),
      vy: new Float32Array(n),
      vz: new Float32Array(n),
      life: new Float32Array(n),
      maxLife: new Float32Array(n).fill(1),
    };
    const burstPoints = new THREE.Points(this.burstGeo, pointMat);
    burstPoints.frustumCulled = false;
    this.scene.add(burstPoints);
    this.disposables.push(this.burstGeo);

    window.addEventListener('pointermove', this.onPointer, { passive: true });
  }

  private onPointer = (e: PointerEvent) => {
    this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  };

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  setMood(mood: Mood) {
    this.mood = mood;
  }

  setAiThinking(thinking: boolean) {
    this.aiThinking = thinking;
  }

  setComboHeat(combo: number) {
    this.comboHeat = Math.min(1, combo / 15);
  }

  /** Converts a screen point to world coordinates on the z = depth plane. */
  private screenToWorld(x: number, y: number, depth = 0): THREE.Vector3 {
    const ndc = new THREE.Vector3((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const dist = (depth - this.camera.position.z) / dir.z;
    return this.camera.position.clone().add(dir.multiplyScalar(dist));
  }

  emitBurst(screenX: number, screenY: number, color: string, count = 50, power = 1) {
    const origin = this.screenToWorld(screenX, screenY, -0.5);
    const pos = this.burstGeo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.burstGeo.getAttribute('aColor') as THREE.BufferAttribute;
    const size = this.burstGeo.getAttribute('aSize') as THREE.BufferAttribute;
    const c = new THREE.Color(color);
    const white = new THREE.Color('#ffffff');
    for (let k = 0; k < count; k++) {
      const i = this.burstCursor;
      this.burstCursor = (this.burstCursor + 1) % this.burstCount;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const v = (2 + Math.random() * 5) * power;
      this.burst.vx[i] = Math.sin(phi) * Math.cos(theta) * v;
      this.burst.vy[i] = Math.sin(phi) * Math.sin(theta) * v;
      this.burst.vz[i] = Math.abs(Math.cos(phi)) * v * 0.8;
      this.burst.life[i] = this.burst.maxLife[i] = 0.5 + Math.random() * 0.7;
      pos.setXYZ(i, origin.x, origin.y, origin.z);
      const mix = Math.random() < 0.25 ? white : c;
      col.setXYZ(i, mix.r, mix.g, mix.b);
      size.setX(i, 0.12 + Math.random() * 0.22);
    }
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;
  }

  pulseHit(strength = 1) {
    this.pulse = Math.min(1.5, this.pulse + 0.45 * strength);
    this.corePulse = Math.min(1, this.corePulse + 0.5 * strength);
  }

  shake(amount: number) {
    if (this.reducedMotion) return;
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  spinUp(amount: number) {
    this.spinBoost = Math.max(this.spinBoost, amount);
  }

  render() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const motion = this.reducedMotion ? 0.3 : 1;

    // Ease palette and speed toward the current mood.
    const target = MOOD_COLORS[this.mood];
    const k = 1 - Math.exp(-dt * 3);
    this.primary.lerp(target.primary, k);
    this.secondary.lerp(target.secondary, k);
    this.speed += (target.speed + this.comboHeat * 1.2 - this.speed) * k;

    this.pulse *= Math.exp(-dt * 4);
    this.corePulse *= Math.exp(-dt * 5);
    this.spinBoost *= Math.exp(-dt * 1.6);
    this.shakeAmt *= Math.exp(-dt * 9);

    // Grid.
    this.gridOffset += dt * this.speed * 2.2 * motion;
    const gu = this.grid.material.uniforms;
    gu.uOffset.value = this.gridOffset;
    gu.uPulse.value = this.pulse;
    (gu.uColor.value as THREE.Color).copy(this.primary);
    (this.sun.material as THREE.SpriteMaterial).color.copy(this.primary).multiplyScalar(0.9 + this.pulse * 0.4);

    // Core reacts to hits and to the AI thinking.
    const coreSpin = (0.12 + (this.aiThinking ? 0.9 : 0) + this.spinBoost * 3) * motion;
    this.core.rotation.y += dt * coreSpin;
    this.core.rotation.x += dt * coreSpin * 0.4;
    this.core.children[1].rotation.z -= dt * coreSpin * 1.7;
    const coreScale = 1 + this.corePulse * 0.18 + (this.aiThinking ? Math.sin(t * 8) * 0.02 : 0);
    this.core.scale.setScalar(coreScale);
    this.coreLines.color.copy(this.aiThinking ? this.secondary : this.primary);
    this.coreLines.opacity = 0.22 + this.corePulse * 0.4 + (this.aiThinking ? 0.15 : 0);

    // Floating shapes.
    for (let i = 0; i < this.shapes.length; i++) {
      const s = this.shapes[i];
      const spin = (1 + this.spinBoost * 6) * motion;
      s.obj.rotation.x += s.spin.x * dt * spin;
      s.obj.rotation.y += s.spin.y * dt * spin;
      s.obj.rotation.z += s.spin.z * dt * spin;
      s.obj.position.y = s.base.y + Math.sin(t * 0.5 + s.phase) * 0.6;
      s.obj.position.x = s.base.x + Math.cos(t * 0.3 + s.phase) * 0.4;
      this.shapeMats[i].color.copy(i % 3 === 0 ? this.secondary : this.primary);
      this.shapeMats[i].opacity = 0.35 + this.pulse * 0.3;
    }

    // Stars stream toward the camera.
    const sp = this.starPos;
    const starSpeed = (2 + this.speed * 6) * dt * motion;
    for (let i = 2; i < sp.length; i += 3) {
      sp[i] += starSpeed;
      if (sp[i] > 10) sp[i] -= 90;
    }
    (this.stars.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    // Burst particles.
    const pos = this.burstGeo.getAttribute('position') as THREE.BufferAttribute;
    const alpha = this.burstGeo.getAttribute('aAlpha') as THREE.BufferAttribute;
    const b = this.burst;
    for (let i = 0; i < this.burstCount; i++) {
      if (b.life[i] <= 0) {
        if (alpha.getX(i) !== 0) alpha.setX(i, 0);
        continue;
      }
      b.life[i] -= dt;
      const drag = Math.exp(-dt * 2.2);
      b.vx[i] *= drag;
      b.vy[i] = b.vy[i] * drag - dt * 2.5;
      b.vz[i] *= drag;
      pos.setXYZ(i, pos.getX(i) + b.vx[i] * dt, pos.getY(i) + b.vy[i] * dt, pos.getZ(i) + b.vz[i] * dt);
      alpha.setX(i, Math.max(0, b.life[i] / b.maxLife[i]));
    }
    pos.needsUpdate = alpha.needsUpdate = true;

    // Camera: gentle pointer parallax + shake.
    const cam = this.camera;
    cam.position.x += (this.pointer.x * 0.6 - cam.position.x) * k + (Math.random() - 0.5) * this.shakeAmt;
    cam.position.y += (0.6 + this.pointer.y * 0.35 - cam.position.y) * k + (Math.random() - 0.5) * this.shakeAmt;
    cam.lookAt(0, 0, -10);

    this.renderer.render(this.scene, cam);
  }

  dispose() {
    window.removeEventListener('pointermove', this.onPointer);
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
  }
}
