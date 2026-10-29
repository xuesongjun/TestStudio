import { expect, test } from '@playwright/test'

test('设备断开只锁本卡片，并发及失败后正确释放加载状态', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('内核已连接', { exact: true })).toBeVisible()
  const initial = await (await page.request.get('/api/state')).json()
  const dutA = initial.connections.find((item: { name: string }) => item.name === 'DUT-A')
  const dutB = initial.connections.find((item: { name: string }) => item.name === 'DUT-B')
  const instrument = initial.connections.find((item: { name: string }) => item.name === '信号源')
  for (const item of [dutA, dutB, instrument]) {
    await page.request.post(`/api/connections/${item.id}/connect`)
  }
  const cardA = page.getByRole('article', { name: 'DUT-A 连接卡片', exact: true })
  const cardB = page.getByRole('article', { name: 'DUT-B 连接卡片', exact: true })
  const cardInstrument = page.getByRole('article', { name: '信号源 连接卡片', exact: true })
  await expect(cardA.getByRole('button', { name: '断开 DUT-A', exact: true })).toBeEnabled()
  await expect(cardB.getByRole('button', { name: '断开 DUT-B', exact: true })).toBeEnabled()
  // API 完成不等于事件快照已刷新到 UI；先等仪表连接稳定再观察无关变化。
  await expect(cardInstrument.getByRole('button', { name: '断开 信号源', exact: true })).toBeEnabled()
  const staleSnapshot = await (await page.request.get('/api/state')).json()
  let releaseA!: () => void
  let releaseB!: () => void
  const waitA = new Promise<void>(resolve => { releaseA = resolve })
  const waitB = new Promise<void>(resolve => { releaseB = resolve })
  let requestsA = 0
  await page.route(`**/api/connections/${dutA.id}/disconnect`, async route => {
    requestsA++
    await waitA
    await route.fulfill({ status: 503, json: { detail: '测试连接断开失败' } })
  })
  await page.route(`**/api/connections/${dutB.id}/disconnect`, async route => {
    await waitB
    await route.fulfill({ response: await route.fetch() })
  })
  // 观察其他卡片的 disabled/class/style 和文案，避免只验证最终状态漏掉短暂闪烁。
  await cardInstrument.evaluate(element => {
    const target = element.querySelector('.connection-toggle')!
    const host = window as typeof window & { unrelatedButtonMutations: string[] }
    host.unrelatedButtonMutations = []
    new MutationObserver(records => host.unrelatedButtonMutations.push(...records.map(item => item.type)))
      .observe(target, { attributes: true, attributeFilter: ['disabled', 'class', 'style'], childList: true, characterData: true, subtree: true })
  })
  try {
    await cardA.getByRole('button', { name: '断开 DUT-A', exact: true }).click()
    await expect(cardA.locator('.connection-toggle')).toBeDisabled()
    await expect(cardA.locator('.connection-toggle')).toHaveText('断开中')
    await expect(cardB.getByRole('button', { name: '断开 DUT-B', exact: true })).toBeEnabled()
    await expect(cardInstrument.getByRole('button', { name: '断开 信号源', exact: true })).toBeEnabled()
    // 即使人为重复派发点击，同一个设备也不能发起第二次操作。
    await cardA.locator('.connection-toggle').dispatchEvent('click')
    await expect.poll(() => requestsA).toBe(1)
    await cardB.getByRole('button', { name: '断开 DUT-B', exact: true }).click()
    await expect(cardB.locator('.connection-toggle')).toHaveText('断开中')
    // B 完成后的旧快照不可盖掉先到达的最新事件。
    await page.route('**/api/state', async route => {
      await expect(cardB.locator('.connection-status')).toHaveText('未连接')
      await route.fulfill({ json: staleSnapshot })
    }, { times: 1 })
    releaseB()
    await expect(cardB.getByRole('button', { name: '连接 DUT-B', exact: true })).toBeEnabled()
    await expect(cardA.locator('.connection-toggle')).toBeDisabled()
    releaseA()
    await expect(page.getByRole('status')).toContainText('测试连接断开失败')
    await expect(cardA.getByRole('button', { name: '断开 DUT-A', exact: true })).toBeEnabled()
    await expect(cardB.getByRole('button', { name: '连接 DUT-B', exact: true })).toBeEnabled()
    expect(await page.evaluate(() => (window as typeof window & { unrelatedButtonMutations: string[] }).unrelatedButtonMutations)).toEqual([])
  } finally {
    releaseA()
    releaseB()
  }
})

test('连接配置区分设备串口与仪表 IP，硬件配置只保存且可编辑', async ({ page }) => {
  await page.route('**/api/serial/ports', route => route.fulfill({ json: {
    ports: [{ device: 'COM113', description: '测试串口（非真实扫描）' }],
  } }))
  await page.goto('/')
  await expect(page.getByText('内核已连接', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '添加连接', exact: true }).click()
  const deviceName = `串口测试-${Date.now()}`
  await page.getByLabel('连接名称', { exact: true }).fill(deviceName)
  await expect(page.getByLabel('串口号', { exact: true })).toBeVisible()
  await expect(page.getByLabel('IP 地址', { exact: true })).toHaveCount(0)
  await page.getByLabel('运行模式', { exact: true }).selectOption('hardware')
  await expect(page.getByLabel('串口号', { exact: true }).getByRole('option', { name: /COM113/ })).toBeAttached()
  await page.getByLabel('串口号', { exact: true }).selectOption('COM113')
  await page.getByLabel('波特率', { exact: true }).fill('921600')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  const deviceCard = page.getByRole('article', { name: `${deviceName} 连接卡片`, exact: true })
  await expect(deviceCard).toContainText('COM113')
  await expect(deviceCard).toContainText('921600 · 8N1')
  await expect(deviceCard.locator('.connection-toggle')).toHaveText('驱动待接入')
  await expect(deviceCard.locator('.connection-toggle')).toBeDisabled()
  await page.reload()
  await expect(deviceCard).toContainText('COM113')
  await deviceCard.getByRole('button', { name: `编辑 ${deviceName}`, exact: true }).click()
  await expect(page.getByLabel('串口号', { exact: true })).toHaveValue('COM113')
  await page.getByLabel('波特率', { exact: true }).fill('460800')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(deviceCard).toContainText('460800 · 8N1')

  await page.getByRole('button', { name: '添加连接', exact: true }).click()
  const instrumentName = `IP测试-${Date.now()}`
  await page.getByLabel('连接名称', { exact: true }).fill(instrumentName)
  await page.getByLabel('设备类型', { exact: true }).selectOption('instrument')
  await expect(page.getByLabel('IP 地址', { exact: true })).toBeVisible()
  await expect(page.getByLabel('串口号', { exact: true })).toHaveCount(0)
  await page.getByLabel('运行模式', { exact: true }).selectOption('hardware')
  await page.getByLabel('IP 地址', { exact: true }).fill('192.168.1.100')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  const instrumentCard = page.getByRole('article', { name: `${instrumentName} 连接卡片`, exact: true })
  await expect(instrumentCard).toContainText('192.168.1.100')
  await expect(instrumentCard).toContainText('VISA TCPIP')
  await expect(instrumentCard).not.toContainText('SIM://')
  await expect(instrumentCard.locator('.connection-toggle')).toBeDisabled()
  for (const [card, name] of [[deviceCard, deviceName], [instrumentCard, instrumentName]] as const) {
    await card.getByRole('button', { name: `删除 ${name}`, exact: true }).click()
    await card.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(card).toHaveCount(0)
  }
})
