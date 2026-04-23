require('dotenv').config();
const { App } = require('@slack/bolt');
const { Mistral } = require('@mistralai/mistralai');
const fs = require('fs');

// Initialize Mistral client
const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

// Initialize Slack App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// Load contacts
const contactsData = fs.readFileSync('./contacts.json', 'utf-8');

// In-memory store for conversation history
// Key: user ID, Value: Array of message objects { role: 'user' | 'assistant', content: string }
const userSessions = new Map();

const PHASE_1_PROMPT = `You are an internal company matching agent. The user needs help. Ask 1 or 2 clarifying questions to understand their specific technical or business problem. Once you fully understand the core issue, you must output EXACTLY the flag [CONTEXT_GATHERED] followed immediately by a 2-sentence summary of their problem.`;

const PHASE_2_PROMPT = `Analyze this problem and this list of contacts. Return a strict JSON object containing the 2 best matches. Use this exact schema: { "matches": [ { "name": "string", "reason_for_match": "string", "suggested_message": "string" } ] }. Do not include markdown formatting like \`\`\`json.`;

async function handleUserMessage(event, say) {
  const userId = event.user;
  const userMessage = event.text;

  // Initialize session if it doesn't exist
  if (!userSessions.has(userId)) {
    userSessions.set(userId, [
      { role: 'system', content: PHASE_1_PROMPT }
    ]);
  }

  const history = userSessions.get(userId);
  history.push({ role: 'user', content: userMessage });

  try {
    // Phase 1: Call Mistral
    const response = await mistral.chat.complete({
      model: 'mistral-large-latest',
      messages: history,
    });

    const mistralMessage = response.choices[0].message.content;

    // Check if context is gathered
    if (mistralMessage.includes('[CONTEXT_GATHERED]')) {
      // Extract summary
      const summary = mistralMessage.split('[CONTEXT_GATHERED]')[1].trim();
      
      // We don't save the Phase 2 response to Phase 1 history to keep it clean, 
      // but we can acknowledge the user
      await say("Got it! I've understood your problem. Let me find the best experts for you...");
      
      // Trigger Phase 2
      await executePhase2(summary, say);
      
      // Reset the session after a successful match
      userSessions.delete(userId);
    } else {
      // Continue Phase 1
      history.push({ role: 'assistant', content: mistralMessage });
      await say(mistralMessage);
    }
  } catch (error) {
    console.error("Error communicating with Mistral:", error);
    await say("Sorry, I encountered an error while trying to process your request.");
  }
}

async function executePhase2(problemSummary, say) {
  try {
    const phase2Messages = [
      { role: 'system', content: PHASE_2_PROMPT },
      { role: 'user', content: `Problem Summary:\n${problemSummary}\n\nContacts List:\n${contactsData}` }
    ];

    const response = await mistral.chat.complete({
      model: 'mistral-large-latest',
      messages: phase2Messages,
      // We can use JSON response format to enforce strict JSON if the model supports it,
      // but the prompt already instructs it.
      responseFormat: { type: 'json_object' }
    });

    let jsonString = response.choices[0].message.content.trim();
    
    // In case there's still markdown despite instructions
    if (jsonString.startsWith('```json')) {
      jsonString = jsonString.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (jsonString.startsWith('```')) {
      jsonString = jsonString.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const matchData = JSON.parse(jsonString);
    
    // Format response using Block Kit
    const blocks = buildBlockKitResponse(problemSummary, matchData.matches);
    await say({ blocks, text: "Here are your suggested matches!" });

  } catch (error) {
    console.error("Error in Phase 2:", error);
    await say("I gathered your context but ran into an error finding matches. Please try again later.");
  }
}

function buildBlockKitResponse(summary, matches) {
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🎯 Expert Match Results",
        emoji: true
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Based on your problem:*\n_${summary}_`
      }
    },
    {
      type: "divider"
    }
  ];

  matches.forEach((match, index) => {
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${index + 1}. ${match.name}*\n*Why they're a good fit:*\n${match.reason_for_match}`
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Suggested Ask:*\n> ${match.suggested_message}`
        }
      },
      {
        type: "divider"
      }
    );
  });

  return blocks;
}

// Listen for direct messages
app.message(async ({ message, say }) => {
  // Ignore subtype messages like bot_message, message_changed, etc.
  if (message.subtype && message.subtype !== 'bot_message') return;
  // Ignore messages from this bot
  if (message.bot_id) return;

  await handleUserMessage(message, say);
});

// Listen for app mentions
app.event('app_mention', async ({ event, say }) => {
  await handleUserMessage(event, say);
});

(async () => {
  await app.start();
  console.log('⚡️ Slack Bot Co-pilot is running!');
})();
