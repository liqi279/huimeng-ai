#!/usr/bin/env node
'use strict';

/* =============================================================
 * 绘梦 · 图书馆种子数据导入
 * 把 data/library/books.seed.json 写入 MySQL（表结构见 schema.sql）
 *
 * 用法：
 *   node data/mysql/import-seed.js
 * 环境变量（默认值即本地开发配置）：
 *   MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=huimeng
 *   MYSQL_PASSWORD=huimeng_lib_2026 MYSQL_DATABASE=huimeng_library
 * ============================================================= */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const serverRequire = createRequire(path.join(__dirname, '..', '..', 'server', 'package.json'));

let mysql;
try {
  mysql = serverRequire('mysql2/promise');
} catch (err) {
  console.error('未找到 mysql2。请先在 server/ 目录执行：npm install mysql2');
  process.exit(1);
}

const SEED_FILE = path.join(__dirname, '..', 'library', 'books.seed.json');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

const cfg = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'huimeng',
  password: process.env.MYSQL_PASSWORD || 'huimeng_lib_2026',
  database: process.env.MYSQL_DATABASE || 'huimeng_library',
  charset: 'utf8mb4',
  multipleStatements: true,
};

async function main() {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const conn = await mysql.createConnection(cfg);

  try {
    await conn.query(schema);
    console.log('表结构已就绪');

    let books = 0;
    let pages = 0;
    for (let i = 0; i < seed.books.length; i++) {
      const b = seed.books[i];
      const now = Date.now();
      await conn.execute(
        `INSERT INTO books (id, title, author, category, tags, intro, accent, cover_url, sort_no, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
         ON DUPLICATE KEY UPDATE title=VALUES(title), author=VALUES(author), category=VALUES(category),
           tags=VALUES(tags), intro=VALUES(intro), accent=VALUES(accent), sort_no=VALUES(sort_no), updated_at=VALUES(updated_at)`,
        [
          b.id,
          b.title,
          b.author || '',
          b.category || '未分类',
          Array.isArray(b.tags) ? b.tags.join(',') : (b.tags || ''),
          b.intro || '',
          b.accent || '#7d5a3c',
          i,
          now,
          now,
        ]
      );
      books++;

      await conn.execute('DELETE FROM book_pages WHERE book_id = ?', [b.id]);
      const rows = (b.pages || []).map((p, idx) => [
        b.id,
        idx + 1,
        p.title || '第 ' + (idx + 1) + ' 页',
        p.content || '',
      ]);
      if (rows.length) {
        await conn.query(
          'INSERT INTO book_pages (book_id, page_no, title, content) VALUES ?',
          [rows]
        );
        pages += rows.length;
      }
    }

    console.log(`导入完成：${books} 本书 / ${pages} 页`);
    const [stat] = await conn.query(
      "SELECT @@innodb_data_file_path AS data_path, @@innodb_autoextend_increment AS increment"
    );
    console.log('InnoDB 表空间：', stat[0]);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('导入失败：', err && err.message ? err.message : err);
  process.exit(1);
});
