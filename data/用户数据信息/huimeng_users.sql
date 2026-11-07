-- =============================================================
-- 绘梦 AI · 用户数据信息库（MySQL 初始化脚本）
-- 版本: v1  字符集: utf8mb4  适用: MySQL 5.7 / 8.0
--
-- 用法（二选一）：
--   1) mysql -h<host> -u<user> -p < huimeng_users.sql
--   2) 在后端启动前由 server/src/user-store-mysql.js 自动执行等价建表（幂等）
--
-- 说明：
--   * 本仓库只提交 .sql 脚本，不能提交可直接运行的数据库文件；
--     MySQL 实例需要用户自备（云 MySQL / 自建 / Render 外接实例）。
--   * 用户表里 priority 字段留空给扩展用（见文末「扩展说明」）。
-- =============================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS `huimeng_users`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `huimeng_users`;

-- -------------------------------------------------------------
-- 1. 账号表：账号 + 角色 + 审批状态
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`              VARCHAR(40)  NOT NULL                COMMENT '用户 ID，形如 u_xxxxxxxxxxxxxxxx',
  `username`        VARCHAR(64)  NOT NULL                COMMENT '登录用户名',
  `email`           VARCHAR(190)     NULL                COMMENT '邮箱（可空；唯一）',
  `salt`            VARCHAR(64)  NOT NULL                COMMENT 'pbkdf2 盐（hex 字符串）',
  `password_hash`   VARCHAR(128) NOT NULL                COMMENT 'pbkdf2-sha256 哈希（hex）',
  `role`            ENUM('user','admin') NOT NULL DEFAULT 'user'      COMMENT '角色',
  `status`          ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved' COMMENT '审批状态',
  `note`            VARCHAR(255)     NULL                COMMENT '审批备注 / 拒绝原因',
  `created_at`      BIGINT       NOT NULL                COMMENT '注册时间（毫秒时间戳）',
  `approved_at`     BIGINT           NULL                COMMENT '审批通过时间',
  `approved_by`     VARCHAR(40)      NULL                COMMENT '审批人用户 ID',
  `updated_at`      BIGINT       NOT NULL DEFAULT 0      COMMENT '最后更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_email` (`email`),
  KEY `idx_status` (`status`),
  KEY `idx_role` (`role`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账号与审批状态';

-- -------------------------------------------------------------
-- 2. 用户资料（1:1，外键 -> users.id）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_profiles` (
  `user_id`      VARCHAR(40)  NOT NULL,
  `display_name` VARCHAR(64)      NULL COMMENT '显示名（昵称）',
  `email`        VARCHAR(190)     NULL COMMENT '联系邮箱',
  `bio`          VARCHAR(500)     NULL COMMENT '个人简介',
  `avatar_url`   VARCHAR(500)     NULL COMMENT '头像地址',
  `extra`        JSON             NULL COMMENT '扩展字段（预留）',
  `updated_at`   BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_profile_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户资料';

-- -------------------------------------------------------------
-- 3. 用户偏好（1:1，外键 -> users.id）
--    后续「界面主题/语言/默认模型」等一律写这里，不要再放 localStorage
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_preferences` (
  `user_id`    VARCHAR(40) NOT NULL,
  `theme`      VARCHAR(32)     NULL COMMENT '主题 dark/light/...',
  `language`   VARCHAR(16)     NULL COMMENT '语言 zh-CN/en-US/...',
  `prefs`      JSON            NULL COMMENT '其余偏好键值对',
  `updated_at` BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_pref_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户偏好';

-- -------------------------------------------------------------
-- 4. 额度流水（预留：后续额度记录一律流水表，不改 users 表）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_quota_ledger` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    VARCHAR(40)     NOT NULL,
  `delta`      INT             NOT NULL COMMENT '变动额度，正数增加，负数扣减',
  `reason`     VARCHAR(120)        NULL COMMENT '变动原因',
  `ref_type`   VARCHAR(32)         NULL COMMENT '关联类型 work/order/manual',
  `ref_id`     VARCHAR(64)         NULL COMMENT '关联 ID',
  `created_at` BIGINT          NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ledger_user` (`user_id`, `created_at`),
  CONSTRAINT `fk_ledger_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='额度流水（预留）';

-- -------------------------------------------------------------
-- 5. 初始超级管理员
--    用户名: admin      密码: 不在本文件保留明文（见部署说明）
--    哈希算法: pbkdf2-sha256, 100000 轮, 32 字节（与后端 store.js 一致）
--    ⚠ 首次登录后请立刻在「设置 → 账号管理 → 重置密码」修改
-- -------------------------------------------------------------
INSERT IGNORE INTO `users`
  (`id`, `username`, `email`, `salt`, `password_hash`, `role`, `status`, `created_at`, `updated_at`)
VALUES
  ('u_init_admin0001', 'admin', NULL,
   '030e3d7bd88f81f9fd18f6244e08f541',
   'a6aead2cc3d4999ff8f15dd2a9ab2276ed8eb4489ee0ea9c8a648f906e045dca',
   'admin', 'approved', UNIX_TIMESTAMP(NOW(3)) * 1000, UNIX_TIMESTAMP(NOW(3)) * 1000);

-- -------------------------------------------------------------
-- 扩展说明（后续用户数据统一走这套库，不再各存一份）
--   * 作品归属:   新建 user_works(user_id, work_id, created_at) 或直接给现有作品表加 user_id 外键
--   * 桌面布局:   新建 user_desk(user_id PK, layout JSON, updated_at)
--   * 上传资产:   新建 user_assets(id, user_id, url, meta JSON, created_at)
--   * 额度记录:   已有 user_quota_ledger，余额可用 SUM(delta) 或冗余到 users.credits
--   * 第三方绑定: 新建 user_oauth(user_id, provider, open_id, UNIQUE(provider, open_id))
--   所有新表统一: user_id VARCHAR(40) + 外键 ON DELETE CASCADE + utf8mb4。
-- =============================================================
