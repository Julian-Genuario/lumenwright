// Game flow: loads boards, routes hand (or mouse) input to pieces and buttons,
// re-traces light when something moves, and runs the solve feedback.

import { Matrix4, Plane, Quaternion, Raycaster, Vector2, Vector3, type PerspectiveCamera, type Object3D } from '@iwsdk/core';
import { LEVELS } from './levels.ts';
import { clonePieces, isRotatable, mod8, trace, type Piece, type TraceResult } from './optics.ts';
import { HandTracker, twistAroundUp, type HandState } from './hands.ts';
import { Sound } from './audio.ts';
import { HandsView } from './hands-view.ts';
import { TableView, type ButtonId, type ButtonView } from './table-view.ts';
import { formatTime, loadProgress, saveProgress, unlockedUpTo, type Progress } from './progress.ts';

const GRAB_RADIUS = 0.045;
const HOVER_RADIUS = 0.06;
const TWIST_GAIN = 1.6;
const STEP = Math.PI / 8;

interface HandGrab {
  piece: number;
  startQ: Quaternion;
  startTurn: number;
}

interface MouseGrab {
  piece: number;
  startX: number;
  startTurn: number;
  moved: boolean;
}

export interface GameHost {
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  inXR(): boolean;
  xrFrame(): XRFrame | null;
  xrSpace(): XRReferenceSpace | null;
  origin(): Object3D;
  onLevelChange?(index: number, name: string): void;
}

export class Game {
  readonly view = new TableView();
  readonly sound = new Sound();
  readonly hands = new HandTracker();
  readonly handsView = new HandsView();
  private handGlow = [0, 0];
  readonly progress: Progress;

  levelIndex = 0;
  pieces: Piece[] = [];
  result!: TraceResult;
  solved = false;
  private solvedAt = 0;
  private finished = false;

  private grabs = new Map<HandState, HandGrab>();
  private pokeLatch = new Map<string, boolean>();
  private mouse: MouseGrab | null = null;
  private hoverPiece = -1;
  private recenterIn = -1;
  private wasXR = false;
  private elapsed = 0;

  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private tmpQ = new Quaternion();
  private originM = new Matrix4();
  private ray = new Raycaster();
  private ndc = new Vector2();
  private plane = new Plane();

  constructor(private host: GameHost) {
    this.progress = loadProgress(LEVELS.length);
    this.view.root.position.set(0, 0.86, -0.46);
    this.loadLevel(this.progress.current);
    this.bindMouse();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') this.pressButton('reset');
      if (e.key === 'n' || e.key === 'N') this.pressButton('next');
      if (e.key === 'm' || e.key === 'M') this.sound.muted = !this.sound.muted;
    });
  }

  // ------------------------------------------------------------------ levels

  loadLevel(index: number): void {
    this.levelIndex = (index + LEVELS.length) % LEVELS.length;
    const level = LEVELS[this.levelIndex];
    this.pieces = clonePieces(level.pieces);
    this.grabs.clear();
    this.mouse = null;
    this.solved = false;
    this.finished = false;
    this.view.build(level, this.pieces);
    this.progress.current = this.levelIndex;
    saveProgress(this.progress);
    this.retrace(true);
    this.refreshPlaque();
    this.refreshStuds();
    this.host.onLevelChange?.(this.levelIndex, level.name);
  }

  private refreshPlaque(): void {
    const level = LEVELS[this.levelIndex];
    const subtitle = `Board ${this.levelIndex + 1} of ${LEVELS.length}`;
    if (this.finished) {
      const best = this.progress.bestRunSeconds;
      this.view.setPlaque({
        subtitle: 'All lanterns lit',
        title: 'The Observatory is awake',
        body: `Run time ${formatTime(this.progress.runSeconds)}${best !== null ? ` · best ${formatTime(best)}` : ''}. Press Next to start over.`,
      });
    } else if (this.solved) {
      this.view.setPlaque({ subtitle, title: level.name, body: 'Every lantern is lit. Press Next.' });
    } else {
      this.view.setPlaque({ subtitle, title: level.name, body: level.hint });
    }
  }

  private refreshStuds(): void {
    const open = unlockedUpTo(this.progress);
    for (const s of this.view.studs) {
      s.state =
        s.index === this.levelIndex ? 'current' : this.progress.done[s.index] ? 'done' : s.index <= open ? 'open' : 'locked';
    }
    for (const b of this.view.buttons) {
      if (b.id === 'next') {
        b.enabled = this.solved || this.progress.done[this.levelIndex];
        b.pulse = this.solved;
      }
    }
  }

  private retrace(initial = false): void {
    const prevLit = this.result?.litTargets ?? new Set<number>();
    this.result = trace(LEVELS[this.levelIndex], this.pieces);
    this.view.setBeams(this.result.segments);
    this.sound.setHum(Math.min(1, this.result.segments.length / 8));

    let k = 0;
    this.view.pieces.forEach((v, i) => {
      if (v.piece.kind !== 'target') return;
      const lit = this.result.litTargets.has(i);
      v.litTarget = lit ? 1 : 0;
      v.receivedColor = this.result.received.get(i) ?? 0;
      if (!initial && lit && !prevLit.has(i)) this.sound.lantern(k);
      if (!initial && !lit && prevLit.has(i)) this.sound.lanternOff();
      k++;
    });

    if (this.result.solved && !this.solved && !initial) this.onSolved();
  }

  private onSolved(): void {
    this.solved = true;
    this.solvedAt = this.elapsed;
    this.progress.done[this.levelIndex] = true;
    // Release anything held so the moment is clean.
    for (const [, g] of this.grabs) this.view.pieces[g.piece].held = false;
    this.grabs.clear();
    if (this.levelIndex === LEVELS.length - 1 && this.progress.done.every(Boolean)) {
      this.finished = true;
      const t = this.progress.runSeconds;
      if (this.progress.bestRunSeconds === null || t < this.progress.bestRunSeconds) this.progress.bestRunSeconds = t;
      setTimeout(() => this.sound.finale(), 700);
    }
    saveProgress(this.progress);
    this.sound.solved();
    this.view.burst();
    this.refreshPlaque();
    this.refreshStuds();
  }

  pressButton(id: ButtonId): void {
    const b = this.view.buttons.find((x) => x.id === id);
    if (b) b.press = 1;
    if (id === 'reset') {
      this.sound.press();
      this.loadLevel(this.levelIndex);
    } else if (id === 'next') {
      if (!(this.solved || this.progress.done[this.levelIndex])) {
        this.sound.denied();
        return;
      }
      this.sound.press();
      if (this.finished) {
        this.progress.done.fill(false);
        this.progress.runSeconds = 0;
        this.loadLevel(0);
      } else {
        this.loadLevel(this.levelIndex + 1);
      }
    } else if (id === 'recenter') {
      this.sound.press();
      this.recenter();
    }
  }

  private pressStud(index: number): void {
    if (index > unlockedUpTo(this.progress)) {
      this.sound.denied();
      return;
    }
    this.sound.press();
    this.loadLevel(index);
  }

  // ------------------------------------------------------------------ piece manipulation

  private setTurn(i: number, turn: number): void {
    const v = this.view.pieces[i];
    if (v.turn === turn) return;
    v.turn = turn;
    this.pieces[i].m = mod8(turn);
    this.sound.tick(turn);
    this.retrace();
  }

  private slideTo(i: number, local: Vector3): void {
    const p = this.pieces[i];
    if (!p.rail || p.rail.length < 2) return;
    const c = this.view.localToCell(local);
    let best: readonly [number, number] | null = null;
    let bestD = Infinity;
    for (const cell of p.rail) {
      const occupied = this.pieces.some((q, j) => j !== i && q.x === cell[0] && q.y === cell[1]);
      if (occupied) continue;
      const d = (cell[0] - c.x) ** 2 + (cell[1] - c.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = cell;
      }
    }
    if (best && (best[0] !== p.x || best[1] !== p.y)) {
      p.x = best[0];
      p.y = best[1];
      this.sound.slide();
      this.retrace();
    }
  }

  private nearestPiece(point: Vector3, radius: number): number {
    let best = -1;
    let bestD = radius;
    this.view.pieces.forEach((v, i) => {
      if (!v.interactive) return;
      // Distance to a short vertical segment through the piece, so a pinch
      // anywhere from the base to the knob counts.
      this.view.gripPoint(i, this.tmp);
      const dy = Math.max(0, Math.abs(point.y - (this.tmp.y - 0.015)) - 0.02);
      const dx = point.x - this.tmp.x;
      const dz = point.z - this.tmp.z;
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // ------------------------------------------------------------------ hands

  private updateHands(): void {
    const origin = this.host.origin();
    origin.updateMatrixWorld();
    this.originM.copy(origin.matrixWorld);
    this.hands.update(this.host.xrFrame(), this.host.xrSpace(), this.originM);

    for (const v of this.view.pieces) v.hover = 0;

    this.hands.list.forEach((h, hi) => {
      let glow = 0;
      const grab = this.grabs.get(h);
      if (h.pinchStarted && !this.solved) {
        const i = this.nearestPiece(h.pinchPoint, GRAB_RADIUS);
        const takenByOther = [...this.grabs.values()].some((g) => g.piece === i);
        if (i >= 0 && !takenByOther) {
          this.grabs.set(h, { piece: i, startQ: h.wrist.clone(), startTurn: this.view.pieces[i].turn });
          this.view.pieces[i].held = true;
          this.sound.grab();
        }
      } else if (grab && h.pinching) {
        const v = this.view.pieces[grab.piece];
        if (isRotatable(v.piece)) {
          this.tmpQ.copy(h.wrist).multiply(this.tmp2Q.copy(grab.startQ).invert());
          const twist = twistAroundUp(this.tmpQ);
          this.setTurn(grab.piece, grab.startTurn + Math.round((twist * TWIST_GAIN) / STEP));
        }
        if (v.piece.rail) {
          this.tmp.copy(h.pinchPoint);
          this.view.root.worldToLocal(this.tmp);
          this.slideTo(grab.piece, this.tmp);
        }
      }
      if (grab && (h.pinchEnded || !h.pinching)) {
        const v = this.view.pieces[grab.piece];
        if (v) v.held = false;
        this.grabs.delete(h);
        this.sound.release();
      }
      if (h.tracked && !this.grabs.has(h)) {
        const i = this.nearestPiece(h.pinchPoint, HOVER_RADIUS);
        if (i >= 0) {
          this.view.pieces[i].hover = 1;
          glow = 0.5;
        }
      }
      if (this.grabs.has(h)) glow = 1;
      if (h.tracked && this.pokeCheck(h)) glow = Math.max(glow, 0.6);
      this.handGlow[hi] += (glow - this.handGlow[hi]) * 0.25;
    });
    this.handsView.update(this.hands.list, this.handGlow);
  }

  private tmp2Q = new Quaternion();

  /** Returns true when the fingertip is close to any pokeable control. */
  private pokeCheck(h: HandState): boolean {
    const tip = h.indexTip;
    let near = false;
    for (const b of this.view.buttons) {
      this.view.buttonTopWorld(b, this.tmp);
      near = this.poke(`${h.handedness}:${b.id}`, tip, this.tmp, b.radius + 0.004, () => this.pressButton(b.id), b) || near;
    }
    for (const s of this.view.studs) {
      s.mesh.getWorldPosition(this.tmp);
      this.tmp.y += 0.004;
      near = this.poke(`${h.handedness}:stud${s.index}`, tip, this.tmp, 0.012, () => this.pressStud(s.index)) || near;
    }
    return near;
  }

  private poke(key: string, tip: Vector3, top: Vector3, radius: number, fire: () => void, b?: ButtonView): boolean {
    const dx = tip.x - top.x;
    const dz = tip.z - top.z;
    const horiz = Math.sqrt(dx * dx + dz * dz);
    const depth = top.y - tip.y; // positive when the fingertip is below the top
    const latched = this.pokeLatch.get(key) ?? false;
    const near = horiz < radius + 0.02 && depth > -0.05 && depth < 0.04;
    if (!latched && horiz < radius && depth > 0.002 && depth < 0.035) {
      this.pokeLatch.set(key, true);
      if (b) b.press = 1;
      fire();
    } else if (latched && (horiz > radius + 0.01 || depth < -0.015)) {
      this.pokeLatch.set(key, false);
    }
    return near;
  }

  recenter(): void {
    const cam = this.host.camera;
    cam.getWorldPosition(this.tmp);
    cam.getWorldDirection(this.tmp2);
    this.tmp2.y = 0;
    if (this.tmp2.lengthSq() < 1e-6) this.tmp2.set(0, 0, -1);
    this.tmp2.normalize();
    const root = this.view.root;
    root.position.set(this.tmp.x + this.tmp2.x * 0.42, Math.max(0.45, this.tmp.y - 0.34), this.tmp.z + this.tmp2.z * 0.42);
    root.rotation.set(0, Math.atan2(-this.tmp2.x, -this.tmp2.z), 0);
  }

  // ------------------------------------------------------------------ mouse fallback

  private bindMouse(): void {
    const el = this.host.canvas;
    const pick = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.ray.setFromCamera(this.ndc, this.host.camera);
      return this.ray.intersectObjects(this.view.pickables, false)[0];
    };
    el.addEventListener('pointerdown', (e) => {
      this.sound.unlock();
      if (this.host.inXR()) return;
      const hit = pick(e);
      if (!hit) return;
      const ud = hit.object.userData;
      if (ud.buttonId) this.pressButton(ud.buttonId as ButtonId);
      else if (typeof ud.studIndex === 'number') this.pressStud(ud.studIndex);
      else if (typeof ud.pieceIndex === 'number' && !this.solved) {
        this.mouse = { piece: ud.pieceIndex, startX: e.clientX, startTurn: this.view.pieces[ud.pieceIndex].turn, moved: false };
        this.view.pieces[ud.pieceIndex].held = true;
        this.sound.grab();
        el.setPointerCapture(e.pointerId);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (this.host.inXR()) return;
      if (!this.mouse) {
        const hit = pick(e);
        this.hoverPiece = hit && typeof hit.object.userData.pieceIndex === 'number' ? hit.object.userData.pieceIndex : -1;
        el.style.cursor = hit ? 'pointer' : 'default';
        return;
      }
      const g = this.mouse;
      const dx = e.clientX - g.startX;
      if (Math.abs(dx) > 5) g.moved = true;
      const v = this.view.pieces[g.piece];
      if (v.piece.rail && v.piece.rail.length > 1) {
        const r = el.getBoundingClientRect();
        this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        this.ray.setFromCamera(this.ndc, this.host.camera);
        const root = this.view.root;
        root.updateMatrixWorld();
        this.tmp.set(0, 1, 0).applyQuaternion(root.getWorldQuaternion(this.tmpQ));
        this.plane.setFromNormalAndCoplanarPoint(this.tmp, root.getWorldPosition(this.tmp2));
        if (this.ray.ray.intersectPlane(this.plane, this.tmp)) {
          root.worldToLocal(this.tmp);
          this.slideTo(g.piece, this.tmp);
          g.moved = true;
        }
      } else if (isRotatable(v.piece)) {
        this.setTurn(g.piece, g.startTurn - Math.round(dx / 26));
      }
    });
    const end = () => {
      if (!this.mouse) return;
      const g = this.mouse;
      const v = this.view.pieces[g.piece];
      if (!g.moved && isRotatable(v.piece)) this.setTurn(g.piece, v.turn + 1);
      v.held = false;
      this.mouse = null;
      this.sound.release();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.host.inXR() || this.hoverPiece < 0 || this.solved) return;
        const v = this.view.pieces[this.hoverPiece];
        if (!isRotatable(v.piece)) return;
        e.preventDefault();
        this.setTurn(this.hoverPiece, v.turn + (e.deltaY > 0 ? -1 : 1));
      },
      { passive: false },
    );
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, time: number, paused: boolean): void {
    dt = Math.min(dt, 0.1);
    const xr = this.host.inXR();
    if (xr && !this.wasXR) {
      this.sound.unlock();
      this.recenterIn = 0.5;
    }
    if (!xr && this.wasXR) {
      this.view.root.position.set(0, 0.86, -0.46);
      this.view.root.rotation.set(0, 0, 0);
      for (const [, g] of this.grabs) this.view.pieces[g.piece].held = false;
      this.grabs.clear();
    }
    this.wasXR = xr;
    if (this.recenterIn > 0) {
      this.recenterIn -= dt;
      if (this.recenterIn <= 0) this.recenter();
    }

    if (!paused) {
      this.elapsed += dt;
      if (!this.solved && !this.finished) this.progress.runSeconds += dt;
    }

    if (xr) this.updateHands();
    else {
      this.handsView.root.visible = false;
      for (const v of this.view.pieces) v.hover = 0;
      if (this.hoverPiece >= 0 && this.view.pieces[this.hoverPiece]) this.view.pieces[this.hoverPiece].hover = 1;
    }

    // Save the run timer now and then so a quick exit keeps it.
    if (Math.floor(this.elapsed / 5) !== Math.floor((this.elapsed - dt) / 5)) saveProgress(this.progress);

    void this.solvedAt;
    this.view.update(dt, time, this.solved);
    this.sound.update(dt);
  }
}
