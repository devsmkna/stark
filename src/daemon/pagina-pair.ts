// La pagina in cui il telefono scrive il codice.
//
// È **una stringa**, non un file dentro `ui/dist`, e non è pigrizia: è ciò che tiene la
// superficie non autenticata larga esattamente una rotta. Una pagina della UI vera
// tirerebbe dentro il suo JavaScript, il suo CSS e le sue icone — cioè `/assets/*` —
// e per farla funzionare senza credenziale bisognerebbe aprire anche quelli. Qui non c'è
// niente da caricare: nessuno script esterno, nessun font, nessuna immagine.
//
// Per lo stesso motivo non importa niente da `ui/`: quel codice non è raggiungibile dal
// daemon senza build, e comunque farlo dipendere da un artefatto compilato vorrebbe dire
// che la pagina del codice smette di esistere dopo un `git clone`.

/** Il vestito è quello di STARK, ridotto all'osso: gli stessi colori di `app.css`. */
export function paginaAccoppiamento(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>STARK — connect this phone</title>
<style>
  :root{--bg:#FBFBFD;--card:#fff;--ink:#171A22;--muted:#767D90;--line:#DCDFE9;--accent:#3B5BF5;--bad:#D0342C}
  @media(prefers-color-scheme:dark){:root{--bg:#0E1118;--card:#161A23;--ink:#E8EAF0;--muted:#8A91A2;--line:#333B4B;--accent:#7A92FF;--bad:#F0736A}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
    background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
    padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom))}
  .card{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);
    border-radius:16px;padding:26px 22px}
  h1{margin:0 0 4px;font-size:17px;letter-spacing:.14em;font-weight:700}
  p{margin:0 0 20px;color:var(--muted);font-size:13px}
  /* Un campo per un codice, non per una parola: tutto maiuscolo, spaziato, monospace —
     e senza correttore, che su un telefono trasformerebbe «RJ7K» in qualcos'altro. */
  input{width:100%;padding:14px;font:600 22px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
    letter-spacing:.22em;text-align:center;text-transform:uppercase;
    border:1px solid var(--line);border-radius:11px;background:var(--bg);color:var(--ink)}
  input:focus{outline:2px solid var(--accent);outline-offset:1px}
  button{width:100%;margin-top:12px;padding:13px;font:600 15px/1 inherit;color:#fff;
    background:var(--accent);border:0;border-radius:11px}
  button[disabled]{opacity:.5}
  .err{margin-top:12px;color:var(--bad);font-size:13px;min-height:19px}
</style></head>
<body>
<form class="card" id="f">
  <h1>S T A R K</h1>
  <p>Enter the 8-character code shown on your computer.</p>
  <!-- \`inputmode\` e non \`type=number\`: il codice ha delle lettere. \`autocapitalize\`
       perché su iOS la tastiera parte minuscola dentro un campo così. -->
  <input id="c" name="code" maxlength="8" autocomplete="off" autocapitalize="characters"
    autocorrect="off" spellcheck="false" inputmode="text" autofocus
    aria-label="Pairing code" />
  <button id="b" type="submit">Connect</button>
  <div class="err" id="e" role="alert"></div>
</form>
<script>
const f=document.getElementById('f'),c=document.getElementById('c'),
      b=document.getElementById('b'),e=document.getElementById('e')
async function manda(){
  b.disabled=true; e.textContent=''
  try{
    const r=await fetch('/api/phone/claim',{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify({code:c.value})})
    const j=await r.json()
    if(!j.ok){e.textContent=j.error||'Not accepted';b.disabled=false;c.select();return}
    // Il token si tiene anche qui, non solo nel cookie: un'app aggiunta alla schermata
    // Home viene chiusa e riaperta di continuo, e la UI lo cerca in \`localStorage\`.
    try{localStorage.setItem('stark.token',j.token);sessionStorage.setItem('stark.token',j.token)}catch{}
    location.replace('/')
  }catch{ e.textContent='No answer from STARK'; b.disabled=false }
}
f.addEventListener('submit',ev=>{ev.preventDefault();void manda()})
// Chi arriva da un QR porta il codice già scritto in \`?c=\`: STARK lo mette lì
// (vedi Phone.svelte) cifrando nel QR esattamente ciò che altrimenti si batterebbe a
// mano. Lo si manda subito, così scansionare basta — nessuna tastiera in mezzo.
const dallaQuery=new URLSearchParams(location.search).get('c')
if(dallaQuery){c.value=dallaQuery.toUpperCase();void manda()}
</script>
</body></html>`
}
