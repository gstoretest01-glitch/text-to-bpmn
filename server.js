// Copyright (c) 2025 Davide Chen
// SPDX-License-Identifier: MIT

import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { StringDecoder } from 'string_decoder';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// __dirname workaround for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ─────────── LOADS SYSTEM PROMPT ON STARTUP ─────────── */
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'system_prompt.txt');
const SYSTEM_PROMPT = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');

const SPEC_PROMPT_PATH = path.join(__dirname, 'spec_prompt.txt');
const SPEC_PROMPT = fs.readFileSync(SPEC_PROMPT_PATH, 'utf-8');

const CONSULTANT_PROMPT_PATH = path.join(__dirname, 'consultant_prompt.txt');
const CONSULTANT_PROMPT = fs.readFileSync(CONSULTANT_PROMPT_PATH, 'utf-8');

const DB_PATH = path.join(__dirname, 'db.json');

function readDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }), 'utf-8');
    }
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading db.json", err);
    return { users: {} };
  }
}

function writeDb(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error("Error writing db.json", err);
  }
}


// Serve static files (HTML, CSS, JS) from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  const isOR = (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.startsWith('sk-or-')) ||
               (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.startsWith('sk-or-')) ||
               (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-or-'));
  res.json({
    openai: !!process.env.OPENAI_API_KEY,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    openrouter: isOR
  });
});

app.post('/api/log-error', express.json(), (req, res) => {
  try {
    const { error, prompt, xml, error_type, ai_response, model } = req.body;
    const logPath = path.join(__dirname, 'bpmn_errors.log');
    const logEntry = `
========================================
TIMESTAMP: ${new Date().toISOString()}
TYPE: ${error_type || 'unknown'}
MODEL: ${model || 'unknown'}
ERROR: ${error || 'Unknown Error'}
PROMPT: ${prompt || 'No Prompt Provided'}
AI RESPONSE:
${ai_response || 'EMPTY'}
XML:
${xml || 'EMPTY'}
========================================
`;
    fs.appendFileSync(logPath, logEntry, 'utf-8');
    console.error(`[BPMN-ERROR] Logged error (${error_type}) to bpmn_errors.log: ${error}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to write to bpmn_errors.log:", err);
    res.status(500).json({ error: "Failed to write log" });
  }
});

app.post('/api/auth/register', express.json(), (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Vui lòng điền đầy đủ tên đăng nhập và mật khẩu" });
  }

  const db = readDb();
  const lowerUsername = username.toLowerCase().trim();
  if (db.users[lowerUsername]) {
    return res.status(400).json({ error: "Tài khoản đã tồn tại" });
  }

  const obfuscatedPassword = Buffer.from(password).toString('base64');
  db.users[lowerUsername] = {
    password: obfuscatedPassword,
    sessions: []
  };
  writeDb(db);

  res.json({ success: true, username: lowerUsername });
});

app.post('/api/auth/login', express.json(), (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Vui lòng nhập tên đăng nhập và mật khẩu" });
  }

  const db = readDb();
  const lowerUsername = username.toLowerCase().trim();
  const user = db.users[lowerUsername];
  if (!user) {
    return res.status(401).json({ error: "Tài khoản không tồn tại" });
  }

  const obfuscatedPassword = Buffer.from(password).toString('base64');
  if (user.password !== obfuscatedPassword) {
    return res.status(401).json({ error: "Mật khẩu không chính xác" });
  }

  res.json({ success: true, username: lowerUsername, sessions: user.sessions || [] });
});

app.post('/api/auth/sync', express.json({ limit: '100mb' }), (req, res) => {
  const username = req.headers['x-user'];
  const { sessions } = req.body;

  if (!username) {
    return res.status(401).json({ error: "Chưa xác thực người dùng" });
  }

  const db = readDb();
  const lowerUsername = username.toLowerCase().trim();
  if (!db.users[lowerUsername]) {
    return res.status(404).json({ error: "Tài khoản không tìm thấy trên hệ thống" });
  }

  db.users[lowerUsername].sessions = sessions || [];
  writeDb(db);

  res.json({ success: true });
});

/* ─────────── BACKEND PROXY FOR EXTERNAL LLM APIs ─────────── */
app.post('/api/process', express.json({ limit: '50mb' }), async (req, res) => {
  const userPrompt = req.body.prompt;
  const modelSelected = req.body.model;
  const reasoner = req.body.reasoner;
  const history = req.body.history || [];
  const image = req.body.image;
  const currentXml = req.body.currentXml;
  const isSpec = req.body.isSpec;

  const maxTokens = parseInt(process.env.MAX_TOKENS || '65536', 10);

  let apiUrl = '';
  let apiKey = '';
  let modelName = '';

  // Decide which provider to use
  if (modelSelected === 'chatgpt') {
    apiUrl = 'https://api.openai.com/v1/chat/completions';
    apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
    modelName = reasoner ? 'o3-2025-04-16' : 'gpt-4o';
    
  } else if (modelSelected === 'deepseek') {
    apiUrl = 'https://api.deepseek.com/v1/chat/completions';
    apiKey = process.env.DEEPSEEK_API_KEY || process.env.GEMINI_API_KEY;
    modelName = reasoner ? 'deepseek-reasoner' : 'deepseek-chat';
  } else if (modelSelected === 'gemini') {
    apiUrl = process.env.GEMINI_PROXY_URL ? `${process.env.GEMINI_PROXY_URL}/v1/chat/completions` : 'https://openrouter.ai/api/v1/chat/completions';
    apiKey = process.env.GEMINI_API_KEY;
    modelName = reasoner ? 'gemini-pro-latest' : 'gemini-3.5-flash';
  } else if (modelSelected === 'openrouter-free') {
    apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    apiKey = process.env.GEMINI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
    modelName = 'openrouter/free';
  } else {
    return res.status(400).json({ error: 'Invalid model selected' });
  }

  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Tự động nhận diện OpenRouter Key và chuyển hướng
  const isOpenRouter = apiKey.startsWith('sk-or-');
  if (isOpenRouter) {
    apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    if (image) {
      // Tự động chuyển đổi sang mô hình đọc ảnh Vision miễn phí
      modelName = 'meta-llama/llama-3.2-11b-vision-instruct:free';
    } else if (modelSelected === 'chatgpt') {
      modelName = reasoner ? 'meta-llama/llama-3.3-70b-instruct:free' : 'qwen/qwen-2.5-coder-32b-instruct:free';
    } else if (modelSelected === 'deepseek') {
      modelName = reasoner ? 'meta-llama/llama-3.3-70b-instruct:free' : 'qwen/qwen-2.5-coder-32b-instruct:free';
    } else if (modelSelected === 'gemini') {
      modelName = reasoner ? 'google/gemini-2.5-pro' : 'google/gemini-3.5-flash';
    } else if (modelSelected === 'openrouter-free') {
      modelName = 'openrouter/free';
    }
  }

  let promptText = userPrompt;
  if (currentXml) {
    promptText = `Here is the current state of the BPMN 2.0 XML diagram:\n\n${currentXml}\n\nUser request: ${userPrompt || "Explain this diagram or optimize it"}`;
  }

  let finalMessageContent = promptText;
  if (image) {
    finalMessageContent = [
      { type: 'text', text: promptText || "Translate this flowchart image to BPMN 2.0 XML." },
      { type: 'image_url', image_url: { url: image } }
    ];
  }

  const isConsultant = req.body.isConsultant;

  let systemInstruction = '';
  try {
    if (isSpec) {
      systemInstruction = fs.readFileSync(SPEC_PROMPT_PATH, 'utf-8');
    } else if (isConsultant) {
      systemInstruction = fs.readFileSync(CONSULTANT_PROMPT_PATH, 'utf-8');
    } else {
      systemInstruction = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
    }
  } catch (err) {
    console.error("Error reading prompt files dynamically, using cached startup prompts:", err);
    systemInstruction = isSpec ? SPEC_PROMPT : (isConsultant ? CONSULTANT_PROMPT : SYSTEM_PROMPT);
  }

  const messages = [
    { role: 'system', content: systemInstruction },
    ...history,
    { role: 'user', content: finalMessageContent }
  ];

  try {
    if (modelSelected === 'gemini' && !isOpenRouter) {
      const generateMethod = 'streamGenerateContent';
      const proxyBase = process.env.GEMINI_PROXY_URL || 'https://generativelanguage.googleapis.com';
      apiUrl = `${proxyBase}/v1beta/models/${modelName}:${generateMethod}?key=${apiKey}`;

      // Translate OpenAI messages to Gemini contents
      let systemInstructionText = '';
      const contents = [];

      for (const msg of messages) {
        if (msg.role === 'system') {
          systemInstructionText += (systemInstructionText ? '\n' : '') + msg.content;
        } else {
          const role = msg.role === 'assistant' ? 'model' : 'user';
          const parts = [];

          if (typeof msg.content === 'string') {
            parts.push({ text: msg.content });
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === 'text') {
                parts.push({ text: part.text });
              } else if (part.type === 'image_url') {
                const url = part.image_url?.url || '';
                if (url.startsWith('data:')) {
                  const match = url.match(/^data:([^;]+);base64,(.+)$/);
                  if (match) {
                    parts.push({
                      inlineData: {
                        mimeType: match[1],
                        data: match[2]
                      }
                    });
                  }
                }
              }
            }
          }
          contents.push({ role, parts });
        }
      }

      const geminiPayload = {
        contents,
        generationConfig: {
          temperature: 0.0,
          maxOutputTokens: maxTokens
        }
      };

      if (systemInstructionText) {
        geminiPayload.systemInstruction = {
          parts: [{ text: systemInstructionText }]
        };
      }

      const apiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(geminiPayload)
      });

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        console.error(`Upstream Gemini API error ${apiResponse.status}: ${errorText}`);
        return res.status(apiResponse.status).json({ error: 'API Error', details: errorText });
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const decoder = new StringDecoder('utf-8');
      let buffer = '';
      apiResponse.body.on('data', (chunk) => {
        buffer += decoder.write(chunk);

        let braceCount = 0;
        let startIdx = -1;
        for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] === '{') {
            if (braceCount === 0) startIdx = i;
            braceCount++;
          } else if (buffer[i] === '}') {
            braceCount--;
            if (braceCount === 0 && startIdx !== -1) {
              const jsonStr = buffer.slice(startIdx, i + 1);

              try {
                let cleanJsonStr = jsonStr.trim();
                if (cleanJsonStr.startsWith(',')) cleanJsonStr = cleanJsonStr.slice(1).trim();
                if (cleanJsonStr.startsWith('[')) cleanJsonStr = cleanJsonStr.slice(1).trim();
                if (cleanJsonStr.endsWith(']')) cleanJsonStr = cleanJsonStr.slice(0, -1).trim();

                const chunkObj = JSON.parse(cleanJsonStr);
                const contentText = chunkObj.candidates?.[0]?.content?.parts?.[0]?.text || '';
                
                if (contentText) {
                  const openAiChunk = {
                    id: 'chatcmpl-' + Date.now(),
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: modelName,
                    choices: [{
                      index: 0,
                      delta: { content: contentText },
                      finish_reason: null
                    }]
                  };
                  res.write(`data: ${JSON.stringify(openAiChunk)}\n\n`);
                }
              } catch (e) {
                // Wait for valid JSON chunks
              }

              buffer = buffer.slice(i + 1);
              i = -1;
            }
          }
        }
      });

      apiResponse.body.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });

      apiResponse.body.on('error', (err) => {
        console.error('Stream error:', err);
        res.status(500).json({ error: 'Error while streaming response' });
      });

      return;
    }

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: messages,
        stream: true,
        ...(modelName !== 'o3-2025-04-16' && { temperature: 0.0 }),
        ...(isOpenRouter && { max_tokens: maxTokens })
      })
    });
    
    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error(`API returned error status ${apiResponse.status}: ${errorText}`);
      return res.status(apiResponse.status).json({ error: 'API Error', details: errorText });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    apiResponse.body.on('data', (chunk) => {
      res.write(chunk);
    });

    apiResponse.body.on('end', () => {
      res.end();
    });

    apiResponse.body.on('error', (err) => {
      console.error('Stream error:', err);
      res.status(500).json({ error: 'Error while streaming response' });
    });

  } catch (error) {
    console.error('Streaming error:', error);
    res.status(500).json({
      error: 'Streaming API error',
      details: error.message
    });
  }
});

/* ─────────── START THE SERVER ─────────── */
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});