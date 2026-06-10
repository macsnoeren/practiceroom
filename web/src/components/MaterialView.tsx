import type { MaterialDto } from '@practiceroom/shared';
import { LibraryPlayer } from './LibraryPlayer.js';

/** Renders a single piece of lesson material: a note, an external link, and/or
 * a video from the teacher's library. An optional delete button is shown for
 * staff. */
export function MaterialView({
  material,
  onDelete,
}: {
  material: MaterialDto;
  onDelete?: () => void;
}) {
  const isLibraryFile = material.library?.kind === 'file';

  return (
    <li className="material-item">
      <div className="material-body">
        <div>
          <strong>{material.title}</strong>
          {material.url && (
            <>
              {' '}
              <a href={material.url} target="_blank" rel="noreferrer">
                link
              </a>
            </>
          )}
          {material.note && <div className="muted">{material.note}</div>}
        </div>
        {onDelete && (
          <button
            type="button"
            className="linkbtn danger"
            aria-label="Verwijderen"
            onClick={onDelete}
          >
            x
          </button>
        )}
      </div>
      {isLibraryFile && material.library && <LibraryPlayer itemId={material.library.id} />}
    </li>
  );
}
