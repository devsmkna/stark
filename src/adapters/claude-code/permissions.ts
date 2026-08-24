// Da categoria canonica ai tool di Claude Code.
//
// Sta qui e non altrove per la regola del §1: i nomi dei tool sono vocabolario
// dell'agent, e la UI non deve conoscerli. Il pannello dei permessi mostra sei
// categorie che un utente riconosce; a sapere che «comandi shell» vuol dire `Bash`,
// `BashOutput` e `KillShell` è questo file, e nessun altro.
//
// Il set dei matcher È il pannello dei permessi (ADR-008): l'hook `PreToolUse` gira su
// ogni chiamata, e ciò che non è in elenco non viene nemmeno guardato.

import type { PermissionCategory } from '../../core/events.ts'

/**
 * I tool di ciascuna categoria. `external` è a parte perché non è una lista: i server
 * MCP portano nomi che nascono col server, quindi si intercetta la forma `mcp__*`.
 */
const TOOLS: Record<PermissionCategory, string[]> = {
  shell: ['Bash', 'BashOutput', 'KillShell'],
  edit: ['Write', 'Edit', 'NotebookEdit'],
  read: ['Read', 'Glob', 'Grep'],
  net: ['WebFetch', 'WebSearch'],
  agents: ['Task', 'Agent'],
  external: ['mcp__*'],
}

/**
 * I matcher per le categorie su cui l'utente vuole essere interrogato.
 *
 * Chi non compare qui non produce nessun hook, e quindi nessun costo: `auto` mode
 * decide da solo e non interrompe. È il motivo per cui il default «fai pure» non è
 * una rinuncia — è l'assenza di attrito, non l'assenza di controlli.
 */
export function askToolsFor(categorie: PermissionCategory[]): string[] {
  return categorie.flatMap(c => TOOLS[c] ?? [])
}

/** A quale categoria appartiene un tool. Serve a raccontare *perché* è stato chiesto. */
export function categoryOf(tool: string): PermissionCategory | undefined {
  if (tool.startsWith('mcp__')) return 'external'
  for (const [cat, tools] of Object.entries(TOOLS)) {
    if (tools.includes(tool)) return cat as PermissionCategory
  }
  return undefined
}
