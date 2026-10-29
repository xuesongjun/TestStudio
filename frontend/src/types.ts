export interface SerialPortInfo {
  device: string
  description: string
}

export interface Connection {
  id: string
  name: string
  kind: 'soc' | 'instrument'
  mode: 'simulation' | 'hardware'
  transport: 'serial' | 'tcpip'
  serial: { port: string; baudrate: number; bytesize: 5 | 6 | 7 | 8; parity: 'N' | 'E' | 'O' | 'M' | 'S'; stopbits: 1 | 1.5 | 2 } | null
  instrument: { ip_address: string | null; protocol: 'visa_tcpip' } | null
  endpoint: string
  status: 'connected' | 'disconnected'
  busy: boolean
  session_id: string | null
  connected_at: string | null
}

export interface LogEntry {
  id: number
  timestamp: string
  level: 'INFO' | 'WARNING' | 'ERROR'
  source: string
  message: string
  connection_id: string | null
  task_id: string | null
}

export interface Task {
  id: string
  name: string
  connection_id: string
  status: 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed'
  progress: number
  completed: number
  total: number
  error: string | null
  started_at: string
  finished_at: string | null
  results: { address: string; value: number; readable_mask: number; pass_index: number }[]
}

export interface Snapshot {
  revision: number
  started_at: string
  version: string
  mode: 'simulation'
  connections: Connection[]
  logs: LogEntry[]
  task: Task | null
  register_revision: number
}

export interface RegisterCatalog {
  revision: number
  registers: RegisterDefinition[]
}

export interface RegisterPreview {
  registers: RegisterDefinition[]
  expected_revision: number
  count: number
  groups: string[]
  warnings: string[]
  formats: Record<string, string>
}

export interface RegisterSheet {
  name: string
  format: 'v1' | 'v2' | 'simple' | 'unsupported'
}

export interface BitField {
  name: string
  msb: number
  lsb: number
  access: 'RW' | 'RO' | 'WO' | 'WC' | 'Reserved' | 'W1C' | 'W1_PULSE' | 'WC_INT'
  description: string
  color: string
  reset: number | null
}

export interface RegisterDefinition {
  address: string
  name: string
  group: string
  description: string
  reset: number
  fields: BitField[]
  source_version: 'v1' | 'v2' | 'simple' | 'json' | null
}

export interface RegisterState {
  session: string
  actual: number | null
  draft: number
  mask: number
  verified: boolean | null
  unverifiedMask: number
}

export interface RegisterReadResult {
  address: string
  value: number
  readable_mask: number
}

export interface RegisterWriteResult {
  address: string
  value: number | null
  verified: boolean | null
  verification_mask: number
  unverified_mask: number
}

export type PageId = 'connections' | 'registers' | 'tasks' | 'logs' | 'about'
