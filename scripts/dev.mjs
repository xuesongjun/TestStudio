import { startKernel } from './kernel.mjs'

const kernel = await startKernel({ port: Number(process.env.TESTSTUDIO_BACKEND_PORT ?? 0), dataDir: process.env.TESTSTUDIO_DATA_DIR })
process.env.TESTSTUDIO_BACKEND_URL = kernel.url
const { createServer } = await import('vite')
let frontend
let exiting = false

async function close(code = 0) {
  if (exiting) return
  exiting = true
  await frontend?.close()
  await kernel.stop()
  process.exit(code)
}

process.on('SIGINT', () => close())
process.on('SIGTERM', () => close())
kernel.child.on('exit', () => { if (!exiting) close(1) })

try {
  frontend = await createServer({ server: { port: Number(process.env.TESTSTUDIO_FRONTEND_PORT ?? 5173) } })
  await frontend.listen()
  console.log(`TestStudio 浏览器开发入口：http://127.0.0.1:${process.env.TESTSTUDIO_FRONTEND_PORT ?? 5173}/`)
  console.log(`Python 模拟内核：${kernel.url}`)
} catch (error) {
  console.error(error)
  await close(1)
}
