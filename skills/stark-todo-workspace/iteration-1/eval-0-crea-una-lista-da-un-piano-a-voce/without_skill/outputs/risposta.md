Ho creato `accesso-da-fuori-casa.md` nella cartella di lavoro: i tre passi nell'ordine che hai detto, ognuno spezzato in sotto-punti spuntabili, più una sezione "Aperto/da decidere" e un diario in fondo.

Un paio di cose che ho annotato nel file perché sono trappole già note e in quest'ordine contano:

- **Passo 1**: il perimetro si legge una volta sola all'avvio, quindi impostare `STARK_PUBLIC_HOST` a daemon acceso non ha effetto — va riavviato, altrimenti dal telefono arriva un 403 che sembra un problema di token.
- **Passo 2**: Traefik non deve riscrivere `Host`/`Origin` — è proprio l'alternativa scartata.
- **Passo 3**: `npm run tunnel` costa zero quota e misura *quando* arrivano i pezzi, non quanti.

Non ho toccato niente del repo di STARK né configurato nulla: solo il file di tracciamento.
