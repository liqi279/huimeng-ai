-- =============================================================
-- 绘梦 · 图书馆 MySQL 数据结构
-- 库：huimeng_library（字符集 utf8mb4，排序 utf8mb4_unicode_ci）
-- 存储：InnoDB，表空间上限 500G（见同目录 my.cnf）
-- 导入：mysql -u root -p < schema.sql   （或运行 init-library.sh）
-- =============================================================

CREATE DATABASE IF NOT EXISTS huimeng_library
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE huimeng_library;

/* ---------------- 书籍主表 ---------------- */
CREATE TABLE IF NOT EXISTS books (
  id          VARCHAR(64)   NOT NULL COMMENT '书籍 ID（lib-0001 形式）',
  title       VARCHAR(255)  NOT NULL COMMENT '书名',
  author      VARCHAR(255)  NOT NULL DEFAULT '' COMMENT '作者',
  category    VARCHAR(120)  NOT NULL DEFAULT '未分类' COMMENT '分类',
  tags        VARCHAR(255)  NOT NULL DEFAULT '' COMMENT '标签，逗号分隔',
  intro       TEXT          NULL COMMENT '简介',
  accent      VARCHAR(20)   NOT NULL DEFAULT '#7d5a3c' COMMENT '封面色调',
  cover_url   VARCHAR(500)  NOT NULL DEFAULT '' COMMENT '封面图地址（留空用统一模板）',
  area        VARCHAR(16)   NOT NULL DEFAULT '' COMMENT '区域：ref/psd/anim/paint/concept',
  pdf_url     VARCHAR(500)  NOT NULL DEFAULT '' COMMENT 'PDF 地址（正文放对象存储，不入库）',
  page_count  INT           NOT NULL DEFAULT 0  COMMENT 'PDF 真实页数，0 表示未知',
  toc         LONGTEXT      NULL COMMENT '章节目录 JSON：[{title,page}]，页码从 1 开始',
  sort_no     INT           NOT NULL DEFAULT 0 COMMENT '书架排序',
  created_at  BIGINT        NOT NULL DEFAULT 0 COMMENT '创建时间（毫秒）',
  updated_at  BIGINT        NOT NULL DEFAULT 0 COMMENT '更新时间（毫秒）',
  PRIMARY KEY (id),
  KEY idx_books_title (title),
  KEY idx_books_author (author),
  KEY idx_books_category (category),
  KEY idx_books_area (area),
  KEY idx_books_sort (sort_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='图书馆书籍主表';

/* ---------------- 书籍内页 ---------------- */
CREATE TABLE IF NOT EXISTS book_pages (
  id        BIGINT       NOT NULL AUTO_INCREMENT,
  book_id   VARCHAR(64)  NOT NULL,
  page_no   INT          NOT NULL COMMENT '页序号，从 1 开始；0 为自动生成的目录页',
  title     VARCHAR(255) NOT NULL DEFAULT '',
  content   MEDIUMTEXT   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_book_page (book_id, page_no),
  KEY idx_pages_book (book_id),
  CONSTRAINT fk_pages_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='书籍内页正文';

/* ---------------- 收藏 ---------------- */
CREATE TABLE IF NOT EXISTS book_favorites (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  user_key   VARCHAR(64) NOT NULL DEFAULT 'guest' COMMENT '用户标识（登录 ID 或 guest）',
  book_id    VARCHAR(64) NOT NULL,
  created_at BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_fav_user_book (user_key, book_id),
  KEY idx_fav_user (user_key),
  CONSTRAINT fk_fav_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='书籍收藏';

/* ---------------- 阅读历史 / 续读位置 ---------------- */
CREATE TABLE IF NOT EXISTS reading_history (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  user_key   VARCHAR(64) NOT NULL DEFAULT 'guest',
  book_id    VARCHAR(64) NOT NULL,
  last_page  INT         NOT NULL DEFAULT 0 COMMENT '上次读到的页（0 = 目录页）',
  opened_at  BIGINT      NOT NULL DEFAULT 0 COMMENT '最近打开时间（毫秒）',
  PRIMARY KEY (id),
  UNIQUE KEY uk_hist_user_book (user_key, book_id),
  KEY idx_hist_user_time (user_key, opened_at),
  CONSTRAINT fk_hist_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='阅读历史与续读位置';

/* ---------------- 搜索热词（搜索推荐用） ---------------- */
CREATE TABLE IF NOT EXISTS search_terms (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  term       VARCHAR(120) NOT NULL,
  hits       INT         NOT NULL DEFAULT 0,
  updated_at BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_term (term)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='搜索热词，用于下拉推荐';
