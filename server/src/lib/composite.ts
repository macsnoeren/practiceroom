export const COMPOSITE_WIDTH = 1280;
export const COMPOSITE_HEIGHT = 720;
export const COMPOSITE_FPS = 30;

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
