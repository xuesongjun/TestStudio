import assert from 'node:assert/strict'
import { _electron as electron, expect } from '@playwright/test'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { root } from './kernel.mjs'

const started = Date.now()
const application = await electron.launch({
  args: ['.'], cwd: root,
  env: { ...process.env, TESTSTUDIO_DATA_DIR: path.join(root, 'data', 'desktop-test') },
  timeout: 30_000,
})

let url
try {
  const page = await application.firstWindow()
  await page.getByText('内核已连接', { exact: true }).waitFor()
  const readyElapsed = Date.now() - started
  url = page.url()
  const preferences = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences())
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.sandbox, true)
  await page.getByRole('button', { name: '连接 DUT-A', exact: true }).click()
  await page.getByRole('navigation', { name: '功能导航' }).getByRole('button', { name: '寄存器工作台', exact: true }).click()
  await page.getByRole('button', { name: '读取全部', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'SYSTEM_CTRL 待写值' })).toHaveValue('0x00000101')
  console.log(`桌面启动至界面内核在线：${readyElapsed} ms；连接与读取流程总耗时：${Date.now() - started} ms`)
  await mkdir(path.join(root, 'test-results'), { recursive: true })
  await page.screenshot({ path: path.join(root, 'test-results', 'desktop-registers.png') })
} finally {
  await application.close()
}

let released = false
for (let retry = 0; retry < 30; retry++) {
  try {
    await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(300) })
  } catch { released = true; break }
  await new Promise(resolve => setTimeout(resolve, 100))
}
assert(released, '桌面退出后 Python 内核端口没有释放')
console.log('桌面退出后 Python 内核端口已释放')
