#!/usr/bin/env python
"""开通 / 取消某个账号的 VIP，直接操作数据库。

VIP 没有自助入口，也没有对外接口——只有能碰到数据库的人才能改，这是刻意的。

用法（在 backend/ 目录下，或容器里任意目录）：

    python scripts/set_vip.py list                # 列出所有账号及其 VIP 状态
    python scripts/set_vip.py grant wlh           # 开通
    python scripts/set_vip.py revoke wlh          # 取消
    python scripts/set_vip.py grant wlh --db sqlite:////data/pindou.db

数据库地址默认取环境变量 PINDOU_DB_URL（和应用本身一致），所以在容器里不用带
任何参数：

    docker exec pindou-helper python -m scripts.set_vip grant wlh

改动立刻生效，用户不需要重新登录——会话令牌里只存用户 id，权限每次请求都重新
读库。
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# 允许直接 `python scripts/set_vip.py` 运行：脚本自身的目录会进 sys.path，
# 但 app 包在它的上一层。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.db import get_engine, get_sessionmaker, init_db
from app.models import User


def _mark(is_vip: bool) -> str:
    return "VIP " if is_vip else "    "


def cmd_list() -> int:
    with get_sessionmaker()() as session:
        users = session.scalars(select(User).order_by(User.username)).all()
    if not users:
        print("（数据库里还没有账号）")
        return 0
    print(f"{'':4}{'用户名':<24}{'注册时间'}")
    for u in users:
        print(f"{_mark(u.is_vip)}{u.username:<24}{u.created_at:%Y-%m-%d %H:%M}")
    vips = sum(1 for u in users if u.is_vip)
    print(f"\n共 {len(users)} 个账号，其中 VIP {vips} 个")
    return 0


def cmd_set(username: str, value: bool) -> int:
    with get_sessionmaker()() as session:
        user = session.scalar(select(User).where(User.username == username))
        if user is None:
            print(f"× 没有名为 {username!r} 的账号", file=sys.stderr)
            # 用户名写错是最常见的失败，顺手把有哪些账号列出来
            names = session.scalars(select(User.username).order_by(User.username)).all()
            if names:
                print("  现有账号：" + "、".join(names), file=sys.stderr)
            return 1
        if user.is_vip == value:
            print(f"= {username} 已经是{'VIP' if value else '普通账号'}，无需改动")
            return 0
        user.is_vip = value
        session.commit()
    print(f"✓ {username} → {'VIP' if value else '普通账号'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="开通 / 取消账号的 VIP（直接改数据库）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--db",
        metavar="URL",
        help="数据库地址，默认取 PINDOU_DB_URL；容器里是 sqlite:////data/pindou.db",
    )
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("list", help="列出所有账号及其 VIP 状态")
    for name, help_text in (("grant", "开通 VIP"), ("revoke", "取消 VIP")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("username")

    args = parser.parse_args(argv)

    if args.db:
        # 必须在 get_engine() 第一次被调用前设置：engine 和 settings 都带 lru_cache。
        os.environ["PINDOU_DB_URL"] = args.db

    # 库可能建于 is_vip 这一列出现之前，先把增量迁移跑掉，否则下面会报 no such column。
    init_db()
    print(f"数据库：{get_engine().url}\n")

    if args.action == "list":
        return cmd_list()
    return cmd_set(args.username, args.action == "grant")


if __name__ == "__main__":
    raise SystemExit(main())
