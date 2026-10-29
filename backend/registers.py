"""通用模拟寄存器，不使用真实芯片地址或厂商位域定义。"""

from .models import Access, BitField, RegisterDefinition


def field(name, msb, lsb, access, description, color="blue"):
    return BitField(name=name, msb=msb, lsb=lsb, access=access, description=description, color=color)


DEMO_REGISTERS = [
    RegisterDefinition(
        address="0x00001000", name="SYSTEM_CTRL", group="SYSTEM", reset=0x00000101,
        description="系统控制 · 模拟位域，不对应真实芯片",
        fields=[field("RESERVED", 31, 16, Access.RESERVED, "保留，禁止修改", "gray"),
                field("CLOCK_DIV", 15, 8, Access.RW, "时钟分频系数", "purple"),
                field("MODE", 7, 4, Access.RW, "工作模式：0 空闲 / 1 接收 / 2 回放", "cyan"),
                field("RESERVED", 3, 1, Access.RESERVED, "保留，禁止修改", "gray"),
                field("ENABLE", 0, 0, Access.RW, "使能位", "green")],
    ),
    RegisterDefinition(
        address="0x00001004", name="DEVICE_STATUS", group="SYSTEM", reset=0x00000005,
        description="设备状态 · 只读寄存器",
        fields=[field("RESERVED", 31, 8, Access.RESERVED, "保留", "gray"),
                field("STATE", 7, 0, Access.RO, "模拟设备状态，不能写入", "cyan")],
    ),
    RegisterDefinition(
        address="0x00001008", name="IRQ_STATUS", group="SYSTEM", reset=0x00000003,
        description="中断状态 · W1C 写 1 清零示例",
        fields=[field("RESERVED", 31, 4, Access.RESERVED, "保留", "gray"),
                field("IRQ_FLAGS", 3, 0, Access.W1C, "待写值为 1 时清除此中断位，0 保持", "amber")],
    ),
]

for index, (name, description, reset) in enumerate([
    ("RX_GAIN", "接收增益", 0x00001234),
    ("IQ_CONFIG", "IQ 采集配置", 0x00001000),
    ("BUFFER_LENGTH", "缓冲区长度", 0x00001000),
    ("TRIGGER_CTRL", "触发控制", 0x00000001),
    ("SCRATCH", "可读写测试寄存器", 0x12345678),
]):
    DEMO_REGISTERS.append(RegisterDefinition(
        address=f"0x{0x1100 + index * 4:08X}", name=name, group="CAPTURE", reset=reset,
        description=f"{description} · 仅模拟",
        fields=[field("HIGH", 31, 16, Access.RW, "高 16 位参数", "purple"),
                field("LOW", 15, 0, Access.RW, "低 16 位参数", "blue")],
    ))


def validate_definitions(definitions: list[RegisterDefinition]):
    addresses = set()
    for register in definitions:
        address = int(register.address, 16)
        if address < 0 or address > 0xFFFFFFFF or address in addresses or address % 4:
            raise ValueError("寄存器地址重复或未对齐")
        addresses.add(address)
        covered = 0
        for bit_field in register.fields:
            if bit_field.msb < bit_field.lsb or covered & bit_field.mask:
                raise ValueError("位域范围错误或重叠")
            covered |= bit_field.mask
        if covered != 0xFFFFFFFF:
            raise ValueError("寄存器描述必须显式覆盖所有位，未知位不能默认为可写")


validate_definitions(DEMO_REGISTERS)


class SimulationDriver:
    """独立于 UI/HTTP 的模拟驱动，连接会话期间保留寄存器值。"""

    def __init__(self, definitions=None):
        self.values = {}
        self.read_masks = {}
        self.self_clear_masks = {}
        self.ensure_definitions(DEMO_REGISTERS if definitions is None else definitions)

    def ensure_definitions(self, definitions):
        """只为新增的模拟地址建立初值，不重置已有模拟寄存器。"""
        for register in definitions:
            address = int(register.address, 16)
            self.values.setdefault(address, register.reset)
            self.read_masks[address] = register.readable_mask
            self.self_clear_masks[address] = register.self_clear_mask

    def read(self, address: int) -> int:
        mask = self.read_masks[address]
        if not mask:
            raise ValueError("WO 只写寄存器不能读取")
        return self.values[address] & mask

    def write(self, address: int, value: int):
        # 模拟 WC/W1_PULSE/WC_INT 立即自清零，不能代表真实硬件已经完成动作。
        self.values[address] = value & ~self.self_clear_masks[address]
