import { LOOKS } from "./art";

/**
 * "Iconic looks": a gallery of X-Suit artwork. On wide screens the row drifts sideways as the page scrolls
 * (scroll-linked, transform only); on phones it is a swipeable rail. The pictures illustrate the store — they are
 * not accounts for sale.
 */
export function Armory() {
  return (
    <section className="armory" data-scroll="band" aria-labelledby="armory-title">
      <div className="wrap armory-head" data-reveal="up">
        <div>
          <p className="kicker">Iconic looks</p>
          <h2 id="armory-title" className="display-h">Suits that turn heads</h2>
        </div>
        <p className="armory-note">Artwork for illustration. Each listing describes the actual account — with the seller&apos;s own photo where one was added.</p>
      </div>
      <div className="armory-rail">
        <div className="armory-track">
          {LOOKS.map((src, i) => (
            <figure className="armory-card" key={src} style={{ ["--i" as string]: i }}>
              <img src={src} alt="" loading="lazy" decoding="async" />
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
