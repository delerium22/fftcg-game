// Moved to @fftcg/cards so the browser app can share it (it is pure string handling, no fs). Re-exported
// here so the CLI's existing call sites and tests keep their import path.
export { parseDeckFile } from '@fftcg/cards'
