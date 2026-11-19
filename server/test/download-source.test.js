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
    assert.ok(code.includes("if (isDimverseRoute()) syncDimverseFromLocation()"));
    assert.ok(code.includes("addEventListener('popstate', syncDimverseFromLocation)"));
    assert.ok(code.includes("document.body.classList.add('dv-open')"), 'original page shell is shown for the Dimverse route');
    assert.ok(code.includes("showDimPage()"), 'Dimverse content is rendered inside the original page');
    assert.ok(!code.includes('openGodotDimverse'), 'the route does not replace the original page with a Godot full-screen shell');
  }
  assert.ok(html.includes('./assets/hm-s29-b9fa10c0.js'), 'Pages HTML loads the patched Dimverse asset');
  const standalone = fs.readFileSync(require.resolve('../../deploy/dimverse/index.html'), 'utf8');
  assert.ok(standalone.includes('<title>次元宇宙 · 绘梦</title>'));
  assert.ok(standalone.includes("searchParams.set('view', 'dimverse')"), 'standalone route returns to the original page with the Dimverse view');
  assert.ok(!standalone.includes('game/index.html'), 'standalone route does not launch the Godot splash screen');
  assert.ok(source.includes('function enterDimverse()') && source.includes('showDimPage()'));

  const sourceStyles = fs.readFileSync(require.resolve('../../frontend/styles.css'), 'utf8');
  const deployedStyles = fs.readFileSync(require.resolve('../../deploy/assets/hm.css'), 'utf8');
  for (const code of [source, deployed]) {
    assert.ok(code.includes('startTitleParticleIntro'), 'welcome title is built by particle animation');
    assert.ok(code.includes('1000 / 30'), 'background vortex is throttled to reduce continuous CPU usage');
    assert.ok(code.includes('1000 / 45'), 'particle intro rendering is frame-throttled');
    assert.ok(code.includes('translate3d('), 'floating symbols update via compositor transforms');
    assert.ok(code.includes('mctx.measureText(titleText)'), 'particle target points have a font-metrics fallback');
    assert.ok(code.includes('style.fontWeight, style.fontSize, style.fontFamily'), 'canvas text mask uses a valid font shorthand');
    assert.ok(code.includes('prepareTitleCharacters'), 'title characters are prepared for independent glitch timing');
    assert.ok(code.includes('六边形能量屏障'), 'particle reveal transitions into a cyber shield');
    assert.ok(code.includes('data-text="欢迎来到次元宇宙"'), 'welcome title exposes glitch layers');
    assert.ok(!code.includes('页面正开发中'), 'placeholder copy is removed');
    assert.ok(!code.includes('2D 横版'), 'view-mode labels are removed');
  }
  for (const css of [sourceStyles, deployedStyles]) {
    assert.ok(css.includes('text-shadow:\n    0 1px 0 #c4b5fd'), 'welcome title has layered 3D extrusion shadows');
    assert.ok(css.includes('will-change: transform;'), 'floating symbols use compositor-friendly transforms');
    assert.ok(css.includes('.hm-update-modal:not([hidden]) .hm-update-icon svg'), 'update notice refresh icon spins only while the notice is visible');
    assert.ok(css.includes('@keyframes hmUpdateIconSpin'), 'refresh icon rotation animation is defined');
    assert.ok(css.includes('animation: none'), 'reduced-motion preference disables the refresh icon spin');
    assert.ok(css.includes('.dv-title-particles'), 'particle canvas is layered over the welcome title');
    assert.ok(css.includes('@keyframes dv-char-jitter'), 'each character has an independent glitch animation');
    assert.ok(css.includes('@keyframes dv-char-cyan'), 'each character has independent cyan glitch slices');
    assert.ok(css.includes('@keyframes dv-char-pink'), 'each character has independent magenta glitch slices');
    assert.ok(css.includes('prefers-reduced-motion'), 'reduced-motion preference is respected');
    assert.ok(!css.includes('.dv-sub {'), 'placeholder subtitle styles are removed');
    assert.ok(!css.includes('.dv-meta {'), 'view-mode label styles are removed');
  }



  const godotScript = fs.readFileSync(require.resolve('../../game/dimverse-godot/main.gd'), 'utf8');
  const godotProject = fs.readFileSync(require.resolve('../../game/dimverse-godot/project.godot'), 'utf8');
  assert.ok(source.includes("el('button', 'dv-start-btn is-pending', '开启')"), 'the opening button starts hidden while the title intro runs');
  assert.ok(deployed.includes("el('button', 'dv-start-btn is-pending', '开启')"), 'the production button starts hidden too');
  assert.ok(source.includes("startTitleParticleIntro(dimPage.querySelector('.dv-center'), title, function ()"), 'page entry first runs the title particle and cyber shield intro');
  assert.ok(source.includes("dimStartBtn.classList.add('is-ready')"), 'the start button is revealed only after the title intro callback');
  assert.ok(source.includes("title.classList.add('dv-title-dissolving')"), 'clicking start dissolves the title upward');
  assert.ok(source.includes("ensureGodotOverlay();"), 'the Godot layer is loaded only after the start button is clicked');
  assert.ok(!source.includes("startTitleParticleIntro(center, center.querySelector('.dv-title'))"), 'clicking start does not replay the title-assembly animation');
  assert.equal(deployed, source, 'the production Dimverse bundle must match the canonical controller source');
  assert.ok(source.includes("new URL('./dimverse/game/index.html'"), 'Godot is embedded as a relative overlay resource');
  assert.ok(deployed.includes("new URL('./dimverse/game/index.html'"), 'the production bundle points to the exported Godot game');
  assert.ok(source.includes("event.data === 'hm-godot-ready'"), 'the Godot loader is hidden until the transparent canvas is ready');
  assert.ok(deployed.includes("event.data === 'hm-godot-ready'"), 'the production bundle listens for the Godot ready signal');
  assert.ok(source.includes("event.data === 'hm-godot-landed'"), 'landing reveals the page-native controls tutorial');
  assert.ok(sourceStyles.includes('.dv-godot-overlay') && sourceStyles.includes('background: transparent !important'), 'Godot overlay does not paint over the original page');
  assert.ok(deployedStyles.includes('.dv-start-btn'), 'the deployed stylesheet makes the opening button visible');
  assert.ok(deployedStyles.includes('.dv-godot-overlay'), 'the deployed stylesheet configures the transparent game overlay');
  assert.ok(godotProject.includes('viewport/transparent_background=true'), 'Godot viewport is configured with alpha transparency');
  assert.ok(godotScript.includes('Deliberately no world/background/grid drawing'), 'Godot only draws the mascot/gameplay layer');
  assert.ok(!godotScript.includes('_draw_cyber_world'), 'Godot does not redraw the webpage background');
  assert.ok(godotScript.includes('JavaScriptBridge.create_callback(_on_start_from_web)'), 'the page button starts the Godot intro through the browser bridge');
  assert.ok(godotScript.includes('IntroState.TITLE_PARTICLES') && godotScript.includes('IntroState.MASCOT_FALL'), 'Godot owns the particle-to-mascot intro states');
  assert.ok(godotScript.includes('rng.randf_range(350.0, 930.0)') && godotScript.includes('rng.randf_range(335.0, 405.0)'), 'mascot particles rise from the original welcome-title band');

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
