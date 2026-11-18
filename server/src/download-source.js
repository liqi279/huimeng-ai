'use strict';

const TRUSTED_DOWNLOAD_SUFFIXES = [
  '.aliyuncs.com',
  '.aliyuncdn.com',
  '.myqcloud.com',
  '.tencentcos.cn',
  '.rayinai.com',
  '.tuba.ink',
  '.pollinations.ai',
];

function hostnameOf(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase().replace(/\.$/, '');
  } catch (err) {
    return '';
  }
}

function isTrustedDownloadHost(hostname, req, config) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;

  const ownHost = String(req && req.headers && req.headers.host || '')
    .split(':')[0].toLowerCase().replace(/\.$/, '');
  if (host === ownHost || host === 'localhost' || /^127\./.test(host)) return true;
  if (TRUSTED_DOWNLOAD_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  const conf = config || {};
  const configuredHosts = [
    conf.RAYIN_BASE,
    conf.COS_PUBLIC_BASE,
    conf.S3_PUBLIC_BASE,
    conf.S3_ENDPOINT,
    conf.OSS_PUBLIC_BASE,
    conf.OSS_ENDPOINT,
  ].map(hostnameOf).filter(Boolean);
  return configuredHosts.includes(host);
}

function isConfiguredCosHost(hostname, config) {
  const conf = config || {};
  const bucket = String(conf.COS_BUCKET || conf.S3_BUCKET || '').trim().toLowerCase();
  const region = String(conf.COS_REGION || conf.S3_REGION || '').trim().toLowerCase()
    .replace(/^cos\./, '').replace(/^oss-/, '');
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return Boolean(bucket && region && (
    host === bucket + '.cos.' + region + '.myqcloud.com' ||
    host === bucket + '.cos.' + region + '.tencentcos.cn'
  ));
}

async function fetchTrustedDownload(target, req, config, fetchImpl) {
  const request = fetchImpl || fetch;
  let current = target instanceof URL ? target : new URL(String(target));
  for (let hop = 0; hop <= 3; hop += 1) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw Object.assign(new Error('不支持的下载协议'), { status: 400, expose: true });
    }
    if (current.username || current.password || !isTrustedDownloadHost(current.hostname, req, config)) {
      throw Object.assign(new Error('不允许的下载来源'), { status: 400, expose: true });
    }
    const response = await request(current.toString(), { redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers && response.headers.get('location');
    if (!location || hop === 3) {
      throw Object.assign(new Error('下载地址重定向失败'), { status: 502, expose: true });
    }
    try {
      current = new URL(location, current);
    } catch (err) {
      throw Object.assign(new Error('下载地址重定向无效'), { status: 502, expose: true });
    }
  }
}

module.exports = { hostnameOf, isTrustedDownloadHost, isConfiguredCosHost, fetchTrustedDownload };
