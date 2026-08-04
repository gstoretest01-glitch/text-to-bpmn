// Copyright (c) 2025 Davide Chen
// SPDX-License-Identifier: MIT

import * as BpmnAutoLayout from 'bpmn-auto-layout';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import lintModule   from 'bpmn-js-bpmnlint';
import lintConfig   from '../.bpmnlintrc';   // grazie al plug-in Rollup
import { marked } from 'marked';

/* ───────────  MODELER + LINTER ─────────── */
const modeler = new BpmnModeler({
  container: '#canvas',
  keyboard: { bindTo: window },
  commandStack: {
    limit: 30
  },
  additionalModules: [ lintModule ],
  linting: { bpmnlint: lintConfig }
});

const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
  ? (window.location.port === '3000' || !window.location.port ? '' : 'http://localhost:3000') 
  : 'https://api-bpmn.tungdemo.site';

// active linting panel right away
modeler.get('linting').toggle();

/* ─────────── AUTOMATIC BACKGROUND TASK RECOVERY ─────────── */
async function checkAndRestoreBackgroundTask() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/tasks/latest`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.task) return;

    const task = data.task;
    const lastRestoredTaskId = localStorage.getItem('last_restored_task_id');
    if (task.taskId === lastRestoredTaskId) return;

    const ageInMinutes = (Date.now() - task.timestamp) / (1000 * 60);
    if (ageInMinutes > 15) return;

    console.log('[BACKGROUND-RECOVERY] Found recently completed background task:', task);

    if (task.fullText || task.xml) {
      const promptSnippet = task.prompt ? task.prompt.slice(0, 50) : 'vừa tạo';
      const restoreConfirmed = confirm(`🎉 Hệ thống đã hoàn thành phản hồi trong nền cho yêu cầu: "${promptSnippet}..."!\n\nBạn có muốn khôi phục phản hồi này vào màn hình chat ngay không?`);
      if (restoreConfirmed) {
        localStorage.setItem('last_restored_task_id', task.taskId);
        
        if (task.xml) {
          await modeler.importXML(task.xml);
          pushToCustomHistory(task.xml);
        }
        
        if (typeof addBotMessage === 'function' && task.fullText) {
          addBotMessage(task.fullText);
        }
        
        if (typeof sessions !== 'undefined' && Array.isArray(sessions)) {
          const activeSess = sessions.find(s => s.id === currentSessionId);
          if (activeSess) {
            if (task.xml) activeSess.bpmnXml = task.xml;
            if (typeof saveSessions === 'function') saveSessions();
          }
        }
      } else {
        localStorage.setItem('last_restored_task_id', task.taskId);
      }
    }
  } catch (err) {
    console.error("Failed checking background tasks:", err);
  }
}

setTimeout(checkAndRestoreBackgroundTask, 1500);

let customHistory = [];
let customHistoryIndex = -1;
let isUndoingRedoing = false;
let commandStackTimeout = null;

function pushToCustomHistory(xml) {
  if (isUndoingRedoing) return;
  if (!xml) return;
  
  if (customHistoryIndex < customHistory.length - 1) {
    customHistory = customHistory.slice(0, customHistoryIndex + 1);
  }
  
  if (customHistory.length === 0 || customHistory[customHistoryIndex] !== xml) {
    customHistory.push(xml);
    if (customHistory.length > 30) {
      customHistory.shift();
    }
    customHistoryIndex = customHistory.length - 1;
  }
  updateUndoRedoButtonsState();
}

function updateUndoRedoButtonsState() {
  const undoBtnEl = document.getElementById('undo-btn');
  const redoBtnEl = document.getElementById('redo-btn');
  if (undoBtnEl) {
    undoBtnEl.disabled = customHistoryIndex <= 0;
    undoBtnEl.style.opacity = customHistoryIndex <= 0 ? '0.5' : '1';
  }
  if (redoBtnEl) {
    redoBtnEl.disabled = customHistoryIndex >= customHistory.length - 1;
    redoBtnEl.style.opacity = customHistoryIndex >= customHistory.length - 1 ? '0.5' : '1';
  }
}

function handleCommandStackChanged() {
  if (isUndoingRedoing) return;
  if (commandStackTimeout) clearTimeout(commandStackTimeout);
  commandStackTimeout = setTimeout(async () => {
    try {
      const { xml } = await modeler.saveXML({ format: true });
      pushToCustomHistory(xml);
      const activeSess = sessions.find(s => s.id === currentSessionId);
      if (activeSess) {
        activeSess.bpmnXml = xml;
        saveSessions();
      }
    } catch (err) {
      console.error("Error saving XML during command stack change", err);
    }
  }, 500);
}

modeler.on('commandStack.changed', handleCommandStackChanged);

// Log linting errors dynamically to backend log file
modeler.get('eventBus').on('linting.completed', async (event) => {
  const issues = event.issues;
  if (issues && Object.keys(issues).length > 0) {
    const flatIssues = [];
    Object.keys(issues).forEach(elementId => {
      issues[elementId].forEach(issue => {
        flatIssues.push({
          elementId: elementId,
          rule: issue.rule,
          message: issue.message,
          category: issue.category
        });
      });
    });
    
    // Log to console
    console.warn(`[BPMN-LINTER] Detected ${flatIssues.length} issues:`, flatIssues);
    
    let currentXml = 'N/A';
    try {
      const { xml } = await modeler.saveXML({ format: true });
      currentXml = xml;
    } catch (err) {
      console.error("Failed to save XML during linting check:", err);
    }
    
    // Send to backend logger
    fetch(`${API_BASE_URL}/api/log-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: `BPMN Linter found ${flatIssues.length} issues: ` + JSON.stringify(flatIssues),
        prompt: 'Diagram Linter Check',
        xml: currentXml
      })
    }).catch(err => console.error('Failed to send linter issues to backend', err));
  }
});

let chatHistory = [];
let isRetrying = false;

async function checkModelConfig() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/config`);
    const config = await res.json();
    const select = document.getElementById('global-model-select');
    if (select) {
      const options = [];
      if (config.gemini) {
        options.push({ value: 'gemini', text: 'Gemini (Free)' });
      }
      if (config.openrouter) {
        options.push({ value: 'openrouter-free', text: 'OpenRouter Free' });
      }
      
      select.innerHTML = '';
      options.forEach((opt, idx) => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.text;
        if (idx === 0) o.selected = true;
        select.appendChild(o);
      });
      if (options.length === 0) {
        console.warn("No LLM API keys configured in .env!");
      }
    }
  } catch (err) {
    console.error("Error loading model config:", err);
  }
}

// Check configuration immediately
checkModelConfig();

const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-message');
const sidebar = document.getElementById('sidebar');
const fullscreenLabel = document.getElementById('fullscreen-label');
const fileDrop = document.getElementById('file-drop-area');
const fileInput = document.getElementById('file-input');

// For Expand || Collapse button
let isFullscreen = false;
function toggleFullscreen() {
  isFullscreen = !isFullscreen;
  sidebar.style.marginLeft = isFullscreen ? 'calc(-30% + 60px)' : '60px';
  fullscreenLabel.textContent = isFullscreen ? 'Collapse' : 'Expand';
}


/* ──── LOAD DEFAULT BPMN DIAGRAM FROM EXTERNAL FILE ───── */

const defaultDiagramURL = '../diagram/default.bpmn';

let defaultBpmnXml = "";
let sessions = [];
let currentSessionId = "";

fetch(defaultDiagramURL)
  .then(response => {
    if (!response.ok) {
      throw new Error('Failed to load BPMN file');
    }
    return response.text();
  })
  .then(xml => {
    defaultBpmnXml = xml;
    console.log('✅ Default BPMN diagram loaded successfully');
    initSessions();
  })
  .catch(error => {
    console.error('❌ Error loading BPMN diagram:', error);
    initSessions();
  });

async function syncSessionsWithServer() {
  const authUser = localStorage.getItem('auth-user');
  if (!authUser) return;

  if (currentSessionId) {
    const activeSess = sessions.find(s => s.id === currentSessionId);
    if (activeSess) {
      try {
        const { xml } = await modeler.saveXML({ format: true });
        activeSess.bpmnXml = xml;
      } catch (err) {
        console.error("Failed to save XML during sync", err);
      }
    }
  }

  // Sanitize sessions payload to stay well within Cloudflare D1 / JSON payload limits
  const lightSessions = (sessions || []).slice(0, 50).map(s => ({
    id: s.id,
    title: s.title || 'Untitled',
    chatHistory: (s.chatHistory || []).slice(-30),
    bpmnXml: s.bpmnXml || '',
    createdAt: s.createdAt || Date.now()
  }));

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user': authUser
      },
      body: JSON.stringify({ sessions: lightSessions })
    });
    if (!response.ok) {
      console.error('Failed to sync sessions with server', response.statusText);
    } else {
      console.log('✅ Sessions synced with server successfully');
    }
  } catch (err) {
    console.error('Error syncing sessions with server:', err);
  }
}

function initSessions() {
  renderUserProfileBar();
  const storedSessions = localStorage.getItem('text-to-bpmn-sessions');
  const storedCurrentSessionId = localStorage.getItem('text-to-bpmn-current-session-id');

  if (storedSessions) {
    try {
      sessions = JSON.parse(storedSessions);
    } catch (e) {
      console.error("Failed to parse stored sessions", e);
      sessions = [];
    }
  }

  if (sessions.length === 0) {
    createNewSession("Sơ đồ mới 1");
  } else {
    currentSessionId = storedCurrentSessionId || sessions[0].id;
    if (!sessions.some(s => s.id === currentSessionId)) {
      currentSessionId = sessions[0].id;
    }
    switchSession(currentSessionId, false); 
  }
}

function saveSessions() {
  localStorage.setItem('text-to-bpmn-sessions', JSON.stringify(sessions));
  localStorage.setItem('text-to-bpmn-current-session-id', currentSessionId);
  syncSessionsWithServer();
}

function renderSessionsList() {
  const container = document.getElementById('sessions-list');
  if (!container) return;

  container.innerHTML = '';
  sessions.forEach(sess => {
    const item = document.createElement('div');
    item.className = 'session-item' + (sess.id === currentSessionId ? ' active' : '');
    item.addEventListener('click', () => switchSession(sess.id));

    const icon = document.createElement('i');
    icon.className = 'fa-regular fa-comment session-icon';
    item.appendChild(icon);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'session-title';
    titleSpan.textContent = sess.title || 'Untitled';
    titleSpan.title = titleSpan.textContent;

    // Helper function to create edit input inline
    const startRename = () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'session-title-input';
      input.value = sess.title || '';
      input.style.flexGrow = '1';
      input.style.width = '0'; // Allow flex-grow to stretch it properly
      input.style.background = 'transparent';
      input.style.border = '1px solid var(--accent-color, #007acc)';
      input.style.color = 'var(--text-color, #ffffff)';
      input.style.borderRadius = '4px';
      input.style.padding = '2px 4px';
      input.style.fontSize = '0.9rem';
      
      item.replaceChild(input, titleSpan);
      input.focus();
      input.select();
      
      let isSaved = false;
      const saveTitle = () => {
        if (isSaved) return;
        isSaved = true;
        const val = input.value.trim();
        if (val && val !== sess.title) {
          sess.title = val;
          saveSessions();
        }
        renderSessionsList();
      };
      
      input.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter') {
          evt.stopPropagation();
          saveTitle();
        } else if (evt.key === 'Escape') {
          evt.stopPropagation();
          renderSessionsList();
        }
      });
      
      input.addEventListener('blur', () => {
        saveTitle();
      });
    };

    titleSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename();
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'session-edit-btn';
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    editBtn.title = 'Sửa tên';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startRename();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'session-delete-btn';
    delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    delBtn.title = 'Xóa';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(sess.id);
    });

    item.appendChild(titleSpan);
    item.appendChild(editBtn);
    item.appendChild(delBtn);
    container.appendChild(item);
  });
}

function createNewSession(customTitle = null) {
  const newId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const newSession = {
    id: newId,
    title: customTitle || 'Sơ đồ mới',
    chatHistory: [],
    bpmnXml: defaultBpmnXml,
    createdAt: Date.now()
  };

  sessions.push(newSession);
  currentSessionId = newId;
  saveSessions();
  switchSession(newId, false);
}

const newChatBtn = document.getElementById('new-chat-btn');
if (newChatBtn) {
  newChatBtn.addEventListener('click', () => createNewSession());
}

async function switchSession(id, saveCurrent = true) {
  if (saveCurrent && currentSessionId) {
    const activeSess = sessions.find(s => s.id === currentSessionId);
    if (activeSess) {
      try {
        const { xml } = await modeler.saveXML({ format: true });
        activeSess.bpmnXml = xml;
      } catch (err) {
        console.error("Failed to save XML before switching", err);
      }
    }
  }

  currentSessionId = id;
  const session = sessions.find(s => s.id === currentSessionId);
  if (!session) return;

  customHistory = [];
  customHistoryIndex = -1;
  if (session.bpmnXml) {
    pushToCustomHistory(session.bpmnXml);
  }

  renderSessionsList();

  chatLog.innerHTML = '';
  chatHistory = session.chatHistory || [];
  
  chatHistory.forEach(msg => {
    if (msg.role === 'user') {
      const userMessage = document.createElement('div');
      userMessage.className = 'chat-msg user';
      userMessage.innerHTML = `<div class="msg-header">User</div><div class="msg-content">${msg.content}</div>`;
      chatLog.appendChild(userMessage);
    } else if (msg.role === 'assistant') {
      const botMsg = document.createElement('div');
      botMsg.className = 'chat-msg bot';
      
      const xmlStart = msg.content.search(/<\?xml|<bpmn:definitions/i);
      if (xmlStart !== -1) {
        const reasoning = msg.content.slice(0, xmlStart).trim();
        const xml = msg.content.slice(xmlStart).trim();
        
        if (reasoning) {
          const block = document.createElement('div');
          block.className = 'reasoning-block';
          block.innerHTML = `<strong>🤔 Reasoning...</strong><div class="reasoning-text">${reasoning.replace('🤔 Reasoning...', '').trim()}</div>`;
          botMsg.appendChild(block);
        }
        
        const outBlock = document.createElement('div');
        outBlock.className = 'output-block';
        outBlock.innerHTML = formatXml(xml);
        botMsg.appendChild(outBlock);
      } else {
        const header = document.createElement('div');
        header.className = 'msg-header';
        header.innerText = 'System';
        
        const content = document.createElement('div');
        content.className = 'msg-content';
        content.innerHTML = marked.parse(msg.content);
        
        botMsg.appendChild(header);
        botMsg.appendChild(content);
        appendConfirmationButtonIfNeeded(botMsg, msg.content);
      }
      chatLog.appendChild(botMsg);
    }
  });
  
  chatLog.scrollTop = chatLog.scrollHeight;
  if (typeof hljs !== 'undefined') hljs.highlightAll();

  const xmlToLoad = session.bpmnXml || defaultBpmnXml;
  if (xmlToLoad) {
    try {
      await modeler.importXML(xmlToLoad);
      console.log(`Loaded BPMN for session: ${session.title}`);
    } catch (err) {
      console.error("Failed to import XML for switched session", err);
    }
  }

  saveSessions();
}

function deleteSession(id) {
  if (sessions.length <= 1) {
    alert("Bạn phải giữ lại ít nhất một phiên chat!");
    return;
  }

  const index = sessions.findIndex(s => s.id === id);
  if (index === -1) return;

  sessions.splice(index, 1);

  if (currentSessionId === id) {
    currentSessionId = sessions[0].id;
  }

  saveSessions();
  switchSession(currentSessionId, false);
}

// Auto save diagram edits on command stack change
modeler.on('commandStack.changed', async () => {
  if (currentSessionId) {
    const activeSess = sessions.find(s => s.id === currentSessionId);
    if (activeSess) {
      try {
        const { xml } = await modeler.saveXML({ format: true });
        activeSess.bpmnXml = xml;
        saveSessions();
      } catch (err) {
        console.error("Auto-save failed", err);
      }
    }
  }
});

// Auto resize chat input field
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}


/* ────  CHAT HISTORY LAYOUT  ───── */

function sendMSG() {
  const text = chatInput.value.trim();
  if (!text) return;

  // 1. Show user message
  const userMessage = document.createElement('div');
  userMessage.className = 'chat-msg user';
  userMessage.innerHTML = `<div class="msg-header">User</div><div class="msg-content">${text}</div>`;  chatLog.appendChild(userMessage);
  chatLog.scrollTop = chatLog.scrollHeight;

  // 2. Reset textarea
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // 3. Send the prompt
  sendPrompt(text);
}
    
chatInput.addEventListener('input', () => autoResize(chatInput));
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMSG();
  }
});

/* ─────────── SENDING PROMPT TO SERVER ─────────── */

function stripXmlFromHistory(history) {
  return history.map(msg => {
    let content = msg.content;
    content = content.replace(/<(?:[a-zA-Z0-9]+:)?definitions[\s\S]*?<\/(?:[a-zA-Z0-9]+:)?definitions>/gi, '[BPMN XML diagram code removed for efficiency]');
    content = content.replace(/```xml[\s\S]*?```/gi, '[BPMN XML diagram code removed for efficiency]');
    return {
      role: msg.role,
      content: content.trim()
    };
  });
}

function limitChatHistory(history, limit = 30) {
  if (history.length <= limit) return history;
  // Keep the first 2 messages (initial user request and initial bot response)
  const initial = history.slice(0, 2);
  // Take the remaining messages from the end to fill the limit
  const recent = history.slice(history.length - (limit - 2));
  return initial.concat(recent);
}

async function callModelAPI(prompt, history, image, currentXml, onDataChunk, isSpec = false, isConsultant = false) {
  const model = document.getElementById('global-model-select').value;
  const reasoner = document.getElementById('model-status').innerText.trim().toLowerCase() === 'on';

  let url = `${API_BASE_URL}/api/process`;
  if (model === 'gemini' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    url = 'https://text-to-bpmn20-main.vercel.app/api/v1/chat/completions';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, reasoner, history, image, currentXml, isSpec, isConsultant })
  });

  if (!response.ok) {
    let errMsg = 'Server error';
    try {
      const errData = await response.json();
      if (errData) {
        if (typeof errData.details === 'string') {
          errMsg = errData.details;
        } else if (errData.error) {
          if (typeof errData.error === 'string') {
            errMsg = errData.error;
          } else if (typeof errData.error === 'object') {
            errMsg = errData.error.message || JSON.stringify(errData.error);
          }
        } else if (typeof errData.message === 'string') {
          errMsg = errData.message;
        }
      }
    } catch (e) {
      try {
        errMsg = await response.text();
      } catch (_) {}
    }
    throw new Error(errMsg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let pendingBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    pendingBuffer += decoder.decode(value, { stream: true });
    let lines = pendingBuffer.split('\n');
    pendingBuffer = lines.pop();

    for (let line of lines) {
      line = line.trim();
      if (!line.startsWith('data:')) continue;

      const jsonStr = line.substring(5).trim();
      if (jsonStr.trim().startsWith('[DONE')) break;

      try {
        const parsed = JSON.parse(jsonStr);
        const delta = parsed?.choices?.[0]?.delta;

        const chunk =
          typeof delta?.reasoning_content === 'string'
            ? delta.reasoning_content
            : typeof delta?.content === 'string'
            ? delta.content
            : '';

        if (chunk !== '') {
          onDataChunk(chunk); 
        }
      } catch (e) {
        console.warn('JSON incomplete or broken chunk, retrying...', e);
        pendingBuffer = 'data: ' + jsonStr + '\n' + pendingBuffer;
        break;
      }
    }
  }
} 

/* ─────────── MESSAGE HANDLING ─────────── */

// Creates and shows the "typing…" indicator. 
function showTypingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'chat-msg bot';
  indicator.innerHTML =
    '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  chatLog.appendChild(indicator);
  chatLog.scrollTop = chatLog.scrollHeight;
  return indicator;
}

// Creates the bot message wrapper (before adding content).
function createBotMessage() {
  const el = document.createElement('div');
  el.className = 'chat-msg bot';
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

/* ─────────── STREAM HANDLING ─────────── */

// Maintains shared state during chunked response
function initStreamContext() {
  return {
    botMessage: null,
    streamEl: null,
    fullRaw: ''
  };
}

// Initial rendering and progressive chunk appending
function handleStreamChunk(chunk, ctx) {
  // 1st chunk: removes the indicator and prepares the containers
  if (!ctx.botMessage) {
    chatLog.removeChild(ctx.typingIndicator);
    ctx.botMessage = createBotMessage();
    ctx.streamEl = document.createElement('div');
    ctx.streamEl.id = 'reasoning-stream';
    ctx.streamEl.style.whiteSpace = 'pre-wrap';

    if (modelStatus.textContent === 'On') {
      const header = document.createElement('div');
      header.className = 'msg-header';
      header.innerText = 'System';

      const reasoningBlock = document.createElement('div');
      reasoningBlock.className = 'reasoning-block';

      const title = document.createElement('strong');
      title.textContent = '🤔 Reasoning...';

      ctx.streamEl.className = 'reasoning-text';
      reasoningBlock.appendChild(title);
      reasoningBlock.appendChild(ctx.streamEl);

      ctx.botMessage.appendChild(header);
      ctx.botMessage.appendChild(reasoningBlock);
    } else {
      const header = document.createElement('div');
      header.className = 'msg-header';
      header.innerText = 'System';
      ctx.botMessage.appendChild(header);
      ctx.botMessage.appendChild(ctx.streamEl);
    }
  }

  ctx.fullRaw += chunk;
  ctx.streamEl.textContent += chunk;
  chatLog.scrollTop = chatLog.scrollHeight;
}

/* ─────────── FINAL RENDERING ─────────── */

// Splits reasoning and XML output (if present)
function splitReasoningOutput(raw) {
  const xmlStart = raw.search(/<\?xml|<bpmn:definitions/i);
  return xmlStart !== -1
    ? { reasoning: raw.slice(0, xmlStart).trim(), output: raw.slice(xmlStart).trim() }
    : { reasoning: raw.trim(), output: '' };
}

// Converts the XML part into a highlighted Markdown block
function formatXml(xml) {
  return marked.parse('```xml\n' + xml + '\n```');
}

// Rendering the final message output
function finalizeBotMessage(ctx, startTime) {
  const { botMessage, fullRaw } = ctx;

  if (!botMessage) return;

  botMessage.innerHTML = ''; 

  if (modelStatus.textContent === 'On') {
    const { reasoning, output } = splitReasoningOutput(fullRaw);

    if (reasoning) {
      const block = document.createElement('div');
      block.className = 'reasoning-block';

      const title = document.createElement('strong');
      title.textContent = '🤔 Reasoning...';

      const text = document.createElement('div');
      text.className = 'reasoning-text';
      text.textContent = reasoning;

      block.appendChild(title);
      block.appendChild(text);
      botMessage.appendChild(block);
    }

    if (output) {
      const outBlock = document.createElement('div');
      outBlock.className = 'output-block';
      outBlock.innerHTML = formatXml(output);
      botMessage.appendChild(outBlock);
      hljs.highlightAll();
    }
  } else {
    const header = document.createElement('div');
    header.className = 'msg-header';
    header.innerText = 'System';

    const content = document.createElement('div');
    content.className = 'msg-content';
    content.innerHTML = marked.parse(fullRaw);

    botMessage.appendChild(header);
    botMessage.appendChild(content);
    hljs.highlightAll();
  }

  // Check if response does not contain XML, then append a confirmation button
  appendConfirmationButtonIfNeeded(botMessage, fullRaw);

  botMessage.appendChild(buildReplyInfo(startTime));
}

function appendConfirmationButtonIfNeeded(container, fullRaw) {
  if (!container || !fullRaw) return;
  const xmlResponse = extractXmlFromResponse(fullRaw);
  if (!xmlResponse) {
    if (container.querySelector('.btn-confirm-action')) return;
    
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'new-chat-btn btn-confirm-action';
    confirmBtn.style.width = 'auto';
    confirmBtn.style.margin = '1rem 0 0 0';
    confirmBtn.style.background = '#10b981'; // Green button for confirmation
    confirmBtn.innerHTML = '<i class="fa-solid fa-diagram-project"></i> ✅ Xác nhận & Tiến hành vẽ sơ đồ BPMN';
    confirmBtn.addEventListener('click', () => {
      sendPrompt("Xác nhận quy trình. Hãy tiến hành vẽ sơ đồ BPMN 2.0 XML chi tiết cho quy trình trên.");
    });
    container.appendChild(confirmBtn);
  }
}

// Compute the response time and displays it
function buildReplyInfo(startTime) {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes ? `${minutes} min ${seconds} sec` : `${seconds} seconds`;

  const info = document.createElement('div');
  info.className = 'reply-time';
  info.textContent = `Replied in ${timeStr}`;
  return info;
}

function logBpmnExecution(errorMsg, prompt, xml, errorType = 'success', aiResponse = '', modelName = 'gemini') {
  fetch(`${API_BASE_URL}/api/log-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: errorMsg,
      prompt: prompt,
      xml: xml || 'EMPTY',
      error_type: errorType,
      ai_response: aiResponse,
      model: modelName
    })
  }).catch(err => console.error('Failed to log execution to backend', err));
}

/* ─────────── BPMN XML PROCESSING ─────────── */

// Imports BPMN if present and shows the outcome to the user
async function tryImportBpmn(xml, originalPrompt, originalImage = null, aiResponse = '', modelName = 'gemini') {
  if (!xml) {
    logBpmnExecution('No valid XML found in response', originalPrompt, 'EMPTY', 'invalid_xml', aiResponse, modelName);
    if (!isRetrying) {
      isRetrying = true;
      addBotMessage('⚠️ Sơ đồ không chứa mã XML hợp lệ. Đang tự động yêu cầu AI sửa lại...');
      await sendPrompt(`⚠️ The previous output did not contain any valid BPMN 2.0 XML definitions. Please regenerate the complete valid BPMN 2.0 XML for the process: "${originalPrompt}"`, originalImage);
      isRetrying = false;
    } else {
      addMsg('No valid BPMN XML found ❌. Please try again.', 'bot');
    }
    return false;
  }

  try {
    await modeler.importXML(xml);
    addMsg('Diagram generated successfully ✅', 'bot');
    logBpmnExecution('Success', originalPrompt, xml, 'success', aiResponse, modelName);
    isRetrying = false;
    return true;
  } catch (err) {
    console.error('❌ Errore durante importXML:', err);
    logBpmnExecution(err.message, originalPrompt, xml, 'syntax_error', aiResponse, modelName);
    if (!isRetrying) {
      isRetrying = true;
      addBotMessage(`⚠️ Sơ đồ chứa lỗi cú pháp (${err.message}). Đang tự động sửa lỗi...`);
      await sendPrompt(`⚠️ The BPMN XML you generated failed to import with error: "${err.message}". Here is the invalid XML you generated:\n\n${xml}\n\nPlease correct the syntax errors (ensure all incoming/outgoing matches and tags are closed) and output the complete corrected BPMN 2.0 XML.`, originalImage);
      isRetrying = false;
    } else {
      addMsg('Generated BPMN contains errors ⚠️. Please try again.', 'bot');
    }
    return false;
  }
}

/* ─────────── MAIN PIPELINE FUNCTION ─────────── */

async function sendPrompt(customText = null, imageBase64 = null, isAnalysis = false, isSpec = false) {
  const isCustom = customText !== null;
  let txt = isCustom ? customText.trim() : chatInput.value.trim();
  if (!txt && !imageBase64) return;

  const startTime = Date.now();

  // reset input field
  if (!isCustom) {
    chatInput.value = '';
    autoResize(chatInput);
  }

  // Shared state of the streaming
  const ctx = initStreamContext();
  ctx.typingIndicator = showTypingIndicator();

  try {
    const historyToSend = (isAnalysis || isSpec) ? [] : stripXmlFromHistory(chatHistory);
    
    // Extract current XML from canvas if history exists
    let currentXml = null;
    if (chatHistory.length > 0 && !isAnalysis && !isSpec) {
      try {
        const { xml } = await modeler.saveXML({ format: true });
        currentXml = xml;
      } catch (err) {
        console.error("Failed to export current XML for API call", err);
      }
    }

    await callModelAPI(txt, historyToSend, imageBase64, currentXml, chunk => handleStreamChunk(chunk, ctx), isSpec, isAnalysis);

    // final parsing finale and rendering
    finalizeBotMessage(ctx, startTime);

    if (isSpec) {
      const botMessageElement = ctx.botMessage;
      if (botMessageElement) {
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'new-chat-btn';
        downloadBtn.style.width = 'auto';
        downloadBtn.style.margin = '1rem 0 0 0';
        downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i> Tải tài liệu đặc tả (.md)';
        downloadBtn.addEventListener('click', () => {
          let filename = 'dac-ta-quy-trinh.md';
          const activeSess = sessions.find(s => s.id === currentSessionId);
          const procName = getProcessNameFromMarkdown(ctx.fullRaw) || (activeSess ? activeSess.title : '');
          if (procName) {
            const cleanName = procName.replace(/[\\/:*?"<>|]/g, '').trim();
            filename = `dac-ta-${cleanName}.md`;
          }
          download(filename, ctx.fullRaw);
        });
        botMessageElement.appendChild(downloadBtn);
      }
      return;
    }

    if (isAnalysis) {
      const xmlResponse = extractXmlFromResponse(ctx.fullRaw);
      if (xmlResponse) {
        const botMessageElement = ctx.botMessage;
        if (botMessageElement) {
          const viewBtn = document.createElement('button');
          viewBtn.className = 'new-chat-btn';
          viewBtn.style.width = 'auto';
          viewBtn.style.margin = '1rem 0 0 0';
          viewBtn.innerHTML = '<i class="fa-solid fa-eye"></i> Xem trước sơ đồ tối ưu';
          viewBtn.addEventListener('click', () => {
            showPreviewModal(xmlResponse);
          });
          botMessageElement.appendChild(viewBtn);
        }
      }
      return;
    }

    const xmlResponse = extractXmlFromResponse(ctx.fullRaw);
    const isExpectingXml = xmlResponse !== null || txt.includes("Xác nhận quy trình") || txt.toLowerCase().includes("vẽ sơ đồ") || txt.toLowerCase().includes("diagram") || txt.toLowerCase().includes("xml");

    if (isExpectingXml) {
      const model = document.getElementById('global-model-select').value;
      const importSuccess = await tryImportBpmn(xmlResponse, txt, imageBase64, ctx.fullRaw, model);

      if (importSuccess) {
        pushToCustomHistory(xmlResponse);
        chatHistory.push({ role: 'user', content: txt });
        chatHistory.push({ role: 'assistant', content: ctx.fullRaw });
        chatHistory = limitChatHistory(chatHistory, 30);

        // Update active session state
        const activeSess = sessions.find(s => s.id === currentSessionId);
        if (activeSess) {
          activeSess.chatHistory = chatHistory;
          activeSess.bpmnXml = xmlResponse;

          // Auto-generate title on first turn (user msg + assistant response)
          if (chatHistory.length === 2) {
            const words = txt.split(/\s+/).slice(0, 5).join(' ');
            activeSess.title = words || 'Sơ đồ mới';
            renderSessionsList();
          }

          saveSessions();
        }
      }
    } else {
      // Phase 1: Drafting & Discussion, simply record chat history
      chatHistory.push({ role: 'user', content: txt });
      chatHistory.push({ role: 'assistant', content: ctx.fullRaw });
      chatHistory = limitChatHistory(chatHistory, 30);

      // Update active session state
      const activeSess = sessions.find(s => s.id === currentSessionId);
      if (activeSess) {
        activeSess.chatHistory = chatHistory;
        
        // Auto-generate title on first turn
        if (chatHistory.length === 2) {
          const words = txt.split(/\s+/).slice(0, 5).join(' ');
          activeSess.title = words || 'Sơ đồ mới';
          renderSessionsList();
        }

        saveSessions();
      }
    }
  } catch (error) {
    console.error('API Error:', error);
    chatLog.removeChild(ctx.typingIndicator);
    addMsg(`Error: ${error.message}`, 'bot');
  }
}


function extractXmlFromResponse(content) {
  const match = content.match(/<(?:[a-zA-Z0-9]+:)?definitions[\s\S]*?<\/(?:[a-zA-Z0-9]+:)?definitions>/);
  return match ? match[0] : null;
}

function addBotMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'chat-msg bot';

  // SYSTEM HEADER
  const header = document.createElement('div');
  header.className = 'msg-header';
  header.innerText = 'System';
  msg.appendChild(header);

  // CONTENT (markdown)
  const content = document.createElement('div');
  content.className = 'msg-content';
  content.innerHTML = marked.parse(text);
  msg.appendChild(content);

  chatLog.appendChild(msg);
  chatLog.scrollTop = chatLog.scrollHeight;

  hljs.highlightAll();
}


/* ─────────── EXPORTING BUTTONS HANDLERS ─────────── */

const exportSVGBtn = document.getElementById('exportSVG');
exportSVGBtn.addEventListener('click', exportSVG);

const exportXMLBtn = document.getElementById('exportXML');
exportXMLBtn.addEventListener('click', exportXML);

function getProcessNameFromMarkdown(markdown) {
  if (!markdown) return '';
  // Match '# TÀI LIỆU ĐẶC TẢ QUY TRÌNH NGHIỆP VỤ: [Tên]' or variations
  const match = markdown.match(/^\s*#\s+(?:TÀI\s+LIỆU\s+ĐẶC\s+TẢ\s+QUY\s+TRÌNH\s+NGHIỆP\s+VỤ:|TÀI\s+LIỆU\s+ĐẶC\s+TẢ\s+QUY\s+TRÌNH:|TÀI\s+LIỆU\s+ĐẶC\s+TẢ:)?\s*(.+)$/m);
  if (match && match[1]) {
    return match[1].trim();
  }
  return '';
}

function exportXML() {
  const activeSess = sessions.find(s => s.id === currentSessionId);
  const name = activeSess ? activeSess.title.replace(/[\\/:*?"<>|]/g, '').trim() : 'diagram';
  modeler.saveXML({ format: true }).then(({ xml }) => download(`${name}.bpmn`, xml));
}
function exportSVG() {
  const activeSess = sessions.find(s => s.id === currentSessionId);
  const name = activeSess ? activeSess.title.replace(/[\\/:*?"<>|]/g, '').trim() : 'diagram';
  modeler.saveSVG().then(({ svg }) => download(`${name}.svg`, svg));
}
function fitView() {
  modeler.get('canvas').zoom('fit-viewport');
}

function download(filename, data) {
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


/* ─────────── ZOOMING BUTTONS HANDLERS ─────────── */

const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomResetBtn = document.getElementById('zoom-reset');

zoomInBtn.addEventListener('click', () => {
  changeZoom(1.2); // Zoom in by +20%
});

zoomOutBtn.addEventListener('click', () => {
  changeZoom(0.8); // Zoom out by -20%
});

zoomResetBtn.addEventListener('click', () => {
  modeler.get('canvas').zoom('fit-viewport');
});

function changeZoom(factor) {
  const canvas = modeler.get('canvas');
  const currentZoom = canvas.zoom();
  const newZoom = currentZoom * factor;

  // limit min/max zoom
  if (newZoom < 0.2 || newZoom > 4) return;

  canvas.zoom(newZoom);
}


/* ─────────── UNDO / REDO HANDLERS ─────────── */

const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');

if (undoBtn) {
  undoBtn.addEventListener('click', async () => {
    if (customHistoryIndex > 0) {
      isUndoingRedoing = true;
      customHistoryIndex--;
      const xml = customHistory[customHistoryIndex];
      try {
        await modeler.importXML(xml);
        updateUndoRedoButtonsState();
        const activeSess = sessions.find(s => s.id === currentSessionId);
        if (activeSess) {
          activeSess.bpmnXml = xml;
          saveSessions();
        }
      } catch (err) {
        console.error("Undo error", err);
      } finally {
        isUndoingRedoing = false;
      }
    }
  });
}

if (redoBtn) {
  redoBtn.addEventListener('click', async () => {
    if (customHistoryIndex < customHistory.length - 1) {
      isUndoingRedoing = true;
      customHistoryIndex++;
      const xml = customHistory[customHistoryIndex];
      try {
        await modeler.importXML(xml);
        updateUndoRedoButtonsState();
        const activeSess = sessions.find(s => s.id === currentSessionId);
        if (activeSess) {
          activeSess.bpmnXml = xml;
          saveSessions();
        }
      } catch (err) {
        console.error("Redo error", err);
      } finally {
        isUndoingRedoing = false;
      }
    }
  });
}

/* ─────────── AI CONSULTANT HANDLER ─────────── */

const aiConsultantBtn = document.getElementById('aiConsultant');
if (aiConsultantBtn) {
  aiConsultantBtn.addEventListener('click', runAIConsultant);
}

async function runAIConsultant() {
  try {
    const { xml } = await modeler.saveXML({ format: true });
    if (!xml) {
      addBotMessage('❌ Không có sơ đồ nào để phân tích.');
      return;
    }
    
    const userInstruction = chatInput.value.trim();
    if (userInstruction) {
      chatInput.value = '';
      autoResize(chatInput);
    }
    
    // Show user request
    const userMsg = document.createElement('div');
    userMsg.className = 'chat-msg user';
    userMsg.innerHTML = `<div class="msg-header">User</div><div class="msg-content">🔍 Yêu cầu tối ưu hóa sơ đồ quy trình hiện tại.<br><b>Yêu cầu chi tiết:</b> ${userInstruction || "Phân tích nút thắt cổ chai và tối ưu hóa tổng thể."}</div>`;
    chatLog.appendChild(userMsg);
    chatLog.scrollTop = chatLog.scrollHeight;

    const promptText = `Analyze the following BPMN 2.0 XML and optimize it.
    
CRITICAL USER REQUEST FOR THIS OPTIMIZATION: "${userInstruction || "General optimization and bottleneck analysis"}"

Identify potential bottlenecks, redundant steps, and exceptions that are not handled, focusing on the user's specific request. Present your response in Markdown in VIETNAMESE. At the end of your analysis, generate and include the complete updated and optimized BPMN 2.0 XML diagram representing your recommended optimizations. Make sure the XML is enclosed inside a standard xml code block (\`\`\`xml ... \`\`\`):\n\n${xml}`;
    
    await sendPrompt(promptText, null, true);
  } catch (error) {
    console.error("AI Consultant error:", error);
    addBotMessage("❌ Không thể phân tích sơ đồ: " + error.message);
  }
}

/* ─────────── PROCESS SPECIFICATION HANDLER ─────────── */

const processSpecBtn = document.getElementById('processSpec');
if (processSpecBtn) {
  processSpecBtn.addEventListener('click', generateProcessSpec);
}

async function generateProcessSpec() {
  try {
    const { svg } = await modeler.saveSVG();
    if (!svg) {
      addBotMessage('❌ Không thể kết xuất sơ đồ định dạng SVG.');
      return;
    }
    
    addBotMessage('⏳ Đang chuyển đổi sơ đồ sang định dạng hình ảnh và chuẩn bị dữ liệu đặc tả...');
    
    const pngBase64 = await svgToPngBase64(svg);
    
    // Remove the temporary loading status bubble
    chatLog.removeChild(chatLog.lastChild);
    
    // Show user request
    const userMsg = document.createElement('div');
    userMsg.className = 'chat-msg user';
    userMsg.innerHTML = `<div class="msg-header">User</div><div class="msg-content">📝 Yêu cầu lập tài liệu đặc tả quy trình từ sơ đồ hiện tại.</div>`;
    chatLog.appendChild(userMsg);
    chatLog.scrollTop = chatLog.scrollHeight;
    
    await sendPrompt("Hãy viết tài liệu đặc tả quy trình chi tiết cho sơ đồ này.", pngBase64, false, true);
  } catch (error) {
    console.error("Process specification error:", error);
    addBotMessage("❌ Gặp lỗi khi sinh tài liệu đặc tả: " + error.message);
  }
}

async function svgToPngBase64(svgString) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    if (!svgString.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
      svgString = svgString.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    
    let width = 1200;
    let height = 800;
    
    const viewBoxMatch = svgString.match(/viewBox=["']([^"']+)["']/);
    if (viewBoxMatch) {
      const parts = viewBoxMatch[1].split(/\s+/);
      if (parts.length === 4) {
        width = parseFloat(parts[2]);
        height = parseFloat(parts[3]);
      }
    }
    
    if (width < 200) width = 800;
    if (height < 150) height = 600;

    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

// Fullscreen toggle button
const fullscreenBtn = document.getElementById('toggleFullscreen');
fullscreenBtn.addEventListener('click', toggleFullscreen);


// Send button click
const sendBtn = document.getElementById('send-btn');
sendBtn.addEventListener('click', sendMSG);

// reasoner toggle
const modelToggle = document.getElementById('model-toggle');
let modelStatus = document.getElementById('model-status');


modelToggle.addEventListener('click', () => {
  const isReasonerOn = modelStatus.textContent.trim().toLowerCase() === 'on';

  const newStatus = isReasonerOn ? 'Off' : 'On';
  modelStatus.textContent = newStatus;
  modelToggle.classList.toggle('active', newStatus === 'On');
});


// Template popup
const templateLink = document.getElementById('template-link');
const templatePopup = document.getElementById('template-popup');

templateLink.addEventListener('click', e => {
  e.preventDefault();
  templatePopup.classList.toggle('visible');
});
document.addEventListener('click', e => {
  if (!templatePopup.contains(e.target) && !templateLink.contains(e.target)) {
    templatePopup.classList.remove('visible');
  }
});

/* ─────────── DRAG & DROP HANDLERS ─────────── */

// Prevent default behavior on the window
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  window.addEventListener(eventName, e => {
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false });
});

// Custom drag&drop behavior
['dragenter', 'dragover'].forEach(ev => fileDrop.addEventListener(ev, e => {
  e.preventDefault();
  fileDrop.classList.add('dragover');
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}));

['dragleave', 'dragend'].forEach(ev => fileDrop.addEventListener(ev, e => {
  e.preventDefault();
  fileDrop.classList.remove('dragover');
}));

fileDrop.addEventListener('click', () => fileInput.click());

fileDrop.addEventListener('drop', e => {
  e.preventDefault();
  fileDrop.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', e => {
  handleFiles(e.target.files);
});


/* ─────────── FILE INPUT HANDLER ─────────── */

function handleFiles(list) {
      [...list].forEach(file => {
        const reader = new FileReader();

          if (file.type.startsWith('text/')) {
            // Text files (.txt)
            reader.onload = function(e) {
              const textContent = e.target.result;
              const safeContent = textContent.replace(/\n/g, '<br>');
              addMsg(`📎 <b>${file.name} (${Math.round(file.size/1024)} KB) added.</b> <br><br> 📄 <b>The file contains the following text:</b><br><div style="background:#f8f9fa;border:1px solid #ddd;border-radius:8px;padding:10px;font-family:monospace;font-size:0.9rem;"><em>${textContent}</em></div>`, 'user');
              sendPrompt(textContent);
            };
            reader.readAsText(file);
          } else if (file.type.startsWith('image/')) {
            reader.onload = function(e) {
              const imgSrc = e.target.result;

              // Create a container element with the image
              const messageContainer = document.createElement('div');
              messageContainer.className = 'chat-msg user';
              messageContainer.innerHTML = `
                <strong>🖼️ ${file.name} (${Math.round(file.size / 1024)} KB) added.</strong><br>
                <img src="${imgSrc}" style="max-width:50%;border-radius:8px;margin-top:8px;"><br><br>
                <em>Analyzing flowchart image directly with AI...</em>
              `;
              chatLog.appendChild(messageContainer);
              chatLog.scrollTop = chatLog.scrollHeight;

              // Send image directly to sendPrompt
              sendPrompt("Translate this flowchart image to BPMN 2.0 XML.", imgSrc);
            };
            reader.readAsDataURL(file);
          } else if (file.type === 'application/pdf') {
            const reader = new FileReader();
            reader.onload = async function(e) {
              const typedarray = new Uint8Array(e.target.result);

              const pdf = await pdfjsLib.getDocument(typedarray).promise;
              let fullText = '';

              for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const content = await page.getTextContent();
                const strings = content.items.map(item => item.str);
                fullText += strings.join(' ') + '\n\n';
              }

              console.log('Extracted text from PDF:', fullText);

              addMsg(`<strong><i class="fa-solid fa-file-pdf"></i> ${file.name} (${Math.round(file.size/1024)} KB) added.</strong><br><br><b><em>Extracted PDF text:</em></b><br><div style="background:#f8f9fa;border:1px solid #ddd;border-radius:8px;padding:10px;font-family:monospace;font-size:0.9rem;"><em>${fullText.replace(/\n/g, '<br>')}</em></div>`, 'user');

              if (fullText.trim()) {
                sendPrompt(fullText);
              } else {
                addMsg('❌ No text found in the PDF.', 'bot');
              }
            };
            reader.readAsArrayBuffer(file);
          } else {
          // Other kind of files
          addMsg(`📎 ${file.name} (${Math.round(file.size/1024)} KB) added (unsupported file type).`, 'user');
        }
      });
    }

function addMsg(m, w) {
      const d = document.createElement('div');
      d.className = 'chat-msg ' + w;

      // support Markdown e safe parsing 
      d.innerHTML = `<div class="msg-header">${w === 'user' ? 'User' : 'System'}</div><div class="msg-content">${marked.parse(m)}</div>`;  
      hljs.highlightAll();

      chatLog.appendChild(d);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

/* ─────────── AUTHENTICATION LOGIC ─────────── */

let isLoginForm = true;

function renderUserProfileBar() {
  const bar = document.getElementById('user-profile-bar');
  if (!bar) return;
  
  const authUser = localStorage.getItem('auth-user');
  if (authUser) {
    bar.innerHTML = `
      <div class="user-profile-info">
        <i class="fa-solid fa-circle-user"></i>
        <span class="user-profile-name">${authUser}</span>
      </div>
      <button class="user-profile-logout-btn" id="logout-btn">
        <i class="fa-solid fa-arrow-right-from-bracket"></i>
        <span>Đăng xuất</span>
      </button>
    `;
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
  } else {
    bar.innerHTML = `
      <div class="user-profile-info">
        <i class="fa-solid fa-circle-user" style="color: #64748b;"></i>
        <span class="user-profile-name" style="color: #64748b;">Khách</span>
      </div>
      <button class="user-profile-login-btn" id="login-btn">
        <i class="fa-solid fa-arrow-right-to-bracket"></i>
        <span>Đăng nhập</span>
      </button>
    `;
    document.getElementById('login-btn').addEventListener('click', () => showAuthModal(true));
  }
}

function showAuthModal(show = true) {
  const overlay = document.getElementById('auth-modal-overlay');
  if (!overlay) return;
  overlay.style.display = show ? 'flex' : 'none';
  if (show) {
    isLoginForm = true;
    updateAuthModalUI();
  }
}

function updateAuthModalUI() {
  const title = document.getElementById('auth-modal-title');
  const submitBtn = document.getElementById('auth-submit-btn');
  const toggleText = document.querySelector('.auth-toggle-text');
  const errorMsg = document.getElementById('auth-error-msg');
  
  errorMsg.textContent = '';
  document.getElementById('auth-username').value = '';
  document.getElementById('auth-password').value = '';

  if (isLoginForm) {
    title.textContent = 'Đăng Nhập';
    submitBtn.textContent = 'Đăng Nhập';
    if (toggleText) {
      toggleText.innerHTML = 'Chưa có tài khoản? <a href="#" id="auth-toggle-link">Đăng ký ngay</a>';
      const link = document.getElementById('auth-toggle-link');
      if (link) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          isLoginForm = false;
          updateAuthModalUI();
        });
      }
    }
  } else {
    title.textContent = 'Đăng Ký Tài Khoản';
    submitBtn.textContent = 'Đăng Ký';
    if (toggleText) {
      toggleText.innerHTML = 'Đã có tài khoản? <a href="#" id="auth-toggle-link">Đăng nhập</a>';
      const link = document.getElementById('auth-toggle-link');
      if (link) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          isLoginForm = true;
          updateAuthModalUI();
        });
      }
    }
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorMsg = document.getElementById('auth-error-msg');

  if (!username || !password) {
    errorMsg.textContent = 'Vui lòng điền đầy đủ thông tin';
    return;
  }

  const url = isLoginForm ? `${API_BASE_URL}/api/auth/login` : `${API_BASE_URL}/api/auth/register`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    if (!response.ok) {
      errorMsg.textContent = data.error || 'Đã xảy ra lỗi';
      return;
    }

    localStorage.setItem('auth-user', data.username);
    showAuthModal(false);
    renderUserProfileBar();

    if (isLoginForm) {
      if (data.sessions && data.sessions.length > 0) {
        sessions = data.sessions;
        currentSessionId = sessions[0].id;
        saveSessions();
        switchSession(currentSessionId, false);
      } else {
        syncSessionsWithServer();
      }
    } else {
      // Synchronize current local sessions to newly created account
      syncSessionsWithServer();
      if (typeof addBotMessage === 'function') {
        addBotMessage('🎉 **Đăng ký tài khoản thành công!** Bạn đã đăng nhập tự động và các sơ đồ hiện tại đã được liên kết với tài khoản của bạn.');
      }
    }
  } catch (err) {
    console.error('Auth error', err);
    errorMsg.textContent = 'Lỗi kết nối đến server';
  }
}

function handleLogout() {
  localStorage.removeItem('auth-user');
  sessions = [];
  localStorage.removeItem('text-to-bpmn-sessions');
  localStorage.removeItem('text-to-bpmn-current-session-id');
  
  renderUserProfileBar();
  
  if (defaultBpmnXml) {
    initSessions();
  } else {
    window.location.reload();
  }
}

// Bind Authentication UI Events
const authForm = document.getElementById('auth-form');
if (authForm) {
  authForm.addEventListener('submit', handleAuthSubmit);
}
const authCancelLink = document.getElementById('auth-cancel-link');
if (authCancelLink) {
  authCancelLink.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthModal(false);
  });
}

/* ─────────── BPMN PREVIEW MODAL ─────────── */

let previewViewer = null;
let pendingOptimizedXml = null;

function showPreviewModal(xml) {
  const overlay = document.getElementById('bpmn-preview-modal-overlay');
  if (!overlay) return;
  
  overlay.style.display = 'flex';
  pendingOptimizedXml = xml;
  
  if (!previewViewer) {
    previewViewer = new BpmnModeler({
      container: '#preview-canvas'
    });
  }
  
  setTimeout(async () => {
    try {
      await previewViewer.importXML(xml);
      previewViewer.get('canvas').zoom('fit-viewport');
    } catch (err) {
      console.error("Failed to load XML in preview modal", err);
    }
  }, 100);
}

function closePreviewModal() {
  const overlay = document.getElementById('bpmn-preview-modal-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
  pendingOptimizedXml = null;
}

async function applyPreviewXml() {
  if (pendingOptimizedXml) {
    try {
      await modeler.importXML(pendingOptimizedXml);
      pushToCustomHistory(pendingOptimizedXml);
      
      const activeSess = sessions.find(s => s.id === currentSessionId);
      if (activeSess) {
        activeSess.bpmnXml = pendingOptimizedXml;
        saveSessions();
      }
      addBotMessage('✅ Đã áp dụng sơ đồ tối ưu vào canvas thành công.');
      closePreviewModal();
    } catch (err) {
      console.error("Failed to apply preview XML", err);
      alert("Không thể áp dụng sơ đồ: " + err.message);
    }
  }
}

const closePreviewBtn = document.getElementById('close-preview-modal-btn');
if (closePreviewBtn) {
  closePreviewBtn.addEventListener('click', closePreviewModal);
}
const previewCancelBtn = document.getElementById('preview-cancel-btn');
if (previewCancelBtn) {
  previewCancelBtn.addEventListener('click', closePreviewModal);
}
const previewApplyBtn = document.getElementById('preview-apply-btn');
if (previewApplyBtn) {
  previewApplyBtn.addEventListener('click', applyPreviewXml);
}