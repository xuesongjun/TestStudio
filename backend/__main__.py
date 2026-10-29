"""启动内核并通过标准输出报告实际端口；标准输入支持安全退出。"""

import argparse
import json
import os
import socket
import sys
from threading import Thread

import uvicorn

from .app import create_app


def main():
    parser = argparse.ArgumentParser(description="TestStudio 模拟内核")
    parser.add_argument("--port", type=int, default=8765, help="0 表示分配空闲端口")
    args = parser.parse_args()
    server_socket = socket.socket()
    server_socket.bind(("127.0.0.1", args.port))
    server_socket.listen(128)
    port = server_socket.getsockname()[1]
    token = os.environ.get("TESTSTUDIO_TOKEN")
    origins = {os.environ.get("TESTSTUDIO_DEV_ORIGIN", "http://127.0.0.1:5173")}
    app = create_app(token=token, allowed_origins=origins)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))

    def ready():
        print(json.dumps({"event": "ready", "port": port}), flush=True)

    app.state.on_ready = ready

    def listen_for_shutdown():
        for line in sys.stdin:
            if line.strip() == "shutdown":
                break
        # 父进程异常退出导致管道关闭时，同样关闭内核，避免残留连接。
        server.should_exit = True

    Thread(target=listen_for_shutdown, daemon=True).start()
    try:
        server.run(sockets=[server_socket])
    finally:
        server_socket.close()


if __name__ == "__main__":
    main()
