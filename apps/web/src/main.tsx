import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { bootstrap } from './bootstrap.js'
import { PerfOverlay } from './dev/PerfOverlay.js'
import './styles.css'
import '@fontsource/barlow/500.css'
import '@fontsource/barlow/600.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/800.css'
import '@fontsource/barlow-condensed/900.css'
import '@fontsource/barlow-condensed/900-italic.css'
import './tokens.css'

// Before the first render: `?art=off` has to be in force before any <Card> mounts, and the CSS custom properties
// before the first paint.
const boot = bootstrap()

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing #root')
createRoot(root).render(
  <StrictMode>
    <App />
    {boot.flags.perf && <PerfOverlay />}
  </StrictMode>,
)
