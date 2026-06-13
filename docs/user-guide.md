# User Guide — Lead Agent Chat

Real-estate AI chat system for lead qualification and booking management.

---

## Table of Contents

1. [Overview](#overview)
2. [For Leads (Visitors)](#for-leads-visitors)
3. [For Admins](#for-admins)
4. [Telegram Integration](#telegram-integration)

---

## Overview

The system works in two modes:

| Who | Where | What they do |
|-----|-------|-------------|
| **Lead / Visitor** | Property listing page | Chat with AI agent about a property, get qualified, book a viewing |
| **Admin** | `/admin` dashboard | Monitor leads, manage listings, control the AI, communicate via Telegram |

Languages supported: **English** and **French** only.

---

## For Leads (Visitors)

### Starting a Conversation

1. Open a property listing page (e.g. `/listings/marais-3p`)
2. A chat panel opens automatically — type any question to begin
3. The AI agent answers questions about the property in real time

### What the Agent Does

- Answers questions about price, surface area, rooms, location, features
- Naturally asks qualification questions during the conversation (budget, financing, timeline, etc.)
- Proposes viewing slots when you're interested
- Books a viewing directly in the conversation

### Booking a Viewing

1. Express interest in visiting ("I'd like to visit", "Can I book a viewing?")
2. Agent fetches 3 available slots and presents them
3. Pick a slot — agent confirms your email then books immediately
4. You receive a confirmation in the chat

> **Important:** Provide a valid email to confirm the booking. You can also log in via the site header (Google or magic link) to pre-fill your contact details.

### Switching to Telegram

On the web chat, you can continue the conversation on Telegram:
- The agent will offer a Telegram link when relevant
- Click the link or paste `/start <code>` in the bot
- Your profile and qualification data carry over — only the chat history is separate

### Available Properties

| Property | Address | Agent |
|----------|---------|-------|
| Appartement 3 pièces — Le Marais | 14 rue de Bretagne, 75004 Paris | Camille Laurent |
| Studio meublé — Montmartre | 8 rue des Abbesses, 75018 Paris | Camille Laurent |
| Maison avec jardin — Vincennes | 32 avenue de Paris, 94300 Vincennes | Camille Laurent |

---

## For Admins

### Logging In

Go to `/admin` — log in with your admin credentials (Google or email magic link).

### Dashboard Overview

The admin panel shows:
- **Lead list** — all leads with status, potential (hot/warm/cold), and last activity
- **Assistant chat** — talk to the AI assistant to manage the system
- **Lead detail** — click any lead to see their full profile, conversation history, and memory

### Lead Statuses

| Status | Meaning |
|--------|---------|
| `active` | Ongoing conversation |
| `qualified` | All criteria collected |
| `booked` | Viewing scheduled |
| `handoff` | Needs human follow-up |
| `abandoned` | No longer interested |

### Using the AI Assistant

The admin assistant understands natural language commands in **English or French**.

**Common commands:**

```
# Reports
how many leads do we have?
show me the pipeline summary
weekly report
which listings are performing best?

# Lead management
find lead [name or email]
show me all hot leads
update lead [name] status to abandoned — reason: found another property
send a message to [lead name]: "..."

# Viewings
list upcoming viewings
cancel viewing [id]
reschedule viewing [id] to [new slot]

# Listings
list all listings
update listing [name] price to 650000
create new listing [details]

# Bulk actions
send follow-up to all warm leads inactive for 7 days: "[message]"
broadcast to all hot leads on Telegram: "[message]"

# Configuration
add qualification criterion: preferred neighbourhood
change agency tone to more formal
```

### Taking Over a Conversation

When a lead needs human handling:
1. Click the lead in the dashboard
2. Click **Take Over** — the AI stops auto-replying
3. Type and send messages directly as the admin
4. Click **Release** to hand back to the AI agent

### Managing Handoff Rules

Handoff rules auto-escalate conversations when keywords are detected (e.g. "price negotiation", "urgent").

Via the assistant:
```
list handoff rules
create handoff rule: [description], keywords: [word1, word2]
disable handoff rule [id]
```

### Booking Notifications

When a lead books a viewing, the admin receives:
- A notification in the assistant chat panel
- A Telegram message (if Telegram is linked)

---

## Telegram Integration

### Linking Telegram (Admin)

1. Go to `/admin` → click **Lier Telegram** (Link Telegram)
2. Send `/start <token>` to the bot: `@lead_agent_chat_bot`
3. The admin assistant session is now synced — messages from web appear in Telegram and vice versa

### Lead Notifications via Telegram

Once linked, admins receive Telegram alerts for:
- New viewing bookings
- Handoff triggers
- Manual mode messages from leads

### Bot Commands

| Command | Description |
|---------|-------------|
| `/start <token>` | Link your account (admin) or start a lead session |

---

## Troubleshooting

| Issue | Solution |
|-------|---------|
| Agent doesn't reply | Check if conversation is in **Manual** mode — click Release |
| Booking fails | Make sure a valid email is provided before booking |
| Telegram not receiving messages | Ensure the Telegram proxy is running on the host: `node scripts/telegram-api-proxy.mjs` |
| Slot times look wrong | Slots are in **Europe/Paris** timezone (CET/CEST) |
