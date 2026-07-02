function escapeHtml(text) { return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }


function formatChatTimestamp(value) { const dt = new Date(value); const now = new Date(); const today = new Date(now
                .getFullYear(), now.getMonth(), now.getDate()); const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1); const messageDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
            let prefix = ""; if (messageDay.getTime() === today.getTime()) prefix = ""; else if (messageDay.getTime() ===
                yesterday.getTime()) prefix = "Вчера "; else prefix =
                `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth()+1).padStart(2, '0')} `; return prefix + dt
                .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

 function escapeJsString(text) { return String(text || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"')
                .replace(/\r/g, "\\r").replace(/\n/g, "\\n"); }


function dbKey(value) { return encodeURIComponent(String(value || "")).replace(/\./g, "%2E"); }

function dbKeyToValue(key) { try { return decodeURIComponent(key); } catch (err) { return key; } }
