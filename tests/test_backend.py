from time import monotonic, sleep

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.models import ConnectionCreate, RegisterWrite
from backend.repository import Repository
from backend.service import ServiceError, StudioService


@pytest.fixture
def service(tmp_path):
    studio = StudioService(tmp_path / "test.db")
    yield studio
    studio.close()


def connected_soc(service):
    connection = next(item for item in service.snapshot()["connections"] if item["kind"] == "soc")
    service.connect(connection["id"])
    return connection["id"]


def wait_done(service):
    deadline = monotonic() + 5
    while service.snapshot()["task"]["status"] in ("running", "cancelling"):
        assert monotonic() < deadline
        sleep(0.02)


def test_connection_reuse_and_restart_disconnected(service):
    connection_id = connected_soc(service)
    original = service.snapshot()["connections"][0]["session_id"]
    service.connect(connection_id)
    assert service.snapshot()["connections"][0]["session_id"] == original
    service.write_register(connection_id, RegisterWrite(address="0x1000", value=0, mask=1))
    assert service.read_register(connection_id, 0x1000)["value"] == 0x100
    other = StudioService(service.repository.path)
    try:
        assert other.snapshot()["connections"][0]["status"] == "disconnected"
        assert len(other.snapshot()["connections"]) == 3
    finally:
        other.close()


def test_protected_bits_and_masked_write(service):
    connection_id = connected_soc(service)
    with pytest.raises(ServiceError, match="RO/保留"):
        service.write_register(connection_id, RegisterWrite(address="0x1000", value=0xFFFFFFFF, mask=0xFFFFFFFF))
    with pytest.raises(ServiceError):
        service.write_register(connection_id, RegisterWrite(address="0x1004", value=0, mask=1))
    result = service.write_register(connection_id, RegisterWrite(address="0x1000", value=0xF0, mask=0xF0))
    assert result["value"] == 0x1F1
    assert result["verified"] is True


def test_w1c_clears_only_requested_bits(service):
    connection_id = connected_soc(service)
    result = service.write_register(connection_id, RegisterWrite(address="0x1008", value=1, mask=0xF))
    assert result["value"] == 2
    result = service.write_register(connection_id, RegisterWrite(address="0x1008", value=0, mask=0xF))
    assert result["value"] == 2


def test_unsigned_32_bit_write(service):
    connection_id = connected_soc(service)
    result = service.write_register(connection_id, RegisterWrite(address="0x1110", value=0xFFFFFFFF, mask=0xFFFFFFFF))
    assert result["value"] == 0xFFFFFFFF


def test_disconnected_and_unknown_address_rejected(service):
    connection_id = service.snapshot()["connections"][0]["id"]
    with pytest.raises(ServiceError, match="未连接"):
        service.read_register(connection_id, 0x1000)
    service.connect(connection_id)
    with pytest.raises(ServiceError, match="未定义"):
        service.read_register(connection_id, 0x9999)


def test_single_task_lock_cancel_keep_connection(service):
    connection_id = connected_soc(service)
    second_id = service.snapshot()["connections"][1]["id"]
    service.connect(second_id)
    service.start_scan(connection_id, 5)
    with pytest.raises(ServiceError):
        service.start_scan(second_id, 1)
    with pytest.raises(ServiceError):
        service.read_register(connection_id, 0x1000)
    with pytest.raises(ServiceError):
        service.disconnect(connection_id)
    service.cancel_task()
    wait_done(service)
    assert service.snapshot()["task"]["status"] == "cancelled"
    assert service.snapshot()["connections"][0]["status"] == "connected"
    service.read_register(connection_id, 0x1000)


def test_task_completion_and_close(service):
    connection_id = connected_soc(service)
    service.start_scan(connection_id, 1)
    wait_done(service)
    task = service.snapshot()["task"]
    assert task["status"] == "completed"
    assert task["progress"] == 1
    assert len(task["results"]) == 8
    service.start_scan(connection_id, 5)
    service.close()
    assert not service.sessions
    assert not service.worker.is_alive()


def test_create_delete_configuration_persists(service):
    profile = service.create_connection(ConnectionCreate(name="DUT-C"))
    assert len(service.repository.connections()) == 4
    with pytest.raises(ServiceError, match="名称已存在"):
        service.create_connection(ConnectionCreate(name=" DUT-C "))
    service.delete_connection(profile["id"])
    assert len(service.repository.connections()) == 3


def test_http_session_validation_and_api(tmp_path):
    app = create_app(tmp_path / "api.db")
    with TestClient(app) as client:
        assert client.get("/api/state").status_code == 401
        assert client.post("/api/bootstrap", headers={"origin": "https://evil.example"}).status_code == 403
        assert client.get("/api/health", headers={"host": "evil.example"}).status_code == 403
        assert client.post("/api/bootstrap").status_code == 200
        snapshot = client.get("/api/state").json()
        connection_id = snapshot["connections"][0]["id"]
        assert client.post(f"/api/connections/{connection_id}/connect").status_code == 200
        assert len(client.get(f"/api/connections/{connection_id}/registers").json()) == 8
        assert client.post(f"/api/connections/{connection_id}/registers/write", json={"address": "0x1000", "value": 0x100000000, "mask": 1}).status_code == 422
        assert client.post("/api/connections", json={"name": "设备", "kind": "instrument", "transport": "serial"}).status_code == 422
        assert client.post("/api/tasks/scan", json={"connection_id": connection_id, "passes": 0}).status_code == 422
        with client.websocket_connect("/api/events") as socket:
            assert socket.receive_json()["mode"] == "simulation"


def test_serial_ip_configuration_validation_and_hardware_guard(service):
    serial = ConnectionCreate.model_validate({
        "name": "串口设备", "kind": "soc", "mode": "hardware", "transport": "serial",
        "serial": {"port": " com113 ", "baudrate": 921600, "bytesize": 8, "parity": "N", "stopbits": 1},
    })
    device = service.create_connection(serial)
    assert device["serial"]["port"] == "COM113"
    assert device["transport"] == "serial"
    assert device["endpoint"] == "COM113"
    assert device["mode"] == "hardware"
    with pytest.raises(ServiceError, match="驱动尚未接入"):
        service.connect(device["id"])
    assert device["id"] not in service.sessions
    instrument = service.create_connection(ConnectionCreate.model_validate({
        "name": "网络仪表", "kind": "instrument", "mode": "hardware",
        "instrument": {"ip_address": "192.168.1.100", "protocol": "visa_tcpip"},
    }))
    assert instrument["transport"] == "tcpip"
    assert instrument["instrument"]["ip_address"] == "192.168.1.100"
    assert instrument["serial"] is None
    with pytest.raises(ServiceError, match="驱动尚未接入"):
        service.connect(instrument["id"])
    for payload in [
        {"name": "bad", "kind": "soc", "mode": "hardware"},
        {"name": "bad", "kind": "soc", "serial": {"port": "123"}},
        {"name": "bad", "kind": "soc", "serial": {"baudrate": 0}},
        {"name": "bad", "kind": "soc", "instrument": {"ip_address": "192.168.1.1"}},
        {"name": "bad", "kind": "instrument", "mode": "hardware"},
        {"name": "bad", "kind": "instrument", "instrument": {"ip_address": "999.1.1.1"}},
        {"name": "bad", "kind": "instrument", "serial": {"port": "COM3"}},
    ]:
        with pytest.raises(ValueError):
            ConnectionCreate.model_validate(payload)


def test_edit_connection_config_requires_disconnect_and_persists(service):
    connection_id = connected_soc(service)
    request = ConnectionCreate.model_validate({"name": "DUT-A", "serial": {"port": "COM7", "baudrate": 460800}})
    with pytest.raises(ServiceError, match="先断开"):
        service.update_connection(connection_id, request)
    service.disconnect(connection_id)
    updated = service.update_connection(connection_id, request)
    assert updated["serial"]["port"] == "COM7"
    assert next(item for item in service.repository.connections() if item["id"] == connection_id)["serial"]["baudrate"] == 460800
    with pytest.raises(ServiceError, match="名称已存在"):
        service.update_connection(connection_id, ConnectionCreate(name="DUT-B"))
    # 模拟模式即便保存了真实格式串口参数，也只使用内存驱动。
    service.connect(connection_id)
    assert service.read_register(connection_id, 0x1000)["value"] == 0x101


def test_early_sim_profiles_migrated_without_losing_id_name_or_logs(tmp_path):
    path = tmp_path / "legacy-prototype.db"
    repository = Repository(path)
    for connection_id, name, kind in [("old-dut", "原有设备", "soc"), ("old-instrument", "原有仪表", "instrument")]:
        repository.save_connection({"id": connection_id, "name": name, "kind": kind, "transport": "simulation", "endpoint": "SIM://SOC"})
    repository.append_log({"timestamp": "2026-10-29", "level": "INFO", "source": "test", "message": "保留原有日志", "connection_id": None, "task_id": None})
    studio = StudioService(path)
    try:
        profiles = studio.snapshot()["connections"]
        assert [item["id"] for item in profiles] == ["old-dut", "old-instrument"]
        assert [item["name"] for item in profiles] == ["原有设备", "原有仪表"]
        assert [item["transport"] for item in profiles] == ["serial", "tcpip"]
        assert profiles[0]["serial"]["port"] == ""
        assert profiles[1]["instrument"]["ip_address"] is None
        assert all(item["mode"] == "simulation" for item in profiles)
        assert any(item["message"] == "保留原有日志" for item in studio.snapshot()["logs"])
        assert studio.repository.connections()[0]["transport"] == "serial"
    finally:
        studio.close()
