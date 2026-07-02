
 function login() {
            const n = document.getElementById("nameInput").value.trim();
            if (!n) return;
            if (/[.#[\]/]/.test(n)) { alert("Имя не должно содержать символы . $ # [ ] /"); return; }
            if (document.getElementById("codeInput").value !== "67") return;

            getMyIp().then(ip => {
                if (!ip) { alert("Не удалось определить IP. Попробуйте снова."); return; }
                const ipKey = dbKey(ip);
                db.ref(`blocked_ips/${ipKey}`).once("value").then(snap => {
                    if (snap.exists() && n.toLowerCase() !== "дениска") {
                        alert("Ваш IP заблокирован. Обратитесь к администратору.");
                        return;
                    }
                    localStorage.setItem("userName", n);
                    localStorage.setItem("userIp", ip);
                    db.ref(`users/${n}`).update({ ip, lastSeen: Date.now() });
                    location.reload();
                });
            });
        }

 function showApp() {
            initTheme();
            document.getElementById("login").style.display = "none";
            document.getElementById("app").style.display = "block";
            document.getElementById("btn-settings").style.display = "none";
            document.getElementById("adminPanel").style.display = "none";
            document.getElementById("adminUsersPanel").style.display = "none";

            db.ref("admins").on("value", snap => {
                const admins = snap.val() || {};
                isAdmin = !!admins[currentUser] || currentUser.toLowerCase() === "дениска";
                document.getElementById("userTag").innerText = isAdmin ? "⭐" + currentUser : "@" + currentUser
                    .toLowerCase();
                document.getElementById("btn-settings").style.display = isAdmin ? "inline-flex" : "none";
                document.getElementById("adminPanel").style.display = isAdmin ? "flex" : "none";
                document.getElementById("adminUsersPanel").style.display = isAdmin ? "block" : "none";
                const appSidebar = document.getElementById("app-sidebar");
                if (appSidebar) { appSidebar.style.display = isAdmin ? "block" : "none"; }
                if (isAdmin && !adminListenersInitialized) { listenAdminUsers();
                    adminListenersInitialized = true; }
            });

            db.ref("users").on("value", snap => {
                latestUsers = snap.val() || {};
                userAvatars = latestUsers;
                const myAv = userAvatars[currentUser]?.avatar ||
                    "https://cdn-icons-png.flaticon.com/512/149/149071.png";
                document.getElementById("myAvatar").src = myAv;
                const profileAvatar = document.getElementById("profileAvatarPreview");
                if (profileAvatar) profileAvatar.src = myAv;
                renderOnlineUsers();
            });

            db.ref("muted_users").on("value", snap => {
                mutedUsers = snap.val() || {};
                isMuted = !!mutedUsers[currentUser];
                renderMuteState();
                if (isAdmin) { renderAdminUsers(latestUsers, currentBlockedIps, currentAdmins); }
            });

            setupPresence();
            listenChat();
            renderSched();
            listenHistory();
            listenActiveShift();
            fetchAndStoreMyIp();

            window.onclick = () => { const menu = document.getElementById("context-menu"); if (menu) menu.style.display =
                    "none"; };
        }

 function logout() { localStorage.clear();
            location.reload(); }
