import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bootstrap } from '../bootstrap.js'
import { Gallery } from './Gallery.js'
import '../styles.css'
import './fixtures.css'

// The same page-load setup as the game, so `?art=off&motion=instant` means the same thing here.
bootstrap()

const root = document.getElementById('root')
if (!root) throw new Error('fixtures.html is missing #root')
createRoot(root).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
)
