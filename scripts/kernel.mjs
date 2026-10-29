import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'

export const root = fileURLToPath(new URL('../', import.meta.url))

export async function startKernel({ port = 0, dataDir } = {}) {
  const python = process.env.TESTSTUDIO_PYTHON ?? path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  if (!existsSync(python)) throw new Error('未找到新版 Python 环境，请先按 README 创建 .venv 并安装依赖。')
  const token = randomBytes(32).toString('hex')
  const child = spawn(python, ['-u', '-m', 'backend', '--port', String(port)], {
    cwd: root,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUTF8: '1', TESTSTUDIO_TOKEN: token,
      TESTSTUDIO_DEV_ORIGIN: `http://127.0.0.1:${process.env.TESTSTUDIO_FRONTEND_PORT ?? 5173}`,
      ...(dataDir ? { TESTSTUDIO_DATA_DIR: dataDir } : {}) },
  })
  child.stderr.on('data', data => process.stderr.write(data))
  const lines = createInterface({ input: child.stdout })
  let readyUrl
  try {
    readyUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Python 内核启动超过 20 秒')), 20_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Python 内核提前退出（${code}）`)) })
      lines.on('line', line => {
        try {
          const event = JSON.parse(line)
          if (event.event === 'ready') {
            clearTimeout(timer)
            resolve(`http://127.0.0.1:${event.port}`)
          }
        } catch { console.log(`[内核] ${line}`) }
      })
    })
    let healthy = false
    for (let index = 0; index < 40; index++) {
      try {
        const response = await fetch(`${readyUrl}/api/health`, { signal: AbortSignal.timeout(500) })
        if (response.ok) { healthy = true; break }
      } catch { /* 端口监听可能稍晚于 lifespan 就绪消息。 */ }
      await new Promise(resolve => setTimeout(resolve, 75))
    }
    if (!healthy) throw new Error('Python 内核未通过健康检查')
  } catch (error) {
    child.kill()
    throw error
  }

  let stopping
  const stop = () => {
    if (stopping) return stopping
    stopping = new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
      const timer = setTimeout(() => child.kill(), 5000)
      timer.unref()
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.stdin.on('error', () => {})
      child.stdin.end('shutdown\n')
    })
    return stopping
  }
  return { url: readyUrl, token, child, stop }
}
