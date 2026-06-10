import { APP_NAME } from '@practiceroom/shared';
import { SiteFooter } from './SiteFooter.js';

const FEATURES: { icon: string; title: string; text: string }[] = [
  {
    icon: '🎬',
    title: 'Opnemen vanuit meerdere hoeken',
    text: 'Koppel telefoons, tablets of webcams als camera. Film de handen, de houding en het hele beeld — met of zonder geluid.',
  },
  {
    icon: '🎞️',
    title: 'Eén heldere lesvideo',
    text: 'Alle opnames worden automatisch samengevoegd tot één video, compleet met een eigen intro, outro en watermerk.',
  },
  {
    icon: '📅',
    title: 'Plannen en herhalen',
    text: 'Plan losse of wekelijks terugkerende lessen. Vakanties worden automatisch overgeslagen en netjes getoond.',
  },
  {
    icon: '🔒',
    title: 'Veilig terugkijken',
    text: 'Leerlingen kijken alleen hun eigen les terug via tijdelijke, beveiligde links. Niets is zomaar te downloaden of te delen.',
  },
  {
    icon: '📝',
    title: 'Aantekeningen en markeringen',
    text: 'Zet tijdens de les markeringen op belangrijke momenten en laat leerling én docent eigen notities maken.',
  },
  {
    icon: '🎼',
    title: 'Eigen lesbibliotheek',
    text: 'Bewaar waardevolle opnames en lesmateriaal in je eigen bibliotheek en koppel ze later aan een les.',
  },
];

const REASONS: { title: string; text: string }[] = [
  {
    title: 'Sneller vooruit',
    text: 'Leerlingen oefenen gerichter doordat ze de les rustig kunnen terugkijken — precies zien wat de docent bedoelde.',
  },
  {
    title: 'Docent en leerling op één lijn',
    text: 'Aantekeningen, materiaal en video komen samen op één plek, zodat de voortgang voor iedereen duidelijk is.',
  },
  {
    title: 'Privacyvriendelijk en zelf te hosten',
    text: 'Je houdt de regie over je eigen data. PracticeRoom draait op je eigen server, achter je eigen inlog.',
  },
];

/** The public marketing landing page for visitors who aren't logged in yet. */
export function LandingPage({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="landing">
      <header className="landing-hero">
        <img className="brand-logo landing-logo" src="/practice-room-logo.png" alt={APP_NAME} />
        <h1>Elke muziekles vastgelegd, om écht van te leren</h1>
        <p className="landing-lead">
          {APP_NAME} neemt je lessen op vanuit meerdere camera&apos;s en maakt er automatisch één
          video van. Zo kunnen leerlingen rustig terugkijken en sneller groeien — en houd je als
          school alles overzichtelijk en veilig op één plek.
        </p>
        <div className="hero-cta">
          <button type="button" onClick={onGetStarted}>
            Inloggen of account aanmaken
          </button>
        </div>
      </header>

      <section className="landing-section">
        <h2>Wat kun je ermee?</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="feature card">
              <div className="feature-icon" aria-hidden="true">
                {f.icon}
              </div>
              <h3>{f.title}</h3>
              <p className="muted">{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section landing-why">
        <h2>Waarom {APP_NAME}?</h2>
        <div className="reason-grid">
          {REASONS.map((r) => (
            <div key={r.title} className="reason">
              <h3>{r.title}</h3>
              <p className="muted">{r.text}</p>
            </div>
          ))}
        </div>
        <div className="hero-cta">
          <button type="button" onClick={onGetStarted}>
            Aan de slag
          </button>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
