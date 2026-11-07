// All sound is synthesized at runtime with the Web Audio API. No sample files.

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private wet!: GainNode;
  private humGain!: GainNode;
  private humTarget = 0;
  private out: AudioNode | null = null;
  muted = false;

  /** Call from a user gesture (click, XR session start). Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) this.build();
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private build(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.out = comp;

    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(comp);

    // Small generated room reverb.
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.32;
    this.wet.connect(conv);
    conv.connect(this.master);

    // Beam hum: two soft detuned tones through a lowpass.
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    this.humGain.connect(lp);
    lp.connect(this.master);
    for (const [f, type] of [
      [110, 'sine'],
      [164.8, 'sine'],
      [220.6, 'triangle'],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = type === 'triangle' ? 0.25 : 0.5;
      // Slow tremolo so the hum breathes.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.15 + f / 2000;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.18;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      lfo.start();
      o.connect(g);
      g.connect(this.humGain);
      o.start();
    }
  }

  private get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running' && !this.muted;
  }

  private tone(
    freq: number,
    opts: { type?: OscillatorType; attack?: number; decay?: number; gain?: number; wet?: number; when?: number; bend?: number } = {},
  ): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.when ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.bend) o.frequency.exponentialRampToValueAtTime(freq * opts.bend, t + (opts.decay ?? 0.3));
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.decay ?? 0.3));
    o.connect(g);
    g.connect(this.master);
    if (opts.wet) {
      const s = ctx.createGain();
      s.gain.value = opts.wet;
      g.connect(s);
      s.connect(this.wet);
    }
    o.start(t);
    o.stop(t + (opts.decay ?? 0.3) + 0.05);
  }

  private noiseClick(gain = 0.08, freq = 3200): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 0.02);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start();
  }

  private note(step: number, base = 392): number {
    const semis = PENTATONIC[((step % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length];
    return base * Math.pow(2, semis / 12);
  }

  /** A detent click as a mirror turns one notch. */
  tick(turn: number): void {
    this.noiseClick(0.06, 2600);
    this.tone(this.note(turn, 784), { type: 'triangle', decay: 0.09, gain: 0.05 });
  }

  slide(): void {
    this.noiseClick(0.08, 900);
    this.tone(180, { type: 'triangle', decay: 0.08, gain: 0.06, bend: 0.8 });
  }

  grab(): void {
    this.noiseClick(0.05, 1800);
    this.tone(523, { decay: 0.06, gain: 0.04 });
  }

  release(): void {
    this.noiseClick(0.04, 1400);
    this.tone(392, { decay: 0.06, gain: 0.03 });
  }

  /** A glass bell when one lantern catches the right light. */
  lantern(index: number): void {
    const f = this.note(index + 2, 523.25);
    this.tone(f, { decay: 1.6, gain: 0.12, wet: 0.8 });
    this.tone(f * 2.76, { decay: 0.7, gain: 0.03, wet: 0.8 });
    this.tone(f * 5.4, { decay: 0.3, gain: 0.012, wet: 0.5 });
  }

  lanternOff(): void {
    this.tone(196, { decay: 0.25, gain: 0.03, bend: 0.7 });
  }

  /** Board solved: a rising arpeggio with a low pad underneath. */
  solved(): void {
    const steps = [0, 2, 4, 5, 7];
    steps.forEach((s, i) => {
      const f = this.note(s, 392);
      this.tone(f, { decay: 2.2, gain: 0.11, wet: 1, when: i * 0.11 });
      this.tone(f * 2, { decay: 1.2, gain: 0.03, wet: 1, when: i * 0.11 });
    });
    this.tone(98, { type: 'triangle', attack: 0.3, decay: 3, gain: 0.08, wet: 0.6 });
    this.tone(147, { type: 'sine', attack: 0.4, decay: 3, gain: 0.06, wet: 0.6 });
  }

  finale(): void {
    [0, 4, 7, 9, 12, 16].forEach((s, i) => {
      this.tone(261.6 * Math.pow(2, s / 12), { decay: 3, gain: 0.09, wet: 1, when: i * 0.16 });
    });
  }

  press(): void {
    this.tone(150, { type: 'sine', decay: 0.12, gain: 0.18, bend: 0.5 });
    this.noiseClick(0.05, 700);
  }

  denied(): void {
    this.tone(220, { type: 'triangle', decay: 0.15, gain: 0.05, bend: 0.9 });
  }

  /** A copy of the final mix as a MediaStream, used by the trailer recorder. */
  captureStream(): MediaStream | null {
    this.unlock();
    if (!this.ctx || !this.out) return null;
    const dest = this.ctx.createMediaStreamDestination();
    this.out.connect(dest);
    return dest.stream;
  }

  /** Set the hum level from how much light is on the board (0..1). */
  setHum(level: number): void {
    this.humTarget = Math.max(0, Math.min(1, level));
  }

  update(dt: number): void {
    if (!this.ctx || !this.humGain) return;
    const cur = this.humGain.gain.value;
    const target = this.muted ? 0 : this.humTarget * 0.035;
    this.humGain.gain.value = cur + (target - cur) * Math.min(1, dt * 3);
  }
}
