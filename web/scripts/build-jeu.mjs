// Assemble le jeu 3D (sources dans jeu-src/) en un seul fichier public/jeu/game.bundle.js.
// Chaque build porte un numéro de version, affiché dans l'écran d'erreur du jeu pour savoir quelle copie tourne.
import { build, context } from 'esbuild'

const watch = process.argv.includes('--watch')
const opts = {
  entryPoints: ['jeu-src/game.js'], bundle: true, format: 'esm', target: 'es2022', logLevel: 'warning',
  outfile: 'public/jeu/game.bundle.js', minify: !watch,
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(5, 16).replace('T', ' ')) },
}
if (watch) { await (await context(opts)).watch() } else { await build(opts) }
