export function parseDeckFile(text: string): string[] {
  const out: string[] = []
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const m = /^(\d+)\s+(\S+)$/.exec(line)
    if (!m) throw new Error(`deck line ${i + 1}: expected "<count> <code>", got "${line}"`)
    for (let k = 0; k < Number(m[1]); k++) out.push(m[2] as string)
  })
  return out
}
