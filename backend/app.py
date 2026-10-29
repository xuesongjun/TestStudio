"""仅绑定本机的 API 与事件通道，桌面和浏览器共用同一内核。"""

import asyncio
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .models import ConnectionCreate, RegisterDelete, RegisterImport, RegisterWrite, ScanRequest
from .register_import import MAX_FILE_SIZE, RegisterFileError, excel_template, inspect_excel, parse_register_file
from .service import ServiceError, StudioService
from .serial_discovery import SerialDiscoveryError, discover_serial_ports

ROOT = Path(__file__).resolve().parent.parent


def create_app(database: Path | None = None, token: str | None = None, allowed_origins: set[str] | None = None):
    service = StudioService(database or Path(os.environ.get("TESTSTUDIO_DATA_DIR", ROOT / "data")) / "studio.db")
    session_token = token or secrets.token_urlsafe(32)
    origins = set(allowed_origins or ())

    @asynccontextmanager
    async def lifespan(_app):
        if callback := getattr(_app.state, "on_ready", None):
            callback()
        try:
            yield
        finally:
            await asyncio.to_thread(service.close)

    app = FastAPI(title="TestStudio 内核", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.studio = service
    app.state.session_token = session_token

    def trusted_origin(origin: str | None, host: str) -> bool:
        return origin is None or origin == f"http://{host}" or origin in origins

    @app.middleware("http")
    async def local_session(request: Request, call_next):
        host = request.url.hostname
        if host not in {"127.0.0.1", "localhost", "testserver"}:
            return JSONResponse({"detail": "仅接受本机访问"}, status_code=403)
        origin = request.headers.get("origin")
        if not trusted_origin(origin, request.headers.get("host", "")):
            return JSONResponse({"detail": "不允许的请求来源"}, status_code=403)
        if request.url.path.startswith("/api/") and request.url.path not in {"/api/bootstrap", "/api/health"}:
            supplied = request.cookies.get("teststudio_session") or request.headers.get("x-teststudio-token", "")
            if not secrets.compare_digest(supplied, session_token):
                return JSONResponse({"detail": "本机会话已失效，请重新连接内核"}, status_code=401)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ServiceError)
    async def service_error(_request, exc: ServiceError):
        return JSONResponse({"detail": exc.message}, status_code=exc.status)

    @app.get("/api/health")
    def health():
        return {"status": "ready", "mode": "simulation", "version": "0.1.0"}

    @app.post("/api/bootstrap")
    def bootstrap():
        response = JSONResponse(service.snapshot())
        response.set_cookie("teststudio_session", session_token, httponly=True, samesite="strict")
        return response

    @app.get("/api/state")
    def state():
        return service.snapshot()

    @app.get("/api/registers/definitions")
    def definitions():
        return service.register_catalog()

    @app.delete("/api/logs")
    def clear_logs():
        return service.clear_logs()

    async def register_file_body(request: Request) -> bytes:
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_FILE_SIZE:
                raise HTTPException(413, "寄存器文件超过 8 MB")
        return bytes(content)

    @app.post("/api/registers/sheets")
    async def register_sheets(request: Request):
        content = await register_file_body(request)
        try:
            return await asyncio.to_thread(inspect_excel, content)
        except RegisterFileError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/api/registers/preview")
    async def preview_registers(request: Request, filename: str, sheets: list[str] | None = Query(default=None)):
        content = await register_file_body(request)
        try:
            preview = await asyncio.to_thread(parse_register_file, filename, content, sheets)
            preview["expected_revision"] = service.register_catalog()["revision"]
            return preview
        except RegisterFileError as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/api/registers/import")
    def import_registers(request: RegisterImport):
        return service.import_registers(request)

    @app.post("/api/registers/delete")
    def delete_registers(request: RegisterDelete):
        return service.delete_registers(request)

    @app.get("/api/registers/template")
    def register_template():
        return Response(excel_template(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": 'attachment; filename="teststudio-register-template.xlsx"'})

    @app.get("/api/serial/ports")
    def serial_ports():
        try:
            return {"ports": discover_serial_ports()}
        except SerialDiscoveryError as exc:
            raise HTTPException(503, str(exc)) from exc

    @app.post("/api/connections", status_code=201)
    def create_connection(request: ConnectionCreate):
        return service.create_connection(request)

    @app.post("/api/connections/{connection_id}/connect")
    def connect(connection_id: str):
        return service.connect(connection_id)

    @app.post("/api/connections/{connection_id}/disconnect")
    def disconnect(connection_id: str):
        service.disconnect(connection_id)
        return {"ok": True}

    @app.delete("/api/connections/{connection_id}")
    def delete(connection_id: str):
        service.delete_connection(connection_id)
        return {"ok": True}

    @app.put("/api/connections/{connection_id}")
    def update(connection_id: str, request: ConnectionCreate):
        return service.update_connection(connection_id, request)

    @app.get("/api/connections/{connection_id}/registers")
    def read_all(connection_id: str):
        return service.read_registers(connection_id)

    @app.get("/api/connections/{connection_id}/registers/{address}")
    def read(connection_id: str, address: str):
        try:
            numeric = int(address, 16)
        except ValueError:
            raise HTTPException(400, "地址必须是十六进制")
        return service.read_register(connection_id, numeric)

    @app.post("/api/connections/{connection_id}/registers/write")
    def write(connection_id: str, request: RegisterWrite):
        return service.write_register(connection_id, request)

    @app.post("/api/tasks/scan", status_code=202)
    def start_scan(request: ScanRequest):
        return service.start_scan(request.connection_id, request.passes)

    @app.post("/api/tasks/cancel")
    def cancel_task():
        service.cancel_task()
        return {"ok": True}

    @app.websocket("/api/events")
    async def events(socket: WebSocket):
        if (not trusted_origin(socket.headers.get("origin"), socket.headers.get("host", ""))
                or socket.url.hostname not in {"127.0.0.1", "localhost", "testserver"}
                or not secrets.compare_digest(socket.cookies.get("teststudio_session", ""), session_token)):
            await socket.close(code=1008)
            return
        await socket.accept()
        try:
            previous = -1
            while True:
                snapshot = service.snapshot()
                if snapshot["revision"] != previous:
                    await socket.send_json(snapshot)
                    previous = snapshot["revision"]
                # 同时检测客户端关闭；没有消息时只等待有限时间。
                try:
                    message = await asyncio.wait_for(socket.receive(), timeout=0.2)
                    if message["type"] == "websocket.disconnect":
                        break
                except TimeoutError:
                    pass
        except (WebSocketDisconnect, RuntimeError):
            pass

    frontend = ROOT / "dist" / "frontend"
    if frontend.is_dir():
        app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
    return app
