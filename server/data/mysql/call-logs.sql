-- =============================================================
-- 绘梦 · 调用日志表（真实落库）
-- 库：huimeng_library（与图书馆同库，字符集 utf8mb4）
-- 可重复执行：全部语句均为 IF NOT EXISTS，不会报错、不会丢数据
-- 导入：mysql -u root -p < call-logs.sql
-- SCF 运行时也会在首次写入时自动执行同一份建表语句（见 src/call-log.js）
-- =============================================================

CREATE DATABASE IF NOT EXISTS huimeng_library
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE huimeng_library;

CREATE TABLE IF NOT EXISTS `call_logs` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_at`        BIGINT        NOT NULL COMMENT '毫秒时间戳',
  `created_iso`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '可读时间',
  `user_id`           VARCHAR(64)   NOT NULL DEFAULT '' COMMENT '用户 ID，未登录为空',
  `username`          VARCHAR(128)  NOT NULL DEFAULT '' COMMENT '用户名快照',
  `source`            VARCHAR(32)   NOT NULL DEFAULT 'api' COMMENT '请求来源：web/api/admin/...',
  `mode`              VARCHAR(16)   NOT NULL DEFAULT '' COMMENT 'image/video/audio',
  `engine`            VARCHAR(64)   NOT NULL DEFAULT '' COMMENT '引擎：flux/openai/gpt-image/banana/zeling/edgetts/rayin',
  `channel`           VARCHAR(64)   NOT NULL DEFAULT '' COMMENT '通道/供应商：rayin/zeling/edgetts/...',
  `model`             VARCHAR(120)  NOT NULL DEFAULT '' COMMENT '模型 ID',
  `status`            VARCHAR(16)   NOT NULL DEFAULT '' COMMENT 'success/failed',
  `http_status`       INT           NOT NULL DEFAULT 0  COMMENT 'HTTP 状态码',
  `duration_ms`       INT           NOT NULL DEFAULT 0  COMMENT '耗时（毫秒）',
  `tokens`            INT           NOT NULL DEFAULT 0  COMMENT 'token 或等效消耗量，未知为 0',
  `cost`              DECIMAL(12,6) NOT NULL DEFAULT 0  COMMENT '估算费用（元），未知为 0',
  `error`             TEXT          NULL COMMENT '失败原因',
  `request_summary`   TEXT          NULL COMMENT '请求摘要（JSON 文本）',
  `response_summary`  TEXT          NULL COMMENT '响应摘要（JSON 文本）',
  `request_id`        VARCHAR(64)   NOT NULL DEFAULT '' COMMENT '请求追踪 ID',
  PRIMARY KEY (`id`),
  KEY `idx_call_logs_created` (`created_at`),
  KEY `idx_call_logs_status` (`status`),
  KEY `idx_call_logs_model` (`model`),
  KEY `idx_call_logs_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='调用日志（真实落库）';
