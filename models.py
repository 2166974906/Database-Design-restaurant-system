from sqlalchemy import Column, Integer, String, DECIMAL, Enum, TIMESTAMP, ForeignKey, Text
from sqlalchemy.sql import func
from database import Base

# 数据模型定义（9张表）

class Table(Base):
    __tablename__ = "tables"
    table_id = Column(Integer, primary_key=True, autoincrement=True)
    table_no = Column(String(10), nullable=False, unique=True)
    seats = Column(Integer, default=4)
    status = Column(Enum('空闲', '用餐', '预订', '清洁'), default='空闲')
    version = Column(Integer, default=0)
    created_at = Column(TIMESTAMP, server_default=func.now())

class Dish(Base):
    __tablename__ = "dishes"
    dish_id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    category = Column(String(50))
    price = Column(DECIMAL(10, 2), nullable=False)
    status = Column(Enum('在售', '停售'), default='在售')
    image_url = Column(String(255))
    sort_order = Column(Integer, default=0)
    created_at = Column(TIMESTAMP, server_default=func.now())

class Order(Base):
    __tablename__ = "orders"
    order_id = Column(Integer, primary_key=True, autoincrement=True)
    table_id = Column(Integer, ForeignKey('tables.table_id'), nullable=False)
    order_no = Column(String(20), nullable=False, unique=True)
    total_amount = Column(DECIMAL(10, 2), default=0)
    discount_amount = Column(DECIMAL(10, 2), default=0)
    actual_amount = Column(DECIMAL(10, 2), default=0)
    order_status = Column(Enum('进行中', '已完成', '已取消'), default='进行中')
    member_phone = Column(String(20))
    order_time = Column(TIMESTAMP, server_default=func.now())
    settle_time = Column(TIMESTAMP)
    version = Column(Integer, default=0)

class OrderDetail(Base):
    __tablename__ = "order_details"
    detail_id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey('orders.order_id', ondelete='CASCADE'), nullable=False)
    dish_id = Column(Integer, ForeignKey('dishes.dish_id'), nullable=False)
    quantity = Column(Integer, default=1)
    unit_price = Column(DECIMAL(10, 2), nullable=False)
    subtotal = Column(DECIMAL(10, 2))
    remark = Column(String(255))
    status = Column(Enum('待做', '制作中', '已完成'), default='待做')
    created_at = Column(TIMESTAMP, server_default=func.now())

class Member(Base):
    __tablename__ = "members"
    member_id = Column(Integer, primary_key=True, autoincrement=True)
    phone = Column(String(20), nullable=False, unique=True)
    name = Column(String(50))
    points = Column(Integer, default=0)
    balance = Column(DECIMAL(10, 2), default=0)
    discount_level = Column(Integer, default=1)
    register_time = Column(TIMESTAMP, server_default=func.now())

class Settlement(Base):
    __tablename__ = "settlements"
    settle_id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey('orders.order_id'), nullable=False)
    payment_method = Column(Enum('现金', '微信', '支付宝', '会员卡'), nullable=False)
    paid_amount = Column(DECIMAL(10, 2), nullable=False)
    settle_time = Column(TIMESTAMP, server_default=func.now())
    cashier = Column(String(50))

class User(Base):
    __tablename__ = "users"
    user_id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), nullable=False, unique=True)
    password = Column(String(255), nullable=False)
    role = Column(Enum('服务员', '收银员', '后厨', '店长'), nullable=False)
    real_name = Column(String(50))
    phone = Column(String(20))
    status = Column(Enum('在职', '离职'), default='在职')
    created_at = Column(TIMESTAMP, server_default=func.now())

class OrderLog(Base):
    __tablename__ = "order_logs"
    log_id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey('orders.order_id'), nullable=False)
    action = Column(String(50))
    old_data = Column(Text)
    new_data = Column(Text)
    operator = Column(String(50))
    operator_role = Column(String(20))
    log_time = Column(TIMESTAMP, server_default=func.now())

class OrderSplitRelation(Base):
    __tablename__ = "order_split_relations"
    split_id = Column(Integer, primary_key=True, autoincrement=True)
    original_order_id = Column(Integer, ForeignKey('orders.order_id'), nullable=False)
    child_order_id = Column(Integer, ForeignKey('orders.order_id'), nullable=False)
    split_time = Column(TIMESTAMP, server_default=func.now())