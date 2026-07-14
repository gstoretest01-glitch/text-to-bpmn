import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const systemPrompt = fs.readFileSync(path.join(__dirname, 'system_prompt.txt'), 'utf-8');
const specPrompt = fs.readFileSync(path.join(__dirname, 'spec_prompt.txt'), 'utf-8');
const consultantPrompt = fs.readFileSync(path.join(__dirname, 'consultant_prompt.txt'), 'utf-8');

const outputContent = `// Generated automatically from text files. Do not edit directly.
export const SYSTEM_PROMPT = ${JSON.stringify(systemPrompt)};
export const SPEC_PROMPT = ${JSON.stringify(specPrompt)};
export const CONSULTANT_PROMPT = ${JSON.stringify(consultantPrompt)};
`;

fs.writeFileSync(path.join(__dirname, 'prompts.js'), outputContent, 'utf-8');
console.log('Successfully compiled prompt files into prompts.js');
