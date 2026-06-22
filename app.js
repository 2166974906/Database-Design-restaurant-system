// API配置

const API_BASE = '/api';
let currentToken = localStorage.getItem('token') || '';
let currentUser = null;
let currentOrderId = null;
let currentCart = [];
let currentTableId = null;
let currentOrderDetails = [];

// 工具函数
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.background = isError ? '#dc3545' : '#28a745';
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

async function apiRequest(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    if (currentToken) {
        headers['token'] = currentToken;
    }

    const response = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers
    });

    if (response.status === 401) {
        logout();
        throw new Error('登录已过期，请重新登录');
    }

    return response;
}

function fillDemo(username, password) {
    document.getElementById('username').value = username;
    document.getElementById('password').value = password;
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

// 角色权限配置
const ROLE_PERMISSIONS = {
    '店长': ['dashboard', 'tables', 'order', 'kitchen', 'settlement', 'reports', 'members', 'logs'],
    '服务员': ['dashboard', 'tables', 'order'],
    '收银员': ['dashboard', 'settlement', 'members'],
    '后厨': ['dashboard', 'kitchen']
};

function getMenuItems() {
    return {
        dashboard: document.querySelector('[data-page="dashboard"]'),
        tables: document.querySelector('[data-page="tables"]'),
        order: document.querySelector('[data-page="order"]'),
        kitchen: document.querySelector('[data-page="kitchen"]'),
        settlement: document.querySelector('[data-page="settlement"]'),
        reports: document.querySelector('[data-page="reports"]'),
        members: document.querySelector('[data-page="members"]'),
        logs: document.querySelector('[data-page="logs"]')
    };
}

function applyRolePermissions(role) {
    const menus = getMenuItems();
    const allowed = ROLE_PERMISSIONS[role] || ['dashboard'];

    // 全部隐藏
    Object.keys(menus).forEach(key => {
        if (menus[key]) {
            menus[key].style.display = 'none';
        }
    });

    // 显示允许的菜单
    allowed.forEach(pageId => {
        if (menus[pageId]) {
            menus[pageId].style.display = 'flex';
        }
    });
}

function hasPagePermission(pageId) {
    if (!currentUser) return false;
    const allowed = ROLE_PERMISSIONS[currentUser.role] || ['dashboard'];
    return allowed.includes(pageId);
}

// 登录相关
async function login(username, password) {
    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            const data = await response.json();
            currentToken = data.token;
            currentUser = data;
            localStorage.setItem('token', currentToken);
            localStorage.setItem('user', JSON.stringify(currentUser));
            showToast(`欢迎回来，${data.real_name}`);
            loadUserInfo();

            // 根据角色控制菜单显示
            applyRolePermissions(data.role);

            switchPage('dashboard');
            document.getElementById('loginPage').classList.remove('active');
            document.getElementById('dashboardPage').classList.add('active');
            return true;
        } else {
            const error = await response.json();
            showToast(error.detail || '登录失败', true);
            return false;
        }
    } catch (error) {
        showToast('网络错误', true);
        return false;
    }
}

function logout() {
    currentToken = '';
    currentUser = null;
    currentOrderId = null;
    currentCart = [];
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    document.getElementById('loginPage').classList.add('active');
    document.querySelectorAll('.page').forEach(page => {
        if (page.id !== 'loginPage') {
            page.classList.remove('active');
        }
    });
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    showToast('已退出登录');
}

function loadUserInfo() {
    document.getElementById('userName').textContent = currentUser?.real_name || '未知';
    document.getElementById('userRole').textContent = currentUser?.role || '';
    document.getElementById('welcomeName').textContent = currentUser?.real_name || '';
    document.getElementById('logoutBtn').style.display = 'flex';
}

// 页面切换（带权限检查）
function switchPage(pageId) {
    // 权限检查
    if (!hasPagePermission(pageId)) {
        showToast('您没有权限访问此页面', true);
        return;
    }

    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    const targetPage = document.getElementById(`${pageId}Page`);
    if (targetPage) {
        targetPage.classList.add('active');
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === pageId) {
            item.classList.add('active');
        }
    });

    switch(pageId) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'tables':
            loadTables();
            break;
        case 'order':
            loadTablesForSelect();
            loadMenu();
            resetOrderState();
            break;
        case 'kitchen':
            loadKitchenOrders();
            break;
        case 'settlement':
            loadUnsettledOrders();
            break;
        case 'members':
            break;
        case 'reports':
            loadDailyReport();
            break;
        case 'logs':
            break;
    }
}

// 重置订单状态
function resetOrderState() {
    if (currentOrderId) {
        loadCurrentOrderInfo();
        document.getElementById('addMoreBtn').style.display = 'block';
        document.getElementById('tableSelect').disabled = true;
        document.getElementById('changeDishBtn').style.display = 'inline-block';
        document.getElementById('splitOrderBtn').style.display = 'inline-block';
        document.getElementById('mergeOrderBtn').style.display = 'inline-block';
    } else {
        currentCart = [];
        currentOrderDetails = [];
        updateCartDisplay();
        document.getElementById('addMoreBtn').style.display = 'none';
        document.getElementById('tableSelect').disabled = false;
        document.getElementById('changeDishBtn').style.display = 'none';
        document.getElementById('splitOrderBtn').style.display = 'none';
        document.getElementById('mergeOrderBtn').style.display = 'none';
        document.getElementById('currentTableNo').textContent = '';
    }
}

// 工作台
async function loadDashboard() {
    try {
        const dailyRes = await apiRequest('/statistics/daily');
        if (dailyRes.ok) {
            const daily = await dailyRes.json();
            document.getElementById('todayAmount').textContent = `¥${daily.total_amount || 0}`;
            document.getElementById('todayOrders').textContent = daily.order_count || 0;
            const topDishesHtml = (daily.top_dishes || []).map(d =>
                `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;">
                    <span>${d.name}</span>
                    <span style="color:#00bf8f;">销量: ${d.quantity}</span>
                </div>`
            ).join('');
            document.getElementById('topDishesList').innerHTML = topDishesHtml || '<div style="color:#999;padding:10px;">今日暂无销售数据</div>';
        }
        const turnoverRes = await apiRequest('/statistics/turnover-rate');
        if (turnoverRes.ok) {
            const turnover = await turnoverRes.json();
            document.getElementById('turnoverRate').textContent = turnover.turnover_rate || 0;
        }
        const tablesRes = await apiRequest('/tables');
        if (tablesRes.ok) {
            const tables = await tablesRes.json();
            const activeTables = tables.filter(t => t.status === '用餐');
            document.getElementById('activeOrdersList').innerHTML = activeTables.map(t =>
                `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;">
                    <span>${t.table_no}号桌</span>
                    <span style="color:#ed6c02;">用餐中</span>
                </div>`
            ).join('') || '<div style="color:#999;padding:10px;">暂无进行中订单</div>';
        }
        // 会员总数接口（已在后端添加）
        try {
            const membersRes = await apiRequest('/members/all');
            if (membersRes.ok) {
                const members = await membersRes.json();
                document.getElementById('memberCount').textContent = members.length || 0;
            }
        } catch (e) {
            document.getElementById('memberCount').textContent = '0';
        }
    } catch (error) {
        console.error('加载工作台失败', error);
    }
}

// 桌台管理
async function loadTables() {
    try {
        const response = await apiRequest('/tables');
        const tables = await response.json();
        const grid = document.getElementById('tablesGrid');
        grid.innerHTML = tables.map(table => `
            <div class="table-card" onclick="handleTableClick(${table.table_id}, '${table.table_no}', '${table.status}')">
                <div class="table-no">${table.table_no}</div>
                <div class="table-seats">${table.seats}人座</div>
                <div class="table-status status-${table.status}">${table.status}</div>
            </div>
        `).join('');
    } catch (error) {
        showToast('加载桌台失败', true);
    }
}

async function handleTableClick(tableId, tableNo, status) {
    if (status === '空闲') {
        if (confirm(`是否将${tableNo}号桌设为"用餐"状态？`)) {
            await updateTableStatus(tableId, '用餐');
        }
    } else if (['用餐','预订','清洁'].includes(status)) {
        if (confirm(`是否将${tableNo}号桌设为"空闲"状态？`)) {
            await updateTableStatus(tableId, '空闲');
        }
    }
}

async function updateTableStatus(tableId, status) {
    try {
        const response = await apiRequest(`/tables/${tableId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
        if (response.ok) {
            showToast(`✅ ${status}状态更新成功`);
            loadTables();
            loadDashboard();
        } else {
            showToast('更新失败', true);
        }
    } catch (error) {
        showToast('更新失败', true);
    }
}

function refreshTables() { loadTables(); }

// 点餐下单 - 核心功能
async function loadTablesForSelect() {
    try {
        const response = await apiRequest('/tables');
        const tables = await response.json();
        const select = document.getElementById('tableSelect');
        const currentValue = select.value;
        select.innerHTML = '<option value="">请选择空闲桌台</option>' +
            tables.filter(t => t.status === '空闲').map(t =>
                `<option value="${t.table_id}">${t.table_no}号桌 (${t.seats}人座)</option>`
            ).join('');
        if (currentValue) select.value = currentValue;
    } catch (error) {
        console.error('加载桌台失败', error);
    }
}

async function loadMenu(category = 'all') {
    try {
        let url = '/dishes';
        if (category !== 'all') url += `?category=${encodeURIComponent(category)}`;
        const response = await apiRequest(url);
        const dishes = await response.json();
        const menuList = document.getElementById('menuList');
        menuList.innerHTML = dishes.map(dish => `
            <div class="menu-item" onclick="addToCart(${dish.dish_id}, '${dish.name}', ${dish.price})">
                <div class="dish-name">${dish.name}</div>
                <div class="dish-price">¥${dish.price}</div>
            </div>
        `).join('');
    } catch (error) {
        showToast('加载菜单失败', true);
    }
}

// 核心：点菜逻辑
function addToCart(dishId, name, price) {
    const tableId = document.getElementById('tableSelect').value;
    if (!tableId) {
        showToast('请先选择桌台', true);
        return;
    }
    if (currentOrderId) {
        addDishToExistingOrder(dishId, name, price);
        return;
    }
    const existing = currentCart.find(item => item.dish_id === dishId);
    if (existing) {
        existing.quantity++;
    } else {
        currentCart.push({ dish_id: dishId, name, price, quantity: 1, remark: '' });
    }
    updateCartDisplay();
    showToast(`已添加：${name}`);
}

async function addDishToExistingOrder(dishId, name, price) {
    try {
        const response = await apiRequest(`/orders/${currentOrderId}/add-dish`, {
            method: 'POST',
            body: JSON.stringify({ dish_id: dishId, quantity: 1, remark: '' })
        });
        if (response.ok) {
            showToast(`✅ 已加菜：${name}`);
            await loadCurrentOrderInfo();
        } else {
            const error = await response.json();
            showToast(error.detail || '加菜失败', true);
        }
    } catch (error) {
        showToast('加菜失败', true);
    }
}

async function loadCurrentOrderInfo() {
    if (!currentOrderId) {
        currentCart = [];
        currentOrderDetails = [];
        updateCartDisplay();
        return;
    }
    try {
        const response = await apiRequest(`/orders/current/${currentOrderId}`);
        if (response.ok) {
            const data = await response.json();
            if (data.has_order && data.items) {
                currentOrderDetails = data.items;
                currentCart = data.items.map(item => ({
                    detail_id: item.detail_id,
                    dish_id: item.dish_id,
                    name: item.dish_name,
                    price: item.unit_price,
                    quantity: item.quantity,
                    remark: item.remark || ''
                }));
                updateCartDisplay();
                document.getElementById('currentTableNo').textContent = `订单 ${data.order_no}`;
            }
        }
    } catch (error) {
        console.error('加载订单信息失败:', error);
    }
}

function updateCartDisplay() {
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');
    const cartActual = document.getElementById('cartActual');
    if (!currentCart || currentCart.length === 0) {
        cartItems.innerHTML = '<div class="empty-cart">暂无菜品，请点餐</div>';
        cartTotal.textContent = '¥0';
        cartActual.textContent = '¥0';
        return;
    }
    let total = 0;
    cartItems.innerHTML = currentCart.map(item => {
        const subtotal = (item.price || 0) * (item.quantity || 0);
        total += subtotal;
        const id = item.detail_id || item.dish_id;
        return `
            <div class="cart-item">
                <div class="cart-item-info">
                    <div class="cart-item-name">${item.name || '未知菜品'}</div>
                    <div class="cart-item-price">¥${(item.price || 0).toFixed(2)}</div>
                </div>
                <div class="cart-item-actions">
                    <div class="cart-item-qty">
                        <button class="qty-btn" onclick="updateCartQty(${id}, -1)">-</button>
                        <span>${item.quantity || 0}</span>
                        <button class="qty-btn" onclick="updateCartQty(${id}, 1)">+</button>
                    </div>
                    <div class="cart-item-total">¥${subtotal.toFixed(2)}</div>
                    <span class="delete-btn" onclick="removeFromCart(${id})">🗑️</span>
                </div>
            </div>
        `;
    }).join('');
    cartTotal.textContent = `¥${total.toFixed(2)}`;
    cartActual.textContent = `¥${total.toFixed(2)}`;
}

function updateCartQty(itemId, delta) {
    const item = currentCart.find(i => (i.detail_id === itemId || i.dish_id === itemId));
    if (!item) return;
    const newQty = (item.quantity || 0) + delta;
    if (newQty <= 0) {
        removeFromCart(itemId);
        return;
    }
    if (currentOrderId && item.detail_id) {
        removeDishFromOrder(item.detail_id);
        return;
    }
    item.quantity = newQty;
    updateCartDisplay();
}

function removeFromCart(itemId) {
    if (currentOrderId) {
        const item = currentCart.find(i => i.detail_id === itemId);
        if (item && item.detail_id) {
            removeDishFromOrder(item.detail_id);
            return;
        }
    }
    currentCart = currentCart.filter(i => (i.detail_id !== itemId && i.dish_id !== itemId));
    updateCartDisplay();
}

async function removeDishFromOrder(detailId) {
    try {
        const response = await apiRequest(`/orders/${currentOrderId}/remove-dish/${detailId}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            showToast('已退菜');
            await loadCurrentOrderInfo();
        } else {
            const error = await response.json();
            showToast(error.detail || '退菜失败', true);
        }
    } catch (error) {
        showToast('退菜失败', true);
    }
}

// 开台
async function startOrder() {
    const tableId = document.getElementById('tableSelect').value;
    if (!tableId) {
        showToast('请先选择桌台', true);
        return;
    }
    if (currentCart.length === 0) {
        showToast('请先点菜，再开台', true);
        return;
    }
    const memberPhone = document.getElementById('memberPhoneInput').value;
    const items = currentCart.map(item => ({
        dish_id: item.dish_id,
        quantity: item.quantity,
        remark: item.remark || ''
    }));
    try {
        const response = await apiRequest('/orders/create', {
            method: 'POST',
            body: JSON.stringify({
                table_id: parseInt(tableId),
                items: items,
                member_phone: memberPhone || null
            })
        });
        if (response.ok) {
            const data = await response.json();
            currentOrderId = data.order_id;
            currentTableId = parseInt(tableId);
            showToast(`✅ 开台成功！订单号：${data.order_no}`);
            currentCart = [];
            await loadCurrentOrderInfo();
            loadTablesForSelect();
            loadTables();
            document.getElementById('addMoreBtn').style.display = 'block';
            document.getElementById('tableSelect').disabled = true;
            document.getElementById('changeDishBtn').style.display = 'inline-block';
            document.getElementById('splitOrderBtn').style.display = 'inline-block';
            document.getElementById('mergeOrderBtn').style.display = 'inline-block';
            document.getElementById('currentTableNo').textContent = `桌台 ${data.table_no}`;
        } else {
            const error = await response.json();
            showToast(error.detail || '开台失败', true);
        }
    } catch (error) {
        showToast('开台失败', true);
    }
}

// 加菜弹窗
async function addMoreDishes() {
    if (!currentOrderId) {
        showToast('请先开台', true);
        return;
    }
    document.getElementById('addDishModal').style.display = 'flex';
    await loadAddDishMenu();
}

async function loadAddDishMenu() {
    try {
        const response = await apiRequest('/dishes');
        const dishes = await response.json();
        const menuDiv = document.getElementById('addDishMenu');
        menuDiv.innerHTML = dishes.map(dish => `
            <div class="menu-item" onclick="addToCart(${dish.dish_id}, '${dish.name}', ${dish.price})">
                <div class="dish-name">${dish.name}</div>
                <div class="dish-price">¥${dish.price}</div>
            </div>
        `).join('');
    } catch (error) {
        showToast('加载菜单失败', true);
    }
}

// 换菜功能
function openChangeDishModal() {
    if (!currentOrderId) {
        showToast('请先开台', true);
        return;
    }
    const oldSelect = document.getElementById('changeOldDetail');
    oldSelect.innerHTML = '<option value="">请选择要换掉的菜品</option>';
    currentOrderDetails.forEach(item => {
        oldSelect.innerHTML += `<option value="${item.detail_id}">${item.dish_name} ×${item.quantity}</option>`;
    });
    const newSelect = document.getElementById('changeNewDish');
    newSelect.innerHTML = '<option value="">请选择新菜品</option>';
    fetch(`${API_BASE}/dishes`, { headers: { 'token': currentToken } })
        .then(res => res.json())
        .then(dishes => {
            dishes.forEach(d => {
                newSelect.innerHTML += `<option value="${d.dish_id}">${d.name} ¥${d.price}</option>`;
            });
        });
    document.getElementById('changeDishModal').style.display = 'flex';
}

async function confirmChangeDish() {
    const oldDetailId = document.getElementById('changeOldDetail').value;
    const newDishId = document.getElementById('changeNewDish').value;
    const quantity = parseInt(document.getElementById('changeQuantity').value) || 1;
    if (!oldDetailId || !newDishId) {
        showToast('请选择完整的换菜信息', true);
        return;
    }
    try {
        const response = await apiRequest(`/orders/${currentOrderId}/change-dish`, {
            method: 'POST',
            body: JSON.stringify({
                old_detail_id: parseInt(oldDetailId),
                new_dish_id: parseInt(newDishId),
                quantity: quantity
            })
        });
        if (response.ok) {
            showToast('✅ 换菜成功');
            closeModal('changeDishModal');
            await loadCurrentOrderInfo();
        } else {
            const error = await response.json();
            showToast(error.detail || '换菜失败', true);
        }
    } catch (error) {
        showToast('换菜失败', true);
    }
}

// 拆单功能
function toggleSplitMethod() {
    const method = document.getElementById('splitMethod').value;
    document.getElementById('splitByItem').style.display = method === 'by_item' ? 'block' : 'none';
    document.getElementById('splitByAmount').style.display = method === 'by_amount' ? 'block' : 'none';
}

function openSplitOrderModal() {
    if (!currentOrderId) {
        showToast('请先开台', true);
        return;
    }
    document.getElementById('splitOrderModal').style.display = 'flex';
    toggleSplitMethod();
}

async function confirmSplitOrder() {
    const method = document.getElementById('splitMethod').value;
    let body = { split_method: method };
    if (method === 'by_item') {
        const input = document.getElementById('splitItemsInput').value;
        if (!input) { showToast('请输入菜品分配方案', true); return; }
        body.items_per_person = input.split('|').map(group =>
            group.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
        ).filter(arr => arr.length > 0);
    } else {
        const input = document.getElementById('splitAmountsInput').value;
        if (!input) { showToast('请输入金额分配方案', true); return; }
        body.amounts = input.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    }
    try {
        const response = await apiRequest(`/orders/${currentOrderId}/split`, {
            method: 'POST',
            body: JSON.stringify(body)
        });
        if (response.ok) {
            const data = await response.json();
            showToast(`✅ 拆单成功，生成${data.child_orders?.length || 0}个子订单`);
            closeModal('splitOrderModal');
            currentOrderId = null;
            currentCart = [];
            currentOrderDetails = [];
            updateCartDisplay();
            resetOrderState();
            loadTablesForSelect();
            loadTables();
        } else {
            const error = await response.json();
            showToast(error.detail || '拆单失败', true);
        }
    } catch (error) {
        showToast('拆单失败', true);
    }
}

// 并单功能
async function openMergeOrderModal() {
    document.getElementById('mergeOrderModal').style.display = 'flex';
    const select = document.getElementById('mergeTargetTable');
    const response = await apiRequest('/tables');
    const tables = await response.json();
    select.innerHTML = '<option value="">请选择目标桌台</option>';
    tables.filter(t => t.status === '空闲').forEach(t => {
        select.innerHTML += `<option value="${t.table_id}">${t.table_no}号桌 (${t.seats}人座)</option>`;
    });
}

async function confirmMergeOrder() {
    const orderIdsInput = document.getElementById('mergeOrderIds').value;
    const targetTableId = document.getElementById('mergeTargetTable').value;
    if (!orderIdsInput || !targetTableId) {
        showToast('请填写完整信息', true);
        return;
    }
    const source_order_ids = orderIdsInput.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    if (source_order_ids.length < 2) {
        showToast('至少需要2个订单才能并单', true);
        return;
    }
    try {
        const response = await apiRequest('/orders/merge', {
            method: 'POST',
            body: JSON.stringify({
                source_order_ids: source_order_ids,
                target_table_id: parseInt(targetTableId)
            })
        });
        if (response.ok) {
            const data = await response.json();
            showToast(`✅ 并单成功，新订单ID: ${data.new_order_id}`);
            closeModal('mergeOrderModal');
            currentOrderId = null;
            currentCart = [];
            currentOrderDetails = [];
            updateCartDisplay();
            resetOrderState();
            loadTablesForSelect();
            loadTables();
        } else {
            const error = await response.json();
            showToast(error.detail || '并单失败', true);
        }
    } catch (error) {
        showToast('并单失败', true);
    }
}

// 后厨管理
async function loadKitchenOrders() {
    try {
        const response = await apiRequest('/kitchen/orders');
        const orders = await response.json();
        const container = document.getElementById('kitchenOrders');
        if (!orders || orders.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">暂无待做菜品 🎉</div>';
            return;
        }
        const grouped = {};
        orders.forEach(item => {
            const key = item.table_no || '未知桌台';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(item);
        });
        container.innerHTML = Object.entries(grouped).map(([tableNo, items]) => `
            <div class="kitchen-card">
                <div class="order-header">
                    <span class="table-no">${tableNo}号桌</span>
                    <span>${items.length}道菜</span>
                </div>
                ${items.map(item => `
                    <div class="kitchen-dish">
                        <div>
                            <div class="dish-name">${item.dish_name || '未知菜品'} ×${item.quantity || 1}</div>
                            <div style="font-size:12px;color:#999;">${item.remark || ''}</div>
                        </div>
                        <button class="complete-btn" onclick="completeDish(${item.detail_id})">✅ 完成</button>
                    </div>
                `).join('')}
            </div>
        `).join('');
    } catch (error) {
        showToast('加载后厨订单失败', true);
    }
}

function refreshKitchen() { loadKitchenOrders(); }

async function completeDish(detailId) {
    try {
        const response = await apiRequest(`/kitchen/orders/${detailId}/complete`, {
            method: 'PUT'
        });
        if (response.ok) {
            showToast('✅ 菜品已完成');
            loadKitchenOrders();
            if (document.getElementById('dashboardPage').classList.contains('active')) loadDashboard();
        } else {
            showToast('操作失败', true);
        }
    } catch (error) {
        showToast('操作失败', true);
    }
}

// 结算中心
let selectedOrderId = null;
let selectedTableNo = null;

async function loadUnsettledOrders() {
    try {
        const response = await apiRequest('/tables');
        const tables = await response.json();
        const activeTables = tables.filter(t => t.status === '用餐');
        const container = document.getElementById('unsettledOrders');
        if (activeTables.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:#999;">暂无进行中订单</div>';
            return;
        }
        container.innerHTML = activeTables.map(table => `
            <div class="order-item-card" data-table-id="${table.table_id}" onclick="selectOrderForSettlement(${table.table_id}, '${table.table_no}')">
                <div style="font-weight:600;">${table.table_no}号桌</div>
                <div style="font-size:14px;color:#ed6c02;">🟡 用餐中</div>
            </div>
        `).join('');
    } catch (error) {
        showToast('加载订单失败', true);
    }
}

async function selectOrderForSettlement(tableId, tableNo) {
    try {
        const response = await apiRequest(`/orders/current/${tableId}`);
        const data = await response.json();
        if (data.has_order && data.order_id) {
            selectedOrderId = data.order_id;
            selectedTableNo = tableNo;
            document.getElementById('settleOrderNo').textContent = data.order_no || '-';
            document.getElementById('settleTableNo').textContent = tableNo;
            document.getElementById('settleTotal').textContent = `¥${data.total_amount || 0}`;
            document.getElementById('settleActual').textContent = `¥${data.actual_amount || 0}`;
            document.getElementById('settleBtn').disabled = false;
            document.querySelectorAll('.order-item-card').forEach(el => el.classList.remove('selected'));
            const target = document.querySelector(`.order-item-card[data-table-id="${tableId}"]`);
            if (target) target.classList.add('selected');
        } else {
            showToast('该桌台无进行中订单', true);
        }
    } catch (error) {
        showToast('加载订单详情失败', true);
    }
}

async function confirmSettlement() {
    if (!selectedOrderId) {
        showToast('请先选择订单', true);
        return;
    }
    const paymentMethod = document.getElementById('paymentMethod').value;
    try {
        const response = await apiRequest(`/settlement/${selectedOrderId}`, {
            method: 'POST',
            body: JSON.stringify({
                payment_method: paymentMethod,
                cashier: currentUser?.real_name || '系统'
            })
        });
        if (response.ok) {
            const data = await response.json();
            showToast(`✅ 结算成功！订单：${data.order_no}，实收：¥${data.paid_amount}`);
            selectedOrderId = null;
            document.getElementById('settleOrderNo').textContent = '-';
            document.getElementById('settleTableNo').textContent = '-';
            document.getElementById('settleTotal').textContent = '¥0';
            document.getElementById('settleActual').textContent = '¥0';
            document.getElementById('settleBtn').disabled = true;
            document.querySelectorAll('.order-item-card').forEach(el => el.classList.remove('selected'));
            loadUnsettledOrders();
            loadTables();
            if (document.getElementById('dashboardPage').classList.contains('active')) loadDashboard();
        } else {
            const error = await response.json();
            showToast(error.detail || '结算失败', true);
        }
    } catch (error) {
        showToast('结算失败', true);
    }
}

// 经营报表
async function loadDailyReport() {
    try {
        const response = await apiRequest('/statistics/daily');
        const data = await response.json();
        document.getElementById('dailyTotal').textContent = `¥${data.total_amount || 0}`;
        document.getElementById('dailyCount').textContent = data.order_count || 0;
        document.getElementById('dailyAvg').textContent = `¥${data.avg_amount || 0}`;
        const topDishes = data.top_dishes || [];
        document.getElementById('dailyTopDishes').innerHTML = topDishes.map(d =>
            `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;">
                <span>${d.name}</span>
                <span style="color:#00bf8f;">销量: ${d.quantity}</span>
            </div>`
        ).join('') || '<div style="color:#999;padding:10px;">暂无数据</div>';
    } catch (error) {
        console.error('加载日报失败', error);
    }
}

async function loadMonthlyReport() {
    const year = document.getElementById('monthYear').value || new Date().getFullYear();
    const month = document.getElementById('monthMonth').value || new Date().getMonth() + 1;
    try {
        const response = await apiRequest(`/statistics/monthly?year=${year}&month=${month}`);
        const data = await response.json();
        document.getElementById('monthlyTotal').textContent = `¥${data.total_amount || 0}`;
        document.getElementById('monthlyCount').textContent = data.order_count || 0;
        document.getElementById('monthlyAvg').textContent = `¥${data.avg_amount || 0}`;
    } catch (error) {
        showToast('加载月报失败', true);
    }
}

async function loadYearlyReport() {
    const year = document.getElementById('yearYear').value || new Date().getFullYear();
    try {
        const response = await apiRequest(`/statistics/yearly?year=${year}`);
        const data = await response.json();
        document.getElementById('yearlyTotal').textContent = `¥${data.total_amount || 0}`;
        document.getElementById('yearlyCount').textContent = data.total_orders || 0;
        document.getElementById('yearlyAvg').textContent = `¥${data.avg_amount || 0}`;
        const monthlyData = data.monthly_data || [];
        document.getElementById('monthlyChart').innerHTML = monthlyData.map(m =>
            `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;">
                <span>${m.month}月</span>
                <span style="color:#00bf8f;">¥${m.total_amount}</span>
                <span style="color:#666;">${m.order_count}单</span>
            </div>`
        ).join('') || '<div style="color:#999;padding:10px;">暂无数据</div>';
    } catch (error) {
        showToast('加载年报失败', true);
    }
}

function initReportTabs() {
    document.querySelectorAll('.report-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.report-content').forEach(content => content.classList.remove('active'));
            const target = document.getElementById(`${tab.dataset.report}Report`);
            if (target) target.classList.add('active');
            if (tab.dataset.report === 'daily') loadDailyReport();
            else if (tab.dataset.report === 'monthly') loadMonthlyReport();
            else if (tab.dataset.report === 'yearly') loadYearlyReport();
        });
    });
}

// 会员管理
async function searchMember() {
    const phone = document.getElementById('searchPhone').value;
    if (!phone) {
        showToast('请输入手机号', true);
        return;
    }
    try {
        const response = await apiRequest(`/members/${phone}`);
        if (response.ok) {
            const member = await response.json();
            document.getElementById('memberInfo').innerHTML = `
                <div style="background:#f0fdf4;border-radius:12px;padding:20px;border:1px solid #bbf7d0;">
                    <h3 style="color:#166534;">${member.name || '会员'}</h3>
                    <p>📱 手机号：${member.phone}</p>
                    <p>⭐ 积分：${member.points || 0}</p>
                    <p>🏷️ 折扣等级：${member.discount_level === 1 ? '9.5折' : member.discount_level === 2 ? '9折' : '8.5折'}</p>
                </div>
            `;
            document.getElementById('memberInfo').style.display = 'block';
        } else {
            showToast('会员不存在', true);
            document.getElementById('memberInfo').style.display = 'none';
        }
    } catch (error) {
        showToast('查询失败', true);
    }
}

async function registerMember() {
    const phone = document.getElementById('regPhone').value;
    const name = document.getElementById('regName').value;
    if (!phone || !name) {
        showToast('请填写完整信息', true);
        return;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
        showToast('请输入正确的手机号', true);
        return;
    }
    try {
        const response = await apiRequest(`/members?phone=${phone}&name=${encodeURIComponent(name)}`, {
            method: 'POST'
        });
        if (response.ok) {
            showToast('✅ 会员注册成功');
            document.getElementById('regPhone').value = '';
            document.getElementById('regName').value = '';
        } else {
            const error = await response.json();
            showToast(error.detail || '注册失败', true);
        }
    } catch (error) {
        showToast('注册失败', true);
    }
}

// 操作日志
async function loadOrderLogs() {
    const orderId = document.getElementById('logOrderId').value;
    if (!orderId) {
        showToast('请输入订单ID', true);
        return;
    }
    try {
        const response = await apiRequest(`/logs/orders/${orderId}`);
        if (response.ok) {
            const logs = await response.json();
            const container = document.getElementById('logsList');
            if (!logs || logs.length === 0) {
                container.innerHTML = '<div style="color:#999;text-align:center;padding:20px;">该订单暂无操作日志</div>';
                return;
            }
            container.innerHTML = logs.map(log => `
                <div style="padding:12px;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div><strong>${log.action}</strong></div>
                        <div style="font-size:13px;color:#666;">
                            操作人：${log.operator || '系统'} (${log.operator_role || ''})
                        </div>
                        ${log.old_data ? `<div style="font-size:12px;color:#999;">旧值：${log.old_data}</div>` : ''}
                        ${log.new_data ? `<div style="font-size:12px;color:#00bf8f;">新值：${log.new_data}</div>` : ''}
                    </div>
                    <div style="font-size:12px;color:#999;">${new Date(log.log_time).toLocaleString()}</div>
                </div>
            `).join('');
        } else {
            const error = await response.json();
            showToast(error.detail || '查询日志失败', true);
        }
    } catch (error) {
        showToast('查询日志失败', true);
    }
}

// 初始化
function init() {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (savedToken && savedUser) {
        currentToken = savedToken;
        currentUser = JSON.parse(savedUser);
        loadUserInfo();
        // 登录恢复时也应用权限
        applyRolePermissions(currentUser.role);
        document.getElementById('loginPage').classList.remove('active');
        document.getElementById('dashboardPage').classList.add('active');
        switchPage('dashboard');
    }

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        if (!username || !password) {
            showToast('请输入用户名和密码', true);
            return;
        }
        await login(username, password);
    });

    document.getElementById('logoutBtn').addEventListener('click', logout);

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            if (hasPagePermission(page)) {
                switchPage(page);
            } else {
                showToast('您没有权限访问此页面', true);
            }
        });
    });

    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadMenu(btn.dataset.category);
        });
    });

    initReportTabs();

    document.querySelectorAll('.modal .close').forEach(el => {
        el.addEventListener('click', () => {
            const modal = el.closest('.modal');
            if (modal) modal.style.display = 'none';
        });
    });
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    });

    document.getElementById('password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('loginForm').dispatchEvent(new Event('submit'));
        }
    });

    // 默认菜单先全部隐藏，登录后由 applyRolePermissions 控制
    const menus = getMenuItems();
    Object.values(menus).forEach(item => {
        if (item) item.style.display = 'none';
    });

    setTimeout(() => {
        if (document.getElementById('orderPage').classList.contains('active')) {
            loadTablesForSelect();
            loadMenu();
        }
    }, 500);
}

document.addEventListener('DOMContentLoaded', init);