// Everything on the workbench: the table, the current board and its pieces,
// the light beams, the level plaque, push buttons and the level studs.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
  type Object3D,
} from '@iwsdk/core';
import { isInteractive, isRotatable, type Level, type Piece, type Segment } from './optics.ts';
import { PALETTE, beamColor } from './palette.ts';
import { boardTexture, buttonLabel, drawPlaque, plaqueTexture, woodTexture, type PlaqueText } from './textures.ts';

export const CELL = 0.065;
export const BEAM_Y = 0.022;
const STEP_ANGLE = Math.PI / 8; // 22.5 degrees
const MAX_BEAMS = 64;

export interface PieceView {
  group: Group;
  spin: Group;
  piece: Piece;
  interactive: boolean;
  ring?: MeshBasicMaterial;
  core?: MeshBasicMaterial;
  glass?: MeshStandardMaterial;
  angle: number; // displayed spin angle
  turn: number; // logical turn count (unbounded integer; m = turn mod 8)
  hover: number;
  held: boolean;
  lit: number; // 0..1 displayed lantern brightness
  litTarget: number;
  receivedColor: number;
  pop: number; // 0..1 entrance animation
  delay: number;
  pos: Vector3; // displayed local position (eases toward cell)
}

export type ButtonId = 'reset' | 'next' | 'recenter';

export interface ButtonView {
  id: ButtonId;
  group: Group;
  cap: Mesh;
  capMat: MeshStandardMaterial;
  label: Mesh;
  press: number;
  enabled: boolean;
  pulse: boolean;
  radius: number;
}

export interface StudView {
  index: number;
  mesh: Mesh;
  mat: MeshStandardMaterial;
  state: 'locked' | 'open' | 'done' | 'current';
}

interface BeamView {
  group: Group;
  core: Mesh;
  halo: Mesh;
  coreMat: MeshBasicMaterial;
  haloMat: MeshBasicMaterial;
  length: number;
}

const UP = new Vector3(0, 1, 0);

export class TableView {
  readonly root = new Group();
  readonly boardRoot = new Group();
  private readonly beamRoot = new Group();
  readonly pieces: PieceView[] = [];
  readonly buttons: ButtonView[] = [];
  readonly studs: StudView[] = [];
  readonly pickables: Object3D[] = [];
  level!: Level;
  glow = 0;
  private staticPickables = 0;

  private beams: BeamView[] = [];
  private plaqueTex: CanvasTexture;
  private plaqueMesh: Mesh;
  private rimMat: MeshStandardMaterial;
  private boardMat: MeshStandardMaterial;
  private boardMesh: Mesh | null = null;
  private motes: Points;
  private moteVel: Float32Array;
  private moteLife: Float32Array;
  private tmpV = new Vector3();
  private tmpV2 = new Vector3();
  private tmpQ = new Quaternion();

  // Shared materials and geometry.
  private mats = {
    brass: new MeshStandardMaterial({ color: PALETTE.brass, metalness: 0.9, roughness: 0.32 }),
    brassDark: new MeshStandardMaterial({ color: PALETTE.brassDark, metalness: 0.85, roughness: 0.45 }),
    brassBright: new MeshStandardMaterial({ color: PALETTE.brassBright, metalness: 0.95, roughness: 0.22 }),
    silver: new MeshStandardMaterial({ color: PALETTE.silver, metalness: 1.0, roughness: 0.06 }),
    slate: new MeshStandardMaterial({ color: PALETTE.slate, metalness: 0.1, roughness: 0.75 }),
    frosted: new MeshStandardMaterial({
      color: 0xe6eef5,
      metalness: 0.2,
      roughness: 0.25,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
    lanternGlass: new MeshStandardMaterial({
      color: 0xf4ead8,
      metalness: 0.1,
      roughness: 0.1,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  };
  private geo = {
    disc: new CylinderGeometry(0.025, 0.027, 0.006, 32),
    pane: new BoxGeometry(0.048, 0.034, 0.0035),
    post: new CylinderGeometry(0.0022, 0.0022, 0.036, 6),
    knobStem: new CylinderGeometry(0.0025, 0.0025, 0.014, 6),
    knob: new SphereGeometry(0.0075, 16, 12),
    ring: new TorusGeometry(0.031, 0.0018, 6, 40),
    prism: new CylinderGeometry(0.017, 0.017, 0.04, 6),
    lanternBase: new CylinderGeometry(0.019, 0.022, 0.01, 24),
    lanternCap: new CylinderGeometry(0.008, 0.014, 0.006, 16),
    lanternGlass: new SphereGeometry(0.016, 24, 16),
    lanternCore: new SphereGeometry(0.0085, 16, 12),
    colorRing: new TorusGeometry(0.02, 0.0026, 6, 32),
    barrel: new CylinderGeometry(0.011, 0.013, 0.042, 20),
    lens: new CylinderGeometry(0.009, 0.009, 0.003, 20),
    block: new BoxGeometry(0.05, 0.044, 0.05),
    blockCap: new BoxGeometry(0.054, 0.004, 0.054),
    beam: new CylinderGeometry(1, 1, 1, 8, 1, true),
    pick: new CylinderGeometry(0.03, 0.03, 0.07, 10),
  };

  constructor() {
    this.root.name = 'Workbench';
    this.root.add(this.boardRoot);
    this.root.add(this.beamRoot);

    // Table slab, apron and a single pedestal down to the deck.
    const wood = new MeshStandardMaterial({ map: woodTexture(11, '#4f3020', 512, 1), roughness: 0.62, metalness: 0.02 });
    const top = new Mesh(new BoxGeometry(0.86, 0.03, 0.66), wood);
    top.position.set(0, -0.027, 0.02);
    this.root.add(top);
    const edge = new Mesh(new BoxGeometry(0.87, 0.006, 0.67), this.mats.brassDark);
    edge.position.set(0, -0.041, 0.02);
    this.root.add(edge);
    const pedestal = new Mesh(new CylinderGeometry(0.05, 0.07, 2.0, 16), this.mats.brassDark);
    pedestal.position.set(0, -1.04, 0);
    this.root.add(pedestal);
    const foot = new Mesh(new CylinderGeometry(0.06, 0.06, 0.02, 16), this.mats.brass);
    foot.position.set(0, -0.05, 0);
    this.root.add(foot);

    this.boardMat = new MeshStandardMaterial({ roughness: 0.7, metalness: 0.02 });
    this.rimMat = new MeshStandardMaterial({
      color: PALETTE.brass,
      metalness: 0.9,
      roughness: 0.3,
      emissive: new Color(0xffb15a),
      emissiveIntensity: 0,
    });

    // Plaque behind the board, leaning back toward the player's eyes.
    this.plaqueTex = plaqueTexture();
    this.plaqueMesh = new Mesh(
      new PlaneGeometry(0.36, 0.135),
      new MeshBasicMaterial({ map: this.plaqueTex, transparent: true }),
    );
    this.plaqueMesh.position.set(0, 0.075, -0.255);
    this.plaqueMesh.rotation.x = -0.33;
    this.root.add(this.plaqueMesh);
    const plaqueStand = new Mesh(new BoxGeometry(0.3, 0.012, 0.03), this.mats.brassDark);
    plaqueStand.position.set(0, 0.004, -0.262);
    this.root.add(plaqueStand);

    this.buildButtons();
    this.buildStuds();
    this.staticPickables = this.pickables.length;
    this.buildBeams();

    // Motes that rise from lanterns when a board is solved.
    const N = 90;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('color', new Float32BufferAttribute(new Float32Array(N * 3), 3));
    this.motes = new Points(
      g,
      new PointsMaterial({ size: 0.005, map: softDot(), vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    this.motes.frustumCulled = false;
    this.moteVel = new Float32Array(N * 3);
    this.moteLife = new Float32Array(N);
    this.root.add(this.motes);
  }

  // ---------------------------------------------------------------- layout

  cellToLocal(x: number, y: number, out: Vector3): Vector3 {
    return out.set((x - (this.level.w - 1) / 2) * CELL, 0, (y - (this.level.h - 1) / 2) * CELL);
  }

  /** Local rig coordinates to fractional grid coordinates. */
  localToCell(v: Vector3): { x: number; y: number } {
    return {
      x: v.x / CELL + (this.level.w - 1) / 2,
      y: v.z / CELL + (this.level.h - 1) / 2,
    };
  }

  // ---------------------------------------------------------------- board

  build(level: Level, pieces: Piece[]): void {
    this.level = level;
    // Dispose previous level content.
    for (const child of [...this.boardRoot.children]) {
      this.boardRoot.remove(child);
      disposeTree(child, this.sharedSet());
    }
    this.pieces.length = 0;
    // Keep the buttons and studs (added once in the constructor), drop old pieces.
    this.pickables.length = this.staticPickables;

    const bw = level.w * CELL + CELL * 0.8;
    const bh = level.h * CELL + CELL * 0.8;
    this.boardMat.map?.dispose();
    this.boardMat.map = boardTexture(level.w, level.h);
    this.boardMat.needsUpdate = true;
    this.boardMesh = new Mesh(new BoxGeometry(bw, 0.012, bh), [
      this.rimMat,
      this.rimMat,
      this.boardMat,
      this.rimMat,
      this.rimMat,
      this.rimMat,
    ] as Material[]);
    this.boardMesh.position.y = -0.006;
    this.boardRoot.add(this.boardMesh);

    // Rails first so pieces sit on top.
    for (const p of pieces) if (p.rail && p.rail.length > 1) this.buildRail(p);

    pieces.forEach((p, i) => {
      const view = this.buildPiece(p);
      view.delay = 0.05 + i * 0.045;
      this.pieces.push(view);
      this.boardRoot.add(view.group);
      if (view.interactive) {
        const pick = new Mesh(this.geo.pick, new MeshBasicMaterial({ visible: false }));
        pick.position.y = 0.035;
        pick.userData.pieceIndex = i;
        view.group.add(pick);
        this.pickables.push(pick);
      }
    });
    this.setBeams([]);
  }

  private sharedSet(): Set<unknown> {
    const s = new Set<unknown>(Object.values(this.mats));
    Object.values(this.geo).forEach((g) => s.add(g));
    s.add(this.rimMat);
    s.add(this.boardMat);
    return s;
  }

  private buildRail(p: Piece): void {
    const cells = p.rail!;
    const a = new Vector3();
    const b = new Vector3();
    for (let i = 0; i < cells.length; i++) {
      this.cellToLocal(cells[i][0], cells[i][1], a);
      const stud = new Mesh(new CylinderGeometry(0.006, 0.006, 0.004, 12), this.mats.brassBright);
      stud.position.set(a.x, 0.002, a.z);
      this.boardRoot.add(stud);
      if (i + 1 < cells.length) {
        this.cellToLocal(cells[i + 1][0], cells[i + 1][1], b);
        const len = a.distanceTo(b);
        for (const side of [-1, 1]) {
          const bar = new Mesh(new BoxGeometry(len, 0.003, 0.003), this.mats.brass);
          const dir = this.tmpV.subVectors(b, a).normalize();
          const perp = this.tmpV2.set(-dir.z, 0, dir.x).multiplyScalar(0.012 * side);
          bar.position.set((a.x + b.x) / 2 + perp.x, 0.0015, (a.z + b.z) / 2 + perp.z);
          bar.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
          this.boardRoot.add(bar);
        }
      }
    }
  }

  private buildPiece(p: Piece): PieceView {
    const group = new Group();
    const spin = new Group();
    group.add(spin);
    const view: PieceView = {
      group,
      spin,
      piece: p,
      interactive: isInteractive(p),
      angle: 0,
      turn: p.m ?? 0,
      hover: 0,
      held: false,
      lit: 0,
      litTarget: 0,
      receivedColor: 0,
      pop: 0,
      delay: 0,
      pos: new Vector3(),
    };
    this.cellToLocal(p.x, p.y, view.pos);
    group.position.copy(view.pos);

    switch (p.kind) {
      case 'mirror':
      case 'splitter':
      case 'dichroic': {
        const disc = new Mesh(this.geo.disc, this.mats.brass);
        disc.position.y = 0.003;
        group.add(disc);
        let paneMat: MeshStandardMaterial;
        if (p.kind === 'mirror') paneMat = this.mats.silver;
        else if (p.kind === 'splitter') paneMat = this.mats.frosted;
        else {
          paneMat = new MeshStandardMaterial({
            color: beamColor(p.color ?? 7),
            emissive: beamColor(p.color ?? 7),
            emissiveIntensity: 0.25,
            metalness: 0.3,
            roughness: 0.15,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
          });
          view.glass = paneMat;
        }
        const pane = new Mesh(this.geo.pane, paneMat);
        pane.position.y = BEAM_Y;
        spin.add(pane);
        if (p.kind === 'mirror') {
          // Dark backing so the silver reads as a mirror from the side.
          const back = new Mesh(new BoxGeometry(0.048, 0.034, 0.0012), this.mats.brassDark);
          back.position.set(0, BEAM_Y, -0.0024);
          spin.add(back);
        }
        for (const sx of [-0.025, 0.025]) {
          const post = new Mesh(this.geo.post, this.mats.brass);
          post.position.set(sx, BEAM_Y, 0);
          spin.add(post);
        }
        const bar = new Mesh(new BoxGeometry(0.054, 0.003, 0.005), this.mats.brass);
        bar.position.y = BEAM_Y + 0.018;
        spin.add(bar);
        if (isRotatable(p)) {
          const stem = new Mesh(this.geo.knobStem, this.mats.brass);
          stem.position.y = BEAM_Y + 0.025;
          spin.add(stem);
          const knob = new Mesh(this.geo.knob, this.mats.brassBright);
          knob.position.y = BEAM_Y + 0.034;
          spin.add(knob);
        } else {
          // Fixed angle: a square nut instead of a round knob.
          const nut = new Mesh(new BoxGeometry(0.01, 0.008, 0.01), this.mats.brassDark);
          nut.position.y = BEAM_Y + 0.024;
          spin.add(nut);
        }
        view.angle = (p.m ?? 0) * STEP_ANGLE;
        spin.rotation.y = view.angle;
        break;
      }
      case 'filter': {
        const base = new Mesh(this.geo.lanternBase, this.mats.brassDark);
        base.position.y = 0.005;
        group.add(base);
        const mat = new MeshStandardMaterial({
          color: beamColor(p.color ?? 7),
          emissive: beamColor(p.color ?? 7),
          emissiveIntensity: 0.35,
          metalness: 0.2,
          roughness: 0.2,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
        });
        view.glass = mat;
        const prism = new Mesh(this.geo.prism, mat);
        prism.position.y = BEAM_Y + 0.004;
        spin.add(prism);
        const cap = new Mesh(new CylinderGeometry(0.018, 0.018, 0.003, 6), this.mats.brass);
        cap.position.y = BEAM_Y + 0.025;
        spin.add(cap);
        spin.rotation.y = Math.PI / 6;
        break;
      }
      case 'emitter': {
        const base = new Mesh(new BoxGeometry(0.04, 0.012, 0.034), this.mats.brassDark);
        base.position.y = 0.006;
        group.add(base);
        const barrel = new Mesh(this.geo.barrel, this.mats.brass);
        barrel.rotation.z = Math.PI / 2;
        barrel.position.set(-0.002, BEAM_Y, 0);
        spin.add(barrel);
        const lensMat = new MeshBasicMaterial({ color: beamColor(p.color ?? 7) });
        const lens = new Mesh(this.geo.lens, lensMat);
        lens.rotation.z = Math.PI / 2;
        lens.position.set(0.0205, BEAM_Y, 0);
        spin.add(lens);
        const fin = new Mesh(new BoxGeometry(0.03, 0.002, 0.026), this.mats.brassBright);
        fin.position.set(-0.006, BEAM_Y + 0.013, 0);
        spin.add(fin);
        spin.rotation.y = (p.dir ?? 0) * (Math.PI / 4);
        break;
      }
      case 'target': {
        const base = new Mesh(this.geo.lanternBase, this.mats.brass);
        base.position.y = 0.005;
        group.add(base);
        const ringMat = new MeshBasicMaterial({ color: beamColor(p.color ?? 7) });
        const ring = new Mesh(this.geo.colorRing, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.011;
        group.add(ring);
        for (let k = 0; k < 4; k++) {
          const post = new Mesh(this.geo.post, this.mats.brassDark);
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
          post.position.set(Math.cos(a) * 0.016, BEAM_Y + 0.004, Math.sin(a) * 0.016);
          group.add(post);
        }
        const glass = new Mesh(this.geo.lanternGlass, this.mats.lanternGlass);
        glass.position.y = BEAM_Y + 0.002;
        group.add(glass);
        const coreMat = new MeshBasicMaterial({ color: 0x2a2230, transparent: true, opacity: 1 });
        const core = new Mesh(this.geo.lanternCore, coreMat);
        core.position.y = BEAM_Y + 0.002;
        group.add(core);
        view.core = coreMat;
        const halo = new Mesh(
          new SphereGeometry(0.03, 16, 12),
          new MeshBasicMaterial({ color: beamColor(p.color ?? 7), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
        );
        halo.position.y = BEAM_Y + 0.002;
        halo.name = 'halo';
        group.add(halo);
        const cap = new Mesh(this.geo.lanternCap, this.mats.brass);
        cap.position.y = BEAM_Y + 0.022;
        group.add(cap);
        break;
      }
      case 'wall': {
        const block = new Mesh(this.geo.block, this.mats.slate);
        block.position.y = 0.022;
        group.add(block);
        const cap = new Mesh(this.geo.blockCap, this.mats.brassDark);
        cap.position.y = 0.046;
        group.add(cap);
        break;
      }
    }

    if (view.interactive) {
      const ringMat = new MeshBasicMaterial({ color: 0xffc77a, transparent: true, opacity: 0.25, depthWrite: false });
      const ring = new Mesh(this.geo.ring, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.0065;
      group.add(ring);
      view.ring = ringMat;
    }
    group.scale.setScalar(0.001);
    return view;
  }

  /** Grip point for a piece in world space (its knob, or its top). */
  gripPoint(i: number, out: Vector3): Vector3 {
    const v = this.pieces[i];
    out.set(v.pos.x, BEAM_Y + 0.03, v.pos.z);
    return this.boardRoot.localToWorld(out);
  }

  // ---------------------------------------------------------------- beams

  private buildBeams(): void {
    for (let i = 0; i < MAX_BEAMS; i++) {
      const coreMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false });
      const haloMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false });
      const core = new Mesh(this.geo.beam, coreMat);
      const halo = new Mesh(this.geo.beam, haloMat);
      core.scale.set(0.0022, 1, 0.0022);
      halo.scale.set(0.0075, 1, 0.0075);
      const g = new Group();
      g.add(core, halo);
      g.visible = false;
      this.beamRoot.add(g);
      this.beams.push({ group: g, core, halo, coreMat, haloMat, length: 0 });
    }
  }

  setBeams(segments: Segment[]): void {
    const a = this.tmpV;
    const b = this.tmpV2;
    for (let i = 0; i < this.beams.length; i++) {
      const beam = this.beams[i];
      const s = segments[i];
      if (!s) {
        beam.group.visible = false;
        continue;
      }
      this.cellToLocal(s.ax, s.ay, a);
      this.cellToLocal(s.bx, s.by, b);
      const len = a.distanceTo(b);
      beam.length = len;
      beam.group.visible = len > 0.0001;
      beam.group.position.set((a.x + b.x) / 2, BEAM_Y, (a.z + b.z) / 2);
      const dir = b.sub(a).normalize();
      beam.group.quaternion.copy(this.tmpQ.setFromUnitVectors(UP, dir));
      beam.core.scale.y = len;
      beam.halo.scale.y = len;
      const col = beamColor(s.color);
      beam.coreMat.color.setHex(col);
      beam.haloMat.color.setHex(col);
    }
  }

  // ---------------------------------------------------------------- plaque, buttons, studs

  setPlaque(text: PlaqueText): void {
    drawPlaque(this.plaqueTex, text);
  }

  private buildButtons(): void {
    const defs: Array<[ButtonId, string, string, number]> = [
      ['reset', 'Reset', '↺', 0.205],
      ['next', 'Next', '→', 0.29],
      ['recenter', 'Center', '⌖', -0.33],
    ];
    for (const [id, label, glyph, x] of defs) {
      const group = new Group();
      group.position.set(x, 0, 0.255);
      const radius = id === 'recenter' ? 0.016 : 0.022;
      const base = new Mesh(new CylinderGeometry(radius + 0.006, radius + 0.008, 0.008, 28), this.mats.brassDark);
      base.position.y = 0.004;
      group.add(base);
      const capMat = new MeshStandardMaterial({
        color: PALETTE.brass,
        metalness: 0.85,
        roughness: 0.3,
        emissive: new Color(0xffa850),
        emissiveIntensity: 0,
      });
      const cap = new Mesh(new CylinderGeometry(radius, radius, 0.012, 28), capMat);
      cap.position.y = 0.014;
      group.add(cap);
      const labelMesh = new Mesh(
        new PlaneGeometry(radius * 1.8, radius * 1.8),
        new MeshBasicMaterial({ map: buttonLabel(label, glyph), transparent: true }),
      );
      labelMesh.rotation.x = -Math.PI / 2;
      labelMesh.position.y = 0.0205;
      group.add(labelMesh);
      cap.userData.buttonId = id;
      this.pickables.push(cap);
      this.root.add(group);
      this.buttons.push({ id, group, cap, capMat, label: labelMesh, press: 0, enabled: true, pulse: false, radius });
    }
  }

  buttonTopWorld(b: ButtonView, out: Vector3): Vector3 {
    out.set(0, 0.02 - b.press * 0.008, 0);
    return b.group.localToWorld(out);
  }

  private buildStuds(): void {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const seat = new Mesh(new CylinderGeometry(0.009, 0.01, 0.005, 16), this.mats.brassDark);
      const x = -0.24 + i * 0.03;
      seat.position.set(x, 0.0025, 0.258);
      this.root.add(seat);
      const mat = new MeshStandardMaterial({
        color: 0x3a2f3c,
        emissive: new Color(0xffc070),
        emissiveIntensity: 0,
        metalness: 0.2,
        roughness: 0.25,
      });
      const gem = new Mesh(new SphereGeometry(0.0072, 16, 12), mat);
      gem.position.set(x, 0.009, 0.258);
      gem.userData.studIndex = i;
      this.root.add(gem);
      this.pickables.push(gem);
      this.studs.push({ index: i, mesh: gem, mat, state: 'locked' });
    }
  }

  // ---------------------------------------------------------------- feedback

  burst(): void {
    const pos = this.motes.geometry.getAttribute('position') as Float32BufferAttribute;
    const col = this.motes.geometry.getAttribute('color') as Float32BufferAttribute;
    const targets = this.pieces.filter((p) => p.piece.kind === 'target');
    const c = new Color();
    for (let i = 0; i < this.moteLife.length; i++) {
      const t = targets[i % Math.max(1, targets.length)];
      if (!t) break;
      pos.setXYZ(i, t.pos.x + (Math.random() - 0.5) * 0.02, BEAM_Y, t.pos.z + (Math.random() - 0.5) * 0.02);
      this.moteVel[i * 3] = (Math.random() - 0.5) * 0.05;
      this.moteVel[i * 3 + 1] = 0.05 + Math.random() * 0.12;
      this.moteVel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
      this.moteLife[i] = 1 + Math.random() * 1.2;
      c.setHex(beamColor(t.piece.color ?? 7));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  update(dt: number, time: number, solved: boolean): void {
    const k = 1 - Math.exp(-dt * 14);
    this.glow += ((solved ? 1 : 0) - this.glow) * (1 - Math.exp(-dt * 3));
    this.rimMat.emissiveIntensity = this.glow * 0.55 + Math.sin(time * 3) * 0.04 * this.glow;

    for (const v of this.pieces) {
      // Entrance pop with a little overshoot.
      if (v.pop < 1) {
        v.delay -= dt;
        if (v.delay <= 0) v.pop = Math.min(1, v.pop + dt * 3.2);
        const t = v.pop;
        const s = t <= 0 ? 0.001 : 1 + 1.7 * Math.pow(t - 1, 3) + 0.7 * Math.pow(t - 1, 2);
        v.group.scale.setScalar(Math.max(0.001, s));
      }
      // Ease toward the logical cell and angle.
      this.cellToLocal(v.piece.x, v.piece.y, this.tmpV);
      v.pos.lerp(this.tmpV, k);
      v.group.position.set(v.pos.x, (v.held ? 0.006 : 0) + v.hover * 0.002, v.pos.z);
      if (isRotatable(v.piece)) {
        const target = v.turn * STEP_ANGLE;
        v.angle += (target - v.angle) * k;
        v.spin.rotation.y = v.angle;
      }
      if (v.ring) {
        const want = v.held ? 1 : v.hover > 0.5 ? 0.75 : 0.22 + Math.sin(time * 2 + v.pos.x * 30) * 0.06;
        v.ring.opacity += (want - v.ring.opacity) * k;
      }
      if (v.core) {
        v.lit += (v.litTarget - v.lit) * (1 - Math.exp(-dt * 6));
        const got = v.receivedColor;
        if (v.litTarget > 0.5) {
          v.core.color.setHex(beamColor(v.piece.color ?? 7));
        } else if (got) {
          // Wrong mix: a dim, uneasy flicker of what it is getting.
          v.core.color.setHex(beamColor(got)).multiplyScalar(0.35 + Math.sin(time * 17) * 0.1);
        } else {
          v.core.color.setHex(0x2a2230);
        }
        const halo = v.group.getObjectByName('halo') as Mesh | undefined;
        if (halo) {
          const m = halo.material as MeshBasicMaterial;
          m.opacity = v.lit * (0.35 + Math.sin(time * 4 + v.pos.x * 40) * 0.05) + this.glow * 0.15;
          halo.scale.setScalar(1 + v.lit * 0.25 + this.glow * 0.3);
        }
      }
    }

    for (const b of this.beams) {
      if (!b.group.visible) continue;
      b.haloMat.opacity = 0.2 + Math.sin(time * 9 + b.length * 50) * 0.03 + this.glow * 0.1;
    }

    for (const b of this.buttons) {
      b.cap.position.y = 0.014 - b.press * 0.008;
      b.label.position.y = 0.0205 - b.press * 0.008;
      b.press = Math.max(0, b.press - dt * 6);
      const e = b.pulse ? 0.45 + Math.sin(time * 4) * 0.35 : 0;
      b.capMat.emissiveIntensity += (e - b.capMat.emissiveIntensity) * k;
      b.capMat.color.setHex(b.enabled ? PALETTE.brass : 0x5a4a3a);
    }

    for (const s of this.studs) {
      const e =
        s.state === 'current' ? 0.9 + Math.sin(time * 3) * 0.3 : s.state === 'done' ? 0.75 : s.state === 'open' ? 0.2 : 0;
      s.mat.emissiveIntensity += (e - s.mat.emissiveIntensity) * k;
      s.mat.color.setHex(s.state === 'locked' ? 0x2e2630 : 0xe0b070);
    }

    // Motes.
    const pos = this.motes.geometry.getAttribute('position') as Float32BufferAttribute;
    const col = this.motes.geometry.getAttribute('color') as Float32BufferAttribute;
    let any = false;
    for (let i = 0; i < this.moteLife.length; i++) {
      if (this.moteLife[i] <= 0) {
        if (pos.getY(i) !== -10) pos.setY(i, -10);
        continue;
      }
      any = true;
      this.moteLife[i] -= dt;
      pos.setXYZ(
        i,
        pos.getX(i) + this.moteVel[i * 3] * dt,
        pos.getY(i) + this.moteVel[i * 3 + 1] * dt,
        pos.getZ(i) + this.moteVel[i * 3 + 2] * dt,
      );
      this.moteVel[i * 3 + 1] *= 0.995;
      const f = Math.max(0, Math.min(1, this.moteLife[i]));
      col.setXYZ(i, col.getX(i) * (0.98 + 0.02 * f), col.getY(i) * (0.98 + 0.02 * f), col.getZ(i) * (0.98 + 0.02 * f));
    }
    if (any) {
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
  }
}

function softDot(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

function disposeTree(obj: Object3D, keep: Set<unknown>): void {
  obj.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.geometry && !keep.has(mesh.geometry)) mesh.geometry.dispose();
    const m = mesh.material as Material | Material[] | undefined;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) if (!keep.has(mm)) mm.dispose();
  });
}
