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
