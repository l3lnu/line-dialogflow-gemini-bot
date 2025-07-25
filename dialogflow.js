const { SessionsClient } = require('@google-cloud/dialogflow');
const credentials = JSON.parse(Buffer.from(process.env.DIALOGFLOW_CREDENTIALS, 'base64').toString());
const client = new SessionsClient({ credentials });
const projectId = process.env.DIALOGFLOW_PROJECT_ID;

async function detectIntent(sessionId, text) {
  const sessionPath = client.projectAgentSessionPath(projectId, sessionId);
  const request = { session: sessionPath, queryInput: { text: { text, languageCode: 'th' } } };
  const [response] = await client.detectIntent(request);
  return response.queryResult;
}
module.exports = { detectIntent };
