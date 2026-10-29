"""只枚举系统报告的串口，不打开端口，也不判断设备是否可连接。"""

from serial.tools import list_ports


class SerialDiscoveryError(Exception):
    """系统串口枚举失败，与没有可用端口区分。"""


def discover_serial_ports() -> list[dict[str, str]]:
    try:
        # ListPortInfo 支持自然顺序比较：COM2 排在 COM10 前。
        discovered = sorted(list_ports.comports())
        ports = {}
        for info in discovered:
            device = info.device.strip().upper()
            if device and device not in ports:
                description = (info.description or "").strip()
                ports[device] = {
                    "device": device,
                    "description": description if description and description != "n/a" else "串口设备",
                }
        return list(ports.values())
    except Exception as exc:
        raise SerialDiscoveryError("串口扫描失败，请检查系统设备状态后重试") from exc
