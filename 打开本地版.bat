@echo off
chcp 65001 >nul
rem 本地单文件版：file:// 打开，不受 https 页面直连 http 服务的限制
start "" "%~dp0绘梦AI动漫创作平台.html"
