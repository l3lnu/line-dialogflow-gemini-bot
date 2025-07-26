require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { SessionsClient } = require('@google-cloud/dialogflow');

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

// LINE Webhook
app.post('/webhook', async (req, res) => {
  for (const e of req.body.events) {
    if (e.type === 'message' && e.message.type === 'text') {
      const msg = e.message.text;
      const userId = e.source.userId;
      const replyToken = e.replyToken;

      // If user selected "talk to human"
      if (pausedUsers.has(userId)) {
        // Don’t reply if user is paused
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
        // Use Dialogflow fulfillment text
        reply = result.fulfillmentText;

      } else if (intent === 'user_selects_2') {
        const prompt = `
คุณคือผู้ช่วยแชทที่ตอบคำถามเกี่ยวกับสุขภาพและผลิตภัณฑ์อาหารเสริมจากหมอบุญชัยเท่านั้น
กรุณาตอบโดยใช้ภาษาไทยธรรมดา ห้ามใช้สัญลักษณ์ ** หรือ * และอย่าเว้นวรรคพิเศษ

คำถาม: ${msg}
        `.trim();
        reply = await askGemini(prompt);

      } else if (intent === 'user_selects_3') {
        pausedUsers.add(userId);
        reply = 'ทีมงานจะติดต่อคุณเร็ว ๆ นี้ค่ะ';

      } else {
        // Fallback or anything else
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
