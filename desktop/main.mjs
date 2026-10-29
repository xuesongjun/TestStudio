import { app, BrowserWindow, dialog } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { root, startKernel } from '../scripts/kernel.mjs'

let kernel
let window
let quitting = false
let closing = false
const started = Date.now()

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { window?.show(); window?.focus() })
  app.whenReady().then(async () => {
    if (!existsSync(path.join(root, 'dist/frontend/index.html'))) throw new Error('前端尚未构建，请先运行 npm run build。')
    kernel = await startKernel({ dataDir: process.env.TESTSTUDIO_DATA_DIR })
    kernel.child.on('exit', () => {
      if (!quitting && !closing) window?.webContents.send('kernel-exited')
    })
    window = new BrowserWindow({
      title: 'TestStudio', width: 1520, height: 1000, minWidth: 880, minHeight: 650,
      backgroundColor: '#f4f6f9', show: false, autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== kernel.url) event.preventDefault()
    })
    window.on('close', event => {
      if (!quitting) { event.preventDefault(); app.quit() }
    })
    await window.loadURL(kernel.url)
    window.show()
    console.log(`TestStudio 桌面已就绪：${Date.now() - started} ms`)
  }).catch(async error => {
    dialog.showErrorBox('TestStudio 启动失败', error.message)
    await kernel?.stop()
    quitting = true
    app.exit(1)
  })

  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', async event => {
    if (quitting) return
    event.preventDefault()
    if (closing) return
    closing = true
    try {
      if (kernel) {
        const response = await fetch(`${kernel.url}/api/state`, {
          headers: { 'x-teststudio-token': kernel.token }, signal: AbortSignal.timeout(1000),
        })
        const state = await response.json()
        if (['running', 'cancelling'].includes(state.task?.status)) {
          const result = await dialog.showMessageBox({ type: 'question', title: '退出 TestStudio',
            message: '任务仍在执行，是否停止任务并退出？', buttons: ['继续运行', '停止并退出'], defaultId: 0, cancelId: 0 })
          if (result.response === 0) { closing = false; return }
        }
      }
    } catch { /* 内核不可达时仍允许关闭窗口并清理子进程。 */ }
    await kernel?.stop()
    quitting = true
    app.quit()
  })
}
