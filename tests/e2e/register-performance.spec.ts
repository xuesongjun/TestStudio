import { expect, test } from '@playwright/test'

for (const count of [530, 2048]) {
  test(`${count} 项寄存器只渲染可见行，分组/bit0/末行可达，离屏编辑与勾选保留`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await expect(page.getByText('内核已连接', { exact: true })).toBeVisible()
    const original = await (await page.request.get('/api/registers/definitions')).json()
    const connection = await (await page.request.post('/api/connections', { data: { name: `性能测试-${count}-${Date.now()}`, kind: 'soc' } })).json()
    const registers = Array.from({ length: count }, (_, index) => ({
      address: `0x${(0x10000 + index * 4).toString(16).padStart(8, '0').toUpperCase()}`,
      name: `PERF_${String(index).padStart(4, '0')}${index === 0 ? '_LONG_REGISTER_NAME_MUST_NOT_EXPAND_COLUMNS' : ''}`,
      group: `GROUP_${String(Math.min(24, Math.floor(index * 25 / count))).padStart(2, '0')}_LONG_GROUP_NAME`,
      description: '合成模拟性能样例，不对应芯片', reset: index,
      fields: [{ name: 'VALUE', msb: 31, lsb: 0, access: 'RW', description: '可读写参数' }],
    }))
    try {
      expect((await page.request.post('/api/registers/import', { data: { mode: 'replace', expected_revision: original.revision, registers } })).ok()).toBe(true)
      expect((await page.request.post(`/api/connections/${connection.id}/connect`)).ok()).toBe(true)
      const opened = Date.now()
      await page.getByRole('navigation', { name: '功能导航' }).getByRole('button', { name: '寄存器工作台', exact: true }).click()
      const table = page.locator('.register-table')
      const scroller = page.getByRole('region', { name: '寄存器表格，纵向滚动', exact: true })
      await expect(table).toHaveAttribute('aria-rowcount', String(count + 1))
      const first = registers[0]!
      const last = registers[count - 1]!
      await expect(page.getByTestId(`register-${first.name}`)).toBeVisible()
      const openMs = Date.now() - opened
      expect(await page.locator('.register-data-row').count()).toBeLessThan(30)
      expect(await page.locator('.bit-button').count()).toBeLessThan(960)
      await page.getByRole('combobox', { name: '目标设备', exact: true }).selectOption(connection.id)
      const readStarted = Date.now()
      await page.getByRole('button', { name: '读取全部', exact: true }).click()
      await expect(page.getByRole('textbox', { name: `${first.name} 待写值`, exact: true })).toHaveValue('0x00000000')
      const readMs = Date.now() - readStarted
      // 长名称不撑大列；无横向滚动且全部 32 位直接可见。
      const firstRow = page.getByTestId(`register-${first.name}`)
      await expect(page.getByRole('slider', { name: '寄存器表格横向滚动位置', exact: true })).toHaveCount(0)
      expect(await scroller.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      const bit0 = page.getByRole('button', { name: `${first.name} bit 0`, exact: true })
      await expect(bit0).toBeInViewport()
      await expect(page.getByRole('button', { name: `${first.name} bit 31`, exact: true })).toBeInViewport()
      const editStarted = Date.now()
      await bit0.click()
      await expect(page.getByRole('textbox', { name: `${first.name} 待写值`, exact: true })).toHaveValue('0x00000001')
      const editMs = Date.now() - editStarted
      await page.getByRole('checkbox', { name: `选择 ${first.name}`, exact: true }).check()
      await page.getByRole('checkbox', { name: '全选当前筛选寄存器', exact: true }).check()
      await expect(page.getByRole('button', { name: `删除选中 ${count}`, exact: true })).toBeVisible()
      const scrollStarted = Date.now()
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect(page.getByTestId(`register-${last.name}`)).toBeVisible()
      const scrollMs = Date.now() - scrollStarted
      await expect(page.getByRole('checkbox', { name: `选择 ${last.name}`, exact: true })).toBeChecked()
      expect(await page.locator('.register-data-row').count()).toBeLessThan(30)
      // 表头跟随表格滚动，末行没有错位、空白或被日志挡住。
      const heights = await scroller.evaluate(element => ({
        actual: [...element.querySelectorAll('.register-data-row')].map(row => row.getBoundingClientRect().height),
        expected: Number.parseFloat((element as HTMLElement).style.getPropertyValue('--register-row-height')),
      }))
      expect(heights.actual.every(height => Math.abs(height - heights.expected) < 1)).toBe(true)
      const lastBounds = await page.getByTestId(`register-${last.name}`).boundingBox()
      const scrollBounds = await scroller.boundingBox()
      expect(lastBounds!.y + lastBounds!.height).toBeLessThanOrEqual(scrollBounds!.y + scrollBounds!.height + 1)
      await page.getByTestId(`register-${last.name}`).getByRole('button', { name: last.name, exact: true }).click()
      await expect(page.getByRole('complementary', { name: '寄存器位域详情', exact: true })).toContainText(last.name)
      await scroller.evaluate(element => { element.scrollTop = 0 })
      await expect(page.getByRole('textbox', { name: `${first.name} 待写值`, exact: true })).toHaveValue('0x00000001')
      await expect(page.getByRole('checkbox', { name: `选择 ${first.name}`, exact: true })).toBeChecked()
      const search = page.getByRole('textbox', { name: '搜索寄存器', exact: true })
      await search.fill(last.name)
      await expect(page.locator('.register-data-row')).toHaveCount(1)
      await expect(page.getByTestId(`register-${last.name}`)).toBeVisible()
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0)
      await search.fill('')
      await expect(page.getByTestId(`register-${first.name}`)).toBeVisible()
      // 表使用下拉列表，最末分组可直接选择，不再使用横向标签。
      const groups = page.getByRole('combobox', { name: '选择寄存器表', exact: true })
      await expect(groups.locator('option')).toHaveCount(26)
      await groups.selectOption(last.group)
      await expect(page.locator('.register-data-row').first()).toBeVisible()
      // 常用尺寸内全部 32 位同一行、完整落在工作区，不能只用 overflow:hidden 掩盖裁切。
      for (const width of [1920, 1440, 1024, 800]) {
        await page.setViewportSize({ width, height: width === 800 ? 600 : 900 })
        await expect.poll(() => page.locator('.workspace-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
        await expect.poll(() => scroller.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
        const bitBounds = await page.locator('.register-data-row').first().evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const buttons = [...element.querySelectorAll('.bit-button')].map(button => button.getBoundingClientRect())
          return { count: buttons.length, sameLine: new Set(buttons.map(button => Math.round(button.top))).size === 1,
            inside: buttons.every(button => button.left >= bounds.left && button.right <= bounds.right + 1 && button.width >= 12),
            overlap: buttons.some((button, index) => index > 0 && button.left < buttons[index - 1]!.right - 0.5) }
        })
        expect(bitBounds).toEqual({ count: 32, sameLine: true, inside: true, overlap: false })
      }
      await page.getByRole('button', { name: '隐藏左侧导航', exact: true }).click()
      await expect.poll(() => page.locator('.workspace-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await page.getByRole('tab', { name: '连接中心', exact: true }).click()
      await page.locator('.workspace-content').evaluate(element => { element.scrollTop = element.scrollHeight })
      await page.getByRole('tab', { name: '寄存器工作台', exact: true }).click()
      await expect.poll(() => page.locator('.workspace-content').evaluate(element => element.scrollTop)).toBe(0)
      await expect(page.getByRole('heading', { name: '寄存器工作台', exact: true })).toBeInViewport()
      console.log(JSON.stringify({ registers: count, openMs, readMs, editMs, scrollMs, renderedRows: await page.locator('.register-data-row').count() }))
      expect(errors).toEqual([])
    } finally {
      await page.request.post(`/api/connections/${connection.id}/disconnect`)
      await page.request.delete(`/api/connections/${connection.id}`)
      const current = await (await page.request.get('/api/registers/definitions')).json()
      expect((await page.request.post('/api/registers/import', { data: { mode: 'replace', expected_revision: current.revision, registers: original.registers } })).ok()).toBe(true)
    }
  })
}

test('实际整本 530 项和多位域大表可见行渲染，末组/末行/bit0 均可访问', async ({ page }) => {
  const workbook = process.env.TESTSTUDIO_REGISTER_WORKBOOK
  test.skip(!workbook, '可用 TESTSTUDIO_REGISTER_WORKBOOK 指定只读实际工作簿')
  await page.goto('/')
  await expect(page.getByText('内核已连接', { exact: true })).toBeVisible()
  const original = await (await page.request.get('/api/registers/definitions')).json()
  try {
    await page.getByRole('navigation', { name: '功能导航' }).getByRole('button', { name: '寄存器工作台', exact: true }).click()
    await page.getByLabel('寄存器表文件', { exact: true }).setInputFiles(workbook!)
    await page.getByRole('dialog', { name: '选择导入工作表', exact: true }).getByRole('button', { name: '解析选中工作表', exact: true }).click()
    const preview = page.getByRole('dialog', { name: '导入寄存器表预览', exact: true })
    await expect(preview).toContainText('530 个寄存器')
    await preview.getByRole('combobox', { name: '寄存器导入方式', exact: true }).selectOption('replace')
    const importedAt = Date.now()
    await preview.getByRole('button', { name: '确认导入', exact: true }).click()
    await expect(preview).toHaveCount(0)
    await expect(page.locator('.register-table')).toHaveAttribute('aria-rowcount', '531')
    const importRenderMs = Date.now() - importedAt
    const catalog = await (await page.request.get('/api/registers/definitions')).json()
    const last = catalog.registers[catalog.registers.length - 1]
    expect(await page.locator('.register-data-row').count()).toBeLessThan(30)
    const first = catalog.registers[0]
    await expect(page.getByRole('button', { name: `${first.name} bit 0`, exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: `${first.name} bit 31`, exact: true })).toBeInViewport()
    expect(await page.locator('.register-table-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.locator('.register-table-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; element.scrollLeft = 0 })
    await expect(page.getByTestId(`register-${last.name}`)).toBeVisible()
    await page.getByTestId(`register-${last.name}`).getByRole('button', { name: last.name, exact: true }).click()
    await expect(page.getByRole('complementary', { name: '寄存器位域详情', exact: true })).toContainText(last.name)
    await page.getByRole('combobox', { name: '选择寄存器表', exact: true }).selectOption(last.group)
    expect(await page.locator('.register-data-row').count()).toBeGreaterThan(0)
    const stats = await page.locator('.register-main').evaluate(element => ({ renderedRows: element.querySelectorAll('.register-data-row').length, bitButtons: element.querySelectorAll('.bit-button').length }))
    console.log(JSON.stringify({ actualRegisters: catalog.registers.length, groups: new Set(catalog.registers.map((item: { group: string }) => item.group)).size, importRenderMs, ...stats }))
  } finally {
    const current = await (await page.request.get('/api/registers/definitions')).json()
    expect((await page.request.post('/api/registers/import', { data: { mode: 'replace', expected_revision: current.revision, registers: original.registers } })).ok()).toBe(true)
  }
})
