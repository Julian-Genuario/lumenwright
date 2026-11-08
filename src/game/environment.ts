// The rooftop observatory: a round plank deck, a brass rail, a telescope,
// low hills on the horizon, a moon and a slow field of stars.

import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Points,
  PointsMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import { PALETTE } from './palette.ts';
import { deckTexture } from './textures.ts';

export interface Environment {
  root: Group;
  stars: Points;
  lamp: PointLight;
  update(dt: number, time: number, glow: number): void;
}

export function buildEnvironment(): Environment {
  const root = new Group();
  root.name = 'Observatory';

  const brass = new MeshStandardMaterial({ color: PALETTE.brass, metalness: 0.85, roughness: 0.35 });
  const brassDark = new MeshStandardMaterial({ color: PALETTE.brassDark, metalness: 0.8, roughness: 0.5 });

  // Deck.
  const deck = new Mesh(
    new CircleGeometry(3.6, 64),
    new MeshStandardMaterial({ map: deckTexture(), roughness: 0.85, metalness: 0 }),
  );
  deck.rotation.x = -Math.PI / 2;
  root.add(deck);

  // Rail posts and top rail.
  const postGeo = new CylinderGeometry(0.018, 0.022, 1.0, 8);
  const posts = new InstancedMesh(postGeo, brassDark, 36);
  const m = new Matrix4();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    m.makeTranslation(Math.cos(a) * 3.3, 0.5, Math.sin(a) * 3.3);
    posts.setMatrixAt(i, m);
  }
  root.add(posts);
  const rail = new Mesh(new TorusGeometry(3.3, 0.02, 6, 96), brass);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = 1.0;
  root.add(rail);
  const rail2 = rail.clone();
  rail2.position.y = 0.55;
  rail2.scale.setScalar(1);
  root.add(rail2);

  // Telescope on a tripod, back left.
  const scope = new Group();
  const tube = new Mesh(new CylinderGeometry(0.11, 0.14, 1.9, 24), brass);
  tube.rotation.z = Math.PI / 2.9;
  tube.position.y = 1.5;
  scope.add(tube);
  for (const off of [-0.6, 0.0, 0.62]) {
    const ring = new Mesh(new TorusGeometry(0.135 - off * 0.012, 0.018, 8, 24), brassDark);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = off;
    tube.add(ring);
  }
  const apex = new Vector3(0, 1.45, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const footP = new Vector3(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
    const len = footP.distanceTo(apex);
    const leg = new Mesh(new CylinderGeometry(0.016, 0.022, len, 6), brassDark);
    leg.position.addVectors(footP, apex).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), apex.clone().sub(footP).normalize());
    scope.add(leg);
  }
  scope.position.set(-1.9, 0, -1.6);
  scope.rotation.y = 0.6;
  root.add(scope);

  // A small brass orrery stand on the right.
  const orrery = new Group();
  const stand = new Mesh(new CylinderGeometry(0.04, 0.12, 1.0, 16), brassDark);
  stand.position.y = 0.5;
  orrery.add(stand);
  const sun = new Mesh(new SphereGeometry(0.07, 24, 16), new MeshStandardMaterial({ color: 0xffc070, emissive: 0xff9a40, emissiveIntensity: 1.2 }));
  sun.position.y = 1.15;
  orrery.add(sun);
  const arms = new Group();
  arms.position.y = 1.15;
  const planetMats = [0x9fb6c9, 0xd48a5a, 0x8fa97a];
  planetMats.forEach((col, i) => {
    const r = 0.16 + i * 0.1;
    const ringM = new Mesh(new TorusGeometry(r, 0.004, 4, 64), brass);
    ringM.rotation.x = Math.PI / 2;
    arms.add(ringM);
    const p = new Mesh(new SphereGeometry(0.022 + i * 0.006, 16, 12), new MeshStandardMaterial({ color: col, roughness: 0.6 }));
    const pivot = new Group();
    p.position.x = r;
    pivot.add(p);
    pivot.rotation.y = i * 2.1;
    pivot.userData.speed = 0.4 / (i + 1);
    arms.add(pivot);
  });
  orrery.add(arms);
  orrery.position.set(1.8, 0, -2.0);
  orrery.scale.setScalar(0.85);
  root.add(orrery);

  // Hills on the horizon: a ring of low jagged silhouettes.
  const hillGeo = new BufferGeometry();
  const pos: number[] = [];
  const N = 120;
  const R = 60;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const heights: number[] = [];
  for (let i = 0; i <= N; i++) heights.push(1.2 + rnd() * 2.2 + Math.sin(i * 0.31) * 1.4 + Math.sin(i * 0.07) * 1.5);
  heights[N] = heights[0];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const x0 = Math.cos(a0) * R, z0 = Math.sin(a0) * R;
    const x1 = Math.cos(a1) * R, z1 = Math.sin(a1) * R;
    pos.push(x0, -1, z0, x1, -1, z1, x0, heights[i], z0);
    pos.push(x1, -1, z1, x1, heights[i + 1], z1, x0, heights[i], z0);
  }
  hillGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const hills = new Mesh(hillGeo, new MeshBasicMaterial({ color: 0x2b2036, side: 2, fog: false }));
  root.add(hills);

  // Moon.
  const moon = new Mesh(new SphereGeometry(2.2, 32, 16), new MeshBasicMaterial({ color: PALETTE.moon }));
  moon.position.set(-38, 26, -55);
  root.add(moon);
  const moonHalo = new Mesh(
    new SphereGeometry(3.4, 32, 16),
    new MeshBasicMaterial({ color: 0xf4d9b0, transparent: true, opacity: 0.08, blending: AdditiveBlending, depthWrite: false }),
  );
  moonHalo.position.copy(moon.position);
  root.add(moonHalo);

  // Stars in the upper sky.
  const starGeo = new BufferGeometry();
  const sp: number[] = [];
  const sc: number[] = [];
  const col = new Color();
  for (let i = 0; i < 700; i++) {
    const u = rnd();
    const v = 0.12 + rnd() * 0.88; // keep them above the horizon glow
    const theta = u * Math.PI * 2;
    const phi = Math.acos(1 - v);
    const r = 80;
    sp.push(Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r, Math.sin(phi) * Math.sin(theta) * r);
    col.setHSL(0.1 + rnd() * 0.5, 0.3, 0.6 + rnd() * 0.4);
    const fade = Math.min(1, (Math.cos(phi) - 0.1) * 2.5);
    sc.push(col.r * fade, col.g * fade, col.b * fade);
  }
  starGeo.setAttribute('position', new Float32BufferAttribute(sp, 3));
  starGeo.setAttribute('color', new Float32BufferAttribute(sc, 3));
  const stars = new Points(
    starGeo,
    new PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
  );
  root.add(stars);

  // Lighting: dusk hemisphere, cool moonlight, a warm lamp by the table.
  const hemi = new HemisphereLight(0x8a7aa8, 0x2a1a14, 0.9);
  root.add(hemi);
  const moonLight = new DirectionalLight(0xbfc8ff, 0.5);
  moonLight.position.set(-3, 5, -4);
  root.add(moonLight);
  const lamp = new PointLight(0xffb469, 2.2, 4, 1.6);
  lamp.position.set(0.5, 1.6, -0.2);
  root.add(lamp);

  return {
    root,
    stars,
    lamp,
    update(dt, time, glow) {
      stars.rotation.y += dt * 0.004;
      (stars.material as PointsMaterial).opacity = 0.75 + glow * 0.25;
      arms.children.forEach((c) => {
        if (c.userData.speed) c.rotation.y += dt * c.userData.speed * (1 + glow * 4);
      });
      lamp.intensity = 2.0 + Math.sin(time * 2.3) * 0.06 + Math.sin(time * 5.1) * 0.03 + glow * 0.8;
    },
  };
}
