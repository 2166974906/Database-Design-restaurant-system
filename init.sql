-- 餐饮门店点餐管理系统 - 数据库初始化脚本

-- 1. 创建数据库
DROP DATABASE IF EXISTS restaurant_db;
CREATE DATABASE restaurant_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE restaurant_db;


-- 2. 创建表

-- 2.1 桌台表
CREATE TABLE tables (
    table_id INT PRIMARY KEY AUTO_INCREMENT COMMENT '桌台ID',
    table_no VARCHAR(10) NOT NULL UNIQUE COMMENT '桌台号',
    seats INT DEFAULT 4 COMMENT '座位数',
    status ENUM('空闲', '用餐', '预订', '清洁') DEFAULT '空闲' COMMENT '状态',
    version INT DEFAULT 0 COMMENT '乐观锁版本号',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
) COMMENT='桌台信息表';

-- 2.2 菜品表
CREATE TABLE dishes (
    dish_id INT PRIMARY KEY AUTO_INCREMENT COMMENT '菜品ID',
    name VARCHAR(100) NOT NULL COMMENT '菜品名称',
    category VARCHAR(50) COMMENT '分类',
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0) COMMENT '单价',
    status ENUM('在售', '停售') DEFAULT '在售' COMMENT '状态',
    sort_order INT DEFAULT 0 COMMENT '排序',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
) COMMENT='菜品信息表';

-- 2.3 订单表
CREATE TABLE orders (
    order_id INT PRIMARY KEY AUTO_INCREMENT COMMENT '订单ID',
    table_id INT NOT NULL COMMENT '桌台ID',
    order_no VARCHAR(20) NOT NULL UNIQUE COMMENT '订单号',
    total_amount DECIMAL(10,2) DEFAULT 0 COMMENT '原价合计',
    discount_amount DECIMAL(10,2) DEFAULT 0 COMMENT '优惠金额',
    actual_amount DECIMAL(10,2) DEFAULT 0 COMMENT '实付金额',
    order_status ENUM('进行中', '已完成', '已取消') DEFAULT '进行中' COMMENT '订单状态',
    member_phone VARCHAR(20) COMMENT '会员手机号',
    order_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '下单时间',
    settle_time TIMESTAMP NULL COMMENT '结算时间',
    version INT DEFAULT 0 COMMENT '乐观锁版本号',
    FOREIGN KEY (table_id) REFERENCES tables(table_id)
) COMMENT='订单主表';

-- 2.4 订单明细表
CREATE TABLE order_details (
    detail_id INT PRIMARY KEY AUTO_INCREMENT COMMENT '明细ID',
    order_id INT NOT NULL COMMENT '订单ID',
    dish_id INT NOT NULL COMMENT '菜品ID',
    quantity INT DEFAULT 1 CHECK (quantity > 0) COMMENT '数量',
    unit_price DECIMAL(10,2) NOT NULL COMMENT '单价(快照)',
    subtotal DECIMAL(10,2) COMMENT '小计',
    remark VARCHAR(255) COMMENT '备注',
    status ENUM('待做', '制作中', '已完成') DEFAULT '待做' COMMENT '制作状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (dish_id) REFERENCES dishes(dish_id)
) COMMENT='订单明细表';

-- 2.5 会员表
CREATE TABLE members (
    member_id INT PRIMARY KEY AUTO_INCREMENT COMMENT '会员ID',
    phone VARCHAR(20) NOT NULL UNIQUE COMMENT '手机号',
    name VARCHAR(50) COMMENT '姓名',
    points INT DEFAULT 0 CHECK (points >= 0) COMMENT '积分',
    balance DECIMAL(10,2) DEFAULT 0 CHECK (balance >= 0) COMMENT '余额',
    discount_level INT DEFAULT 1 COMMENT '折扣等级:1=9.5折,2=9折,3=8.5折',
    register_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间'
) COMMENT='会员信息表';

-- 2.6 结算表
CREATE TABLE settlements (
    settle_id INT PRIMARY KEY AUTO_INCREMENT COMMENT '结算ID',
    order_id INT NOT NULL COMMENT '订单ID',
    payment_method ENUM('现金', '微信', '支付宝', '会员卡') NOT NULL COMMENT '支付方式',
    paid_amount DECIMAL(10,2) NOT NULL COMMENT '支付金额',
    settle_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '结算时间',
    cashier VARCHAR(50) COMMENT '收银员',
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
) COMMENT='结算记录表';

-- 2.7 用户表（权限管理）
CREATE TABLE users (
    user_id INT PRIMARY KEY AUTO_INCREMENT COMMENT '用户ID',
    username VARCHAR(50) UNIQUE NOT NULL COMMENT '用户名',
    password VARCHAR(255) NOT NULL COMMENT '密码',
    role ENUM('服务员', '收银员', '后厨', '店长') NOT NULL COMMENT '角色',
    real_name VARCHAR(50) COMMENT '真实姓名',
    phone VARCHAR(20) COMMENT '联系电话',
    status ENUM('在职', '离职') DEFAULT '在职' COMMENT '状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
) COMMENT='用户表';

-- 2.8 操作日志表
CREATE TABLE order_logs (
    log_id INT PRIMARY KEY AUTO_INCREMENT COMMENT '日志ID',
    order_id INT NOT NULL COMMENT '订单ID',
    action VARCHAR(50) COMMENT '操作类型',
    old_data TEXT COMMENT '变更前数据',
    new_data TEXT COMMENT '变更后数据',
    operator VARCHAR(50) COMMENT '操作人',
    operator_role VARCHAR(20) COMMENT '操作人角色',
    log_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
) COMMENT='操作日志表';

-- 2.9 拆单关联表
CREATE TABLE order_split_relations (
    split_id INT PRIMARY KEY AUTO_INCREMENT COMMENT '拆分ID',
    original_order_id INT NOT NULL COMMENT '原订单ID',
    child_order_id INT NOT NULL COMMENT '子订单ID',
    split_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '拆分时间',
    FOREIGN KEY (original_order_id) REFERENCES orders(order_id),
    FOREIGN KEY (child_order_id) REFERENCES orders(order_id)
) COMMENT='订单拆分关联表';


-- 3. 索引优化

CREATE INDEX idx_tables_status ON tables(status);
CREATE INDEX idx_orders_status_time ON orders(order_status, order_time);
CREATE INDEX idx_orders_table_status ON orders(table_id, order_status);
CREATE INDEX idx_orders_time ON orders(order_time);
CREATE INDEX idx_details_order ON order_details(order_id);
CREATE INDEX idx_details_status ON order_details(status);
CREATE INDEX idx_member_phone ON members(phone);
CREATE INDEX idx_logs_order ON order_logs(order_id);
CREATE INDEX idx_logs_time ON order_logs(log_time);


-- 4. 视图

-- 视图1：当前进行中的订单（后厨使用）
CREATE VIEW v_active_orders AS
SELECT
    o.order_id,
    o.order_no,
    t.table_no,
    d.name AS dish_name,
    od.quantity,
    od.remark,
    od.status AS cook_status,
    d.category
FROM orders o
JOIN tables t ON o.table_id = t.table_id
JOIN order_details od ON o.order_id = od.order_id
JOIN dishes d ON od.dish_id = d.dish_id
WHERE o.order_status = '进行中'
ORDER BY
    CASE WHEN d.category = '凉菜' THEN 1
         WHEN d.category = '热菜' THEN 2
         ELSE 3 END,
    o.order_time;

-- 视图2：未结算订单汇总（收银员使用）
CREATE VIEW v_unsettled_orders AS
SELECT
    o.order_id,
    t.table_no,
    o.order_time,
    o.total_amount,
    o.actual_amount,
    TIMESTAMPDIFF(MINUTE, o.order_time, NOW()) AS duration_minutes
FROM orders o
JOIN tables t ON o.table_id = t.table_id
WHERE o.order_status = '进行中';

-- 视图3：会员消费统计（店长使用）
CREATE VIEW v_member_stats AS
SELECT
    m.phone,
    m.name,
    m.points,
    m.discount_level,
    COUNT(o.order_id) AS order_count,
    COALESCE(SUM(o.actual_amount), 0) AS total_spent
FROM members m
LEFT JOIN orders o ON m.phone = o.member_phone AND o.order_status = '已完成'
GROUP BY m.member_id
ORDER BY total_spent DESC;


-- 5. 触发器

DELIMITER $$

-- 触发器1：订单明细插入时自动计算小计
DROP TRIGGER IF EXISTS tr_calc_subtotal$$
CREATE TRIGGER tr_calc_subtotal
BEFORE INSERT ON order_details
FOR EACH ROW
BEGIN
    SET NEW.subtotal = NEW.quantity * NEW.unit_price;
END$$

-- 触发器2：订单完成时自动释放桌台
DROP TRIGGER IF EXISTS tr_order_complete$$
CREATE TRIGGER tr_order_complete
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    IF NEW.order_status IN ('已完成', '已取消') AND OLD.order_status = '进行中' THEN
        UPDATE tables SET status = '空闲', version = version + 1
        WHERE table_id = NEW.table_id;
    END IF;
END$$

-- 触发器3：金额变更时记录日志
DROP TRIGGER IF EXISTS tr_order_amount_log$$
CREATE TRIGGER tr_order_amount_log
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    IF OLD.total_amount != NEW.total_amount OR OLD.actual_amount != NEW.actual_amount THEN
        INSERT INTO order_logs(order_id, action, old_data, new_data)
        VALUES (
            NEW.order_id,
            'AMOUNT_CHANGE',
            CONCAT('总额:', OLD.total_amount, ',实付:', OLD.actual_amount),
            CONCAT('总额:', NEW.total_amount, ',实付:', NEW.actual_amount)
        );
    END IF;
END$$

DELIMITER ;


-- 6. 存储过程

-- 存储过程1：结算订单
DELIMITER $$

DROP PROCEDURE IF EXISTS sp_settle_order$$
CREATE PROCEDURE sp_settle_order(
    IN p_order_id INT,
    IN p_payment_method VARCHAR(20),
    IN p_cashier VARCHAR(50),
    OUT p_result VARCHAR(100)
)
BEGIN
    DECLARE v_total_amount DECIMAL(10,2);
    DECLARE v_member_phone VARCHAR(20);
    DECLARE v_order_status VARCHAR(20);
    DECLARE v_table_id INT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_result = '结算失败，系统错误';
    END;

    START TRANSACTION;

    SELECT actual_amount, member_phone, order_status, table_id
    INTO v_total_amount, v_member_phone, v_order_status, v_table_id
    FROM orders WHERE order_id = p_order_id FOR UPDATE;

    IF v_order_status != '进行中' THEN
        SET p_result = '订单已结算或已取消';
        ROLLBACK;
    ELSE
        INSERT INTO settlements(order_id, payment_method, paid_amount, cashier)
        VALUES(p_order_id, p_payment_method, v_total_amount, p_cashier);

        UPDATE orders SET order_status = '已完成', settle_time = NOW()
        WHERE order_id = p_order_id;

        UPDATE tables SET status = '空闲' WHERE table_id = v_table_id;

        IF v_member_phone IS NOT NULL AND v_total_amount > 0 THEN
            UPDATE members SET points = points + FLOOR(v_total_amount)
            WHERE phone = v_member_phone;
        END IF;

        SET p_result = '结算成功';
        COMMIT;
    END IF;
END$$

DELIMITER ;


-- 7. 测试数据

-- 7.1 插入桌台（4种状态都有）
INSERT INTO tables (table_no, seats, status) VALUES
('A01', 4, '空闲'),
('A02', 4, '空闲'),
('B01', 6, '空闲'),
('B02', 8, '空闲'),
('C01', 2, '空闲'),
('C02', 4, '空闲');

-- 7.2 插入菜品
INSERT INTO dishes (name, category, price, sort_order) VALUES
('拍黄瓜', '凉菜', 18.00, 1),
('凉拌木耳', '凉菜', 22.00, 2),
('口水鸡', '凉菜', 38.00, 3),
('夫妻肺片', '凉菜', 42.00, 4),
('宫保鸡丁', '热菜', 38.00, 10),
('鱼香肉丝', '热菜', 32.00, 11),
('酸菜鱼', '热菜', 68.00, 12),
('水煮牛肉', '热菜', 58.00, 13),
('糖醋排骨', '热菜', 48.00, 14),
('红烧肉', '热菜', 52.00, 15),
('麻婆豆腐', '热菜', 22.00, 16),
('米饭', '主食', 3.00, 20),
('扬州炒饭', '主食', 18.00, 21),
('手工水饺', '主食', 22.00, 22),
('可乐', '饮品', 5.00, 30),
('雪碧', '饮品', 5.00, 31),
('橙汁', '饮品', 12.00, 32);

-- 7.3 插入会员
INSERT INTO members (phone, name, points, balance, discount_level) VALUES
('13800000001', '克莱恩', 120, 500.00, 1),
('13800000002', '梅丽莎', 50, 200.00, 1),
('13800000003', '班森', 300, 1000.00, 2),
('13900000001', '奥黛丽', 80, 0, 1);

-- 7.4 插入用户（密码均为123456）
INSERT INTO users (username, password, role, real_name) VALUES
('waiter1', '123456', '服务员', '张服务员'),
('cashier1', '123456', '收银员', '李收银员'),
('chef1', '123456', '后厨', '王厨师'),
('manager1', '123456', '店长', '李瀚铭');

-- 7.5 插入测试订单（进行中）
INSERT INTO orders (table_id, order_no, total_amount, actual_amount, order_status, order_time) VALUES
(1, '202601010001', 76.00, 76.00, '进行中', '2026-01-01 12:00:00'),
(2, '202601010002', 110.00, 104.50, '进行中', '2026-01-01 12:30:00');

INSERT INTO order_details (order_id, dish_id, quantity, unit_price, subtotal, status) VALUES
(1, 5, 1, 38.00, 38.00, '已完成'),
(1, 12, 2, 3.00, 6.00, '已完成'),
(1, 1, 1, 18.00, 18.00, '已完成'),
(2, 7, 1, 68.00, 68.00, '制作中'),
(2, 16, 1, 5.00, 5.00, '待做');

-- 7.6 插入已完成订单（用于报表）
INSERT INTO orders (table_id, order_no, total_amount, actual_amount, order_status, member_phone, order_time, settle_time) VALUES
(3, '202512310001', 150.00, 142.50, '已完成', '13800000001', '2025-12-31 18:00:00', '2025-12-31 19:00:00'),
(4, '202512310002', 200.00, 180.00, '已完成', '13800000003', '2025-12-31 19:00:00', '2025-12-31 20:00:00');

INSERT INTO order_details (order_id, dish_id, quantity, unit_price, subtotal) VALUES
(3, 7, 1, 68.00, 68.00),
(3, 5, 1, 38.00, 38.00),
(3, 12, 3, 3.00, 9.00),
(4, 7, 2, 68.00, 136.00),
(4, 16, 2, 5.00, 10.00);

INSERT INTO settlements (order_id, payment_method, paid_amount, cashier) VALUES
(3, '微信', 142.50, '收银员A'),
(4, '会员卡', 180.00, '收银员A');


-- 8. 验证查询

-- 查看所有表
SHOW TABLES;

-- 查看视图
SELECT * FROM v_active_orders;
SELECT * FROM v_unsettled_orders;
SELECT * FROM v_member_stats;

-- 查看用户
SELECT * FROM users;