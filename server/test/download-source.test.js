'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { hostnameOf, isTrustedDownloadHost, isConfiguredCosHost, fetchTrustedDownload } = require('../src/download-source');
const { imageCandidates } = require('../src/image-url');

const req = { headers: { host: 'api.example.test:8787' } };

test('allows COS, CDN, and configured storage hosts', () => {
  const config = { COS_PUBLIC_BASE: 'https://images.example-cdn.test/assets' };
  for (const host of [
    'bucket.cos.ap-guangzhou.myqcloud.com',
    'cdn.tencentcos.cn',
    'oss-cn-hangzhou.aliyuncs.com',
    'img.tuba.ink',
    'image.pollinations.ai',
    'api.example.test',
    'images.example-cdn.test',
  ]) {
    assert.equal(isTrustedDownloadHost(host, req, config), true, host);
  }
});

test('does not accept lookalike or unconfigured hosts', () => {
  assert.equal(isTrustedDownloadHost('myqcloud.com.attacker.test', req, {}), false);
  assert.equal(isTrustedDownloadHost('evil-rayinai.com', req, {}), false);
  assert.equal(isTrustedDownloadHost('attacker.test', req, {}), false);
});

test('uses only a URL hostname when reading configured endpoints', () => {
  assert.equal(hostnameOf('https://cos.example.test:8443/bucket'), 'cos.example.test');
  assert.equal(hostnameOf('not a URL'), '');
  assert.equal(isTrustedDownloadHost('cos.example.test', req, {
    S3_ENDPOINT: 'https://cos.example.test:8443/bucket',
  }), true);
});

test('maps only the configured COS bucket endpoint to an object key', () => {
  const config = { COS_BUCKET: 'huimeng-123', COS_REGION: 'cos.ap-guangzhou' };
  assert.equal(isConfiguredCosHost('huimeng-123.cos.ap-guangzhou.myqcloud.com', config), true);
  assert.equal(isConfiguredCosHost('other-bucket.cos.ap-guangzhou.myqcloud.com', config), false);
  assert.equal(isConfiguredCosHost('huimeng-123.cos.ap-shanghai.myqcloud.com', config), false);
});

test('resolves both root-relative and path-relative upstream image URLs', () => {
  assert.equal(imageCandidates('/api/uploads/media/result.png', 'https://rayin.example.test/v1')[0],
    'https://rayin.example.test/api/uploads/media/result.png');
  assert.equal(imageCandidates('api/uploads/media/result.png', 'https://rayin.example.test/v1')[0],
    'https://rayin.example.test/v1/api/uploads/media/result.png');
  assert.deepEqual(imageCandidates('//attacker.example/image.png', 'https://rayin.example.test/v1'), []);
  assert.deepEqual(imageCandidates('data:image/png;base64,AAAA', 'https://rayin.example.test/v1'), []);
});

test('checks every download redirect before making the next request', async () => {
  let calls = 0;
  await assert.rejects(
    fetchTrustedDownload('https://images.example-cdn.test/start.png', req, {
      COS_PUBLIC_BASE: 'https://images.example-cdn.test',
    }, async () => {
      calls += 1;
      return { status: 302, headers: { get: () => 'https://attacker.example/steal' } };
    }),
    { status: 400, message: '不允许的下载来源' },
  );
  assert.equal(calls, 1, 'untrusted redirect target is never fetched');
});

test('resolves generated API paths against the backend origin and preserves inline URLs', () => {
  const source = fs.readFileSync(require.resolve('../../frontend/app.js'), 'utf8');
  const match = source.match(/function normalizeGeneratedImageUrl\(value\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'frontend URL normalizer exists');
  const sandbox = {
    window: { HM: { api: { mediaUrl: (value) => new URL(value, 'https://api.example.test/').href } } },
    rayinBase: () => 'https://rayin.example.test/v1',
  };
  vm.runInNewContext(match[0] + '\nthis.normalize = normalizeGeneratedImageUrl;', sandbox);
  assert.equal(sandbox.normalize('/api/uploads/media/result.png'), 'https://api.example.test/api/uploads/media/result.png');
  assert.equal(sandbox.normalize('api/uploads/media/result.png'), 'https://api.example.test/api/uploads/media/result.png');
  assert.equal(sandbox.normalize('data:image/png;base64,Zm9v'), 'data:image/png;base64,Zm9v');
  assert.equal(sandbox.normalize('blob:https://app.example.test/id'), 'blob:https://app.example.test/id');
  assert.equal(sandbox.normalize('https://cdn.example.test/result.png'), 'https://cdn.example.test/result.png');
});
test('download route uses the shared allowlist and validates every redirect hop', () => {
  const source = fs.readFileSync(require.resolve('../src/index.js'), 'utf8');
  assert.match(source, /require\(['"]\.\/download-source['"]\)/);
  assert.match(source, /isConfiguredCosHost\(host, config\)/);
  assert.match(source, /isTrustedDownloadHost\(host, req, config\)/);
  assert.match(source, /fetchTrustedDownload\(target, req, config\)/);
  assert.doesNotMatch(source, /fetch\(target\.toString\(\), \{ redirect: ['"]follow['"] \}\)/);
});test('次元宇宙专属路由保留 hm_v、其他参数和 hash，并进入实际 Pages 产物', () => {
  const source = fs.readFileSync(require.resolve('../../frontend/dimverse.js'), 'utf8');
  const deployed = fs.readFileSync(require.resolve('../../deploy/assets/hm-s29-b9fa10c0.js'), 'utf8');
  const html = fs.readFileSync(require.resolve('../../deploy/index.html'), 'utf8');

  for (const code of [source, deployed]) {
    assert.ok(code.includes("searchParams.set('view', 'dimverse')"));
    assert.ok(code.includes("searchParams.set('view', 'dimverse')"));
    assert.ok(code.includes("addEventListener('popstate', syncDimverseFromLocation)"));
    assert.ok(code.includes('if (isDimverseRoute()) syncDimverseFromLocation()'));
  }
  assert.ok(html.includes('./assets/hm-s29-b9fa10c0.js'), 'Pages HTML loads the patched Dimverse asset');
  const standalone = fs.readFileSync(require.resolve('../../deploy/dimverse/index.html'), 'utf8');
  assert.match(standalone, /<title>次元宇宙 · 绘梦<\/title>/);
  assert.ok(standalone.includes('src="../?view=dimverse"'));
  assert.match(source, /window\.top !== window\.self/);

  const sourceStyles = fs.readFileSync(require.resolve('../../frontend/styles.css'), 'utf8');
  const deployedStyles = fs.readFileSync(require.resolve('../../deploy/assets/hm.css'), 'utf8');
  for (const code of [source, deployed]) {
    assert.ok(code.includes('data-text="欢迎来到次元宇宙"'), 'welcome title exposes glitch layers');
    assert.ok(!code.includes('页面正开发中'), 'placeholder copy is removed');
    assert.ok(!code.includes('2D 横版'), 'view-mode labels are removed');
  }
  for (const css of [sourceStyles, deployedStyles]) {
    assert.ok(css.includes('@keyframes dv-title-entry'), 'cyber glitch entrance animation exists');
    assert.ok(css.includes('@keyframes dv-title-glitch'), 'subtle recurring glitch animation exists');
    assert.ok(css.includes('prefers-reduced-motion'), 'reduced-motion preference is respected');
    assert.ok(!css.includes('.dv-sub {'), 'placeholder subtitle styles are removed');
    assert.ok(!css.includes('.dv-meta {'), 'view-mode label styles are removed');
  }



  const original = new URL('https://liqi279.github.io/huimeng-ai/?hm_v=1795054083561&lang=zh#top');
  original.searchParams.set('view', 'dimverse');
  assert.equal(original.pathname, '/huimeng-ai/');
  assert.equal(original.searchParams.get('view'), 'dimverse');
  assert.equal(original.searchParams.get('hm_v'), '1795054083561');
  assert.equal(original.searchParams.get('lang'), 'zh');
  assert.equal(original.hash, '#top');

  original.searchParams.delete('view');
  assert.equal(original.searchParams.has('view'), false);
  assert.equal(original.searchParams.get('hm_v'), '1795054083561');
  assert.equal(original.searchParams.get('lang'), 'zh');
  assert.equal(original.hash, '#top');
});
