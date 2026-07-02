
  function startShift() {
            const participant = createParticipantData(Date.now());
            db.ref("active_shift").set({
                startTime: Date.now(),
                cdek: 0,
                wb: 0,
                dost: 0,
                fbo: 0,
                opt: 0,
                cdek_places: 0,
                dost_places: 0,
                fboArticles: {},
                participants: { [currentUser]: participant },
                allParticipants: { [currentUser]: participant }
            });
        }


   function joinShift() {
            if (!currentUser) { alert("Ошибка: пользователь не авторизован"); return; }
            db.ref("active_shift/participants").once("value", snap => {
                const participants = snap.val() || {};
                const creator = Object.keys(participants)[0];
                if (!creator) {
                    alert("Нет активной смены для присоединения.");
                    return;
                }
                if (participants[currentUser]) {
                    alert("Вы уже участвуете в этой смене.");
                    return;
                }
                const requestRef = db.ref(`join_requests/${creator}/${currentUser}`);
                requestRef.set({
                    requester: currentUser,
                    timestamp: Date.now()
                }).then(() => {
                    alert("Запрос на присоединение отправлен.");
                });
                listenForJoinResponse(creator);
            });
        }



 function leaveShift() {
            if (!currentUser) { alert("Ошибка: пользователь не авторизован"); return; }
            db.ref("active_shift").once("value", snap => {
                const shift = snap.val();
                if (!shift || !shift.participants || !shift.participants[currentUser]) return;
                const currentMember = shift.participants[currentUser];
                const myEarned = currentMember.earned || 0;
                const cdekCount = shift.cdek || 0,
                    wbCount = shift.wb || 0,
                    dostCount = shift.dost || 0,
                    optCount = shift.opt || 0,
                    fboCount = shift.fbo || 0;
                const totalCount = cdekCount + wbCount + dostCount + fboCount;
                const totalPlaces = getTotalPlaces(shift);
                const startT = new Date(shift.startTime || Date.now()),
                    endT = new Date();
                const reportText =
                    `<b>Вы вышли со смены!</b><br><br>Общая статистика смены:<br>Заказы: ${totalCount} | Мест: ${totalPlaces} | ФБО: ${fboCount} | Оптовые: ${optCount}<br><br><span style="color:var(--accent); font-weight:800; font-size:22px;">Твоя доля: ${myEarned.toFixed(0)}₽</span><br><br><span style="font-size:12px; color:#888;">${startT.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})} - ${endT.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})}</span>`;
                document.getElementById("reportDetails").innerHTML = reportText;
                document.getElementById("reportModal").style.display = "flex";
                const allParticipants = getMergedParticipants(shift);
                allParticipants[currentUser] = currentMember;
                const participantCount = Object.keys(shift.participants).length;
                if (participantCount <= 1) {
                    const numParts = Object.keys(allParticipants).length;
                    const totalSalary = calculateTotalSalary(allParticipants);
                    const newRef = db.ref("shifts").push();
                    newRef.set({
                        date: startT.toLocaleDateString(),
                        total: totalCount,
                        cdek: cdekCount,
                        wb: wbCount,
                        dost: dostCount,
                        fbo: fboCount,
                        opt: optCount,
                        cdek_places: shift.cdek_places || cdekCount,
                        dost_places: shift.dost_places || dostCount,
                        total_places: totalPlaces,
                        fboArticles: JSON.parse(JSON.stringify(shift.fboArticles || {})),
                        totalSalary,
                        numParticipants: numParts,
                        participants: JSON.parse(JSON.stringify(allParticipants)),
                        start: startT.toLocaleString(),
                        end: endT.toLocaleString(),
                        startTime: shift.startTime,
                        endTime: Date.now(),
                        closedBy: currentUser,
                        closedAt: Date.now()
                    }).then(() => { db.ref("active_shift").remove();
                        openSurveyModal(newRef.key); });
                } else {
                    db.ref().update({
                        "active_shift/allParticipants": allParticipants,
                        [`active_shift/participants/${currentUser}`]: null
                    }).catch(err => { console.error("leaveShift error:", err);
                        alert("Ошибка при выходе со смены"); });
                }
            });
        }

 function addCounter(type) {
            if (!type || !currentUser) return;
            db.ref("active_shift").transaction(shift => {
                if (!shift || !shift.participants || !shift.participants[currentUser]) return;
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
            if (!type || !currentUser) return;
            db.ref("active_shift").transaction(shift => {
                if (!shift || !shift.participants || !shift.participants[currentUser] || !shift[type] || shift[type] <=
                    0) return;
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
                    else if (type === 'cdek') part.cdekOrders = Math.max(0, (part.cdekOrders || 0) -
                        orderDecrement);
                    else if (type === 'wb') part.wbOrders = Math.max(0, (part.wbOrders || 0) - orderDecrement);
                    else if (type === 'dost') part.dostOrders = Math.max(0, (part.dostOrders || 0) - orderDecrement);
                });
                return shift;
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

 function addFboArticle() {
            if (!currentUser || !isGlobalParticipant) return;
            const input = document.getElementById('fboArticleInput');
            const rawArticle = (input?.value || '').trim();
            if (!rawArticle) return;
            if (!currentFboSuffix) { alert('Выберите размер (S или F)'); return; }
            if (!currentFboMaterial) { alert('Выберите металл (Цинк или ХКС)'); return; }
            if (!currentFboWidth) { alert('Выберите ширину (1 мм или 1,5 мм)'); return; }
            const fullArticle = `${rawArticle}${currentFboSuffix} ${currentFboMaterial} ${currentFboWidth}`;
            const articleId = db.ref('active_shift/fboArticles').push().key;
            db.ref('active_shift').transaction(shift => {
                if (!shift || !shift.participants || !shift.participants[currentUser]) return;
                const participants = Object.keys(shift.participants);
                const share = 80 / participants.length;
                const inc = participants.length === 1 ? 1 : 1 / participants.length;
                shift.fbo = (shift.fbo || 0) + 1;
                if (!shift.fboArticles) shift.fboArticles = {};
                shift.fboArticles[articleId] = { fullArticle, suffix: currentFboSuffix, material: currentFboMaterial,
                    width: currentFboWidth, share, orderIncrement: inc, participants: participants.reduce((acc,
                        n) => { acc[n] = true; return acc; }, {}), by: currentUser, at: Date.now() };
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
            db.ref('active_shift').transaction(shift => {
                if (!shift || !shift.fboArticles || !shift.fboArticles[articleId]) return shift;
                const item = shift.fboArticles[articleId];
                const affected = item.participants ? Object.keys(item.participants) : Object.keys(shift
                .participants);
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

     function addPlace(type) {
            if (!type || !currentUser || !isGlobalParticipant) return;
            if (type !== 'cdek' && type !== 'dost') return;
            const placeField = type + '_places';
            db.ref("active_shift").transaction(shift => {
                if (!shift || !shift.participants || !shift.participants[currentUser]) return;
                shift[placeField] = (shift[placeField] || 0) + 1;
                return shift;
            });
        }

 function removePlace(type) {
            if (!type || !currentUser || !isGlobalParticipant) return;
            if (type !== 'cdek' && type !== 'dost') return;
            const placeField = type + '_places';
            db.ref("active_shift").transaction(shift => {
                if (!shift || !shift.participants || !shift.participants[currentUser]) return;
                if (!shift[placeField] || shift[placeField] <= 0) return;
                shift[placeField]--;
                return shift;
            });
        }

function listenActiveShift() {
            db.ref("active_shift").on("value", snap => {
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
                    isGlobalParticipant = parts[currentUser] !== undefined;

                    let partsText = "<b style='color:var(--accent);'>🟢 Смена в эфире:</b><br><br>";
                    Object.keys(parts).forEach(p => {
                        partsText +=
                            `• ${escapeHtml(p)} <span style="float:right; opacity:0.8;">${Number(parts[p].earned || 0).toFixed(0)}₽</span><br>`;
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
                            `Моя доля: ${Number(parts[currentUser].earned || 0).toFixed(0)}₽`;
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

 function listenHistory() {
            const historyBox = document.getElementById("history");
            if (!historyBox) return;
            db.ref("shifts").limitToLast(15).on("value", snap => {
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
                        <div style="margin-top:4px; font-weight:700;">Всего мест: ${totalPlaces}</div>
                    `;
                    const fboArticlesHtml = fboArticles.length ?
                        `<div style="margin-top:10px;"><b>Артикулы ФБО:</b><div style="margin-top:6px; display:flex; flex-direction:column; gap:5px;">${fboArticles.map(item => `<div style="padding:6px 8px; background:rgba(99,102,241,0.06); border-radius:8px;"><b>${escapeHtml(item.fullArticle || '')}</b>${item.by ? ` <span style="opacity:0.65;">от ${escapeHtml(item.by)}</span>` : ''}</div>`).join("")}</div></div>` :
                        '';
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
                        ${placesDetailHtml}
                        ${fboArticlesHtml}
                        ${surveyHtml}
                    `;
                    const dateLabel = escapeHtml(d.date || (d.start && String(d.start).includes(",") ? String(d.start)
                        .split(",")[0] : "без даты"));
                    const startPart = d.start && String(d.start).includes(",") ? String(d.start).split(",")[1].trim() :
                        "";
                    const endPart = d.end && String(d.end).includes(",") ? String(d.end).split(",")[1].trim() : "";
                    const timeLabel = startPart || endPart ?
                        `${startPart}${startPart && endPart ? " - " : ""}${endPart}` : "";
                    const deleteButton = isAdmin ?
                        `<button class="danger" style="position:absolute; right:10px; top:10px; padding:5px 10px; z-index:2;" onclick="event.stopPropagation(); if(confirm('Удалить смену из истории?')) db.ref('shifts/${escapeJsString(s.key)}').remove();">×</button>` :
                        "";
                    html = `<div class="card history-card" style="padding:15px; text-align:left;" onclick="toggleShiftDetails(this)">
                        <div style="padding-bottom: 32px;"><div><b style="font-size:16px;">Смена ${dateLabel}</b></div></div>
                        <div style="margin: 8px 0; font-size: 14px; color:var(--text-secondary);">Общий заработок: <span style="color:var(--accent); font-weight:800; font-size:18px;">${Math.round(Number(d.totalSalary || 0))}₽</span></div>
                        <div style="margin: 4px 0; font-size: 13px; color:var(--text-secondary);">Заказов: ${d.total || 0} | Мест: ${totalPlaces}</div>
                        <div class="history-details" style="display:none; padding: 8px; background: rgba(99,102,241,0.04); border-radius: 8px; font-size: 13px;">${detailsHtml}</div>
                        ${deleteButton}
                        <div class="history-arrow">▼</div>
                        ${timeLabel ? `<small style="opacity:0.6; display:block; margin-top:8px;">${escapeHtml(timeLabel)}</small>` : ''}
                        <button class="export-btn" style="margin-top:10px; width:100%;" onclick="event.stopPropagation(); exportShiftToImage(${JSON.stringify(d).replace(/"/g, '&quot;')})">📊 Скачать отчёт (PNG)</button>
                    </div>` + html;
                });
                historyBox.innerHTML = html ||
                    `<div class="card" style="text-align:center; color:var(--text-secondary);">Истории смен пока нет</div>`;
            }, err => { console.error("listenHistory error:", err);
                historyBox.innerHTML =
                `<div class="card" style="color:#dc2626;">Ошибка загрузки истории смен</div>`; });
        }
function closeShift() {
            if (!currentUser || !isAdmin) return;
            if (!confirm("Закрыть смену для всех?")) return;
            db.ref("active_shift").once("value", snap => {
                const shift = snap.val();
                if (!shift || !shift.participants) return;
                const startT = new Date(shift.startTime || Date.now()),
                    endT = new Date();
                const cdekCount = shift.cdek || 0,
                    wbCount = shift.wb || 0,
                    dostCount = shift.dost || 0,
                    optCount = shift.opt || 0,
                    fboCount = shift.fbo || 0;
                const totalCount = cdekCount + wbCount + dostCount + fboCount;
                const totalPlaces = getTotalPlaces(shift);
                const allParticipants = getMergedParticipants(shift);
                const numParts = Object.keys(allParticipants).length;
                const totalSalary = calculateTotalSalary(allParticipants);
                const reportText =
                    `<b>Смена закрыта!</b><br><br>Общая статистика смены:<br>Заказы: ${totalCount} | Мест: ${totalPlaces} | ФБО: ${fboCount} | Оптовые: ${optCount}<br><br><span style="color:var(--accent); font-weight:800; font-size:20px;">Общий заработок: ${Math.round(totalSalary)}₽</span><br><br><span style="font-size:12px; color:#888;">${startT.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})} - ${endT.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})}</span>`;
                document.getElementById("reportDetails").innerHTML = reportText;
                document.getElementById("reportModal").style.display = "flex";
                const newRef = db.ref("shifts").push();
                newRef.set({
                    date: startT.toLocaleDateString(),
                    total: totalCount,
                    cdek: cdekCount,
                    wb: wbCount,
                    dost: dostCount,
                    fbo: fboCount,
                    opt: optCount,
                    cdek_places: shift.cdek_places || cdekCount,
                    dost_places: shift.dost_places || dostCount,
                    total_places: totalPlaces,
                    fboArticles: JSON.parse(JSON.stringify(shift.fboArticles || {})),
                    totalSalary,
                    numParticipants: numParts,
                    participants: JSON.parse(JSON.stringify(allParticipants)),
                    start: startT.toLocaleString(),
                    end: endT.toLocaleString(),
                    startTime: shift.startTime,
                    endTime: Date.now(),
                    closedBy: currentUser,
                    closedAt: Date.now()
                }).then(() => { db.ref("active_shift").remove();
                    openSurveyModal(newRef.key); })
                    .catch(err => { console.error("closeShift error:", err);
                        alert("Ошибка при закрытии смены"); });
            });
        }


  function closeShiftFromAdmin() {
            if (!isAdmin) return;
            if (!confirm("Закрыть активную смену для всех?")) return;
            db.ref("active_shift").once("value", snap => {
                const shift = snap.val();
                if (!shift || !shift.participants) { alert("Смена уже закрыта"); return; }
                const startT = new Date(shift.startTime || Date.now()),
                    endT = new Date();
                const cdekCount = shift.cdek || 0,
                    wbCount = shift.wb || 0,
                    dostCount = shift.dost || 0,
                    optCount = shift.opt || 0,
                    fboCount = shift.fbo || 0;
                const totalCount = cdekCount + wbCount + dostCount + fboCount;
                const totalPlaces = getTotalPlaces(shift);
                const allParticipants = getMergedParticipants(shift);
                const numParts = Object.keys(allParticipants).length;
                const totalSalary = calculateTotalSalary(allParticipants);
                const now = new Date();
                const archiveKey =
                    `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}_${Date.now()}`;
                db.ref(`shifts/${archiveKey}`).set({
                    date: startT.toLocaleDateString(),
                    total: totalCount,
                    cdek: cdekCount,
                    wb: wbCount,
                    dost: dostCount,
                    fbo: fboCount,
                    opt: optCount,
                    cdek_places: shift.cdek_places || cdekCount,
                    dost_places: shift.dost_places || dostCount,
                    total_places: totalPlaces,
                    fboArticles: JSON.parse(JSON.stringify(shift.fboArticles || {})),
                    totalSalary,
                    numParticipants: numParts,
                    participants: JSON.parse(JSON.stringify(allParticipants)),
                    start: startT.toLocaleString(),
                    end: endT.toLocaleString(),
                    startTime: shift.startTime,
                    endTime: Date.now(),
                    closedBy: currentUser,
                    closedAt: Date.now()
                }).then(() => {
                    db.ref("active_shift").remove();
                    alert("✅ Смена закрыта админом и сохранена в архив");
                    openSurveyModal(archiveKey);
                }).catch(err => {
                    alert("❌ Ошибка при закрытии смены: " + err.message);
                });
            });
        }

 function addFboArticle() {
            if (!currentUser || !isGlobalParticipant) return;
            const input = document.getElementById('fboArticleInput');
            const rawArticle = (input?.value || '').trim();
            if (!rawArticle) return;
            if (!currentFboSuffix) { alert('Выберите размер (S или F)'); return; }
            if (!currentFboMaterial) { alert('Выберите металл (Цинк или ХКС)'); return; }
            if (!currentFboWidth) { alert('Выберите ширину (1 мм или 1,5 мм)'); return; }
            const fullArticle = `${rawArticle}${currentFboSuffix} ${currentFboMaterial} ${currentFboWidth}`;
            const articleId = db.ref('active_shift/fboArticles').push().key;
            db.ref('active_shift').transaction(shift => {
                if (!shift || !shift.participants || !shift.participants[currentUser]) return;
                const participants = Object.keys(shift.participants);
                const share = 80 / participants.length;
                const inc = participants.length === 1 ? 1 : 1 / participants.length;
                shift.fbo = (shift.fbo || 0) + 1;
                if (!shift.fboArticles) shift.fboArticles = {};
                shift.fboArticles[articleId] = { fullArticle, suffix: currentFboSuffix, material: currentFboMaterial,
                    width: currentFboWidth, share, orderIncrement: inc, participants: participants.reduce((acc,
                        n) => { acc[n] = true; return acc; }, {}), by: currentUser, at: Date.now() };
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
            db.ref('active_shift').transaction(shift => {
                if (!shift || !shift.fboArticles || !shift.fboArticles[articleId]) return shift;
                const item = shift.fboArticles[articleId];
                const affected = item.participants ? Object.keys(item.participants) : Object.keys(shift
                .participants);
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

 function addPlace(type) {
            if (!type || !currentUser || !isGlobalParticipant) return;
            if (type !== 'cdek' && type !== 'dost') return;
            const placeField = type + '_places';
            db.ref("active_shift").transaction(shift => {
                if (!shift || !shift.participants || !shift.participants[currentUser]) return;
                shift[placeField] = (shift[placeField] || 0) + 1;
                return shift;
            });
        }

        function removePlace(type) {
            if (!type || !currentUser || !isGlobalParticipant) return;
            if (type !== 'cdek' && type !== 'dost') return;
            const placeField = type + '_places';
            db.ref("active_shift").transaction(shift => {
                if (!shift || !shift.participants || !shift.participants[currentUser]) return;
                if (!shift[placeField] || shift[placeField] <= 0) return;
                shift[placeField]--;
                return shift;
            });
        }
