// Reads articulated hand joints straight from the WebXR frame and turns them
// into a pinch state, a pinch point, an index fingertip and a wrist rotation.
// Works the same on Quest hand tracking and in the IWER emulator.

import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';

export type Handedness = 'left' | 'right';

export interface HandState {
  handedness: Handedness;
  tracked: boolean;
  pinching: boolean;
  pinchStarted: boolean;
  pinchEnded: boolean;
  pinchPoint: Vector3;
  indexTip: Vector3;
  wrist: Quaternion;
  /** World-space joint positions, 25 joints x 3, in WebXR joint order. */
  joints: Float32Array;
  radii: Float32Array;
}

export const JOINT_NAMES: XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];

const PINCH_ON = 0.022; // meters between thumb and index tips
const PINCH_OFF = 0.038;

function makeHand(handedness: Handedness): HandState {
  return {
    handedness,
    tracked: false,
    pinching: false,
    pinchStarted: false,
    pinchEnded: false,
    pinchPoint: new Vector3(),
    indexTip: new Vector3(),
    wrist: new Quaternion(),
    joints: new Float32Array(75),
    radii: new Float32Array(25),
  };
}

export class HandTracker {
  readonly left = makeHand('left');
  readonly right = makeHand('right');
  readonly list: HandState[] = [this.left, this.right];

  private thumb = new Vector3();
  private m = new Matrix4();
  private originQ = new Quaternion();
  private tmpQ = new Quaternion();

  update(frame: XRFrame | null, space: XRReferenceSpace | null, origin: Matrix4): void {
    for (const h of this.list) {
      h.pinchStarted = false;
      h.pinchEnded = false;
      h.tracked = false;
    }
    if (!frame || !space) {
      for (const h of this.list) this.release(h);
      return;
    }
    this.originQ.setFromRotationMatrix(origin);

    for (const source of frame.session.inputSources) {
      const hand = source.hand;
      if (!hand || (source.handedness !== 'left' && source.handedness !== 'right')) continue;
      const h = source.handedness === 'left' ? this.left : this.right;
      const tip = hand.get('index-finger-tip');
      const thumb = hand.get('thumb-tip');
      const wrist = hand.get('wrist');
      if (!tip || !thumb || !wrist || !frame.getJointPose) continue;
      const pTip = frame.getJointPose(tip, space);
      const pThumb = frame.getJointPose(thumb, space);
      const pWrist = frame.getJointPose(wrist, space);
      if (!pTip || !pThumb || !pWrist) continue;

      h.tracked = true;
      const t = pTip.transform.position;
      const th = pThumb.transform.position;
      h.indexTip.set(t.x, t.y, t.z).applyMatrix4(origin);
      this.thumb.set(th.x, th.y, th.z).applyMatrix4(origin);
      const o = pWrist.transform.orientation;
      h.wrist.copy(this.originQ).multiply(this.tmpQ.set(o.x, o.y, o.z, o.w));

      this.fillJoints(frame, hand, space, origin, h);

      const dist = h.indexTip.distanceTo(this.thumb);
      const button = source.gamepad?.buttons[0]?.pressed ?? false;
      const was = h.pinching;
      const now = was ? dist < PINCH_OFF || (button && dist < PINCH_OFF * 1.5) : dist < PINCH_ON || button;
      h.pinching = now;
      h.pinchStarted = now && !was;
      h.pinchEnded = !now && was;
      h.pinchPoint.addVectors(h.indexTip, this.thumb).multiplyScalar(0.5);
    }

    for (const h of this.list) if (!h.tracked) this.release(h);
    void this.m;
  }

  private v = new Vector3();

  private fillJoints(frame: XRFrame, hand: XRHand, space: XRReferenceSpace, origin: Matrix4, h: HandState): void {
    for (let j = 0; j < 25; j++) {
      const js = hand.get(JOINT_NAMES[j]);
      const pose = js ? frame.getJointPose!(js, space) : undefined;
      if (!pose) continue;
      const p = pose.transform.position;
      this.v.set(p.x, p.y, p.z).applyMatrix4(origin);
      h.joints[j * 3] = this.v.x;
      h.joints[j * 3 + 1] = this.v.y;
      h.joints[j * 3 + 2] = this.v.z;
      h.radii[j] = pose.radius ?? 0.008;
    }
  }

  private release(h: HandState): void {
    if (h.pinching) {
      h.pinching = false;
      h.pinchEnded = true;
    }
  }
}

/** Signed rotation (radians) of a world-space delta rotation around world up. */
export function twistAroundUp(q: Quaternion): number {
  let a = 2 * Math.atan2(q.y, q.w);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}
