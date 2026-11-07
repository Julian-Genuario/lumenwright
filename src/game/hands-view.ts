// Draws the player's tracked hands as jointed maple mannequin hands with
// brass fingertips, built from the joint poses: one instanced mesh for joints, one for bones.
// Two draw calls for both hands.

import {
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import type { HandState } from './hands.ts';

const BONES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [0, 10], [10, 11], [11, 12], [12, 13], [13, 14],
  [0, 15], [15, 16], [16, 17], [17, 18], [18, 19],
  [0, 20], [20, 21], [21, 22], [22, 23], [23, 24],
  [5, 10], [10, 15], [15, 20], [1, 5],
];

const UP = new Vector3(0, 1, 0);

export class HandsView {
  readonly root = new Group();
  private joints: InstancedMesh;
  private bones: InstancedMesh;
  private m = new Matrix4();
  private a = new Vector3();
  private b = new Vector3();
  private s = new Vector3();
  private q = new Quaternion();
  private base = new Color(0xd8b48c);
  private tipBase = new Color(0xc9a25a);
  private hot = new Color(0xffc271);
  private c = new Color();

  constructor() {
    const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0.08 });
    this.joints = new InstancedMesh(new SphereGeometry(1, 10, 8), mat, 50);
    this.bones = new InstancedMesh(new CylinderGeometry(1, 1, 1, 10, 1, true), mat, BONES.length * 2);
    this.joints.frustumCulled = false;
    this.bones.frustumCulled = false;
    this.root.add(this.joints, this.bones);
    this.root.name = 'Hands';
    this.root.visible = false;
  }

  /** `glow` per hand: 0 idle, ~0.5 hovering something, 1 pinching/holding. */
  update(hands: HandState[], glow: number[]): void {
    let any = false;
    hands.forEach((h, hi) => {
      const jo = hi * 25;
      const bo = hi * BONES.length;
      const scale = h.tracked ? 1 : 0;
      if (h.tracked) any = true;
      this.c.copy(this.base).lerp(this.hot, glow[hi] ?? 0);
      for (let j = 0; j < 25; j++) {
        const r = Math.max(0.0042, h.radii[j] * (j === 0 ? 0.75 : 0.62)) * scale;
        this.a.set(h.joints[j * 3], h.joints[j * 3 + 1], h.joints[j * 3 + 2]);
        this.m.compose(this.a, this.q.identity(), this.s.set(r, r, r));
        this.joints.setMatrixAt(jo + j, this.m);
        // Fingertips carry the highlight so pinches and pokes read clearly.
        this.joints.setColorAt(jo + j, j === 4 || j === 9 ? this.c : j % 5 === 4 ? this.tipBase : this.base);
      }
      BONES.forEach(([i, k], n) => {
        this.a.set(h.joints[i * 3], h.joints[i * 3 + 1], h.joints[i * 3 + 2]);
        this.b.set(h.joints[k * 3], h.joints[k * 3 + 1], h.joints[k * 3 + 2]);
        const len = this.a.distanceTo(this.b);
        const palm = n >= 24;
        const r = (palm ? 0.007 : Math.max(0.0034, Math.min(h.radii[i], h.radii[k]) * 0.5)) * scale;
        this.b.sub(this.a);
        if (len > 1e-5) this.q.setFromUnitVectors(UP, this.b.normalize());
        this.a.addScaledVector(this.b, len / 2);
        this.m.compose(this.a, this.q, this.s.set(r, len * scale, r));
        this.bones.setMatrixAt(bo + n, this.m);
        this.bones.setColorAt(bo + n, this.base);
      });
    });
    this.joints.instanceMatrix.needsUpdate = true;
    this.bones.instanceMatrix.needsUpdate = true;
    if (this.joints.instanceColor) this.joints.instanceColor.needsUpdate = true;
    if (this.bones.instanceColor) this.bones.instanceColor.needsUpdate = true;
    this.root.visible = any;
  }
}
