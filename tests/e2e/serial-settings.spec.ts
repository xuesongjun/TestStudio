import { expect, test } from '@playwright/test'

test('自动扫描串口可刷新，波特率可选预设也可手填并保存', async ({ page }) => {
  let ports = [{ device: 'COM3', description: 'USB UART（测试枚举）' }, { device: 'COM12', description: '调试口（测试枚举）' }]
  let scans = 0
  await page.route('**/api/serial/ports', route => {
    scans++
    return route.fulfill({ json: { ports } })
  })
  await page.goto('/')
  await expect(page.getByText('内核已连接', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '添加连接', exact: true }).click()
  await expect.poll(() => scans).toBeGreaterThan(0)
  const port = page.getByRole('combobox', { name: '串口号', exact: true })
  await expect(port.getByRole('option')).toHaveText(['请选择串口', 'COM3 · USB UART（测试枚举）', 'COM12 · 调试口（测试枚举）'])
  const baud = page.getByRole('combobox', { name: '波特率', exact: true })
  await expect(baud).toHaveValue('115200')
  await page.getByRole('button', { name: '展开波特率列表', exact: true }).click()
  await expect(page.getByRole('listbox', { name: '预设波特率', exact: true }).getByRole('option')).toHaveText([
    '19200', '38400', '56000', '57600', '115200', '128000', '230400', '256000',
    '460800', '512000', '750000', '921600', '1000000', '1500000', '2000000',
  ])
  await page.getByRole('option', { name: '921600', exact: true }).click()
  await expect(baud).toHaveValue('921600')
  await baud.fill('123456')
  await baud.press('Tab')
  await expect(baud).toHaveValue('123456')
  await page.getByLabel('运行模式', { exact: true }).selectOption('hardware')
  await port.selectOption('COM12')
  const name = `扫描测试-${Date.now()}`
  await page.getByLabel('连接名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  const card = page.getByRole('article', { name: `${name} 连接卡片`, exact: true })
  await expect(card).toContainText('123456 · 8N1')
  await expect(card).toContainText('COM12')
  ports = [{ device: 'COM3', description: 'USB UART（测试枚举）' }]
  await card.getByRole('button', { name: `编辑 ${name}`, exact: true }).click()
  await expect(port.getByRole('option', { name: 'COM12（未检测到）', exact: true })).toBeAttached()
  await expect(port).toHaveValue('COM12')
  await expect(baud).toHaveValue('123456')
  await expect(page.getByText('COM12 当前未检测到，已保留原配置，未自动改选其他端口。')).toBeVisible()
  ports = [{ device: 'COM12', description: '重新接入（测试枚举）' }]
  await page.getByRole('button', { name: '刷新串口列表', exact: true }).click()
  await expect(port.getByRole('option', { name: /COM12 · 重新接入/ })).toBeAttached()
  await expect(port).toHaveValue('COM12')
  await page.getByRole('button', { name: '展开波特率列表', exact: true }).click()
  await baud.press('Escape')
  await expect(page.getByRole('listbox', { name: '预设波特率', exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '编辑连接', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭连接配置', exact: true }).click()
  await card.getByRole('button', { name: `删除 ${name}`, exact: true }).click()
  await card.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(card).toHaveCount(0)
})

test('扫描空列表及失败明确提示，切换仪表不扫描，自定义波特率校验', async ({ page }) => {
  let failing = false
  let scans = 0
  await page.route('**/api/serial/ports', route => {
    scans++
    return failing ? route.fulfill({ status: 503, json: { detail: '串口扫描失败，请检查系统设备状态后重试' } }) : route.fulfill({ json: { ports: [] } })
  })
  await page.goto('/')
  await expect(page.getByText('内核已连接', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '添加连接', exact: true }).click()
  await expect(page.getByText('未检测到串口，请连接设备后刷新。模拟模式可留空。')).toBeVisible()
  const baud = page.getByRole('combobox', { name: '波特率', exact: true })
  for (const value of ['0', '1.5', '-115200', '12000001', 'abc']) {
    await baud.fill(value)
    await expect(baud).toHaveAttribute('aria-invalid', 'true')
    expect(await baud.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(false)
  }
  await baud.fill('115200')
  await expect(baud).toHaveAttribute('aria-invalid', 'false')
  failing = true
  await page.getByRole('button', { name: '刷新串口列表', exact: true }).click()
  await expect(page.getByText('串口扫描失败，请检查系统设备状态后重试', { exact: true })).toBeVisible()
  failing = false
  await page.getByRole('button', { name: '刷新串口列表', exact: true }).click()
  await expect(page.getByText('未检测到串口，请连接设备后刷新。模拟模式可留空。')).toBeVisible()
  const previousScans = scans
  await page.getByLabel('设备类型', { exact: true }).selectOption('instrument')
  await expect(page.getByLabel('IP 地址', { exact: true })).toBeVisible()
  expect(scans).toBe(previousScans)
  await expect(page.getByLabel('波特率', { exact: true })).toHaveCount(0)
})
