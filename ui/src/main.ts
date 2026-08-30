import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'

// Il mount di Svelte 5 aggiunge i figli in coda al target invece di sostituirlo:
// senza questa riga lo splash statico di index.html (`#carica`) resterebbe il
// primo figlio, sotto l'app ma in piedi per sempre. Lo si toglie a mano, e la UI
// mostra subito il suo `Splash.svelte`: da un "STARK che respira" all'altro.
const target = document.getElementById('app')!
target.innerHTML = ''

export default mount(App, { target })
