/**
 * Genera le icone PWA a partire da un SVG sorgente (scripts/pwa-icon-source.svg).
 * Uso: npm run pwa:icons
 * Output in public/: pwa-192x192.png, pwa-512x512.png, pwa-maskable-512x512.png,
 * apple-touch-icon.png (180x180), favicon.ico-compatibile (favicon-32.png) e favicon.svg.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public');
const svg = await readFile(resolve(here, 'pwa-icon-source.svg'));
const BG = '#06414a';

await mkdir(out, { recursive: true });

/** Icona piena ("any"): il disegno occupa tutto il canvas. */
const full = (size) => sharp(svg, { density: 384 }).resize(size, size).png();

/** Maskable: sfondo pieno, disegno ridotto all'80% (safe zone 10% per lato). */
const maskable = async (size) => {
  const inner = Math.round(size * 0.8);
  const glyph = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: glyph, gravity: 'centre' }])
    .png();
};

await full(192).toFile(resolve(out, 'pwa-192x192.png'));
await full(512).toFile(resolve(out, 'pwa-512x512.png'));
await (await maskable(512)).toFile(resolve(out, 'pwa-maskable-512x512.png'));
// iOS applica da solo gli angoli arrotondati: serve un quadrato pieno, senza trasparenza.
await (await maskable(180)).toFile(resolve(out, 'apple-touch-icon.png'));
await full(32).toFile(resolve(out, 'favicon-32.png'));
await writeFile(resolve(out, 'favicon.svg'), svg);
console.log('Icone PWA generate in', out);
