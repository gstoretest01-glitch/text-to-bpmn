// api/v1/chat/completions.js
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing GEMINI_API_KEY in Vercel configuration' });
    }

    const { prompt, model, reasoner, history, image, currentXml, isSpec, isConsultant } = req.body;

    // Load appropriate prompt text file
    let systemInstruction = '';
    try {
      if (isSpec) {
        systemInstruction = fs.readFileSync(path.join(process.cwd(), 'spec_prompt.txt'), 'utf-8');
      } else if (isConsultant) {
        systemInstruction = fs.readFileSync(path.join(process.cwd(), 'consultant_prompt.txt'), 'utf-8');
      } else {
        systemInstruction = fs.readFileSync(path.join(process.cwd(), 'system_prompt.txt'), 'utf-8');
      }
    } catch (err) {
      console.error("Error reading prompt files dynamically in Vercel:", err);
      return res.status(500).json({ error: 'Failed to read prompt files on Vercel server' });
    }

    // Determine model name and check if using OpenRouter key
    const isOpenRouter = apiKey.startsWith('sk-or-');
    let geminiModel = reasoner ? 'gemini-pro-latest' : 'gemini-3.5-flash';
    if (isOpenRouter) {
      geminiModel = reasoner ? 'google/gemini-2.5-pro' : 'google/gemini-3.5-flash';
      if (image) {
        geminiModel = 'meta-llama/llama-3.2-11b-vision-instruct:free';
      }
    } else if (image) {
      // Automatic vision fallback for images
      geminiModel = 'gemini-3.5-flash';
    }

    // Format final user prompt message
    let promptText = prompt;
    if (currentXml) {
      promptText = `Here is the current state of the BPMN 2.0 XML diagram:\n\n${currentXml}\n\nUser request: ${prompt || "Explain this diagram or optimize it"}`;
    }

    let finalMessageContent = promptText;
    if (image) {
      finalMessageContent = [
        { type: 'text', text: promptText || "Translate this flowchart image to BPMN 2.0 XML." },
        { type: 'image_url', image_url: { url: image } }
      ];
    }

    if (isOpenRouter) {
      const openRouterMessages = [
        { role: 'system', content: systemInstruction },
        ...(history || []),
        { role: 'user', content: finalMessageContent }
      ];

      const googleRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: geminiModel,
          messages: openRouterMessages,
          stream: true,
          temperature: 0.0,
          max_tokens: 4000
        })
      });

      if (!googleRes.ok) {
        const errText = await googleRes.text();
        return res.status(googleRes.status).send(errText);
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = googleRes.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
      return;
    }

    // Translate OpenAI messages to Gemini contents
    const contents = [];

    // Translate chat history and current user request
    const messages = [
      ...(history || []),
      { role: 'user', content: finalMessageContent }
    ];

    for (const msg of messages) {
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

    const geminiPayload = {
      contents,
      generationConfig: {
        temperature: 0.0
      }
    };

    if (systemInstruction) {
      geminiPayload.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${apiKey}`;

    const googleRes = await fetch(googleUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(geminiPayload)
    });

    if (!googleRes.ok) {
      const errText = await googleRes.text();
      return res.status(googleRes.status).send(errText);
    }

    // Stream translated OpenAI chunks to browser
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = googleRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
                  model: model,
                  choices: [{
                    index: 0,
                    delta: { content: contentText },
                    finish_reason: null
                  }]
                };
                res.write(`data: ${JSON.stringify(openAiChunk)}\n\n`);
              }
            } catch (e) {
              // Wait for more data
            }

            buffer = buffer.slice(i + 1);
            i = -1;
          }
        }
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('Proxy completions handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
