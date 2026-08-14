# 职到了

面向猎头的 AI JD 卡片生成器。将杂乱的公司及岗位信息交给百炼千问整理，再渲染为可以直接发给候选人的黑白岗位卡片。

## 本地启动

1. 安装依赖：`npm install`
2. 在 `.env` 中填写 `DASHSCOPE_API_KEY`
3. 启动开发服务：`npm run dev`
4. 打开 `http://127.0.0.1:3210`

## 环境变量

- `DASHSCOPE_API_KEY`：百炼 API Key，仅在服务端读取。
- `DASHSCOPE_BASE_URL`：OpenAI 兼容接口基础地址。
- `DASHSCOPE_MODEL`：默认 `qwen-plus`。
- `MOCK_AI`：仅供本地界面验收，正式使用保持 `false`。
- `PORT`：本地服务端口，默认 `3210`。

## 主要功能

- 忠实整理、适度润色、保密泛化三种单选模式
- 百炼 JSON 结构化输出与服务端字段清洗
- 3:4 岗位卡片预览与自动分页
- 一句话 AI 二次修改
- 当前页或全部卡片 PNG 下载
- 浏览器本地历史记录

真实 `.env` 已加入 `.gitignore`，不要将 API Key 提交到 GitHub。
