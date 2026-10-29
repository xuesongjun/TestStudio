import { expect, test } from '@playwright/test'

test('WO 无需读取可提交零值、重复命令和撤销；WC 自清零位不误报校验失败', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByText('内核已连接', { exact: true })).toBeVisible()
  const original = await (await page.request.get('/api/registers/definitions')).json()
  const connection = await (await page.request.post('/api/connections', { data: { name: `访问属性测试-${Date.now()}`, kind: 'soc' } })).json()
  const registers = [
    { address: '0x7000', name: 'WRITE_ONLY', reset: 15, fields: [{ name: 'COMMAND', msb: 3, lsb: 0, access: 'WO' }] },
    { address: '0x7004', name: 'SELF_CLEAR', reset: 1, fields: [{ name: 'START', msb: 0, lsb: 0, access: 'WC' }] },
    { address: '0x7008', name: 'MIXED_ACCESS', reset: 0xF1, fields: [
      { name: 'COMMAND', msb: 7, lsb: 4, access: 'WO' },
      { name: 'CONTROL', msb: 1, lsb: 1, access: 'RW' },
      { name: 'START', msb: 0, lsb: 0, access: 'WC' },
    ] },
    { address: '0x700C', name: 'SELF_CLEAR_ALIASES', reset: 0x80000001, fields: [
      { name: 'PULSE', msb: 31, lsb: 31, access: 'W1_PULSE' },
      { name: 'INTERRUPT', msb: 0, lsb: 0, access: 'WC_INT' },
    ] },
  ]
  try {
    await page.getByRole('navigation', { name: '功能导航' }).getByRole('button', { name: '寄存器工作台', exact: true }).click()
    await page.getByLabel('寄存器表文件', { exact: true }).setInputFiles({
      name: 'access.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(registers)),
    })
    const preview = page.getByRole('dialog', { name: '导入寄存器表预览', exact: true })
    await expect(preview).toContainText('4 个寄存器')
    await expect(preview).not.toContainText('语义待确认')
    await preview.getByRole('button', { name: '确认导入', exact: true }).click()
    await expect(preview).toHaveCount(0)
    expect((await page.request.post(`/api/connections/${connection.id}/connect`)).ok()).toBe(true)
    await page.getByRole('combobox', { name: '目标设备', exact: true }).selectOption(connection.id)
    const wo = page.getByTestId('register-WRITE_ONLY')
    const woInput = page.getByRole('textbox', { name: 'WRITE_ONLY 待写值', exact: true })
    await expect(woInput).toBeEnabled()
    await expect(woInput).toHaveValue('0x00000000')
    await expect(wo.locator('.read-value')).toHaveText('— WO 只写 —')
    await expect(page.getByRole('button', { name: '读取 WRITE_ONLY', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'WRITE_ONLY bit 0', exact: true }).click()
    await expect(page.getByRole('button', { name: 'WRITE_ONLY bit 3', exact: true })).toHaveClass(/changed/)
    await page.getByRole('button', { name: '撤销 WRITE_ONLY 修改', exact: true }).click()
    await expect(page.getByRole('button', { name: '写入 WRITE_ONLY', exact: true })).toBeDisabled()
    // 全 0 即使与默认待写值相等，仍是一次明确的只写命令。
    await page.getByRole('button', { name: '选中行全 0', exact: true }).click()
    const zeroResponse = page.waitForResponse(response => response.url().endsWith(`/connections/${connection.id}/registers/write`))
    await page.getByRole('button', { name: '写入 WRITE_ONLY', exact: true }).click()
    const zero = await (await zeroResponse).json()
    expect(zero.value).toBeNull()
    expect(zero.verified).toBeNull()
    expect(zero.unverified_mask).toBe(15)
    await expect(wo.locator('.unverified-label')).toContainText('未校验')
    await expect(wo.locator('.verified-label')).toHaveCount(0)
    await expect(woInput).toHaveValue('0x00000000')
    await expect(page.getByRole('button', { name: 'WRITE_ONLY bit 3', exact: true })).not.toHaveClass(/changed/)
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.getByRole('button', { name: 'WRITE_ONLY bit 0', exact: true }).click()
      const response = page.waitForResponse(response => response.url().endsWith(`/connections/${connection.id}/registers/write`))
      await page.getByRole('button', { name: '写入 WRITE_ONLY', exact: true }).click()
      expect((await (await response).json()).verified).toBeNull()
      await expect(woInput).toHaveValue('0x00000000')
      await expect(page.getByRole('button', { name: '写入 WRITE_ONLY', exact: true })).toBeDisabled()
    }
    await page.getByRole('button', { name: '读取全部', exact: true }).click()
    const wc = page.getByTestId('register-SELF_CLEAR')
    await expect(wc.locator('.read-value')).toHaveText('0x00000001')
    await expect(page.getByRole('textbox', { name: 'SELF_CLEAR 待写值', exact: true })).toHaveValue('0x00000000')
    await expect(page.getByRole('button', { name: '写入 SELF_CLEAR', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'SELF_CLEAR bit 0', exact: true }).click()
    await expect(wc.locator('.field-gray .bit-button').first()).toBeDisabled()
    await page.getByRole('button', { name: '写入 SELF_CLEAR', exact: true }).click()
    await expect(wc.locator('.read-value')).toHaveText('0x00000000')
    await expect(wc.locator('.unverified-label')).toContainText('未校验')
    await expect(wc.locator('.verified-label')).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('自清零位未校验')
    const aliases = page.getByTestId('register-SELF_CLEAR_ALIASES')
    await expect(page.getByRole('textbox', { name: 'SELF_CLEAR_ALIASES 待写值', exact: true })).toHaveValue('0x00000000')
    await page.getByRole('button', { name: 'SELF_CLEAR_ALIASES bit 31', exact: true }).click()
    await page.getByRole('button', { name: 'SELF_CLEAR_ALIASES bit 0', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'SELF_CLEAR_ALIASES 待写值', exact: true })).toHaveValue('0x80000001')
    const aliasesResponse = page.waitForResponse(response => response.url().endsWith(`/connections/${connection.id}/registers/write`))
    await page.getByRole('button', { name: '写入 SELF_CLEAR_ALIASES', exact: true }).click()
    const aliasesResult = await (await aliasesResponse).json()
    expect(aliasesResult.verified).toBeNull()
    expect(aliasesResult.unverified_mask).toBe(0x80000001)
    await expect(aliases.locator('.read-value')).toHaveText('0x00000000')
    await expect(aliases.locator('.verified-label')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'SELF_CLEAR_ALIASES 待写值', exact: true })).toHaveValue('0x00000000')
    const mixed = page.getByTestId('register-MIXED_ACCESS')
    await expect(mixed.locator('.read-value')).toHaveText('0x000000?1')
    await page.getByRole('button', { name: 'MIXED_ACCESS bit 4', exact: true }).click()
    await page.getByRole('button', { name: 'MIXED_ACCESS bit 1', exact: true }).click()
    await page.getByRole('button', { name: 'MIXED_ACCESS bit 0', exact: true }).click()
    const mixedResponse = page.waitForResponse(response => response.url().endsWith(`/connections/${connection.id}/registers/write`))
    await page.getByRole('button', { name: '写入 MIXED_ACCESS', exact: true }).click()
    const result = await (await mixedResponse).json()
    expect(result.verified).toBe(true)
    expect(result.verification_mask).toBe(2)
    expect(result.unverified_mask).toBe(0xF1)
    await expect(mixed.locator('.verified-label')).toHaveText('✓ 可读位已校验')
    await expect(mixed.locator('.read-value')).toHaveText('0x000000?2')
    await expect(page.getByRole('textbox', { name: 'MIXED_ACCESS 待写值', exact: true })).toHaveValue('0x00000002')
    await page.reload()
    await expect(page.getByText('内核已连接', { exact: true })).toBeVisible()
    await page.getByRole('navigation', { name: '功能导航' }).getByRole('button', { name: '寄存器工作台', exact: true }).click()
    await page.getByRole('combobox', { name: '目标设备', exact: true }).selectOption(connection.id)
    await expect(page.getByRole('textbox', { name: 'WRITE_ONLY 待写值', exact: true })).toHaveValue('0x00000000')
    expect(errors).toEqual([])
  } finally {
    await page.request.post(`/api/connections/${connection.id}/disconnect`)
    await page.request.delete(`/api/connections/${connection.id}`)
    const current = await (await page.request.get('/api/registers/definitions')).json()
    expect((await page.request.post('/api/registers/import', { data: { mode: 'replace', expected_revision: current.revision, registers: original.registers } })).ok()).toBe(true)
  }
})

test('实际工作簿 eFuse WO 与 PIT WC 可选表、预览并持久化', async ({ page }) => {
  const workbook = process.env.TESTSTUDIO_REGISTER_WORKBOOK
  test.skip(!workbook, '可用 TESTSTUDIO_REGISTER_WORKBOOK 指定只读实际工作簿')
  await page.goto('/')
  await expect(page.getByText('内核已连接', { exact: true })).toBeVisible()
  const original = await (await page.request.get('/api/registers/definitions')).json()
  try {
    await page.getByRole('navigation', { name: '功能导航' }).getByRole('button', { name: '寄存器工作台', exact: true }).click()
    await page.getByLabel('寄存器表文件', { exact: true }).setInputFiles(workbook!)
    const sheets = page.getByRole('dialog', { name: '选择导入工作表', exact: true })
    await expect(sheets).toContainText('eFuse')
    const selectAll = sheets.getByRole('checkbox', { name: '全选 / 全不选工作表', exact: true })
    await expect(selectAll).toBeChecked()
    await selectAll.uncheck()
    await expect(sheets.getByRole('button', { name: '解析选中工作表', exact: true })).toBeDisabled()
    await expect(sheets.locator('.sheet-selection input:checked')).toHaveCount(0)
    await sheets.getByRole('checkbox', { name: '导入工作表 eFuse', exact: true }).check()
    await sheets.getByRole('checkbox', { name: '导入工作表 PIT', exact: true }).check()
    await expect(selectAll).toHaveJSProperty('indeterminate', true)
    await expect(sheets.locator('.sheet-selection input:checked')).toHaveCount(2)
    await sheets.getByRole('button', { name: '解析选中工作表', exact: true }).click()
    const preview = page.getByRole('dialog', { name: '导入寄存器表预览', exact: true })
    await expect(preview).toContainText('31 个寄存器')
    await preview.getByRole('button', { name: '确认导入', exact: true }).click()
    await expect(preview).toHaveCount(0)
    const catalog = await (await page.request.get('/api/registers/definitions')).json()
    const fields = catalog.registers.flatMap((register: { fields: { name: string; access: string }[] }) => register.fields)
    expect(fields.find((field: { name: string }) => field.name === 'efuse_pgm').access).toBe('WO')
    expect(fields.find((field: { name: string }) => field.name === 'ch3int3').access).toBe('WC')
    await page.getByRole('combobox', { name: '选择寄存器表', exact: true }).selectOption('PIT')
    const register = catalog.registers.find((register: { fields: { name: string }[] }) => register.fields.some(field => field.name === 'ch3int3'))
    await page.getByTestId(`register-${register.name}`).getByRole('button', { name: register.name, exact: true }).click()
    await expect(page.getByRole('complementary', { name: '寄存器位域详情', exact: true })).toContainText('写 1 后由硬件自动清 0')
    await page.reload()
    expect((await (await page.request.get('/api/registers/definitions')).json()).registers).toEqual(catalog.registers)
  } finally {
    const current = await (await page.request.get('/api/registers/definitions')).json()
    expect((await page.request.post('/api/registers/import', { data: { mode: 'replace', expected_revision: current.revision, registers: original.registers } })).ok()).toBe(true)
  }
})
