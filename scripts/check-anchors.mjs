// Checks every site-internal link in docs/: the target page must exist and,
// when the link carries a #fragment, the target page must define that anchor.
// VitePress itself only fails the build on missing pages, not on anchors.
//
// Usage: node scripts/check-anchors.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'docs')

// The slug rules VitePress applies to headings without an explicit {#id}.
const rControl = /[\u0000-\u001f]/g
const rSpecial = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g
const rCombining = /[\u0300-\u036F]/g
const slugify = (s) =>
  s.normalize('NFKD').replace(rCombining, '').replace(rControl, '').replace(rSpecial, '-')
    .replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, '_$1').toLowerCase()

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'public' || name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (name.endsWith('.md')) out.push(path)
  }
  return out
}

function routeOf(file) {
  const rel = relative(root, file).split(sep).join('/').replace(/\.md$/, '')
  if (rel === 'index') return '/'
  if (rel.endsWith('/index')) return '/' + rel.slice(0, -'index'.length)
  return '/' + rel
}

// Strip fenced code blocks so headings and links inside examples are ignored.
function prose(text) {
  const lines = text.split('\n')
  const out = []
  let fence = null
  for (const line of lines) {
    const m = line.match(/^\s*(`{3,}|~{3,})/)
    if (m) {
      if (!fence) fence = m[1]
      else if (line.trim().startsWith(fence)) fence = null
      out.push('')
      continue
    }
    out.push(fence ? '' : line)
  }
  return out.join('\n')
}

function headingText(raw) {
  return raw
    .replace(/<Badge[^>]*\/>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .trim()
}

const pages = new Map()
for (const file of walk(root)) {
  const body = prose(readFileSync(file, 'utf8'))
  const anchors = new Set()
  const seen = new Map()
  for (const line of body.split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.*?)\s*$/)
    if (!m) continue
    let text = m[2]
    const custom = text.match(/\{#([^}]+)\}\s*$/)
    if (custom) {
      anchors.add(custom[1])
      continue
    }
    let slug = slugify(headingText(text))
    if (seen.has(slug)) {
      const n = seen.get(slug)
      seen.set(slug, n + 1)
      slug = `${slug}-${n}`
    } else seen.set(slug, 1)
    anchors.add(slug)
  }
  pages.set(routeOf(file), { file, body, anchors })
}

function resolve(target) {
  let path = target.replace(/\.(md|html)$/, '')
  if (pages.has(path)) return pages.get(path)
  if (!path.endsWith('/') && pages.has(path + '/')) return pages.get(path + '/')
  return null
}

const problems = []
for (const [route, page] of pages) {
  const raw = readFileSync(page.file, 'utf8')
  const links = []
  for (const m of page.body.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) links.push(m[1])
  for (const m of raw.matchAll(/^\s*link:\s*(\S+)\s*$/gm)) links.push(m[1])
  for (const link of links) {
    if (/^[a-z]+:/i.test(link)) continue
    const [path, fragment] = link.split('#')
    let target
    if (path === '') target = page
    else if (path.startsWith('/')) target = resolve(path)
    else {
      problems.push(`${route}: relative link ${link}`)
      continue
    }
    if (!target) {
      problems.push(`${route}: missing page ${link}`)
      continue
    }
    if (fragment && !target.anchors.has(decodeURIComponent(fragment))) {
      problems.push(`${route}: missing anchor ${link}`)
    }
  }
}

if (problems.length) {
  console.log(problems.join('\n'))
  console.log(`\n${problems.length} problem(s) in ${pages.size} pages`)
  process.exit(1)
}
console.log(`ok: ${pages.size} pages, all internal links and anchors resolve`)
