# 原型依赖与来源

> 2026-10-29。主项目尚未选择发布许可证；下表记录直接依赖，不替代发布前对完整依赖树的许可证审查。

| 依赖 | 版本 | 用途 | 许可证 / 来源 |
| --- | --- | --- | --- |
| Electron | 45.1.0 | 桌面 Chromium 窗口 | MIT；内含 Chromium 等第三方声明，分发时须保留 |
| Vue | 3.5.44 | 界面组件 | MIT，npm `vue` |
| Pinia | 4.1.0 | 界面状态 | MIT，npm `pinia` |
| Lucide Vue | 1.64.0 | 图标 | ISC，npm `@lucide/vue`；不用已废弃 `lucide-vue-next` |
| Vite | 8.3.5 | 前端开发与构建 | MIT |
| Vite Vue 插件 | 6.0.10 | Vue 编译 | MIT，`@vitejs/plugin-vue` |
| TypeScript | 5.9.3 | 静态检查 | Apache-2.0 |
| vue-tsc | 3.3.13 | Vue 类型检查 | MIT |
| Playwright | 1.64.1 | 浏览器/Electron 测试 | Apache-2.0；Electron 自动化仍标记为 experimental |
| FastAPI | 0.162.0 | Python API | MIT |
| Pydantic | 2.14.1 | 输入模型校验 | MIT |
| Uvicorn | 0.54.0 | ASGI 服务 | BSD-3-Clause |
| websockets | 17.3 | WebSocket 传输 | BSD-3-Clause |
| PySerial | 3.5 | 只读枚举本机串口；通信驱动待接入 | BSD-3-Clause |
| openpyxl | 3.1.5 | 寄存器 .xlsx 解析与示例模板生成 | MIT；依赖 et_xmlfile 2.0.0 |
| defusedxml | 0.7.1 | 限制不可信 Excel XML 实体处理 | PSF-2.0 |
| pytest | 9.2.0 | Python 测试 | MIT |
| HTTPX | 0.28.1 | API 测试 | BSD-3-Clause |

完整前端版本与校验信息见 `package-lock.json`，Python 验证环境快照见 `requirements-lock.txt`。当前 Starlette 测试客户端提示 HTTPX 适配将弃用，测试仍通过，后续升级时应处理，不应忽略真实失败。

## 参考代码边界

寄存器交互参考用户指定的 `C:\workspace\test_stuio_new\serial_vue`，新组件按本项目数据与服务接口重新实现，未跨目录导入参考文件。模拟寄存器与地址为本项目自定义，不包含芯片厂商定义。任何后续外部代码复用仍需单独记录许可证。

## Electron 下载

默认从 Electron 发布源下载；当前环境直接下载失败后，使用 `https://npmmirror.com/mirrors/electron/` 镜像，仍由 Electron 安装器根据包内校验和校验。镜像不是自动回退或系统全局设置，使用前按所在环境确认来源可接受。运行目录位于被忽略的 `node_modules/electron/dist/`。
