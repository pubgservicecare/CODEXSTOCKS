import { STORY } from "./art";

const CHAPTERS = [
  {
    key: "red",
    tag: "Collector accounts",
    title: "Rare looks, kept exactly as described.",
    text: "Outfits, upgraded weapons and achievements — every listing shows what the account holds, written by the owner, never rewritten.",
    alt: "PUBG Mobile artwork: a red and black X-Suit on a gothic street",
  },
  {
    key: "ice",
    tag: "Ranked accounts",
    title: "History you can ask about.",
    text: "Tiers, seasons and stats are described in the owner's own words. Ask anything on WhatsApp before you decide.",
    alt: "PUBG Mobile artwork: an ice suit standing in a frozen storm",
  },
  {
    key: "throne",
    tag: "Straight deals",
    title: "One price. One conversation.",
    text: "Prices in PKR or USD, confirmed personally by the owner. Payment and handover are arranged directly with you.",
    alt: "PUBG Mobile artwork: a player seated on a throne in blue smoke",
  },
] as const;

/**
 * Scroll story: the section is pinned while three pictures replace one another (a wipe that follows the scroll)
 * and the copy changes with them. With reduced motion (or no JavaScript) the chapters are simply stacked.
 */
export function Story() {
  return (
    <section className="story" data-scroll="story" data-count={CHAPTERS.length} data-active="0" aria-label="What you'll find here">
      <div className="story-pin">
        <div className="story-media">
          {CHAPTERS.map((c, i) => (
            <figure className={`story-scene story-scene--${c.key}`} data-i={i} key={c.key}>
              <img src={STORY[c.key]} alt={c.alt} loading="lazy" decoding="async" />
            </figure>
          ))}
          <span className="story-frame" aria-hidden="true" />
          <span className="art-credit">Illustrative artwork</span>
        </div>
        <div className="story-copy">
          <p className="kicker">What you&apos;ll find here</p>
          <div className="story-panels">
            {CHAPTERS.map((c, i) => (
              <article className="story-panel" data-i={i} key={c.key}>
                <span className="story-tag">
                  <b>0{i + 1}</b> / 0{CHAPTERS.length} · {c.tag}
                </span>
                <h2>{c.title}</h2>
                <p>{c.text}</p>
              </article>
            ))}
          </div>
          <div className="story-progress" aria-hidden="true">
            {CHAPTERS.map((c, i) => (
              <i key={c.key} data-i={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
