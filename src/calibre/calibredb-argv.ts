// argv for calibredb calls whose last arguments are user-supplied text (#518, from #500): the
// `--` guard lives here so every tool that passes a path or query positionally shares it.

/**
 * argv for a calibredb subcommand whose last arguments are user text. A positional starting
 * with "-" would be read as a flag (`--help`, `-s`), so then the options go first and `--`
 * ends option parsing; otherwise the argv keeps calibredb's documented order.
 */
export function calibredbArgv(head: string[], positionals: string[], options: string[] = []): string[] {
  return positionals.some((p) => p.startsWith("-"))
    ? [...head, ...options, "--", ...positionals]
    : [...head, ...positionals, ...options];
}
