from uuid import uuid4
import logging
import warnings
import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

# ── Suppress noisy ONNX/CUDA warnings from OCR dependencies ───────────
warnings.filterwarnings("ignore", message=".*CUDAExecutionProvider.*")
warnings.filterwarnings("ignore", message=".*Specified provider.*not in available.*")
for _name in ("rapidocr", "rapidocr_onnxruntime", "cnocr", "cnstd"):
    logging.getLogger(_name).setLevel(logging.ERROR)

logger = logging.getLogger(__name__)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import get_db_ctx, init_db
from middleware.logging_middleware import LoggingMiddleware
from middleware.rate_limit_middleware import RateLimitMiddleware

from routers.auth_routes import router as auth_router
from routers.node_routes import router as node_router
from routers.node_mutation_routes import router as node_mutation_router
from routers.tree_routes import router as tree_router
from routers.upload_routes import router as upload_router
from routers.upload_status_routes import router as upload_status_router
from routers.ocr_routes import router as ocr_router
from routers.extract_routes import router as extract_router
from routers.chat_routes import router as chat_router
from routers.context_routes import router as context_router
from routers.quiz_routes import router as quiz_router
from routers.review_routes import router as review_router
from routers.admin_routes import router as admin_router
from routers.upload_routes import _cleanup_stale_uploads

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Startup: init DB, seed official nodes, clean stale uploads."""
    init_db()
    _seed_default_official_nodes()
    _cleanup_stale_uploads()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(LoggingMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_WELCOME_CONTENT = """# 欢迎来到 Acacia

## 这是什么？

Acacia 是一个知识管理工具，帮助你记录、组织和巩固学到的知识。你的知识会组织成一棵树，每个知识点都是树上的一个节点。

## 基本操作

- **浏览节点**：点击导航栏中的节点名称即可查看其内容
- **添加知识点**：点击导航栏底部的"+ 新的知识点"按钮
- **编辑内容**：在内容区直接编辑 Markdown 文本
- **移动/删除**：右键点击导航栏中的节点，选择移动或删除

## 旋钮操作

- **单击旋钮**：返回主页
- **长按旋钮**：确认当前操作（添加/删除/移动节点时）

## 官方知识点

导航栏顶部金色的条目是官方知识点，它们由系统提供，内容不可编辑：

- **今日成长**：每天一道基于你的知识点生成的练习题，完成后当日隐藏，次日刷新

## 核心理念

每个人心里都有一棵树。它可能枯萎，也可能繁茂参天。

记录知识这件事本身不应该有学习成本。Acacia 只做两件事：

1. **输入**：从一个想法、一段文本中提取出属于自己的知识点
2. **输出**：通过答题巩固已有知识点，发现新的疑问
"""


def _seed_default_official_nodes():
    """Insert the default welcome node if the official_nodes table is empty."""
    with get_db_ctx() as conn:
        count = conn.execute("SELECT COUNT(*) FROM official_nodes").fetchone()[0]
        if count == 0:
            conn.execute(
                "INSERT INTO official_nodes (id, title, content, sort_order, is_published) "
                "VALUES (?, ?, ?, ?, ?)",
                (str(uuid4()), "欢迎", DEFAULT_WELCOME_CONTENT, 1, 1),
            )


@app.get("/")
def root():
    return {"status": "ok", "message": "Acacia API is running"}


@app.get("/health")
def health():
    return {"status": "healthy"}


app.include_router(auth_router)
app.include_router(node_router)
app.include_router(node_mutation_router)
app.include_router(tree_router)
app.include_router(upload_router)
app.include_router(upload_status_router)
app.include_router(ocr_router)
app.include_router(extract_router)
app.include_router(chat_router)
app.include_router(context_router)
app.include_router(quiz_router)
app.include_router(review_router)
app.include_router(admin_router)
