// Turns the raw emulator take into the submission video:
// title card, gameplay with captions and the game's own audio, end card.
// Needs ffmpeg on PATH. Output: video/lumenwright-trailer.mp4
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const meta = JSON.parse(readFileSync('video/markers.json', 'utf8'));
const { videoPath, flashes } = meta;

// Find the two white sync flashes in the recording and map wall-clock
// seconds (as logged by the recorder) onto the video timeline.
mkdirSync('video/tmp', { recursive: true });
spawnSync(
  'ffmpeg',
  ['-v', 'error', '-y', '-i', videoPath, '-vf',
   'scale=64:36,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=video/tmp/yavg.txt', '-f', 'null', '-'],
  { stdio: 'inherit' },
);
const bright = [];
let pts = 0;
for (const line of readFileSync('video/tmp/yavg.txt', 'utf8').split(/\r?\n/)) {
  const m = line.match(/pts_time:([\d.]+)/);
  if (m) pts = Number(m[1]);
  const y = line.match(/YAVG=([\d.]+)/);
  // Skip the white page that shows while the app loads.
  if (y && Number(y[1]) > 200 && pts > 3) bright.push(pts);
}
const firstFlash = bright[0];
const lastFlash = bright.filter((t) => t > firstFlash + 10)[0];
if (firstFlash === undefined || lastFlash === undefined) throw new Error('sync flashes not found');
const scale = (lastFlash - firstFlash) / (flashes[1] - flashes[0]);
const toVideo = (wall) => firstFlash + (wall - flashes[0]) * scale;
console.log({ firstFlash, lastFlash, scale });
const markers = meta.markers.map((m) => ({ ...m, at: toVideo(m.at) }));
const audioOffset = meta.audioOffset === null ? 0 : toVideo(meta.audioOffset);
const FONT = 'C\\:/Windows/Fonts/georgia.ttf';
const FONT_I = 'C\\:/Windows/Fonts/georgiai.ttf';
const FONT_B = 'C\\:/Windows/Fonts/georgiab.ttf';
const CREAM = '0xF3E6C8';
const BRASS = '0xD4A85A';
const BG = '0x1A131F';
mkdirSync('video/tmp', { recursive: true });

const ff = (args) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
};
let n = 0;
const textFile = (s) => {
  const p = `video/tmp/t${n++}.txt`;
  writeFileSync(p, s);
  return p.replace(/\\/g, '/');
};
const fade = (a, b, f = 0.4) =>
  `if(lt(t,${a}),0,if(lt(t,${a + f}),(t-${a})/${f},if(lt(t,${b - f}),1,if(lt(t,${b}),(${b}-t)/${f},0))))`;

// 1. Gameplay with captions.
const start = markers.find((m) => m.name === 'start').at;
const end = markers.find((m) => m.name === 'end').at;
const caps = markers.filter((m) => m.caption);
const draw = caps.map((m, i) => {
  const a = m.at - start + 0.2;
  const next = markers[markers.indexOf(m) + 1];
  const b = Math.min(a + 5.2, (next ? next.at : end) - start - 0.1);
  const tf = textFile(m.caption);
  return (
    `drawtext=fontfile='${FONT_I}':textfile='${tf}':fontsize=34:fontcolor=${CREAM}:` +
    `x=(w-text_w)/2:y=h-92:box=1:boxcolor=0x1A131F@0.72:boxborderw=18:` +
    `alpha='${fade(a, b)}'`
  );
});
const vf = [`fps=30`, ...draw, `fade=t=in:st=0:d=0.6`, `fade=t=out:st=${(end - start - 0.8).toFixed(2)}:d=0.8`].join(',');
// Trim inside the filter graph so drawtext's t starts at 0 for the clip.
ff([
  '-i', videoPath,
  '-itsoffset', String(audioOffset ?? 0), '-i', 'video/audio.webm',
  '-filter_complex',
  `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,${vf}[v];` +
    `[1:a]apad,atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,volume=1.6,afade=t=in:st=0:d=0.5[a]`,
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
  'video/tmp/game.mp4',
]);

// 2. Title and end cards.
const card = (out, dur, lines) => {
  const d = lines
    .map(
      (l) =>
        `drawtext=fontfile='${l.font}':textfile='${textFile(l.text)}':fontsize=${l.size}:fontcolor=${l.color}:` +
        `x=(w-text_w)/2:y=${l.y}:alpha='${fade(l.in ?? 0.3, dur - 0.2, 0.6)}'`,
    )
    .join(',');
  ff([
    '-f', 'lavfi', '-i', `color=c=${BG}:s=1280x720:r=30:d=${dur}`,
    '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`,
    '-filter_complex', `[0:v]${d},drawbox=x=560:y=330:w=160:h=2:color=${BRASS}@0.8:t=fill[v]`,
    '-map', '[v]', '-map', '1:a', '-t', String(dur),
    '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
    out,
  ]);
};
card('video/tmp/title.mp4', 4.5, [
  { text: 'Lumenwright', font: FONT_B, size: 86, color: CREAM, y: 220 },
  { text: 'A seated, hands-only light puzzle for Meta Quest', font: FONT_I, size: 34, color: BRASS, y: 360, in: 0.8 },
  { text: 'Gameplay recorded in the Immersive Web Emulator with emulated hand tracking', font: FONT, size: 22, color: '0xB8A98C', y: 600, in: 1.2 },
]);
card('video/tmp/end.mp4', 6.5, [
  { text: 'Lumenwright', font: FONT_B, size: 72, color: CREAM, y: 210 },
  { text: 'Twelve boards. About ten minutes. Seated, hands only.', font: FONT_I, size: 32, color: BRASS, y: 360, in: 0.6 },
  { text: 'Play it in the Meta Quest browser', font: FONT, size: 28, color: CREAM, y: 450, in: 1.0 },
  { text: 'julian-genuario.github.io/lumenwright', font: FONT_B, size: 34, color: CREAM, y: 495, in: 1.0 },
  { text: 'Built with the Immersive Web SDK (WebXR)', font: FONT, size: 22, color: '0xB8A98C', y: 620, in: 1.4 },
]);

// 3. Join.
ff([
  '-i', 'video/tmp/title.mp4', '-i', 'video/tmp/game.mp4', '-i', 'video/tmp/end.mp4',
  '-filter_complex', '[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]',
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '160k',
  'video/lumenwright-trailer.mp4',
]);
console.log('wrote video/lumenwright-trailer.mp4');
