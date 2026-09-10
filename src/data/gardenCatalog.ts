/**
 * gardenCatalog.ts — the static catalogue of things you can grow in the garden.
 *
 * Product content, not user data: every user sees the same shop. What is real
 * and persistent is the *ownership* of an item (garden_items) and the seed
 * balance (garden_wallet) that bought it — those live in the database / demo
 * store, never here.
 */
import type { GardenCatalogItem } from '@/data/types';

export const GARDEN_CATALOG: GardenCatalogItem[] = [
  // Plants — the heart of the garden.
  { key: 'sprout', name: 'A new sprout', emoji: '🌱', kind: 'plant', seeds: 20 },
  { key: 'fern', name: 'A quiet fern', emoji: '🌿', kind: 'plant', seeds: 45 },
  { key: 'cactus', name: 'An easy cactus', emoji: '🌵', kind: 'plant', seeds: 60 },
  { key: 'palm', name: 'A tall palm', emoji: '🌴', kind: 'plant', seeds: 120 },
  { key: 'evergreen', name: 'A sturdy pine', emoji: '🌲', kind: 'plant', seeds: 150 },

  // Flowers — colour and softness.
  { key: 'sunflower', name: 'A sunflower', emoji: '🌻', kind: 'flower', seeds: 35 },
  { key: 'tulip', name: 'A tulip', emoji: '🌷', kind: 'flower', seeds: 40 },
  { key: 'blossom', name: 'Blossom branch', emoji: '🌸', kind: 'flower', seeds: 55 },
  { key: 'rose', name: 'A rose', emoji: '🌹', kind: 'flower', seeds: 70 },
  { key: 'cherry', name: 'Cherry bloom', emoji: '🍒', kind: 'flower', seeds: 90 },

  // Pets — companions who keep you company.
  { key: 'ladybug', name: 'A ladybug', emoji: '🐞', kind: 'pet', seeds: 25 },
  { key: 'bunny', name: 'A sleepy bunny', emoji: '🐰', kind: 'pet', seeds: 80 },
  { key: 'bird', name: 'A small finch', emoji: '🐦', kind: 'pet', seeds: 100 },
  { key: 'cat', name: 'A curled-up cat', emoji: '🐱', kind: 'pet', seeds: 160 },

  // Decorations — things that make the space feel like yours.
  { key: 'bee', name: 'A busy bee', emoji: '🐝', kind: 'decoration', seeds: 30 },
  { key: 'butterfly', name: 'A butterfly', emoji: '🦋', kind: 'decoration', seeds: 50 },
  { key: 'rock', name: 'A smooth rock', emoji: '🪨', kind: 'decoration', seeds: 15 },
  { key: 'bench', name: 'A little bench', emoji: '🪑', kind: 'decoration', seeds: 110 },
  { key: 'birdhouse', name: 'A birdhouse', emoji: '🏡', kind: 'decoration', seeds: 130 },

  /** The very first thing a new garden gets — no purchase needed. */
  { key: 'starter', name: 'Your first sprout', emoji: '🌱', kind: 'plant', seeds: 0 },
];

export function catalogByKey(key: string): GardenCatalogItem | undefined {
  return GARDEN_CATALOG.find((item) => item.key === key);
}

export const STARTER_ITEM_KEY = 'starter';