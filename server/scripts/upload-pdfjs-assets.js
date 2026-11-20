'use strict';

const fs = require('fs');
const path = require('path');
const COS = require('cos-nodejs-sdk-v5');

const secretId = process.env.COS_SECRET_ID;
const secretKey = process.env.COS_SECRET_KEY;
const bucket = process.env.COS_BUCKET;
const region = process.env.COS_REGION;

if (!secretId || !secretKey || !bucket || !region) {
  throw new Error('缺少 COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION，拒绝发布 PDF.js 资源。');
}

const root = path.resolve(__dirname, '../../deploy/vendor/pdfjs');
const files = [
  { name: 'pdf.min.js', type: 'application/javascript; charset=utf-8' },
  { name: 'pdf.worker.min.js', type: 'application/javascript; charset=utf-8' },
];

const cos = new COS({ SecretId: secretId, SecretKey: secretKey });

function put(params) {
  return new Promise((resolve, reject) => {
    cos.putObject(params, (err, data) => err ? reject(err) : resolve(data));
  });
}

(async () => {
  for (const file of files) {
    const localPath = path.join(root, file.name);
    if (!fs.existsSync(localPath)) throw new Error('找不到 PDF.js 发布文件：' + localPath);
    const stat = fs.statSync(localPath);
    await put({
      Bucket: bucket,
      Region: region,
      Key: 'library/vendor/pdfjs/' + file.name,
      Body: fs.createReadStream(localPath),
      ContentLength: stat.size,
      ContentType: file.type,
      CacheControl: 'public, max-age=31536000, immutable',
    });
    console.log('[pdfjs-cos] uploaded ' + file.name + ' (' + stat.size + ' bytes)');
  }
  console.log('[pdfjs-cos] all assets uploaded');
})().catch((err) => {
  console.error('[pdfjs-cos] upload failed:', err && err.message ? err.message : err);
  process.exitCode = 1;
});
