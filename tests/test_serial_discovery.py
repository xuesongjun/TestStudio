from unittest.mock import Mock

import pytest
import serial
from fastapi.testclient import TestClient
from serial.tools.list_ports_common import ListPortInfo

from backend.app import create_app
from backend.serial_discovery import SerialDiscoveryError, discover_serial_ports


def port(device: str, description: str):
    info = ListPortInfo(device)
    info.description = description
    return info


def test_serial_discovery_sorts_describes_deduplicates_and_never_opens(monkeypatch):
    enumerator = Mock(return_value=[port('COM12', 'USB 转串口'), port('COM3', '芯片调试口'), port('COM2', 'n/a'), port('COM3', '重复设备')])
    opener = Mock(side_effect=AssertionError('串口枚举不能打开端口'))
    monkeypatch.setattr('backend.serial_discovery.list_ports.comports', enumerator)
    monkeypatch.setattr(serial, 'Serial', opener)
    result = discover_serial_ports()
    assert [item['device'] for item in result] == ['COM2', 'COM3', 'COM12']
    assert result[0]['description'] == '串口设备'
    assert result[1]['description'] == '芯片调试口'
    enumerator.assert_called_once_with()
    opener.assert_not_called()


def test_serial_discovery_empty_and_failure_are_different(monkeypatch):
    monkeypatch.setattr('backend.serial_discovery.list_ports.comports', lambda: [])
    assert discover_serial_ports() == []
    monkeypatch.setattr('backend.serial_discovery.list_ports.comports', Mock(side_effect=OSError('系统枚举失败')))
    with pytest.raises(SerialDiscoveryError, match='串口扫描失败'):
        discover_serial_ports()


def test_serial_ports_api_requires_session_and_only_enumerates(tmp_path, monkeypatch):
    enumerator = Mock(return_value=[port('COM7', '模拟枚举样例')])
    opener = Mock(side_effect=AssertionError('API 不能连接硬件'))
    monkeypatch.setattr('backend.serial_discovery.list_ports.comports', enumerator)
    monkeypatch.setattr(serial, 'Serial', opener)
    with TestClient(create_app(tmp_path / 'discovery.db')) as client:
        assert client.get('/api/serial/ports').status_code == 401
        enumerator.assert_not_called()
        client.post('/api/bootstrap')
        assert client.get('/api/serial/ports').json() == {'ports': [{'device': 'COM7', 'description': '模拟枚举样例'}]}
        opener.assert_not_called()
        monkeypatch.setattr('backend.serial_discovery.list_ports.comports', Mock(side_effect=OSError('系统枚举失败')))
        response = client.get('/api/serial/ports')
        assert response.status_code == 503
        assert '串口扫描失败' in response.json()['detail']
