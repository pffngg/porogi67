const firebaseConfig = {
            apiKey: "AIzaSyA41nDX13dsMuPNJkckCMQz8bfim3Hscxs",
            authDomain: "porog-lol.firebaseapp.com",
            databaseURL: "https://porog-lol-default-rtdb.europe-west1.firebasedatabase.app",
            projectId: "porog-lol"
        };
        firebase.initializeApp(firebaseConfig);
        const db = firebase.database();

        let currentUser = localStorage.getItem("userName") || "";
        let isAdmin = false,
            scheduleDate = new Date(),
            scheduleMode = 'day',
            userAvatars = {},
            chatInitialized = false;
        let lastChatViewTime = localStorage.getItem("lastChatView") || 0;
        let currentTab = 'main',
            pendingPhotos = [];
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
        let profileViewUser = currentUser;
        let profileEditable = true;
        let currentFboSuffix = "";

        if (currentUser) showApp();

        // ===================== PLACES LOGIC =====================
       
      
        function getTotalPlaces(shift) {
            if (!shift) return 0;
            const cdekPlaces = shift.cdek_places || shift.cdek || 0;
            const wbPlaces = shift.wb || 0;
            const dostPlaces = shift.dost_places || shift.dost || 0;
            const fboPlaces = shift.fbo || 0;
            return cdekPlaces + wbPlaces + dostPlaces + fboPlaces;
        }

        // ===================== COUNTERS =====================
        function getOrderShare(type) { return type === 'opt' ? 50 : 80; }

         
        function createParticipantData(joinedAt = Date.now()) {
            return { earned: 0, joinedAt, orders: 0, optOrders: 0, cdekOrders: 0, wbOrders: 0, dostOrders: 0,
            fboOrders: 0 };
        }

        // ===================== FBO =====================
        let currentFboMaterial = "";
        let currentFboWidth = "";
        let fboArticlesVisible = true;

        function selectFboOption(type, value) {
            if (!isGlobalParticipant) return;
            if (type === 'suffix') {
                currentFboSuffix = value;
                document.getElementById('fboBtnS').className = value === 'S' ? 'primary fbo-control' :
                    'glass-btn fbo-control';
                document.getElementById('fboBtnF').className = value === 'F' ? 'primary fbo-control' :
                    'glass-btn fbo-control';
                document.getElementById('fboLabelSuffix').innerText = value;
            } else if (type === 'material') {
                currentFboMaterial = value;
                document.getElementById('fboBtnZinc').className = value === 'ЦИНК' ? 'primary fbo-control' :
                    'glass-btn fbo-control';
                document.getElementById('fboBtnHks').className = value === 'ХКС' ? 'primary fbo-control' :
                    'glass-btn fbo-control';
                document.getElementById('fboLabelMaterial').innerText = value;
            } else if (type === 'width') {
                currentFboWidth = value;
                document.getElementById('fboBtn1mm').className = value === '1 ММ' ? 'primary fbo-control' :
                    'glass-btn fbo-control';
                document.getElementById('fboBtn15mm').className = value === '1,5 ММ' ? 'primary fbo-control' :
                    'glass-btn fbo-control';
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
            return Object.entries(fboArticles).map(([key, value]) => ({ key, ...value })).sort((a, b) => (a.at || 0) - (
                b.at || 0));
        }

        function renderFboArticles(fboArticles) {
            const list = document.getElementById('fboArticlesList');
            const counter = document.getElementById('fboArticlesCount');
            if (!list) return;
            const articles = normalizeFboArticles(fboArticles);
            if (counter) counter.innerText = articles.length;
            if (!articles.length) {
                list.innerHTML =
                    `<div style="font-size:12px; color:var(--text-secondary); opacity:0.6; padding:8px;">Список пуст</div>`;
                return;
            }
            list.innerHTML = articles.map(item => {
                const fullArt = escapeHtml(item.fullArticle || '');
                return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(99,102,241,0.04); border-radius:10px; border:1px solid var(--border);"><div style="font-weight:800; color:var(--text); font-size:13px; word-break:break-all;">${fullArt}</div><button class="danger" style="padding:4px 8px; font-size:11px; box-shadow:none; flex-shrink:0; margin-left:8px;" onclick="removeFboArticle('${escapeJsString(item.key)}')">✕</button></div>`;
            }).join('');
        }

        function handleFboArticleKey(event) { if (event.key === 'Enter') { event.preventDefault();
                addFboArticle(); } }

              function toggleFboArticles() {
            const wrapper = document.getElementById('fboArticlesWrapper');
            const arrow = document.getElementById('fboToggleArrow');
            if (!wrapper || !arrow) return;
            fboArticlesVisible = !fboArticlesVisible;
            wrapper.style.maxHeight = fboArticlesVisible ? '250px' : '0';
            wrapper.style.opacity = fboArticlesVisible ? '1' : '0';
            arrow.style.transform = fboArticlesVisible ? 'rotate(0deg)' : 'rotate(-90deg)';
        }

        // ===================== SHIFT =====================
        
        function listenForJoinResponse(creator) {
            const responseRef = db.ref(`join_responses/${currentUser}`);
            responseRef.on("value", snap => {
                const response = snap.val();
                if (response) {
                    responseRef.off();
                    if (response.approved) {
                        db.ref("active_shift").once("value", snap => {
                            const shift = snap.val() || {};
                            if (!shift.startTime) { alert("Ошибка: нет активной смены"); return; }
                            const participantData = getParticipantDataForJoin(shift, currentUser);
                            db.ref().update({
                                [`active_shift/participants/${currentUser}`]: participantData,
                                [`active_shift/allParticipants/${currentUser}`]: participantData
                            }).catch(err => { console.error("joinShift error:", err);
                                alert("Ошибка при присоединении к смене"); });
                        });
                        alert("Ваш запрос одобрен!");
                    } else {
                        alert("Вам отказано в присоединении к смене.");
                    }
                    responseRef.remove();
                    db.ref(`join_requests/${creator}/${currentUser}`).remove();
                }
            });
        }

        function handleJoinRequest(requester) {
            const creator = currentUser;
            if (!isGlobalParticipant || !isAdmin && creator !== Object.keys((db.ref("active_shift/participants").once(
                    "value", snap => snap.val() || {})))[0]) return;
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.style.display = 'flex';
            modal.innerHTML = `
                <div class="modal-content">
                    <h3>${escapeHtml(requester)} хочет присоединиться к смене.</h3>
                    <p>Принять?</p>
                    <div style="display:flex; gap:10px; justify-content:center;">
                        <button class="primary" onclick="approveJoin('${escapeJsString(requester)}', this)">Да</button>
                        <button class="danger" onclick="denyJoin('${escapeJsString(requester)}', this)">Нет</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            listenForJoinRequestsCleanup();
        }

        function approveJoin(requester, button) {
            const modal = button.closest('.modal-overlay');
            if (modal) modal.remove();
            db.ref(`join_responses/${requester}`).set({ approved: true, timestamp: Date.now() });
        }

        function denyJoin(requester, button) {
            const modal = button.closest('.modal-overlay');
            if (modal) modal.remove();
            db.ref(`join_responses/${requester}`).set({ approved: false, timestamp: Date.now() });
        }

        function listenForJoinRequestsCleanup() {
            if (!isAdmin) return;
            const requestsRef = db.ref(`join_requests/${currentUser}`);
            requestsRef.on("child_added", snap => {
                handleJoinRequest(snap.key);
            });
        }

        function manualInput(type) {
            if (!isGlobalParticipant) return;
            db.ref("active_shift").once("value", snap => {
                const shift = snap.val();
                if (!shift || !shift.participants || !shift.participants[currentUser]) return;
                let currentVal = shift[type] || 0;
                let v = prompt("Введи новое количество заказов для " + type.toUpperCase() + ":", currentVal);
                if (v && !isNaN(v)) {
                    let newVal = parseInt(v);
                    let diff = newVal - currentVal;
                    if (diff !== 0) {
                        db.ref("active_shift").transaction(s => {
                            if (!s || !s.participants || !s.participants[currentUser]) return;
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
                                if (type === 'opt') part.optOrders = Math.max(0, (part.optOrders || 0) +
                                    orderDelta);
                                else if (type === 'cdek') part.cdekOrders = Math.max(0, (part.cdekOrders || 0) +
                                    orderDelta);
                                else if (type === 'wb') part.wbOrders = Math.max(0, (part.wbOrders || 0) +
                                    orderDelta);
                                else if (type === 'dost') part.dostOrders = Math.max(0, (part.dostOrders || 0) +
                                    orderDelta);
                            });
                            return s;
                        });
                    }
                }
            });
        }

        function calculateTotalSalary(participants = {}) {
            return Object.values(participants).reduce((sum, p) => sum + Number(p?.earned || 0), 0);
        }

        function getMergedParticipants(shift = {}) {
            return Object.assign({}, shift.allParticipants || {}, shift.participants || {});
        }

        function getParticipantDataForJoin(shift = {}, userName = "") {
            const oldData = shift.participants?.[userName] || shift.allParticipants?.[userName] || createParticipantData(Date
                .now());
            return { ...createParticipantData(Date.now()), ...oldData, joinedAt: oldData.joinedAt || Date.now(),
                rejoinedAt: Date.now() };
        }

              // ===================== ОПРОС ПОСЛЕ СМЕНЫ =====================
        let surveyState = { problems: false, report: false };
        let surveyPhoto = null;
        let pendingShiftKey = null;

        function toggleSurveyCheck(type) {
            surveyState[type] = !surveyState[type];
            const box = document.getElementById(type === 'problems' ? 'surveyProblemsBox' : 'surveyReportBox');
            if (surveyState[type]) { box.innerText = '✓';
                box.style.background = 'var(--accent)';
                box.style.color = 'white'; } else { box.innerText = '';
                box.style.background = 'transparent';
                box.style.color = 'var(--accent)'; }
        }

        function setWorkersCount(n) {
            for (let i = 1; i <= 4; i++) {
                const b = document.getElementById('surveyCntBtn' + i);
                if (b) b.className = (i === n) ? 'primary' : 'glass-btn';
            }
            const wrap = document.getElementById('surveyWorkersInputs');
            let html = '';
            for (let i = 1; i <= n; i++) {
                html +=
                    `<input class="survey-worker" placeholder="Имя ${i}" style="width:100%; padding:12px; border-radius:12px; border:1px solid var(--border); background:white; color:var(--text); font-size:14px;">`;
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
                    let w = img.width,
                        h = img.height;
                    if (w > h && w > max) { h *= max / w;
                        w = max; } else if (h > max) { w *= max / h;
                        h = max; }
                    c.width = w;
                    c.height = h;
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
            for (let i = 1; i <= 4; i++) { const b = document.getElementById('surveyCntBtn' + i); if (b) b.className =
                    'glass-btn'; }
            removeSurveyPhoto();
            document.getElementById('surveyModal').style.display = 'flex';
        }

        function buildSurveyText(problems, report, boxes, workers) {
            let line1;
            if (problems && report) line1 = "Заявки в проблемы кидал, отчет печатал.";
            else if (problems && !report) line1 = "Заявки в проблемы кидал, отчет не печатал.";
            else if (!problems && report) line1 = "Заявки в проблемы не кидал, отчет печатал.";
            else line1 = "Заявки в проблемы не кидал, отчет не печатал.";
            let line2 = (boxes && parseInt(boxes) > 0) ? `Упаковали ${parseInt(boxes)} коробок на ВБ.` :
                "Коробки на вб не упаковывали.";
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
                problems: surveyState.problems,
                report: surveyState.report,
                wbBoxes: boxes ? parseInt(boxes) : 0,
                workers: workers,
                text: surveyText,
                photo: surveyPhoto || null,
                filledBy: currentUser,
                at: Date.now()
            };
            db.ref(`shifts/${pendingShiftKey}/survey`).set(surveyData)
                .then(() => { document.getElementById('surveyModal').style.display = 'none';
                    pendingShiftKey = null; })
                .catch(err => { alert("Ошибка сохранения: " + err.message); });
        }

        function skipSurvey() {
            document.getElementById('surveyModal').style.display = 'none';
            pendingShiftKey = null;
        }

        // ===================== HISTORY =====================
        function toggleHistory() { const h = document.getElementById("history");
            h.style.display = h.style.display === "none" ? "block" : "none"; }

       
        function toggleShiftDetails(card) {
            const details = card.querySelector('.history-details');
            const arrow = card.querySelector('.history-arrow');
            if (!details || !arrow) return;
            const expanded = details.style.display === 'block';
            details.style.display = expanded ? 'none' : 'block';
            card.classList.toggle('expanded', !expanded);
            arrow.textContent = expanded ? '▼' : '▲';
        }

        // ===================== EXPORT TO PNG =====================
        function exportShiftToImage(shiftData) {
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
            const width = 800;
            const height = 700;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
            bgGrad.addColorStop(0, '#0f172a');
            bgGrad.addColorStop(0.4, '#1e293b');
            bgGrad.addColorStop(1, '#0f172a');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, width, height);
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.15)';
            ctx.lineWidth = 1;
            for (let i = 0; i < 8; i++) {
                ctx.beginPath();
                ctx.moveTo(0, 100 + i * 80);
                ctx.lineTo(width, 100 + i * 80);
                ctx.stroke();
            }
            const accentGrad = ctx.createLinearGradient(0, 0, width, 0);
            accentGrad.addColorStop(0, '#6366f1');
            accentGrad.addColorStop(0.5, '#818cf8');
            accentGrad.addColorStop(1, '#a78bfa');
            ctx.fillStyle = accentGrad;
            ctx.fillRect(0, 0, width, 5);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('POROGI67', width / 2, 60);
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.fillText('ОТЧЁТ О СМЕНЕ', width / 2, 85);
            ctx.fillStyle = 'rgba(255,255,255,0.65)';
            ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.fillText(`${dateLabel}  •  ${startTime.split(',')[1] || ''} - ${endTime.split(',')[1] || ''}`, width / 2, 110);
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(80, 130);
            ctx.lineTo(width - 80, 130);
            ctx.stroke();
            const tableStartY = 160;
            const colX = [80, 280, 420, 560, 680];
            ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
            ctx.fillRect(60, tableStartY - 10, width - 120, 36);
            ctx.fillStyle = '#a78bfa';
            ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('КАТЕГОРИЯ', colX[0], tableStartY + 15);
            ctx.textAlign = 'center';
            ctx.fillText('ЗАКАЗОВ', colX[1], tableStartY + 15);
            ctx.fillText('МЕСТ', colX[2], tableStartY + 15);
            ctx.fillText('СТАТУС', colX[3], tableStartY + 15);
            const rows = [
                { cat: 'СДЭК', orders: cdekCount, places: cdekPlaces, note: cdekPlaces !== cdekCount ?
                        `${cdekPlaces} мест` : 'мест = заказов' },
                { cat: 'ВБ / ОЗОН', orders: wbCount, places: wbCount, note: 'мест = заказов' },
                { cat: 'ФБО', orders: fboCount, places: fboCount, note: 'мест = заказов' },
                { cat: 'ДОСТАВКА', orders: dostCount, places: dostPlaces, note: dostPlaces !== dostCount ?
                        `${dostPlaces} мест` : 'мест = заказов' },
            ];
            let y = tableStartY + 50;
            rows.forEach((row, idx) => {
                if (idx % 2 === 0) {
                    ctx.fillStyle = 'rgba(255,255,255,0.03)';
                    ctx.fillRect(60, y - 14, width - 120, 38);
                }
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(row.cat, colX[0], y);
                ctx.fillStyle = '#e2e8f0';
                ctx.font = '18px -apple-system, BlinkMacSystemFont, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(row.orders, colX[1], y);
                ctx.fillText(row.places, colX[2], y);
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
                ctx.fillText(row.note, colX[3], y);
                y += 42;
            });
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(80, y + 5);
            ctx.lineTo(width - 80, y + 5);
            ctx.stroke();
            y += 25;
            ctx.fillStyle = 'rgba(99, 102, 241, 0.25)';
            ctx.fillRect(60, y - 14, width - 120, 42);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('ИТОГО', colX[0], y + 5);
            ctx.fillStyle = '#a78bfa';
            ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(totalOrders, colX[1], y + 5);
            ctx.fillText(totalPlaces, colX[2], y + 5);
            y += 45;
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`Оптовые заказы: ${optCount}  •  Общий заработок: ${totalSalary} ₽`, width / 2, y);
            const survey = shiftData.survey;
            if (survey && survey.text) {
                y += 30;
                ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(80, y);
                ctx.lineTo(width - 80, y);
                ctx.stroke();
                y += 25;
                ctx.fillStyle = '#a78bfa';
                ctx.font = 'bold 13px -apple-system, sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('ОТЧЁТ ПО СМЕНЕ', 80, y);
                y += 24;
                ctx.fillStyle = '#e2e8f0';
                ctx.font = '14px -apple-system, sans-serif';
                survey.text.split('\n').forEach(line => {
                    ctx.fillText(line, 80, y);
                    y += 22;
                });
            }
            const finishDraw = () => {
                ctx.fillStyle = accentGrad;
                ctx.fillRect(0, height - 5, width, 5);
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.font = '10px -apple-system, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('POROGI67 • Система управления порогами • ' + new Date().toLocaleDateString(), width / 2,
                    height - 15);
                const link = document.createElement('a');
                link.download = `otchet_smena_${dateLabel.replace(/\./g, '_')}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
            };
            if (survey && survey.photo) {
                const photoImg = new Image();
                photoImg.onload = () => {
                    const maxW = width - 160,
                        maxH = 220;
                    let pw = photoImg.width,
                        ph = photoImg.height;
                    const ratio = Math.min(maxW / pw, maxH / ph);
                    pw *= ratio;
                    ph *= ratio;
                    const px = (width - pw) / 2;
                    const py = y + 10;
                    ctx.drawImage(photoImg, px, py, pw, ph);
                    finishDraw();
                };
                photoImg.onerror = finishDraw;
                photoImg.src = survey.photo;
            } else {
                finishDraw();
            }
        }

        // ===================== CHAT =====================
        function listenChat() {
            const box = document.getElementById("chat-messages");
            if (!box) return;
            db.ref("chat_v4").limitToLast(30).on("value", snap => {
                if (!box) return;
                box.innerHTML = "";
                let unread = 0;
                const msgs = [];
                snap.forEach(s => { const m = s.val(); if (m && m.name && m.time) { msgs.push({ key: s.key,
                        msg: m }); if (m.time > lastChatViewTime && m.name !== currentUser) unread++; } });
                msgs.forEach(({ key, msg }) => appendMsgUI(key, msg, false));
                if (currentTab !== 'chat') updateBadge(unread);
                if (!chatInitialized) { setTimeout(() => { if (box) box.scrollTop = box.scrollHeight; }, 0);
                    chatInitialized = true; }
                if (currentTab === 'chat') db.ref("chat_v4").limitToLast(1).once("child_added", s => { if (s.val() &&
                        s.val().name !== currentUser) db.ref("chat_v4/" + s.key + "/readBy").child(currentUser)
                        .set(true).catch(e => {}); });
            }, err => { console.error('listenChat error:', err); });
        }

        function appendMsgUI(key, m, scroll) {
            const box = document.getElementById("chat-messages");
            const isMe = m.name === currentUser;
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
            avatarImg.style.width = "28px";
            avatarImg.style.height = "28px";
            avatarImg.src = av;
            wrapper.appendChild(avatarImg);
            const msg = document.createElement("div");
            msg.className = `msg ${isMe ? "me" : "others"}`;
            const isSenderAdmin = String(m.name).toLowerCase() === "дениска";
            const userLabel = document.createElement("small");
            userLabel.style.cssText =
                "font-size:11px; font-weight:700; opacity:0.9; display:flex; align-items:center; gap:6px;";
            userLabel.textContent = m.name;
            if (isSenderAdmin) { const adminTag = document.createElement("span");
                adminTag.style.cssText =
                    "font-size:10px; color: #6366f1; text-transform:uppercase; letter-spacing:0.05em; font-weight:600;";
                adminTag.textContent = "⭐";
                userLabel.appendChild(adminTag); }
            msg.appendChild(userLabel);
            if (m.images && Array.isArray(m.images)) {
                const gallery = document.createElement("div");
                gallery.style.cssText =
                    "display:grid; grid-template-columns:repeat(auto-fit,minmax(80px,1fr)); gap:4px; margin:5px 0;";
                m.images.forEach(src => { const img = document.createElement("img");
                    img.src = src;
                    img.style.cssText = "width:100%; border-radius:10px; cursor:pointer;";
                    img.addEventListener("click", () => openFullImg(src));
                    gallery.appendChild(img); });
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
            if (isMe) { const tickSpan = document.createElement("span");
                tickSpan.className = `ticks ${tickClass}`;
                tickSpan.textContent = ticks;
                info.appendChild(tickSpan); }
            msg.appendChild(info);
            let longPressTimer = null;
            const startLongPress = () => { if (!isAdmin) return;
                longPressTimer = setTimeout(() => { if (confirm('Удалить сообщение?')) { db.ref('chat_v4/' + key)
                        .remove(); } }, 700); };
            const cancelLongPress = () => { if (longPressTimer) { clearTimeout(longPressTimer);
                    longPressTimer = null; } };
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
                const b = await new Promise(res => { const r = new FileReader();
                    r.onload = e => { const img = new Image();
                        img.onload = () => { const c = document.createElement('canvas');
                            const max = 800;
                            let w = img.width,
                                h = img.height; if (w > h && w > max) { h *= max / w;
                                w = max; } else if (h > max) { w *= max / h;
                                h = max; } c.width = w;
                            c.height = h;
                            c.getContext('2d').drawImage(img, 0, 0, w, h);
                            res(c.toDataURL('image/jpeg', 0.7)); };
                        img.src = e.target.result; };
                    r.readAsDataURL(f); });
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
                    thumb.innerHTML =
                        `<img src="${src}"><div class="preview-remove" onclick="removePreviewPhoto(${index})">×</div>`;
                    previewBox.appendChild(thumb);
                });
                previewBox.style.display = 'flex';
            } else { previewBox.style.display = 'none'; }
            previewArea.style.display = pendingPhotos.length ? 'block' : 'none';
        }

        function removePreviewPhoto(index) { pendingPhotos.splice(index, 1);
            renderPreviewArea(); }

        function sendChat() {
            const msgInput = document.getElementById("chatMsg");
            const text = msgInput.value.trim();
            if (isMuted) { renderMuteState(); return; }
            if (!text && !pendingPhotos.length) return;
            db.ref("chat_v4").push({ name: currentUser, text: text, images: pendingPhotos.length ? pendingPhotos : null,
                time: Date.now() });
            msgInput.value = "";
            pendingPhotos = [];
            renderPreviewArea();
        }

        function handleChatKey(event) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault();
                sendChat(); } }

        function switchTab(t) {
            currentTab = t;
            ["view-main", "view-sched", "view-chat", "view-settings"].forEach(v => document.getElementById(v).style
                .display = "none");
            ["btn-main", "btn-sched", "btn-chat", "btn-settings"].forEach(b => document.getElementById(b).className =
                "glass-btn");
            if (document.getElementById("btn-" + t)) document.getElementById("btn-" + t).className = "primary";
            document.getElementById("view-" + t).style.display = t === 'chat' ? 'flex' : 'block';
            if (t === 'chat') {
                lastChatViewTime = Date.now();
                localStorage.setItem("lastChatView", lastChatViewTime);
                updateBadge(0);
                db.ref("chat_v4").limitToLast(10).once("value", snap => { snap.forEach(s => { if (s.val().name !==
                        currentUser) db.ref("chat_v4/" + s.key + "/readBy").child(currentUser).set(
                        true); }); });
                setTimeout(() => { const b = document.getElementById("chat-messages");
                    b.scrollTop = b.scrollHeight; }, 50);
            }
        }

        function updateBadge(n) { const b = document.getElementById("chat-badge");
            b.innerText = n;
            b.style.display = n > 0 ? "block" : "none"; }

        function openFullImg(s) { document.getElementById("lightbox-img").src = s;
            document.getElementById("lightbox").style.display = "flex"; }

        function showCtx(e, k, a) { e.preventDefault(); if (!isAdmin && a !== currentUser) return; const m = document.getElementById(
                "context-menu");
            m.style.display = "block";
            m.style.left = e.pageX + "px";
            m.style.top = e.pageY + "px";
            document.getElementById("ctx-delete").onclick = () => { if (confirm("Удалить?")) db.ref("chat_v4/" + k)
                .remove(); }; }

        // ===================== UTILS =====================

                function getMyIp() { return fetch("https://api.ipify.org?format=json").then(res => res.ok ? res.json() : null).then(
            data => data?.ip || "").catch(() => ""); }

        function fetchAndStoreMyIp() { return getMyIp().then(ip => { currentIp = ip || ""; if (currentUser && currentIp) { db
                    .ref(`users/${currentUser}`).update({ ip: currentIp, lastSeen: Date.now() }); } return currentIp; }); }

        // ===================== PROFILE =====================
        function showProfileModal(userName = currentUser) { cancelAvatarEdit();
            profileViewUser = userName;
            profileEditable = userName === currentUser;
            document.getElementById("profileName").innerText = userName + (profileEditable ? "" : " (просмотр)");
            document.getElementById("profileRole").innerText = profileEditable ? (isAdmin ? "Администратор" : "") : (userAvatars[
                userName]?.admin ? "Администратор" : ""); const profileAvatar = document.getElementById("profileAvatarPreview");
            const avatarUrl = userAvatars[userName]?.avatar ||
                "https://cdn-icons-png.flaticon.com/512/149/149071.png"; if (profileAvatar) { profileAvatar.src = avatarUrl;
                profileAvatar.style.cursor = profileEditable ? 'pointer' : 'default'; } document.getElementById(
                'profileEditBtn').style.display = profileEditable ? 'block' : 'none';
            loadProfileStats(userName);
            document.getElementById("profileModal").style.display = "flex"; }

        function loadProfileStats(userName = currentUser) { db.ref("shifts").orderByChild("date").once("value").then(snap => { let
                totalSalary = 0, shiftsCount = 0, totalOrders = 0, totalOpt = 0, totalFbo = 0;
            snap.forEach(child => { const d = child.val(); if (d.participants && d.participants[userName]) {
                    shiftsCount++; const myData = d.participants[userName];
                    totalSalary += myData.earned || 0;
                    totalOrders += myData.orders || ((d.total || 0) / (d.numParticipants || 1));
                    totalOpt += myData.optOrders || ((d.opt || 0) / (d.numParticipants || 1));
                    totalFbo += myData.fboOrders || ((d.fbo || 0) / (d.numParticipants || 1)); } });
            document.getElementById("profileStats").innerHTML =
                `<div>Смен отработано: <b>${shiftsCount}</b></div><div>Всего заказов: <b>${Math.round(totalOrders)}</b></div><div>Оптовых заказов: <b>${Math.round(totalOpt)}</b></div><div>ФБО заказов: <b>${Math.round(totalFbo)}</b></div><div>Заработано всего: <b>${Math.round(totalSalary)} ₽</b></div>`;
            const profileAvatar = document.getElementById("profileAvatarPreview"); if (profileAvatar && userAvatars[
                userName]) profileAvatar.src = userAvatars[userName].avatar || profileAvatar.src; }); }

        function triggerAvatarInput() { if (!profileEditable) return;
            document.getElementById('avatarInp').click(); }

        // ===================== THEME =====================
        function toggleTheme() { const html = document.documentElement; const isDark = html.classList.contains('dark-mode'); const
            themeBtn = document.getElementById('btn-theme'); if (isDark) { html.classList.remove('dark-mode');
            themeBtn.innerText = '🌙';
            localStorage.setItem('theme', 'light'); } else { html.classList.add('dark-mode');
            themeBtn.innerText = '☀️';
            localStorage.setItem('theme', 'dark'); } }

        function initTheme() { const theme = localStorage.getItem('theme') || 'light'; const html = document.documentElement; const
            themeBtn = document.getElementById('btn-theme'); if (theme === 'dark') { html.classList.add('dark-mode'); if (
                themeBtn) themeBtn.innerText = '☀️'; } else { html.classList.remove('dark-mode'); if (themeBtn) themeBtn
                .innerText = '🌙'; } }

        // ===================== ADMIN =====================
        function refreshAdminData() { if (isAdmin) listenAdminUsers(); }

        function addNewAdmin() { if (!isAdmin) return; const name = document.getElementById("adminInp").value.trim(); if (!name)
                return; if (/[.$#[\]/]/.test(name)) { alert("Имя не должно содержать символы . $ # [ ] /"); return; } db.ref(
                    `admins/${name}`).set(true).then(() => db.ref(`users/${name}`).update({ admin: true })).then(() => { document
                    .getElementById("adminInp").value = ""; }).catch(err => { console.error(err);
                alert("Не удалось сделать пользователя администратором"); }); }

        function removeAdmin(name) { if (!isAdmin || !name) return; if (!confirm(`Снять права администратора у ${name}?`))
                return; db.ref(`admins/${name}`).remove().then(() => db.ref(`users/${name}`).update({ admin: false })).catch(
                err => { console.error(err);
                alert("Не удалось снять права администратора"); }); }

        function toggleMuteUser(name) { if (!isAdmin || !name) return; const trimmed = name.trim(); if (!trimmed) return; const
            mutePath = `muted_users/${trimmed}`; if (mutedUsers[trimmed]) { db.ref(mutePath).remove(); } else { db.ref(
                mutePath).set({ mutedBy: currentUser, at: Date.now() }); } }

        function deleteUser(name) { if (!isAdmin || !name) return; if (!confirm(`Удалить пользователя ${name} из сайта? Это действие необратимо.`))
                return; const safeName = name.trim();
            db.ref(`users/${safeName}`).remove();
            db.ref(`admins/${safeName}`).remove();
            db.ref(`muted_users/${safeName}`).remove();
            db.ref(`presence/${safeName}`).remove(); }

        function renderMuteState() { const banner = document.getElementById('muteBanner'),
                sendBtn = document.getElementById('sendChatBtn'),
                msgInput = document.getElementById('chatMsg'); if (!banner || !sendBtn || !msgInput) return; if (isMuted) { banner
                    .style.display = 'block';
                sendBtn.disabled = true;
                sendBtn.style.opacity = '0.6';
                msgInput.placeholder = 'Ты в муте, чел'; } else { banner.style.display = 'none';
                sendBtn.disabled = false;
                sendBtn.style.opacity = '1';
                msgInput.placeholder = 'пиши...'; } }

        function renderOnlineUsers() { const container = document.getElementById("onlineUsersList"); if (!container) return; const
            onlineNames = Object.keys(latestPresence || {}).sort(); if (!onlineNames.length) { container.innerHTML =
                '<div style="color:#aaa">Никого нет в сети</div>'; return; } container.innerHTML = onlineNames.map(name =>
                `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 12px; background:rgba(99, 102, 241, 0.04); border-radius:10px; border: 1px solid var(--border);"><span style="font-weight:700; color:var(--text);">${escapeHtml(name)}</span><span style="opacity:.7; font-size:13px; color:#64748b;">${latestUsers[name]?.lastSeen ? new Date(latestUsers[name].lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>`
                ).join(""); }

        function listenAdminUsers() { db.ref("users").on("value", snap => { const users = snap.val() || {};
                latestUsers = users; Promise.all([db.ref("blocked_ips").once("value"), db.ref("admins").once("value"), db.ref(
                    "muted_users").once("value")]).then(([blockSnap, adminSnap, muteSnap]) => { currentBlockedIps =
                    blockSnap.val() || {};
                currentAdmins = adminSnap.val() || {};
                mutedUsers = muteSnap.val() || {};
                renderAdminUsers(users, currentBlockedIps, currentAdmins);
                renderBlockedIps(currentBlockedIps); });
            renderOnlineUsers(); });
            db.ref("blocked_ips").on("value", snap => { currentBlockedIps = snap.val() || {};
                renderBlockedIps(currentBlockedIps);
                renderAdminUsers(latestUsers, currentBlockedIps, currentAdmins); });
            db.ref("admins").on("value", snap => { currentAdmins = snap.val() || {};
                renderAdminUsers(latestUsers, currentBlockedIps, currentAdmins); });
            db.ref("muted_users").on("value", snap => { mutedUsers = snap.val() || {}; if (currentUser) { isMuted = !!mutedUsers[
                    currentUser];
                renderMuteState(); } renderAdminUsers(latestUsers, currentBlockedIps, currentAdmins); });
            db.ref("active_shift").on("value", snap => { renderActiveShiftAdmin(snap.val()); });
            listenForJoinRequestsCleanup();
        }

        function renderAdminUsers(users, blocked, admins) { if (!users || !blocked || !admins) return; let html = ""; Object.keys(
            users).sort().forEach(name => { if (!name) return; const user = users[name] || {},
                ip = user.ip || "",
                ipKey = ip ? dbKey(ip) : ""; const isBlocked = ip && blocked[ipKey],
                isUserAdmin = !!admins[name] || !!user.admin || name.toLowerCase() === "дениска",
                isUserMuted = !!mutedUsers[name];
            html +=
                `<div class="admin-user-card"><div class="user-info"><div style="font-weight:700;">${escapeHtml(name)}${isUserAdmin?'<span style="font-size:10px; color:#38bdf8; margin-left:6px;">admin</span>':''}</div><div class="admin-user-status">IP: ${escapeHtml(ip||'нет')}${isUserMuted?' · muted':''}</div></div><div class="admin-actions"><button class="glass-btn admin-action-btn" onclick="showProfileModal('${escapeJsString(name)}')">Просмотр</button><button class="glass-btn admin-action-btn" style="${isUserMuted?'background:#ff3b30;color:#111;':''}" onclick="toggleMuteUser('${escapeJsString(name)}')">${isUserMuted?'Размутить':'Мут'}</button>${ip?`<button class="glass-btn admin-action-btn" style="${isBlocked?'background:#ff3b30;color:#111;':''}" onclick="${isBlocked?`unblockIp('${escapeJsString(ipKey)}')`:`blockIp('${escapeJsString(ipKey)}')`}">${isBlocked?'Разблокировать':'Заблокировать'}</button>`:'<button class="glass-btn admin-action-btn" style="opacity:.5; cursor:not-allowed;" disabled>нет IP</button>'}${isUserAdmin&&name.toLowerCase()!=="дениска"?`<button class="glass-btn admin-action-btn" style="background:rgba(255,255,255,0.08);" onclick="removeAdmin('${escapeJsString(name)}')">Снять admin</button>`:''}<button class="glass-btn admin-action-btn" style="background: rgba(255,59,48,0.12); color:#ff7f84;" onclick="deleteUser('${escapeJsString(name)}')">Удалить</button></div></div>`; }); const container = document
            .getElementById("adminUsersList"); if (container) container.innerHTML = html ||
                '<div style="color:#aaa">Нет зарегистрированных пользователей</div>'; }

        function renderActiveShiftAdmin(shift) {
            const adminShiftContainer = document.getElementById("adminActiveShiftPanel");
            if (!adminShiftContainer) return;
            if (!shift) { adminShiftContainer.innerHTML = '<div style="color:#aaa; padding:15px;">Нет активной смены</div>';
                return; }
            const startTime = new Date(shift.startTime).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
            const diffMs = Date.now() - shift.startTime;
            const diffH = Math.floor(diffMs / 3600000);
            const diffM = Math.floor((diffMs % 3600000) / 60000);
            const durationFormatted = `${diffH}ч ${diffM}мин`;
            const activeParticipants = shift.participants || {};
            const allParticipants = getMergedParticipants(shift);
            const totalEarnings = calculateTotalSalary(allParticipants);
            const totalPlaces = getTotalPlaces(shift);
            const totalOrders = (shift.cdek || 0) + (shift.wb || 0) + (shift.dost || 0) + (shift.fbo || 0);
            let participantsHtml = "";
            Object.entries(activeParticipants).forEach(([name, data]) => { participantsHtml +=
                    `<div style="display:flex; justify-content:space-between; padding:8px 10px; border-bottom: 1px solid var(--border);"><span>${escapeHtml(name)}</span><span style="font-weight:600;">${Number(data.earned||0).toFixed(0)} ₽</span></div>`; });
            adminShiftContainer.innerHTML =
                `<div class="admin-panel-section"><h3 style="margin-top:0; color:var(--text);">Активная смена Admin</h3><div style="background:var(--card-bg); border:1px solid var(--border); border-radius:10px; padding:15px; margin-bottom:15px;"><div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:15px;"><div><div style="font-size:12px; color:var(--text-secondary); margin-bottom:4px;">Начало:</div><div style="font-weight:600; color:var(--text);">${startTime}</div></div><div><div style="font-size:12px; color:var(--text-secondary); margin-bottom:4px;">Длительность:</div><div style="font-weight:600; color:var(--text);">${durationFormatted}</div></div><div><div style="font-size:12px; color:var(--text-secondary); margin-bottom:4px;">Активных:</div><div style="font-weight:600; color:var(--text);">${Object.keys(activeParticipants).length}</div></div><div><div style="font-size:12px; color:var(--text-secondary); margin-bottom:4px;">Заказы / Места:</div><div style="font-weight:600; color:var(--text);">${totalOrders} / ${totalPlaces}</div></div><div><div style="font-size:12px; color:var(--text-secondary); margin-bottom:4px;">Общий заработок:</div><div style="font-weight:600; color:var(--accent);">${totalEarnings.toFixed(0)} ₽</div></div></div><div style="background:var(--bg); border-radius:8px; max-height:150px; overflow-y:auto; margin-bottom:15px;">${participantsHtml||'<div style="padding:10px; color:var(--text-secondary);">Нет активных участников</div>'}</div><button class="danger" style="width:100%; padding:10px; font-size:14px; font-weight:600;" onclick="closeShiftFromAdmin()">Закрыть смену для всех</button></div></div>`;
        }

        function renderBlockedIps(blocked) { let html = ""; Object.keys(blocked).sort().forEach(ipKey => { const item = blocked[
                ipKey] || {},
            ip = dbKeyToValue(ipKey);
        html +=
            `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px; background:white; border: 1px solid var(--border); border-radius:10px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);"><div><div style="font-weight:700; color:var(--text);">${escapeHtml(ip)}</div><div style="font-size:12px; color:#64748b;">${item.blockedBy?`Заблокировал: ${escapeHtml(item.blockedBy)}`:''}${item.at?` ${new Date(item.at).toLocaleString()}`:''}</div></div><button class="glass-btn" style="font-size:12px; padding:8px 12px;" onclick="unblockIp('${escapeJsString(ipKey)}')">Разблокировать</button></div>`; }); document.getElementById("blockedIpsList").innerHTML = html ||
            '<div style="color:#aaa">Нет заблокированных IP</div>'; }

        function blockIp(ipKey) { const ip = dbKeyToValue(ipKey); if (!ipKey || !confirm(`Блокировать IP ${ip}?`)) return; db.ref(
            `blocked_ips/${ipKey}`).set({ blockedBy: currentUser, at: Date.now() }); }

        function unblockIp(ipKey) { const ip = dbKeyToValue(ipKey); if (!ipKey || !confirm(`Разблокировать IP ${ip}?`)) return; db
            .ref(`blocked_ips/${ipKey}`).remove(); }

        // ===================== SCHEDULE =====================
        const FUTURE_MONTHS_TO_SYNC = 24;

        function getMonthKey(year, month) { return `${year}-${month}`; }

        function getFutureMonthKeys(year, month, count = FUTURE_MONTHS_TO_SYNC) { const keys = []; for (let i = 0; i <= count;
            i++) { const d = new Date(year, month + i, 1);
            keys.push(getMonthKey(d.getFullYear(), d.getMonth())); } return keys; }

        function renderSched() { const y = scheduleDate.getFullYear(),
                m = scheduleDate.getMonth(),
                days = new Date(y, m + 1, 0).getDate(); const weekDays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]; const
            monthLabel = document.getElementById("monthLabel"); if (monthLabel) monthLabel.innerText =
                `${(m+1).toString().padStart(2,'0')}.${y}`; let h = "<th>Имя</th>"; for (let i = 1; i <= days; i++) { let d =
                new Date(y, m, i);
            h +=
                `<th class="${(d.getDay()===0||d.getDay()===6)?'weekend':''}"><span class="day-name">${weekDays[d.getDay()]}</span>${i}</th>`; } const
            hRow = document.getElementById("h-row"); if (hRow) hRow.innerHTML = h; if (currentSchedRef) currentSchedRef.off();
            currentSchedRef = db.ref(`schedule/${y}-${m}/${scheduleMode}`);
            currentSchedRef.on("value", snap => { const bRows = document.getElementById("b-rows"); if (!bRows) return; const
                data = snap.val() || {}; let html = ""; Object.keys(data).sort().forEach(n => { if (!n) return; const row =
                    data[n] || {};
                html +=
                    `<tr><td class="name-col" data-name="${escapeHtml(n)}" onclick="deleteStaff('${escapeJsString(n)}')">${escapeHtml(n)}</td>`;
                for (let i = 1; i <= days; i++) { const isWork = row[i] === "10-22";
                    html +=
                        `<td><div class="cell-box ${isWork?'st-work':''}" onclick="toggleWorkCell('${y}-${m}','${escapeJsString(n)}',${i},${isWork})"></div></td>`; } html +=
                    "</tr>"; });
                bRows.innerHTML = html; }, err => { console.error('Schedule listen error:', err); }); }

        function setMode(mode) { if (scheduleMode === mode) return;
            scheduleMode = mode;
            document.getElementById("t-day").className = mode === "day" ? "primary" : "glass-btn";
            document.getElementById("t-night").className = mode === "night" ? "primary" : "glass-btn";
            renderSched(); }

        function changeMonth(delta) { scheduleDate.setMonth(scheduleDate.getMonth() + delta);
            renderSched(); }

        function deleteStaff(name) { if (!isAdmin) return; if (!confirm(
                `Точно удалить ${name} из графика на этот и последующие месяцы?`)) return; const currentY = scheduleDate
            .getFullYear(),
            currentM = scheduleDate.getMonth(); const monthKeys = getFutureMonthKeys(currentY, currentM); Promise.all(monthKeys
                .map(key => db.ref(`schedule/${key}/${scheduleMode}/${name}`).remove())).then(() => renderSched()).catch(err => {
                console.error("deleteStaff error", err);
                alert("Ошибка при удалении сотрудника"); }); }

        function addNewStaff() { if (!isAdmin) return; const name = document.getElementById("staffInp").value.trim(); if (!name)
                return; if (/[.$#[\]/]/.test(name)) { alert("Имя не должно содержать символы . $ # [ ] /"); return; } const
            currentY = scheduleDate.getFullYear(),
            currentM = scheduleDate.getMonth(); const monthKeys = getFutureMonthKeys(currentY, currentM); const updates = {};
            monthKeys.forEach(key => { updates[`schedule/${key}/${scheduleMode}/${name}/createdAt`] = Date.now(); });
            db.ref().update(updates).then(() => { document.getElementById("staffInp").value = ""; }).catch(err => { console.error(
                "addNewStaff error", err);
            alert("Ошибка при добавлении сотрудника"); }); }

        function toggleWorkCell(path, name, day, isWork) { if (!isAdmin) return; const ref = db.ref(
            `schedule/${path}/${scheduleMode}/${name}/${day}`); if (isWork) { ref.remove(); } else { ref.set("10-22"); } }

        // ===================== PRESENCE =====================
        function setupPresence() { if (!currentUser) return; const r = db.ref(`presence/${currentUser}`);
            r.set("online").catch(e => {});
            r.onDisconnect().remove(); let presenceFirst = true;
            db.ref("presence").on("value", snap => { latestPresence = snap.val() || {}; const m = document.getElementById(
                    "presence-mini"); if (m) { m.innerHTML = ""; const count = Object.keys(latestPresence).length; for (
                    let i = 0; i < count; i++) { m.innerHTML +=
                        `<div style="width:6px;height:6px;background:var(--online);border-radius:50%;"></div>`; } } if (
                    presenceFirst) { renderOnlineUsers();
                    presenceFirst = false; } }, err => {}); }

        // ===================== AVATAR =====================
        function uploadAvatar(input) { if (input.files[0]) { const reader = new FileReader();
            reader.onload = e => { const img = new Image();
                img.onload = () => { avatarEditorImage = img;
                    avatarMinScale = Math.max(220 / img.width, 220 / img.height);
                    avatarScale = avatarMinScale;
                    avatarOffset = { x: 0, y: 0 };
                    document.getElementById('avatarEditor').style.display = 'block';
                    document.getElementById('profileAvatarPreview').style.opacity = '0.6';
                    updateAvatarCanvas(); };
                img.src = e.target.result; };
            reader.readAsDataURL(input.files[0]); } }

        function cancelAvatarEdit() { avatarEditorImage = null;
            document.getElementById('avatarEditor').style.display = 'none';
            document.getElementById('profileAvatarPreview').style.opacity = '1'; }

        function saveAvatar() { if (!avatarEditorImage) return; const canvas = document.getElementById('avatarCanvas'); const
            dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            db.ref(`users/${currentUser}/avatar`).set(dataUrl);
            document.getElementById('myAvatar').src = dataUrl;
            document.getElementById('profileAvatarPreview').src = dataUrl;
            cancelAvatarEdit(); }

        function updateAvatarCanvas() { const canvas = document.getElementById('avatarCanvas'); if (!canvas || !
                avatarEditorImage) return; const ctx = canvas.getContext('2d'),
                size = canvas.width;
            ctx.clearRect(0, 0, size, size); const w = avatarEditorImage.width * avatarScale,
                h = avatarEditorImage.height * avatarScale,
                x = size / 2 - w / 2 + avatarOffset.x,
                y = size / 2 - h / 2 + avatarOffset.y;
            ctx.drawImage(avatarEditorImage, x, y, w, h);
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
            ctx.stroke(); }

        function clampAvatarOffset() { if (!avatarEditorImage) return; const size = 220,
            w = avatarEditorImage.width * avatarScale,
            h = avatarEditorImage.height * avatarScale,
            maxX = Math.max(0, (w - size) / 2),
            maxY = Math.max(0, (h - size) / 2);
            avatarOffset.x = Math.max(-maxX, Math.min(maxX, avatarOffset.x));
            avatarOffset.y = Math.max(-maxY, Math.min(maxY, avatarOffset.y)); }

        function zoomAvatar(delta) { if (!avatarEditorImage) return;
            avatarScale = Math.max(avatarMinScale, avatarScale + delta);
            clampAvatarOffset();
            updateAvatarCanvas(); }

        function initAvatarEditor() { const canvas = document.getElementById('avatarCanvas'); if (!canvas) return;
            canvas.onpointerdown = e => { if (!avatarEditorImage) return;
                avatarDragStart = { x: e.clientX, y: e.clientY, offsetX: avatarOffset.x, offsetY: avatarOffset.y };
                canvas.setPointerCapture(e.pointerId); };
            canvas.onpointermove = e => { if (!avatarDragStart) return;
                avatarOffset.x = avatarDragStart.offsetX + (e.clientX - avatarDragStart.x);
                avatarOffset.y = avatarDragStart.offsetY + (e.clientY - avatarDragStart.y);
                clampAvatarOffset();
                updateAvatarCanvas(); };
            canvas.onpointerup = canvas.onpointercancel = () => { avatarDragStart = null; }; }
        initAvatarEditor();
