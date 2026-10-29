"""共享连接、寄存器策略和协作式单任务调度；不依赖 Web 或桌面框架。"""

from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from threading import Event, RLock, Thread
from uuid import uuid4

from .models import Access, ConnectionCreate, RegisterDefinition, RegisterDelete, RegisterImport, RegisterWrite
from .registers import DEMO_REGISTERS, SimulationDriver, validate_definitions
from .repository import Repository


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def hex32(value: int) -> str:
    return f"0x{value:08X}"


class ServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)


class StudioService:
    def __init__(self, database: Path):
        self.lock = RLock()
        self.repository = Repository(database)
        self.revision = 0
        self.started_at = now()
        self._closing = False
        self.logs = deque(self.repository.logs(), maxlen=500)
        self.profiles = {}
        for row in self.repository.connections():
            # 兼容本项目早期 SIM:// 配置，保留标识与名称，不猜测真实 COM/IP。
            if row.get("transport") == "simulation":
                request = ConnectionCreate(name=row["name"], kind=row["kind"])
                row = self._connection_config(row["id"], request)
                self.repository.update_connection(row)
            self.profiles[row["id"]] = row
        self.sessions: dict[str, dict] = {}
        self.drivers: dict[str, SimulationDriver] = {}
        self.task: dict | None = None
        self.cancel = Event()
        self.worker: Thread | None = None
        catalog = self.repository.register_catalog()
        if catalog is None:
            catalog = {"revision": 1, "registers": [register.model_dump(mode="json") for register in DEMO_REGISTERS]}
            self.repository.save_register_catalog(catalog["revision"], catalog["registers"])
        registers = [RegisterDefinition.model_validate(item) for item in catalog["registers"]]
        validate_definitions(registers)
        self.catalog_revision = catalog["revision"]
        if any("merged" in item or any("dft_value" in field for field in item["fields"])
               for item in catalog["registers"]):
            # 清理本轮早期版本保存的两项元数据，其余定义和初始值保持。
            self.catalog_revision += 1
            self.repository.save_register_catalog(self.catalog_revision, [register.model_dump(mode="json") for register in registers])
        self.definitions = {int(reg.address, 16): reg for reg in registers}
        if not self.profiles:
            for name, kind in [("DUT-A", "soc"), ("DUT-B", "soc"), ("信号源", "instrument")]:
                self.create_connection(ConnectionCreate(name=name, kind=kind))
        self.log("INFO", "内核", "TestStudio 内核就绪；仅支持模拟连接，不会访问真实硬件")

    def log(self, level: str, source: str, message: str, connection_id=None, task_id=None):
        with self.lock:
            entry = self.repository.append_log(dict(
                timestamp=now(), level=level, source=source, message=message,
                connection_id=connection_id, task_id=task_id,
            ))
            self.logs.append(entry)
            self.revision += 1

    def _profile(self, connection_id: str) -> dict:
        if connection_id not in self.profiles:
            raise ServiceError("连接配置不存在", 404)
        return self.profiles[connection_id]

    def clear_logs(self) -> dict:
        with self.lock:
            count = self.repository.clear_logs()
            self.logs.clear()
            self.revision += 1
            return {"deleted": count}

    def register_catalog(self) -> dict:
        with self.lock:
            return {"revision": self.catalog_revision,
                    "registers": [register.model_dump(mode="json") for register in self.definitions.values()]}

    def _check_catalog_change(self, expected_revision: int):
        if self._active():
            raise ServiceError("任务运行中不能导入或删除寄存器，请先停止任务", 409)
        if expected_revision != self.catalog_revision:
            raise ServiceError("寄存器表已发生变化，请刷新并重新确认操作", 409)

    def _save_catalog(self, registers: list[RegisterDefinition]):
        validate_definitions(registers)
        revision = self.catalog_revision + 1
        self.repository.save_register_catalog(revision, [register.model_dump(mode="json") for register in registers])
        self.definitions = {int(register.address, 16): register for register in registers}
        self.catalog_revision = revision
        for driver in self.drivers.values():
            driver.ensure_definitions(registers)
        self.revision += 1

    def import_registers(self, request: RegisterImport) -> dict:
        with self.lock:
            self._check_catalog_change(request.expected_revision)
            try:
                validate_definitions(request.registers)
            except ValueError as exc:
                raise ServiceError(str(exc)) from exc
            incoming = {int(register.address, 16): register for register in request.registers}
            if request.mode == "append":
                conflicts = set(incoming) & set(self.definitions)
                if conflicts:
                    first = ", ".join(hex32(address) for address in sorted(conflicts)[:5])
                    raise ServiceError(f"导入地址与现有表重复：{first}；请检查文件或明确选择替换导入")
                registers = [*self.definitions.values(), *incoming.values()]
            else:
                registers = list(incoming.values())
            if len(registers) > 2048:
                raise ServiceError("工作台最多保存 2048 个寄存器，请拆分表格")
            self._save_catalog(registers)
            self.log("INFO", "寄存器配置", f"已{'追加' if request.mode == 'append' else '替换'}导入 {len(incoming)} 个寄存器定义；未写入设备")
            return {"imported": len(incoming), "revision": self.catalog_revision}

    def delete_registers(self, request: RegisterDelete) -> dict:
        with self.lock:
            self._check_catalog_change(request.expected_revision)
            try:
                addresses = {int(address, 16) for address in request.addresses}
            except ValueError as exc:
                raise ServiceError("删除列表的寄存器地址无效") from exc
            if not addresses <= self.definitions.keys():
                raise ServiceError("部分寄存器已不存在，请刷新后重试", 409)
            self._save_catalog([register for address, register in self.definitions.items() if address not in addresses])
            self.log("INFO", "寄存器配置", f"已从工作台删除 {len(addresses)} 个寄存器定义；未写入设备")
            return {"deleted": len(addresses), "revision": self.catalog_revision}

    def _active(self) -> bool:
        return self.task is not None and self.task["status"] in ("running", "cancelling")

    def _driver(self, connection_id: str, check_busy=True) -> SimulationDriver:
        profile = self._profile(connection_id)
        if connection_id not in self.sessions:
            raise ServiceError("设备未连接，请先在连接中心连接", 409)
        if profile["kind"] != "soc":
            raise ServiceError("当前连接不是 SoC，不能访问寄存器", 409)
        if check_busy and self._active():
            raise ServiceError("硬件任务正在执行，请停止或等待任务完成后操作", 409)
        return self.drivers[connection_id]

    def snapshot(self) -> dict:
        with self.lock:
            connections = []
            for profile in self.profiles.values():
                session = self.sessions.get(profile["id"], {})
                busy = self._active() and self.task["connection_id"] == profile["id"]
                connections.append({
                    **profile, "status": "connected" if session else "disconnected",
                    "busy": bool(busy), "session_id": session.get("id"),
                    "connected_at": session.get("connected_at"),
                })
            return {
                "revision": self.revision, "started_at": self.started_at,
                "mode": "simulation", "version": "0.1.0",
                "register_revision": self.catalog_revision,
                "connections": connections,
                "task": {**self.task, "results": list(self.task["results"])} if self.task else None,
                "logs": list(self.logs),
            }

    def create_connection(self, request: ConnectionCreate) -> dict:
        with self.lock:
            name = request.name.strip()
            if any(profile["name"].casefold() == name.casefold() for profile in self.profiles.values()):
                raise ServiceError("连接名称已存在")
            profile = self._connection_config(uuid4().hex, request)
            self.repository.save_connection(profile)
            self.profiles[profile["id"]] = profile
            label = "模拟" if request.mode == "simulation" else "硬件"
            self.log("INFO", "连接中心", f"已创建{label}连接配置：{name}", profile["id"])
            return profile

    @staticmethod
    def _connection_config(connection_id: str, request: ConnectionCreate) -> dict:
        profile = {"id": connection_id, **request.model_dump(mode="json")}
        profile["name"] = request.name.strip()
        profile["endpoint"] = (request.serial.port or "未配置串口") if request.kind == "soc" else (
            str(request.instrument.ip_address) if request.instrument.ip_address else "未配置 IP")
        return profile

    def update_connection(self, connection_id: str, request: ConnectionCreate) -> dict:
        with self.lock:
            self._profile(connection_id)
            if connection_id in self.sessions:
                raise ServiceError("请先断开连接再修改参数", 409)
            name = request.name.strip()
            if any(item["id"] != connection_id and item["name"].casefold() == name.casefold()
                   for item in self.profiles.values()):
                raise ServiceError("连接名称已存在")
            profile = self._connection_config(connection_id, request)
            self.repository.update_connection(profile)
            self.profiles[connection_id] = profile
            self.log("INFO", "连接中心", f"已更新连接配置：{name}", connection_id)
            return profile

    def connect(self, connection_id: str):
        with self.lock:
            if self._closing:
                raise ServiceError("内核正在退出", 409)
            profile = self._profile(connection_id)
            if profile["mode"] != "simulation":
                raise ServiceError("真实串口/IP 驱动尚未接入，配置已保存，但不能建立硬件会话", 409)
            if connection_id in self.sessions:
                return self.sessions[connection_id]
            session = dict(id=uuid4().hex, connected_at=now())
            self.sessions[connection_id] = session
            if profile["kind"] == "soc":
                self.drivers[connection_id] = SimulationDriver(self.definitions.values())
            self.log("INFO", "连接中心", f"{profile['name']} 模拟连接已建立，各模块共享此会话", connection_id)
            return session

    def disconnect(self, connection_id: str):
        with self.lock:
            profile = self._profile(connection_id)
            if self._active() and self.task["connection_id"] == connection_id:
                raise ServiceError("设备正被任务占用，请先停止任务", 409)
            if self.sessions.pop(connection_id, None):
                self.drivers.pop(connection_id, None)
                self.log("INFO", "连接中心", f"{profile['name']} 已断开", connection_id)

    def delete_connection(self, connection_id: str):
        with self.lock:
            profile = self._profile(connection_id)
            if connection_id in self.sessions:
                raise ServiceError("请先断开连接再删除配置", 409)
            self.repository.delete_connection(connection_id)
            del self.profiles[connection_id]
            self.log("INFO", "连接中心", f"已删除连接配置：{profile['name']}")

    def read_registers(self, connection_id: str) -> list[dict]:
        with self.lock:
            driver = self._driver(connection_id)
            values = [self._read_value(driver, address, definition) for address, definition in self.definitions.items()
                      if definition.readable_mask]
            skipped = len(self.definitions) - len(values)
            self.log("INFO", "寄存器", f"模拟读取完成：{len(values)} 个寄存器"
                     + (f"；跳过 {skipped} 个 WO 只写寄存器" if skipped else ""), connection_id)
            return values

    @staticmethod
    def _read_value(driver: SimulationDriver, address: int, definition: RegisterDefinition) -> dict:
        return {"address": hex32(address), "value": driver.read(address) & definition.readable_mask,
                "readable_mask": definition.readable_mask}

    def read_register(self, connection_id: str, address: int) -> dict:
        with self.lock:
            driver = self._driver(connection_id)
            if address not in self.definitions:
                raise ServiceError("寄存器未定义，原型禁止任意地址访问", 404)
            definition = self.definitions[address]
            if not definition.readable_mask:
                raise ServiceError("寄存器仅含 WO 只写字段和保留位，不能读取")
            result = self._read_value(driver, address, definition)
            suffix = "；WO 位无有效读回值" if definition.access_mask(Access.WO) else ""
            self.log("INFO", "寄存器", f"模拟读取 {hex32(address)} → {hex32(result['value'])}{suffix}", connection_id)
            return result

    def write_register(self, connection_id: str, request: RegisterWrite) -> dict:
        with self.lock:
            driver = self._driver(connection_id)
            address = int(request.address, 16)
            definition = self.definitions.get(address)
            if not definition:
                raise ServiceError("寄存器未定义，原型禁止任意地址写入", 404)
            rw_mask = definition.access_mask(Access.RW)
            w1c_mask = definition.access_mask(Access.W1C)
            wo_mask = definition.access_mask(Access.WO)
            wc_mask = definition.self_clear_mask
            writable = rw_mask | w1c_mask | wo_mask | wc_mask
            if request.mask & ~writable:
                raise ServiceError("写掩码包含 RO/保留位或尚未支持的不可写类型，已拒绝写入")
            for bit_field in definition.fields:
                if bit_field.access == Access.WO and (request.mask & bit_field.mask) not in (0, bit_field.mask):
                    raise ServiceError(f"WO 字段 {bit_field.name} 不能读改写，请一次提交完整位域")
            readable_mask = definition.readable_mask
            current = driver.read(address) & readable_mask if readable_mask else None
            rw = request.mask & rw_mask
            clear = request.value & request.mask & w1c_mask
            expected = (((current or 0) & ~rw & ~wc_mask) | (request.value & rw)) & ~clear
            # WO/WC 从显式命令取值，未提交的触发位写 0，不重放读回值或上次命令。
            driver.write(address, expected | (request.value & request.mask & (wo_mask | wc_mask)))
            actual = driver.read(address) & readable_mask if readable_mask else None
            verification_mask = request.mask & (rw_mask | w1c_mask)
            unverified_mask = request.mask & (wo_mask | wc_mask)
            verified = ((actual ^ expected) & verification_mask) == 0 if verification_mask else None
            status = ("可读位校验通过" if verified else "可读位校验失败") if verification_mask else "写入已提交"
            if unverified_mask & wo_mask:
                status += "；WO 只写位不参与读回校验"
            if unverified_mask & wc_mask:
                status += "；WC/W1_PULSE/WC_INT 自清零位不做值相等校验"
            self.log("ERROR" if verified is False else "INFO", "寄存器",
                     f"模拟写入 {hex32(address)}：掩码 {hex32(request.mask)}，"
                     + (f"有效读回 {hex32(actual)}，" if actual is not None else "") + status, connection_id)
            return {"address": hex32(address), "previous": current, "value": actual,
                    "expected": expected if readable_mask else None, "verified": verified,
                    "readable_mask": readable_mask, "verification_mask": verification_mask,
                    "unverified_mask": unverified_mask, "simulation": True}

    def start_scan(self, connection_id: str, passes: int) -> dict:
        with self.lock:
            if self._closing:
                raise ServiceError("内核正在退出", 409)
            self._driver(connection_id)
            if not self.definitions:
                raise ServiceError("寄存器表为空，请先导入寄存器", 409)
            readable_count = sum(bool(definition.readable_mask) for definition in self.definitions.values())
            if not readable_count:
                raise ServiceError("寄存器表仅含 WO 只写寄存器，没有可巡检的可读寄存器", 409)
            if self._active():
                raise ServiceError("只能同时执行一个硬件任务", 409)
            self.cancel = Event()
            self.task = dict(id=uuid4().hex, name="模拟寄存器巡检", connection_id=connection_id,
                             status="running", progress=0, completed=0, total=readable_count * passes,
                             started_at=now(), finished_at=None, error=None, results=[])
            skipped = len(self.definitions) - readable_count
            self.log("INFO", "任务", f"开始模拟寄存器巡检，共 {passes} 轮"
                     + (f"；跳过 {skipped} 个 WO 只写寄存器" if skipped else ""), connection_id, self.task["id"])
            self.worker = Thread(target=self._scan, args=(connection_id, passes), daemon=True)
            self.worker.start()
            return {**self.task, "results": []}

    def _scan(self, connection_id: str, passes: int):
        try:
            for pass_index in range(passes):
                for address, definition in self.definitions.items():
                    if not definition.readable_mask:
                        continue
                    if self.cancel.wait(0.12):
                        self._finish_task("cancelled")
                        return
                    with self.lock:
                        value = self._driver(connection_id, check_busy=False).read(address) & definition.readable_mask
                        self.task["results"].append(dict(address=hex32(address), value=value,
                                                         readable_mask=definition.readable_mask, pass_index=pass_index + 1))
                        self.task["completed"] += 1
                        self.task["progress"] = self.task["completed"] / self.task["total"]
                        self.revision += 1
                self.log("INFO", "任务", f"第 {pass_index + 1}/{passes} 轮模拟读取完成", connection_id, self.task["id"])
            self._finish_task("completed")
        except Exception as exc:
            self._finish_task("failed", str(exc))

    def _finish_task(self, status: str, error=None):
        with self.lock:
            self.task.update(status=status, finished_at=now(), error=error)
            message = {"completed": "巡检完成，模拟设备占用已释放，连接保持", "cancelled": "巡检已停止，连接保持",
                       "failed": f"巡检失败：{error}"}[status]
            self.log("ERROR" if error else "INFO", "任务", message, self.task["connection_id"], self.task["id"])

    def cancel_task(self):
        with self.lock:
            if not self._active():
                raise ServiceError("没有可停止的任务", 409)
            self.task["status"] = "cancelling"
            self.cancel.set()
            self.revision += 1

    def close(self):
        with self.lock:
            self._closing = True
            self.cancel.set()
            worker = self.worker
        if worker:
            worker.join(timeout=3)
        with self.lock:
            self.sessions.clear()
            self.drivers.clear()
