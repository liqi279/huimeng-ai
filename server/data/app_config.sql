-- 服务端供应商配置表（真实密钥只写入本表，不进入仓库）
-- 可重复执行，不会删除已有数据。
CREATE TABLE IF NOT EXISTS `app_config` (
  `key` VARCHAR(64) NOT NULL,
  `value` MEDIUMTEXT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 常用键（示例，按需写入真实值）：
--   gemini.baseUrl       https://www.rayinai.com
--   gemini.apiKey        供应商密钥
--   gemini.defaultModel  gemini-3.1-flash-image
