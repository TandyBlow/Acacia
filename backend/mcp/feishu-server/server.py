"""Feishu MCP Server — read Feishu docs via Model Context Protocol."""

import os
import asyncio
import time
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

APP_ID = os.environ["FEISHU_APP_ID"]
APP_SECRET = os.environ["FEISHU_APP_SECRET"]
BASE = "https://open.feishu.cn/open-apis"

BLOCK_TYPE_MAP = {
    1: "page",
    2: "text",
    3: "heading1",
    4: "heading2",
    5: "heading3",
    6: "heading4",
    7: "heading5",
    8: "heading6",
    9: "heading7",
    10: "heading8",
    11: "heading9",
    12: "bullet",
    13: "ordered",
    14: "code",
    15: "quote",
    16: "equation",
    17: "todo",
    18: "bitable",
    19: "callout",
    20: "chat_card",
    21: "diagram",
    22: "divider",
    23: "file",
    24: "grid",
    25: "grid_column",
    26: "iframe",
    27: "image",
    28: "isv",
    29: "mind_note",
    30: "sheet",
    31: "table",
    32: "table_cell",
}

_server = Server("feishu-server")

_token_cache: dict[str, tuple[str, float]] = {}


async def get_token(client: httpx.AsyncClient) -> str:
    now = time.time()
    cached = _token_cache.get("tenant_token")
    if cached and cached[1] > now + 60:
        return cached[0]

    resp = await client.post(
        f"{BASE}/auth/v3/tenant_access_token/internal",
        json={"app_id": APP_ID, "app_secret": APP_SECRET},
    )
    resp.raise_for_status()
    data = resp.json()
    token = data["tenant_access_token"]
    expires = now + data.get("expire", 7200)
    _token_cache["tenant_token"] = (token, expires)
    return token


async def get_doc_content(client: httpx.AsyncClient, doc_id: str) -> str:
    token = await get_token(client)
    resp = await client.get(
        f"{BASE}/docx/v1/documents/{doc_id}/blocks",
        headers={"Authorization": f"Bearer {token}"},
    )
    resp.raise_for_status()
    data = resp.json()
    blocks = data.get("data", {}).get("items", [])

    lines: list[str] = []
    for block in blocks:
        key = BLOCK_TYPE_MAP.get(block.get("block_type", 0))
        if not key:
            continue
        elements = block.get(key, {}).get("elements", [])
        for elem in elements:
            run = elem.get("text_run")
            if run:
                lines.append(run.get("content", ""))

    return "\n".join(lines)


@_server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="feishu_read_doc",
            description="读取飞书文档内容。传入飞书文档的 URL 或文档 ID，返回纯文本内容。",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "飞书文档 URL，例如 https://xxx.feishu.cn/wiki/Uxe0wPonbi... 或 https://xxx.feishu.cn/docx/ABCD1234...",
                    }
                },
                "required": ["url"],
            },
        )
    ]


@_server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    async with httpx.AsyncClient(timeout=30) as client:
        if name == "feishu_read_doc":
            url: str = arguments["url"]

            if "/docx/" in url:
                doc_id = url.rstrip("/").rsplit("/", 1)[-1]
                text = await get_doc_content(client, doc_id)
            elif "/wiki/" in url:
                doc_id = url.rstrip("/").rsplit("/", 1)[-1]
                text = await get_doc_content(client, doc_id)
            else:
                return [TextContent(
                    type="text",
                    text="错误：无法从 URL 中识别文档类型，URL 需包含 /wiki/ 或 /docx/",
                )]

            return [TextContent(type="text", text=text)]

        raise ValueError(f"Unknown tool: {name}")


async def main():
    async with stdio_server() as (reader, writer):
        await _server.run(reader, writer, _server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
