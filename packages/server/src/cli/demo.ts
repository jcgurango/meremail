import 'dotenv/config'
import { db, emails, contacts, importEmail, config } from '@meremail/shared'
import type { ImportableEmail } from '@meremail/shared'

// Demo user identity
const ME = {
  email: config.defaultSender.email || 'demo@meremail.local',
  name: config.defaultSender.name || 'Demo User',
}

// Generate a fake message ID
function msgId(id: string): string {
  return `<${id}@demo.meremail.local>`
}

// Helper to create dates relative to now
function daysAgo(days: number, hours = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(d.getHours() - hours)
  return d
}

// Demo emails organized by category
const demoEmails: ImportableEmail[] = [
  // ============================================
  // DISCUSSION THREAD 1: Friend conversation
  // ============================================
  {
    messageId: msgId('friend-001'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'sarah@example.com', name: 'Sarah Chen' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'Dinner this weekend?',
    textContent: `Hey! Are you free this Saturday? Was thinking we could try that new Thai place downtown.

Let me know!
Sarah`,
    htmlContent: undefined,
    sentAt: daysAgo(3, 14),
    isRead: true,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },
  {
    messageId: msgId('friend-002'),
    inReplyTo: msgId('friend-001'),
    references: [msgId('friend-001')],
    from: ME,
    to: [{ email: 'sarah@example.com', name: 'Sarah Chen' }],
    cc: [],
    bcc: [],
    deliveredTo: undefined,
    subject: 'Re: Dinner this weekend?',
    textContent: `Saturday works! What time were you thinking? I'm free after 6.`,
    htmlContent: undefined,
    sentAt: daysAgo(3, 12),
    isRead: true,
    isSent: true,
    isJunk: false,
    attachments: [],
    headers: {},
  },
  {
    messageId: msgId('friend-003'),
    inReplyTo: msgId('friend-002'),
    references: [msgId('friend-001'), msgId('friend-002')],
    from: { email: 'sarah@example.com', name: 'Sarah Chen' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'Re: Dinner this weekend?',
    textContent: `Perfect! Let's say 7pm? I'll make a reservation.`,
    htmlContent: undefined,
    sentAt: daysAgo(3, 10),
    isRead: true,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },
  {
    messageId: msgId('friend-004'),
    inReplyTo: msgId('friend-003'),
    references: [msgId('friend-001'), msgId('friend-002'), msgId('friend-003')],
    from: ME,
    to: [{ email: 'sarah@example.com', name: 'Sarah Chen' }],
    cc: [],
    bcc: [],
    deliveredTo: undefined,
    subject: 'Re: Dinner this weekend?',
    textContent: `Sounds great, see you then!`,
    htmlContent: undefined,
    sentAt: daysAgo(3, 9),
    isRead: true,
    isSent: true,
    isJunk: false,
    attachments: [],
    headers: {},
  },

  // ============================================
  // DISCUSSION THREAD 2: Work project
  // ============================================
  {
    messageId: msgId('work-001'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'mike.johnson@acmecorp.com', name: 'Mike Johnson' },
    to: [ME, { email: 'lisa.wong@acmecorp.com', name: 'Lisa Wong' }],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'Q4 Planning Meeting Notes',
    textContent: `Team,

Here are the key takeaways from today's planning meeting:

1. Launch target: November 15th
2. Beta testing starts October 1st
3. Marketing materials due by October 10th

Let me know if you have any questions.

Best,
Mike`,
    htmlContent: undefined,
    sentAt: daysAgo(5, 8),
    isRead: true,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },
  {
    messageId: msgId('work-002'),
    inReplyTo: msgId('work-001'),
    references: [msgId('work-001')],
    from: { email: 'lisa.wong@acmecorp.com', name: 'Lisa Wong' },
    to: [{ email: 'mike.johnson@acmecorp.com', name: 'Mike Johnson' }],
    cc: [ME],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'Re: Q4 Planning Meeting Notes',
    textContent: `Thanks Mike! I'll have the design mockups ready by next week.

Lisa`,
    htmlContent: undefined,
    sentAt: daysAgo(5, 6),
    isRead: true,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },

  // ============================================
  // UNREAD EMAIL: New message from colleague
  // ============================================
  {
    messageId: msgId('unread-001'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'alex.kumar@techstartup.io', name: 'Alex Kumar' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'Quick question about the API',
    textContent: `Hey,

I was looking at the API docs and had a question about the authentication flow. Do you have a few minutes to chat tomorrow?

Thanks,
Alex`,
    htmlContent: undefined,
    sentAt: daysAgo(0, 3),
    isRead: false,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },

  // ============================================
  // NEWSLETTERS (Feed material)
  // ============================================
  {
    messageId: msgId('news-001'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'newsletter@techdigest.io', name: 'Tech Digest Weekly' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'This Week in Tech: AI Advances and More',
    textContent: `TECH DIGEST WEEKLY
==================

Top Stories This Week:

1. New AI model breaks records in language understanding
2. Major tech company announces layoffs
3. Startup raises $50M for climate tech
4. Review: The latest smartphone cameras compared

Read more at techdigest.io

Unsubscribe: https://techdigest.io/unsubscribe`,
    htmlContent: `<h1>Tech Digest Weekly</h1>
<h2>Top Stories This Week</h2>
<ul>
<li>New AI model breaks records in language understanding</li>
<li>Major tech company announces layoffs</li>
<li>Startup raises $50M for climate tech</li>
<li>Review: The latest smartphone cameras compared</li>
</ul>
<p><a href="https://techdigest.io">Read more</a></p>`,
    sentAt: daysAgo(1, 6),
    isRead: false,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },
  {
    messageId: msgId('news-002'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'updates@designinspo.com', name: 'Design Inspiration' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'Fresh designs for your Monday motivation',
    textContent: `DESIGN INSPIRATION
==================

This week's curated collection features:
- Minimalist portfolio websites
- Bold typography trends
- Color palettes for 2024

View the full collection at designinspo.com`,
    htmlContent: undefined,
    sentAt: daysAgo(2, 8),
    isRead: true,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },
  {
    messageId: msgId('news-003'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'no-reply@devweekly.dev', name: 'Dev Weekly' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'Dev Weekly #142: TypeScript 5.3 is here',
    textContent: `DEV WEEKLY #142
===============

What's new this week:

- TypeScript 5.3 released with import attributes
- Bun 1.0 reaches stable
- New React Server Components patterns
- Tutorial: Building a CLI with Node.js

Happy coding!`,
    htmlContent: undefined,
    sentAt: daysAgo(4, 10),
    isRead: true,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },

  // ============================================
  // RECEIPTS & CONFIRMATIONS (Paper Trail material)
  // ============================================
  {
    messageId: msgId('receipt-001'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'receipts@store.amazon.com', name: 'Amazon.com' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'Your Amazon.com order #112-4567890-1234567',
    textContent: `Your order has shipped!

Order #112-4567890-1234567
Arriving: Tuesday, December 17

Items:
- USB-C Hub (Qty: 1) - $29.99
- Wireless Mouse (Qty: 1) - $24.99

Subtotal: $54.98
Shipping: FREE
Tax: $4.95
Total: $59.93

Track your package at amazon.com/orders`,
    htmlContent: undefined,
    sentAt: daysAgo(2, 14),
    isRead: true,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },
  {
    messageId: msgId('receipt-002'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'no-reply@uber.com', name: 'Uber Receipts' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'Your ride receipt from Uber',
    textContent: `Thanks for riding with Uber!

Trip on December 12, 2024
Downtown → Airport

Trip fare: $34.50
Service fee: $2.50
Total: $37.00

Rate your driver: ⭐⭐⭐⭐⭐`,
    htmlContent: undefined,
    sentAt: daysAgo(3, 18),
    isRead: true,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },
  {
    messageId: msgId('confirm-001'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'noreply@calendar.google.com', name: 'Google Calendar' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'Invitation: Team Sync @ Wed Dec 18, 2024 10am',
    textContent: `You have been invited to the following event:

Team Sync
When: Wednesday, December 18, 2024 10:00am - 11:00am
Where: Conference Room A / Zoom

Going? Yes - Maybe - No`,
    htmlContent: undefined,
    sentAt: daysAgo(1, 2),
    isRead: true,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },

  // ============================================
  // VERIFICATION CODE
  // ============================================
  {
    messageId: msgId('verify-001'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'security@github.com', name: 'GitHub' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: '[GitHub] Your verification code',
    textContent: `Your GitHub verification code is: 847291

This code will expire in 10 minutes.

If you didn't request this code, you can safely ignore this email.

Thanks,
The GitHub Team`,
    htmlContent: undefined,
    sentAt: daysAgo(0, 1),
    isRead: false,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },

  // ============================================
  // MARKETING / PROMOTIONAL
  // ============================================
  {
    messageId: msgId('promo-001'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'deals@shopify-store.com', name: 'Holiday Sale!' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: '🎄 50% OFF Everything - Holiday Special!',
    textContent: `HOLIDAY SALE - 50% OFF EVERYTHING!

Don't miss out on our biggest sale of the year!

Use code: HOLIDAY50 at checkout

Shop now at shopify-store.com

Unsubscribe | Privacy Policy`,
    htmlContent: undefined,
    sentAt: daysAgo(1, 12),
    isRead: false,
    isSent: false,
    isJunk: false,
    attachments: [],
    headers: {},
  },

  // ============================================
  // SUSPICIOUS / SPAM (Quarantine material)
  // ============================================
  {
    messageId: msgId('spam-001'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'prince.nigeria@totallylegit.ng', name: 'Prince Abubakar' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'URGENT: You have inherited $4.5 Million USD',
    textContent: `Dear Beloved,

I am Prince Abubakar from Nigeria. My late father left $4.5 Million USD and I need your help to transfer it. You will receive 30% for your assistance.

Please reply with your bank details urgently.

God Bless,
Prince Abubakar`,
    htmlContent: undefined,
    sentAt: daysAgo(6, 4),
    isRead: false,
    isSent: false,
    isJunk: true, // This will auto-quarantine the sender
    attachments: [],
    headers: {},
  },
  {
    messageId: msgId('spam-002'),
    inReplyTo: undefined,
    references: [],
    from: { email: 'security-alert@paypa1.com', name: 'PayPal Security' },
    to: [ME],
    cc: [],
    bcc: [],
    deliveredTo: ME.email,
    subject: 'Your account has been limited - Action Required',
    textContent: `Dear Customer,

We noticed unusual activity on your account. Your account has been limited.

Click here to verify your identity: http://paypa1-secure.com/verify

If you don't verify within 24 hours, your account will be suspended.

PayPal Security Team`,
    htmlContent: undefined,
    sentAt: daysAgo(4, 16),
    isRead: false,
    isSent: false,
    isJunk: true, // Phishing attempt
    attachments: [],
    headers: {},
  },
]

async function main() {
  console.log('Meremail Demo Data Generator')
  console.log('============================\n')

  // Check if database is empty
  const existingEmails = db.select().from(emails).limit(1).all()
  const existingContacts = db.select().from(contacts).limit(1).all()

  if (existingEmails.length > 0 || existingContacts.length > 0) {
    console.error('Error: Database is not empty!')
    console.error('The demo command only works on a fresh database.')
    console.error('Run "pnpm db:migrate" first to reset, then try again.')
    process.exit(1)
  }

  console.log(`Importing ${demoEmails.length} demo emails...\n`)

  let imported = 0
  let errors = 0

  for (const email of demoEmails) {
    try {
      const result = await importEmail(email)
      if (result.imported) {
        imported++
        const marker = email.isSent ? '→' : '←'
        const from = email.isSent ? 'me' : email.from?.email || 'unknown'
        console.log(`  ${marker} ${email.subject} (from: ${from})`)
      }
    } catch (err) {
      errors++
      console.error(`  ✗ Error importing "${email.subject}":`, err)
    }
  }

  console.log('\n--- Demo Data Summary ---')
  console.log(`Imported: ${imported} emails`)
  if (errors > 0) {
    console.log(`Errors: ${errors}`)
  }

  // Show contact summary
  const allContacts = db.select().from(contacts).all()
  const meContacts = allContacts.filter(c => c.isMe)

  console.log(`\nContacts created: ${allContacts.length}`)
  console.log(`  - "Me" contacts: ${meContacts.length}`)

  console.log('\nDemo data ready! Start the app with "pnpm dev"')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
