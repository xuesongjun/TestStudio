import { expect, test } from '@playwright/test'

test('位域详情隐藏保留字段、重复名称及格式行，普通 RO 和原始定义保持', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('内核已连接', { exact: true })).toBeVisible()
  const original = await (await page.request.get('/api/registers/definitions')).json()
  const connection = await (await page.request.post('/api/connections', { data: { name: `详情测试-${Date.now()}`, kind: 'soc' } })).json()
  const fields = [
    { name: 'UNUSED', msb: 31, lsb: 24, access: 'Reserved', description: '保留部分', reset: 0 },
    // 模拟本项目早期存档直接保存名称 reserved、访问类型 RO 的情况。
    { name: 'ReSeRvEd', msb: 23, lsb: 16, access: 'RO', description: '保留部分', reset: 0 },
    { name: '保留字段', msb: 15, lsb: 8, access: 'RO', description: '保留部分', reset: 0 },
    { name: 'STATE', msb: 7, lsb: 4, access: 'RO', description: '有效状态信息', reset: 0 },
    { name: 'ENABLE', msb: 3, lsb: 0, access: 'RW', description: '功能使能', reset: 1 },
  ]
  const registers = [
    { address: '0x00008000', name: 'INSPECT_DUP', group: 'DETAILS', description: ' INSPECT_DUP ', reset: 1, source_version: 'v1', fields },
    { address: '0x00008004', name: 'INSPECT_DESCRIPTION', group: 'DETAILS', description: '有意义的寄存器说明', reset: 1, source_version: 'v2', fields },
    { address: '0x00008008', name: 'RESERVED_ONLY', group: 'DETAILS', description: '', reset: 0, source_version: 'v1',
      fields: [{ name: 'RESERVED', msb: 31, lsb: 0, access: 'Reserved', description: '全部保留', reset: 0 }] },
  ]
  try {
    expect((await page.request.post('/api/registers/import', { data: { mode: 'append', expected_revision: original.revision, registers } })).ok()).toBe(true)
    const imported = await (await page.request.get('/api/registers/definitions')).json()
    expect((await page.request.post(`/api/connections/${connection.id}/connect`)).ok()).toBe(true)
    await page.getByRole('navigation', { name: '功能导航' }).getByRole('button', { name: '寄存器工作台', exact: true }).click()
    await page.getByRole('combobox', { name: '目标设备', exact: true }).selectOption(connection.id)
    await page.getByRole('combobox', { name: '选择寄存器表', exact: true }).selectOption('DETAILS')
    const details = page.getByRole('complementary', { name: '寄存器位域详情', exact: true })
    await page.getByTestId('register-INSPECT_DUP').getByRole('button', { name: 'INSPECT_DUP', exact: true }).click()
    await expect(details.getByRole('heading', { name: 'INSPECT_DUP', exact: true })).toBeVisible()
    await expect(details.locator('.register-description')).toHaveCount(0)
    await expect(details.locator('.register-metadata')).toHaveCount(0)
    await expect(details).not.toContainText('整字初始值')
    await expect(details).not.toContainText('格式 v1')
    await expect(details.locator('.field-detail')).toHaveCount(2)
    await expect(details.locator('.field-detail strong')).toHaveText(['STATE', 'ENABLE'])
    await expect(details).toContainText('有效状态信息')
    await expect(details.locator('.access-tag.RO')).toHaveCount(1)
    await expect(details).toContainText('字段初始值：0x00000001')
    // 仅过滤详情，32 位视图及前后端只读/保留位保护不受影响。
    await expect(page.getByTestId('register-INSPECT_DUP').locator('.bit-button')).toHaveCount(32)
    await page.getByRole('button', { name: '读取 INSPECT_DUP', exact: true }).click()
    await expect(page.getByRole('button', { name: 'INSPECT_DUP bit 0', exact: true })).toBeEnabled()
    for (const bit of [31, 23, 15, 7]) {
      await expect(page.getByRole('button', { name: `INSPECT_DUP bit ${bit}`, exact: true })).toBeDisabled()
    }
    expect((await page.request.post(`/api/connections/${connection.id}/registers/write`, { data: { address: '0x8000', value: 0, mask: 0x10000 } })).status()).toBe(400)
    await page.getByTestId('register-INSPECT_DESCRIPTION').getByRole('button', { name: 'INSPECT_DESCRIPTION', exact: true }).click()
    await expect(details.locator('.register-description')).toHaveText('有意义的寄存器说明')
    await expect(details).not.toContainText('格式 v2')
    await expect(details.locator('.field-detail')).toHaveCount(2)
    await page.getByTestId('register-RESERVED_ONLY').getByRole('button', { name: 'RESERVED_ONLY', exact: true }).click()
    await expect(details.locator('.field-detail')).toHaveCount(0)
    await expect(details).toContainText('此寄存器仅含保留字段。')
    expect((await (await page.request.get('/api/registers/definitions')).json()).registers).toEqual(imported.registers)
  } finally {
    await page.request.post(`/api/connections/${connection.id}/disconnect`)
    await page.request.delete(`/api/connections/${connection.id}`)
    const current = await (await page.request.get('/api/registers/definitions')).json()
    expect((await page.request.post('/api/registers/import', { data: { mode: 'replace', expected_revision: current.revision, registers: original.registers } })).ok()).toBe(true)
  }
})
