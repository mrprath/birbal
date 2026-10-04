#!/usr/bin/env node
// scripts/email-sort-run.mjs — Full email-sort pipeline
// Fetch (gmail.js) -> Classify (Jev via classify.js) -> Act (gmail.js)
// S6: Never log credentials or email content

import { loadEnv } from '../lib/env.js';
loadEnv();

import { searchMessages, getMessage, getSender, getSubject, listLabels, findOrCreateLabel, modifyMessage, archiveMessage, moveToPromotions } from '../lib/gmail.js';
import { classifyEmails } from '../.claude/skills/email-sort/classify.js';
import { ACTIONS } from '../.claude/skills/email-sort/categories.js';

const MAX_EMAILS = 50;

async function run() {
  // 1. Fetch unread inbox emails
  console.log('Fetching unread inbox emails...');
  const msgList = await searchMessages('is:unread in:inbox', MAX_EMAILS);
  if (!msgList.length) {
    console.log('No unread emails found.');
    return;
  }
  console.log(`Found ${msgList.length} emails`);

  // 2. Get metadata for each email
  console.log('Loading email metadata...');
  const emails = [];
  for (const { id } of msgList) {
    const msg = await getMessage(id);
    emails.push({
      id,
      sender: getSender(msg),
      subject: getSubject(msg),
      snippet: msg.snippet || '',
    });
  }
  console.log(`Loaded ${emails.length} emails`);

  // 3. Classify via Jev
  console.log('Classifying via Jev...');
  const results = await classifyEmails(emails);
  console.log('Classification complete');

  // 4. Prepare labels
  const labels = await listLabels();
  const labelIds = {};
  for (const action of Object.values(ACTIONS)) {
    if (action.label && !labelIds[action.label]) {
      labelIds[action.label] = await findOrCreateLabel(action.label, labels);
      if (!labels.find(l => l.name === action.label)) {
        labels.push({ id: labelIds[action.label], name: action.label });
      }
    }
  }

  // 5. Apply actions
  console.log('Applying actions...');
  const counts = {};
  const lowConfidence = [];
  let errors = 0;

  for (const email of emails) {
    const { category, probability } = results[email.id] || { category: 'spam', probability: 0 };
    counts[category] = (counts[category] || 0) + 1;

    if (probability < 0.5) {
      lowConfidence.push({ id: email.id, sender: email.sender, subject: email.subject, category, probability });
    }

    const action = ACTIONS[category];
    if (!action) { errors++; continue; }

    try {
      if (action.archive) {
        await archiveMessage(email.id);
      } else if (action.promotions) {
        await moveToPromotions(email.id);
      } else if (action.label) {
        await modifyMessage(email.id, { addLabelIds: [labelIds[action.label]] });
      }
    } catch (err) {
      console.error(`FAIL ${category} ${email.id}: ${err.message}`);
      errors++;
    }
  }

  // 6. Report
  console.log('\n=== SORT COMPLETE ===');
  for (const [cat, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const action = ACTIONS[cat];
    const desc = action.archive ? 'archived' : action.promotions ? '-> Promotions' : '-> ' + action.label;
    console.log(`${cat.padEnd(18)}${String(count).padStart(3)}  ${desc}`);
  }
  console.log(`${'errors'.padEnd(18)}${String(errors).padStart(3)}`);
  console.log(`${'total'.padEnd(18)}${String(emails.length).padStart(3)}`);

  if (lowConfidence.length) {
    console.log('\n=== LOW CONFIDENCE (< 0.5) ===');
    for (const { sender, subject, category, probability } of lowConfidence) {
      console.log(`  ${category.padEnd(18)} p=${probability.toFixed(2)}  ${sender}  "${subject}"`);
    }
  }
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
