#!/usr/bin/env python3
"""Read-modify-write helper for `.stark/todo.json`, the file behind STARK's Todo sidebar.

Why a script instead of editing the JSON by hand:

  * Several STARK chats can be open on the same folder, and they share this file. Reading
    it, thinking, and writing it back whole would silently erase whatever the other chat
    did in between. Here the read-modify-write window is a few milliseconds, and the write
    is atomic (temp file + rename), so a reader never sees a half-written file.
  * Regenerating the JSON from memory drops fields the format grew after you last read
    about it. Everything not touched is copied through untouched.
"""
import json, os, sys, uuid, time, tempfile

STATI_TASK = ('todo', 'doing', 'done', 'blocked')
STATI_LISTA = ('active', 'paused', 'done', 'abandoned')


def percorso() -> str:
    return os.path.join(os.environ.get('STARK_TODO_DIR', '.stark'), 'todo.json')


def leggi() -> dict:
    try:
        with open(percorso(), encoding='utf-8') as f:
            dati = json.load(f)
        return dati if isinstance(dati, dict) else {}
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as e:
        # Un file illeggibile non si sovrascrive: dentro c'è del lavoro, e ricominciare
        # da zero lo butterebbe via. Meglio fermarsi e dirlo.
        sys.exit(f'{percorso()} non è JSON valido ({e}). Sistemalo a mano: non lo tocco.')


def scrivi(dati: dict) -> None:
    p = percorso()
    os.makedirs(os.path.dirname(p) or '.', exist_ok=True)
    # Temp file nella STESSA cartella: `os.replace` è atomico solo dentro un filesystem.
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p) or '.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(dati, f, ensure_ascii=False, indent=2)
            f.write('\n')
        os.replace(tmp, p)
    except BaseException:
        os.unlink(tmp)
        raise


def lista(dati: dict, lid: str) -> dict:
    if lid not in dati:
        sys.exit(f'lista «{lid}» non trovata. `todo.py list` per vedere quali ci sono.')
    return dati[lid]


def prossimo_id(l: dict) -> str:
    usati = {t.get('id') for t in l.get('tasks', [])}
    n = 1
    while f't{n}' in usati:
        n += 1
    return f't{n}'


def main(argv: list) -> None:
    if not argv:
        sys.exit(__doc__.strip().split('\n')[0] + '\n\nComandi: list, new, add, set, note, status')
    cmd, resto = argv[0], argv[1:]
    dati = leggi()

    if cmd == 'list':
        if not dati:
            print('nessuna lista in', percorso())
            return
        for lid, l in dati.items():
            fatti = sum(1 for t in l.get('tasks', []) if t.get('state') == 'done')
            print(f"{lid}  [{l.get('__status', '?')}]  {l.get('title', '(senza titolo)')}"
                  f"  {fatti}/{len(l.get('tasks', []))}")
            for t in l.get('tasks', []):
                segno = {'done': 'x', 'doing': '>', 'blocked': '!'}.get(t.get('state'), ' ')
                nota = f"  — {t['note']}" if t.get('note') else ''
                print(f"    [{segno}] {t.get('id')}  {t.get('text')}{nota}")
        return

    if cmd == 'new':
        if not resto:
            sys.exit('serve un titolo: todo.py new "Titolo della lista"')
        lid = str(uuid.uuid4())
        dati[lid] = {'title': resto[0], 'created': int(time.time() * 1000),
                     '__status': 'active', 'tasks': []}
        scrivi(dati)
        print(lid)
        return

    if not resto:
        sys.exit(f'{cmd}: serve l\'id della lista')
    lid, args = resto[0], resto[1:]
    l = lista(dati, lid)

    if cmd == 'add':
        if not args:
            sys.exit('serve almeno un task: todo.py add <list-id> "primo" "secondo"')
        l.setdefault('tasks', [])
        for testo in args:
            tid = prossimo_id(l)
            l['tasks'].append({'id': tid, 'text': testo, 'state': 'todo'})
            print(tid)
    elif cmd == 'set':
        if len(args) != 2 or args[1] not in STATI_TASK:
            sys.exit(f'todo.py set <list-id> <task-id> <{"|".join(STATI_TASK)}>')
        for t in l.get('tasks', []):
            if t.get('id') == args[0]:
                t['state'] = args[1]
                break
        else:
            sys.exit(f'task «{args[0]}» non trovato in questa lista')
    elif cmd == 'note':
        if len(args) != 2:
            sys.exit('todo.py note <list-id> <task-id> "il perché"')
        for t in l.get('tasks', []):
            if t.get('id') == args[0]:
                if args[1]:
                    t['note'] = args[1]
                else:
                    t.pop('note', None)
                break
        else:
            sys.exit(f'task «{args[0]}» non trovato in questa lista')
    elif cmd == 'status':
        if len(args) != 1 or args[0] not in STATI_LISTA:
            sys.exit(f'todo.py status <list-id> <{"|".join(STATI_LISTA)}>')
        l['__status'] = args[0]
    else:
        sys.exit(f'comando sconosciuto: {cmd}')

    scrivi(dati)


if __name__ == '__main__':
    main(sys.argv[1:])
