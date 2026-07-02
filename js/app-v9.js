// ============================================================
// app-v9.js — Основной код приложения (Firebase 9.x)
// ============================================================

// Импортируем все нужные функции Firebase 10
import { 
    ref, set, push, onValue, update, remove, transaction, 
    onDisconnect, query, limitToLast, get 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// db доступен глобально через window.db (настроен в index.html)
const db = window.db;

// ============================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================================

// currentUser и currentUserName теперь из auth-v9.js (глобальные)
// isAdmin — будем определять по БД
let isAdmin = false;
let scheduleDate = new Date();
let scheduleMode = 'day';
let userAvatars = {};
let chatInitialized = false;
let lastChatViewTime = localStorage.getItem("lastChatView") || 0;
let currentTab = 'main';
let pendingPhotos = [];
let currentSchedRef = null;
let isGlobalParticipant = false;
let currentIp = "";
let latestPresence = {};
let latestUsers = {};
let adminListenersInitialized = false;
let avatarEditorImage = null;
let avatarScale = 1;
let avatarOffset = { x: 0, y: 0 };
let avatarDragStart = null;
let avatarMinScale = 1;
let mutedUsers = {};
let isMuted = false;
let currentBlockedIps = {};
let currentAdmins = {};
let profileViewUser = null;
let profileEditable = true;
let currentFboSuffix = "";
let currentFboMaterial = "";
let currentFboWidth = "";
let fboArticlesVisible = true;

// ============================================================
// ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ
// ============================================================

// Эта функция вызывается из auth-v9.js после успешного входа
function showApp() {
    console.log('🚀 Запуск приложения...');
    
    initTheme();
    
    // Скрываем экран входа, показываем приложение
    document.getElementById("login").style.display = "none";
    document.getElementById("app").style.display = "block";
    document.getElementById("btn-settings").style.display = "none";
    document.getElementById("adminPanel").style.display = "none";
    document.getElementById("adminUsersPanel").style.display = "none";
    
    // Определяем, является ли пользователь админом
    onValue(ref(db, "admins"), snap => {
        const admins = snap.val() || {};
        isAdmin = !!admins[currentUserName] || currentUserName.toLowerCase() === "дениска";
        
        document.getElementById("userTag").innerText = isAdmin ? "⭐" + currentUserName : "@" + currentUserName.toLowerCase();
        document.getElementById("btn-settings").style.display = isAdmin ? "inline-flex" : "none";
        document.getElementById("adminPanel").style.display = isAdmin ? "flex" : "none";
        document.getElementById("adminUsersPanel").style.display = isAdmin ? "block" : "none";
        
        if (isAdmin && !adminListenersInitialized) { 
            listenAdminUsers(); 
            adminListenersInitialized = true; 
        }
    });
    
    // Загружаем данные пользователей
    onValue(ref(db, "users"), snap => {
        latestUsers = snap.val() || {};
        userAvatars = latestUsers;
        
        const myAv = userAvatars[currentUserName]?.avatar || 
            "https://cdn-icons-png.flaticon.com/512/149/149071.png";
        document.getElementById("myAvatar").src = myAv;
        
        const profileAvatar = document.getElementById("profileAvatarPreview");
        if (profileAvatar) profileAvatar.src = myAv;
        
        renderOnlineUsers();
    });
    
    // Слушаем муты
    onValue(ref(db, "muted_users"), snap => {
        mutedUsers = snap.val() || {};
        isMuted = !!mutedUsers[currentUserName];
        renderMuteState();
        if (isAdmin) { 
            renderAdminUsers(latestUsers, currentBlockedIps, currentAdmins); 
        }
    });
    
    // Запускаем всё
    setupPresence();
    listenChat();
    renderSched();
    listenHistory();
    listenActiveShift();
    fetchAndStoreMyIp();
    
    // Закрытие контекстного меню по клику
    window.onclick = () => { 
        const menu = document.getElementById("context-menu"); 
        if (menu) menu.style.display = "none"; 
    };
    
    console.log('✅ Приложение запущено');
}

// ============================================================
// IP-АДРЕС
// ============================================================

function getMyIp() { 
    return fetch("https://api.ipify.org?format=json")
        .then(res => res.ok ? res.json() : null)
        .then(data => data?.ip || "")
        .catch(() => ""); 
}

function fetchAndStoreMyIp() { 
    return getMyIp().then(ip => { 
        currentIp = ip || ""; 
        if (currentUserName && currentIp) { 
            update(ref(db, `users/${currentUserName}`), { ip: currentIp, lastSeen: Date.now() }); 
        } 
        return currentIp; 
    }); 
}

// ============================================================
// ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
// ============================================================

function switchTab(t) {
    currentTab = t;
    ["view-main", "view-sched", "view-chat", "view-settings"].forEach(v => 
        document.getElementById(v).style.display = "none"
    );
    ["btn-main", "btn-sched", "btn-chat", "btn-settings"].forEach(b => 
        document.getElementById(b).className = "glass-btn"
    );
    
    if (document.getElementById("btn-" + t)) 
        document.getElementById("btn-" + t).className = "primary";
    
    document.getElementById("view-" + t).style.display = t === 'chat' ? 'flex' : 'block';
    
    if (t === 'chat') {
        lastChatViewTime = Date.now();
        localStorage.setItem("lastChatView", lastChatViewTime);
        updateBadge(0);
        
        get(query(ref(db, "chat_v4"), limitToLast(10))).then(snap => {
            snap.forEach(s => { 
                if (s.val().name !== currentUserName) 
                    update(ref(db, "chat_v4/" + s.key + "/readBy"), { [currentUserName]: true }); 
            });
        });
        
        setTimeout(() => { 
            const b = document.getElementById("chat-messages");
            if (b) b.scrollTop = b.scrollHeight; 
        }, 50);
    }
}

// ============================================================
// АКТИВНАЯ СМЕНА
// ============================================================

function createParticipantData(joinedAt = Date.now()) {
    return { 
        earned: 0, joinedAt, orders: 0, optOrders: 0, 
        cdekOrders: 0, wbOrders: 0, dostOrders: 0, fboOrders: 0 
    };
}

function getTotalPlaces(shift) {
    if (!shift) return 0;
    const cdekPlaces = shift.cdek_places || shift.cdek || 0;
    const wbPlaces = shift.wb || 0;
    const dostPlaces = shift.dost_places || shift.dost || 0;
    const fboPlaces = shift.fbo || 0;
    return cdekPlaces + wbPlaces + dostPlaces + fboPlaces;
}

function getOrderShare(type) { 
    return type === 'opt' ? 50 : 80; 
}

function listenActiveShift() {
    onValue(ref(db, "active_shift"), snap => {
        const shift = snap.val();
        const workDiv = document.getElementById("work");
        const startBtnCont = document.getElementById("startBtnCont");
        const joinBtn = document.getElementById("joinShiftBtn");
        const leaveBtn = document.getElementById("leaveShiftBtn");
        const closeBtn = document.getElementById("closeShiftBtn");
        const ctrls = document.querySelectorAll(".ctrl-btn");

        if (shift) {
            localStorage.setItem("active_shift_backup", JSON.stringify(shift));
            startBtnCont.style.display = "none";
            workDiv.style.display = "block";

            document.getElementById("cdek_val").innerText = shift.cdek || 0;
            document.getElementById("wb_val").innerText = shift.wb || 0;
            document.getElementById("dost_val").innerText = shift.dost || 0;
            document.getElementById("opt_val").innerText = shift.opt || 0;
            
            const fboVal = document.getElementById("fbo_val");
            if (fboVal) fboVal.innerText = shift.fbo || 0;

            document.getElementById("cdek_places_val").innerText = shift.cdek_places || shift.cdek || 0;
            document.getElementById("dost_places_val").innerText = shift.dost_places || shift.dost || 0;

            renderFboArticles(shift.fboArticles || {});

            const totalOrders = (shift.cdek || 0) + (shift.wb || 0) + (shift.dost || 0) + (shift.fbo || 0);
            const totalPlaces = getTotalPlaces(shift);
            document.getElementById("total").innerText = totalOrders;
            document.getElementById("placesDisplay").innerText = "Мест: " + totalPlaces;
            document.getElementById("optDisplay").innerText = `Оптовые: ${shift.opt || 0}`;

            const parts = shift.participants || {};
            isGlobalParticipant = parts[currentUserName] !== undefined;

            let partsText = "<b style='color:var(--accent);'>🟢 Смена в эфире:</b><br><br>";
            Object.keys(parts).forEach(p => {
                partsText += `• ${escapeHtml(p)} <span style="float:right; opacity:0.8;">${Number(parts[p].earned || 0).toFixed(0)}₽</span><br>`;
            });
            document.getElementById("shift-participants").innerHTML = partsText;

            if (isGlobalParticipant) {
                ctrls.forEach(b => b.style.display = "flex");
                setFboControlsEnabled(true);
                joinBtn.style.display = "none";
                leaveBtn.style.display = "flex";
                closeBtn.style.display = isAdmin ? "flex" : "none";
                document.getElementById("cdek_val").style.pointerEvents = "auto";
                document.getElementById("wb_val").style.pointerEvents = "auto";
                document.getElementById("dost_val").style.pointerEvents = "auto";
                document.getElementById("opt_val").style.pointerEvents = "auto";
                document.getElementById("salaryDisplay").innerText = 
                    `Моя доля: ${Number(parts[currentUserName].earned || 0).toFixed(0)}₽`;
            } else {
                ctrls.forEach(b => b.style.display = "none");
                setFboControlsEnabled(false);
                joinBtn.style.display = "flex";
                leaveBtn.style.display = "none";
                closeBtn.style.display = "none";
                document.getElementById("cdek_val").style.pointerEvents = "none";
                document.getElementById("wb_val").style.pointerEvents = "none";
                document.getElementById("dost_val").style.pointerEvents = "none";
                document.getElementById("opt_val").style.pointerEvents = "none";
                document.getElementById("salaryDisplay").innerText = "Режим Куколда 👀";
            }
        } else {
            startBtnCont.style.display = "block";
            workDiv.style.display = "none";
            isGlobalParticipant = false;
            const fboVal2 = document.getElementById("fbo_val");
            if (fboVal2) fboVal2.innerText = "0";
            renderFboArticles({});
            setFboControlsEnabled(false);
        }
    });
}

function startShift() {
    const participant = createParticipantData(Date.now());
    set(ref(db, "active_shift"), {
        startTime: Date.now(),
        cdek: 0, wb: 0, dost: 0, fbo: 0, opt: 0,
        cdek_places: 0, dost_places: 0,
        fboArticles: {},
        participants: { [currentUserName]: participant },
        allParticipants: { [currentUserName]: participant }
    });
}

function addCounter(type) {
    if (!type || !currentUserName) return;
    
    transaction(ref(db, "active_shift"), shift => {
        if (!shift || !shift.participants || !shift.participants[currentUserName]) return;
        if (!["cdek", "wb", "dost", "opt"].includes(type)) return;
        
        shift[type] = (shift[type] || 0) + 1;
        if (type === 'cdek') shift.cdek_places = (shift.cdek_places || 0) + 1;
        if (type === 'dost') shift.dost_places = (shift.dost_places || 0) + 1;
        
        const parts = Object.keys(shift.participants);
        const share = getOrderShare(type) / parts.length;
        const orderIncrement = parts.length === 1 ? 1 : 1 / parts.length;
        
        parts.forEach(p => {
            const part = shift.participants[p] = shift.participants[p] || createParticipantData();
            part.earned = (part.earned || 0) + share;
            part.orders = (part.orders || 0) + orderIncrement;
            if (type === 'opt') part.optOrders = (part.optOrders || 0) + orderIncrement;
            else if (type === 'cdek') part.cdekOrders = (part.cdekOrders || 0) + orderIncrement;
            else if (type === 'wb') part.wbOrders = (part.wbOrders || 0) + orderIncrement;
            else if (type === 'dost') part.dostOrders = (part.dostOrders || 0) + orderIncrement;
        });
        return shift;
    });
}

function removeCounter(type) {
    if (!type || !currentUserName) return;
    
    transaction(ref(db, "active_shift"), shift => {
        if (!shift || !shift.participants || !shift.participants[currentUserName] || !shift[type] || shift[type] <= 0) return;
        if (!["cdek", "wb", "dost", "opt"].includes(type)) return;
        
        shift[type]--;
        if (type === 'cdek') shift.cdek_places = Math.max(0, (shift.cdek_places || 0) - 1);
        if (type === 'dost') shift.dost_places = Math.max(0, (shift.dost_places || 0) - 1);
        
        const parts = Object.keys(shift.participants);
        const share = getOrderShare(type) / parts.length;
        const orderDecrement = parts.length === 1 ? 1 : 1 / parts.length;
        
        parts.forEach(p => {
            const part = shift.participants[p];
            if (!part) return;
            part.earned = Math.max(0, (part.earned || 0) - share);
            part.orders = Math.max(0, (part.orders || 0) - orderDecrement);
            if (type === 'opt') part.optOrders = Math.max(0, (part.optOrders || 0) - orderDecrement);
            else if (type === 'cdek') part.cdekOrders = Math.max(0, (part.cdekOrders || 0) - orderDecrement);
            else if (type === 'wb') part.wbOrders = Math.max(0, (part.wbOrders || 0) - orderDecrement);
            else if (type === 'dost') part.dostOrders = Math.max(0, (part.dostOrders || 0) - orderDecrement);
        });
        return shift;
    });
}

function manualInput(type) {
    if (!isGlobalParticipant) return;
    
    get(ref(db, "active_shift")).then(snap => {
        const shift = snap.val();
        if (!shift || !shift.participants || !shift.participants[currentUserName]) return;
        
        let currentVal = shift[type] || 0;
        let v = prompt("Введи новое количество заказов для " + type.toUpperCase() + ":", currentVal);
        if (v && !isNaN(v)) {
            let newVal = Math.max(0, parseInt(v));
            let diff = newVal - currentVal;
            
            if (diff !== 0) {
                transaction(ref(db, "active_shift"), s => {
                    if (!s || !s.participants || !s.participants[currentUserName]) return;
                    
                    const oldCdekPlaces = s.cdek_places || s.cdek || 0;
                    const oldDostPlaces = s.dost_places || s.dost || 0;
                    s[type] = newVal;
                    if (type === 'cdek') s.cdek_places = Math.max(0, oldCdekPlaces + diff);
                    if (type === 'dost') s.dost_places = Math.max(0, oldDostPlaces + diff);
                    
                    const parts = Object.keys(s.participants);
                    const share = (diff * getOrderShare(type)) / parts.length;
                    const orderDelta = parts.length === 1 ? diff : diff / parts.length;
                    
                    parts.forEach(p => {
                        const part = s.participants[p] = s.participants[p] || createParticipantData();
                        part.earned = Math.max(0, (part.earned || 0) + share);
                        part.orders = Math.max(0, (part.orders || 0) + orderDelta);
                        if (type === 'opt') part.optOrders = Math.max(0, (part.optOrders || 0) + orderDelta);
                        else if (type === 'cdek') part.cdekOrders = Math.max(0, (part.cdekOrders || 0) + orderDelta);
                        else if (type === 'wb') part.wbOrders = Math.max(0, (part.wbOrders || 0) + orderDelta);
                        else if (type === 'dost') part.dostOrders = Math.max(0, (part.dostOrders || 0) + orderDelta);
                    });
                    return s;
                });
            }
        }
    });
}

// ============================================================
// МЕСТА (places)
// ============================================================

function addPlace(type) {
    if (!type || !currentUserName || !isGlobalParticipant) return;
    if (type !== 'cdek' && type !== 'dost') return;
    const placeField = type + '_places';
    
    transaction(ref(db, "active_shift"), shift => {
        if (!shift || !shift.participants || !shift.participants[currentUserName]) return;
        shift[placeField] = (shift[placeField] || 0) + 1;
        return shift;
    });
}

function removePlace(type) {
    if (!type || !currentUserName || !isGlobalParticipant) return;
    if (type !== 'cdek' && type !== 'dost') return;
    const placeField = type + '_places';
    
    transaction(ref(db, "active_shift"), shift => {
        if (!shift || !shift.participants || !shift.participants[currentUserName]) return;
        if (!shift[placeField] || shift[placeField] <= 0) return;
        shift[placeField]--;
        return shift;
    });
}

function manualInputPlaces(type) {
    if (!isGlobalParticipant || (type !== 'cdek' && type !== 'dost')) return;
    const placeField = type + '_places';
    
    get(ref(db, "active_shift")).then(snap => {
        const shift = snap.val();
        if (!shift || !shift.participants || !shift.participants[currentUserName]) return;
        
        let currentVal = shift[placeField] || 0;
        let v = prompt("Введи новое количество мест для " + type.toUpperCase() + ":", currentVal);
        if (v && !isNaN(v)) {
            let newVal = Math.max(0, parseInt(v));
            set(ref(db, `active_shift/${placeField}`), newVal);
        }
    });
}

// ============================================================
// ФБО
// ============================================================

function selectFboOption(type, value) {
    if (!isGlobalParticipant) return;
    
    if (type === 'suffix') {
        currentFboSuffix = value;
        document.getElementById('fboBtnS').className = value === 'S' ? 'primary fbo-control' : 'glass-btn fbo-control';
        document.getElementById('fboBtnF').className = value === 'F' ? 'primary fbo-control' : 'glass-btn fbo-control';
        document.getElementById('fboLabelSuffix').innerText = value;
    } else if (type === 'material') {
        currentFboMaterial = value;
        document.getElementById('fboBtnZinc').className = value === 'ЦИНК' ? 'primary fbo-control' : 'glass-btn fbo-control';
        document.getElementById('fboBtnHks').className = value === 'ХКС' ? 'primary fbo-control' : 'glass-btn fbo-control';
        document.getElementById('fboLabelMaterial').innerText = value;
    } else if (type === 'width') {
        currentFboWidth = value;
        document.getElementById('fboBtn1mm').className = value === '1 ММ' ? 'primary fbo-control' : 'glass-btn fbo-control';
        document.getElementById('fboBtn15mm').className = value === '1,5 ММ' ? 'primary fbo-control' : 'glass-btn fbo-control';
        document.getElementById('fboLabelWidth').innerText = value;
    }
    
    const input = document.getElementById('fboArticleInput');
    if (input) input.focus();
}

function setFboControlsEnabled(enabled) {
    document.querySelectorAll('.fbo-control').forEach(el => {
        el.disabled = !enabled;
        el.style.opacity = enabled ? '1' : '0.55';
        el.style.pointerEvents = enabled ? 'auto' : 'none';
    });
}

function normalizeFboArticles(fboArticles) {
    if (!fboArticles) return [];
    return Object.entries(fboArticles).map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => (a.at || 0) - (b.at || 0));
}

function renderFboArticles(fboArticles) {
    const list = document.getElementById('fboArticlesList');
    const counter = document.getElementById('fboArticlesCount');
    if (!list) return;
    
    const articles = normalizeFboArticles(fboArticles);
    if (counter) counter.innerText = articles.length;
    
    if (!articles.length) {
        list.innerHTML = `<div style="font-size:12px; color:var(--text-secondary); opacity:0.6; padding:8px;">Список пуст</div>`;
        return;
    }
    
    list.innerHTML = articles.map(item => {
        const fullArt = escapeHtml(item.fullArticle || '');
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(99,102,241,0.04); border-radius:10px; border:1px solid var(--border);">
            <div style="font-weight:800; color:var(--text); font-size:13px; word-break:break-all;">${fullArt}</div>
            <button class="danger" style="padding:4px 8px; font-size:11px; box-shadow:none; flex-shrink:0; margin-left:8px;" onclick="removeFboArticle('${escapeJsString(item.key)}')">✕</button>
        </div>`;
    }).join('');
}

function handleFboArticleKey(event) { 
    if (event.key === 'Enter') { event.preventDefault(); addFboArticle(); } 
}

function addFboArticle() {
    if (!currentUserName || !isGlobalParticipant) return;
    
    const input = document.getElementById('fboArticleInput');
    const rawArticle = (input?.value || '').trim();
    if (!rawArticle) return;
    if (!currentFboSuffix) { alert('Выберите размер (S или F)'); return; }
    if (!currentFboMaterial) { alert('Выберите металл (Цинк или ХКС)'); return; }
    if (!currentFboWidth) { alert('Выберите ширину (1 мм или 1,5 мм)'); return; }
    
    const fullArticle = `${rawArticle}${currentFboSuffix} ${currentFboMaterial} ${currentFboWidth}`;
    const articleId = push(ref(db, 'active_shift/fboArticles')).key;
    
    transaction(ref(db, 'active_shift'), shift => {
        if (!shift || !shift.participants || !shift.participants[currentUserName]) return;
        
        const participants = Object.keys(shift.participants);
        const share = 80 / participants.length;
        const inc = participants.length === 1 ? 1 : 1 / participants.length;
        
        shift.fbo = (shift.fbo || 0) + 1;
        if (!shift.fboArticles) shift.fboArticles = {};
        shift.fboArticles[articleId] = { 
            fullArticle, suffix: currentFboSuffix, material: currentFboMaterial,
            width: currentFboWidth, share, orderIncrement: inc, 
            participants: participants.reduce((acc, n) => { acc[n] = true; return acc; }, {}), 
            by: currentUserName, at: Date.now() 
        };
        
        participants.forEach(name => {
            const part = shift.participants[name];
            part.earned = (part.earned || 0) + share;
            part.orders = (part.orders || 0) + inc;
            part.fboOrders = (part.fboOrders || 0) + inc;
        });
        return shift;
    }).then(() => { if (input) input.value = ''; });
}

function removeFboArticle(articleId) {
    if (!articleId) return;
    
    transaction(ref(db, 'active_shift'), shift => {
        if (!shift || !shift.fboArticles || !shift.fboArticles[articleId]) return shift;
        
        const item = shift.fboArticles[articleId];
        const affected = item.participants ? Object.keys(item.participants) : Object.keys(shift.participants);
        
        shift.fbo = Math.max(0, (shift.fbo || 0) - 1);
        affected.forEach(name => {
            const part = shift.participants[name] || shift.allParticipants[name];
            if (part) {
                part.earned = Math.max(0, (part.earned || 0) - (item.share || 0));
                part.orders = Math.max(0, (part.orders || 0) - (item.orderIncrement || 0));
                part.fboOrders = Math.max(0, (part.fboOrders || 0) - (item.orderIncrement || 0));
            }
        });
        delete shift.fboArticles[articleId];
        return shift;
    });
}

function toggleFboArticles() {
    const wrapper = document.getElementById('fboArticlesWrapper');
    const arrow = document.getElementById('fboToggleArrow');
    if (!wrapper || !arrow) return;
    
    fboArticlesVisible = !fboArticlesVisible;
    wrapper.style.maxHeight = fboArticlesVisible ? '250px' : '0';
    wrapper.style.opacity = fboArticlesVisible ? '1' : '0';
    arrow.style.transform = fboArticlesVisible ? 'rotate(0deg)' : 'rotate(-90deg)';
}

// ============================================================
// JOIN / LEAVE / CLOSE SHIFT
// ============================================================

function joinShift() {
    if (!currentUserName) { alert("Ошибка: пользователь не авторизован"); return; }
    
    get(ref(db, "active_shift/participants")).then(snap => {
        const participants = snap.val() || {};
        const creator = Object.keys(participants)[0];
        
        if (!creator) {
            alert("Нет активной смены для присоединения.");
            return;
        }
        if (participants[currentUserName]) {
            alert("Вы уже участвуете в этой смене.");
            return;
        }
        
        const requestRef = ref(db, `join_requests/${creator}/${currentUserName}`);
        set(requestRef, { requester: currentUserName, timestamp: Date.now() });
        alert("Запрос на присоединение отправлен.");
        listenForJoinResponse(creator);
    });
}

function listenForJoinResponse(creator) {
    const responseRef = ref(db, `join_responses/${currentUserName}`);
    
    onValue(responseRef, snap => {
        const response = snap.val();
        if (response) {
            // Отписываемся
            // (в 9.x нет .off() так просто, используем флаг)
            if (response.approved) {
                get(ref(db, "active_shift")).then(snap => {
                    const shift = snap.val() || {};
                    if (!shift.startTime) { alert("Ошибка: нет активной смены"); return; }
                    
                    const participantData = createParticipantData(Date.now());
                    update(ref(db), {
                        [`active_shift/participants/${currentUserName}`]: participantData,
                        [`active_shift/allParticipants/${currentUserName}`]: participantData
                    });
                });
                alert("Ваш запрос одобрен!");
            } else {
                alert("Вам отказано в присоединении к смене.");
            }
            
            remove(responseRef);
            remove(ref(db, `join_requests/${creator}/${currentUserName}`));
        }
    });
}

function leaveShift() {
    if (!currentUserName) { alert("Ошибка: пользователь не авторизован"); return; }
    
    get(ref(db, "active_shift")).then(snap => {
        const shift = snap.val();
        if (!shift || !shift.participants || !shift.participants[currentUserName]) return;
        
        const currentMember = shift.participants[currentUserName];
        const myEarned = currentMember.earned || 0;
        const cdekCount = shift.cdek || 0, wbCount = shift.wb || 0, 
              dostCount = shift.dost || 0, optCount = shift.opt || 0, fboCount = shift.fbo || 0;
        const totalCount = cdekCount + wbCount + dostCount + fboCount;
        const totalPlaces = getTotalPlaces(shift);
        const startT = new Date(shift.startTime || Date.now()), endT = new Date();
        
        const reportText = `<b>Вы вышли со смены!</b><br><br>Общая статистика смены:<br>Заказы: ${totalCount} | Мест: ${totalPlaces} | ФБО: ${fboCount} | Оптовые: ${optCount}<br><br><span style="color:var(--accent); font-weight:800; font-size:22px;">Твоя доля: ${myEarned.toFixed(0)}₽</span><br><br><span style="font-size:12px; color:#888;">${startT.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})} - ${endT.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})}</span>`;
        
        document.getElementById("reportDetails").innerHTML = reportText;
        document.getElementById("reportModal").style.display = "flex";
        
        const allParticipants = { ...(shift.allParticipants || {}), ...(shift.participants || {}) };
        allParticipants[currentUserName] = currentMember;
        
        const participantCount = Object.keys(shift.participants).length;
        
        if (participantCount <= 1) {
            const numParts = Object.keys(allParticipants).length;
            const totalSalary = Object.values(allParticipants).reduce((sum, p) => sum + Number(p?.earned || 0), 0);
            const newRef = push(ref(db, "shifts"));
            
            set(newRef, {
                date: startT.toLocaleDateString(),
                total: totalCount, cdek: cdekCount, wb: wbCount, dost: dostCount, fbo: fboCount, opt: optCount,
                cdek_places: shift.cdek_places || cdekCount, dost_places: shift.dost_places || dostCount,
                total_places: totalPlaces,
                fboArticles: JSON.parse(JSON.stringify(shift.fboArticles || {})),
                totalSalary, numParticipants: numParts,
                participants: JSON.parse(JSON.stringify(allParticipants)),
                start: startT.toLocaleString(), end: endT.toLocaleString(),
                startTime: shift.startTime, endTime: Date.now(),
                closedBy: currentUserName, closedAt: Date.now()
            }).then(() => { 
                remove(ref(db, "active_shift"));
                openSurveyModal(newRef.key); 
            });
        } else {
            update(ref(db), {
                "active_shift/allParticipants": allParticipants,
                [`active_shift/participants/${currentUserName}`]: null
            });
        }
    });
}

function closeShift() {
    if (!currentUserName || !isAdmin) return;
    if (!confirm("Закрыть смену для всех?")) return;
    
    get(ref(db, "active_shift")).then(snap => {
        const shift = snap.val();
        if (!shift || !shift.participants) return;
        
        const startT = new Date(shift.startTime || Date.now()), endT = new Date();
        const cdekCount = shift.cdek || 0, wbCount = shift.wb || 0, 
              dostCount = shift.dost || 0, optCount = shift.opt || 0, fboCount = shift.fbo || 0;
        const totalCount = cdekCount + wbCount + dostCount + fboCount;
        const totalPlaces = getTotalPlaces(shift);
        const allParticipants = { ...(shift.allParticipants || {}), ...(shift.participants || {}) };
        const numParts = Object.keys(allParticipants).length;
        const totalSalary = Object.values(allParticipants).reduce((sum, p) => sum + Number(p?.earned || 0), 0);
        
        const reportText = `<b>Смена закрыта!</b><br><br>Общая статистика смены:<br>Заказы: ${totalCount} | Мест: ${totalPlaces} | ФБО: ${fboCount} | Оптовые: ${optCount}<br><br><span style="color:var(--accent); font-weight:800; font-size:20px;">Общий заработок: ${Math.round(totalSalary)}₽</span><br><br><span style="font-size:12px; color:#888;">${startT.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})} - ${endT.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})}</span>`;
        
        document.getElementById("reportDetails").innerHTML = reportText;
        document.getElementById("reportModal").style.display = "flex";
        
        const now = new Date();
        const archiveKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}_${Date.now()}`;
        
        set(ref(db, `shifts/${archiveKey}`), {
            date: startT.toLocaleDateString(),
            total: totalCount, cdek: cdekCount, wb: wbCount, dost: dostCount, fbo: fboCount, opt: optCount,
            cdek_places: shift.cdek_places || cdekCount, dost_places: shift.dost_places || dostCount,
            total_places: totalPlaces,
            fboArticles: JSON.parse(JSON.stringify(shift.fboArticles || {})),
            totalSalary, numParticipants: numParts,
            participants: JSON.parse(JSON.stringify(allParticipants)),
            start: startT.toLocaleString(), end: endT.toLocaleString(),
            startTime: shift.startTime, endTime: Date.now(),
            closedBy: currentUserName, closedAt: Date.now()
        }).then(() => {
            remove(ref(db, "active_shift"));
            alert("✅ Смена закрыта и сохранена в архив");
            openSurveyModal(archiveKey);
        });
    });
}

function closeShiftFromAdmin() {
    if (!isAdmin) return;
    if (!confirm("Закрыть активную смену для всех?")) return;
    
    get(ref(db, "active_shift")).then(snap => {
        const shift = snap.val();
        if (!shift || !shift.participants) { alert("Смена уже закрыта"); return; }
        
        const startT = new Date(shift.startTime || Date.now()), endT = new Date();
        const cdekCount = shift.cdek || 0, wbCount = shift.wb || 0, 
              dostCount = shift.dost || 0, optCount = shift.opt || 0, fboCount = shift.fbo || 0;
        const totalCount = cdekCount + wbCount + dostCount + fboCount;
        const totalPlaces = getTotalPlaces(shift);
        const allParticipants = { ...(shift.allParticipants || {}), ...(shift.participants || {}) };
        const numParts = Object.keys(allParticipants).length;
        const totalSalary = Object.values(allParticipants).reduce((sum, p) => sum + Number(p?.earned || 0), 0);
        
        const now = new Date();
        const archiveKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}_${Date.now()}`;
        
        set(ref(db, `shifts/${archiveKey}`), {
            date: startT.toLocaleDateString(),
            total: totalCount, cdek: cdekCount, wb: wbCount, dost: dostCount, fbo: fboCount, opt: optCount,
            cdek_places: shift.cdek_places || cdekCount, dost_places: shift.dost_places || dostCount,
            total_places: totalPlaces,
            fboArticles: JSON.parse(JSON.stringify(shift.fboArticles || {})),
            totalSalary, numParticipants: numParts,
            participants: JSON.parse(JSON.stringify(allParticipants)),
            start: startT.toLocaleString(), end: endT.toLocaleString(),
            startTime: shift.startTime, endTime: Date.now(),
            closedBy: currentUserName, closedAt: Date.now()
        }).then(() => {
            remove(ref(db, "active_shift"));
            alert("✅ Смена закрыта админом и сохранена в архив");
            openSurveyModal(archiveKey);
        });
    });
}

// ============================================================
// ОПРОС ПОСЛЕ СМЕНЫ
// ============================================================

let surveyState = { problems: false, report: false };
let surveyPhoto = null;
let pendingShiftKey = null;

function toggleSurveyCheck(type) {
    surveyState[type] = !surveyState[type];
    const box = document.getElementById(type === 'problems' ? 'surveyProblemsBox' : 'surveyReportBox');
    if (surveyState[type]) { 
        box.innerText = '✓'; box.style.background = 'var(--accent)'; box.style.color = 'white'; 
    } else { 
        box.innerText = ''; box.style.background = 'transparent'; box.style.color = 'var(--accent)'; 
    }
}

function setWorkersCount(n) {
    for (let i = 1; i <= 4; i++) {
        const b = document.getElementById('surveyCntBtn' + i);
        if (b) b.className = (i === n) ? 'primary' : 'glass-btn';
    }
    const wrap = document.getElementById('surveyWorkersInputs');
    let html = '';
    for (let i = 1; i <= n; i++) {
        html += `<input class="survey-worker" placeholder="Имя ${i}" style="width:100%; padding:12px; border-radius:12px; border:1px solid var(--border); background:white; color:var(--text); font-size:14px;">`;
    }
    wrap.innerHTML = html;
}

function prepareSurveyPhoto(input) {
    const f = input.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = e => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            const max = 1000;
            let w = img.width, h = img.height;
            if (w > h && w > max) { h *= max / w; w = max; } 
            else if (h > max) { w *= max / h; h = max; }
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            surveyPhoto = c.toDataURL('image/jpeg', 0.7);
            document.getElementById('surveyPhotoImg').src = surveyPhoto;
            document.getElementById('surveyPhotoPreview').style.display = 'block';
        };
        img.src = e.target.result;
    };
    r.readAsDataURL(f);
}

function removeSurveyPhoto() {
    surveyPhoto = null;
    document.getElementById('surveyPhotoPreview').style.display = 'none';
    document.getElementById('surveyPhotoInp').value = '';
}

function openSurveyModal(shiftKey) {
    pendingShiftKey = shiftKey;
    surveyState = { problems: false, report: false };
    surveyPhoto = null;
    document.getElementById('surveyProblemsBox').innerText = '';
    document.getElementById('surveyProblemsBox').style.background = 'transparent';
    document.getElementById('surveyProblemsBox').style.color = 'var(--accent)';
    document.getElementById('surveyReportBox').innerText = '';
    document.getElementById('surveyReportBox').style.background = 'transparent';
    document.getElementById('surveyReportBox').style.color = 'var(--accent)';
    document.getElementById('surveyBoxes').value = '';
    document.getElementById('surveyWorkersInputs').innerHTML = '';
    for (let i = 1; i <= 4; i++) { 
        const b = document.getElementById('surveyCntBtn' + i); 
        if (b) b.className = 'glass-btn'; 
    }
    removeSurveyPhoto();
    document.getElementById('surveyModal').style.display = 'flex';
}

function buildSurveyText(problems, report, boxes, workers) {
    let line1;
    if (problems && report) line1 = "Заявки в проблемы кидал, отчет печатал.";
    else if (problems && !report) line1 = "Заявки в проблемы кидал, отчет не печатал.";
    else if (!problems && report) line1 = "Заявки в проблемы не кидал, отчет печатал.";
    else line1 = "Заявки в проблемы не кидал, отчет не печатал.";
    
    let line2 = (boxes && parseInt(boxes) > 0) ? `Упаковали ${parseInt(boxes)} коробок на ВБ.` : "Коробки на вб не упаковывали.";
    let line3 = workers.length ? ("Работали " + workers.join(", ") + ".") : "";
    
    return [line1, line2, line3].filter(Boolean).join("\n");
}

function submitSurvey() {
    if (!pendingShiftKey) { document.getElementById('surveyModal').style.display = 'none'; return; }
    
    const boxes = document.getElementById('surveyBoxes').value;
    const workers = Array.from(document.querySelectorAll('.survey-worker'))
        .map(i => i.value.trim()).filter(Boolean);
    const surveyText = buildSurveyText(surveyState.problems, surveyState.report, boxes, workers);
    
    const surveyData = {
        problems: surveyState.problems, report: surveyState.report,
        wbBoxes: boxes ? parseInt(boxes) : 0, workers: workers,
        text: surveyText, photo: surveyPhoto || null,
        filledBy: currentUserName, at: Date.now()
    };
    
    set(ref(db, `shifts/${pendingShiftKey}/survey`), surveyData)
        .then(() => { document.getElementById('surveyModal').style.display = 'none'; pendingShiftKey = null; })
        .catch(err => { alert("Ошибка сохранения: " + err.message); });
}

function skipSurvey() {
    document.getElementById('surveyModal').style.display = 'none';
    pendingShiftKey = null;
}

// ============================================================
// ИСТОРИЯ СМЕН
// ============================================================

function toggleHistory() { 
    const h = document.getElementById("history");
    h.style.display = h.style.display === "none" ? "block" : "none"; 
}

function listenHistory() {
    const historyBox = document.getElementById("history");
    if (!historyBox) return;
    
    const shiftsQuery = query(ref(db, "shifts"), limitToLast(15));
    onValue(shiftsQuery, snap => {
        let html = "";
        snap.forEach(s => {
            const d = s.val() || {};
            const fboArticles = normalizeFboArticles(d.fboArticles || {});
            const cdekPlaces = d.cdek_places || d.cdek || 0;
            const dostPlaces = d.dost_places || d.dost || 0;
            const wbCount = d.wb || 0;
            const fboCount = d.fbo || 0;
            const totalPlaces = d.total_places || (cdekPlaces + wbCount + dostPlaces + fboCount);
            
            const placesDetailHtml = `
                <div style="margin-top:8px;"><b>Места:</b></div>
                <div>СДЭК: ${cdekPlaces} мест</div>
                <div>ВБ/ОЗОН: ${wbCount} мест</div>
                <div>ФБО: ${fboCount} мест</div>
                <div>Доставка: ${dostPlaces} мест</div>
                <div style="margin-top:4px; font-weight:700;">Всего мест: ${totalPlaces}</div>`;
            
            const fboArticlesHtml = fboArticles.length ? 
                `<div style="margin-top:10px;"><b>Артикулы ФБО:</b><div style="margin-top:6px; display:flex; flex-direction:column; gap:5px;">${fboArticles.map(item => `<div style="padding:6px 8px; background:rgba(99,102,241,0.06); border-radius:8px;"><b>${escapeHtml(item.fullArticle || '')}</b>${item.by ? ` <span style="opacity:0.65;">от ${escapeHtml(item.by)}</span>` : ''}</div>`).join("")}</div></div>` : '';
            
            const surveyHtml = d.survey ? `
                <div style="margin-top:10px; padding:10px; background:rgba(16,185,129,0.08); border-radius:8px; border:1px solid rgba(16,185,129,0.2);">
                    <b>📝 Отчёт по смене:</b>
                    <div style="margin-top:6px; white-space:pre-line; line-height:1.5;">${escapeHtml(d.survey.text || '')}</div>
                    ${d.survey.photo ? `<img src="${d.survey.photo}" style="width:100%; border-radius:8px; margin-top:8px; cursor:pointer;" onclick="openFullImg('${d.survey.photo}')">` : ''}
                    ${d.survey.filledBy ? `<div style="margin-top:6px; font-size:11px; opacity:0.65;">Заполнил: ${escapeHtml(d.survey.filledBy)}</div>` : ''}
                </div>` : '';
            
            const detailsHtml = `
                <div><b>📊 Заказы:</b></div>
                <div>СДЭК: ${d.cdek || 0} заказов / ${cdekPlaces} мест</div>
                <div>ВБ/ОЗОН: ${wbCount} заказов / мест</div>
                <div>ФБО: ${fboCount} заказов / мест</div>
                <div>Доставка: ${d.dost || 0} заказов / ${dostPlaces} мест</div>
                <div style="margin-top:4px;"><b>Заказы: ${d.total || 0}</b></div>
                ${placesDetailHtml} ${fboArticlesHtml} ${surveyHtml}`;
            
            const dateLabel = escapeHtml(d.date || "без даты");
            const startPart = d.start && String(d.start).includes(",") ? String(d.start).split(",")[1].trim() : "";
            const endPart = d.end && String(d.end).includes(",") ? String(d.end).split(",")[1].trim() : "";
            const timeLabel = startPart || endPart ? `${startPart}${startPart && endPart ? " - " : ""}${endPart}` : "";
            
            const deleteButton = isAdmin ? 
                `<button class="danger" style="position:absolute; right:10px; top:10px; padding:5px 10px; z-index:2;" onclick="event.stopPropagation(); if(confirm('Удалить смену из истории?')) remove(ref(db, 'shifts/${escapeJsString(s.key)}'));">×</button>` : "";
            
            html = `<div class="card history-card" style="padding:15px; text-align:left;" onclick="toggleShiftDetails(this)">
                <div style="padding-bottom:32px;"><div><b style="font-size:16px;">Смена ${dateLabel}</b></div></div>
                <div style="margin:8px 0; font-size:14px; color:var(--text-secondary);">Общий заработок: <span style="color:var(--accent); font-weight:800; font-size:18px;">${Math.round(Number(d.totalSalary || 0))}₽</span></div>
                <div style="margin:4px 0; font-size:13px; color:var(--text-secondary);">Заказов: ${d.total || 0} | Мест: ${totalPlaces}</div>
                <div class="history-details" style="display:none; padding:8px; background:rgba(99,102,241,0.04); border-radius:8px; font-size:13px;">${detailsHtml}</div>
                ${deleteButton}
                <div class="history-arrow">▼</div>
                ${timeLabel ? `<small style="opacity:0.6; display:block; margin-top:8px;">${escapeHtml(timeLabel)}</small>` : ''}
                <button class="export-btn" style="margin-top:10px; width:100%;" onclick="event.stopPropagation(); exportShiftToImage(${JSON.stringify(d).replace(/"/g, '&quot;')})">📊 Скачать отчёт (PNG)</button>
            </div>` + html;
        });
        
        historyBox.innerHTML = html || `<div class="card" style="text-align:center; color:var(--text-secondary);">Истории смен пока нет</div>`;
    });
}

function toggleShiftDetails(card) {
    const details = card.querySelector('.history-details');
    const arrow = card.querySelector('.history-arrow');
    if (!details || !arrow) return;
    
    const expanded = details.style.display === 'block';
    details.style.display = expanded ? 'none' : 'block';
    card.classList.toggle('expanded', !expanded);
    arrow.textContent = expanded ? '▼' : '▲';
}

// ============================================================
// ЧАТ
// ============================================================

function listenChat() {
    const box = document.getElementById("chat-messages");
    if (!box) return;
    
    const chatQuery = query(ref(db, "chat_v4"), limitToLast(30));
    onValue(chatQuery, snap => {
        if (!box) return;
        box.innerHTML = "";
        let unread = 0;
        const msgs = [];
        
        snap.forEach(s => { 
            const m = s.val(); 
            if (m && m.name && m.time) { 
                msgs.push({ key: s.key, msg: m }); 
                if (m.time > lastChatViewTime && m.name !== currentUserName) unread++; 
            } 
        });
        
        msgs.forEach(({ key, msg }) => appendMsgUI(key, msg, false));
        
        if (currentTab !== 'chat') updateBadge(unread);
        if (!chatInitialized) { 
            setTimeout(() => { if (box) box.scrollTop = box.scrollHeight; }, 0); 
            chatInitialized = true; 
        }
        
        if (currentTab === 'chat') {
            get(query(ref(db, "chat_v4"), limitToLast(1))).then(snap => {
                snap.forEach(s => { 
                    if (s.val() && s.val().name !== currentUserName) 
                        update(ref(db, "chat_v4/" + s.key + "/readBy"), { [currentUserName]: true }); 
                });
            });
        }
    });
}

function appendMsgUI(key, m, scroll) {
    const box = document.getElementById("chat-messages");
    const isMe = m.name === currentUserName;
    const wrapper = document.createElement("div");
    wrapper.className = `msg-wrapper ${isMe ? "me-wrapper" : ""}`;
    wrapper.dataset.key = key;
    
    const av = userAvatars[m.name]?.avatar || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
    const time = formatChatTimestamp(m.time);
    let ticks = "✓";
    if (m.readBy && Object.keys(m.readBy).length > 0) ticks = "✓✓";
    const tickClass = ticks === "✓✓" ? "read" : "";
    
    const avatarImg = document.createElement("img");
    avatarImg.className = "avatar";
    avatarImg.style.width = "28px"; avatarImg.style.height = "28px";
    avatarImg.src = av;
    wrapper.appendChild(avatarImg);
    
    const msg = document.createElement("div");
    msg.className = `msg ${isMe ? "me" : "others"}`;
    
    const isSenderAdmin = String(m.name).toLowerCase() === "дениска";
    const userLabel = document.createElement("small");
    userLabel.style.cssText = "font-size:11px; font-weight:700; opacity:0.9; display:flex; align-items:center; gap:6px;";
    userLabel.textContent = m.name;
    if (isSenderAdmin) { 
        const adminTag = document.createElement("span");
        adminTag.style.cssText = "font-size:10px; color:#6366f1; text-transform:uppercase; letter-spacing:0.05em; font-weight:600;";
        adminTag.textContent = "⭐";
        userLabel.appendChild(adminTag); 
    }
    msg.appendChild(userLabel);
    
    if (m.images && Array.isArray(m.images)) {
        const gallery = document.createElement("div");
        gallery.style.cssText = "display:grid; grid-template-columns:repeat(auto-fit,minmax(80px,1fr)); gap:4px; margin:5px 0;";
        m.images.forEach(src => { 
            const img = document.createElement("img");
            img.src = src;
            img.style.cssText = "width:100%; border-radius:10px; cursor:pointer;";
            img.addEventListener("click", () => openFullImg(src));
            gallery.appendChild(img); 
        });
        msg.appendChild(gallery);
    }
    
    const textEl = document.createElement("div");
    textEl.textContent = m.text || "";
    msg.appendChild(textEl);
    
    const info = document.createElement("div");
    info.className = "msg-info";
    const timeSpan = document.createElement("span");
    timeSpan.textContent = time;
    info.appendChild(timeSpan);
    
    if (isMe) { 
        const tickSpan = document.createElement("span");
        tickSpan.className = `ticks ${tickClass}`;
        tickSpan.textContent = ticks;
        info.appendChild(tickSpan); 
    }
    msg.appendChild(info);
    
    let longPressTimer = null;
    const startLongPress = () => { 
        if (!isAdmin) return;
        longPressTimer = setTimeout(() => { 
            if (confirm('Удалить сообщение?')) { remove(ref(db, 'chat_v4/' + key)); } 
        }, 700); 
    };
    const cancelLongPress = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
    
    wrapper.addEventListener('touchstart', startLongPress);
    wrapper.addEventListener('touchend', cancelLongPress);
    wrapper.addEventListener('touchmove', cancelLongPress);
    wrapper.addEventListener('touchcancel', cancelLongPress);
    msg.addEventListener("contextmenu", e => showCtx(e, key, m.name));
    wrapper.appendChild(msg);
    wrapper.classList.add('enter');
    box.appendChild(wrapper);
    requestAnimationFrame(() => wrapper.classList.remove('enter'));
    if (scroll) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
}

async function preparePhotos(input) {
    const files = Array.from(input.files).slice(0, 10 - pendingPhotos.length);
    if (!files.length) return;
    for (let f of files) {
        const b = await new Promise(res => { 
            const r = new FileReader();
            r.onload = e => { 
                const img = new Image();
                img.onload = () => { 
                    const c = document.createElement('canvas');
                    const max = 800;
                    let w = img.width, h = img.height; 
                    if (w > h && w > max) { h *= max / w; w = max; } 
                    else if (h > max) { w *= max / h; h = max; } 
                    c.width = w; c.height = h;
                    c.getContext('2d').drawImage(img, 0, 0, w, h);
                    res(c.toDataURL('image/jpeg', 0.7)); 
                };
                img.src = e.target.result; 
            };
            r.readAsDataURL(f); 
        });
        pendingPhotos.push(b);
    }
    renderPreviewArea();
}

function renderPreviewArea() {
    const previewArea = document.getElementById("preview-area");
    const previewBox = document.getElementById("preview-imgs");
    previewBox.innerHTML = "";
    
    if (pendingPhotos.length) {
        pendingPhotos.slice(0, 10).forEach((src, index) => {
            const thumb = document.createElement('div');
            thumb.className = 'preview-thumb';
            thumb.innerHTML = `<img src="${src}"><div class="preview-remove" onclick="removePreviewPhoto(${index})">×</div>`;
            previewBox.appendChild(thumb);
        });
        previewBox.style.display = 'flex';
    } else { previewBox.style.display = 'none'; }
    
    previewArea.style.display = pendingPhotos.length ? 'block' : 'none';
}

function removePreviewPhoto(index) { 
    pendingPhotos.splice(index, 1); 
    renderPreviewArea(); 
}

function sendChat() {
    const msgInput = document.getElementById("chatMsg");
    const text = msgInput.value.trim();
    if (isMuted) { renderMuteState(); return; }
    if (!text && !pendingPhotos.length) return;
    
    push(ref(db, "chat_v4"), { 
        name: currentUserName, text: text, 
        images: pendingPhotos.length ? pendingPhotos : null,
        time: Date.now() 
    });
    
    msgInput.value = "";
    pendingPhotos = [];
    renderPreviewArea();
}

function handleChatKey(event) { 
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendChat(); } 
}

function updateBadge(n) { 
    const b = document.getElementById("chat-badge");
    b.innerText = n;
    b.style.display = n > 0 ? "block" : "none"; 
}

function openFullImg(s) { 
    document.getElementById("lightbox-img").src = s;
    document.getElementById("lightbox").style.display = "flex"; 
}

function showCtx(e, k, a) { 
    e.preventDefault(); 
    if (!isAdmin && a !== currentUserName) return; 
    const m = document.getElementById("context-menu");
    m.style.display = "block";
    m.style.left = e.pageX + "px";
    m.style.top = e.pageY + "px";
    document.getElementById("ctx-delete").onclick = () => { 
        if (confirm("Удалить?")) remove(ref(db, "chat_v4/" + k)); 
    }; 
}

// ============================================================
// ПРИСУТСТВИЕ (ONLINE)
// ============================================================

function setupPresence() { 
    if (!currentUserName) return; 
    const r = ref(db, `presence/${currentUserName}`);
    set(r, "online").catch(e => {});
    onDisconnect(r).remove(); 
    
    onValue(ref(db, "presence"), snap => { 
        latestPresence = snap.val() || {}; 
        const m = document.getElementById("presence-mini"); 
        if (m) { 
            m.innerHTML = ""; 
            const count = Object.keys(latestPresence).length; 
            for (let i = 0; i < count; i++) { 
                m.innerHTML += `<div style="width:6px;height:6px;background:var(--online);border-radius:50%;"></div>`; 
            } 
        }
        renderOnlineUsers();
    });
}

function renderOnlineUsers() { 
    const container = document.getElementById("onlineUsersList"); 
    if (!container) return; 
    
    const onlineNames = Object.keys(latestPresence || {}).sort(); 
    if (!onlineNames.length) { 
        container.innerHTML = '<div style="color:#aaa">Никого нет в сети</div>'; 
        return; 
    } 
    
    container.innerHTML = onlineNames.map(name =>
        `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 12px; background:rgba(99,102,241,0.04); border-radius:10px; border:1px solid var(--border);">
            <span style="font-weight:700; color:var(--text);">${escapeHtml(name)}</span>
            <span style="opacity:.7; font-size:13px; color:#64748b;">${latestUsers[name]?.lastSeen ? new Date(latestUsers[name].lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
        </div>`
    ).join(""); 
}

// ============================================================
// ТЕМА
// ============================================================

function toggleTheme() { 
    const html = document.documentElement; 
    const isDark = html.classList.contains('dark-mode'); 
    const themeBtn = document.getElementById('btn-theme'); 
    if (isDark) { 
        html.classList.remove('dark-mode'); themeBtn.innerText = '🌙'; 
        localStorage.setItem('theme', 'light'); 
    } else { 
        html.classList.add('dark-mode'); themeBtn.innerText = '☀️'; 
        localStorage.setItem('theme', 'dark'); 
    } 
}

function initTheme() { 
    const theme = localStorage.getItem('theme') || 'light'; 
    const html = document.documentElement; 
    const themeBtn = document.getElementById('btn-theme'); 
    if (theme === 'dark') { 
        html.classList.add('dark-mode'); if (themeBtn) themeBtn.innerText = '☀️'; 
    } else { 
        html.classList.remove('dark-mode'); if (themeBtn) themeBtn.innerText = '🌙'; 
    } 
}

// ============================================================
// ПРОФИЛЬ
// ============================================================

function showProfileModal(userName = currentUserName) { 
    cancelAvatarEdit();
    profileViewUser = userName;
    profileEditable = userName === currentUserName;
    document.getElementById("profileName").innerText = userName + (profileEditable ? "" : " (просмотр)");
    document.getElementById("profileRole").innerText = profileEditable ? (isAdmin ? "Администратор" : "") : (userAvatars[userName]?.admin ? "Администратор" : ""); 
    
    const profileAvatar = document.getElementById("profileAvatarPreview");
    const avatarUrl = userAvatars[userName]?.avatar || "https://cdn-icons-png.flaticon.com/512/149/149071.png"; 
    if (profileAvatar) { profileAvatar.src = avatarUrl; profileAvatar.style.cursor = profileEditable ? 'pointer' : 'default'; } 
    
    document.getElementById('profileEditBtn').style.display = profileEditable ? 'block' : 'none';
    loadProfileStats(userName);
    document.getElementById("profileModal").style.display = "flex"; 
}

function loadProfileStats(userName = currentUserName) { 
    get(query(ref(db, "shifts"))).then(snap => { 
        let totalSalary = 0, shiftsCount = 0, totalOrders = 0, totalOpt = 0, totalFbo = 0;
        snap.forEach(child => { 
            const d = child.val(); 
            if (d.participants && d.participants[userName]) {
                shiftsCount++; 
                const myData = d.participants[userName];
                totalSalary += myData.earned || 0;
                totalOrders += myData.orders || ((d.total || 0) / (d.numParticipants || 1));
                totalOpt += myData.optOrders || ((d.opt || 0) / (d.numParticipants || 1));
                totalFbo += myData.fboOrders || ((d.fbo || 0) / (d.numParticipants || 1)); 
            } 
        });
        document.getElementById("profileStats").innerHTML =
            `<div>Смен отработано: <b>${shiftsCount}</b></div>
            <div>Всего заказов: <b>${Math.round(totalOrders)}</b></div>
            <div>Оптовых заказов: <b>${Math.round(totalOpt)}</b></div>
            <div>ФБО заказов: <b>${Math.round(totalFbo)}</b></div>
            <div>Заработано всего: <b>${Math.round(totalSalary)} ₽</b></div>`;
        const profileAvatar = document.getElementById("profileAvatarPreview"); 
        if (profileAvatar && userAvatars[userName]) profileAvatar.src = userAvatars[userName].avatar || profileAvatar.src; 
    }); 
}

function triggerAvatarInput() { 
    if (!profileEditable) return;
    document.getElementById('avatarInp').click(); 
}

// ============================================================
// АВАТАР (canvas editor)
// ============================================================

function uploadAvatar(input) { 
    if (input.files[0]) { 
        const reader = new FileReader();
        reader.onload = e => { 
            const img = new Image();
            img.onload = () => { 
                avatarEditorImage = img;
                avatarMinScale = Math.max(220 / img.width, 220 / img.height);
                avatarScale = avatarMinScale;
                avatarOffset = { x: 0, y: 0 };
                document.getElementById('avatarEditor').style.display = 'block';
                document.getElementById('profileAvatarPreview').style.opacity = '0.6';
                updateAvatarCanvas(); 
            };
            img.src = e.target.result; 
        };
        reader.readAsDataURL(input.files[0]); 
    } 
}

function cancelAvatarEdit() { 
    avatarEditorImage = null;
    document.getElementById('avatarEditor').style.display = 'none';
    document.getElementById('profileAvatarPreview').style.opacity = '1'; 
}

function saveAvatar() { 
    if (!avatarEditorImage) return; 
    const canvas = document.getElementById('avatarCanvas'); 
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    set(ref(db, `users/${currentUserName}/avatar`), dataUrl);
    document.getElementById('myAvatar').src = dataUrl;
    document.getElementById('profileAvatarPreview').src = dataUrl;
    cancelAvatarEdit(); 
}

function updateAvatarCanvas() { 
    const canvas = document.getElementById('avatarCanvas'); 
    if (!canvas || !avatarEditorImage) return; 
    const ctx = canvas.getContext('2d'), size = canvas.width;
    ctx.clearRect(0, 0, size, size); 
    const w = avatarEditorImage.width * avatarScale, h = avatarEditorImage.height * avatarScale,
          x = size / 2 - w / 2 + avatarOffset.x, y = size / 2 - h / 2 + avatarOffset.y;
    ctx.drawImage(avatarEditorImage, x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.stroke(); 
}

function clampAvatarOffset() { 
    if (!avatarEditorImage) return; 
    const size = 220, w = avatarEditorImage.width * avatarScale, h = avatarEditorImage.height * avatarScale,
          maxX = Math.max(0, (w - size) / 2), maxY = Math.max(0, (h - size) / 2);
    avatarOffset.x = Math.max(-maxX, Math.min(maxX, avatarOffset.x));
    avatarOffset.y = Math.max(-maxY, Math.min(maxY, avatarOffset.y)); 
}

function zoomAvatar(delta) { 
    if (!avatarEditorImage) return;
    avatarScale = Math.max(avatarMinScale, avatarScale + delta);
    clampAvatarOffset();
    updateAvatarCanvas(); 
}

function initAvatarEditor() { 
    const canvas = document.getElementById('avatarCanvas'); 
    if (!canvas) return;
    canvas.onpointerdown = e => { 
        if (!avatarEditorImage) return;
        avatarDragStart = { x: e.clientX, y: e.clientY, offsetX: avatarOffset.x, offsetY: avatarOffset.y };
        canvas.setPointerCapture(e.pointerId); 
    };
    canvas.onpointermove = e => { 
        if (!avatarDragStart) return;
        avatarOffset.x = avatarDragStart.offsetX + (e.clientX - avatarDragStart.x);
        avatarOffset.y = avatarDragStart.offsetY + (e.clientY - avatarDragStart.y);
        clampAvatarOffset();
        updateAvatarCanvas(); 
    };
    canvas.onpointerup = canvas.onpointercancel = () => { avatarDragStart = null; }; 
}

initAvatarEditor();

// ============================================================
// MUTE
// ============================================================

function renderMuteState() { 
    const banner = document.getElementById('muteBanner'),
          sendBtn = document.getElementById('sendChatBtn'),
          msgInput = document.getElementById('chatMsg'); 
    if (!banner || !sendBtn || !msgInput) return; 
    if (isMuted) { 
        banner.style.display = 'block';
        sendBtn.disabled = true; sendBtn.style.opacity = '0.6';
        msgInput.placeholder = 'Ты в муте, чел'; 
    } else { 
        banner.style.display = 'none';
        sendBtn.disabled = false; sendBtn.style.opacity = '1';
        msgInput.placeholder = 'пиши...'; 
    } 
}

// ============================================================
// АДМИН-ПАНЕЛЬ
// ============================================================

function refreshAdminData() { 
    if (isAdmin) listenAdminUsers(); 
}

function addNewAdmin() { 
    if (!isAdmin) return; 
    const name = document.getElementById("adminInp").value.trim(); 
    if (!name) return; 
    if (/[.$#[\]/]/.test(name)) { alert("Имя не должно содержать символы . $ # [ ] /"); return; } 
    set(ref(db, `admins/${name}`), true)
        .then(() => update(ref(db, `users/${name}`), { admin: true }))
        .then(() => { document.getElementById("adminInp").value = ""; })
        .catch(err => { alert("Не удалось сделать пользователя администратором"); }); 
}

function removeAdmin(name) { 
    if (!isAdmin || !name) return; 
    if (!confirm(`Снять права администратора у ${name}?`)) return; 
    remove(ref(db, `admins/${name}`))
        .then(() => update(ref(db, `users/${name}`), { admin: false }))
        .catch(err => { alert("Не удалось снять права администратора"); }); 
}

function toggleMuteUser(name) { 
    if (!isAdmin || !name) return; 
    const trimmed = name.trim(); 
    if (!trimmed) return; 
    const mutePath = ref(db, `muted_users/${trimmed}`); 
    if (mutedUsers[trimmed]) { remove(mutePath); } 
    else { set(mutePath, { mutedBy: currentUserName, at: Date.now() }); } 
}

function deleteUser(name) { 
    if (!isAdmin || !name) return; 
    if (!confirm(`Удалить пользователя ${name} из сайта? Это действие необратимо.`)) return; 
    const safeName = name.trim();
    remove(ref(db, `users/${safeName}`));
    remove(ref(db, `admins/${safeName}`));
    remove(ref(db, `muted_users/${safeName}`));
    remove(ref(db, `presence/${safeName}`)); 
}

function listenAdminUsers() { 
    onValue(ref(db, "users"), snap => { 
        const users = snap.val() || {};
        latestUsers = users; 
        Promise.all([
            get(ref(db, "blocked_ips")), 
            get(ref(db, "admins")), 
            get(ref(db, "muted_users"))
        ]).then(([blockSnap, adminSnap, muteSnap]) => { 
            currentBlockedIps = blockSnap.val() || {};
            currentAdmins = adminSnap.val() || {};
            mutedUsers = muteSnap.val() || {};
            renderAdminUsers(users, currentBlockedIps, currentAdmins);
            renderBlockedIps(currentBlockedIps); 
        });
        renderOnlineUsers(); 
    });
}

function renderAdminUsers(users, blocked, admins) { 
    if (!users || !blocked || !admins) return; 
    let html = ""; 
    Object.keys(users).sort().forEach(name => { 
        if (!name) return; 
        const user = users[name] || {}, ip = user.ip || "", ipKey = ip ? dbKey(ip) : ""; 
        const isBlocked = ip && blocked[ipKey],
              isUserAdmin = !!admins[name] || !!user.admin || name.toLowerCase() === "дениска",
              isUserMuted = !!mutedUsers[name];
        html += `<div class="admin-user-card">
            <div class="user-info">
                <div style="font-weight:700;">${escapeHtml(name)}${isUserAdmin?'<span style="font-size:10px; color:#38bdf8; margin-left:6px;">admin</span>':''}</div>
                <div class="admin-user-status">IP: ${escapeHtml(ip||'нет')}${isUserMuted?' · muted':''}</div>
            </div>
            <div class="admin-actions">
                <button class="glass-btn admin-action-btn" onclick="showProfileModal('${escapeJsString(name)}')">Просмотр</button>
                <button class="glass-btn admin-action-btn" style="${isUserMuted?'background:#ff3b30;color:#111;':''}" onclick="toggleMuteUser('${escapeJsString(name)}')">${isUserMuted?'Размутить':'Мут'}</button>
                ${ip?`<button class="glass-btn admin-action-btn" style="${isBlocked?'background:#ff3b30;color:#111;':''}" onclick="${isBlocked?`unblockIp('${escapeJsString(ipKey)}')`:`blockIp('${escapeJsString(ipKey)}')`}">${isBlocked?'Разблокировать':'Заблокировать'}</button>`:'<button class="glass-btn admin-action-btn" style="opacity:.5; cursor:not-allowed;" disabled>нет IP</button>'}
                ${isUserAdmin&&name.toLowerCase()!=="дениска"?`<button class="glass-btn admin-action-btn" style="background:rgba(255,255,255,0.08);" onclick="removeAdmin('${escapeJsString(name)}')">Снять admin</button>`:''}
                <button class="glass-btn admin-action-btn" style="background:rgba(255,59,48,0.12); color:#ff7f84;" onclick="deleteUser('${escapeJsString(name)}')">Удалить</button>
            </div>
        </div>`; 
    }); 
    const container = document.getElementById("adminUsersList"); 
    if (container) container.innerHTML = html || '<div style="color:#aaa">Нет зарегистрированных пользователей</div>'; 
}

function renderBlockedIps(blocked) { 
    let html = ""; 
    Object.keys(blocked).sort().forEach(ipKey => { 
        const item = blocked[ipKey] || {}, ip = dbKeyToValue(ipKey);
        html += `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px; background:white; border:1px solid var(--border); border-radius:10px;">
            <div><div style="font-weight:700; color:var(--text);">${escapeHtml(ip)}</div><div style="font-size:12px; color:#64748b;">${item.blockedBy?`Заблокировал: ${escapeHtml(item.blockedBy)}`:''}${item.at?` ${new Date(item.at).toLocaleString()}`:''}</div></div>
            <button class="glass-btn" style="font-size:12px; padding:8px 12px;" onclick="unblockIp('${escapeJsString(ipKey)}')">Разблокировать</button>
        </div>`; 
    }); 
    document.getElementById("blockedIpsList").innerHTML = html || '<div style="color:#aaa">Нет заблокированных IP</div>'; 
}

function blockIp(ipKey) { 
    const ip = dbKeyToValue(ipKey); 
    if (!ipKey || !confirm(`Блокировать IP ${ip}?`)) return; 
    set(ref(db, `blocked_ips/${ipKey}`), { blockedBy: currentUserName, at: Date.now() }); 
}

function unblockIp(ipKey) { 
    const ip = dbKeyToValue(ipKey); 
    if (!ipKey || !confirm(`Разблокировать IP ${ip}?`)) return; 
    remove(ref(db, `blocked_ips/${ipKey}`)); 
}

// ============================================================
// ГРАФИК
// ============================================================

const FUTURE_MONTHS_TO_SYNC = 24;

function getMonthKey(year, month) { return `${year}-${month}`; }

function getFutureMonthKeys(year, month, count = FUTURE_MONTHS_TO_SYNC) { 
    const keys = []; 
    for (let i = 0; i <= count; i++) { 
        const d = new Date(year, month + i, 1);
        keys.push(getMonthKey(d.getFullYear(), d.getMonth())); 
    } 
    return keys; 
}

function renderSched() { 
    const y = scheduleDate.getFullYear(), m = scheduleDate.getMonth(),
          days = new Date(y, m + 1, 0).getDate(); 
    const weekDays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]; 
    const monthLabel = document.getElementById("monthLabel"); 
    if (monthLabel) monthLabel.innerText = `${(m+1).toString().padStart(2,'0')}.${y}`; 
    
    let h = "<th>Имя</th>"; 
    for (let i = 1; i <= days; i++) { 
        let d = new Date(y, m, i);
        h += `<th class="${(d.getDay()===0||d.getDay()===6)?'weekend':''}"><span class="day-name">${weekDays[d.getDay()]}</span>${i}</th>`; 
    } 
    const hRow = document.getElementById("h-row"); 
    if (hRow) hRow.innerHTML = h; 
    
    const scheduleRef = ref(db, `schedule/${y}-${m}/${scheduleMode}`);
    onValue(scheduleRef, snap => { 
        const bRows = document.getElementById("b-rows"); 
        if (!bRows) return; 
        const data = snap.val() || {}; 
        let html = ""; 
        Object.keys(data).sort().forEach(n => { 
            if (!n) return; 
            const row = data[n] || {};
            html += `<tr><td class="name-col" data-name="${escapeHtml(n)}" onclick="deleteStaff('${escapeJsString(n)}')">${escapeHtml(n)}</td>`;
            for (let i = 1; i <= days; i++) { 
                const isWork = row[i] === "10-22";
                html += `<td><div class="cell-box ${isWork?'st-work':''}" onclick="toggleWorkCell('${y}-${m}','${escapeJsString(n)}',${i},${isWork})"></div></td>`; 
            } 
            html += "</tr>"; 
        });
        bRows.innerHTML = html; 
    }); 
}

function setMode(mode) { 
    if (scheduleMode === mode) return;
    scheduleMode = mode;
    document.getElementById("t-day").className = mode === "day" ? "primary" : "glass-btn";
    document.getElementById("t-night").className = mode === "night" ? "primary" : "glass-btn";
    renderSched(); 
}

function changeMonth(delta) { 
    scheduleDate.setMonth(scheduleDate.getMonth() + delta);
    renderSched(); 
}

function deleteStaff(name) { 
    if (!isAdmin) return; 
    if (!confirm(`Точно удалить ${name} из графика на этот и последующие месяцы?`)) return; 
    const currentY = scheduleDate.getFullYear(), currentM = scheduleDate.getMonth(); 
    const monthKeys = getFutureMonthKeys(currentY, currentM); 
    Promise.all(monthKeys.map(key => remove(ref(db, `schedule/${key}/${scheduleMode}/${name}`))))
        .then(() => renderSched())
        .catch(err => { alert("Ошибка при удалении сотрудника"); }); 
}

function addNewStaff() { 
    if (!isAdmin) return; 
    const name = document.getElementById("staffInp").value.trim(); 
    if (!name) return; 
    if (/[.$#[\]/]/.test(name)) { alert("Имя не должно содержать символы . $ # [ ] /"); return; } 
    const currentY = scheduleDate.getFullYear(), currentM = scheduleDate.getMonth(); 
    const monthKeys = getFutureMonthKeys(currentY, currentM); 
    const updates = {};
    monthKeys.forEach(key => { updates[`schedule/${key}/${scheduleMode}/${name}/createdAt`] = Date.now(); });
    update(ref(db), updates)
        .then(() => { document.getElementById("staffInp").value = ""; })
        .catch(err => { alert("Ошибка при добавлении сотрудника"); }); 
}

function toggleWorkCell(path, name, day, isWork) { 
    if (!isAdmin) return; 
    const cellRef = ref(db, `schedule/${path}/${scheduleMode}/${name}/${day}`); 
    if (isWork) { remove(cellRef); } 
    else { set(cellRef, "10-22"); } 
}

// ============================================================
// ЭКСПОРТ В PNG
// ============================================================

function exportShiftToImage(shiftData) {
    // ... эта функция очень длинная, оставь её как есть из старого app.js
    // (она не использует Firebase, только canvas)
    if (!shiftData) return;
    const cdekCount = shiftData.cdek || 0;
    const wbCount = shiftData.wb || 0;
    const dostCount = shiftData.dost || 0;
    const fboCount = shiftData.fbo || 0;
    const optCount = shiftData.opt || 0;
    const totalOrders = shiftData.total || (cdekCount + wbCount + dostCount + fboCount);
    const cdekPlaces = shiftData.cdek_places || cdekCount;
    const dostPlaces = shiftData.dost_places || dostCount;
    const totalPlaces = shiftData.total_places || (cdekPlaces + wbCount + dostPlaces + fboCount);
    const totalSalary = Math.round(Number(shiftData.totalSalary || 0));
    const dateLabel = shiftData.date || '';
    const startTime = shiftData.start || '';
    const endTime = shiftData.end || '';
    const width = 800, height = 700;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#0f172a'); bgGrad.addColorStop(0.4, '#1e293b'); bgGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.15)'; ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(0, 100 + i * 80); ctx.lineTo(width, 100 + i * 80); ctx.stroke(); }
    const accentGrad = ctx.createLinearGradient(0, 0, width, 0);
    accentGrad.addColorStop(0, '#6366f1'); accentGrad.addColorStop(0.5, '#818cf8'); accentGrad.addColorStop(1, '#a78bfa');
    ctx.fillStyle = accentGrad; ctx.fillRect(0, 0, width, 5);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('POROGI67', width / 2, 60);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('ОТЧЁТ О СМЕНЕ', width / 2, 85);
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(`${dateLabel}  •  ${startTime.split(',')[1] || ''} - ${endTime.split(',')[1] || ''}`, width / 2, 110);
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, 130); ctx.lineTo(width - 80, 130); ctx.stroke();
    const tableStartY = 160, colX = [80, 280, 420, 560, 680];
    ctx.fillStyle = 'rgba(99, 102, 241, 0.2)'; ctx.fillRect(60, tableStartY - 10, width - 120, 36);
    ctx.fillStyle = '#a78bfa'; ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('КАТЕГОРИЯ', colX[0], tableStartY + 15); ctx.textAlign = 'center';
    ctx.fillText('ЗАКАЗОВ', colX[1], tableStartY + 15); ctx.fillText('МЕСТ', colX[2], tableStartY + 15); ctx.fillText('СТАТУС', colX[3], tableStartY + 15);
    const rows = [
        { cat: 'СДЭК', orders: cdekCount, places: cdekPlaces, note: cdekPlaces !== cdekCount ? `${cdekPlaces} мест` : 'мест = заказов' },
        { cat: 'ВБ / ОЗОН', orders: wbCount, places: wbCount, note: 'мест = заказов' },
        { cat: 'ФБО', orders: fboCount, places: fboCount, note: 'мест = заказов' },
        { cat: 'ДОСТАВКА', orders: dostCount, places: dostPlaces, note: dostPlaces !== dostCount ? `${dostPlaces} мест` : 'мест = заказов' },
    ];
    let y = tableStartY + 50;
    rows.forEach((row, idx) => {
        if (idx % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(60, y - 14, width - 120, 38); }
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(row.cat, colX[0], y); ctx.fillStyle = '#e2e8f0'; ctx.font = '18px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(row.orders, colX[1], y); ctx.fillText(row.places, colX[2], y);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(row.note, colX[3], y); y += 42;
    });
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(80, y + 5); ctx.lineTo(width - 80, y + 5); ctx.stroke();
    y += 25;
    ctx.fillStyle = 'rgba(99, 102, 241, 0.25)'; ctx.fillRect(60, y - 14, width - 120, 42);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('ИТОГО', colX[0], y + 5); ctx.fillStyle = '#a78bfa'; ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(totalOrders, colX[1], y + 5); ctx.fillText(totalPlaces, colX[2], y + 5);
    y += 45;
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`Оптовые заказы: ${optCount}  •  Общий заработок: ${totalSalary} ₽`, width / 2, y);
    const survey = shiftData.survey;
    if (survey && survey.text) {
        y += 30; ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(width - 80, y); ctx.stroke();
        y += 25; ctx.fillStyle = '#a78bfa'; ctx.font = 'bold 13px -apple-system, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('ОТЧЁТ ПО СМЕНЕ', 80, y); y += 24;
        ctx.fillStyle = '#e2e8f0'; ctx.font = '14px -apple-system, sans-serif';
        survey.text.split('\n').forEach(line => { ctx.fillText(line, 80, y); y += 22; });
    }
    const finishDraw = () => {
        ctx.fillStyle = accentGrad; ctx.fillRect(0, height - 5, width, 5);
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '10px -apple-system, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('POROGI67 • Система управления порогами • ' + new Date().toLocaleDateString(), width / 2, height - 15);
        const link = document.createElement('a');
        link.download = `otchet_smena_${dateLabel.replace(/\./g, '_')}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };
    if (survey && survey.photo) {
        const photoImg = new Image();
        photoImg.onload = () => {
            const maxW = width - 160, maxH = 220; let pw = photoImg.width, ph = photoImg.height;
            const ratio = Math.min(maxW / pw, maxH / ph); pw *= ratio; ph *= ratio;
            const px = (width - pw) / 2, py = y + 10;
            ctx.drawImage(photoImg, px, py, pw, ph); finishDraw();
        };
        photoImg.onerror = finishDraw; photoImg.src = survey.photo;
    } else { finishDraw(); }
}

// ============================================================
// ЗАПУСК
// ============================================================

console.log('📦 app-v9.js загружен, ждем авторизацию...');
