# -*- coding: utf-8 -*-
"""
blender_web_bridge.bridge_server
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

自研平台 ⇄ 本地 Blender 的 WebSocket 桥接服务端。

设计要点：
- 纯标准库实现（asyncio + socket），不依赖第三方 websockets 包，
  确保在 Blender 自带 Python 环境中可直接运行。
- 与 bpy 完全解耦：本模块不 import bpy。收到请求后放入 pending 队列，
  由主线程（bpy.app.timers 轮询）执行命令，再经 send_queue 回写响应，
  从而规避 Blender 的线程安全问题。
- 通信信封遵循 hook.json 的 api.envelope 规范。

作者: Doubao Work  |  协议: doubao-blender-bridge/1.0
"""
import asyncio
import base64
import hashlib
import json
import queue
import secrets
import socket
import struct
import threading
import time
import uuid

WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9876
MAX_MSG_BYTES = 16 * 1024 * 1024  # 16MB（含大图帧）


class BridgeError(Exception):
    """业务错误，携带协议错误码。"""
    def __init__(self, code, message, data=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data or {}


def _now():
    return int(time.time() * 1000)


class BridgeServer:
    """在独立线程中运行的事件循环 WebSocket 服务端。"""

    def __init__(self, host=DEFAULT_HOST, port=DEFAULT_PORT, token=None,
                 request_handler=None):
        self.host = host
        self.port = port
        self.token = token
        # 由 addon 注入的命令分发回调 handle_request(method, params) -> result
        self.request_handler = request_handler
        self.pending = queue.Queue()   # (conn_key, msg_id, method, params)
        self.send_queue = queue.Queue()  # (conn_key, kind, payload)
        self._clients = {}             # conn_key -> (reader, writer)
        self._loop = None
        self._thread = None
        self._server = None
        self._stop_event = threading.Event()
        self.started = False
        self._client_id_seq = 0

    # ---------- 生命周期 ----------
    def start(self):
        if self.started:
            return True
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop, name="blender-bridge-ws", daemon=True)
        self._thread.start()
        # 等待端口就绪
        deadline = time.time() + 5
        while time.time() < deadline:
            if self._server is not None:
                self.started = True
                return True
            time.sleep(0.05)
        return False

    def stop(self):
        self._stop_event.set()
        if self._loop and self._server:
            asyncio.run_coroutine_threadsafe(
                self._server_close(), self._loop)
        if self._thread:
            self._thread.join(timeout=3)
        self.started = False

    def is_running(self):
        return self.started and not self._stop_event.is_set()

    def client_count(self):
        return len(self._clients)

    def _run_loop(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._serve())
        self._loop.close()

    async def _serve(self):
        try:
            self._server = await asyncio.start_server(
                self._handle_client, self.host, self.port, reuse_address=True)
        except OSError as exc:
            print(f"[bridge] listen failed on {self.host}:{self.port}: {exc}")
            self._server = None
            return
        print(f"[bridge] WebSocket server listening on ws://{self.host}:{self.port}")
        # 同时消费发送队列
        asyncio.ensure_future(self._outbound_worker())
        try:
            async with self._server:
                await self._server.serve_forever()
        except asyncio.CancelledError:
            pass
        finally:
            for key, (_, w) in list(self._clients.items()):
                try:
                    w.close()
                except Exception:
                    pass
            self._clients.clear()
            self._server = None

    async def _server_close(self):
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    # ---------- 连接处理 ----------
    async def _handle_client(self, reader, writer):
        conn_key = f"c{self._client_id_seq}"
        self._client_id_seq += 1
        try:
            ok = await self._ws_handshake(reader, writer)
            if not ok:
                writer.close()
                return
            self._clients[conn_key] = (reader, writer)
            self._enqueue_ready(conn_key)
            while not self._stop_event.is_set():
                frame = await self._read_frame(reader)
                if frame is None:
                    break
                opcode, payload = frame
                if opcode == 0x8:      # close
                    await self._send_frame(writer, 0x8, b"")
                    break
                elif opcode == 0x9:    # ping
                    await self._send_frame(writer, 0xA, payload)
                    continue
                elif opcode == 0x1:    # text
                    self._dispatch_text(conn_key, payload)
                elif opcode == 0x2:    # binary: 忽略（服务端不主动接收二进制）
                    continue
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        except Exception as exc:
            print(f"[bridge] client {conn_key} error: {exc}")
        finally:
            self._clients.pop(conn_key, None)
            try:
                writer.close()
            except Exception:
                pass
            print(f"[bridge] client {conn_key} disconnected")

    async def _ws_handshake(self, reader, writer):
        lines = []
        while True:
            line = await reader.readline()
            if not line or line in (b"\r\n", b"\n"):
                break
            lines.append(line)
        headers = {}
        for ln in lines:
            text = ln.decode("latin-1").strip()
            if ":" in text:
                k, _, v = text.partition(":")
                headers[k.strip().lower()] = v.strip()
        key = headers.get("sec-websocket-key")
        if not key:
            return False
        accept = base64.b64encode(
            hashlib.sha1((key + WS_MAGIC).encode()).digest()).decode()
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        )
        writer.write(response.encode("latin-1"))
        await writer.drain()
        return True

    # ---------- 帧编解码 ----------
    async def _read_frame(self, reader):
        header = await reader.readexactly(2)
        b0, b1 = header[0], header[1]
        opcode = b0 & 0x0F
        masked = b1 & 0x80
        length = b1 & 0x7F
        if length == 126:
            length = struct.unpack("!H", await reader.readexactly(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", await reader.readexactly(8))[0]
        if length > MAX_MSG_BYTES:
            raise ConnectionError("frame too large")
        mask = await reader.readexactly(4) if masked else b"\x00\x00\x00\x00"
        payload = await reader.readexactly(length) if length else b""
        if masked:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        return (opcode, payload)

    async def _send_frame(self, writer, opcode, payload):
        header = bytearray()
        header.append(0x80 | opcode)
        n = len(payload)
        if n < 126:
            header.append(n)
        elif n < 65536:
            header.append(126)
            header += struct.pack("!H", n)
        else:
            header.append(127)
            header += struct.pack("!Q", n)
        writer.write(bytes(header) + payload)
        await writer.drain()

    # ---------- 消息处理 ----------
    def _dispatch_text(self, conn_key, payload):
        try:
            msg = json.loads(payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._enqueue_send(conn_key, "response", json.dumps({
                "v": 1, "type": "error", "id": None,
                "error": {"code": -32700, "message": "JSON 解析错误"},
                "ts": _now(),
            }))
            return
        if not isinstance(msg, dict) or msg.get("type") != "request":
            return
        # 鉴权
        method = msg.get("method")
        if self.token and method != "auth":
            auth_ok = msg.get("params", {}).get("token") == self.token
            if not auth_ok:
                self._enqueue_send(conn_key, "response", json.dumps({
                    "v": 1, "type": "error", "id": msg.get("id"),
                    "error": {"code": -32004, "message": "未授权：缺少或错误的 token"},
                    "ts": _now(),
                }))
                return
        self.pending.put((conn_key, msg.get("id"),
                          method, msg.get("params") or {}))

    def drain_pending(self, max_items=32):
        """主线程轮询取出待执行请求。"""
        items = []
        while len(items) < max_items:
            try:
                items.append(self.pending.get_nowait())
            except queue.Empty:
                break
        return items

    def _enqueue_send(self, conn_key, kind, payload):
        self.send_queue.put((conn_key, kind, payload))

    def send_response(self, conn_key, msg_id, result=None, error=None):
        body = {"v": 1, "ts": _now()}
        if error:
            body.update({"type": "error", "id": msg_id, "error": error})
        else:
            body.update({"type": "response", "id": msg_id,
                         "result": result if result is not None else {}})
        self._enqueue_send(conn_key, "response", json.dumps(body, ensure_ascii=False))

    def broadcast_event(self, event_type, data=None):
        body = json.dumps({
            "v": 1, "type": "event", "event": event_type,
            "data": data or {}, "ts": _now(),
        }, ensure_ascii=False)
        self._enqueue_send("*", "event", body)

    async def _outbound_worker(self):
        while not self._stop_event.is_set():
            try:
                conn_key, kind, payload = self.send_queue.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.01)
                continue
            if conn_key == "*":
                for key, (_, w) in list(self._clients.items()):
                    try:
                        await self._send_frame(w, 0x1, payload.encode("utf-8"))
                    except Exception:
                        self._clients.pop(key, None)
            else:
                pair = self._clients.get(conn_key)
                if pair:
                    try:
                        await self._send_frame(pair[1], 0x1, payload.encode("utf-8"))
                    except Exception:
                        self._clients.pop(conn_key, None)

    def _enqueue_ready(self, conn_key):
        """连接握手：把 get_info 作为一条 id='ready' 的请求放入 pending 队列，
        由主线程执行并回发，保证握手数据也走主线程（线程安全）。"""
        self.pending.put((conn_key, "ready", "get_info", {}))
