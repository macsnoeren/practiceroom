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
export function buildConcatArgs(inputs: string[], output: string): string[] {
  if (inputs.length === 0) throw new Error('Geen invoer om samen te voegen');

  const args: string[] = [];
  for (const input of inputs) args.push('-i', input);

  const filters: string[] = [];
  const concatInputs: string[] = [];
  inputs.forEach((_, i) => {
    filters.push(
      `[${i}:v]scale=${COMPOSITE_WIDTH}:${COMPOSITE_HEIGHT}:force_original_aspect_ratio=decrease,` +
        `pad=${COMPOSITE_WIDTH}:${COMPOSITE_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${COMPOSITE_FPS}[v${i}]`,
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
