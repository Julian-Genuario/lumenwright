// In-page helpers for driving the IWER emulated hands. Injected by the
// recording and hand-test scripts; not part of the shipped game.
(() => {
  const D = window.IWER_DEVICE;
  const lw = window.lumenwright;
  const V = lw.world.camera.position.constructor;
  const Q = lw.world.camera.quaternion.constructor;
  const M = lw.world.camera.matrix.constructor;
  const E = lw.world.camera.rotation.constructor;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = { left: null, right: null };

  function wristFrom(fingers, palm) {
    const z = new V(...fingers).normalize().negate();
    let y = new V(...palm).normalize().negate();
    const x = new V().crossVectors(y, z).normalize();
    y = new V().crossVectors(z, x).normalize();
    const m = new M().makeBasis(x, y, z);
    return new Q().setFromRotationMatrix(m);
  }
  const graspRot = (hand) => wristFrom([0.2 * (hand === "left" ? -1 : 1), -0.25, -1], [0, -1, -0.25]);

  function apply(hand) {
    const s = state[hand];
    D.hands[hand].setPin({
      anchor: s.anchor,
      target: [s.pos.x, s.pos.y, s.pos.z],
      wristRotation: [s.rot.x, s.rot.y, s.rot.z, s.rot.w],
    });
  }

  async function tween(dur, fn) {
    const t0 = performance.now();
    for (;;) {
      const t = Math.min(1, (performance.now() - t0) / dur);
      fn(ease(t));
      if (t >= 1) break;
      await frame();
    }
  }

  const api = {
    async setup(head = [0, 1.15, 0.05], pitch = -0.6) {
      D.primaryInputMode = 'hand';
      D.stereoEnabled = false;
      const hq = new Q().setFromEuler(new E(pitch, 0, 0, 'YXZ'));
      await D.remote.dispatch('set_transform', {
        device: 'headset',
        position: { x: head[0], y: head[1], z: head[2] },
        orientation: { x: hq.x, y: hq.y, z: hq.z, w: hq.w },
      });
      for (const hand of ['left', 'right']) {
        const sx = hand === 'left' ? -1 : 1;
        state[hand] = {
          anchor: 'grasp',
          pos: new V(0.2 * sx, head[1] - 0.5, head[2] - 0.2),
          rot: graspRot(hand),
        };
        apply(hand);
      }
    },
    look(pitch, yaw = 0, dur = 800) {
      const d = D.quaternion;
      const from = new Q(d.x, d.y, d.z, d.w);
      const to = new Q().setFromEuler(new E(pitch, yaw, 0, 'YXZ'));
      const q = new Q();
      return tween(dur, (t) => {
        q.slerpQuaternions(from, to, t);
        D.remote.dispatch('set_transform', { device: 'headset', orientation: { x: q.x, y: q.y, z: q.z, w: q.w } });
      });
    },
    rest(hand, dur = 600) {
      const sx = hand === 'left' ? -1 : 1;
      return api.moveTo(hand, [0.22 * sx, D.position.y - 0.5, D.position.z - 0.15], dur);
    },
    pieceGrip(i) {
      const v = new V();
      lw.game.view.gripPoint(i, v);
      return [v.x, v.y + 0.004, v.z];
    },
    buttonTop(id) {
      const b = lw.game.view.buttons.find((x) => x.id === id);
      const v = new V();
      lw.game.view.buttonTopWorld(b, v);
      return [v.x, v.y, v.z];
    },
    studTop(i) {
      const v = new V();
      lw.game.view.studs[i].mesh.getWorldPosition(v);
      return [v.x, v.y + 0.006, v.z];
    },
    async moveTo(hand, target, dur = 700) {
      const s = state[hand];
      const from = s.pos.clone();
      const to = new V(...target);
      await tween(dur, (t) => {
        s.pos.lerpVectors(from, to, t);
        apply(hand);
      });
    },
    async pinch(hand, value, dur = 180) {
      const h = D.hands[hand];
      const from = h.pinchValue;
      await tween(dur, (t) => h.updatePinchValue(from + (value - from) * t));
    },
    async twist(hand, angle, dur = 600, mode = 'yaw') {
      const s = state[hand];
      const from = s.rot.clone();
      // 'yaw' turns the hand around the vertical; 'roll' turns the forearm
      // like a key, around the horizontal finger direction.
      const axis = new V(0, 1, 0);
      if (mode === 'roll') {
        axis.set(0, 0, -1).applyQuaternion(from);
        axis.y = 0;
        axis.normalize();
      }
      await tween(dur, (t) => {
        s.rot.copy(new Q().setFromAxisAngle(axis, angle * t).multiply(from));
        apply(hand);
      });
    },
    async point(hand) {
      const h = D.hands[hand];
      if (h.poseIds.includes('point')) h.poseId = 'point';
      state[hand].anchor = 'index-tip';
      state[hand].rot = wristFrom([hand === 'left' ? 0.1 : -0.1, -0.85, -0.5], [0, -0.5, -1]);
      apply(hand);
      await wait(60);
    },
    async grasp(hand) {
      D.hands[hand].poseId = 'default';
      state[hand].anchor = 'grasp';
      state[hand].rot = graspRot(hand);
      apply(hand);
      await wait(60);
    },
    async press(hand, top, dur = 450) {
      await api.point(hand);
      await api.moveTo(hand, [top[0], top[1] + 0.05, top[2]], dur);
      await api.moveTo(hand, [top[0], top[1] - 0.012, top[2]], 220);
      await wait(140);
      await api.moveTo(hand, [top[0], top[1] + 0.06, top[2]], 260);
      await api.grasp(hand);
    },
    /** Grab piece i, twist by `steps` notches (22.5 degrees each), release. */
    async turnPiece(hand, i, steps, opts = {}) {
      const g = api.pieceGrip(i);
      await api.grasp(hand);
      await api.moveTo(hand, [g[0], g[1] + 0.05, g[2] + 0.03], opts.approach ?? 650);
      await api.moveTo(hand, g, 300);
      await api.pinch(hand, 1);
      await wait(120);
      const per = Math.PI / 8 / 1.6;
      // Twist in chunks of at most 3 notches, re-gripping like a real wrist.
      let left = steps;
      while (left !== 0) {
        const chunk = Math.max(-3, Math.min(3, left));
        await api.twist(hand, chunk * per, 260 * Math.abs(chunk) + 150);
        left -= chunk;
        if (left !== 0) {
          await api.pinch(hand, 0, 120);
          await api.twist(hand, -chunk * per, 220);
          await api.pinch(hand, 1, 120);
        }
      }
      await wait(150);
      await api.pinch(hand, 0);
      await api.moveTo(hand, [g[0], g[1] + 0.03, g[2] + 0.06], 300);
      state[hand].rot = graspRot(hand);
      apply(hand);
    },
    /** Grab a rail piece and drag it to grid cell (cx, cy). */
    async slidePiece(hand, i, cx, cy) {
      const g = api.pieceGrip(i);
      await api.grasp(hand);
      await api.moveTo(hand, [g[0], g[1] + 0.05, g[2] + 0.03], 600);
      await api.moveTo(hand, g, 300);
      await api.pinch(hand, 1);
      await wait(120);
      const view = lw.game.view;
      const local = new V();
      view.cellToLocal(cx, cy, local);
      const world = view.root.localToWorld(local.clone());
      await api.moveTo(hand, [world.x, g[1], world.z], 900);
      await wait(150);
      await api.pinch(hand, 0);
      await api.moveTo(hand, [world.x, g[1] + 0.03, world.z + 0.06], 300);
    },
    wait,
  };
  window.drive = api;
})();
