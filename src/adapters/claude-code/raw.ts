// La forma grezza dei messaggi di Claude Code, tipizzata al minimo indispensabile.
//
// Qui si usa `any` di proposito. Questa forma non è nostra e può cambiare: descriverla
// con tipi stretti darebbe una falsa sicurezza. La sicurezza dei tipi che ci interessa
// sta sull'altro lato dell'adapter, dove i tipi SONO nostri: `Payload`.
//
// L'SDK espone tipi propri per i messaggi che emette (`SDKMessage`), ma questo alias
// serve anche a leggere i trascritti su disco, che l'SDK non tipizza affatto.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type NativeEvent = { type?: string; subtype?: string; [k: string]: any }
