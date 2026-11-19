// No third-party dependencies; build first, validate everything, publish the channel last.
import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const publicKey = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDg1OUMxMzEwQ0NDMzY4ODQKUldTRWFNUE1FQk9jaFRkNVdSZHZkRk1IbzlRUDRsQlRsUjc3TlNNd3hFeGE0UUVzR1JCbXY1UjQK'
export const targets = {
  'x86_64-apple-darwin': ['darwin-x86_64', '.app.tar.gz', ['.dmg']],
  'aarch64-apple-darwin': ['darwin-aarch64', '.app.tar.gz', ['.dmg']],
  'x86_64-unknown-linux-gnu': ['linux-x86_64', '.AppImage.tar.gz', ['.deb', '.AppImage']],
  'aarch64-unknown-linux-gnu': ['linux-aarch64', '.AppImage.tar.gz', ['.deb', '.AppImage']],
  'x86_64-pc-windows-msvc': ['windows-x86_64', '.nsis.zip', ['-setup.exe', '.msi', '.msi.zip']],
  'aarch64-pc-windows-msvc': ['windows-aarch64', '.nsis.zip', ['-setup.exe']],
}
export function betaVersion(tag) {
  if (!/^v4\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/.test(tag)) throw new Error('Expected v4.x.y-beta.N')
  return tag.slice(1)
}
export function assertForward(tag, publishedTags) {
  const candidate = betaVersion(tag).split(/[.-]/).filter(x => /^\d+$/.test(x)).map(BigInt)
  for (const previous of publishedTags.filter(t => /^v4\.\d+\.\d+-beta\.\d+$/.test(t))) {
    const parts = betaVersion(previous).split(/[.-]/).filter(x => /^\d+$/.test(x)).map(BigInt)
    const first = candidate.findIndex((n, i) => n !== parts[i])
    if (first === -1 || candidate[first] < parts[first]) throw new Error('Beta version must advance beyond published releases')
  }
}
export function manifests(tag, records, date = new Date().toISOString()) {
  const version = betaVersion(tag)
  const platforms = {}
  for (const [target, [key, suffix, installers]] of Object.entries(targets)) {
    const files = records.filter(r => r.target === target)
    if (files.some(f => f.version !== version)) throw new Error(`Version mismatch: ${target}`)
    const pick = ending => {
      const matches = files.filter(f => f.name.endsWith(ending) && f.size > 0)
      if (matches.length !== 1) throw new Error(`Expected exactly one ${target} ${ending}`)
      return matches[0]
    }
    for (const installer of installers) pick(installer)
    const asset = pick(suffix)
    if (!asset.signature?.trim()) throw new Error(`Missing signature: ${target}`)
    platforms[key] = {
      signature: asset.signature.trim(),
      url: `https://github.com/AlistGo/desktop-release/releases/download/${tag}/${encodeURIComponent(asset.name)}`,
    }
    if (key.startsWith('windows')) platforms[`${key}-nsis`] = { ...platforms[key] }
    if (key === 'windows-x86_64') {
      const msi = pick('.msi.zip')
      if (!msi.signature?.trim()) throw new Error('Missing MSI updater signature')
      platforms[`${key}-msi`] = { signature: msi.signature.trim(), url: `https://github.com/AlistGo/desktop-release/releases/download/${tag}/${encodeURIComponent(msi.name)}` }
    }
    if (key.startsWith('darwin')) platforms[`${key}-app`] = { ...platforms[key] }
  }
  const latest = { version, notes: `AList Desktop ${tag} (Beta)`, pub_date: date, platforms }
  const proxy = structuredClone(latest)
  for (const p of Object.values(proxy.platforms)) p.url = `https://ghfast.top/${p.url}`
  return { latest, proxy }
}
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const json = (...args) => JSON.parse(gh(...args))
const filesIn = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? filesIn(join(dir, e.name)) : [join(dir, e.name)])
const save = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
const repo = 'AlistGo/desktop-release'

function prepare() {
  const tag = process.env.RELEASE_TAG
  betaVersion(tag)
  // Resolve once, never resolve branch heads or latest dependencies in the matrix.
  const sourceRef = process.env.SOURCE_REF || 'v3'
  const draftOnly = process.env.DRAFT_ONLY === 'true'
  if (sourceRef !== 'v3' && !draftOnly) throw new Error('Alternate source refs are draft-only')
  const source = json('api', `repos/AlistGo/desktop/commits/${encodeURIComponent(sourceRef)}`).sha
  if (!/^[a-f0-9]{40}$/.test(source)) throw new Error('Invalid source commit')
  const core = json('api', 'repos/AlistGo/alist/releases/latest').tag_name
  const rclone = json('api', 'repos/rclone/rclone/releases/latest').tag_name
  if (!/^v3\.\d+\.\d+$/.test(core) || !/^v\d+\.\d+\.\d+$/.test(rclone)) throw new Error('Expected stable sidecars')
  // Never modify a previously published version; retries only operate on its draft.
  const releases = json('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`).flat()
  assertForward(tag, releases.filter(r => !r.draft).map(r => r.tag_name))
  const previous = releases.find(r => r.tag_name === tag)
  if (previous && !previous.draft) throw new Error('Published version is immutable; choose a new beta number')
  const plan = { tag, version: betaVersion(tag), source, core, rclone, releaseCommit: process.env.GITHUB_SHA, sourceRef, draftOnly }
  save('plan.json', plan)
  writeFileSync(process.env.GITHUB_OUTPUT, Object.entries({ source, core, rclone, tag }).map(([k, v]) => `${k}=${v}\n`).join(''), { flag: 'a' })
}
function collect() {
  const target = process.env.TARGET_TRIPLE
  if (!targets[target]) throw new Error('Unknown target')
  const version = betaVersion(process.env.RELEASE_TAG)
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (source !== process.env.EXPECTED_SOURCE) throw new Error('Source commit differs from release plan')
  const root = process.env.BUNDLE_DIR
  mkdirSync('release-assets', { recursive: true })
  const records = []
  for (const file of filesIn(root)) {
    // Exclude .app contents and loose binaries; upload only bundle outputs.
    if (file.includes('.app/')) continue
    if (!/\.(dmg|deb|AppImage|msi|exe|zip|gz)(\.sig)?$/.test(file)) continue
    const name = `${target}--${basename(file)}`
    const bytes = readFileSync(file)
    copyFileSync(file, join('release-assets', name))
    if (name.endsWith('.sig')) continue
    const sig = file + '.sig'
    let signature
    try { signature = readFileSync(sig, 'utf8') } catch { /* installer need not be signed as an updater */ }
    records.push({ target, version, source, name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), signature })
  }
  // Version stamped in all three source configurations must equal the plan.
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
  const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').split('\n[')[0]
  if (conf.plugins.updater.pubkey !== publicKey || conf.plugins.updater.endpoints.some(url => !url.includes('/releases/download/beta-v4/'))) throw new Error('Wrong signing key or update channel')
  if (pkg.version !== version || conf.version !== version || !cargo.includes(`version = "${version}"`)) throw new Error('Bundle version mismatch')
  save(`release-assets/${target}.json`, records)
}
function publish() {
  const plan = JSON.parse(readFileSync('plan.json', 'utf8'))
  const records = Object.keys(targets).flatMap(t => JSON.parse(readFileSync(`artifacts/${t}.json`, 'utf8')))
  if (records.some(r => r.source !== plan.source)) throw new Error('Mixed source commits')
  const { latest, proxy } = manifests(plan.tag, records)
  // Validate local bytes before any release mutation.
  for (const r of records) {
    const bytes = readFileSync(join('artifacts', r.name))
    if (bytes.length !== r.size || createHash('sha256').update(bytes).digest('hex') !== r.sha256) throw new Error(`Corrupt artifact: ${r.name}`)
  }
  writeFileSync('verify.pub', Buffer.from(publicKey, 'base64'))
  for (const r of records.filter(r => r.signature)) {
    writeFileSync('verify.sig', Buffer.from(r.signature.trim(), 'base64'))
    execFileSync('minisign', ['-Vm', join('artifacts', r.name), '-p', 'verify.pub', '-x', 'verify.sig', '-q'])
  }
  save('latest.json', latest)
  save('ghfast.top.proxy.json', proxy)
  save('provenance.json', plan)
  writeFileSync('SHA256SUMS', records.map(r => `${r.sha256}  ${r.name}`).join('\n') + '\n')
  const releases = json('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`).flat()
  assertForward(plan.tag, releases.filter(r => !r.draft).map(r => r.tag_name))
  let release = releases.find(r => r.tag_name === plan.tag)
  if (release && !release.draft) throw new Error('Published release cannot be replaced')
  if (!release) {
    release = json('api', '--method', 'POST', `repos/${repo}/releases`,
      '-f', `tag_name=${plan.tag}`, '-f', `target_commitish=${plan.releaseCommit}`,
      '-F', 'draft=true', '-F', 'prerelease=true', '-f', 'make_latest=false',
      '-f', `name=AList Desktop ${plan.tag}`,
      '-f', `body=Source: AlistGo/desktop@${plan.source}\nCore: ${plan.core}\nRclone: ${plan.rclone}`)
  }
  const uploads = [...filesIn('artifacts').filter(p => !p.endsWith('.json')), 'latest.json', 'ghfast.top.proxy.json', 'provenance.json', 'SHA256SUMS']
  gh('release', 'upload', plan.tag, '--repo', repo, '--clobber', ...uploads)
  const remote = json('api', '--paginate', '--slurp', `repos/${repo}/releases/${release.id}/assets?per_page=100`).flat()
  for (const path of uploads) {
    const asset = remote.find(a => a.name === basename(path))
    const bytes = readFileSync(path)
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    if (!asset || asset.size !== bytes.length || asset.digest !== digest) throw new Error(`Remote digest mismatch: ${basename(path)}`)
  }
  save('verified.json', { ...plan, releaseId: release.id, assetCount: uploads.length, verifiedAt: new Date().toISOString() })
  if (plan.draftOnly) {
    console.log(`Verified draft ${plan.tag}; public release and beta-v4 are unchanged`)
    return
  }
  gh('release', 'edit', plan.tag, '--repo', repo, '--draft=false', '--prerelease', '--latest=false')
  // Download assets always point at immutable versioned releases. Advance raw manifest LAST.
  let channel = releases.find(r => r.tag_name === 'beta-v4')
  if (!channel) {
    gh('release', 'create', 'beta-v4', '--repo', repo, '--target', plan.releaseCommit, '--prerelease', '--latest=false', '--title', 'AList Desktop 4.x Beta', '--notes', '4.x Beta update channel. Download installers from the versioned releases.')
    channel = json('api', `repos/${repo}/releases/tags/beta-v4`)
  }
  if (!channel.prerelease) throw new Error('beta-v4 must be a prerelease')
  gh('release', 'edit', 'beta-v4', '--repo', repo, '--prerelease', '--latest=false', '--notes', `Latest 4.x Beta installers: https://github.com/${repo}/releases/tag/${plan.tag}\nSource: AlistGo/desktop@${plan.source}\nBack up your data before switching from 3.x.`)
  gh('release', 'upload', 'beta-v4', '--repo', repo, '--clobber', 'ghfast.top.proxy.json', 'provenance.json', 'latest.json')
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const commands = { prepare, collect, publish }
  if (!commands[process.argv[2]]) throw new Error('Expected prepare, collect or publish')
  commands[process.argv[2]]()
}
