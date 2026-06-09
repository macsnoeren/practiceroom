import { APP_NAME } from '@practiceroom/shared';

/** Footer with links to the public information pages. Plain anchors so they
 * load the standalone pages regardless of where the footer is rendered. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav>
        <a href="/help">Handleiding</a>
        <a href="/privacy">Privacy</a>
        <a href="/cookies">Cookies</a>
        <a href="/voorwaarden">Voorwaarden</a>
      </nav>
      <span className="muted">
        © {new Date().getFullYear()} {APP_NAME}
      </span>
    </footer>
  );
}
