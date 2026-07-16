import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SYSTEM_PROMPT, SPEC_PROMPT, CONSULTANT_PROMPT } from './prompts.js';

const app = new Hono();

// Enable CORS for API routes
app.use('/api/*', cors({
  origin: '*', // Cho phép mọi nguồn hoặc cấu hình domain cụ thể của Pages
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-User'],
  credentials: true,
}));

// Route GET: Lấy cấu hình các API Key có sẵn
app.get('/api/config', (c) => {
  const isOR = (c.env.GEMINI_API_KEY && c.env.GEMINI_API_KEY.startsWith('sk-or-')) ||
               (c.env.DEEPSEEK_API_KEY && c.env.DEEPSEEK_API_KEY.startsWith('sk-or-')) ||
               (c.env.OPENAI_API_KEY && c.env.OPENAI_API_KEY.startsWith('sk-or-'));
  return c.json({
    openai: !!c.env.OPENAI_API_KEY,
    deepseek: !!c.env.DEEPSEEK_API_KEY,
    gemini: !!c.env.GEMINI_API_KEY,
    openrouter: isOR
  });
});

// Route POST: Log lỗi BPMN
app.post('/api/log-error', async (c) => {
  try {
    const { error, prompt, xml, error_type, ai_response, model } = await c.req.json();
    const timestamp = new Date().toISOString();
    
    // Ghi log lỗi ra console của Cloudflare (sẽ hiển thị ở mục Real-time Logs)
    console.error(`[BPMN-ERROR] ${timestamp} | TYPE: ${error_type || 'Unknown'} | ERROR: ${error} | PROMPT: ${prompt}`);
    
    // Lưu log vào cơ sở dữ liệu D1
    await c.env.DB.prepare(
      "INSERT INTO bpmn_logs (timestamp, error_type, error_message, prompt, ai_response, xml, model) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      timestamp,
      error_type || 'unknown',
      error || 'Unknown Error',
      prompt || '',
      ai_response || '',
      xml || '',
      model || ''
    )
    .run();
    
    return c.json({ success: true });
  } catch (err) {
    console.error("Failed to log error to D1 database:", err);
    return c.json({ error: "Failed to log error" }, 500);
  }
});

// Route POST: Đăng ký người dùng
app.post('/api/auth/register', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) {
    return c.json({ error: "Vui lòng điền đầy đủ tên đăng nhập và mật khẩu" }, 400);
  }

  const lowerUsername = username.toLowerCase().trim();
  
  try {
    // Kiểm tra user tồn tại trong D1 SQL DB
    const existingUser = await c.env.DB.prepare("SELECT username FROM users WHERE username = ?")
      .bind(lowerUsername)
      .first();
      
    if (existingUser) {
      return c.json({ error: "Tài khoản đã tồn tại" }, 400);
    }

    // Lưu user mới vào D1 DB
    const obfuscatedPassword = btoa(password); // Base64 encoding
    await c.env.DB.prepare("INSERT INTO users (username, password, sessions) VALUES (?, ?, ?)")
      .bind(lowerUsername, obfuscatedPassword, JSON.stringify([]))
      .run();
      
    return c.json({ success: true, username: lowerUsername });
  } catch (err) {
    console.error("Registration error:", err);
    return c.json({ error: "Lỗi đăng ký hệ thống" }, 500);
  }
});

// Route POST: Đăng nhập
app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) {
    return c.json({ error: "Vui lòng nhập tên đăng nhập và mật khẩu" }, 400);
  }

  const lowerUsername = username.toLowerCase().trim();
  
  try {
    const user = await c.env.DB.prepare("SELECT * FROM users WHERE username = ?")
      .bind(lowerUsername)
      .first();
      
    if (!user) {
      return c.json({ error: "Tài khoản không tồn tại" }, 401);
    }

    const obfuscatedPassword = btoa(password);
    if (user.password !== obfuscatedPassword) {
      return c.json({ error: "Mật khẩu không chính xác" }, 401);
    }

    let parsedSessions = [];
    try {
      parsedSessions = JSON.parse(user.sessions || '[]');
    } catch (e) {
      parsedSessions = [];
    }

    return c.json({ success: true, username: lowerUsername, sessions: parsedSessions });
  } catch (err) {
    console.error("Login error:", err);
    return c.json({ error: "Lỗi đăng nhập hệ thống" }, 500);
  }
});

// Route POST: Đồng bộ hóa phiên làm việc
app.post('/api/auth/sync', async (c) => {
  const username = c.req.header('x-user');
  const { sessions } = await c.req.json();

  if (!username) {
    return c.json({ error: "Chưa xác thực người dùng" }, 401);
  }

  const lowerUsername = username.toLowerCase().trim();
  
  try {
    const user = await c.env.DB.prepare("SELECT username FROM users WHERE username = ?")
      .bind(lowerUsername)
      .first();
      
    if (!user) {
      return c.json({ error: "Tài khoản không tìm thấy trên hệ thống" }, 404);
    }

    await c.env.DB.prepare("UPDATE users SET sessions = ? WHERE username = ?")
      .bind(JSON.stringify(sessions || []), lowerUsername)
      .run();
      
    return c.json({ success: true });
  } catch (err) {
    console.error("Sync error:", err);
    return c.json({ error: "Lỗi đồng bộ hóa dữ liệu" }, 500);
  }
});

// Route POST: Gọi xử lý sinh BPMN từ LLM APIs (Stream)
app.post('/api/process', async (c) => {
  try {
    const { prompt: userPrompt, model: modelSelected, reasoner, history = [], image, currentXml, isSpec, isConsultant } = await c.req.json();

    let apiUrl = '';
    let apiKey = '';
    let modelName = '';

    // Lựa chọn Model và API Keys từ environment variables của Cloudflare
    if (modelSelected === 'chatgpt') {
      apiUrl = 'https://api.openai.com/v1/chat/completions';
      apiKey = c.env.OPENAI_API_KEY || c.env.GEMINI_API_KEY; // Fallback to Gemini key if it's OpenRouter
      modelName = reasoner ? 'o3-2025-04-16' : 'gpt-4o';
    } else if (modelSelected === 'deepseek') {
      apiUrl = 'https://api.deepseek.com/v1/chat/completions';
      apiKey = c.env.DEEPSEEK_API_KEY || c.env.GEMINI_API_KEY; // Fallback to Gemini key if it's OpenRouter
      modelName = reasoner ? 'deepseek-reasoner' : 'deepseek-chat';
    } else if (modelSelected === 'gemini') {
      apiUrl = c.env.GEMINI_PROXY_URL ? `${c.env.GEMINI_PROXY_URL}/v1/chat/completions` : 'https://openrouter.ai/api/v1/chat/completions';
      apiKey = c.env.GEMINI_API_KEY;
      modelName = reasoner ? 'gemini-pro-latest' : 'gemini-3.5-flash';
    } else if (modelSelected === 'openrouter-free') {
      apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
      apiKey = c.env.GEMINI_API_KEY || c.env.DEEPSEEK_API_KEY || c.env.OPENAI_API_KEY;
      modelName = 'openrouter/free';
    } else {
      return c.json({ error: 'Invalid model selected' }, 400);
    }

    if (!apiKey) {
      return c.json({ error: 'API key not configured for the selected model' }, 500);
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

    // Xây dựng nội dung prompt
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

    // Chọn prompt hệ thống dựa vào loại yêu cầu
    const systemInstruction = isSpec ? SPEC_PROMPT : (isConsultant ? CONSULTANT_PROMPT : SYSTEM_PROMPT);

    const messages = [
      { role: 'system', content: systemInstruction },
      ...history,
      { role: 'user', content: finalMessageContent }
    ];

    // Thực hiện gọi API của bên thứ 3
    if (modelSelected === 'gemini' && !isOpenRouter) {
      const generateMethod = 'streamGenerateContent';
      const proxyBase = c.env.GEMINI_PROXY_URL || 'https://generativelanguage.googleapis.com';
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
          temperature: 0.0
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
        return c.json({ error: 'API Error', details: errorText }, apiResponse.status);
      }

      // Convert Gemini stream to OpenAI SSE stream format
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const reader = apiResponse.body.getReader();
      let buffer = '';

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

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
                      await writer.write(encoder.encode(`data: ${JSON.stringify(openAiChunk)}\n\n`));
                    }
                  } catch (e) {
                    // JSON parsing failed, wait for more data
                  }

                  buffer = buffer.slice(i + 1);
                  i = -1;
                }
              }
            }
          }
          await writer.write(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          console.error('Gemini stream parse error:', err);
        } finally {
          writer.close();
        }
      })();

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        }
      });
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
        ...(isOpenRouter && { max_tokens: 10000 })
      })
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error(`Upstream API returned error status ${apiResponse.status}: ${errorText}`);
      return c.json({ error: 'API Error', details: errorText }, apiResponse.status);
    }

    // Trả trực tiếp stream nhận được về cho client
    return new Response(apiResponse.body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // Đảm bảo CORS hoạt động trên stream response
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Processing error:', error);
    return c.json({ error: 'Worker processing error', details: error.message }, 500);
  }
});

// Route fallback cho root hoặc các route khác
app.all('*', (c) => {
  return c.text('Text-to-BPMN API backend is running on Cloudflare Workers.');
});

export default app;
