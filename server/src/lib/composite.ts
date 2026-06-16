export const COMPOSITE_WIDTH = 1280;
export const COMPOSITE_HEIGHT = 720;
// 60 fps halves the per-frame quantisation when aligning independently-captured
// cameras (≈8 ms instead of ≈16 ms), at the cost of more CPU and larger files.
export const COMPOSITE_FPS = 60;

/**
 * Builds ffmpeg arguments (excluding the binary itself) that concatenate the
 * given input videos in order into one output. Each segment may come from a
 * different camera with a different resolution, so every input is scaled and
 * letterboxed to a common frame and a uniform fps/sample rate before the concat
 * filter joins them — that's what makes mismatched segments stitch cleanly.
 */
/**
 * ffmpeg args that add a silent stereo audio track to a video-only segment,
 * keeping the original video untouched. `-shortest` ties the silence to the
 * video's length. Output stays a .webm so the concat step treats it like any
 * other segment.
 */
export function buildSilentAudioArgs(input: string, output: string): string[] {
  return [
    '-i',
    input,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'libopus',
    '-shortest',
    '-y',
    output,
  ];
}

/**
 * ffmpeg args that replace a segment's audio with the audio from a separate
 * recording (the room's audio source), laying that sound under the camera video.
 *
 * Without alignment (`skip` 0 on both) the video is copied untouched and the
 * output stays a fast .webm — the previous behaviour. When a front-trim is given
 * (sync-tone/duration alignment), each input is fast-seeked and the video is
 * re-encoded with reset timestamps so the trim is frame-accurate; the caller
 * then writes to an .mkv (h264). `-shortest` trims the small tail difference.
 */
export function buildMuxVideoOverAudioArgs(
  video: TimedInput,
  audio: TimedInput,
  output: string,
): string[] {
  const vSkip = video.skip ?? 0;
  const aSkip = audio.skip ?? 0;

  if (vSkip === 0 && aSkip === 0) {
    // No trim needed: copy the video untouched (fast) and lay the audio under it.
    return [
      '-i', video.input,
      '-i', audio.input,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'libopus',
      '-shortest', '-y', output,
    ];
  }

  return [
    '-i', video.input,
    '-i', audio.input,
    '-filter_complex',
    `[0:v]${videoAlignChain(video.skip)}[v];` +
      `[1:a]${audioAlignChain(audio.skip)}[a]`,
    '-map', '[v]',
    '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'libopus',
    '-shortest', '-y', output,
  ];
}

/**
 * ffmpeg args that add a black video track to an audio-only segment, keeping the
 * original audio untouched. `-shortest` ties the black frame to the audio's
 * length.
 */
export function buildBlackVideoArgs(input: string, output: string): string[] {
  return [
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${COMPOSITE_WIDTH}x${COMPOSITE_HEIGHT}:r=${COMPOSITE_FPS}`,
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'libvpx',
    '-c:a',
    'copy',
    '-shortest',
    '-y',
    output,
  ];
}

/** Margin (px) between a picture-in-picture inset and the frame edges. */
const PIP_MARGIN = 24;

/** A picture-in-picture inset: which camera file, the corner, its width as a
 * fraction of the frame, and how many seconds to trim from the front so it lines
 * up with the other (independently started) layers. */
export interface PipInput {
  input: string;
  position: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  scale: number;
  skip?: number;
}

/** A timed input: the file plus seconds to trim from its front for alignment. */
export interface TimedInput {
  input: string;
  skip?: number;
}

/**
 * Video filter prefix that zeroes the timeline and, when a `skip` is given, trims
 * the first `skip` seconds off the front. Order matters: we first reset to zero
 * and force a constant frame rate (fps) to get a clean timeline, then trim on
 * that timeline, and finally rebase the kept part to zero.
 */
function videoAlignChain(skip?: number): string {
  const base = `setpts=PTS-STARTPTS,fps=${COMPOSITE_FPS}`;
  return skip && skip > 0
    ? `${base},trim=start=${skip.toFixed(3)},setpts=PTS-STARTPTS`
    : base;
}

/** Audio counterpart of videoAlignChain: resample to a continuous timeline first
 * (the audio analogue of `fps`) so `atrim` actually cuts, then rebase to zero. */
function audioAlignChain(skip?: number): string {
  const base = `asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0`;
  return skip && skip > 0
    ? `${base},atrim=start=${skip.toFixed(3)},asetpts=PTS-STARTPTS`
    : base;
}

/** overlay x:y expression placing an inset in the given corner with a margin. */
function pipOverlayXY(position: PipInput['position']): string {
  const m = PIP_MARGIN;
  switch (position) {
    case 'top-left':
      return `x=${m}:y=${m}`;
    case 'top-right':
      return `x=main_w-overlay_w-${m}:y=${m}`;
    case 'bottom-left':
      return `x=${m}:y=main_h-overlay_h-${m}`;
    case 'bottom-right':
    default:
      return `x=main_w-overlay_w-${m}:y=main_h-overlay_h-${m}`;
  }
}

/**
 * ffmpeg args that composite one main camera (full frame) with picture-in-
 * picture insets in the corners, optionally laying a separate audio source's
 * sound under it.
 *
 * Sync is the tricky part on two levels:
 *  1. Rate/timestamps — the cameras are independent variable frame-rate streams,
 *     so every layer is reset to a zero start (`setpts`) and forced to one
 *     constant frame rate (`fps`); otherwise an inset drifts progressively ahead.
 *  2. Start offset — the devices begin capturing at slightly different moments
 *     (camera/encoder warm-up), so their t=0 are different real instants. The
 *     caller passes a per-input `skip` that trims each source to the start of the
 *     common overlapping window (done with a `trim` filter, not a `-ss` seek,
 *     which is unreliable on these index-less recordings), so the layers line up.
 * `audio` is the bed (its own trim); when null a silent track is synthesised.
 * Output is Matroska (h264/opus); the concat step re-encodes it like any segment.
 */
export function buildPipCompositeArgs(
  main: TimedInput,
  pips: PipInput[],
  audio: TimedInput | null,
  output: string,
): string[] {
  const args: string[] = ['-i', main.input];
  for (const pip of pips) args.push('-i', pip.input);
  if (audio) {
    args.push('-i', audio.input);
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  }

  const audioIdx = pips.length + 1;

  // Trim each video layer to the common window. This is now frame-accurate
  // because the input files were hardened to CFR MP4s in Stage 1.
  const filters: string[] = [`[0:v]${videoAlignChain(main.skip)},${SCALE_PAD}[base]`];
  let last = 'base';
  pips.forEach((pip, i) => {
    const inputIdx = i + 1; // main is input 0
    const width = Math.max(2, Math.round(COMPOSITE_WIDTH * pip.scale));
    filters.push(
      `[${inputIdx}:v]${videoAlignChain(pip.skip)},scale=${width}:-2,setsar=1,fps=${COMPOSITE_FPS}[p${i}]`,
    );
    const outLabel = i === pips.length - 1 ? 'v' : `t${i}`;
    filters.push(`[${last}][p${i}]overlay=${pipOverlayXY(pip.position)}:shortest=1[${outLabel}]`);
    last = outLabel;
  });
  const videoLabel = pips.length > 0 ? 'v' : 'base';

  // Audio bed: already trimmed via -ss if present.
  filters.push(
    `[${audioIdx}:a]${audio ? audioAlignChain(audio.skip) : 'asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0'}[a]`,
  );

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    `[${videoLabel}]`,
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'libopus',
    '-shortest',
    '-y',
    output,
  );
  return args;
}

/** Escapes a filesystem path for use inside an ffmpeg filter argument. */
function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:');
}

/**
 * Escapes watermark text for drawtext's single-quoted `text='…'` value. Inside
 * the quotes a colon/percent is literal (we also pass expansion=none), so only
 * backslashes, the quote itself and newlines need handling. A literal quote is
 * written as '\'' (close, escaped quote, reopen).
 */
function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/[\r\n]+/g, ' ');
}

const SCALE_PAD =
  `scale=${COMPOSITE_WIDTH}:${COMPOSITE_HEIGHT}:force_original_aspect_ratio=decrease,` +
  `pad=${COMPOSITE_WIDTH}:${COMPOSITE_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${COMPOSITE_FPS}`;

/**
 * Re-encodes an arbitrary intro/outro clip into a canonical h264/aac mp4 with a
 * guaranteed video and audio stream (synthesising a black frame or silence when
 * absent), so it concatenates cleanly with the lesson segments.
 */
export function buildCanonicalExternalArgs(
  input: string,
  output: string,
  hasVideo: boolean,
  hasAudio: boolean,
): string[] {
  const encode = [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    '-shortest',
    '-y',
    output,
  ];

  if (hasVideo && hasAudio) {
    return ['-i', input, '-vf', SCALE_PAD, ...encode];
  }
  if (hasVideo && !hasAudio) {
    return [
      '-i',
      input,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-filter_complex',
      `[0:v]${SCALE_PAD}[v]`,
      '-map',
      '[v]',
      '-map',
      '1:a',
      ...encode,
    ];
  }
  // audio only: a black frame for the audio's duration
  return [
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${COMPOSITE_WIDTH}x${COMPOSITE_HEIGHT}:r=${COMPOSITE_FPS}`,
    '-i',
    input,
    '-map',
    '0:v',
    '-map',
    '1:a',
    ...encode,
  ];
}

/** A crop rectangle as fractions (0–1) of the source frame. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Round to 4 decimals so the filter string stays short and stable. */
function frac(n: number): string {
  return String(Math.round(n * 1e4) / 1e4);
}

/**
 * A `crop=…,` filter prefix that selects a sub-rectangle of the source before
 * scaling, or '' when no (valid) crop is given. Expressed with iw/ih so it works
 * regardless of the segment's actual resolution.
 */
function cropPrefix(crop: CropRect | null | undefined): string {
  if (!crop) return '';
  const { x, y, w, h } = crop;
  if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 1 || y + h > 1) return '';
  return `crop=iw*${frac(w)}:ih*${frac(h)}:iw*${frac(x)}:ih*${frac(y)},`;
}

interface ConcatOptions {
  /** Burn a watermark text onto every frame (needs a font file). */
  overlay?: { text: string; fontPath: string };
  /** Per-input crop rectangle (aligned by index); null/undefined = no crop. */
  crops?: (CropRect | null)[];
}

export function buildConcatArgs(
  inputs: string[],
  output: string,
  opts: ConcatOptions = {},
): string[] {
  if (inputs.length === 0) throw new Error('Geen invoer om samen te voegen');

  const args: string[] = [];
  for (const input of inputs) args.push('-i', input);

  // Optional "do not distribute" watermark, centred near the bottom. The text is
  // inlined (not a textfile) because some ffmpeg builds reject `textfile`.
  const drawtext = opts.overlay
    ? `,drawtext=fontfile=${escapeFilterPath(opts.overlay.fontPath)}:` +
      `text='${escapeDrawText(opts.overlay.text)}':expansion=none:` +
      `x=(w-text_w)/2:y=h-(2*line_h):fontsize=24:fontcolor=white@0.9:` +
      `box=1:boxcolor=black@0.45:boxborderw=10`
    : '';

  const filters: string[] = [];
  const concatInputs: string[] = [];
  inputs.forEach((_, i) => {
    const crop = cropPrefix(opts.crops?.[i]);
    filters.push(
      `[${i}:v]${crop}scale=${COMPOSITE_WIDTH}:${COMPOSITE_HEIGHT}:force_original_aspect_ratio=decrease,` +
        `pad=${COMPOSITE_WIDTH}:${COMPOSITE_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${COMPOSITE_FPS}${drawtext}[v${i}]`,
    );
    filters.push(`[${i}:a]aresample=async=1[a${i}]`);
    concatInputs.push(`[v${i}][a${i}]`);
  });
  const filterComplex = `${filters.join(';')};${concatInputs.join('')}concat=n=${inputs.length}:v=1:a=1[v][a]`;

  args.push(
    '-filter_complex',
    filterComplex,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    '-y',
    output,
  );
  return args;
}
