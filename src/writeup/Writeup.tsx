import './writeup.css';

export default function Writeup() {
  return (
    <div className="app">
      <main className="writeup">
        <header className="writeup-header">
          <p className="eyebrow">Project write-up</p>
          <h1>GPS Tag</h1>
          <p className="lede">
            Infection tag for phones. One catcher, a radar, and a QR code on every runner. Catch someone and they join the hunt.
          </p>
          <a className="writeup-play" href="/">Play GPS Tag</a>
        </header>

        <figure className="writeup-video">
          <video controls playsInline preload="metadata" src="/writeup/gpstag.mp4" />
          <figcaption className="fine-print">GPS Tag in action.</figcaption>
        </figure>

        <section>
          <h2>The game</h2>
          <p>
            The host creates a room, shares the code, and starts as the only catcher. Catchers tag a runner by scanning the
            QR code on their phone or typing a six-character code, and that runner becomes a catcher too. The host picks a
            round length from 30 minutes to 6 hours. Catch every runner before time runs out, or the survivors win.
          </p>
        </section>

        <section>
          <h2>Design decisions</h2>
          <ul>
            <li>
              <strong>Radar first, map second.</strong> A north-up radar with a 250 m radius refreshes about every five
              seconds and gives a sense of direction without spoiling the chase. A full street map is one tap away.
            </li>
            <li>
              <strong>Honest about GPS.</strong> Phone GPS can be off by tens of metres. Accuracy circles show the
              uncertainty, readings fade after 15 seconds and vanish after 30, and players whose position can't be
              trusted are listed as "Position uncertain" rather than drawn in the wrong place.
            </li>
            <li>
              <strong>Catches never depend on GPS.</strong> Tagging is a physical QR scan or a typed code, so a weak signal
              can't cost anyone a catch.
            </li>
            <li>
              <strong>Private by default.</strong> Only each player's latest location is stored. It's cleared when the
              round ends, nothing tracks you in the background, and games are deleted after 24 hours.
            </li>
            <li>
              <strong>One small process.</strong> A React front end and a Fastify API in a single Node process, with
              SQLite on a Railway volume. No accounts: a signed cookie is the player session.
            </li>
          </ul>
        </section>

        <section>
          <h2>What's next</h2>
          <p>
            A native app built with Capacitor, using the same location interface, and a Bluetooth "detected nearby" hint
            for close-range play. Bluetooth will hint at proximity but will never catch anyone on its own.
          </p>
        </section>
      </main>
    </div>
  );
}
