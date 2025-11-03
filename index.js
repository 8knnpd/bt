import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import OpenAI from 'openai';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-codex';

if (!TELEGRAM_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN environment variable.');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY environment variable.');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function resolveBrowserPath() {
  // Check for Render/Linux environment first
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  
  // Linux paths (for Render, Railway, etc.)
  const linuxPaths = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ];
  
  for (const p of linuxPaths) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  
  // Windows paths (for local development)
  const envPath = process.env.BROWSER_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const pf = process.env.PROGRAMFILES || 'C://Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C://Program Files (x86)';
  const local = process.env.LOCALAPPDATA;
  const candidates = [
    local ? `${local}\\Google\\Chrome\\Application\\chrome.exe` : null,
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pfx86}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pfx86}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

const chatState = new Map(); // chatId -> 'idle' | 'awaiting_description'

const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [[{ text: 'إنشاء PDF', callback_data: 'create_pdf' }]],
  },
};

const SYSTEM_INSTRUCTIONS = `
أنت مساعد مختص بإنشاء سيرة ذاتية ثنائية اللغة (ATS-Friendly) احترافية للطباعة.

## قواعد أساسية صارمة:
- لا تُنشئ أو تفترض معلومات غير مذكورة. أعِد صياغة وتنظيم ما يرسله المستخدم فقط بأسلوب احترافي مختصر.
- صفحة واحدة A4 فقط. اختصر المحتوى إن لزم ليبقى ضمن صفحة واحدة.
- العربية في العمود الأيمن (dir="rtl" lang="ar")، والإنجليزية في العمود الأيسر (dir="ltr" lang="en") بشكل صارم.

## بنية الأقسام (الترتيب الإلزامي):
1. **معلومات الاتصال** (Header): الاسم، رقم الهاتف، البريد الإلكتروني، الموقع (اختياري). لا تضع في header/footer HTML.
2. **الملخص المهني** (Professional Summary): 2-3 جمل مختصرة تبرز الخبرة والمهارات الأساسية.
3. **الخبرات العملية** (Work Experience): بترتيب زمني عكسي (الأحدث أولاً). لكل وظيفة: المسمى الوظيفي، اسم الشركة، الفترة الزمنية، 3-5 نقاط إنجازات قابلة للقياس.
4. **التعليم** (Education): الشهادة، المؤسسة، سنة التخرج، المعدل (اختياري).
5. **المهارات** (Skills): قائمة نقطية بالمهارات التقنية واللغوية والشخصية. استخدم كلمات مفتاحية من الوصف الوظيفي.
6. **أقسام إضافية** (اختيارية): الشهادات، اللغات، الجوائز، المشاريع.

## معايير التنسيق ATS (إلزامية):
- **الخطوط**: Arial, Calibri, Helvetica, أو Times New Roman فقط. لا تستخدم خطوط مخصصة أو زخرفية.
- **أحجام الخطوط**: 
  * الاسم: 20-24px (bold)
  * عناوين الأقسام الرئيسية: 16-18px (bold)
  * المسميات الوظيفية وأسماء الشركات: 13-14px (bold)
  * النص الأساسي والنقاط: 11-12px (normal)
  * تفاصيل فرعية (التواريخ، المواقع): 10-11px (normal أو italic خفيف)
- **الهوامش**: 0.75 بوصة إلى 1 بوصة (19-25mm) من جميع الجوانب. استخدم @page { margin: 20mm; }.
- **التباعد**: 
  * بين الأقسام الرئيسية: 16-20px
  * بين العناصر داخل القسم: 8-12px
  * line-height للنص: 1.4-1.6
- **التخطيط**: 
  * عمودين متساويين للنسخة ثنائية اللغة (50% لكل عمود مع gap: 15-20px).
  * استخدم display: flex مع flex-direction: row-reverse لوضع العربي يميناً.
  * لا تستخدم جداول HTML (<table>)، أو text boxes، أو أعمدة CSS معقدة (columns).
  * تجنب position: absolute أو float المعقد.
- **النقاط**: استخدم <ul><li> القياسية أو رمز (•) فقط. لا تستخدم رموز خاصة (★, ☑, ➤, →).
- **التنسيق**: 
  * bold (<strong> أو font-weight: bold) للعناوين والمسميات الوظيفية فقط.
  * ضع خط سفلي خفيف تحت عناوين الأقسام الرئيسية فقط (المهارات، الخبرات، التعليم، إلخ) باستخدام border-bottom: 1px solid #ddd أو #ccc. اجعل الخط بطول 50% من عرض العنوان (width: 50% أو max-width: 100px).
  * تجنب underline للنصوص العادية إلا للروابط.
  * italic خفيف مقبول للتواريخ والمواقع فقط.
- **الألوان**: أسود (#000 أو #111) للنص الأساسي، رمادي داكن (#333 أو #555) للتفاصيل الفرعية. لا ألوان زاهية.

## ما يجب تجنبه (يكسر ATS):
- الصور، الشعارات، الأيقونات، الرسوم البيانية.
- الجداول المعقدة أو الأعمدة المتداخلة.
- وضع المعلومات في header/footer HTML.
- الخطوط غير القياسية أو الزخرفية.
- الألوان الزاهية (استخدم الأسود والرمادي فقط).

## المخرجات:
- وثيقة HTML5 كاملة (<!DOCTYPE html><html>..</html>) مع <meta charset="UTF-8"> و <style> مدمج في <head>.
- CSS نظيف للطباعة على A4.
- أعِد فقط كود HTML النهائي دون أي شروحات أو أسوار شيفرة.
`;

function stripCodeFences(text) {
  if (!text) return text;
  return text.replace(/```html\n?|```/g, '').trim();
}

async function generatePrintableHtml(description) {
  const inputMessages = [
    { role: 'system', content: SYSTEM_INSTRUCTIONS },
    { role: 'user', content: `أنشئ سيرة ذاتية ATS ثنائية اللغة (العربية يمين، الإنجليزية يسار) ضمن صفحة A4 واحدة بناءً على المعلومات التالية فقط:\n\n${description}\n\n- لا تضف معلومات غير دقيقة أو خبرات غير مذكورة.\n- رتّب المحتوى بأسلوب احترافي مختصر مناسب لأنظمة ATS.\n- التزم بالعمودين: العربي يمين (dir=\"rtl\" lang=\"ar\") والإنجليزي يسار (dir=\"ltr\" lang=\"en\").\n- أعد فقط HTML النهائي.` },
  ];

  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    input: inputMessages,
  });

  let html = response?.output_text || '';
  html = stripCodeFences(html);

  if (!html || !html.includes('<html')) {
    html = `<!DOCTYPE html><html lang=\"ar\" dir=\"auto\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Document</title><style>\n@page { size: A4; margin: 20mm; }\nbody { margin: 0; font-family: Arial, 'Segoe UI', sans-serif; line-height: 1.5; color: #111; }\n* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }\nh1, h2, h3 { page-break-after: avoid; break-after: avoid-page; margin: 0 0 8px; }\np, ul, ol, pre, blockquote, figure { break-inside: avoid; page-break-inside: avoid; margin: 0 0 10px; }\ntable { width: 100%; border-collapse: collapse; break-inside: avoid; page-break-inside: avoid; }\nth, td { border: 1px solid #ddd; padding: 6px 8px; }\nimg { max-width: 100%; height: auto; break-inside: avoid; page-break-inside: avoid; }\nsection, article { break-inside: avoid; page-break-inside: avoid; margin-bottom: 14px; }\n.page-break { break-before: page; page-break-before: always; }\n.page-break:last-child { display: none; }\n</style></head><body><main><article>\n<pre>${(response?.output_text || '').replace(/[<>]/g, s => ({'<':'&lt;','>':'&gt;'}[s]))}</pre>\n</article></main></body></html>`;
  }

  return html;
}

async function htmlToPdf(html) {
  const executablePath = resolveBrowserPath();
  if (!executablePath) {
    throw new Error('تعذر العثور على متصفح Chrome/Edge محلي. عيّن المتغير BROWSER_PATH لمسار التنفيذ.');
  }
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      pageRanges: '1',
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  
  if (query.data === 'create_pdf') {
    await bot.answerCallbackQuery(query.id);
    chatState.set(chatId, 'awaiting_description');
    await bot.editMessageText(
      'أرسل وصف ما تريد، مثلاً: تقرير، سيرة ذاتية، كتيّب، قائمة منتجات، إلخ.',
      { chat_id: chatId, message_id: messageId }
    );
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (!text) return;

  if (text === '/start' || !chatState.has(chatId)) {
    chatState.set(chatId, 'idle');
    await bot.sendMessage(
      chatId,
      'مرحباً! اضغط زر "إنشاء PDF" ثم أرسل وصف المحتوى المطلوب تحويله إلى ملف PDF منسق.',
      mainKeyboard
    );
    return;
  }

  if (chatState.get(chatId) === 'awaiting_description') {
    const tempFile = path.join(__dirname, `temp_${chatId}_${Date.now()}.pdf`);
    try {
      await bot.sendChatAction(chatId, 'typing');
      const html = await generatePrintableHtml(text);

      await bot.sendChatAction(chatId, 'upload_document');
      const pdfBuffer = await htmlToPdf(html);
      
      fs.writeFileSync(tempFile, pdfBuffer);

      await bot.sendDocument(chatId, tempFile, {
        caption: 'تم إنشاء ملف PDF بنجاح ✅'
      });
      
      fs.unlinkSync(tempFile);
    } catch (err) {
      console.error('Error generating PDF:', err);
      await bot.sendMessage(chatId, 'حدث خطأ أثناء الإنشاء. حاول مرة أخرى لاحقاً.');
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } finally {
      chatState.set(chatId, 'idle');
      await bot.sendMessage(chatId, 'جاهز لطلب جديد. اضغط "إنشاء PDF" للبدء.', mainKeyboard);
    }
  }
});

console.log('Telegram HTML→PDF bot is running...');
