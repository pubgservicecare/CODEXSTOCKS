// Storefront imagery. The brand files are cut from the owner's logo; the pictures are the owner's chosen PUBG Mobile
// artwork (prepared by scripts/art/prepare-website-art.mjs). They illustrate the store and never show an account for
// sale — listing photos come from the owner's own uploads.
// Imported (not served from /public) so the URLs work on every host, including admin.codexstocks.org.
import { assetUrl } from "@codex/ui/art";
import xMark from "../../assets/brand/codex-x.webp";
import wordmark from "../../assets/brand/codex-wordmark.webp";
import heroCrimson from "../../assets/pubg/hero-crimson.webp";
import heroBlue from "../../assets/pubg/hero-blue.webp";
import heroWhite from "../../assets/pubg/hero-white.webp";
import storyRed from "../../assets/pubg/story-red.webp";
import storyIce from "../../assets/pubg/story-ice.webp";
import storyThrone from "../../assets/pubg/story-throne.webp";
import lookRed from "../../assets/pubg/look-red.webp";
import lookBlue from "../../assets/pubg/look-blue.webp";
import lookSea from "../../assets/pubg/look-sea.webp";
import lookMummy from "../../assets/pubg/look-mummy.webp";
import lookWhite from "../../assets/pubg/look-white.webp";
import lookIce from "../../assets/pubg/look-ice.webp";
import lookCrimson from "../../assets/pubg/look-crimson.webp";
import lookThrone from "../../assets/pubg/look-throne.webp";
import lineup from "../../assets/pubg/lineup.webp";
import lineupSmall from "../../assets/pubg/lineup-800.webp";
import goldRush from "../../assets/pubg/gold-rush.webp";
import cardBlue from "../../assets/pubg/card-blue.webp";
import cardWhite from "../../assets/pubg/card-white.webp";
import cardRed from "../../assets/pubg/card-red.webp";
import cardIce from "../../assets/pubg/card-ice.webp";
import cardSea from "../../assets/pubg/card-sea.webp";

export const BRAND = { x: assetUrl(xMark), word: assetUrl(wordmark) };

/** Hero: one full-screen portrait on phones; three angled panels on wider screens (blue, crimson, white). */
export const HERO = {
  portrait: assetUrl(heroCrimson),
  panels: [assetUrl(heroBlue), assetUrl(heroCrimson), assetUrl(heroWhite)],
};

/** Scroll-story chapters. */
export const STORY = { red: assetUrl(storyRed), ice: assetUrl(storyIce), throne: assetUrl(storyThrone) };

/** "Iconic looks" gallery. */
export const LOOKS = [lookRed, lookBlue, lookSea, lookMummy, lookWhite, lookIce, lookCrimson, lookThrone].map(assetUrl);

export const BACKDROPS = { lineup: assetUrl(lineup), lineupSmall: assetUrl(lineupSmall), goldRush: assetUrl(goldRush) };

/** Artwork for accounts without a photo (also handed to the admin website's shared screens). */
export const CARD_ART: string[] = [cardRed, cardBlue, cardWhite, cardIce, cardSea].map(assetUrl);

/** Artwork for a listing without a photo: stable per id, different from its neighbour. */
export function cardArt(id: string, index?: number): string {
  if (index !== undefined) return CARD_ART[index % CARD_ART.length];
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CARD_ART[h % CARD_ART.length];
}
