// La prova del TOTP: i vettori dell'appendice B dell'RFC 6238 (SHA1). Se questi
// passano, l'algoritmo è quello dello standard — non uno che ci somiglia.
//
//   node tools/totp-check.ts
//
// Il segreto è il seme dell'RFC ("12345678901234567890" ASCII) in base32; i codici
// dell'RFC sono a 8 cifre, i nostri a 6, e le ultime 6 dell'uno sono l'altro
// (bin % 1e6 == (bin % 1e8) % 1e6). Il tempo è fissato, mai `Date.now()`.

import {
  codiceTOTP, verificaTOTP, nuovoSegreto, otpauthUri,
  nuoviCodiciRecupero, hashCodice, trovaCodice,
} from '../cloud/src/totp.ts'

let falliti = 0
function ok(cond: boolean, nome: string, dettaglio = ''): void {
  if (cond) console.log(`  ✓ ${nome}`)
  else { falliti++; console.error(`  ✗ ${nome}${dettaglio ? ` — ${dettaglio}` : ''}`) }
}

const SEME = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' // "12345678901234567890" in base32
const VETTORI: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
]

for (const [t, atteso] of VETTORI) {
  const c = codiceTOTP(SEME, t * 1000)
  ok(c === atteso, `RFC 6238 @ ${t}s → ${atteso}`, `ottenuto ${c}`)
}

// La verifica accetta il codice del proprio passo e quelli a ±30s (deriva d'orologio),
// e rifiuta uno di due passi fa.
{
  const t = 1234567890 * 1000
  ok(verificaTOTP(SEME, '005924', t) !== null, 'verifica: il codice del momento passa')
  ok(verificaTOTP(SEME, codiceTOTP(SEME, t - 30_000), t) !== null, 'verifica: un passo indietro passa (deriva)')
  ok(verificaTOTP(SEME, codiceTOTP(SEME, t + 30_000), t) !== null, 'verifica: un passo avanti passa (deriva)')
  ok(verificaTOTP(SEME, codiceTOTP(SEME, t - 90_000), t) === null, 'verifica: tre passi indietro NON passa')
  ok(verificaTOTP(SEME, '000000', t) === null, 'verifica: un codice a caso non passa')
  ok(verificaTOTP(SEME, 'abc', t) === null, 'verifica: spazzatura non passa')
}

// Il passo tornato serve a bloccare il replay: due verifiche dello stesso codice danno
// lo stesso passo, e chi chiama lo confronta con l'ultimo consumato.
{
  const t = 1234567890 * 1000
  const p1 = verificaTOTP(SEME, '005924', t)
  const p2 = verificaTOTP(SEME, '005924', t)
  ok(p1 !== null && p1 === p2, 'lo stesso codice torna lo stesso passo (aggancio anti-replay)')
}

// Segreto e URI hanno la forma che un authenticator legge.
{
  const s = nuovoSegreto()
  ok(/^[A-Z2-7]{32}$/.test(s), 'un segreto nuovo è base32 da 32 caratteri', s)
  const uri = otpauthUri(s, 'v.filetti@digitizers.it')
  ok(uri.startsWith('otpauth://totp/STARK:') && uri.includes(`secret=${s}`), 'otpauth:// ben formato')
  ok(verificaTOTP(s, codiceTOTP(s, 1_000_000_000_000), 1_000_000_000_000) !== null,
    'un segreto nuovo verifica il proprio codice')
}

// Codici di recupero: monouso, confronto costante, spazi/trattini ignorati.
{
  const codici = nuoviCodiciRecupero()
  ok(codici.length === 10 && codici.every(c => /^[0-9a-f]{4}-[0-9a-f]{4}$/.test(c)),
    'dieci codici di recupero nella forma xxxx-xxxx')
  const hashes = codici.map(hashCodice)
  ok(trovaCodice(codici[3]!, hashes) === 3, 'un codice valido si ritrova al suo indice')
  ok(trovaCodice(codici[3]!.replace('-', ' ').toUpperCase(), hashes) === 3, 'trattino/spazi/maiuscole non contano')
  ok(trovaCodice('0000-0000', hashes) === -1, 'un codice inventato non si trova')
}

if (falliti > 0) { console.error(`\n${falliti} prove fallite`); process.exit(1) }
console.log('\ntutte le prove passano')
process.exit(0)
