require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { SessionsClient } = require('@google-cloud/dialogflow');
const products = require('./products');

const app = express();
app.use(express.json());

const { LINE_TOKEN, DIALOGFLOW_PROJECT_ID, GEMINI_API_KEY } = process.env;

const serviceAccountBase64 = process.env.DIALOGFLOW_CREDENTIALS;
const serviceAccountPath = path.join(__dirname, 'service-account.json');
fs.writeFileSync(serviceAccountPath, Buffer.from(serviceAccountBase64, 'base64').toString());

const sessionClient = new SessionsClient({ keyFilename: serviceAccountPath });

// Memory-based "pause" list (for intent 3)
const pausedUsers = new Set();

// Gemini function
async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }]
  };

  const res = await axios.post(url, payload);
  return res.data.candidates?.[0]?.content?.parts?.[0]?.text || 'ขออภัย ไม่สามารถตอบคำถามนี้ได้';
}

function getProductAnswer(product, detail) {
  const productData = products[product];
  if (productData && productData[detail]) {
    return productData[detail];
  }
  return null;
}

// LINE Webhook
app.post('/webhook', async (req, res) => {
  for (const e of req.body.events) {
    if (e.type === 'message' && e.message.type === 'text') {
      const msg = e.message.text;
      const userId = e.source.userId;
      const replyToken = e.replyToken;

      // If user selected "talk to human"
      if (pausedUsers.has(userId)) {
        continue;
      }

      const sessionPath = sessionClient.projectAgentSessionPath(
        DIALOGFLOW_PROJECT_ID,
        userId
      );

      const dfReq = {
        session: sessionPath,
        queryInput: {
          text: {
            text: msg,
            languageCode: 'th',
          },
        },
      };

      const dfRes = await sessionClient.detectIntent(dfReq);
      const result = dfRes[0].queryResult;
      const intent = result.intent?.displayName || '';
      let reply = result.fulfillmentText || '';

      console.log(JSON.stringify(result, null, 2));

      if (intent === 'user_selects_1') {
        // Intent 1: ถามข้อมูลผลิตภัณฑ์แบบมีขั้นตอน
        reply = result.fulfillmentText;

      } else if (intent === 'user_smart_product_question') {
        // New smart intent: ผู้ใช้พิมพ์คำถามเต็ม เช่น "อะมิโนพลัสใช้งานยังไง"
        const params = result.parameters?.fields || {};
        const product = params.product?.stringValue || '';
        const detail = params.detail_type?.stringValue || '';

        const productReply = getProductAnswer(product, detail);

        if (productReply) {
          reply = productReply;
        } else {
          // Let Gemini help
          const prompt = `
คุณคือผู้ช่วยแชทที่ตอบคำถามเกี่ยวกับสุขภาพและผลิตภัณฑ์อาหารเสริมจากหมอบุญชัยเท่านั้น
นี่คือฐานข้อมูล:
${JSON.stringify(products, null, 2)}

คำถาม: ${msg}
ตอบ:
          `.trim();
          reply = await askGemini(prompt);
        }

      } else if (intent === 'user_selects_2') {
        const prompt = `
คุณคือผู้ช่วยแชทที่ตอบคำถามเกี่ยวกับสุขภาพและผลิตภัณฑ์อาหารเสริมจากหมอบุญชัยเท่านั้น
นี่คือฐานข้อมูล:
${JSON.stringify(products, null, 2)}

คำถาม: ${msg}
ตอบ:
        `.trim();
        reply = await askGemini(prompt);

      } else if (intent === 'user_selects_3') {
        pausedUsers.add(userId);
        reply = 'ทีมงานจะติดต่อคุณเร็ว ๆ นี้ค่ะ';

      } else {
        reply = result.fulfillmentText || 'ขออภัย ฉันไม่เข้าใจคำถาม กรุณาเลือกจากเมนู 1-3';
      }

      await axios.post(
        'https://api.line.me/v2/bot/message/reply',
        {
          replyToken,
          messages: [{ type: 'text', text: reply }],
        },
        {
          headers: { Authorization: `Bearer ${LINE_TOKEN}` },
        }
      );
    }
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => {
  console.log('LINE bot is running!');
});
