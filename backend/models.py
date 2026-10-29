"""原型接口数据模型，硬件协议不依赖这些 HTTP 定义。"""

from enum import StrEnum
from ipaddress import IPv4Address
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Access(StrEnum):
    RW = "RW"
    RO = "RO"
    WO = "WO"
    WC = "WC"
    RESERVED = "Reserved"
    W1C = "W1C"
    W1_PULSE = "W1_PULSE"
    WC_INT = "WC_INT"


class BitField(StrictModel):
    name: Annotated[str, Field(min_length=1, max_length=128)]
    msb: Annotated[int, Field(ge=0, le=31)]
    lsb: Annotated[int, Field(ge=0, le=31)]
    access: Access
    description: Annotated[str, Field(max_length=4096)]
    color: Literal["blue", "purple", "cyan", "green", "amber", "gray"] = "blue"
    reset: Annotated[int, Field(ge=0, le=0xFFFFFFFF)] | None = None

    @model_validator(mode="before")
    @classmethod
    def ignore_unused_dft(cls, value):
        # 兼容本轮早期预览/存档，用户明确不保留该元数据。
        if isinstance(value, dict) and "dft_value" in value:
            return {key: item for key, item in value.items() if key != "dft_value"}
        return value

    @property
    def mask(self) -> int:
        return ((1 << (self.msb - self.lsb + 1)) - 1) << self.lsb


class RegisterDefinition(StrictModel):
    address: Annotated[str, Field(pattern=r"^0[xX][0-9a-fA-F]{1,8}$")]
    name: Annotated[str, Field(min_length=1, max_length=128)]
    group: Annotated[str, Field(min_length=1, max_length=128)]
    description: Annotated[str, Field(max_length=4096)]
    reset: Annotated[int, Field(ge=0, le=0xFFFFFFFF)]
    fields: Annotated[list[BitField], Field(min_length=1, max_length=32)]
    source_version: Literal["v1", "v2", "simple", "json"] | None = None

    @model_validator(mode="before")
    @classmethod
    def ignore_unused_merge(cls, value):
        if isinstance(value, dict) and "merged" in value:
            return {key: item for key, item in value.items() if key != "merged"}
        return value

    def access_mask(self, *accesses: Access) -> int:
        return sum(field.mask for field in self.fields if field.access in accesses)

    @property
    def self_clear_mask(self) -> int:
        return self.access_mask(Access.WC, Access.W1_PULSE, Access.WC_INT)

    @property
    def readable_mask(self) -> int:
        wo_mask = self.access_mask(Access.WO)
        if wo_mask and all(field.access in (Access.WO, Access.RESERVED) for field in self.fields):
            return 0
        return 0xFFFFFFFF & ~wo_mask


class RegisterImport(StrictModel):
    mode: Literal["append", "replace"] = "append"
    expected_revision: Annotated[int, Field(ge=0)]
    registers: Annotated[list[RegisterDefinition], Field(min_length=1, max_length=2048)]


class RegisterDelete(StrictModel):
    expected_revision: Annotated[int, Field(ge=0)]
    addresses: Annotated[list[str], Field(min_length=1, max_length=2048)]


class SerialSettings(StrictModel):
    port: Annotated[str, Field(max_length=12)] = ""
    baudrate: Annotated[int, Field(ge=50, le=12000000, strict=True)] = 115200
    bytesize: Literal[5, 6, 7, 8] = 8
    parity: Literal["N", "E", "O", "M", "S"] = "N"
    stopbits: Literal[1, 1.5, 2] = 1

    @field_validator("port")
    @classmethod
    def normalize_port(cls, value: str) -> str:
        import re
        value = value.strip().upper()
        if value and not re.fullmatch(r"COM[1-9][0-9]{0,3}", value):
            raise ValueError("串口号格式应为 COM1、COM12 等")
        return value


class InstrumentSettings(StrictModel):
    ip_address: IPv4Address | None = None
    protocol: Literal["visa_tcpip"] = "visa_tcpip"

    @field_validator("ip_address", mode="before")
    @classmethod
    def empty_ip(cls, value):
        return value.strip() or None if isinstance(value, str) else value


class ConnectionCreate(StrictModel):
    name: Annotated[str, Field(min_length=1, max_length=64, pattern=r".*\S.*")]
    kind: Literal["soc", "instrument"] = "soc"
    mode: Literal["simulation", "hardware"] = "simulation"
    transport: Literal["serial", "tcpip"] | None = None
    serial: SerialSettings | None = None
    instrument: InstrumentSettings | None = None

    @model_validator(mode="after")
    def validate_connection(self):
        expected = "serial" if self.kind == "soc" else "tcpip"
        if self.transport not in (None, expected):
            raise ValueError("SoC 使用串口，仪表使用 IP/TCPIP")
        self.transport = expected
        if self.kind == "soc":
            if self.instrument is not None:
                raise ValueError("SoC 配置不能包含仪表 IP 参数")
            self.serial = self.serial or SerialSettings()
            if self.mode == "hardware" and not self.serial.port:
                raise ValueError("真实设备配置必须填写串口号")
        else:
            if self.serial is not None:
                raise ValueError("仪表配置不能包含串口参数")
            self.instrument = self.instrument or InstrumentSettings()
            if self.mode == "hardware" and self.instrument.ip_address is None:
                raise ValueError("真实仪表配置必须填写 IP 地址")
        return self


class RegisterWrite(StrictModel):
    address: Annotated[str, Field(pattern=r"^0[xX][0-9a-fA-F]{1,8}$")]
    value: Annotated[int, Field(ge=0, le=0xFFFFFFFF, strict=True)]
    mask: Annotated[int, Field(ge=1, le=0xFFFFFFFF, strict=True)]


class ScanRequest(StrictModel):
    connection_id: str
    passes: Annotated[int, Field(ge=1, le=20)] = 3
