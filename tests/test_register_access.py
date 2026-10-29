"""WO 与 WC 的导入、显式命令、读取隔离和校验边界，全部使用合成模拟定义。"""

import io
import json
from time import monotonic, sleep

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from backend.app import create_app
from backend.models import RegisterImport, RegisterWrite
from backend.register_import import parse_register_file
from backend.service import ServiceError, StudioService


def access_registers():
    return [
        {'address': '0x7000', 'name': 'WRITE_ONLY', 'reset': 0xFFFFFFFF,
         'fields': [{'name': 'COMMAND', 'msb': 31, 'lsb': 0, 'access': 'WO'}]},
        {'address': '0x7004', 'name': 'SHORT_COMMAND', 'reset': 0xF,
         'fields': [{'name': 'COMMAND', 'msb': 3, 'lsb': 0, 'access': 'WO'}]},
        {'address': '0x7008', 'name': 'MIXED', 'reset': 0xA5A534F7,
         'fields': [
             {'name': 'STATUS', 'msb': 31, 'lsb': 16, 'access': 'RO'},
             {'name': 'PULSE', 'msb': 15, 'lsb': 12, 'access': 'W1_PULSE'},
             {'name': 'INTERRUPT', 'msb': 11, 'lsb': 8, 'access': 'WC_INT'},
             {'name': 'COMMAND', 'msb': 7, 'lsb': 4, 'access': 'WO'},
             {'name': 'CONTROL', 'msb': 3, 'lsb': 2, 'access': 'RW'},
             {'name': 'IRQ', 'msb': 1, 'lsb': 1, 'access': 'W1C'},
             {'name': 'START', 'msb': 0, 'lsb': 0, 'access': 'WC'},
         ]},
    ]


@pytest.fixture
def access_service(tmp_path):
    service = StudioService(tmp_path / 'access.db')
    registers = parse_register_file('access.json', json.dumps(access_registers()).encode())['registers']
    service.import_registers(RegisterImport(mode='replace', expected_revision=service.catalog_revision, registers=registers))
    connection_id = service.snapshot()['connections'][0]['id']
    service.connect(connection_id)
    yield service, connection_id, service.drivers[connection_id]
    service.close()


@pytest.mark.parametrize('version', ['v1', 'v2'])
@pytest.mark.parametrize('self_clear_access', ['WC', 'W1_PULSE', 'WC_INT'])
def test_wo_wc_excel_json_roundtrip_and_restart(version, self_clear_access, tmp_path):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'ACCESS_EXAMPLE'
    sheet.append(['独立合成访问类型样例'])
    sheet.append(['基地址', '0x7000'])
    sheet.append([])
    header = ['名称', '说明', '偏移地址', '初始值', '成员变量', '位域', '类型', '初始值', '成员描述']
    rows = [
        ['WRITE_ONLY', '只写字段', '0x0', '0xF', 'COMMAND', '3:0', ' wo ', '0xF', '命令值'],
        ['SELF_CLEAR', '写 1 后硬件自动清 0', '0x4', '0x1', 'START', '0', self_clear_access.lower(), '0x1', '启动'],
    ]
    if version == 'v2':
        header.insert(2, '合并')
        header.insert(9, 'DFT值')
        for row in rows:
            row.insert(2, '忽略')
            row.insert(9, '忽略')
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    content = io.BytesIO()
    workbook.save(content)
    workbook.close()
    preview = parse_register_file('access.xlsx', content.getvalue())
    assert preview['formats'] == {'ACCESS_EXAMPLE': version}
    assert next(field for field in preview['registers'][0]['fields'] if field['name'] == 'COMMAND')['access'] == 'WO'
    assert next(field for field in preview['registers'][1]['fields'] if field['name'] == 'START')['access'] == self_clear_access
    assert not any('语义待确认' in warning for warning in preview['warnings'])
    assert parse_register_file('roundtrip.json', json.dumps(preview).encode())['registers'] == preview['registers']
    path = tmp_path / 'persistent.db'
    service = StudioService(path)
    try:
        service.import_registers(RegisterImport(mode='replace', expected_revision=service.catalog_revision, registers=preview['registers']))
    finally:
        service.close()
    restarted = StudioService(path)
    try:
        assert restarted.register_catalog()['registers'] == preview['registers']
    finally:
        restarted.close()


def test_pure_wo_never_reads_and_allows_repeated_zero_commands(access_service, monkeypatch):
    service, connection_id, driver = access_service
    original_read = driver.read
    reads = []

    def read(address):
        reads.append(address)
        assert address == 0x7008, '不应对纯 WO 寄存器发起读取'
        return original_read(address)

    monkeypatch.setattr(driver, 'read', read)
    with pytest.raises(ServiceError, match='不能读取'):
        service.read_register(connection_id, 0x7000)
    assert not reads
    for value in (0x80000000, 0, 0, 0xFFFFFFFF):
        result = service.write_register(connection_id, RegisterWrite(address='0x7000', value=value, mask=0xFFFFFFFF))
        assert result['value'] is None
        assert result['previous'] is None
        assert result['expected'] is None
        assert result['verified'] is None
        assert result['verification_mask'] == result['readable_mask'] == 0
        assert result['unverified_mask'] == 0xFFFFFFFF
        assert driver.values[0x7000] == value
    assert not reads
    assert [row['address'] for row in service.read_registers(connection_id)] == ['0x00007008']
    reads.clear()
    service.start_scan(connection_id, 1)
    deadline = monotonic() + 3
    while service.snapshot()['task']['status'] in ('running', 'cancelling'):
        assert monotonic() < deadline
        sleep(0.01)
    task = service.snapshot()['task']
    assert task['status'] == 'completed'
    assert task['completed'] == task['total'] == 1
    assert reads == [0x7008]
    assert task['results'][0]['readable_mask'] == 0xFFFFFF0F
    assert task['results'][0]['value'] & 0xF0 == 0


def test_wo_requires_complete_field_and_protects_unknown_bits(access_service, monkeypatch):
    service, connection_id, driver = access_service
    writes = []
    monkeypatch.setattr(driver, 'write', lambda *args: writes.append(args))
    for address, mask in [('0x7000', 1), ('0x7004', 1), ('0x7008', 0x10)]:
        with pytest.raises(ServiceError, match='完整位域'):
            service.write_register(connection_id, RegisterWrite(address=address, value=1, mask=mask))
    with pytest.raises(ServiceError, match='RO/保留位'):
        service.write_register(connection_id, RegisterWrite(address='0x7004', value=0, mask=0x10))
    assert not writes


def test_mixed_wo_wc_write_masks_and_no_command_replay(access_service, monkeypatch):
    service, connection_id, driver = access_service
    original_write = driver.write
    writes = []

    def write(address, value):
        writes.append(value)
        original_write(address, value)

    monkeypatch.setattr(driver, 'write', write)
    initial = service.read_register(connection_id, 0x7008)
    assert initial['value'] == 0xA5A53407
    assert initial['readable_mask'] == 0xFFFFFF0F
    # WO/自清零位和 RW/W1C 同一命令；未提交的自清零位不重放，RO 保持。
    result = service.write_register(connection_id, RegisterWrite(address='0x7008', value=0xAB, mask=0xFF))
    assert writes == [0xA5A500A9]
    assert driver.values[0x7008] == 0xA5A500A8  # 模拟自清零位自动清 0
    assert result['value'] == result['expected'] == 0xA5A50008
    assert result['verified'] is True
    assert result['verification_mask'] == 0xE
    assert result['unverified_mask'] == 0xF1
    # 只修改 RW 时，不把上次 WO 命令或读到的 WC=1 带入写命令。
    driver.values[0x7008] |= 1
    result = service.write_register(connection_id, RegisterWrite(address='0x7008', value=0, mask=4))
    assert writes[-1] & 0xF1 == 0
    assert result['verified'] is True
    assert result['unverified_mask'] == 0
    with pytest.raises(ServiceError, match='不可写'):
        service.write_register(connection_id, RegisterWrite(address='0x7008', value=0, mask=0x10000))


@pytest.mark.parametrize('bit', [0, 8, 12])
def test_self_clear_does_not_require_readback_to_match_one_or_zero(access_service, monkeypatch, bit):
    service, connection_id, driver = access_service
    original_write = driver.write

    def slow_self_clear(address, value):
        original_write(address, value)
        driver.values[address] |= 1 << bit  # 模拟硬件动作尚未完成，读回仍为 1

    monkeypatch.setattr(driver, 'write', slow_self_clear)
    result = service.write_register(connection_id, RegisterWrite(address='0x7008', value=1 << bit, mask=1 << bit))
    assert result['verified'] is None
    assert result['value'] & 1 << bit
    assert result['verification_mask'] == 0
    assert result['unverified_mask'] == 1 << bit
    assert '自清零' in service.snapshot()['logs'][-1]['message']


@pytest.mark.parametrize('bit', [0, 8, 12])
def test_self_clear_aliases_clear_in_simulation_and_accept_repeated_trigger(access_service, monkeypatch, bit):
    service, connection_id, driver = access_service
    original_write = driver.write
    commands = []

    def write(address, value):
        commands.append(value)
        original_write(address, value)

    monkeypatch.setattr(driver, 'write', write)
    for value in (0, 1 << bit, 1 << bit):
        result = service.write_register(connection_id, RegisterWrite(address='0x7008', value=value, mask=1 << bit))
        assert commands[-1] & 0xFF01 == value
        assert result['verified'] is None
        assert result['value'] & 0xFF01 == 0
        assert result['unverified_mask'] == 1 << bit


def test_wc_zero_does_not_trigger_and_mixed_verification_still_detects_rw_error(access_service, monkeypatch):
    service, connection_id, driver = access_service
    original_write = driver.write
    writes = []

    def faulty_rw(address, value):
        writes.append(value)
        original_write(address, value)
        driver.values[address] ^= 4  # 注入可读写位故障，不因存在 WO/WC 而放过校验

    monkeypatch.setattr(driver, 'write', faulty_rw)
    result = service.write_register(connection_id, RegisterWrite(address='0x7008', value=0, mask=1))
    assert writes[-1] & 1 == 0
    assert result['verified'] is None
    result = service.write_register(connection_id, RegisterWrite(address='0x7008', value=5, mask=5))
    assert result['verified'] is False
    assert result['verification_mask'] == 4
    assert result['unverified_mask'] == 1
    assert service.snapshot()['logs'][-1]['level'] == 'ERROR'


def test_pure_wo_catalog_rejects_scan_and_api_reports_unverified(tmp_path):
    with TestClient(create_app(tmp_path / 'api-access.db')) as client:
        client.post('/api/bootstrap')
        revision = client.get('/api/registers/definitions').json()['revision']
        preview = client.post('/api/registers/preview?filename=access.json',
                              content=json.dumps(access_registers()[:2]).encode()).json()
        assert client.post('/api/registers/import', json={
            'mode': 'replace', 'expected_revision': revision, 'registers': preview['registers'],
        }).status_code == 200
        connection_id = client.get('/api/state').json()['connections'][0]['id']
        client.post(f'/api/connections/{connection_id}/connect')
        assert client.get(f'/api/connections/{connection_id}/registers').json() == []
        assert client.get(f'/api/connections/{connection_id}/registers/0x7000').status_code == 400
        assert client.post('/api/tasks/scan', json={'connection_id': connection_id, 'passes': 1}).status_code == 409
        result = client.post(f'/api/connections/{connection_id}/registers/write',
                             json={'address': '0x7004', 'value': 0, 'mask': 0xF})
        assert result.status_code == 200
        assert result.json()['verified'] is None
        assert result.json()['value'] is None
