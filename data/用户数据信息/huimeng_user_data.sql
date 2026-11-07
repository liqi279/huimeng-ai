-- =============================================================
-- 绘梦 AI · 用户作品/项目数据表（跨设备同步）
-- 适用：MySQL 5.7+ / 8.0，utf8mb4
-- 依赖：同库已存在账号表 users（见 huimeng_users.sql）
-- 说明：MySQL 只存元数据与 object key，绝不存图片二进制。
--       图片/视频放在 S3 兼容对象存储（Cloudflare R2 / MinIO），
--       数据库仅记录 bucket 内的 object_key，通过短时效签名 URL 访问。
-- =============================================================

-- 数据库与账号库同库（默认 huimeng_users），此处不强制 USE，按部署环境指定。
-- CREATE DATABASE IF NOT EXISTS `huimeng_users`
--   DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- -------------------------------------------------------------
-- 作品元数据（每人每天新增 N 条，按 user_id + updated_at 增量同步）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_works` (
  `user_id`     VARCHAR(40)  NOT NULL COMMENT '归属用户（users.id）',
  `work_id`     VARCHAR(64)  NOT NULL COMMENT '前端作品 id',
  `data`        JSON         NOT NULL COMMENT '作品元数据（提示词/模型/比例/分辨率/时间等），不含二进制',
  `asset_key`   VARCHAR(255) NULL     COMMENT '对象存储 object key（主图）',
  `asset_mime`  VARCHAR(100) NULL,
  `asset_bytes` BIGINT       NOT NULL DEFAULT 0,
  `rev`         BIGINT       NOT NULL DEFAULT 1 COMMENT '乐观锁版本号，每次写入 +1',
  `deleted`     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '软删墓碑：1=已删除，保留 30 天供其它设备同步',
  `created_at`  BIGINT       NOT NULL DEFAULT 0,
  `updated_at`  BIGINT       NOT NULL DEFAULT 0 COMMENT '毫秒时间戳，增量同步游标',
  PRIMARY KEY (`user_id`, `work_id`),
  KEY `idx_work_updated` (`user_id`, `updated_at`),
  KEY `idx_work_deleted` (`user_id`, `deleted`),
  CONSTRAINT `fk_work_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='作品元数据（按用户隔离，跨设备同步）';

-- -------------------------------------------------------------
-- 文档型数据：桌面/项目文件夹树、编集、宣发、偏好
-- doc_kind ∈ desk | compile | publish | prefs
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_documents` (
  `user_id`    VARCHAR(40) NOT NULL,
  `doc_kind`   VARCHAR(32) NOT NULL COMMENT 'desk/compile/publish/prefs',
  `data`       JSON        NOT NULL,
  `rev`        BIGINT      NOT NULL DEFAULT 1,
  `updated_at` BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `doc_kind`),
  CONSTRAINT `fk_doc_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='桌面布局/项目文件夹树/编集/宣发/偏好';

-- -------------------------------------------------------------
-- 图片/视频资产索引（二进制在对象存储，这里只存 key 与校验值）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_assets` (
  `id`         VARCHAR(64)  NOT NULL COMMENT '资产 id（as_xxx）',
  `user_id`    VARCHAR(40)  NOT NULL,
  `work_id`    VARCHAR(64)  NULL     COMMENT '关联作品 id',
  `object_key` VARCHAR(255) NOT NULL COMMENT 'bucket 内路径：u/<user>/<work>/<asset>.<ext>',
  `mime`       VARCHAR(100) NULL,
  `bytes`      BIGINT       NOT NULL DEFAULT 0,
  `sha256`     CHAR(64)     NULL     COMMENT '内容哈希，便于去重/校验',
  `deleted`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_asset_user` (`user_id`, `created_at`),
  KEY `idx_asset_work` (`user_id`, `work_id`),
  CONSTRAINT `fk_asset_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='作品图片/视频资产（仅元数据，二进制在对象存储）';

-- -------------------------------------------------------------
-- 同步状态（旧数据迁移标记、设备记录）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_sync_state` (
  `user_id`     VARCHAR(40) NOT NULL,
  `state_key`   VARCHAR(64) NOT NULL COMMENT 'legacy_migrated / device_<id> …',
  `state_value` VARCHAR(255) NULL,
  `updated_at`  BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `state_key`),
  CONSTRAINT `fk_sync_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户同步状态（迁移标记/设备）';

-- -------------------------------------------------------------
-- 运维建议（不影响业务代码）
-- 1. 清理墓碑：DELETE FROM user_works WHERE deleted=1 AND updated_at < (UNIX_TIMESTAMP()*1000 - 30*86400000);
-- 2. 备份：mysqldump --single-transaction --databases huimeng_users > backup-$(date +%F).sql
-- 3. 容量查询：
--    SELECT user_id, COUNT(*) AS works FROM user_works WHERE deleted=0 GROUP BY user_id ORDER BY works DESC;
--    SELECT user_id, SUM(bytes)/1048576 AS mb FROM user_assets WHERE deleted=0 GROUP BY user_id ORDER BY mb DESC;
-- -------------------------------------------------------------
