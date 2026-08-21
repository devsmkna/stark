# STARK — Spike tecnico (usa e getta)

Scopo: validare, PRIMA di scrivere STARK, che il canale strutturato degli agent
regga l'architettura scelta (vedi Notion: ADR-001).

Codice qui dentro NON entra in STARK. Serve solo a produrre FINDINGS.md.

## Domande a cui rispondere
- P01 il processo agent resta vivo e conversa su più turni? (bidirezionale)
- P02 che tassonomia di eventi arriva in una sessione reale (read/edit/bash)?
- P03 --permission-mode manual: arriva un evento a cui possiamo rispondere?
- P04 si può interrompere un turno a metà? (bottone Stop)
- P05 le sessioni si riprendono? (--session-id / --resume)
- P06 opencode: ACP e/o serve, che modello espongono?
- P07 esiste un bridge ACP per Claude Code?
- P08 cursor-agent: che forma ha il suo stream-json?

## Convenzioni
- ogni sonda scrive il raw stream in captures/<probe>.jsonl
- ogni sonda stampa un verdetto sintetico su stdout
