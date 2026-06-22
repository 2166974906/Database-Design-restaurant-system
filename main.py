from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import uvicorn
import os

from routers import router

app = FastAPI(
    title="餐饮门店点餐系统",
    description="数据库项目实践 - 课程设计",
    version="1.0.0"
)

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册API路由
app.include_router(router, prefix="/api")


# 提供静态文件
app.mount("/css", StaticFiles(directory="frontend/css"), name="css")
app.mount("/js", StaticFiles(directory="frontend/js"), name="js")

# 提供HTML页面
@app.get("/", response_class=HTMLResponse)
async def serve_index():
    with open("frontend/index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/health")
def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="localhost", port=8000, reload=True)