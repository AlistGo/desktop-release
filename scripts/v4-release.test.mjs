import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertForward, betaVersion, manifests, targets } from './v4-release.mjs'
const tag = 'v4.0.0-beta.1'
function fixture() {
  return Object.entries(targets).flatMap(([target, [, suffix, installers]]) => [suffix, ...installers].map(end => ({ target, version: tag.slice(1), size: 123, name: `${target}--alist-desktop_4.0.0-beta.1${end}`, signature: (end === suffix || end === '.msi.zip') ? 'signed-data' : undefined })))
}
test('strict beta tags exclude stable, legacy date versions and malformed semver', () => {
  assert.equal(betaVersion(tag), '4.0.0-beta.1')
  for (const bad of ['v3.66.0', 'beta', 'v4.0.0', 'v4.0.0-rc.1', 'v4.0.0-beta.01', 'v2026.11.19-beta.1', 'v4.01.0-beta.1']) assert.throws(() => betaVersion(bad))
})
test('all six targets use immutable version URLs; proxy is derived without mutating canonical', () => {
  const { latest, proxy } = manifests(tag, fixture(), '2026-11-19T00:00:00Z')
  assert.equal(Object.keys(latest.platforms).length, 11)
  for (const [key, entry] of Object.entries(latest.platforms)) {
    assert.ok(entry.url.includes('/download/v4.0.0-beta.1/'))
    assert.equal(proxy.platforms[key].url, 'https://ghfast.top/' + entry.url)
    assert.equal(proxy.platforms[key].signature, entry.signature)
  }
})
test('missing architecture, installer, signature, duplicate updater or mixed version fails closed', () => {
  const all = fixture()
  assert.throws(() => manifests(tag, all.filter(f => f.target !== 'aarch64-apple-darwin')))
  assert.throws(() => manifests(tag, all.filter(f => !f.name.endsWith('.deb'))))
  assert.throws(() => manifests(tag, all.map(f => ({ ...f, signature: '' }))))
  assert.throws(() => manifests(tag, [...all, all[0]]))
  assert.throws(() => manifests(tag, all.map(f => ({ ...f, version: '4.0.0-beta.2' }))))
})

test('channel cannot move backward, including beta.10 vs beta.2', () => {
  assertForward('v4.0.0-beta.10', ['v3.66.0', 'beta', 'v4.0.0-beta.2'])
  assert.throws(() => assertForward('v4.0.0-beta.2', ['v4.0.0-beta.10']))
  assert.throws(() => assertForward('v4.0.0-beta.2', ['v4.0.0-beta.2']))
  assertForward('v4.1.0-beta.1', ['v4.0.0-beta.100'])
})

// Offline integration: fake API/signer isolate publication control flow from credentials/network.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

test('draft-only verifies uploads but never publishes or writes beta-v4', () => {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-release-draft-test-'))
  try {
    mkdirSync(join(dir, 'artifacts'))
    mkdirSync(join(dir, 'bin'))
    const source = 'a'.repeat(40)
    writeFileSync(join(dir, 'plan.json'), JSON.stringify({ tag, source, draftOnly: true, releaseCommit: 'b'.repeat(40) }))
    for (const target of Object.keys(targets)) {
      const rows = fixture().filter(r => r.target === target).map(r => {
        const bytes = Buffer.from(r.name)
        writeFileSync(join(dir, 'artifacts', r.name), bytes)
        return { ...r, source, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
      })
      writeFileSync(join(dir, 'artifacts', `${target}.json`), JSON.stringify(rows))
    }
    const stub = `#!${process.execPath}
const fs = require('node:fs'), crypto = require('node:crypto');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(args)+'\\n');
if (args[0] === 'api') {
  if (args.some(a => a.includes('/assets?'))) {
    const paths = fs.readdirSync('artifacts').filter(p => !p.endsWith('.json')).map(p=>'artifacts/'+p).concat(['latest.json','ghfast.top.proxy.json','provenance.json','SHA256SUMS']);
    console.log(JSON.stringify([paths.map(p=>{const b=fs.readFileSync(p); return {name:p.split('/').pop(),size:b.length,digest:'sha256:'+crypto.createHash('sha256').update(b).digest('hex')}})]));
  } else if (args.includes('POST')) console.log(JSON.stringify({id:123,draft:true}));
  else if (args.some(a=>a.includes('/releases/tags/'))) process.exit(1);
  else console.log('[[]]');
}
`
    writeFileSync(join(dir, 'bin', 'gh'), stub, { mode: 0o755 })
    writeFileSync(join(dir, 'bin', 'minisign'), `#!${process.execPath}\nprocess.exit(0)\n`, { mode: 0o755 })
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./v4-release.mjs', import.meta.url)), 'publish'], { cwd: dir, env: { ...process.env, PATH: join(dir, 'bin') + delimiter + process.env.PATH }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const calls = readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.ok(calls.some(a => a[0] === 'api' && a.includes('POST') && a.includes('draft=true')))
    assert.ok(calls.some(a => a[0] === 'release' && a[1] === 'upload'))
    assert.ok(!calls.some(a => a.includes('edit') || a.includes('beta-v4')))
    assert.equal(JSON.parse(readFileSync(join(dir, 'verified.json'), 'utf8')).draftOnly, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
