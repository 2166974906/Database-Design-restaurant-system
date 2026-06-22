from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from datetime import datetime, timedelta
import random
from typing import List, Optional

from database import get_db, SessionLocal
from models import Table, Dish, Order, OrderDetail, Member, Settlement, User, OrderLog, OrderSplitRelation
from schemas import (
    OrderCreate, SettlementReq, AddDishReq, TableStatusReq,
    ChangeDishReq, SplitOrderReq, MergeOrderReq, UserLogin
)

router = APIRouter()


# 工具函数

def generate_order_no() -> str:
    now = datetime.now()
    random_num = random.randint(10, 99)
    return now.strftime("%Y%m%d%H%M%S") + str(random_num)


def calc_discount(phone: str, db: Session) -> float:
    if not phone:
        return 1.0
    member = db.query(Member).filter(Member.phone == phone).first()
    if not member:
        return 1.0
    if member.discount_level == 1:
        return 0.95
    elif member.discount_level == 2:
        return 0.90
    elif member.discount_level == 3:
        return 0.85
    return 1.0


def recalc_order_amount(db: Session, order_id: int, member_phone: str):
    total = db.query(func.sum(OrderDetail.subtotal)).filter(
        OrderDetail.order_id == order_id
    ).scalar() or 0
    total = float(total)
    discount_rate = calc_discount(member_phone, db)
    actual = round(total * discount_rate, 2)
    discount = round(total - actual, 2)
    return total, discount, actual


def verify_role(token: str, allowed_roles: List[str]) -> dict:
    db = SessionLocal()
    user = db.query(User).filter(User.username == token, User.status == '在职').first()
    db.close()
    if not user:
        raise HTTPException(status_code=401, detail="未登录或账号不存在")
    if user.role not in allowed_roles and '店长' not in allowed_roles:
        raise HTTPException(status_code=403, detail="权限不足")
    return {"user_id": user.user_id, "username": user.username, "role": user.role}


# 1. 桌台管理模块（服务员/店长）

@router.get("/tables")
def get_tables(token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['服务员', '店长'])
    tables = db.query(Table).all()
    return [
        {"table_id": t.table_id, "table_no": t.table_no,
         "seats": t.seats, "status": t.status}
        for t in tables
    ]


@router.put("/tables/{table_id}/status")
def update_table_status(table_id: int, req: TableStatusReq, token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['服务员', '店长'])
    table = db.query(Table).filter(Table.table_id == table_id).first()
    if not table:
        raise HTTPException(404, "桌台不存在")
    table.status = req.status
    db.commit()
    return {"message": "更新成功"}


# 2. 菜品管理模块（所有人可查看，不加权限）

@router.get("/dishes")
def get_dishes(category: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Dish).filter(Dish.status == '在售')
    if category:
        query = query.filter(Dish.category == category)
    dishes = query.order_by(Dish.sort_order).all()
    return [
        {"dish_id": d.dish_id, "name": d.name, "category": d.category,
         "price": float(d.price), "status": d.status}
        for d in dishes
    ]


@router.get("/dishes/{dish_id}")
def get_dish(dish_id: int, db: Session = Depends(get_db)):
    dish = db.query(Dish).filter(Dish.dish_id == dish_id).first()
    if not dish:
        raise HTTPException(404, "菜品不存在")
    return {"dish_id": dish.dish_id, "name": dish.name,
            "category": dish.category, "price": float(dish.price), "status": dish.status}


# 3. 点餐订单模块（服务员/店长）

@router.post("/orders/create")
def create_order(order_data: OrderCreate, token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['服务员', '店长'])

    table = db.query(Table).filter(Table.table_id == order_data.table_id).first()
    if not table or table.status != '空闲':
        raise HTTPException(400, "桌台不可用")

    order_no = generate_order_no()
    new_order = Order(
        table_id=order_data.table_id,
        order_no=order_no,
        member_phone=order_data.member_phone,
        order_status='进行中'
    )
    db.add(new_order)
    db.flush()

    total = 0
    for item in order_data.items:
        dish = db.query(Dish).filter(Dish.dish_id == item.dish_id).first()
        if not dish or dish.status == '停售':
            db.rollback()
            raise HTTPException(400, f"菜品 {item.dish_id} 不可用")

        subtotal = float(dish.price) * item.quantity
        total += subtotal

        detail = OrderDetail(
            order_id=new_order.order_id,
            dish_id=item.dish_id,
            quantity=item.quantity,
            unit_price=float(dish.price),
            subtotal=subtotal,
            remark=item.remark
        )
        db.add(detail)

    discount_rate = calc_discount(order_data.member_phone, db)
    actual = round(total * discount_rate, 2)
    discount = round(total - actual, 2)
    new_order.total_amount = total
    new_order.discount_amount = discount
    new_order.actual_amount = actual

    table.status = '用餐'
    db.commit()

    return {
        "order_id": new_order.order_id,
        "order_no": order_no,
        "total_amount": total,
        "actual_amount": actual,
        "table_no": table.table_no
    }


@router.get("/orders/current/{table_id}")
def get_current_order(table_id: int, db: Session = Depends(get_db)):
    order = db.query(Order).filter(
        Order.table_id == table_id,
        Order.order_status == '进行中'
    ).first()

    if not order:
        return {"has_order": False}

    details = db.query(OrderDetail).filter(OrderDetail.order_id == order.order_id).all()
    items = []
    for d in details:
        dish = db.query(Dish).filter(Dish.dish_id == d.dish_id).first()
        items.append({
            "detail_id": d.detail_id,
            "dish_name": dish.name if dish else "未知",
            "quantity": d.quantity,
            "unit_price": float(d.unit_price),
            "subtotal": float(d.subtotal),
            "remark": d.remark,
            "status": d.status
        })

    return {
        "has_order": True,
        "order_id": order.order_id,
        "order_no": order.order_no,
        "total_amount": float(order.total_amount),
        "actual_amount": float(order.actual_amount),
        "order_time": order.order_time,
        "items": items
    }


@router.get("/orders/{order_id}")
def get_order_detail(order_id: int, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(404, "订单不存在")
    details = db.query(OrderDetail).filter(OrderDetail.order_id == order_id).all()
    items = []
    for d in details:
        dish = db.query(Dish).filter(Dish.dish_id == d.dish_id).first()
        items.append({
            "detail_id": d.detail_id,
            "dish_name": dish.name if dish else "未知",
            "quantity": d.quantity,
            "unit_price": float(d.unit_price),
            "subtotal": float(d.subtotal),
            "remark": d.remark,
            "status": d.status
        })
    return {
        "order_id": order.order_id,
        "order_no": order.order_no,
        "total_amount": float(order.total_amount),
        "actual_amount": float(order.actual_amount),
        "order_status": order.order_status,
        "order_time": order.order_time,
        "items": items
    }


@router.post("/orders/{order_id}/add-dish")
def add_dish(order_id: int, req: AddDishReq, token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['服务员', '店长'])

    order = db.query(Order).filter(
        Order.order_id == order_id,
        Order.order_status == '进行中'
    ).first()
    if not order:
        raise HTTPException(404, "订单不存在或已结算")

    dish = db.query(Dish).filter(Dish.dish_id == req.dish_id).first()
    if not dish or dish.status == '停售':
        raise HTTPException(400, "菜品不可用")

    subtotal = float(dish.price) * req.quantity
    detail = OrderDetail(
        order_id=order_id,
        dish_id=req.dish_id,
        quantity=req.quantity,
        unit_price=float(dish.price),
        subtotal=subtotal,
        remark=req.remark
    )
    db.add(detail)

    total, discount, actual = recalc_order_amount(db, order_id, order.member_phone)
    order.total_amount = total
    order.discount_amount = discount
    order.actual_amount = actual
    db.commit()

    return {"message": "加菜成功", "detail_id": detail.detail_id, "actual_amount": actual}


@router.delete("/orders/{order_id}/remove-dish/{detail_id}")
def remove_dish(order_id: int, detail_id: int, token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['服务员', '店长'])

    detail = db.query(OrderDetail).filter(
        OrderDetail.detail_id == detail_id,
        OrderDetail.order_id == order_id
    ).first()
    if not detail:
        raise HTTPException(404, "菜品明细不存在")

    db.delete(detail)

    order = db.query(Order).filter(Order.order_id == order_id).first()
    total, discount, actual = recalc_order_amount(db, order_id, order.member_phone)
    order.total_amount = total
    order.discount_amount = discount
    order.actual_amount = actual
    db.commit()

    return {"message": "退菜成功", "actual_amount": actual}


# 4. 换菜功能（服务员/店长）

@router.post("/orders/{order_id}/change-dish")
def change_dish(
    order_id: int,
    req: ChangeDishReq,
    token: str = Header(...),
    db: Session = Depends(get_db)
):
    verify_role(token, ['服务员', '店长'])

    order = db.query(Order).filter(
        Order.order_id == order_id,
        Order.order_status == '进行中'
    ).first()
    if not order:
        raise HTTPException(404, "订单不存在或已结算")

    old_detail = db.query(OrderDetail).filter(
        OrderDetail.detail_id == req.old_detail_id,
        OrderDetail.order_id == order_id
    ).first()
    if not old_detail:
        raise HTTPException(404, "原菜品明细不存在")

    new_dish = db.query(Dish).filter(Dish.dish_id == req.new_dish_id).first()
    if not new_dish or new_dish.status == '停售':
        raise HTTPException(400, "新菜品不可用")

    old_dish = db.query(Dish).filter(Dish.dish_id == old_detail.dish_id).first()
    log_entry = OrderLog(
        order_id=order_id,
        action='CHANGE_DISH',
        old_data=f"菜品:{old_dish.name if old_dish else '未知'},数量:{old_detail.quantity}",
        new_data=f"菜品:{new_dish.name},数量:{req.quantity}",
        operator=token,
        operator_role='服务员'
    )
    db.add(log_entry)

    db.delete(old_detail)

    subtotal = float(new_dish.price) * req.quantity
    new_detail = OrderDetail(
        order_id=order_id,
        dish_id=req.new_dish_id,
        quantity=req.quantity,
        unit_price=float(new_dish.price),
        subtotal=subtotal,
        remark=req.remark
    )
    db.add(new_detail)

    total, discount, actual = recalc_order_amount(db, order_id, order.member_phone)
    order.total_amount = total
    order.discount_amount = discount
    order.actual_amount = actual
    db.commit()

    return {
        "message": "换菜成功",
        "old_dish": old_dish.name if old_dish else "未知",
        "new_dish": new_dish.name,
        "actual_amount": actual
    }


# 5. 拆单功能（收银员/店长）

@router.post("/orders/{order_id}/split")
def split_order(
    order_id: int,
    req: SplitOrderReq,
    token: str = Header(...),
    db: Session = Depends(get_db)
):
    verify_role(token, ['收银员', '店长'])

    original_order = db.query(Order).filter(
        Order.order_id == order_id,
        Order.order_status == '进行中'
    ).first()
    if not original_order:
        raise HTTPException(404, "订单不存在或已结算")

    details = db.query(OrderDetail).filter(OrderDetail.order_id == order_id).all()
    if not details:
        raise HTTPException(400, "订单无菜品")

    children_orders = []

    if req.split_method == "by_item" and req.items_per_person:
        for person_items in req.items_per_person:
            child_order = Order(
                table_id=original_order.table_id,
                order_no=generate_order_no(),
                member_phone=original_order.member_phone,
                order_status='进行中'
            )
            db.add(child_order)
            db.flush()

            total = 0
            for detail_id in person_items:
                detail = db.query(OrderDetail).filter(
                    OrderDetail.detail_id == detail_id,
                    OrderDetail.order_id == order_id
                ).first()
                if detail:
                    new_detail = OrderDetail(
                        order_id=child_order.order_id,
                        dish_id=detail.dish_id,
                        quantity=detail.quantity,
                        unit_price=detail.unit_price,
                        subtotal=detail.subtotal,
                        remark=detail.remark
                    )
                    db.add(new_detail)
                    total += float(detail.subtotal)
                    db.delete(detail)

            discount_rate = calc_discount(original_order.member_phone, db)
            actual = round(total * discount_rate, 2)
            child_order.total_amount = total
            child_order.actual_amount = actual

            split_rel = OrderSplitRelation(
                original_order_id=order_id,
                child_order_id=child_order.order_id
            )
            db.add(split_rel)
            children_orders.append(child_order)

    elif req.split_method == "by_amount" and req.amounts:
        total_amount = float(original_order.total_amount)
        total_actual = float(original_order.actual_amount)

        for amount in req.amounts:
            child_order = Order(
                table_id=original_order.table_id,
                order_no=generate_order_no(),
                member_phone=original_order.member_phone,
                order_status='进行中'
            )
            db.add(child_order)
            db.flush()

            ratio = amount / total_amount if total_amount > 0 else 0
            child_order.total_amount = round(amount, 2)
            child_order.actual_amount = round(total_actual * ratio, 2)

            split_rel = OrderSplitRelation(
                original_order_id=order_id,
                child_order_id=child_order.order_id
            )
            db.add(split_rel)
            children_orders.append(child_order)

        for detail in details:
            db.delete(detail)

    remaining_details = db.query(OrderDetail).filter(OrderDetail.order_id == order_id).count()
    if remaining_details == 0:
        original_order.order_status = '已取消'

    log_entry = OrderLog(
        order_id=order_id,
        action='SPLIT_ORDER',
        old_data=f"拆分为{len(children_orders)}个子订单",
        operator=token,
        operator_role='收银员'
    )
    db.add(log_entry)
    db.commit()

    return {
        "message": f"拆单成功，拆分为{len(children_orders)}个订单",
        "child_orders": [
            {"order_id": o.order_id, "order_no": o.order_no, "amount": float(o.actual_amount)}
            for o in children_orders
        ]
    }


# 6. 并单功能（服务员/店长）

@router.post("/orders/merge")
def merge_orders(
    req: MergeOrderReq,
    token: str = Header(...),
    db: Session = Depends(get_db)
):
    verify_role(token, ['服务员', '店长'])

    target_table = db.query(Table).filter(Table.table_id == req.target_table_id).first()
    if not target_table or target_table.status != '空闲':
        raise HTTPException(400, "目标桌台不可用")

    source_orders = []
    total_amount = 0
    total_actual = 0
    member_phone = None

    for order_id in req.source_order_ids:
        order = db.query(Order).filter(
            Order.order_id == order_id,
            Order.order_status == '进行中'
        ).first()
        if not order:
            raise HTTPException(404, f"订单{order_id}不存在或已结算")
        source_orders.append(order)
        total_amount += float(order.total_amount)
        total_actual += float(order.actual_amount)
        if order.member_phone and not member_phone:
            member_phone = order.member_phone

    new_order = Order(
        table_id=req.target_table_id,
        order_no=generate_order_no(),
        member_phone=member_phone,
        total_amount=total_amount,
        actual_amount=total_actual,
        order_status='进行中'
    )
    db.add(new_order)
    db.flush()

    for source_order in source_orders:
        details = db.query(OrderDetail).filter(OrderDetail.order_id == source_order.order_id).all()
        for detail in details:
            detail.order_id = new_order.order_id
            db.add(detail)

        source_order.order_status = '已取消'

        log_entry = OrderLog(
            order_id=source_order.order_id,
            action='MERGED',
            new_data=f"合并到订单{new_order.order_no}",
            operator=token,
            operator_role='服务员'
        )
        db.add(log_entry)

    target_table.status = '用餐'

    log_entry = OrderLog(
        order_id=new_order.order_id,
        action='CREATE_BY_MERGE',
        old_data=f"合并自订单{req.source_order_ids}",
        operator=token,
        operator_role='服务员'
    )
    db.add(log_entry)
    db.commit()

    return {
        "message": f"并单成功，合并{len(source_orders)}个订单",
        "new_order_id": new_order.order_id,
        "new_order_no": new_order.order_no,
        "total_amount": total_amount,
        "actual_amount": total_actual
    }


# 7. 结算模块（收银员/店长）

@router.post("/settlement/{order_id}")
def settle_order(order_id: int, req: SettlementReq, token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['收银员', '店长'])

    order = db.query(Order).filter(
        Order.order_id == order_id,
        Order.order_status == '进行中'
    ).first()
    if not order:
        raise HTTPException(404, "订单不存在或已结算")

    settlement = Settlement(
        order_id=order_id,
        payment_method=req.payment_method,
        paid_amount=order.actual_amount,
        cashier=req.cashier
    )
    db.add(settlement)

    order.order_status = '已完成'
    order.settle_time = datetime.now()

    table = db.query(Table).filter(Table.table_id == order.table_id).first()
    if table:
        table.status = '空闲'

    if order.member_phone:
        member = db.query(Member).filter(Member.phone == order.member_phone).first()
        if member:
            member.points += int(float(order.actual_amount))

    db.commit()

    return {
        "message": "结算成功",
        "order_no": order.order_no,
        "paid_amount": float(order.actual_amount),
        "payment_method": req.payment_method
    }


# 8. 会员管理模块（收银员/店长）

@router.get("/members/{phone}")
def get_member(phone: str, token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['收银员', '店长'])
    member = db.query(Member).filter(Member.phone == phone).first()
    if not member:
        raise HTTPException(404, "会员不存在")
    return {
        "phone": member.phone,
        "name": member.name,
        "points": member.points,
        "discount_level": member.discount_level
    }


@router.get("/members/all")
def get_all_members(token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['收银员', '店长'])
    members = db.query(Member).all()
    return [
        {
            "member_id": m.member_id,
            "phone": m.phone,
            "name": m.name,
            "points": m.points,
            "discount_level": m.discount_level
        }
        for m in members
    ]


@router.post("/members")
def create_member(phone: str, name: str, token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['收银员', '店长'])
    existing = db.query(Member).filter(Member.phone == phone).first()
    if existing:
        raise HTTPException(400, "手机号已注册")

    member = Member(phone=phone, name=name, points=0, discount_level=1)
    db.add(member)
    db.commit()
    return {"message": "注册成功", "phone": phone, "name": name}


# 9. 统计报表模块（店长）

@router.get("/statistics/daily")
def daily_report(token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['店长'])
    today = datetime.now().date()
    start_datetime = datetime(today.year, today.month, today.day)
    end_datetime = start_datetime + timedelta(days=1)

    total = db.query(func.sum(Order.actual_amount)).filter(
        Order.settle_time >= start_datetime,
        Order.settle_time < end_datetime,
        Order.order_status == '已完成'
    ).scalar() or 0

    count = db.query(func.count(Order.order_id)).filter(
        Order.settle_time >= start_datetime,
        Order.settle_time < end_datetime,
        Order.order_status == '已完成'
    ).scalar() or 0

    top_dishes = db.query(
        Dish.name,
        func.sum(OrderDetail.quantity).label('qty')
    ).join(OrderDetail, Dish.dish_id == OrderDetail.dish_id)\
     .join(Order, OrderDetail.order_id == Order.order_id)\
     .filter(Order.settle_time >= start_datetime, Order.settle_time < end_datetime, Order.order_status == '已完成')\
     .group_by(Dish.dish_id)\
     .order_by(func.sum(OrderDetail.quantity).desc())\
     .limit(5).all()

    return {
        "date": today.isoformat(),
        "total_amount": float(total),
        "order_count": count,
        "avg_amount": float(total / count) if count > 0 else 0,
        "top_dishes": [{"name": d.name, "quantity": d.qty} for d in top_dishes]
    }


@router.get("/statistics/monthly")
def monthly_report(year: int, month: int, token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['店长'])
    start_date = datetime(year, month, 1)
    if month == 12:
        end_date = datetime(year + 1, 1, 1)
    else:
        end_date = datetime(year, month + 1, 1)

    total = db.query(func.sum(Order.actual_amount)).filter(
        Order.settle_time >= start_date,
        Order.settle_time < end_date,
        Order.order_status == '已完成'
    ).scalar() or 0

    count = db.query(func.count(Order.order_id)).filter(
        Order.settle_time >= start_date,
        Order.settle_time < end_date,
        Order.order_status == '已完成'
    ).scalar() or 0

    return {
        "year": year,
        "month": month,
        "total_amount": float(total),
        "order_count": count,
        "avg_amount": float(total / count) if count > 0 else 0
    }


@router.get("/statistics/yearly")
def yearly_report(year: int, token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['店长'])
    start_date = datetime(year, 1, 1)
    end_date = datetime(year + 1, 1, 1)

    total = db.query(func.sum(Order.actual_amount)).filter(
        Order.settle_time >= start_date,
        Order.settle_time < end_date,
        Order.order_status == '已完成'
    ).scalar() or 0

    count = db.query(func.count(Order.order_id)).filter(
        Order.settle_time >= start_date,
        Order.settle_time < end_date,
        Order.order_status == '已完成'
    ).scalar() or 0

    monthly_data = []
    for month in range(1, 13):
        month_start = datetime(year, month, 1)
        if month == 12:
            month_end = datetime(year + 1, 1, 1)
        else:
            month_end = datetime(year, month + 1, 1)

        month_total = db.query(func.sum(Order.actual_amount)).filter(
            Order.settle_time >= month_start,
            Order.settle_time < month_end,
            Order.order_status == '已完成'
        ).scalar() or 0

        month_count = db.query(func.count(Order.order_id)).filter(
            Order.settle_time >= month_start,
            Order.settle_time < month_end,
            Order.order_status == '已完成'
        ).scalar() or 0

        monthly_data.append({
            "month": month,
            "total_amount": float(month_total),
            "order_count": month_count,
            "avg_amount": float(month_total / month_count) if month_count > 0 else 0
        })

    return {
        "year": year,
        "total_amount": float(total),
        "total_orders": count,
        "avg_amount": float(total / count) if count > 0 else 0,
        "monthly_data": monthly_data
    }


@router.get("/statistics/turnover-rate")
def turnover_rate(date: str = None, token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['店长'])
    if date is None:
        date = datetime.now().date()
    else:
        date = datetime.strptime(date, "%Y-%m-%d").date()

    start_datetime = datetime(date.year, date.month, date.day)
    end_datetime = start_datetime + timedelta(days=1)

    completed_orders = db.query(func.count(Order.order_id)).filter(
        Order.settle_time >= start_datetime,
        Order.settle_time < end_datetime,
        Order.order_status == '已完成'
    ).scalar() or 0

    total_tables = db.query(func.count(Table.table_id)).scalar() or 1
    turnover_rate = completed_orders / total_tables

    avg_duration = db.query(
        func.avg(func.timestampdiff(text('MINUTE'), Order.order_time, Order.settle_time))
    ).filter(
        Order.settle_time >= start_datetime,
        Order.settle_time < end_datetime,
        Order.order_status == '已完成'
    ).scalar() or 0

    hour_distribution = []
    for hour in range(0, 24):
        hour_start = start_datetime.replace(hour=hour, minute=0, second=0)
        hour_end = start_datetime.replace(hour=hour, minute=59, second=59)
        hour_count = db.query(func.count(Order.order_id)).filter(
            Order.settle_time >= hour_start,
            Order.settle_time <= hour_end,
            Order.order_status == '已完成'
        ).scalar() or 0
        if hour_count > 0:
            hour_distribution.append({"hour": hour, "orders": hour_count})

    return {
        "date": date.isoformat(),
        "total_tables": total_tables,
        "completed_orders": completed_orders,
        "turnover_rate": round(turnover_rate, 2),
        "avg_dining_minutes": round(avg_duration),
        "hour_distribution": hour_distribution
    }


# 10. 后厨管理模块（后厨/店长）

@router.get("/kitchen/orders")
def get_kitchen_orders(token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['后厨', '店长'])

    details = db.query(
        OrderDetail,
        Table.table_no,
        Order.order_no
    ).join(
        Order, OrderDetail.order_id == Order.order_id
    ).join(
        Table, Order.table_id == Table.table_id
    ).filter(
        OrderDetail.status.in_(['待做', '制作中']),
        Order.order_status == '进行中'
    ).all()

    result = []
    for detail, table_no, order_no in details:
        dish = db.query(Dish).filter(Dish.dish_id == detail.dish_id).first()
        result.append({
            "detail_id": detail.detail_id,
            "order_no": order_no,
            "table_no": table_no,
            "dish_name": dish.name if dish else "未知",
            "quantity": detail.quantity,
            "remark": detail.remark,
            "status": detail.status
        })

    result.sort(key=lambda x: x['table_no'])
    return result


@router.put("/kitchen/orders/{detail_id}/complete")
def complete_dish(detail_id: int, token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['后厨', '店长'])
    detail = db.query(OrderDetail).filter(OrderDetail.detail_id == detail_id).first()
    if not detail:
        raise HTTPException(404, "菜品明细不存在")
    detail.status = '已完成'
    db.commit()
    return {"message": "菜品已完成"}


# 11. 权限管理模块（公开）

@router.post("/auth/login")
def login(req: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        User.username == req.username,
        User.password == req.password,
        User.status == '在职'
    ).first()

    if not user:
        raise HTTPException(401, "用户名或密码错误")

    return {
        "message": "登录成功",
        "token": user.username,
        "user_id": user.user_id,
        "username": user.username,
        "role": user.role,
        "real_name": user.real_name
    }


@router.get("/auth/me")
def get_current_user(token: str = Header(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == token, User.status == '在职').first()
    if not user:
        raise HTTPException(401, "用户不存在或已禁用")
    return {"user_id": user.user_id, "username": user.username, "role": user.role, "real_name": user.real_name}


# 12. 操作日志模块（店长）

@router.get("/logs/orders/{order_id}")
def get_order_logs(order_id: int, token: str = Header(...), db: Session = Depends(get_db)):
    verify_role(token, ['店长'])

    logs = db.query(OrderLog).filter(OrderLog.order_id == order_id).order_by(OrderLog.log_time.desc()).all()

    return [
        {
            "log_id": l.log_id,
            "action": l.action,
            "old_data": l.old_data,
            "new_data": l.new_data,
            "operator": l.operator,
            "operator_role": l.operator_role,
            "log_time": l.log_time
        }
        for l in logs
    ]