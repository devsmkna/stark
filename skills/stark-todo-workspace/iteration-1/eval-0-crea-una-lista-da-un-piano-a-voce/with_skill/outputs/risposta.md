Fatto: il piano è ora nella lista che vedi nella sidebar Todo, così non devi tenertelo in testa.

**Accesso a STARK da fuori casa** — 0/3
1. Perimetro dichiarato con `STARK_PUBLIC_HOST`
2. Traefik sul VPS con Let's Encrypt e mTLS
3. Tunnel misurato: l'SSE non viene strozzato — *nota: `npm run tunnel`, costo zero di quota, usa i battiti*

Ho tenuto l'ordine che hai detto perché è anche l'ordine giusto delle dipendenze: senza il perimetro dichiarato Traefik ti arriverebbe addosso a un daemon che lo rifiuta con un 403, e la misura del tunnel ha senso solo su un tunnel che esiste già.

Non ho toccato niente: nessuna configurazione, nessun file del repo di STARK. Quando cominci col primo dimmelo e lo segno come `doing` mentre lo fai, non alla fine — una lista aggiornata a cose finite è un resoconto, non un promemoria.

Una cosa da decidere tu: la lista sta in `.stark/todo.json` dentro il progetto, e qui non c'è un `.gitignore`. Se non vuoi che finisca in un commit va ignorata; se invece ti fa comodo vederla nei diff va bene com'è.
