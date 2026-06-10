/**
 * A <video> with the usual easy download routes turned off: no native download
 * button, no picture-in-picture, no right-click "save as". This is a deterrent,
 * not DRM — the bytes still travel to the browser — but it stops casual saving.
 */
export function SecureVideo({ src, className = 'player' }: { src: string; className?: string }) {
  return (
    <video
      key={src}
      className={className}
      controls
      controlsList="nodownload noremoteplayback noplaybackrate"
      disablePictureInPicture
      onContextMenu={(e) => e.preventDefault()}
      src={src}
    />
  );
}
