export async function request<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: data === undefined ? undefined : { 'Content-Type': data instanceof Blob ? 'application/octet-stream' : 'application/json' },
    body: data === undefined ? undefined : data instanceof Blob ? data : JSON.stringify(data),
  })
  if (!response.ok) {
    let message = `请求失败（${response.status}）`
    try {
      const body = await response.json()
      message = typeof body.detail === 'string' ? body.detail : '输入参数不合法，请检查后重试'
    } catch { /* 内核不可达时保留 HTTP 信息 */ }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}
