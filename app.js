const fs = require('fs');
const path = require('path');

// Decode service account from ENV
const serviceAccountBase64 = process.env.DIALOGFLOW_CREDENTIALS;
const serviceAccountPath = path.join(__dirname, 'service-account.json');

fs.writeFileSync(serviceAccountPath, Buffer.from(serviceAccountBase64, 'base64').toString());

const sessionClient = new SessionsClient({ keyFilename: serviceAccountPath });

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { SessionsClient } = require('@google-cloud/dialogflow');
const app = express();
app.use(express.json());

const { LINE_TOKEN, DIALOGFLOW_PROJECT_ID, GEMINI_API_KEY } = process.env;

// Gemini helper
async function askGemini(prompt) {
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
    { contents: [{ parts: [{ text: prompt }] }] }
  );
  return res.data.candidates?.[0]?.content?.parts?.[0]?.text || 'ขอโทษครับ ไม่ทราบคำตอบตอนนี้';
}

app.post('/webhook', async (req, res) => {
  for (const e of req.body.events) {
    if (e.type === 'message' && e.message.type === 'text') {
      const msg = e.message.text;
      const session = new SessionsClient();
      const sessionPath = session.projectAgentSessionPath(DIALOGFLOW_PROJECT_ID, e.source.userId);
      const dfReq = { session: sessionPath, queryInput: { text: { text: msg, languageCode: 'th' } } };
      const dfRes = await session.detectIntent(dfReq);
      const intent = dfRes[0].queryResult.intent.displayName;
      let reply = dfRes[0].queryResult.fulfillmentText;

      if (intent === 'Default Fallback Intent' || intent.includes('health')) {
        reply = await askGemini(msg);
      }

      await axios.post(
        'https://api.line.me/v2/bot/message/reply',
        { replyToken: e.replyToken, messages: [{ type: 'text', text: reply }] },
        { headers: { Authorization: `Bearer ${LINE_TOKEN}` } }
      );
    }
  }
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000);
