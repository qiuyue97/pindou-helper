# 拼豆助手 · pindou-helper

面向拼豆（Perler / Mard 豆）创作的自托管色号匹配与库存管理系统。

以 CIELAB 色空间与 CIEDE2000 色差公式为基础，对采样颜色在 291 色色卡中进行
感知意义上的最近邻判定，并给出该判定的置信度；同时提供多用户的库存记录、
批量出入库与可回溯的操作历史。

单容器部署，数据持久化于本地 SQLite。

---

## 背景

拼豆创作中一个基础且高频的任务是**色号归属判定**：给定一个目标颜色——照片中的某个像素、
屏幕上的一处取样，或一个手工输入的色值——需要在有限的色卡集合中确定与之最接近的一项。

这一任务的常见实现是将颜色视为 sRGB 空间中的三维向量并计算欧氏距离。该方法存在两处
系统性偏差：

**其一，sRGB 并非感知均匀空间。** 它是面向显示设备的编码空间，相同的数值距离在不同
色域区域所对应的可辨差异相差数倍。因此按 sRGB 距离排序得到的「最接近」，与人眼判断
经常不一致，且偏差在高彩度区域尤为显著。

**其二，距离的绝对值不足以支撑判断。** 色卡在色空间中的分布是不均匀的：某些区域样本
密集，某些区域稀疏。同一个色差值，落在稀疏区域意味着一次可靠的匹配，落在密集簇中则
接近于任意选择。仅报告最近邻而不刻画其可分辨性，会掩盖后一种情形。

本项目针对上述两点采取的处理是：颜色统一转换至 **CIELAB** 空间，色差采用 **CIEDE2000**
计算；并为每个色号预先计算其**局部间距**（到其最近若干邻居的平均色差），以此对原始
色差作归一化，从而将「距离多近」与「该判定是否可靠」区分开来（见
[颜色匹配是怎么算的](#颜色匹配是怎么算的)）。

在此基础之上，系统还实现了以不可变事件序列为底层模型的库存管理，使任意一次历史操作
都可被撤销或修改，且后续状态自动重算。

## 功能

### 取色与配色匹配

三种取色方式：

- **屏幕吸色** —— 桌面 Chrome/Edge 的 EyeDropper API，可吸取屏幕上任意位置
- **图片取色** —— 上传或拍照，鼠标滑过实时预览（带 8× 放大镜），左键点击锁定
- **手动输入** —— 十六进制或 R/G/B，双向同步

匹配结果只给**一个结论**：最接近的色号 + 一句白话把握度，例如「非常接近，肉眼难辨」
或「差异明显，色卡里可能没有很匹配的颜色」。只有当第一、二名难以区分时才并列显示备选。
展开还能看前 5 名的 ΔE₀₀ 和库存状态。

可切换候选集：**221**（A–M 常规系列）或 **291**（含 P/Q/R/T/Y/ZG 特殊色），
以及是否纳入自己新增的色号。

### 颜色空间可视化

把采样点和它**真实的邻居**画出来（不是全部 291 个点——那样毫无信息量）：

- **a\*–b\* 平面**：色相是角度、彩度是半径，可滚轮缩放、拖拽平移、悬停显示色号
- **L\* 明度条**：单独一维
- **3D CIELAB**：带 L\*/a\*/b\* 坐标轴，可拖拽旋转、缩放，标签始终留在视野内

画点集合 = 按 ΔE₀₀ 最近的 5 个 ∪ 沿 L\*/a\*/b\* 各维度最近的 3 个，去重后上限 12。
**缩放以采样点为锚点**，所以再偏的颜色也不会被推出视野。

### 库存管理

- 九列网格，按色号系列分列；色号直接标注在色块内以压缩纵向空间
- 全部色号默认显示，没有记录的按 0 显示
- 三档配色：**负数标红**、**低于阈值标橙**、正常
- **批量补货 / 扣减**：粘贴多行 `色号,数量`，中文逗号和空格都认，边输入边预览，全部有效才应用
- `ALL,100` 通配符，范围跟随页面选择的 221/291
- 需求核对、缺货清单（可一键复制）

### 操作历史 · 撤销与编辑任意一步

每次库存变动都是一条**不可变事件**，当前库存 = 重放所有未作废事件的结果。所以：

- 可以撤销或**编辑历史上的任意一步**（不只是上一步），之后的记录自动重算
- 破坏性操作前先给**影响预览**：哪些色号会变、变成多少
- `Ctrl/⌘+Z` 撤销最新一步

### 我的色卡

每个账号可以修改任意标准色号的 HEX、新增自己的色号。改动只作用于自己，
并立刻影响匹配结果。被库存或历史引用的自定义色号不允许删除。

---

## 颜色匹配是怎么算的

色卡基准数据为厂商公布的 291 色对照表，以 `shared/mard-291.txt`（291 行 `色号 HEX`）
作为单一数据源，在构建期生成 `catalog.json`，并对总数及各系列数量做断言
（A26 B32 C29 D26 E24 F25 G21 H23 M15 P23 Q5 R28 T1 Y5 ZG8），数据不一致时构建失败。

转换链路：`hex → sRGB → 线性化 → XYZ(D65) → CIELAB`。

主指标是 **CIEDE2000**（完整公式，含色相旋转项和灰轴修正），
测试对照 **Sharma 等 (2005) 的 34 对参考数据**逐对验证，误差 < 1e-4。

但只看距离绝对值是不够的。同样 ΔE = 4，在色卡稀疏的区域是有把握的命中，
在密集簇里就是抛硬币。所以每个色号还预计算了**局部间距**（到它最近 3 个邻居的平均 ΔE₀₀），
判断时用：

```
relative = ΔE₀₀(采样, 候选) / (0.5 × 该候选的局部间距)
```

`< 1` 表示采样落在这个色号自己的「地盘」内，`≈ 1` 在边界，`> 1` 含糊。
再加上第一、二名的间距（margin），共同决定那句白话结论。

> 一个反直觉的例子：CIEDE2000 在高彩度区压缩得很厉害。纯绿 `#00FF00` 和色卡里的
> B2 `#63F347`，RGB 式欧氏距离是 23.6，但感知 ΔE₀₀ 只有 4.25；而品红 `#FF00FF`
> 离最近的 E9 有 ΔE₀₀ 11.64。凭直觉断言「这个颜色肯定没有近似色」是会错的。

---

## 部署

### Docker（推荐）

```bash
git clone <your-repo-url> pindou-helper
cd pindou-helper

# 生成一个随机密钥（会话用它签名，改动会让所有人重新登录）
echo "PINDOU_JWT_SECRET=$(openssl rand -hex 32)" > .env

docker compose up -d --build
```

容器监听 8000，前面挂你的反向代理终止 TLS，然后访问
`https://<你的域名>` 注册第一个账号即可。库存从空开始。

镜像默认使用国内源（DaoCloud 镜像库、npmmirror、清华 PyPI/Debian），
NAS 上不必额外配置。墙外构建时用 `--build-arg` 覆盖回官方源，
四个参数都写在 `.env.example` 里。

镜像会自己校验：构建时断言色卡是 291 色，且能从**安装后的包**里读到
（故意换到 `/` 目录 import），打包退化时构建直接失败，不会产出坏镜像。
留意输出里的 `catalogue ok: 291`。

**反向代理**：容器以 `--proxy-headers` 启动，会认 `X-Forwarded-Proto` /
`X-Forwarded-For`。反代记得把这两个头传下来。Nginx 示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**配置项**（都在 `.env`，模板见 `.env.example`）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PINDOU_JWT_SECRET` | 必填 | 会话签名密钥，≥32 字符 |
| `PINDOU_COOKIE_SECURE` | `1` | 默认按 https 部署。仅在临时用 `http://` 直连调试时改成 `0`，否则浏览器会拒存 cookie，表现为每次请求都掉登录 |
| `TZ` | `Asia/Shanghai` | 只影响服务端日志时间；界面时间用浏览器本地时区 |

**数据与备份**：SQLite 在名为 `pindou-data` 的卷里（容器内 `/data/pindou.db`）。
备份这一个文件就等于备份了全部数据。

容器运行中直接 `cat` 数据库文件可能拷到写了一半的状态。用 SQLite 自带的在线备份：

```bash
docker compose exec -T pindou python -c "
import sqlite3
src = sqlite3.connect('/data/pindou.db')
dst = sqlite3.connect('/data/backup.db')
src.backup(dst); dst.close(); src.close()"

docker compose cp pindou:/data/backup.db ./pindou-backup.db
docker compose exec -T pindou rm /data/backup.db
```

**升级**：

```bash
git pull && docker compose up -d --build
```

数据库在卷里，不会随镜像重建丢失。

### 本地开发

需要 Node ≥ 20 和 Python 3.12。两个终端：

```bash
# 1) API，:8000
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"    # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m uvicorn "app.main:create_app" --factory --reload --port 8000

# 2) 前端，:5173（/api 代理到 :8000）
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173

```bash
# 测试
cd frontend && npm test && npm run typecheck
cd backend  && .venv/Scripts/python -m pytest -q && .venv/Scripts/python -m ruff check app tests
```

重新生成色卡（改过 `shared/mard-291.txt` 之后）：

```bash
cd frontend && npm run gen:catalog
```

---

## 技术栈与结构

后端 FastAPI + SQLAlchemy 2 + SQLite，argon2 密码哈希，JWT 存 httpOnly cookie。
前端 React + TypeScript + Vite + TanStack Query，图表全部是手写 `<canvas>`，
**没有引入任何图表库**。

```
backend/app/
  replay.py          事件重放引擎（纯函数，撤销/编辑任意一步的基础）
  catalog.py         291 色基准表 + 每用户的覆盖与自定义
  text_parse.py      "色号,数量" 容错解析（中文逗号、空格、ALL 通配符）
  routers/           auth · inventory · operations · colors
frontend/src/
  color/             颜色引擎：CIELAB、CIEDE2000、匹配排序、画点选取（纯函数，无 DOM）
  lib/               行解析（与后端保持一致）、绘图几何、取色几何
  components/        取色器、匹配面板、颜色空间图、库存表、各类对话框
shared/mard-291.txt  色卡数据源
```

284 个自动化测试（前端 vitest 215 + 后端 pytest 69）。
颜色引擎和几何计算都是纯函数并单独测试；`jsdom` 没有 canvas，
所以图形组件只测 DOM 和几何，不做像素断言。

**前后端的行解析器必须保持一致** —— 前端负责实时预览、后端是权威判定。
两边有同一组输入的交叉校验，改动时请一并更新。

---

## 已知限制

- **屏幕吸色只有桌面 Chrome/Edge 有**，Safari 和移动端浏览器没有这个 API，
  界面上会自动隐藏该入口。移动端请用图片取色。
- **网页无法最小化浏览器窗口**。吸取被浏览器挡住的内容时，需要手动把窗口缩小并排放。
- 移动端只针对 iOS Safari 做过适配。
- 没有密码找回，也没有登录失败限流。这是给自己和家人用的自托管工具，
  不建议直接暴露到公网。

## 许可

MIT，见 [LICENSE](LICENSE)。
