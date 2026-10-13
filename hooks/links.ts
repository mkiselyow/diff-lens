export type Target = { path: string; line: number | null }
export type Rewritten = { text: string; hrefs: string[]; pressable: string[]; changed: number }

const SCHEME = 'file://'
const LINK = /\]\(([^)\s]+)\)/g
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i

export const toRelative = (path: string, cwd: string): string | null => {
  if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1)
  if (path.startsWith('/')) return null

  return path.replace(/^\.\//, '')
}

export const splitLine = (target: string): Target => {
  const match = /^(.*?)(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)?$/.exec(target)
  const line = match?.[2] ?? match?.[3]

  return { path: decode(match?.[1] ?? target), line: line === undefined ? null : Number(line) }
}

const decode = (path: string): string => {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

export const toHref = (cwd: string, target: Target): string =>
  `${SCHEME}${encodeURI(`${cwd}/${target.path}`)}${target.line === null ? '' : `#L${target.line}`}`

export const fromHref = (href: string, cwd: string): Target | null => {
  if (!href.startsWith(SCHEME)) return null
  const target = splitLine(href.slice(SCHEME.length))
  const path = toRelative(target.path, cwd)

  return path === null ? null : { path, line: target.line }
}

export const rewrite = (text: string, cwd: string, isChanged: (path: string) => boolean): Rewritten => {
  const hrefs: string[] = []
  const pressable: string[] = []
  let changed = 0
  const rewriteProse = (prose: string): string =>
    prose.replace(LINK, (whole: string, raw: string) => {
      const isFile = raw.startsWith(SCHEME)
      if (EXTERNAL.test(raw) && !isFile) return whole
      const target = splitLine(isFile ? raw.slice(SCHEME.length) : raw)
      const path = toRelative(target.path, cwd)
      if (path === null) return whole
      const href = toHref(cwd, { path, line: target.line })
      if (isChanged(path)) {
        changed++
        if (!pressable.includes(href)) pressable.push(href)
      }
      if (!hrefs.includes(href)) hrefs.push(href)

      return `](${href})`
    })
  const pieces = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
  const out = pieces.map((piece, i) => (i % 2 === 1 ? piece : rewriteProse(piece))).join('')

  return { text: out, hrefs, pressable, changed }
}
