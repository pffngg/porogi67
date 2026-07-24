// app-v9.js — Основной код приложения (Firebase 9.x) БЕЗ АВТОРИЗАЦИИ
import { 
    ref, set, push, onValue, update, remove, runTransaction, 
    onDisconnect, query, limitToLast, get 
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-database.js';

const db = window.db;

// Имя пользователя из localStorage или "Гость"
window.currentUserName = localStorage.getItem('userName') || 'Гость';

// Глобальные переменные
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

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
function showApp() {
    console.log('🚀 Запуск приложения...');
    initTheme();
    // Скрываем экран входа (уже удалён) и показываем приложение
    // document.getElementById("login").style.display = "none"; // закомментировано
    document.getElementById("app").style.display = "block";
    document.getElementById("btn-settings").style.display = "none";
    document.getElementById("adminPanel").style.display = "none";
    document.getElementById("adminUsersPanel").style.display = "none";

    onValue(ref(db, "admins"), snap => {
        const admins = snap.val() || {};
        isAdmin = !!admins[window.currentUserName] || window.currentUserName.toLowerCase() === "дениска";
        document.getElementById("userTag").innerText = isAdmin ? "⭐" + window.currentUserName : "@" + window.currentUserName.toLowerCase();
        document.getElementById("btn-settings").style.display = isAdmin ? "inline-flex" : "none";
        document.getElementById("adminPanel").style.display = isAdmin ? "flex" : "none";
        document.getElementById("adminUsersPanel").style.display = isAdmin ? "block" : "none";
        if (isAdmin && !adminListenersInitialized) { 
            listenAdminUsers(); 
            adminListenersInitialized = true; 
        }
    });

    onValue(ref(db, "users"), snap => {
        latestUsers = snap.val() || {};
        userAvatars = latestUsers;
        const myAv = userAvatars[window.currentUserName]?.avatar || "https://cdn-icons-png.flaticon.com/512/149/149071.png";
        document.getElementById("myAvatar").src = myAv;
        const profileAvatar = document.getElementById("profileAvatarPreview");
        if (profileAvatar) profileAvatar.src = myAv;
        renderOnlineUsers();
    });

    onValue(ref(db, "muted_users"), snap => {
        mutedUsers = snap.val() || {};
        isMuted = !!mutedUsers[window.currentUserName];
        renderMuteState();
        if (isAdmin) { 
            renderAdminUsers(latestUsers, currentBlockedIps, currentAdmins); 
        }
    });

    setupPresence();
    listenChat();
    renderSched();
    listenHistory();
    listenActiveShift();
    fetchAndStoreMyIp();

    window.onclick = () => { 
        const menu = document.getElementById("context-menu"); 
        if (menu) menu.style.display = "none"; 
    };
    console.log('✅ Приложение запущено');
}

// ... (весь остальной код функций без изменений, как в предыдущей версии app-v9.js, 
//      но с заменой currentUserName на window.currentUserName и удалением обращений к login)

// В конце файла обязательно:
window.showApp = showApp;
console.log('📦 app-v9.js загружен, ждем авторизацию...');
