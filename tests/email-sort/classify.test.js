// tests/email-sort/classify.test.js — Email classifier tests
// RED phase: these tests define the contract for classify.js

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { buildPayload, parseResults } from '../../.claude/skills/email-sort/classify.js';
import { CATEGORY_NAMES } from '../../.claude/skills/email-sort/categories.js';

// --- Fixtures: real emails from Pratham's inbox ---

const FIXTURES = [
  { id: 'a1', sender: 'jobalerts-noreply@linkedin.com', subject: 'Netflix is hiring a Project Manager', snippet: 'At Netflix, our mission is to entertain the...' },
  { id: 'a2', sender: 'no-reply@is.email.nextdoor.com', subject: 'FERRIS PARK USERS -', snippet: 'Also, this park and all Ballwin parks have leash laws.' },
  { id: 'a3', sender: 'dan@tldrnewsletter.com', subject: 'ChatGPT Pro Max', snippet: 'OpenAI appears to be preparing a new ChatGPT Pro Max subscription' },
  { id: 'a4', sender: 'noreply@robinhood.com', subject: 'BTC order filled', snippet: 'Your market order to sell 0.00346262 BTC was filled for $288.51.' },
  { id: 'a5', sender: 'WilliamsSonoma@e.williams-sonoma.com', subject: 'Up to 75% OFF CLEARANCE!', snippet: 'Plus, more great deals on kitchen must-haves.' },
  { id: 'a6', sender: 'noreply@speedpay.com', subject: 'Ameren - Autopay Payment Reminder', snippet: 'This email is a reminder that your authorized Autopay Plan payment' },
  { id: 'a7', sender: 'invitations@linkedin.com', subject: 'Venkata accepted your invitation', snippet: 'See Venkata Pinnamaneni connections, experience, and more' },
  { id: 'a8', sender: 'one@email.chick-fil-a.com', subject: 'Chick-fil-A Mobile Ordering Receipt', snippet: 'Thanks for allowing us to serve you.' },
  { id: 'a9', sender: 'Pratham.Goswami@mastercard.com', subject: 'MCP architecture', snippet: 'hi corpsec, sending myself standard MCP setup' },
  { id: 'a10', sender: 'USPSInformeddelivery@email.informeddelivery.usps.com', subject: 'Your Daily Digest for Fri, 9/25', snippet: 'You have 1 mailpiece arriving soon.' },
  { id: 'a11', sender: 'informational@email.snapchat.com', subject: 'Colby Facklam sent you new messages', snippet: 'You have unread messages waiting on Snapchat.' },
  { id: 'a12', sender: 'rewards-and-benefits@communication.capitalone.com', subject: 'Congrats: earn up to $500', snippet: 'When you share 360 Checking, your friends could also earn $300.' },
  { id: 'a13', sender: 'redmail@redfin.com', subject: 'Price reduced at 922 Boulder Crest Ct', snippet: 'Visit Redfin.com Price' },
  { id: 'a14', sender: 'the-simulation-strategists@mail.beehiiv.com', subject: '1,776 jelly beans explain the feeling', snippet: 'Joel Greenblatt, an investor who once compounded money at roughly 50% a year' },
  { id: 'a15', sender: 'chase@mcmap.chase.com', subject: 'Pratham, cash back offers are expiring soon', snippet: 'Activate and earn before these offers are off the table' },
  { id: 'a16', sender: 'donotreply@match.indeed.com', subject: 'Project Manager - Partner Onboarding @ Apple', snippet: '$115,900 - $224,800 a year. Your project coordination experience could be a strong match' },
  { id: 'a17', sender: 'noreply@robinhood.com', subject: 'Your invite to apply is now open', snippet: 'You\'re eligible to apply for the Gold Card for 10 days only.' },
];

// --- buildPayload tests ---

describe('buildPayload — does the spear work', () => {
  it('produces a valid Jev payload with questions per email', () => {
    const payload = buildPayload(FIXTURES.slice(0, 3));
    assert.equal(payload.model, 'jev-latest');
    assert.ok(payload.state);
    assert.ok(payload.questions);
    assert.equal(Object.keys(payload.questions).length, 3);
  });

  it('each question is a Choice with all category options', () => {
    const payload = buildPayload([FIXTURES[0]]);
    const q = payload.questions['email_a1'];
    assert.equal(q.type, 'choice');
    assert.ok(q.instructions.includes('jobalerts-noreply@linkedin.com'));
    assert.ok(q.instructions.includes('Netflix'));
    const criteriaKeys = Object.keys(q.criteria);
    assert.deepEqual(criteriaKeys.sort(), [...CATEGORY_NAMES].sort());
  });

  it('includes sender, subject, and snippet in instructions', () => {
    const payload = buildPayload([FIXTURES[2]]);
    const q = payload.questions['email_a3'];
    assert.ok(q.instructions.includes('dan@tldrnewsletter.com'), 'missing sender');
    assert.ok(q.instructions.includes('ChatGPT Pro Max'), 'missing subject');
    assert.ok(q.instructions.includes('subscription'), 'missing snippet');
  });

  it('includes user context in state', () => {
    const payload = buildPayload([FIXTURES[0]]);
    assert.ok(payload.state.user_context.includes('Nextdoor'));
    assert.ok(payload.state.user_context.includes('Snapchat'));
    assert.ok(payload.state.user_context.includes('TLDR'));
  });
});

describe('buildPayload — does the bad spear break correctly', () => {
  it('throws on empty array', () => {
    assert.throws(() => buildPayload([]), /No emails to classify/);
  });

  it('throws on null', () => {
    assert.throws(() => buildPayload(null), /No emails to classify/);
  });
});

// --- parseResults tests ---

describe('parseResults — does the spear work', () => {
  it('maps Jev response to email id -> category', () => {
    const emails = [FIXTURES[0], FIXTURES[1]];
    const jevResponse = {
      email_a1: { choice: 'career_jobs', confidence: 0.88, probabilities: { career_jobs: 0.92, spam: 0.08 } },
      email_a2: { choice: 'spam', confidence: 0.91, probabilities: { spam: 0.95, career_jobs: 0.05 } },
    };
    const results = parseResults(emails, jevResponse);
    assert.equal(results['a1'].category, 'career_jobs');
    assert.equal(results['a1'].probability, 0.92);
    assert.equal(results['a2'].category, 'spam');
  });

  it('defaults missing answers to spam with 0 probability', () => {
    const emails = [FIXTURES[0]];
    const jevResponse = {};
    const results = parseResults(emails, jevResponse);
    assert.equal(results['a1'].category, 'spam');
    assert.equal(results['a1'].probability, 0);
  });

  it('rejects unknown categories as spam', () => {
    const emails = [FIXTURES[0]];
    const jevResponse = {
      email_a1: { choice: 'totally_fake_category', probability: 0.99 },
    };
    const results = parseResults(emails, jevResponse);
    assert.equal(results['a1'].category, 'spam');
  });
});

// --- Category coverage: known emails should map to expected categories ---
// These define the EXPECTED Jev behavior. If Jev disagrees, the category
// definitions or user_context need tuning.

describe('expected classifications — reference table', () => {
  const EXPECTED = {
    a1:  'career_jobs',       // LinkedIn job alert
    a2:  'spam',              // Nextdoor
    a3:  'newsletters',       // TLDR
    a4:  'bills_utilities',   // Robinhood trade confirmation
    a5:  'shopping_promos',   // Williams Sonoma sale
    a6:  'bills_utilities',   // Ameren autopay
    a7:  'networking',        // LinkedIn invitation
    a8:  'receipts',          // Chick-fil-A receipt
    a9:  'work',              // Mastercard self-send
    a10: 'mail_shipping',     // USPS Informed Delivery
    a11: 'spam',              // Snapchat
    a12: 'shopping_promos',   // Capital One referral promo
    a13: 'housing',           // Redfin
    a14: 'newsletters',       // Beehiiv newsletter
    a15: 'shopping_promos',   // Chase cashback promo
    a16: 'career_jobs',       // Indeed job match
    a17: 'shopping_promos',   // Robinhood card promo (not trade)
  };

  for (const [id, expectedCategory] of Object.entries(EXPECTED)) {
    it(`${id}: ${FIXTURES.find(f => f.id === id)?.sender?.split('@')[0]} -> ${expectedCategory}`, () => {
      // This test documents the expected mapping.
      // It will be validated against live Jev output in integration tests.
      assert.ok(CATEGORY_NAMES.includes(expectedCategory),
        `${expectedCategory} is not a valid category`);
    });
  }
});
