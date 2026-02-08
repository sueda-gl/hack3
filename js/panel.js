// Get agent ID from URL or default to suclaw
const urlParams = new URLSearchParams(window.location.search);
const AGENT_ID = urlParams.get('agent') || 'suclaw';

// Update header with terminal-style title
document.getElementById('panel-agent-name').textContent = `${AGENT_ID}@clawquest ~ %`;

// State
let allMessages = [];
let conversations = {}; // keyed by other agent id
let dashboardChatEnabled = false;
let chatHistory = [];
let chatHistoryLoaded = false;  // Only fetch chat history from server once
let skillsLoaded = false;  // Only populate textarea on first load
let savedSkillsContent = '';  // Track what's saved to detect unsaved changes
let selectedTile = null;  // Currently selected map tile

// Listen for tile selection from the game map
window.addEventListener('clawquest-tile-selected', (e) => {
    selectedTile = e.detail;
    updateTileContext();
});

// Show/hide the tile context indicator in the command tab
function updateTileContext() {
    let indicator = document.getElementById('tile-context');
    
    if (selectedTile) {
        const ownerText = selectedTile.owner_name || 'unclaimed';
        const typeText = selectedTile.type === 'unknown' ? '???' : selectedTile.type;
        const label = `tile (${selectedTile.q},${selectedTile.r}) ${typeText} [${ownerText}]` +
            (selectedTile.fortification ? ` fort:${selectedTile.fortification}` : '') +
            (selectedTile.is_capital ? ' *capital*' : '');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'tile-context';
            const inputContainer = document.getElementById('chat-input-container');
            inputContainer.parentNode.insertBefore(indicator, inputContainer);
        }
        indicator.textContent = `@ ${label}`;
        indicator.classList.remove('hidden');
    } else {
        if (indicator) indicator.classList.add('hidden');
    }
}

// Build tile context string to inject into the message
function buildTileContextString() {
    if (!selectedTile) return '';
    const ownerText = selectedTile.owner_name || 'unclaimed';
    const typeText = selectedTile.type === 'unknown' ? 'unknown' : selectedTile.type;
    let ctx = `[Human is looking at tile (${selectedTile.q}, ${selectedTile.r}): terrain=${typeText}, owner=${ownerText}`;
    if (selectedTile.fortification) ctx += `, fortification=${selectedTile.fortification}`;
    if (selectedTile.is_capital) ctx += `, is_capital=true`;
    ctx += `]`;
    return ctx;
}

// Load agent data
async function loadAgentData() {
    try {
        const res = await fetch(`/api/agent/${AGENT_ID}/world`);
        if (res.ok) {
            const data = await res.json();
            document.getElementById('panel-food').textContent = data.agent?.food || 0;
            document.getElementById('panel-metal').textContent = data.agent?.metal || 0;
            
            // Check if dashboard chat is enabled
            dashboardChatEnabled = data.agent?.dashboard_chat_enabled || false;
            updateChatUI();
            
            // Load skills into editor (only on first load to avoid overwriting edits)
            if (!skillsLoaded) {
                const skills = data.your_strategy || '';
                document.getElementById('skills-textarea').value = skills;
                savedSkillsContent = skills;
                updateSkillsStatus();
                skillsLoaded = true;
            }
        }
    } catch (e) {
        console.error('Failed to load agent data:', e);
    }
}

// Skills editor functions
function updateSkillsStatus() {
    const textarea = document.getElementById('skills-textarea');
    const statusEl = document.getElementById('skills-status');
    const saveBtn = document.getElementById('skills-save');
    const current = textarea.value;
    
    if (current !== savedSkillsContent) {
        statusEl.textContent = '-- unsaved --';
        statusEl.className = 'unsaved';
        saveBtn.disabled = false;
    } else {
        statusEl.textContent = savedSkillsContent ? '-- saved --' : '';
        statusEl.className = 'saved';
        saveBtn.disabled = true;
    }
}

async function saveSkills() {
    const textarea = document.getElementById('skills-textarea');
    const statusEl = document.getElementById('skills-status');
    const saveBtn = document.getElementById('skills-save');
    const content = textarea.value;
    
    saveBtn.disabled = true;
    statusEl.textContent = 'saving...';
    statusEl.className = '';
    
    try {
        const res = await fetch(`/api/action/${AGENT_ID}/strategy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ strategy: content })
        });
        
        if (res.ok) {
            savedSkillsContent = content;
            statusEl.textContent = '-- saved --';
            statusEl.className = 'saved';
            saveBtn.disabled = true;
        } else {
            const err = await res.json();
            statusEl.textContent = 'err: ' + (err.error || 'failed');
            statusEl.className = 'unsaved';
            saveBtn.disabled = false;
        }
    } catch (e) {
        console.error('Failed to save skills:', e);
        statusEl.textContent = 'err: failed to save';
        statusEl.className = 'unsaved';
        saveBtn.disabled = false;
    }
}

// Update chat UI based on enabled state
function updateChatUI() {
    const commandTab = document.getElementById('command-tab');
    const chatContainer = document.getElementById('chat-container');
    const chatDisabled = document.getElementById('chat-disabled');
    
    if (dashboardChatEnabled) {
        commandTab.classList.remove('disabled');
        chatContainer.classList.remove('hidden');
        chatDisabled.classList.add('hidden');
        if (!chatHistoryLoaded) {
            chatHistoryLoaded = true;
            loadChatHistory();
        }
    } else {
        commandTab.classList.add('disabled');
        chatContainer.classList.add('hidden');
        chatDisabled.classList.remove('hidden');
    }
}

// Load chat history
async function loadChatHistory() {
    if (!dashboardChatEnabled) return;
    
    try {
        const res = await fetch(`/api/dashboard/${AGENT_ID}/history`);
        if (res.ok) {
            const data = await res.json();
            chatHistory = data.messages || [];
            renderChatMessages();
        }
    } catch (e) {
        console.error('Failed to load chat history:', e);
    }
}

// Render chat messages as terminal command/response pairs
function renderChatMessages() {
    const container = document.getElementById('chat-messages');
    
    if (chatHistory.length === 0) {
        container.innerHTML = '<div class="empty-state">type a command below</div>';
        return;
    }
    
    container.innerHTML = chatHistory.map(msg => {
        const isHuman = msg.direction === 'human_to_agent';
        const cssClass = isHuman ? 'human' : 'agent';
        
        return `<div class="chat-message ${cssClass}"><div class="content">${parseMarkdown(msg.content)}</div></div>`;
    }).join('');
    
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Parse simple markdown to HTML (safe - escapes HTML first)
function parseMarkdown(text) {
    let html = escapeHtml(text);
    
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<em>$1</em>');
    html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<em>$1</em>');
    html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/^[-*•]\s+/gm, '  - ');
    html = html.replace(/<br>[-*•]\s+/g, '<br>  - ');
    
    return html;
}

// Send chat message
async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const statusEl = document.getElementById('chat-status');
    
    const content = input.value.trim();
    if (!content) return;
    
    // Build the payload: user's message + tile context if a tile is selected
    const tileCtx = buildTileContextString();
    const contentWithContext = tileCtx ? `${content}\n\n${tileCtx}` : content;
    
    input.disabled = true;
    sendBtn.disabled = true;
    statusEl.textContent = 'processing...';
    
    // Show the clean message (without context metadata) in the chat UI
    chatHistory.push({
        agent_id: AGENT_ID,
        direction: 'human_to_agent',
        content: content,
        status: 'delivered',
        created_at: new Date().toISOString()
    });
    renderChatMessages();
    input.value = '';
    
    try {
        // Send the message WITH tile context to the server
        const res = await fetch(`/api/dashboard/${AGENT_ID}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: contentWithContext })
        });
        
        if (res.ok) {
            const data = await res.json();
            
            if (data.reply) {
                chatHistory.push({
                    id: data.message_id,
                    agent_id: AGENT_ID,
                    direction: 'agent_to_human',
                    content: data.reply,
                    status: 'delivered',
                    created_at: new Date().toISOString()
                });
                renderChatMessages();
            }
            
            statusEl.textContent = '';
        } else {
            const err = await res.json();
            statusEl.textContent = `err: ${err.error}${err.details ? ' -- ' + err.details : ''}`;
            
            setTimeout(() => {
                statusEl.textContent = '';
            }, 8000);
        }
    } catch (e) {
        console.error('Failed to send message:', e);
        statusEl.textContent = 'err: connection failed';
        
        setTimeout(() => {
            statusEl.textContent = '';
        }, 5000);
    } finally {
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
    }
}

// Add chat message from WebSocket event
function addChatMessageFromWS(data) {
    chatHistory.push({
        id: data.message_id,
        agent_id: data.agent_id,
        direction: 'agent_to_human',
        content: data.content,
        status: 'delivered',
        created_at: data.created_at
    });
    renderChatMessages();
    
    const statusEl = document.getElementById('chat-status');
    statusEl.textContent = `[${data.agent_name}] replied`;
    setTimeout(() => {
        statusEl.textContent = '';
    }, 3000);
}

// Load messages and build conversations
async function loadMessages() {
    try {
        const res = await fetch(`/api/agent/${AGENT_ID}/messages`);
        if (res.ok) {
            allMessages = await res.json();
            buildConversations();
            renderConnectionsList();
        }
    } catch (e) {
        console.error('Failed to load messages:', e);
    }
}

// Group messages into conversations by the other agent
function buildConversations() {
    conversations = {};
    
    for (const msg of allMessages) {
        const isSent = msg.from_id === AGENT_ID;
        const otherId = isSent ? msg.to_id : msg.from_id;
        const otherName = isSent ? (msg.to_name || msg.to_id) : (msg.from_name || msg.from_id);
        
        if (!conversations[otherId]) {
            conversations[otherId] = {
                id: otherId,
                name: otherName,
                messages: [],
                unread: 0,
                lastMessageAt: null,
            };
        }
        
        conversations[otherId].messages.push(msg);
        
        if (!isSent && msg.read === 0) {
            conversations[otherId].unread++;
        }
        
        const msgTime = new Date(msg.created_at);
        if (!conversations[otherId].lastMessageAt || msgTime > conversations[otherId].lastMessageAt) {
            conversations[otherId].lastMessageAt = msgTime;
        }
    }
    
    for (const convo of Object.values(conversations)) {
        convo.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
}

// Render connections as terminal log lines
function renderConnectionsList() {
    const list = document.getElementById('connections-list');
    const convos = Object.values(conversations);
    
    if (convos.length === 0) {
        list.innerHTML = '<div class="empty-state">no conversations yet</div>';
        return;
    }
    
    convos.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    
    list.innerHTML = convos.map(convo => {
        const lastMsg = convo.messages[convo.messages.length - 1];
        const isSent = lastMsg.from_id === AGENT_ID;
        const preview = (isSent ? 'you: ' : '') + lastMsg.content;
        const truncated = preview.length > 40 ? preview.slice(0, 40) + '...' : preview;
        const timeStr = formatTime(convo.lastMessageAt);
        const unreadBadge = convo.unread > 0 
            ? `<span class="connection-unread">(${convo.unread})</span>` 
            : '';
        
        return `
            <div class="connection-item" data-agent-id="${convo.id}">
                <span class="connection-time">${timeStr}</span>
                <span class="connection-name">${convo.name.toLowerCase()}</span>
                <span class="connection-preview">${escapeHtml(truncated)}</span>
                ${unreadBadge}
            </div>
        `;
    }).join('');
    
    list.querySelectorAll('.connection-item').forEach(item => {
        item.addEventListener('click', () => {
            const agentId = item.getAttribute('data-agent-id');
            openThread(agentId);
        });
    });
}

// Open a conversation thread as terminal log
function openThread(agentId) {
    const convo = conversations[agentId];
    if (!convo) return;
    
    document.getElementById('connections-view').classList.add('hidden');
    document.getElementById('thread-view').classList.remove('hidden');
    document.getElementById('thread-name').textContent = convo.name.toLowerCase();
    
    const container = document.getElementById('thread-messages');
    container.innerHTML = convo.messages.map(msg => {
        const isSent = msg.from_id === AGENT_ID;
        const senderName = isSent ? 'you' : convo.name.toLowerCase();
        const senderClass = isSent ? 'self' : '';
        const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        return `
            <div class="thread-msg">
                <div class="thread-msg-meta">
                    <span class="thread-msg-sender ${senderClass}">${senderName}</span>
                    <span class="thread-msg-time">${timeStr}</span>
                </div>
                <div class="thread-msg-content">${parseMarkdown(msg.content)}</div>
            </div>
        `;
    }).join('');
    
    container.scrollTop = container.scrollHeight;
}

// Back to connections list
function closeThread() {
    document.getElementById('thread-view').classList.add('hidden');
    document.getElementById('connections-view').classList.remove('hidden');
}

// Format time relative
function formatTime(date) {
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Back button handler
document.getElementById('thread-back').addEventListener('click', closeThread);

// Listen for WebSocket events from main.js
window.addEventListener('clawquest-message', (e) => {
    const data = e.detail;
    if (data.from_id === AGENT_ID || data.to_id === AGENT_ID) {
        loadMessages();
    }
});

// ===== Panel positioning, resizing, and window controls =====
const panel = document.getElementById('agent-panel');
const header = panel.querySelector('.panel-header');
const toggleBtn = document.getElementById('panel-toggle');
const minimizeBtn = panel.querySelector('.window-dot.minimize');
const maximizeBtn = panel.querySelector('.window-dot.maximize');

const STORAGE_KEY = 'clawquest-panel';
const DEFAULT_STATE = { x: null, y: null, w: 380, h: 480, collapsed: true };
const MIN_W = 280;
const MIN_H = 200;

// --- Persist & restore state ---
function loadPanelState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : { ...DEFAULT_STATE };
    } catch { return { ...DEFAULT_STATE }; }
}
function savePanelState() {
    const rect = panel.getBoundingClientRect();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: panel.classList.contains('collapsed') ? savedState.h : rect.height,
        collapsed: panel.classList.contains('collapsed')
    }));
}

let savedState = loadPanelState();

// Apply saved position and size
function applyPanelState(state) {
    panel.style.width = state.w + 'px';
    panel.style.height = state.h + 'px';
    
    // Position: use saved x/y if available, otherwise default top-right
    if (state.x !== null && state.y !== null) {
        panel.style.top = state.y + 'px';
        panel.style.right = 'auto';
        panel.style.left = state.x + 'px';
    }
    
    if (state.collapsed) {
        panel.classList.add('collapsed');
    } else {
        panel.classList.remove('collapsed');
    }
}
applyPanelState(savedState);

// --- Window controls (traffic light dots) ---
// Red dot: collapse/expand
toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('collapsed');
    savePanelState();
});

// Yellow dot: minimize (collapse)
minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!panel.classList.contains('collapsed')) {
        panel.classList.add('collapsed');
        savePanelState();
    }
});

// Green dot: toggle maximize / restore
let preMaxState = null;
maximizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.classList.contains('collapsed')) {
        panel.classList.remove('collapsed');
    }
    
    if (preMaxState) {
        // Restore
        panel.style.width = preMaxState.w + 'px';
        panel.style.height = preMaxState.h + 'px';
        panel.style.left = preMaxState.x + 'px';
        panel.style.top = preMaxState.y + 'px';
        preMaxState = null;
    } else {
        // Save current and maximize
        const rect = panel.getBoundingClientRect();
        preMaxState = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
        const pad = 20;
        panel.style.left = pad + 'px';
        panel.style.top = pad + 'px';
        panel.style.right = 'auto';
        panel.style.width = (window.innerWidth - pad * 2) + 'px';
        panel.style.height = (window.innerHeight - pad * 2) + 'px';
    }
    savePanelState();
});

// Double-click title bar: toggle collapse
header.addEventListener('dblclick', () => {
    panel.classList.toggle('collapsed');
    savePanelState();
});

// --- Dragging ---
let isDragging = false;
let dragStartX, dragStartY, panelStartX, panelStartY;

header.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('window-dot')) return;
    
    const rect = panel.getBoundingClientRect();
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panelStartX = rect.left;
    panelStartY = rect.top;
    isDragging = true;
    
    // Switch from right-positioned to left-positioned for clean dragging
    panel.style.right = 'auto';
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (isDragging) {
        e.preventDefault();
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        panel.style.left = (panelStartX + dx) + 'px';
        panel.style.top = (panelStartY + dy) + 'px';
    }
    if (isResizing) {
        e.preventDefault();
        handleResize(e);
    }
});

document.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
        savePanelState();
    }
    if (isResizing) {
        isResizing = false;
        resizeDir = null;
        document.body.style.cursor = '';
        savePanelState();
    }
});

// --- Resizing ---
let isResizing = false;
let resizeDir = null;
let resizeStartX, resizeStartY, resizeStartW, resizeStartH, resizeStartLeft, resizeStartTop;

panel.querySelectorAll('.resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
        if (panel.classList.contains('collapsed')) return;
        e.preventDefault();
        e.stopPropagation();
        
        isResizing = true;
        resizeDir = handle.dataset.resize;
        
        const rect = panel.getBoundingClientRect();
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeStartW = rect.width;
        resizeStartH = rect.height;
        resizeStartLeft = rect.left;
        resizeStartTop = rect.top;
        
        // Ensure left-positioned
        panel.style.right = 'auto';
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        
        document.body.style.cursor = window.getComputedStyle(handle).cursor;
    });
});

function handleResize(e) {
    const dx = e.clientX - resizeStartX;
    const dy = e.clientY - resizeStartY;
    let newW = resizeStartW;
    let newH = resizeStartH;
    let newLeft = resizeStartLeft;
    let newTop = resizeStartTop;
    
    if (resizeDir.includes('r')) newW = resizeStartW + dx;
    if (resizeDir.includes('b')) newH = resizeStartH + dy;
    if (resizeDir.includes('l')) {
        newW = resizeStartW - dx;
        newLeft = resizeStartLeft + dx;
    }
    
    // Clamp
    const maxW = window.innerWidth * 0.9;
    const maxH = window.innerHeight * 0.9;
    
    if (newW < MIN_W) { 
        if (resizeDir.includes('l')) newLeft = resizeStartLeft + (resizeStartW - MIN_W);
        newW = MIN_W; 
    }
    if (newW > maxW) newW = maxW;
    if (newH < MIN_H) newH = MIN_H;
    if (newH > maxH) newH = maxH;
    
    panel.style.width = newW + 'px';
    panel.style.height = newH + 'px';
    if (resizeDir.includes('l')) panel.style.left = newLeft + 'px';
}

// Tab switching
document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        if (tab.classList.contains('disabled')) return;
        
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab-content`).classList.add('active');
    });
});

// Chat input handlers
document.getElementById('chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
});

// Skills editor handlers
document.getElementById('skills-textarea').addEventListener('input', updateSkillsStatus);
document.getElementById('skills-save').addEventListener('click', saveSkills);

// Listen for dashboard reply events from WebSocket
window.addEventListener('clawquest-dashboard-reply', (e) => {
    const data = e.detail;
    if (data.agent_id === AGENT_ID) {
        addChatMessageFromWS(data);
    }
});

// Initial load
loadAgentData();
loadMessages();

// Refresh data periodically
setInterval(loadAgentData, 30000);
setInterval(loadMessages, 30000);
