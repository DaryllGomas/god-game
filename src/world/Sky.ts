import * as THREE from 'three';
import { clamp, smoothstep } from '../util/math';
import { LOOK } from './lookKit';

const DAY_ZENITH = new THREE.Color(0x3d86d6);
const DAY_HORIZON = new THREE.Color(0xc6e6f5);
const DUSK_ZENITH = new THREE.Color(0x3b4f8f);
const DUSK_HORIZON = new THREE.Color(0xf29a5c);
const NIGHT_ZENITH = new THREE.Color(0x03060f);
const NIGHT_HORIZON = new THREE.Color(0x101a33);

/**
 * The night floor (2026-10-15 playtest: at 4x the nights went nearly black, villagers and lost children unreadable).
 * Nights stay moody and blue, but the moon comes up as the sun goes (no dark gap at dusk), the sky fill never drops
 * below NIGHT_HEMI, and the exposure lifts a little in the dark.
 */
const MOON_INTENSITY = 0.85;
const MOON_COLOR = new THREE.Color(0.48, 0.6, 1.0);
const NIGHT_HEMI = 0.78;
const NIGHT_HEMI_COLOR = new THREE.Color(0x6788d8);
const NIGHT_GROUND = 0.4;
const NIGHT_EXPOSURE_LIFT = 0.14;

/** Sky dome, sun/moon light, hemisphere fill, stars and fog, all driven by time of day. */
export class Sky {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly group = new THREE.Group();
  readonly sunDir = new THREE.Vector3();
  readonly sunColor = new THREE.Color();
  /** 0 at deep night, 1 at full day. */
  daylight = 1;
  timeOfDay = 0.3;
  /** Multiplier on the renderer's base exposure: 1 by day, a little more at night (Game applies it each frame). */
  exposureScale = 1;

  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly stars: THREE.Points;
  private readonly fog: THREE.Fog;

  constructor(scene: THREE.Scene) {
    this.fog = new THREE.Fog(0xc6e6f5, 400, 1800);
    scene.fog = this.fog;

    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() },
        uSunGlow: { value: new THREE.Color() },
        uTime: { value: 0 },
        uGold: { value: 0 },
        uCloud: { value: 0 },
        uGoldCol: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uSunGlow;
        uniform float uTime;
        uniform float uGold;
        uniform float uCloud;
        uniform vec3 uGoldCol;
        varying vec3 vDir;
        float sh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float sn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(sh(i), sh(i + vec2(1.0, 0.0)), f.x), mix(sh(i + vec2(0.0, 1.0)), sh(i + vec2(1.0, 1.0)), f.x), f.y); }
        float sfbm(vec2 p) { return sn(p) * 0.5 + sn(p * 2.03 + 7.1) * 0.25 + sn(p * 4.1 + 3.3) * 0.125 + sn(p * 8.3 + 1.7) * 0.0625; }
        void main() {
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.05, 0.9, h), 0.6));
          float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          col += uSunGlow * (pow(s, 600.0) * 6.0 + pow(s, 12.0) * 0.35);
          // Warm golden band hugging the horizon (it fades to the horizon colour at h=0 so the sea's edge still matches the fog).
          float sunAz = max(dot(normalize(vec2(vDir.x, vDir.z) + 1e-4), normalize(vec2(uSunDir.x, uSunDir.z) + 1e-4)), 0.0);
          float band = smoothstep(0.0, 0.025, vDir.y) * exp(-vDir.y * 5.5);
          col = mix(col, uGoldCol, clamp(band * uGold * (0.55 + 0.45 * sunAz), 0.0, 1.0));
          // Soft drifting clouds low in the sky, lit warm on the sun side and fading into the haze at the horizon.
          if (vDir.y > 0.01 && vDir.y < 0.55 && uCloud > 0.001) {
            vec2 cp = vDir.xz / (vDir.y + 0.12) * 0.7 + vec2(uTime * 0.012, uTime * 0.004);
            float cd = sfbm(cp * vec2(1.0, 1.6));
            float cov = smoothstep(0.36, 0.6, cd) * smoothstep(0.012, 0.06, vDir.y) * (1.0 - smoothstep(0.34, 0.6, vDir.y));
            vec3 lit = mix(vec3(1.0, 0.96, 0.9), vec3(1.0, 0.82, 0.55), 0.4 + 0.6 * sunAz * uGold);
            vec3 cl = mix(vec3(0.5, 0.46, 0.6), lit, smoothstep(0.42, 0.78, cd)); // darker belly, brighter tops
            col = mix(col, cl, clamp(cov * uCloud * 0.9, 0.0, 1.0));
          }
          if (!(col.r == col.r) || !(col.g == col.g) || !(col.b == col.b)) col = uHorizon;
          gl_FragColor = vec4(col, 1.0);
          // No tone mapping: fog colour isn't tone-mapped either, so the horizon and
          // fogged distant land/sea must match exactly or the sea's edge shows.
          #include <colorspace_fragment>
        }
      `,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const n = 1400;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.95 + 0.05;
      p[i * 3] = Math.cos(a) * r * 3500;
      p[i * 3 + 1] = y * 3500;
      p[i * 3 + 2] = Math.sin(a) * r * 3500;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }),
    );
    this.stars.frustumCulled = false;
    this.group.add(this.stars);
    scene.add(this.group);


    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 3; // soft edges (PCF)
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfdfff, 0x4a5a2a, 0.9);
    scene.add(this.hemi);
  }

  get isNight(): boolean {
    return this.daylight < 0.25;
  }

  update(timeOfDay: number, camera: THREE.Camera, focus: THREE.Vector3, viewDistance: number) {
    this.timeOfDay = timeOfDay;
    const ang = (timeOfDay - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    this.sunDir.set(Math.cos(ang) * 0.8, elev, 0.45).normalize();
    this.daylight = smoothstep(-0.12, 0.22, elev);
    // Golden hour: a flatter sun (long soft shadows) all day; golden strongest when the sun is low.
    const golden = clamp(1 - smoothstep(0.2, 0.8, elev), LOOK.goldenAtNoon, 1) * this.daylight;
    if (elev > 0) this.sunDir.y = elev * LOOK.sunFlatten + LOOK.sunLift * smoothstep(0, 0.15, elev);
    this.sunDir.normalize();
    const dusk = clamp(1 - Math.abs(elev) / 0.35, 0, 1);

    const zenith = new THREE.Color().copy(NIGHT_ZENITH).lerp(DAY_ZENITH, this.daylight);
    const horizon = new THREE.Color().copy(NIGHT_HORIZON).lerp(DAY_HORIZON, this.daylight);
    zenith.lerp(LOOK.zenithGold, golden * 0.75);
    horizon.lerp(LOOK.horizonGold, golden * 0.8);
    zenith.lerp(DUSK_ZENITH, dusk * 0.5);
    horizon.lerp(DUSK_HORIZON, dusk * 0.7);
    this.domeMat.uniforms.uZenith.value.copy(zenith);
    this.domeMat.uniforms.uHorizon.value.copy(horizon);
    this.domeMat.uniforms.uSunDir.value.copy(this.sunDir);
    this.domeMat.uniforms.uTime.value = (this.domeMat.uniforms.uTime.value as number) + 1 / 60;
    this.domeMat.uniforms.uGold.value = clamp(golden * 0.95 + dusk * 0.3, 0, 1) * this.daylight;
    this.domeMat.uniforms.uCloud.value = this.daylight;
    (this.domeMat.uniforms.uGoldCol.value as THREE.Color).setRGB(1.0, 0.72, 0.4).lerp(DUSK_HORIZON, dusk * 0.4);
    this.domeMat.uniforms.uSunGlow.value.setRGB(1.0, 0.8, 0.55).multiplyScalar(smoothstep(-0.15, 0.05, elev));
    this.fog.color.copy(horizon);
    (this.stars.material as THREE.PointsMaterial).opacity = clamp(1 - this.daylight * 1.6, 0, 1);

    this.group.position.copy(camera.position);

    // Sun by day, a cool moon by night.
    const lightDir = new THREE.Vector3();
    if (elev > -0.05) {
      lightDir.copy(this.sunDir);
      this.sunColor.copy(LOOK.sunNoon).lerp(LOOK.sunGold, golden).lerp(new THREE.Color(1.0, 0.62, 0.35), dusk);
      this.sun.intensity = LOOK.sunIntensity * this.daylight;
    } else {
      lightDir.copy(this.sunDir).negate();
      lightDir.y = Math.abs(lightDir.y) + 0.3;
      lightDir.normalize();
      this.sunColor.copy(MOON_COLOR);
      this.sun.intensity = MOON_INTENSITY * smoothstep(-0.03, -0.2, elev);
    }
    this.sun.color.copy(this.sunColor);
    this.hemi.intensity = NIGHT_HEMI + (LOOK.hemiIntensity - NIGHT_HEMI) * this.daylight;
    this.hemi.color.copy(horizon).lerp(LOOK.hemiSky, 0.65);
    this.hemi.groundColor.copy(LOOK.hemiGround).multiplyScalar((NIGHT_GROUND + (1 - NIGHT_GROUND) * this.daylight) * 0.9);
    if (this.daylight < 0.5) this.hemi.color.lerp(NIGHT_HEMI_COLOR, 1 - this.daylight * 2);
    this.exposureScale = 1 + NIGHT_EXPOSURE_LIFT * (1 - this.daylight);

    // Shadow frustum follows what the camera is looking at.
    const extent = clamp(viewDistance * 1.1, 60, 520);
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    if (cam.right !== extent) {
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.near = 1;
      cam.far = 2000;
      cam.updateProjectionMatrix();
    }
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(lightDir, 700);

    this.fog.near = LOOK.fogNear0 + viewDistance * LOOK.fogNearK;
    this.fog.far = LOOK.fogFar0 + viewDistance * LOOK.fogFarK;
  }

  /**
   * Seasons and weather, applied on top of update() (call it right after, every frame): a colour
   * wash on the horizon and sun, light levels, storm gloom (0..1), a lightning flash (0..1) and fog reach.
   * Horizon and fog are changed together so the sea's edge still matches the sky.
   */
  applyWeather(w: SkyWeather) {
    const day = this.daylight;
    const u = this.domeMat.uniforms;
    const horizon = u.uHorizon.value as THREE.Color;
    const zenith = u.uZenith.value as THREE.Color;
    horizon.lerp(w.horizonTint, w.horizonAmt * day);
    zenith.lerp(w.zenithTint, w.zenithAmt * day);
    const g = w.gloom;
    if (g > 0.001) {
      horizon.lerp(STORM_HORIZON.clone().multiplyScalar(0.3 + 0.7 * day), g * 0.85);
      zenith.lerp(STORM_ZENITH.clone().multiplyScalar(0.25 + 0.75 * day), g * 0.9);
      (u.uSunGlow.value as THREE.Color).multiplyScalar(1 - g);
      (this.stars.material as THREE.PointsMaterial).opacity *= 1 - g;
    }
    if (w.flash > 0.001) {
      horizon.lerp(WHITE_FLASH, w.flash * 0.45);
      zenith.lerp(WHITE_FLASH, w.flash * 0.25);
    }
    this.fog.color.copy(horizon);

    this.sunColor.lerp(w.sunTint, w.sunAmt * day);
    this.sun.color.copy(this.sunColor);
    this.sun.intensity *= w.sunScale * (1 - 0.8 * g);
    this.hemi.intensity = this.hemi.intensity * w.hemiScale * (1 - 0.3 * g) + w.flash * 2.2 + w.nightLift * (1 - day);
    const fogScale = w.fogScale * (1 - 0.55 * g);
    this.fog.near = Math.max(30, this.fog.near * fogScale);
    this.fog.far = Math.max(200, this.fog.far * fogScale);
  }
}

export interface SkyWeather {
  horizonTint: THREE.Color;
  horizonAmt: number;
  zenithTint: THREE.Color;
  zenithAmt: number;
  sunTint: THREE.Color;
  sunAmt: number;
  sunScale: number;
  hemiScale: number;
  fogScale: number;
  /** Extra ambient light at night. */
  nightLift: number;
  /** 0..1 storm darkness. */
  gloom: number;
  /** 0..1 lightning flash. */
  flash: number;
}

const STORM_HORIZON = new THREE.Color(0x56606e);
const STORM_ZENITH = new THREE.Color(0x2a3140);
const WHITE_FLASH = new THREE.Color(0xdfe8ff);
