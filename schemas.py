from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime

# 桌台相关
class TableStatusReq(BaseModel):
    status: str = Field(..., pattern='^(空闲|用餐|预订|清洁)$')

class TableResponse(BaseModel):
    table_id: int
    table_no: str
    seats: int
    status: str

# 菜品相关
class DishResponse(BaseModel):
    dish_id: int
    name: str
    category: str
    price: float
    status: str

# 订单相关
class OrderItem(BaseModel):
    dish_id: int = Field(..., gt=0)
    quantity: int = Field(..., ge=1, le=99)
    remark: Optional[str] = Field(None, max_length=255)

class OrderCreate(BaseModel):
    table_id: int = Field(..., gt=0)
    items: List[OrderItem] = Field(..., min_length=1)
    member_phone: Optional[str] = Field(None, pattern='^1[3-9]\\d{9}$')

class AddDishReq(BaseModel):
    dish_id: int = Field(..., gt=0)
    quantity: int = Field(..., ge=1, le=99)
    remark: Optional[str] = None

class ChangeDishReq(BaseModel):
    old_detail_id: int = Field(..., gt=0)
    new_dish_id: int = Field(..., gt=0)
    quantity: int = Field(1, ge=1, le=99)
    remark: Optional[str] = None

class SplitOrderReq(BaseModel):
    split_method: str = Field("by_item", pattern='^(by_item|by_amount)$')
    items_per_person: Optional[List[List[int]]] = None
    amounts: Optional[List[float]] = None

class MergeOrderReq(BaseModel):
    source_order_ids: List[int] = Field(..., min_length=2)
    target_table_id: int = Field(..., gt=0)

# 结算相关
class SettlementReq(BaseModel):
    payment_method: str = Field(..., pattern='^(现金|微信|支付宝|会员卡)$')
    cashier: str = Field(..., max_length=50)

# 会员相关
class MemberResponse(BaseModel):
    phone: str
    name: str
    points: int
    discount_level: int

# 用户相关（权限管理）
class UserLogin(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=1)

class UserResponse(BaseModel):
    user_id: int
    username: str
    role: str
    real_name: str

# 统计报表相关
class DailyReportResponse(BaseModel):
    date: str
    total_amount: float
    order_count: int
    avg_amount: float
    top_dishes: List[dict]

class TurnoverRateResponse(BaseModel):
    date: str
    total_tables: int
    completed_orders: int
    turnover_rate: float
    avg_dining_minutes: float
    hour_distribution: List[dict]