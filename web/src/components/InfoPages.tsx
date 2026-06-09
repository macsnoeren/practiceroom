import type { ReactNode } from 'react';
import { APP_NAME } from '@practiceroom/shared';
import { SiteFooter } from './SiteFooter.js';

/**
 * Organisation details shown across the legal pages. Fill in the values between
 * square brackets with your own (the data controller is normally the school).
 */
const ORG = {
  name: 'JMNL Innovation',
  address: 'Dorstseweg 25b, 4854 NA Bavel',
  kvk: '65677463',
  email: 'privacy@jmnl.nl',
};

const LAST_UPDATED = '9 juni 2026';

function InfoLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="info-page">
      <div className="info-top">
        <a href="/" className="brand" aria-label={`Naar ${APP_NAME}`}>
          <img className="brand-logo" src="/practice-room-logo.png" alt={APP_NAME} />
        </a>
        <a href="/" className="linkbtn">
          ← Terug
        </a>
      </div>
      <article className="info-content card">
        <h1>{title}</h1>
        {children}
      </article>
      <SiteFooter />
    </div>
  );
}

export function PrivacyPage() {
  return (
    <InfoLayout title="Privacyverklaring">
      <p className="muted">Laatst bijgewerkt: {LAST_UPDATED}</p>
      <p>
        Deze privacyverklaring legt uit hoe {ORG.name} (&ldquo;wij&rdquo;) omgaat met
        persoonsgegevens binnen het {APP_NAME}-platform. Wij verwerken gegevens in overeenstemming
        met de Algemene Verordening Gegevensbescherming (AVG).
      </p>

      <h2>1. Verwerkingsverantwoordelijke</h2>
      <p>
        {ORG.name}
        <br />
        {ORG.address}
        <br />
        KvK: {ORG.kvk}
        <br />
        E-mail: {ORG.email}
      </p>

      <h2>2. Welke gegevens wij verwerken</h2>
      <ul>
        <li>
          <strong>Accountgegevens:</strong> naam, e-mailadres, rol (beheerder, leraar of student) en
          een versleutelde weergave van je wachtwoord. Bij tweestapsverificatie ook een geheime
          sleutel daarvoor.
        </li>
        <li>
          <strong>Lesgegevens:</strong> geplande lessen, betrokken leraar en student, lokaal,
          tijdstip en eventuele aantekeningen.
        </li>
        <li>
          <strong>Opnames:</strong> video- en audio-opnames van lessen die met aangesloten
          camera&rsquo;s worden gemaakt om terug te kunnen kijken.
        </li>
        <li>
          <strong>Apparaatgegevens:</strong> naam en status van aangesloten opnameapparaten.
        </li>
        <li>
          <strong>Technische gegevens:</strong> een functionele sessiecookie en server-logbestanden
          (zoals IP-adres en tijdstip) voor de werking en beveiliging van het platform.
        </li>
      </ul>

      <h2>3. Doeleinden en grondslagen</h2>
      <ul>
        <li>
          Het aanbieden van het platform en het uitvoeren van de lesovereenkomst (grondslag:
          uitvoering van een overeenkomst).
        </li>
        <li>Het maken en terugkijken van lesopnames (grondslag: toestemming; zie hieronder).</li>
        <li>
          Beveiliging, misbruikpreventie en het oplossen van storingen (grondslag: gerechtvaardigd
          belang).
        </li>
        <li>
          Het versturen van noodzakelijke e-mails (verificatie, wachtwoordherstel, uitnodiging).
        </li>
      </ul>

      <h2>4. Lesopnames</h2>
      <p>
        Opnames kunnen herkenbare beelden en geluid van personen bevatten, mogelijk ook van
        minderjarigen. Opnames worden alleen gemaakt voor lesdoeleinden en zijn uitsluitend
        toegankelijk voor de betrokken leraar, de betrokken student en beheerders van de school.
        Voor het maken van opnames vragen wij vooraf toestemming; bij minderjarigen van een ouder of
        voogd. Toestemming kan op elk moment worden ingetrokken.
      </p>

      <h2>5. Bewaartermijnen</h2>
      <p>
        Wij bewaren gegevens niet langer dan nodig. Accountgegevens bewaren we zolang het account
        actief is. Opnames en lesgegevens worden bewaard volgens het beleid van de school en op
        verzoek verwijderd. Logbestanden worden na een beperkte periode automatisch verwijderd.
      </p>

      <h2>6. Delen met derden</h2>
      <p>
        Wij verkopen geen gegevens. Gegevens kunnen worden verwerkt door dienstverleners die ons
        helpen het platform te draaien, zoals de hostingpartij en de e-maildienst. Met deze partijen
        zijn (verwerkers)afspraken gemaakt. Gegevens worden binnen de EER verwerkt, tenzij anders
        vermeld.
      </p>

      <h2>7. Beveiliging</h2>
      <p>
        Wachtwoorden worden gehasht opgeslagen (argon2), sessies verlopen automatisch, accounts
        kunnen met tweestapsverificatie worden beveiligd en opnames zijn alleen via tijdelijke,
        ondertekende links toegankelijk voor wie de les mag bekijken.
      </p>

      <h2>8. Jouw rechten</h2>
      <p>
        Je hebt het recht op inzage, correctie, verwijdering, beperking en overdraagbaarheid van je
        gegevens, en het recht om bezwaar te maken of gegeven toestemming in te trekken. Stuur
        hiervoor een bericht naar {ORG.email}. Je kunt ook een klacht indienen bij de Autoriteit
        Persoonsgegevens.
      </p>

      <h2>9. Cookies</h2>
      <p>
        Wij gebruiken alleen functionele cookies en lokale opslag. Lees hierover meer in onze{' '}
        <a href="/cookies">cookieverklaring</a>.
      </p>

      <h2>10. Wijzigingen</h2>
      <p>
        Wij kunnen deze privacyverklaring aanpassen. De meest actuele versie vind je altijd op deze
        pagina.
      </p>
    </InfoLayout>
  );
}

export function CookiePage() {
  return (
    <InfoLayout title="Cookieverklaring">
      <p className="muted">Laatst bijgewerkt: {LAST_UPDATED}</p>
      <p>
        {APP_NAME} gebruikt uitsluitend cookies en lokale opslag die noodzakelijk zijn voor de
        werking van het platform. Wij gebruiken <strong>geen</strong> tracking-, analyse- of
        marketingcookies. Voor deze functionele cookies is geen toestemming vereist; de melding die
        je ziet is daarom informatief.
      </p>

      <h2>Wat wij gebruiken</h2>
      <table>
        <thead>
          <tr>
            <th>Naam</th>
            <th>Soort</th>
            <th>Doel</th>
            <th>Bewaartermijn</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>pr_session</code>
            </td>
            <td>Functionele cookie</td>
            <td>Houdt je ingelogd. Strikt noodzakelijk.</td>
            <td>Max. 30 dagen</td>
          </tr>
          <tr>
            <td>
              <code>pr_theme</code>
            </td>
            <td>Lokale opslag</td>
            <td>Onthoudt je voorkeur voor licht of donker thema.</td>
            <td>Tot je deze wist</td>
          </tr>
          <tr>
            <td>
              <code>pr_cookie_ack</code>
            </td>
            <td>Lokale opslag</td>
            <td>Onthoudt dat je de cookiemelding hebt gezien.</td>
            <td>Tot je deze wist</td>
          </tr>
        </tbody>
      </table>

      <h2>Cookies verwijderen</h2>
      <p>
        Je kunt cookies en lokale opslag altijd verwijderen via de instellingen van je browser. Houd
        er rekening mee dat je daarna opnieuw moet inloggen.
      </p>
    </InfoLayout>
  );
}

export function TermsPage() {
  return (
    <InfoLayout title="Gebruiksvoorwaarden">
      <p className="muted">Laatst bijgewerkt: {LAST_UPDATED}</p>
      <p>
        Deze voorwaarden zijn van toepassing op het gebruik van het {APP_NAME}-platform van{' '}
        {ORG.name}. Door het platform te gebruiken ga je akkoord met deze voorwaarden.
      </p>

      <h2>1. Account</h2>
      <p>
        Je bent verantwoordelijk voor het geheimhouden van je inloggegevens en voor activiteiten die
        onder je account plaatsvinden. We raden je aan tweestapsverificatie in te schakelen. Meld
        misbruik zo snel mogelijk.
      </p>

      <h2>2. Toegestaan gebruik</h2>
      <p>
        Je gebruikt het platform uitsluitend voor het plannen, opnemen en terugkijken van lessen.
        Het is niet toegestaan het platform te misbruiken, de beveiliging te omzeilen of gegevens
        van anderen onrechtmatig te benaderen.
      </p>

      <h2>3. Opnames</h2>
      <p>
        Lesopnames zijn bedoeld om lessen terug te kijken. Het is niet toegestaan opnames buiten het
        platform te verspreiden of openbaar te maken zonder toestemming van de betrokkenen. Zie ook
        onze <a href="/privacy">privacyverklaring</a>.
      </p>

      <h2>4. Intellectueel eigendom</h2>
      <p>
        De software en vormgeving van het platform blijven eigendom van de rechthebbenden.
        Lesmateriaal en opnames blijven van de betrokken school en gebruikers.
      </p>

      <h2>5. Beschikbaarheid</h2>
      <p>
        Wij spannen ons in voor een goede beschikbaarheid, maar kunnen geen ononderbroken toegang
        garanderen. Onderhoud of storingen kunnen de dienst tijdelijk beïnvloeden.
      </p>

      <h2>6. Aansprakelijkheid</h2>
      <p>
        Het platform wordt aangeboden &ldquo;zoals het is&rdquo;. Voor zover wettelijk toegestaan
        zijn wij niet aansprakelijk voor indirecte schade of voor verlies van gegevens.
      </p>

      <h2>7. Beëindiging</h2>
      <p>
        Een beheerder kan accounts aanmaken en verwijderen. Bij beëindiging van het gebruik kunnen
        bijbehorende gegevens worden verwijderd volgens het beleid van de school.
      </p>

      <h2>8. Toepasselijk recht</h2>
      <p>Op deze voorwaarden is Nederlands recht van toepassing.</p>
    </InfoLayout>
  );
}

export function HelpPage() {
  return (
    <InfoLayout title="Handleiding">
      <p>
        Welkom bij {APP_NAME}. Hieronder lees je per rol hoe je het platform gebruikt. Vragen
        beantwoorden we graag via je beheerder.
      </p>

      <h2>Inloggen en je account</h2>
      <ul>
        <li>
          <strong>Nieuwe school:</strong> kies op het inlogscherm voor &ldquo;Registreren&rdquo; om
          een school en een eerste beheerder aan te maken. Je ontvangt een e-mail om je adres te
          bevestigen.
        </li>
        <li>
          <strong>Uitgenodigd?</strong> Open de uitnodigingslink uit je e-mail en kies een eigen
          wachtwoord om je account te activeren.
        </li>
        <li>
          <strong>Wachtwoord vergeten:</strong> klik op &ldquo;Wachtwoord vergeten?&rdquo; en volg
          de link in de e-mail.
        </li>
        <li>
          <strong>Tweestapsverificatie (2FA):</strong> ga naar je profiel (klik op je naam
          rechtsboven) en scan de QR-code met een authenticator-app voor extra beveiliging.
        </li>
        <li>
          <strong>Profiel:</strong> via je naam rechtsboven pas je je naam, e-mailadres en
          wachtwoord aan.
        </li>
      </ul>

      <h2>Voor beheerders</h2>
      <ul>
        <li>
          <strong>Gebruikers:</strong> nodig leraren en studenten uit via &ldquo;Gebruikers&rdquo;.
          Zij stellen zelf hun wachtwoord in. Je kunt gegevens en rollen bewerken of accounts
          verwijderen.
        </li>
        <li>
          <strong>Lokalen:</strong> beheer onder &ldquo;Lokalen&rdquo; de ruimtes waar lessen
          plaatsvinden.
        </li>
        <li>
          <strong>Vakanties:</strong> voer schoolvakanties in onder &ldquo;Vakanties&rdquo;. Lessen
          die in een vakantie vallen, vervallen automatisch in het rooster.
        </li>
        <li>
          <strong>Camera&rsquo;s:</strong> registreer opnameapparaten onder
          &ldquo;Camera&rsquo;s&rdquo; en koppel ze via een koppelcode in de camera-app.
        </li>
      </ul>

      <h2>Voor leraren</h2>
      <ul>
        <li>
          <strong>Lessen plannen:</strong> gebruik &ldquo;Les inplannen&rdquo; in het rooster.
          Bekijk per dag, week of maand, kies een student en eventueel een lokaal, en herhaal lessen
          desgewenst wekelijks.
        </li>
        <li>
          <strong>Lesdashboard:</strong> klik op een les om de cameras te bedienen. Je kunt opnemen
          starten en stoppen; start je een andere camera, dan stopt de vorige automatisch.
        </li>
        <li>
          <strong>Aantekeningen:</strong> maak per les notities die bij de les bewaard blijven.
        </li>
        <li>
          <strong>Afronden:</strong> rond je een les af, dan worden de opgenomen segmenten
          samengevoegd tot één lesvideo en kun je niet opnieuw opnemen.
        </li>
        <li>
          <strong>Terugkijken:</strong> bekeken opnames verschijnen in het lesdashboard.
        </li>
      </ul>

      <h2>Voor studenten</h2>
      <ul>
        <li>
          <strong>Mijn lessen:</strong> bekijk je geplande lessen en de ingeplande vakanties.
        </li>
        <li>
          <strong>Terugkijken:</strong> na een les verschijnt de opname om terug te kijken.
        </li>
      </ul>

      <h2>De camera-app</h2>
      <ul>
        <li>Open de camera-app op het apparaat dat filmt.</li>
        <li>Voer de koppelcode in die de beheerder bij het apparaat heeft aangemaakt.</li>
        <li>
          Kies de juiste camera en microfoon. Tijdens een les bestuurt de leraar het opnemen op
          afstand.
        </li>
      </ul>
    </InfoLayout>
  );
}

/** Renders the public info page for the current path, or null otherwise. */
export function infoPageForPath(pathname: string): ReactNode | null {
  switch (pathname) {
    case '/privacy':
      return <PrivacyPage />;
    case '/cookies':
      return <CookiePage />;
    case '/voorwaarden':
      return <TermsPage />;
    case '/help':
      return <HelpPage />;
    default:
      return null;
  }
}
